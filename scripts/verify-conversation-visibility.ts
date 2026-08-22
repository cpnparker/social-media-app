/**
 * Does any conversation contradict the visibility rule the code enforces today?
 *
 * WHY THIS EXISTS. On 10 July, d34a80c shipped EngineAI Live creating every
 * meeting conversation with type_visibility 'team' — hardcoded, no condition.
 * On 23 July, e2f6888 corrected it to team-only-when-a-client-is-bound. The
 * code was then right, and nothing was.
 *
 * Twenty internal meetings had already been written team-visible: directors'
 * catchups, a finance fortnightly, one-to-ones. They stayed readable by every
 * workspace member for another four weeks, and were found by a person noticing
 * a link, not by anything in the system. No alert existed, because from the
 * code's point of view the bug was closed.
 *
 * That is the gap this closes. A privacy fix changes what happens NEXT; it says
 * nothing about what the old rule already wrote. This counts the rows that
 * disagree with the current rule, so a fix cannot look finished while a backlog
 * of exposure sits behind it.
 *
 * PRINTS NO CONTENT. Ids, counts and dates only — never a conversation title,
 * never a message. A privacy check that leaks the thing it is auditing, into a
 * terminal or a CI log, has made the problem worse.
 *
 *   npx tsx scripts/verify-conversation-visibility.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Threads deliberately left team-visible despite having no client bound.
 * Confirmed by Chris on 21 Aug 2026: the shared morning stand-up is a team
 * artefact even though it is not client work. Listed by id so an exception has
 * to be a decision someone made, not a pattern that quietly widens.
 */
const APPROVED_TEAM_WITHOUT_CLIENT = [
  "e6b21b6b-6e9e-45ea-9b3c-6a76d62740f3", // Morning meeting - Client run through
  "2d1590f3-27a3-43b2-9ec8-a73ece15919e", // Morning meeting - Client run through
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Loud, not green. A check that cannot run has not passed — reporting
    // success without credentials is how a check becomes decorative.
    console.log("\n  CANNOT RUN — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
    console.log("  This is a FAILURE, not a skip: an unrunnable privacy check must never report green.\n");
    process.exit(2);
  }
  const db = createClient(url, key, { db: { schema: "intelligence" } });

  console.log("\nRule under test: a meeting thread is team-visible ONLY when a client is bound.");

  const { data, error } = await db
    .from("ai_conversations")
    .select("id_conversation, date_created, type_conversation_mode, id_client")
    .eq("type_visibility", "team")
    .is("id_client", null)
    .eq("type_conversation_mode", "meeting");

  if (error) {
    console.log(`\n  QUERY FAILED: ${error.message}`);
    console.log("  Treated as a failure — an unverifiable state is not a safe one.\n");
    process.exit(2);
  }

  const rows = data || [];
  const unapproved = rows.filter((r: any) => !APPROVED_TEAM_WITHOUT_CLIENT.includes(String(r.id_conversation)));
  const approvedSeen = rows.length - unapproved.length;

  console.log(`  team + no client + meeting : ${rows.length}`);
  console.log(`  approved exceptions present: ${approvedSeen} of ${APPROVED_TEAM_WITHOUT_CLIENT.length}`);

  if (unapproved.length === 0) {
    console.log(`\n  ok    no unapproved internal meeting thread is workspace-readable\n`);
    process.exit(0);
  }

  console.log(`\n  FAIL  ${unapproved.length} internal meeting thread(s) are readable by the whole workspace.`);
  console.log(`        Every workspace member with EngineAI access can open these.\n`);
  for (const r of unapproved) {
    console.log(`          ${r.id_conversation}   created ${String(r.date_created).slice(0, 10)}`);
  }
  console.log(`\n        To inspect them WITHOUT printing them here, query by id in the`);
  console.log(`        Supabase SQL editor. To remediate, set type_visibility='private'`);
  console.log(`        for the ids above, or add a genuine exception to`);
  console.log(`        APPROVED_TEAM_WITHOUT_CLIENT in this file with a reason.\n`);
  process.exit(1);
}

main().catch((e) => {
  console.log(`\n  ERROR: ${e?.message || e}\n`);
  process.exit(2);
});
