/**
 * Index the people and organisations already sitting in the meeting corpus.
 *
 * This is not a data-acquisition project. meetingbrain.processed_meeting
 * .attendees is a JSON array of {email, name, organizer, self, responseStatus}
 * for every calendar attendee, internal and external — so the address of the
 * person whose name EngineAI could not resolve is almost certainly already
 * here, on the very handover event it was quoting from when it said it could
 * not confirm the client existed. What is missing is an index, not the data.
 *
 * WHAT IT WRITES: identity only. Person nodes keyed on address, org nodes keyed
 * on domain, the aliases that make a name resolvable, a works_at edge, and one
 * observation per sighting.
 *
 * WHAT IT REFUSES TO WRITE: meaning. No job titles, no relationship types
 * beyond 'unknown', no introduced-us edges, no confirmations. Those come from a
 * person, through the proposal queue. add-client-email-domains.sql learned this
 * the hard way — "zurich" matches three different organisations here and the
 * top inferred domain for two of them belongs to the third.
 *
 *   npx tsx scripts/backfill-entity-graph.ts --dry-run
 *   npx tsx scripts/backfill-entity-graph.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");

const INTERNAL_DOMAINS = ["thecontentengine.com", "authorityon.ai", "zdigitalagency.com"];
const NON_ORG_HOSTS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "google.com", "calendar.google.com", "group.calendar.google.com",
  "resource.calendar.google.com",
]);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("\n  Missing Supabase credentials — cannot run.\n"); process.exit(2); }

const intel = createClient(url!, key!, { db: { schema: "intelligence" } });
const mb = createClient(url!, key!, { db: { schema: "meetingbrain" } });
const pub = createClient(url!, key!);

const domainOf = (email: string) => (email.split("@")[1] || "").toLowerCase().trim();
const isInternal = (d: string) => INTERNAL_DOMAINS.indexOf(d) >= 0;

/** "Ollie Cann" -> "Ollie". Derived from a display name that is already
 *  attached to a resolved address — a bare first name in free text never
 *  creates anything, because display names are third-party controlled. */
function givenName(display: string): string | null {
  const first = (display || "").trim().split(/\s+/)[0];
  if (!first || first.length < 2 || first.indexOf("@") >= 0) return null;
  if (!/^[A-Za-z][A-Za-z'’-]+$/.test(first)) return null;
  return first;
}


/**
 * Find-or-create a node by its deterministic key.
 *
 * NOT an upsert. The unique indexes on entity_node are PARTIAL —
 * "WHERE domain_primary IS NOT NULL AND type_status <> 'merged'", so a merged
 * duplicate stops blocking its survivor — and ON CONFLICT can only infer a
 * partial index if the statement repeats the predicate, which PostgREST's
 * onConflict parameter cannot express. The first run failed on every single
 * node with 42P10 and wrote nothing at all, which is at least the honest
 * failure mode.
 *
 * Two round trips per node instead of one. At 483 people and 176 orgs that is
 * irrelevant, and the partial index is worth more than the round trip.
 */
async function ensureNode(
  keyColumn: "email_primary" | "domain_primary",
  keyValue: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  const { data: found, error: findErr } = await intel
    .from("entity_node")
    .select("id_node")
    .eq("id_workspace", payload.id_workspace as string)
    .eq(keyColumn, keyValue)
    .neq("type_status", "merged")
    .maybeSingle();
  if (findErr) { console.log(`  lookup ${keyValue}: ${findErr.message}`); return null; }
  if (found) return (found as any).id_node;

  const { data: made, error: insErr } = await intel
    .from("entity_node").insert(payload).select("id_node").maybeSingle();
  if (insErr) {
    // A concurrent run may have created it between the select and the insert.
    if (insErr.code === "23505") {
      const { data: retry } = await intel.from("entity_node").select("id_node")
        .eq("id_workspace", payload.id_workspace as string).eq(keyColumn, keyValue)
        .neq("type_status", "merged").maybeSingle();
      return retry ? (retry as any).id_node : null;
    }
    console.log(`  insert ${keyValue}: ${insErr.message}`);
    return null;
  }
  return made ? (made as any).id_node : null;
}


/**
 * The label a person would actually type: "gavi.org" -> "gavi".
 *
 * Deliberately NOT used as the org's display name. Capitalising a domain label
 * guesses at a real name and is often wrong — "zhinst.com" is Zurich
 * Instruments, not "Zhinst". So the domain stays the honest display value and
 * this exists purely so the WORD resolves: without it, an org indexed from
 * calendar attendees can only be found by typing its full domain, which nobody
 * does. 176 organisations were in that state.
 */
function domainLabel(domain: string): string | null {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Second-level label, stepping past a public suffix like .co.uk / .com.sg.
  const SUFFIX2 = new Set(["co", "com", "org", "net", "ac", "gov"]);
  let idx = parts.length - 2;
  if (idx > 0 && SUFFIX2.has(parts[idx])) idx -= 1;
  const label = parts[idx];
  if (!label || label.length < 3) return null;
  return label;
}

interface Att { email?: string; name?: string; organizer?: boolean; self?: boolean }

async function main() {
  const { data: ws } = await intel.from("workspaces").select("id").limit(1).maybeSingle();
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) { console.log("  No workspace found."); process.exit(2); }

  console.log(`\n${DRY ? "DRY RUN — nothing will be written" : "WRITING"}\n`);

  // Confirmed client domains, so an org can be linked to its app_clients row.
  // Only flag_confirmed = 1: an inferred domain attributed to the wrong client
  // shows one account team another's confidential material.
  const { data: cd } = await intel.from("client_email_domains")
    .select("id_client, domain").eq("flag_confirmed", 1);
  const clientByDomain = new Map<string, number>();
  for (const r of (cd || []) as any[]) clientByDomain.set(String(r.domain).toLowerCase(), r.id_client);
  console.log(`  confirmed client domains: ${clientByDomain.size}`);

  // Real client names, so an org that IS a client is called what Engine calls
  // it rather than what its domain happens to spell.
  const clientNameById = new Map<number, string>();
  const { data: clients } = await pub.from("app_clients").select("id_client, name_client");
  for (const r of (clients || []) as any[]) if (r.name_client) clientNameById.set(r.id_client, String(r.name_client));
  console.log(`  client names available: ${clientNameById.size}`);

  // Page through the corpus. attendees LIKE '[%' is how the deployed RPCs gate
  // it — the column is TEXT and jsonb_array_elements errors on non-JSON.
  const PAGE = 1000;
  let from = 0, scanned = 0, withAttendees = 0;
  const persons = new Map<string, { display: string; internal: boolean; seen: number; last: string }>();
  const orgs = new Map<string, { display: string; seen: number }>();
  const sightings: { email: string; eventId: string; userId: number; when: string }[] = [];

  for (;;) {
    const { data, error } = await mb.from("processed_meeting")
      .select("calendar_event_id, user_id, attendees, meeting_date")
      .like("attendees", "[%")
      .range(from, from + PAGE - 1);
    if (error) { console.log(`  QUERY FAILED: ${error.message}`); process.exit(2); }
    const rows = (data || []) as any[];
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const r of rows) {
      let list: Att[] = [];
      try { list = JSON.parse(r.attendees); } catch { continue; }
      if (!Array.isArray(list) || list.length === 0) continue;
      withAttendees++;
      for (const a of list) {
        const email = String(a?.email || "").toLowerCase().trim();
        if (!email || email.indexOf("@") < 0) continue;
        const d = domainOf(email);
        if (!d || NON_ORG_HOSTS.has(d)) continue;
        const display = String(a?.name || "").trim() || email;
        const p = persons.get(email);
        if (p) { p.seen++; if (r.meeting_date > p.last) { p.last = r.meeting_date; p.display = display; } }
        else persons.set(email, { display, internal: isInternal(d), seen: 1, last: r.meeting_date });
        if (!isInternal(d)) {
          const o = orgs.get(d);
          if (o) o.seen++; else orgs.set(d, { display: d, seen: 1 });
        }
        if (r.calendar_event_id) {
          sightings.push({ email, eventId: r.calendar_event_id, userId: r.user_id, when: r.meeting_date });
        }
      }
    }
    from += PAGE;
    if (rows.length < PAGE) break;
  }

  console.log(`  meetings scanned: ${scanned} (${withAttendees} carried attendee data)`);
  console.log(`  distinct people:  ${persons.size}`);
  console.log(`  distinct orgs:    ${orgs.size}  (internal and free-mail domains excluded)`);
  console.log(`  sightings:        ${sightings.length}`);

  if (DRY) {
    const ext = Array.from(persons.values()).filter((p) => !p.internal).length;
    console.log(`\n  of those people, ${ext} are external and ${persons.size - ext} internal.`);
    console.log(`  ${Array.from(orgs.entries()).filter(([d]) => clientByDomain.has(d)).length} org(s) map to a confirmed client.`);
    console.log(`\n  Nothing written. Re-run without --dry-run to apply.\n`);
    return;
  }

  // ── write orgs, then people, then edges, then observations ──
  const orgIdByDomain = new Map<string, string>();
  for (const [domain, o] of Array.from(orgs.entries())) {
    const idc = clientByDomain.get(domain);
    const nodeId = await ensureNode("domain_primary", domain, {
      id_workspace: workspaceId, type_node: "org", name_display: o.display,
      domain_primary: domain, id_client: idc ?? null,
      // 'unknown' deliberately, even when the domain maps to a client: the
      // MEANING of a relationship is a human's to state. The id_client pointer
      // is a fact; calling them a client here would be an inference.
      type_relationship: "unknown", type_status: "observed",
    });
    if (nodeId) {
      orgIdByDomain.set(domain, nodeId);
      const aliases: any[] = [{
        id_node: nodeId, alias_text: domain, type_alias: "domain",
        type_source: "calendar_attendee", count_evidence: o.seen, date_last_seen: new Date().toISOString(),
      }];
      const label = domainLabel(domain);
      if (label) {
        aliases.push({
          id_node: nodeId, alias_text: label,
          type_alias: label.length <= 6 ? "acronym" : "display_name",
          type_source: "calendar_attendee", count_evidence: o.seen,
        });
      }
      // Where the domain maps to a CONFIRMED client, Engine holds the real
      // name. That is authoritative, unlike anything derived from the domain,
      // so it becomes both an alias and the display value.
      const realName = idc ? clientNameById.get(idc) : undefined;
      if (realName) {
        aliases.push({
          id_node: nodeId, alias_text: realName, type_alias: "display_name",
          type_source: "engine_record", count_evidence: o.seen,
        });
        await intel.from("entity_node").update({ name_display: realName }).eq("id_node", nodeId);
      }
      await intel.from("entity_alias").upsert(aliases, { onConflict: "id_node,alias_text,type_alias" });
    }
  }
  console.log(`  orgs written: ${orgIdByDomain.size}`);

  const personIdByEmail = new Map<string, string>();
  for (const [email, p] of Array.from(persons.entries())) {
    const id = await ensureNode("email_primary", email, {
      id_workspace: workspaceId, type_node: "person", name_display: p.display,
      email_primary: email, type_person: p.internal ? "internal" : "external",
      type_status: "observed",
    });
    if (!id) continue;
    personIdByEmail.set(email, id);
    const aliases: any[] = [
      { id_node: id, alias_text: email, type_alias: "email", type_source: "calendar_attendee", count_evidence: p.seen },
    ];
    if (p.display && p.display !== email) {
      aliases.push({ id_node: id, alias_text: p.display, type_alias: "display_name", type_source: "calendar_attendee", count_evidence: p.seen });
      const g = givenName(p.display);
      if (g) aliases.push({ id_node: id, alias_text: g, type_alias: "given_name", type_source: "calendar_attendee", count_evidence: p.seen });
    }
    await intel.from("entity_alias").upsert(aliases, { onConflict: "id_node,alias_text,type_alias" });

    const d = domainOf(email);
    const orgId = orgIdByDomain.get(d);
    if (orgId) {
      // upsert, not insert: this script is expected to be re-run as the corpus
      // grows, and plain inserts made it add a duplicate works_at edge every
      // time. Requires entity_edge_uq from scripts/fix-entity-duplicates.sql.
      await intel.from("entity_edge").upsert({
        id_source: id, id_target: orgId, type_edge: "works_at",
        count_evidence: p.seen, flag_confirmed: 0,
      }, { onConflict: "id_source,id_target,type_edge", ignoreDuplicates: true });
    }
  }
  console.log(`  people written: ${personIdByEmail.size}`);

  // Observations carry the visibility KEY, not a verdict. The deployed
  // get_meeting_visibility function stays the single source of truth; baking
  // its answer here would be a second copy that drifts.
  let obs = 0;
  const BATCH = 500;
  for (let i = 0; i < sightings.length; i += BATCH) {
    const rows = sightings.slice(i, i + BATCH)
      .map((s) => ({
        id_node: personIdByEmail.get(s.email), type_source: "calendar_attendee",
        id_source_system: s.eventId, date_observed: s.when,
        type_visibility: "meeting_attendees", id_visibility_key: s.eventId,
        // id_owner stays NULL for a calendar sighting, deliberately.
        //
        // It exists for personal_mailbox observations, where "whose inbox"
        // decides who may see it. For a meeting, the EVENT is the unit of
        // visibility, not whichever colleague's calendar happened to record
        // it — 1,183 of these events have more than one recorder, so naming
        // one of them as the owner would be arbitrary. id_visibility_key
        // carries calendar_event_id and the deployed visibility function
        // stays the authority.
        //
        // (It also cannot hold this value: MeetingBrain user ids are CUID
        // strings and this column is an integer Engine user id. Mapping one to
        // the other would have been work in service of a wrong idea.)
        id_owner: null,
      }))
      .filter((r) => r.id_node);
    if (!rows.length) continue;
    // ignoreDuplicates: a sighting already recorded is the same sighting.
    // Requires entity_observation_uq from scripts/fix-entity-duplicates.sql.
    const { error } = await intel.from("entity_observation")
      .upsert(rows, { onConflict: "id_node,id_edge,type_source,id_source_system,date_observed", ignoreDuplicates: true });
    if (error) { console.log(`  observations: ${error.message}`); break; }
    obs += rows.length;
  }
  console.log(`  observations written: ${obs}\n`);
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
