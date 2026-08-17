/**
 * Measurements behind docs/meetingbrain-meeting-visibility-spec.md.
 * `npx tsx scripts/measure-meeting-visibility.ts`
 *
 * Re-runnable, because the spec's whole argument rests on five numbers and a
 * number in a document rots. Two of them contradicted what the design
 * "obviously" should have been:
 *
 *   - 36% of meetings have NO attendee data, so attendee count cannot classify
 *     anything, and a default of "team" would publish a third of the corpus.
 *   - 20% of calendar events have more than one recorder, so a per-ROW flag is
 *     bypassable via a sibling row for one meeting in five.
 *   - get_client_meetings returns 140 meetings, while a domain-matching
 *     backfill would mark 2,835 as team. The obvious backfill over-promotes
 *     20x, silently.
 *
 * Run against the WHOLE corpus, not a sample. A 2,000-row sample understated
 * sibling-recorder events as 8.6% (true: 20%) and 1:1s as 47% of internal
 * meetings (true: 60%) — it was wrong about exactly the two populations the
 * design turns on.
 *
 * PRIVACY: counts, dates and distributions only. This never prints a meeting
 * title, a summary, an attendee name or an email address — the questions here
 * need none of that to answer, and this file exists to be run against a live
 * corpus of people's meetings.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const mb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "meetingbrain" } });
const pub = createClient(SUPABASE_URL, SERVICE_KEY);
const INTERNAL_DOMAIN = "thecontentengine.com";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SAMPLE = 10000;

function emailsOf(attendees: unknown): string[] {
  const text = typeof attendees === "string" ? attendees : attendees == null ? "" : JSON.stringify(attendees);
  return (text.match(EMAIL_RE) || []).map((e) => e.toLowerCase());
}

async function clientDomains(): Promise<string[]> {
  const { data } = await pub.from("app_clients").select("link_website");
  const out = new Set<string>();
  let malformed = 0;
  for (const c of data || []) {
    const w = (c as any).link_website;
    if (!w) continue;
    try {
      out.add(new URL(String(w).startsWith("http") ? w : `https://${w}`).hostname.replace(/^www\./, "").toLowerCase());
    } catch (e) {
      // Counted, never silent. An earlier version of this file named a string
      // constant `URL`, which shadowed the global constructor — every parse
      // threw, this catch ate it, and the script reported "0 client domains"
      // and a clean 0x over-promotion factor with total confidence.
      malformed++;
    }
  }
  if (malformed) console.warn(`  ! ${malformed} client website(s) could not be parsed into a domain`);
  if (!out.size) {
    // Refuse rather than measure nothing. An empty allowlist also makes
    // get_client_meetings fall back to "any external attendee", which silently
    // inflates every number below.
    throw new Error("No client domains resolved from app_clients — refusing to measure, every result would be wrong.");
  }
  return Array.from(out);
}

async function main() {
  const domains = await clientDomains();
  const domainSet = new Set(domains);
  console.log(`registered client domains: ${domains.length}`);

  const { data: rows, error } = await mb
    .from("processed_meeting")
    .select("id, calendar_event_id, user_id, attendees, summary, transcript")
    .limit(SAMPLE);
  if (error) {
    console.error("Cannot read processed_meeting:", error.message);
    process.exit(1);
  }
  const all = (rows || []) as any[];

  // ── Attendee data availability ──
  let empty = 0, namesOnly = 0, withEmail = 0;
  for (const r of all) {
    const text = typeof r.attendees === "string" ? r.attendees : r.attendees == null ? "" : JSON.stringify(r.attendees);
    if (!text.trim() || text === "[]" || text === "null" || text === '""') empty++;
    else if (EMAIL_RE.test(text)) { withEmail++; EMAIL_RE.lastIndex = 0; }
    else namesOnly++;
  }
  const pct = (n: number) => `${Math.round((n / all.length) * 100)}%`;
  console.log(`\n── Attendee data (${all.length} rows) ──`);
  console.log(`  empty / null / []   : ${empty} (${pct(empty)})   ← cannot be classified by attendee at all`);
  console.log(`  names, no email     : ${namesOnly}`);
  console.log(`  has email addresses : ${withEmail}`);

  // ── Sibling rows: why the flag must key on the calendar event ──
  const recordersByEvent = new Map<string, Set<number>>();
  let noEventId = 0;
  for (const r of all) {
    if (!r.calendar_event_id) { noEventId++; continue; }
    const s = recordersByEvent.get(r.calendar_event_id) || new Set<number>();
    s.add(r.user_id);
    recordersByEvent.set(r.calendar_event_id, s);
  }
  const multi = Array.from(recordersByEvent.values()).filter((s) => s.size > 1).length;
  console.log(`\n── Sibling rows ──`);
  console.log(`  distinct calendar events : ${recordersByEvent.size}`);
  console.log(`  events with >1 recorder  : ${multi} (${Math.round((multi / Math.max(1, recordersByEvent.size)) * 100)}%)`);
  console.log(`  rows with no event id    : ${noEventId}`);
  console.log(`  → a per-ROW flag would be set on one row and bypassed via a sibling.`);

  // ── The backfill trap ──
  const domainMatched = new Set<string>();
  for (const r of all) {
    if (!r.calendar_event_id) continue;
    if (emailsOf(r.attendees).some((e) => domainSet.has(e.split("@")[1]))) domainMatched.add(r.calendar_event_id);
  }
  const { data: shared, error: sharedErr } = await mb.rpc("get_client_meetings", {
    p_internal_domain: INTERNAL_DOMAIN,
    p_client_domains: domains,
    p_since: "2000-01-01T00:00:00Z",
    p_limit: 100000,
  });
  console.log(`\n── Backfill: measured vs assumed ──`);
  if (sharedErr) {
    console.log(`  get_client_meetings ERROR: ${sharedErr.message}`);
  } else {
    const s = (shared || []) as any[];
    const dates = s.map((r) => String(r.meeting_date || "").slice(0, 10)).filter(Boolean).sort();
    console.log(`  get_client_meetings returns      : ${s.length} meetings`);
    console.log(`  its actual date range            : ${dates[0]} → ${dates[dates.length - 1]}`);
    console.log(`     (asked for everything since 2000-01-01 — p_since is not honoured)`);
    console.log(`  a domain-matching backfill marks : ${domainMatched.size} events`);
    const ratio = s.length ? Math.round(domainMatched.size / s.length) : 0;
    console.log(`  → over-promotion factor          : ${ratio}x  ${ratio > 2 ? "  ⚠ DO NOT backfill by domain match" : ""}`);
  }

  // ── The population this is for ──
  let internalOnly = 0, internalSmall = 0;
  const seen = new Set<string>();
  for (const r of all) {
    if (!r.calendar_event_id || seen.has(r.calendar_event_id)) continue;
    const em = emailsOf(r.attendees);
    if (!em.length) continue;
    seen.add(r.calendar_event_id);
    const doms = new Set(em.map((e) => e.split("@")[1]));
    if (!Array.from(doms).every((d) => d === INTERNAL_DOMAIN)) continue;
    internalOnly++;
    if (new Set(em).size <= 2) internalSmall++;
  }
  console.log(`\n── The sensitive population ──`);
  console.log(`  internal-only meetings   : ${internalOnly}`);
  console.log(`  ...with 1-2 attendees    : ${internalSmall} (${internalOnly ? Math.round((internalSmall / internalOnly) * 100) : 0}% of internal)`);
  console.log(`  → 1:1s are the bulk of internal meetings, not an edge case.\n`);
}

main();
