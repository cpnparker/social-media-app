/**
 * Validate scripts/add-visible-meetings-rpc.sql against Neon, in a transaction
 * that is always rolled back. `npx tsx scripts/validate-visible-meetings-sql.ts`
 *
 * This function WIDENS what the whole company can read, from ~140 meetings to
 * ~1,150. So parsing is nowhere near enough. It builds a miniature corpus and
 * asserts the three things that would actually hurt:
 *
 *   - the widening includes what it should (internal group meetings) and
 *     excludes what it should (1:1s, vendor meetings, no-attendee rows);
 *   - INTERNAL ATTENDEE NAMES NEVER APPEAR, for any meeting shape. The
 *     function it replaces guaranteed that, and widening WHICH meetings are
 *     shared must not quietly widen WHAT is shared about them;
 *   - an override still wins in both directions.
 *
 * Rollback is unconditional, in a finally block, so it runs on assertion
 * failure too.
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { Client } from "pg";

config({ path: ".env.local" });

const CONN = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!CONN) {
  console.error("No NEON_DATABASE_URL / DATABASE_URL in .env.local — cannot validate.");
  process.exit(1);
}

const INTERNAL = "thecontentengine.com";
const CLIENTS = ["acme-client.com"];

/** attendees is stored as a JSON array string: [{name, email}, …]. */
const att = (people: [string, string][]) =>
  JSON.stringify(people.map(([name, email]) => ({ name, email })));

const FIXTURES: { event: string; attendees: string | null; summary: string | null; title: string; shouldAppear: boolean; why: string }[] = [
  {
    event: "e-client", title: "Acme quarterly review", summary: "Reviewed the content plan.",
    attendees: att([["Chris Parker", "chris@thecontentengine.com"], ["Buyer", "buyer@acme-client.com"]]),
    shouldAppear: true, why: "client attendee",
  },
  {
    event: "e-team", title: "Weekly production standup", summary: "Went through the pipeline.",
    attendees: att([["A", "a@thecontentengine.com"], ["B", "b@thecontentengine.com"], ["C", "c@thecontentengine.com"]]),
    shouldAppear: true, why: "internal group — THE WIDENING",
  },
  {
    event: "e-1to1", title: "Catch-up", summary: "Talked through the week.",
    attendees: att([["A", "a@thecontentengine.com"], ["B", "b@thecontentengine.com"]]),
    shouldAppear: false, why: "internal 1:1",
  },
  {
    event: "e-vendor", title: "Tooling demo", summary: "Saw the demo.",
    attendees: att([["A", "a@thecontentengine.com"], ["B", "b@thecontentengine.com"], ["Rep", "rep@vendor.io"]]),
    shouldAppear: false, why: "external non-client",
  },
  {
    event: "e-nosummary", title: "Unprocessed", summary: null,
    attendees: att([["A", "a@thecontentengine.com"], ["B", "b@thecontentengine.com"], ["C", "c@thecontentengine.com"]]),
    shouldAppear: false, why: "no summary",
  },
  {
    event: "e-badjson", title: "Legacy row", summary: "Has a summary.",
    attendees: "Chris Parker; Gabriella Beer",
    shouldAppear: false, why: "attendees not a JSON array",
  },
];

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const client = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let opened = false;

  try {
    await client.query("BEGIN");
    opened = true;

    await client.query(`CREATE SCHEMA IF NOT EXISTS meetingbrain`);
    await client.query(`
      CREATE TABLE meetingbrain.processed_meeting (
        id serial PRIMARY KEY, user_id integer, calendar_event_id text,
        meeting_title text, meeting_date timestamptz, summary text,
        external_summary text, key_topics text, next_steps text,
        tasks_extracted integer DEFAULT 0, transcript text,
        local_transcript text, attendees text
      )
    `);

    console.log("\n1. Both scripts execute");
    const visSql = readFileSync("scripts/add-meeting-visibility.sql", "utf8").split(/^SELECT\s*$/m)[0];
    await client.query(visSql);
    check("add-meeting-visibility.sql (prerequisite) executes", true);

    const sql = readFileSync("scripts/add-visible-meetings-rpc.sql", "utf8")
      .replace(/NOTIFY pgrst[^;]*;/g, "");   // no PostgREST here
    try {
      await client.query(sql);
      check("add-visible-meetings-rpc.sql executes", true);
    } catch (e: any) {
      check("add-visible-meetings-rpc.sql executes", false, e.message);
      return;
    }

    console.log("\n2. The widening includes and excludes the right shapes");
    for (const f of FIXTURES) {
      await client.query(
        `INSERT INTO meetingbrain.processed_meeting
           (user_id, calendar_event_id, meeting_title, meeting_date, summary, attendees)
         VALUES (1, $1, $2, now(), $3, $4)`,
        [f.event, f.title, f.summary, f.attendees]
      );
    }
    const { rows } = await client.query(
      `SELECT * FROM meetingbrain.get_visible_meetings($1, $2, NULL, 1000)`,
      [INTERNAL, CLIENTS]
    );
    const titles = new Set(rows.map((r: any) => r.meeting_title));
    for (const f of FIXTURES) {
      check(
        `${f.shouldAppear ? "shared" : "withheld"}: ${f.why}`,
        titles.has(f.title) === f.shouldAppear,
        `"${f.title}" ${titles.has(f.title) ? "appeared" : "did not appear"}`
      );
    }

    console.log("\n3. Internal attendee names never appear — for ANY shape");
    const allAttendeeText = rows.map((r: any) => r.external_attendees || "").join(" | ");
    check("no internal name is returned", !/Chris Parker|\bA\b|\bB\b|\bC\b/.test(allAttendeeText), allAttendeeText || "(all empty)");
    check("no internal email is returned", !/thecontentengine\.com/i.test(JSON.stringify(rows)), "internal domain present in payload");
    const teamRow = rows.find((r: any) => r.meeting_title === "Weekly production standup");
    check("an internal group meeting returns NO attendee names at all",
      !teamRow?.external_attendees, JSON.stringify(teamRow?.external_attendees));
    const clientRow = rows.find((r: any) => r.meeting_title === "Acme quarterly review");
    check("a client meeting still returns the external name", clientRow?.external_attendees === "Buyer", JSON.stringify(clientRow?.external_attendees));

    console.log("\n4. Rows are labelled so EngineAI can tell them apart");
    check("client meeting labelled client_attendee + is_client_meeting",
      clientRow?.visibility_reason === "client_attendee" && clientRow?.is_client_meeting === true,
      JSON.stringify({ r: clientRow?.visibility_reason, c: clientRow?.is_client_meeting }));
    check("internal meeting labelled internal_group + NOT a client meeting",
      teamRow?.visibility_reason === "internal_group" && teamRow?.is_client_meeting === false,
      JSON.stringify({ r: teamRow?.visibility_reason, c: teamRow?.is_client_meeting }));

    console.log("\n5. One row per meeting, not one per recorder");
    await client.query(
      `INSERT INTO meetingbrain.processed_meeting
         (user_id, calendar_event_id, meeting_title, meeting_date, summary, attendees, transcript)
       VALUES (2, 'e-team', 'Weekly production standup', now(), 'Second recorder copy.', $1, 'fuller')`,
      [att([["A", "a@thecontentengine.com"], ["B", "b@thecontentengine.com"]])]
    );
    const { rows: rows2 } = await client.query(
      `SELECT meeting_title FROM meetingbrain.get_visible_meetings($1, $2, NULL, 1000)`,
      [INTERNAL, CLIENTS]
    );
    check("a second recorder does not duplicate the meeting",
      rows2.filter((r: any) => r.meeting_title === "Weekly production standup").length === 1,
      `${rows2.filter((r: any) => r.meeting_title === "Weekly production standup").length} rows`);

    console.log("\n6. Overrides still win");
    await client.query(
      `INSERT INTO meetingbrain.meeting_visibility_override (calendar_event_id, visibility, set_by)
       VALUES ('e-team', 'private', 1), ('e-1to1', 'team', 1)`
    );
    const { rows: rows3 } = await client.query(
      `SELECT meeting_title, visibility_reason FROM meetingbrain.get_visible_meetings($1, $2, NULL, 1000)`,
      [INTERNAL, CLIENTS]
    );
    const t3 = new Set(rows3.map((r: any) => r.meeting_title));
    check("an override can withdraw a team meeting", !t3.has("Weekly production standup"));
    check("an override can share a 1:1", t3.has("Catch-up"));
    check("the shared 1:1 is labelled as an override",
      rows3.find((r: any) => r.meeting_title === "Catch-up")?.visibility_reason === "override");

    console.log("\n7. An empty client-domain list does not widen");
    // get_client_meetings falls back to "any non-free-mail external attendee"
    // when the allowlist is empty. This must not inherit that.
    const { rows: rows4 } = await client.query(
      `SELECT meeting_title FROM meetingbrain.get_visible_meetings($1, $2, NULL, 1000)`,
      [INTERNAL, []]
    );
    check("with no client domains, the client meeting is NOT shared",
      !rows4.some((r: any) => r.meeting_title === "Acme quarterly review"),
      rows4.map((r: any) => r.meeting_title).join(", "));
  } finally {
    if (opened) {
      await client.query("ROLLBACK");
      console.log("\n  (rolled back — nothing persisted)");
    }
    await client.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
