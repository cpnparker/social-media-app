/**
 * Verify meetingbrain.meeting_visibility after the migration.
 * `npx tsx scripts/verify-meeting-visibility.ts`
 *
 * The check that matters is the count. docs/meetingbrain-meeting-visibility-spec.md
 * measured two candidate backfills: the correct one seeds ~140 events from what
 * get_client_meetings actually returns, and the plausible-looking one (re-derive
 * the client-domain match in SQL) seeds ~2,835 — publishing roughly 2,700
 * meetings that are private today. Both run cleanly. Both report success. The
 * only way to tell them apart is to count afterwards, which is what this does.
 *
 * Nothing reads this table yet, so a wrong backfill is still fully reversible
 * at this point. That stops being true at spec step 3.
 *
 * PRIVACY: counts, dates and column names only — never a meeting title,
 * summary, attendee or email.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const mb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "meetingbrain" } });
const mbAnon = ANON_KEY ? createClient(SUPABASE_URL, ANON_KEY, { db: { schema: "meetingbrain" } }) : null;
const pub = createClient(SUPABASE_URL, SERVICE_KEY);
const INTERNAL_DOMAIN = "thecontentengine.com";

/** What the correct backfill should produce, measured live rather than assumed. */
const EXPECTED_TOLERANCE = 3; // multiple of the live shared count before it is "wrong"

let pass = 0, fail = 0, warn = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function note(msg: string) { warn++; console.log(`  ! ${msg}`); }

async function clientDomains(): Promise<string[]> {
  const { data } = await pub.from("app_clients").select("link_website");
  const out = new Set<string>();
  let malformed = 0;
  for (const c of data || []) {
    const w = (c as any).link_website;
    if (!w) continue;
    try {
      out.add(new globalThis.URL(String(w).startsWith("http") ? w : `https://${w}`).hostname.replace(/^www\./, "").toLowerCase());
    } catch { malformed++; }
  }
  if (malformed) console.warn(`    (${malformed} client website(s) unparseable)`);
  if (!out.size) throw new Error("No client domains resolved — refusing to compare, every number would be wrong.");
  return Array.from(out);
}

async function main() {
  console.log("\n1. The table exists and has the shape the spec describes");
  const { data: probe, error: probeErr } = await mb
    .from("meeting_visibility")
    .select("calendar_event_id, visibility, source, set_by, date_created, date_updated")
    .limit(1);
  check("meeting_visibility is readable", !probeErr, probeErr ? `${probeErr.code}: ${probeErr.message}` : undefined);
  if (probeErr) {
    console.log("\n  Cannot continue — has the CREATE TABLE from the spec been run?");
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  check("every column the spec defines exists", !probeErr);

  console.log("\n2. The count — the check that separates the two backfills");
  const { count: total } = await mb.from("meeting_visibility").select("*", { count: "exact", head: true });
  const { count: teamCount } = await mb
    .from("meeting_visibility").select("*", { count: "exact", head: true }).eq("visibility", "team");
  const { count: privateCount } = await mb
    .from("meeting_visibility").select("*", { count: "exact", head: true }).eq("visibility", "private");

  const domains = await clientDomains();
  const { data: shared, error: sharedErr } = await mb.rpc("get_client_meetings", {
    p_internal_domain: INTERNAL_DOMAIN,
    p_client_domains: domains,
    p_since: "2000-01-01T00:00:00Z",
    p_limit: 100000,
  });
  const liveShared = sharedErr ? null : ((shared || []) as any[]).length;

  console.log(`    rows total          : ${total ?? 0}`);
  console.log(`    visibility = 'team' : ${teamCount ?? 0}`);
  console.log(`    visibility='private': ${privateCount ?? 0}`);
  console.log(`    get_client_meetings : ${liveShared ?? "unavailable"}   ← what is shared TODAY`);

  if (total === 0) {
    note("Table is empty — the schema is in, the backfill has not been run. That is a valid stopping point: absence means private, so nothing is exposed.");
  } else if (liveShared == null) {
    note("Could not read get_client_meetings, so the count cannot be compared. Do NOT proceed to spec step 3 until it can.");
  } else {
    check(
      `'team' count is close to the live shared set (${liveShared}), not the domain-match figure`,
      (teamCount ?? 0) <= liveShared * EXPECTED_TOLERANCE,
      `${teamCount} team rows vs ${liveShared} actually shared — if this is in the thousands, the domain-matching backfill was run; delete WHERE source = 'backfill' and re-seed`
    );
  }

  console.log("\n3. Absence means private");
  const { data: events } = await mb.from("processed_meeting").select("calendar_event_id").limit(10000);
  const distinctEvents = new Set((events || []).map((e: any) => e.calendar_event_id).filter(Boolean));
  const covered = total ?? 0;
  console.log(`    distinct calendar events : ${distinctEvents.size}`);
  console.log(`    events with a row        : ${covered}`);
  console.log(`    implicitly private       : ${distinctEvents.size - covered}`);
  check(
    "the table does not claim to cover every event (absence is the private default)",
    covered < distinctEvents.size || distinctEvents.size === 0,
    covered >= distinctEvents.size ? "every event has an explicit row — check none were defaulted to 'team'" : undefined
  );

  console.log("\n4. RLS — a meeting-privacy table must not be world-readable");
  if (!mbAnon) {
    note("NEXT_PUBLIC_SUPABASE_ANON_KEY not set locally, so the anon check could not run.");
  } else {
    const { data: anonRows, error: anonErr } = await mbAnon.from("meeting_visibility").select("calendar_event_id").limit(1);
    check(
      "the anon key cannot read meeting_visibility",
      !!anonErr || (anonRows?.length ?? 0) === 0,
      anonErr ? `blocked with ${anonErr.code}` : `RETURNED ${anonRows?.length} ROW(S)`
    );
    const { error: anonWriteErr } = await mbAnon.from("meeting_visibility").insert({
      calendar_event_id: "rls-probe-should-never-exist",
      visibility: "team",
    });
    check(
      "the anon key cannot write meeting_visibility",
      !!anonWriteErr,
      anonWriteErr ? `blocked with ${anonWriteErr.code}` : "INSERT SUCCEEDED — anyone could share any meeting"
    );
    if (!anonWriteErr) {
      await mb.from("meeting_visibility").delete().eq("calendar_event_id", "rls-probe-should-never-exist");
      console.log("    (probe row removed)");
    }
  }

  console.log(`\n${pass} passed, ${fail} failed${warn ? `, ${warn} note(s)` : ""}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
