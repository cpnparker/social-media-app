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
}

/** How many candidates get looked up, and how many observations we sample to
 *  decide visibility. Both bounded: this runs on every turn. */
const MAX_LOOKUPS = 8;
const OBS_SAMPLE = 200;

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
    const { data: user } = await mb.from("users").select("id").ilike("email", readerEmail).maybeSingle();
    const uid = (user as any)?.id;
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

export async function resolveEntities(opts: {
  workspaceId: string;
  readerEmail: string;
  /** "team" means more than one person will read the answer. */
  audience: "team" | "private";
  userMessage: string;
}): Promise<ResolvedEntity[]> {
  const candidates: Candidate[] = extractCandidates(opts.userMessage).slice(0, MAX_LOOKUPS);
  if (candidates.length === 0) return [];

  // 1. Candidates -> nodes, through the alias index.
  const { data: aliasRows, error } = await intelligenceDb
    .from("entity_alias")
    .select("alias_text, count_evidence, id_node, entity_node!inner(id_node, id_workspace, type_node, name_display, email_primary, domain_primary, type_person, type_relationship, id_client, type_status)")
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
  const { data: obs } = await intelligenceDb
    .from("entity_observation")
    .select("id_node, type_visibility, id_visibility_key, id_owner, date_observed")
    .in("id_node", nodeIds)
    .order("date_observed", { ascending: false })
    .limit(OBS_SAMPLE);
  const observations = (obs || []) as any[];
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
    if (o.type_visibility === "personal_mailbox") return false; // owner ids not yet mapped; fail closed
    return false;
  };

  const out: ResolvedEntity[] = [];
  for (const [id, { node }] of Array.from(byNode.entries())) {
    const mine = observations.filter((o) => o.id_node === id && visibleFor(o));
    if (mine.length === 0) continue; // invisible to this reader: say nothing at all
    const last = mine.map((o) => String(o.date_observed)).sort().pop() || null;

    if (node.type_node === "person") {
      out.push({
        name: node.name_display, kind: "person", key: node.email_primary || null,
        detail: node.type_person === "internal" ? "colleague" : "external contact",
        sightings: mine.length, lastSeen: last,
      });
    } else if (node.type_node === "org") {
      const rel = node.id_client
        ? `client (Engine id ${node.id_client})`
        : "no client record in Engine";
      out.push({
        name: node.name_display, kind: "org", key: node.domain_primary || null,
        detail: rel, sightings: mine.length, lastSeen: last,
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
    return `- ${e.name}${key} — ${e.detail}; seen in ${e.sightings} meeting${e.sightings === 1 ? "" : "s"} you have access to${when}.`;
  });
  return [
    "",
    "[KNOWN TO THIS WORKSPACE — resolved from your own records, filtered to what you may see]",
    ...lines,
    "Treat these as established facts; do not re-derive or doubt them. When searching mail or Slack for one of these, search by the ADDRESS or DOMAIN above, not the display name — that is what makes the difference between finding a thread and reporting it missing. If something here looks wrong, say so rather than working around it.",
  ].join("\n");
}
