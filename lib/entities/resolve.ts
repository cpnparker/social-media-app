import { intelligenceDb } from "@/lib/supabase-intelligence";
import { createClient } from "@supabase/supabase-js";
import { extractCandidates, type Candidate } from "@/lib/entities/candidates";

/**
 * Turn the names in a message into facts the model can use — filtered to what
 * THIS reader is allowed to know.
 *
 * THE VISIBILITY RULE IS THE POINT. A node is a join key with no audience of
 * its own; nothing about it is rendered unless this reader can see at least one
 * observation supporting it. That is an INTERSECTION, computed per reader, per
 * turn. The alternative — a summary stored on the node — takes the UNION of its
 * sources, which is precisely how a private one-to-one becomes readable by a
 * whole team. This system has already done that once, to twenty meetings, for a
 * month.
 *
 * So: no cache of rendered facts, ever. The cost of recomputing is a couple of
 * indexed queries. The cost of caching is a privacy incident.
 */

export interface ResolvedEntity {
  name: string;
  kind: "person" | "org" | "engagement";
  /** The address or domain to SEARCH with. The whole failure this fixes was
   *  searching a mailbox by display name when the address was already known. */
  key: string | null;
  detail: string;
  sightings: number;
  lastSeen: string | null;
  /** What this entity IS to us, in words — "head of Gavi", "competitor on the
   *  IFFIm pitch". Empty until a relationship fact exists and is visible.
   *
   *  This field is the whole point and it was missing. resolve.ts rendered
   *  "colleague" or "external contact" and nothing else, so the graph could
   *  hold a role and no reader would ever see it. */
  relations: string[];
}

/** How many candidates get looked up, and how many observations we sample to
 *  decide visibility. Both bounded: this runs on every turn. */
const MAX_LOOKUPS = 8;
/** Per candidate, not per turn. */
const OBS_SAMPLE = 60;

function mbClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "meetingbrain" } }
  );
}

/**
 * Which of these calendar events did the reader actually attend?
 *
 * Answered from the reader's OWN processed_meeting rows — the same records that
 * decide what they can see everywhere else — rather than by re-deriving a rule
 * here. Bounded by the events already attached to the resolved candidates, so
 * this is one indexed `in` query however large the corpus grows.
 */
async function eventsReaderAttended(readerEmail: string, eventIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!readerEmail || eventIds.length === 0) return out;
  try {
    const mb = mbClient();
    // limit(1): two rows differing only by case would raise PGRST116 and, since
    // this fails closed, silently hide every meeting-scoped fact from the
    // reader rather than showing too much. Wrong in the safe direction is
    // still wrong.
    const { data: user } = await mb.from("users").select("id").ilike("email", readerEmail).limit(1);
    const uid = (user as any[])?.[0]?.id;
    if (!uid) return out;
    const { data } = await mb
      .from("processed_meeting")
      .select("calendar_event_id")
      .eq("user_id", uid)
      .in("calendar_event_id", eventIds.slice(0, 200));
    for (const r of (data || []) as any[]) if (r.calendar_event_id) out.add(r.calendar_event_id);
  } catch {
    // Fail CLOSED. An error here must not widen what is shown: an empty set
    // means nothing meeting-scoped is rendered, which is the safe direction.
  }
  return out;
}

/**
 * A short label safe to put in a prompt, or nothing.
 *
 * DROPS rather than sanitises. A string that changes under normalisation is a
 * string someone built to survive normalisation, and quietly cleaning it up
 * hides that. Returning null costs one missing label; returning a scrubbed
 * version of an attack keeps the attack.
 */
function safeShort(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t || t.length > 60) return null;
  // Explicit class, not \p{L}: unicode property escapes need the `u` flag,
  // which needs an ES6 target, which this build does not set. Latin-1
  // supplement covers the accented names that actually occur here.
  if (!/^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF .,'&-]+$/.test(t)) return null;
  return t;
}

export async function resolveEntities(opts: {
  workspaceId: string;
  readerEmail: string;
  /** The Engine user id. Needed to see facts THIS person stated: those
   *  observations carry id_owner, and without the id there is no way to tell
   *  the owner's own facts from someone else's, so they were all refused. */
  readerUserId?: number;
  /** "team" means more than one person will read the answer. */
  audience: "team" | "private";
  userMessage: string;
}): Promise<ResolvedEntity[]> {
  const candidates: Candidate[] = extractCandidates(opts.userMessage).slice(0, MAX_LOOKUPS);
  if (candidates.length === 0) return [];

  // 1. Candidates -> nodes, through the alias index.
  const { data: aliasRows, error } = await intelligenceDb
    .from("entity_alias")
    .select("alias_text, count_evidence, id_node, entity_node!inner(id_node, id_workspace, type_node, name_display, email_primary, domain_primary, type_person, type_relationship, id_client, type_status, type_stage, id_contract, id_engagement_client)")
    .in("alias_text", candidates.map((c) => c.text));
  if (error || !aliasRows?.length) return [];

  const byNode = new Map<string, any>();
  for (const r of aliasRows as any[]) {
    const n = r.entity_node;
    if (!n || n.id_workspace !== opts.workspaceId) continue;
    if (n.type_status === "merged" || n.type_status === "rejected") continue;
    if (!byNode.has(n.id_node)) byNode.set(n.id_node, { node: n, evidence: r.count_evidence || 1 });
  }
  if (byNode.size === 0) return [];

  // 2. Observations for those nodes. Nothing is rendered without one.
  const nodeIds = Array.from(byNode.keys());
  // PER NODE, not one shared limit. A single `.in(...).limit(200)` across up to
  // eight candidates meant one high-volume entity — an org seen in a hundred
  // meetings — consumed the whole sample and every other candidate silently
  // rendered nothing. It also made `sightings` a count of a truncated,
  // recency-biased window rather than of what the reader can actually see.
  const observations: any[] = [];
  for (const nodeId of nodeIds) {
    const { data: rows } = await intelligenceDb
      .from("entity_observation")
      .select("id_node, type_visibility, id_visibility_key, id_owner, date_observed")
      .eq("id_node", nodeId)
      .order("date_observed", { ascending: false })
      .limit(OBS_SAMPLE);
    if (rows?.length) observations.push(...rows);
  }
  if (observations.length === 0) return [];

  // 3. The intersection.
  const meetingKeys = Array.from(new Set(
    observations.filter((o) => o.type_visibility === "meeting_attendees" && o.id_visibility_key)
                .map((o) => o.id_visibility_key)
  ));
  const attended = await eventsReaderAttended(opts.readerEmail, meetingKeys);

  const visibleFor = (o: any): boolean => {
    if (o.type_visibility === "workspace") return true;
    if (o.type_visibility === "team") return opts.audience === "team";
    // Everything below is single-reader only. In a thread more than one person
    // will read, a fact known from a meeting only this reader attended is not
    // theirs to publish.
    if (opts.audience !== "private") return false;
    if (o.type_visibility === "meeting_attendees") return attended.has(o.id_visibility_key);
    // A fact this person stated themselves. It was refused outright until now
    // — "owner ids not yet mapped" — which meant every fact anyone typed into
    // chat was written to the graph and then invisible to its own author. The
    // third time this system has held a fact no reader could reach: 433
    // works_at edges nothing read, engagement nodes with no render branch, and
    // this.
    if (o.type_visibility === "personal_mailbox") {
      return typeof opts.readerUserId === "number" && o.id_owner === opts.readerUserId;
    }
    return false;
  };

  // ── Relationship facts ────────────────────────────────────────────────
  // Edges are only rendered when the reader can see an observation supporting
  // THE EDGE — the same intersection as nodes. An edge with no observations is
  // invisible by design, which is correct: an unevidenced claim about a named
  // person is the thing this system must never assert.
  const { data: edgeRows } = await intelligenceDb
    .from("entity_edge")
    .select("id_edge, id_source, id_target, type_edge, role_text, flag_confirmed, date_invalidated")
    .in("id_source", nodeIds)
    .is("date_invalidated", null);
  const edges = (edgeRows || []) as any[];

  const edgeVisible = new Set<string>();
  if (edges.length) {
    const { data: edgeObs } = await intelligenceDb
      .from("entity_observation")
      .select("id_edge, type_visibility, id_visibility_key, id_owner")
      .in("id_edge", edges.map((e) => e.id_edge))
      .limit(OBS_SAMPLE);
    const eObs = (edgeObs || []) as any[];
    const eKeys = Array.from(new Set(
      eObs.filter((o) => o.type_visibility === "meeting_attendees" && o.id_visibility_key)
          .map((o) => o.id_visibility_key)
    ));
    const eAttended = eKeys.length ? await eventsReaderAttended(opts.readerEmail, eKeys) : new Set<string>();
    for (const o of eObs) {
      const ok = o.type_visibility === "workspace"
        || (o.type_visibility === "team" && opts.audience === "team")
        || (opts.audience === "private" && o.type_visibility === "meeting_attendees" && eAttended.has(o.id_visibility_key))
        // Same as nodes: a relationship the reader stated is theirs to see.
        || (opts.audience === "private" && o.type_visibility === "personal_mailbox"
            && typeof opts.readerUserId === "number" && o.id_owner === opts.readerUserId);
      if (ok) edgeVisible.add(o.id_edge);
    }
  }

  // Target names, so an edge can read "works at Gavi" rather than a uuid.
  const targetIds = Array.from(new Set(edges.map((e) => e.id_target)));
  const targetName = new Map<string, string>();
  if (targetIds.length) {
    const { data: targets } = await intelligenceDb
      .from("entity_node").select("id_node, name_display").in("id_node", targetIds);
    for (const t of (targets || []) as any[]) targetName.set(t.id_node, t.name_display);
  }

  const VERB: Record<string, string> = {
    works_at: "works at", member_of: "is at", engagement_for: "engaged on",
    competing_with: "competing with", introduced: "introduced us to",
    owns: "owns", parent_of: "parent of", same_as: "also known as",
  };
  const relationsFor = (nodeId: string): string[] =>
    edges
      .filter((e) => e.id_source === nodeId && edgeVisible.has(e.id_edge))
      .map((e) => {
        const who = targetName.get(e.id_target) || "";
        const verb = VERB[e.type_edge] || e.type_edge;
        // role_text renders ONLY when a person confirmed it. It is free text
        // that will one day be written by an extractor reading meeting notes —
        // i.e. by whoever was in the room. Shipping the gate now, while the
        // column is still empty everywhere, is the right order: escaping
        // before there is anything to escape.
        const role = e.flag_confirmed === 1 ? safeShort(e.role_text) : null;
        return role ? `${role}${who ? ` (${who})` : ""}` : `${verb} ${who}`.trim();
      })
      .filter(Boolean)
      .slice(0, 3);

  const out: ResolvedEntity[] = [];
  for (const [id, { node }] of Array.from(byNode.entries())) {
    const mine = observations.filter((o) => o.id_node === id && visibleFor(o));
    if (mine.length === 0) continue; // invisible to this reader: say nothing at all
    const last = mine.map((o) => String(o.date_observed)).sort().pop() || null;

    if (node.type_node === "person") {
      out.push({
        name: node.name_display, kind: "person", key: node.email_primary || null,
        detail: node.type_person === "internal" ? "colleague" : "external contact",
        sightings: mine.length, lastSeen: last, relations: relationsFor(id),
      });
    } else if (node.type_node === "engagement") {
      // The commercial spine: what we are actually contracted to do. Stage is
      // derived from the contract's own dates in Engine, so it cannot drift
      // from what a person sees in the app.
      const stage: Record<string, string> = {
        pitch: "a live pitch", won: "won, not yet started", live: "live work",
        closed: "finished", lost: "lost",
      };
      out.push({
        name: node.name_display, kind: "engagement",
        key: node.id_contract ? `contract ${node.id_contract}` : null,
        detail: stage[node.type_stage as string] || "an engagement",
        sightings: mine.length, lastSeen: last, relations: relationsFor(id),
      });
    } else if (node.type_node === "org") {
      const rel = node.id_client
        ? `client (Engine id ${node.id_client})`
        : "no client record in Engine";
      out.push({
        name: node.name_display, kind: "org", key: node.domain_primary || null,
        detail: rel, sightings: mine.length, lastSeen: last, relations: relationsFor(id),
      });
    }
  }
  return out.sort((a, b) => b.sightings - a.sightings).slice(0, 6);
}

/**
 * The block appended to the user's message.
 *
 * Goes in the MESSAGE TAIL, never the system prompt. Messages carry no cache
 * breakpoint, so appending here costs nothing; the same text in the cached
 * prefix would invalidate ~53,000 characters on every turn, because it changes
 * with every message.
 *
 * Written as facts with their provenance, and with an explicit instruction to
 * search by ADDRESS. Searching a mailbox by display name when the address was
 * already known is the exact failure this exists to prevent.
 */
export function formatResolvedEntities(entities: ResolvedEntity[]): string {
  if (entities.length === 0) return "";
  const lines = entities.map((e) => {
    const when = e.lastSeen ? `, most recently ${String(e.lastSeen).slice(0, 10)}` : "";
    const key = e.key ? ` <${e.key}>` : "";
    const rel = e.relations.length ? ` ${e.relations.join("; ")};` : "";
    return `- ${e.name}${key} —${rel} ${e.detail}; seen in ${e.sightings} meeting${e.sightings === 1 ? "" : "s"} you have access to${when}.`;
  });
  return [
    "",
    "[KNOWN TO THIS WORKSPACE — resolved from your own records, filtered to what you may see]",
    ...lines,
    // NOT "treat these as established facts". These lines contain strings
    // authored by third parties — a calendar display name is whatever that
    // person put in their own Google profile — and instructing the model to
    // believe them without question is both an overclaim and an invitation.
    // The useful half of the old sentence was the search advice; that stays.
    "This is a workspace index. It may be stale or incomplete, and names in it are as people wrote them. Use it to identify who is being discussed, and when searching mail or Slack, search by the ADDRESS or DOMAIN above rather than the display name — that is the difference between finding a thread and reporting it missing. Verify anything you are about to act on.",
  ].join("\n");
}
