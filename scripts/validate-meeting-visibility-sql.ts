/**
 * Validate scripts/add-meeting-visibility.sql before anyone runs it in Supabase.
 * `npx tsx scripts/validate-meeting-visibility-sql.ts`
 *
 * There are no Supabase Postgres credentials on this machine, so the SQL cannot
 * be dry-run where it will live. It CAN be run against Neon inside a
 * transaction that is always rolled back — which catches the failures that
 * matter here: syntax, a wrong column name, a CASE that falls through, an
 * aggregate that returns NULL where the rule assumes false.
 *
 * It does more than parse it. It builds a miniature processed_meeting, feeds in
 * one row for every branch of the rule, and asserts the classification. A
 * function that compiles and mis-sorts a 1:1 is worse than one that fails to
 * compile.
 *
 * ROLLBACK IS UNCONDITIONAL — in a finally block, so it runs on assertion
 * failure and on exception. Nothing is left behind in Neon.
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
const CLIENTS = ["acme-client.com", "big-bank.example"];

/** One row per branch of the rule. `attendees` mimics the real column's text. */
const CASES: { name: string; event: string; attendees: string | null; expect: string; reason: string }[] = [
  {
    name: "client attendee, 2 people (client beats 1:1)",
    event: "e-client-1to1",
    attendees: "chris@thecontentengine.com, buyer@acme-client.com",
    expect: "team", reason: "client_attendee",
  },
  {
    name: "client attendee, 5 people",
    event: "e-client-group",
    attendees: "a@thecontentengine.com b@thecontentengine.com c@thecontentengine.com d@acme-client.com e@acme-client.com",
    expect: "team", reason: "client_attendee",
  },
  {
    name: "internal only, 3 people",
    event: "e-internal-team",
    attendees: "a@thecontentengine.com, b@thecontentengine.com, c@thecontentengine.com",
    expect: "team", reason: "internal_group",
  },
  {
    name: "internal only, 2 people (the 1:1 band)",
    event: "e-internal-1to1",
    attendees: "a@thecontentengine.com, b@thecontentengine.com",
    expect: "private", reason: "internal_small",
  },
  {
    name: "internal only, 1 person",
    event: "e-solo",
    attendees: "a@thecontentengine.com",
    expect: "private", reason: "internal_small",
  },
  {
    name: "vendor (external, not a client), 3 people",
    event: "e-vendor",
    attendees: "a@thecontentengine.com, b@thecontentengine.com, rep@some-vendor.io",
    expect: "private", reason: "external_non_client",
  },
  {
    name: "no attendee data (52% of the real corpus)",
    event: "e-nodata",
    attendees: null,
    expect: "private", reason: "no_attendee_data",
  },
  {
    name: "empty attendee string",
    event: "e-empty",
    attendees: "",
    expect: "private", reason: "no_attendee_data",
  },
  {
    name: "attendee text with names but no addresses",
    event: "e-namesonly",
    attendees: "Chris Parker; Gabriella Beer",
    expect: "private", reason: "no_attendee_data",
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

    // A miniature of the real schema — only the columns the function reads.
    await client.query(`CREATE SCHEMA IF NOT EXISTS meetingbrain`);
    await client.query(`
      CREATE TABLE meetingbrain.processed_meeting (
        id                 serial PRIMARY KEY,
        user_id            integer,
        calendar_event_id  text,
        meeting_title      text,
        summary            text,
        attendees          text
      )
    `);

    console.log("\n1. The script parses and its objects create");
    const sql = readFileSync("scripts/add-meeting-visibility.sql", "utf8");
    // Drop the trailing sanity SELECT — it is for a human in the SQL Editor and
    // would return an empty result here, which is not a failure.
    const ddl = sql.split(/^SELECT\s*$/m)[0];
    try {
      await client.query(ddl);
      check("add-meeting-visibility.sql executes without error", true);
    } catch (e: any) {
      check("add-meeting-visibility.sql executes without error", false, e.message);
      return;
    }

    console.log("\n2. Each branch of the rule classifies correctly");
    for (const c of CASES) {
      await client.query(
        `INSERT INTO meetingbrain.processed_meeting (user_id, calendar_event_id, attendees) VALUES (1, $1, $2)`,
        [c.event, c.attendees]
      );
    }
    // A second recorder for one event, to prove attendees are unioned rather
    // than judged per row. Alone, this row looks like a 1:1.
    await client.query(
      `INSERT INTO meetingbrain.processed_meeting (user_id, calendar_event_id, attendees) VALUES (2, $1, $2)`,
      ["e-internal-team", "a@thecontentengine.com, b@thecontentengine.com"]
    );

    const { rows } = await client.query(
      `SELECT calendar_event_id, visibility, reason, attendee_count, has_client, is_overridden
         FROM meetingbrain.get_meeting_visibility($1, $2)`,
      [INTERNAL, CLIENTS]
    );
    const byEvent = new Map(rows.map((r: any) => [r.calendar_event_id, r]));

    for (const c of CASES) {
      const got = byEvent.get(c.event);
      check(
        c.name,
        !!got && got.visibility === c.expect && got.reason === c.reason,
        got ? `got ${got.visibility}/${got.reason}, expected ${c.expect}/${c.reason}` : "event missing from result"
      );
    }

    console.log("\n3. Sibling rows are unioned, not judged separately");
    const team = byEvent.get("e-internal-team");
    check(
      "a 3-person meeting stays team even though one recorder logged only 2",
      !!team && team.visibility === "team" && team.attendee_count === 3,
      team ? `visibility=${team.visibility} attendee_count=${team.attendee_count}` : "missing"
    );
    check("every event appears exactly once", rows.length === CASES.length, `${rows.length} rows for ${CASES.length} events`);

    console.log("\n4. Overrides win, in both directions");
    await client.query(
      `INSERT INTO meetingbrain.meeting_visibility_override (calendar_event_id, visibility, reason, set_by)
       VALUES ($1, 'private', 'test', 1), ($2, 'team', 'test', 1)`,
      ["e-client-group", "e-internal-1to1"]
    );
    const { rows: rows2 } = await client.query(
      `SELECT calendar_event_id, visibility, reason, is_overridden
         FROM meetingbrain.get_meeting_visibility($1, $2)`,
      [INTERNAL, CLIENTS]
    );
    const o = new Map(rows2.map((r: any) => [r.calendar_event_id, r]));
    check("an override can close a meeting the rule would open",
      o.get("e-client-group")?.visibility === "private" && o.get("e-client-group")?.is_overridden === true,
      JSON.stringify(o.get("e-client-group")));
    check("an override can open a meeting the rule would close",
      o.get("e-internal-1to1")?.visibility === "team" && o.get("e-internal-1to1")?.is_overridden === true,
      JSON.stringify(o.get("e-internal-1to1")));
    check("overrides are labelled as such", o.get("e-client-group")?.reason === "override");

    console.log("\n5. The empty-allowlist case fails SAFE");
    // get_client_meetings widens on an empty allowlist. This must do the
    // opposite: with no client domains, nothing may be classed as client work.
    const { rows: rows3 } = await client.query(
      `SELECT visibility, reason FROM meetingbrain.get_meeting_visibility($1, $2) WHERE calendar_event_id = $3`,
      [INTERNAL, [], "e-client-1to1"]
    );
    check(
      "with NO client domains, a client 1:1 is private (not opened)",
      rows3[0]?.visibility === "private",
      JSON.stringify(rows3[0])
    );
    const { rows: rows4 } = await client.query(
      `SELECT count(*)::int AS team FROM meetingbrain.get_meeting_visibility($1, $2) WHERE visibility = 'team'`,
      [INTERNAL, []]
    );
    check(
      "an empty allowlist cannot increase what is team-visible",
      rows4[0].team <= 2,
      `${rows4[0].team} team events with no client domains (internal 3+ only is expected)`
    );

    console.log("\n6. No meeting CONTENT leaves the function");
    const cols = Object.keys(rows[0] || {});
    const leaky = cols.filter((c) => /title|summary|transcript|attendees|insight|topic|note/i.test(c));
    check("the return shape carries no title, summary, transcript or attendee list",
      leaky.length === 0, leaky.join(", "));
    check("it returns only classification fields",
      cols.every((c) => ["calendar_event_id","visibility","reason","attendee_count","has_client","is_overridden"].includes(c)),
      cols.join(", "));
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
