/**
 * Live verification of intelligence.ai_episodes — `npx tsx scripts/verify-episodes-live.ts`
 *
 * Run AFTER scripts/add-episodic-memory.sql, and specifically after enabling
 * RLS on the table, because RLS is the one change that fails SILENTLY in the
 * direction that matters: a policy-less table returns ZERO ROWS AND NO ERROR to
 * a non-bypassing role. The ledger would simply be empty for ever, capture
 * would look like it had nothing worth recording, and no log line anywhere
 * would say otherwise.
 *
 * So this asserts BOTH directions, which is the whole point:
 *   - the service role (the server) can read and write;
 *   - the anon key (a browser) cannot read a single row.
 *
 * A memory table holds one person's working history. "Probably fine, it uses
 * the service role" is not a security position — the anon check below is.
 *
 * Writes ONE row and deletes it. Cleanup runs even on failure.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(URL, SERVICE, { db: { schema: "intelligence" } });
const anonDb = ANON ? createClient(URL, ANON, { db: { schema: "intelligence" } }) : null;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Every column lib/ai/episodes.ts names, in the order it names them. */
const SELECTED_BY_CODE = [
  "id_episode",
  "date_episode",
  "information_episode",
  "information_open",
  "type_status",
  "data_entities",
  "id_conversation_source",
];

/** Every column the writer sets. A missing one fails the INSERT, not the read. */
const WRITTEN_BY_CODE = [
  "id_workspace",
  "user_episode",
  "id_conversation_source",
  "date_episode",
  "information_episode",
  "information_open",
  "type_status",
  "data_entities",
  "type_source",
  "count_turns",
  "date_updated",
];

async function main() {
  let createdId: string | null = null;

  try {
    // ── 1. The table exists and the server can read it ──
    console.log("\n1. Service-role read");
    const { data: probe, error: probeErr } = await db
      .from("ai_episodes")
      .select(SELECTED_BY_CODE.join(", "))
      .limit(1);
    check(
      "table readable with the service role",
      !probeErr,
      probeErr ? `${probeErr.code}: ${probeErr.message}` : undefined
    );
    check(
      "every column the READ path names exists",
      !probeErr || !/column .* does not exist/i.test(probeErr.message),
      probeErr?.message
    );
    if (probeErr) {
      console.log("\n  Cannot continue — the read path is broken. Nothing was written.");
      return;
    }
    console.log(`    (${probe?.length ?? 0} existing row(s) visible)`);

    // ── 2. A real round trip ──
    // Deliberately BEFORE the RLS checks. Both anon probes below were
    // previously vacuous and reported success anyway:
    //
    //   The READ probe passed whenever the table was EMPTY — no error, zero
    //   rows, indistinguishable from RLS doing its job. On a fresh install it
    //   could not have failed.
    //
    //   The WRITE probe inserted id_conversation_source "00000000-…", which
    //   violates the NOT NULL foreign key to ai_conversations. Postgres
    //   rejects that before RLS is ever consulted, so the probe returned an
    //   error — and the assertion read that error as "blocked by RLS". It
    //   would have passed on a table with RLS switched off entirely.
    //
    // So a row must exist first, and the write probe must use a VALID
    // conversation id, or neither check is evidence of anything.
    console.log("\n2. Write / read / update round trip");
    const { data: conv, error: convErr } = await db
      .from("ai_conversations")
      .select("id_conversation, id_workspace, user_created")
      .order("date_created", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (convErr || !conv) {
      check("a conversation exists to attach an episode to", false, convErr?.message || "none found");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const row: Record<string, any> = {
      id_workspace: (conv as any).id_workspace,
      user_episode: (conv as any).user_created,
      id_conversation_source: (conv as any).id_conversation,
      date_episode: today,
      information_episode: "VERIFICATION ROW — safe to delete",
      information_open: "nothing",
      type_status: "resolved",
      data_entities: ["VerificationOnly"],
      type_source: "inferred",
    };

    const { data: ins, error: insErr } = await db.from("ai_episodes").insert(row).select("id_episode").maybeSingle();
    check("insert succeeds with the service role", !insErr && !!ins, insErr ? `${insErr.code}: ${insErr.message}` : undefined);
    if (insErr || !ins) return;
    createdId = (ins as any).id_episode;

    // Every written column must exist, or the insert above would have failed —
    // but check them by name too, so a missing one is NAMED rather than
    // hiding inside a generic PostgREST message.
    const { data: full, error: fullErr } = await db
      .from("ai_episodes")
      .select(WRITTEN_BY_CODE.join(", "))
      .eq("id_episode", createdId)
      .maybeSingle();
    check("every column the WRITE path sets exists", !fullErr, fullErr?.message);
    if (full) {
      check("count_turns defaults to 1", (full as any).count_turns === 1, String((full as any).count_turns));
      check("data_entities round-trips as an array", Array.isArray((full as any).data_entities), JSON.stringify((full as any).data_entities));
    }

    // ── 3. RLS actually protects it from a browser ──
    // Now meaningful: a row exists, so an empty result is RLS, not emptiness;
    // and the write probe uses the real conversation id, so a rejection is RLS
    // or grants rather than the foreign key.
    console.log("\n3. Anon-key lockout (this is what RLS is for)");
    if (!anonDb) {
      check("anon key present to test with", false, "NEXT_PUBLIC_SUPABASE_ANON_KEY not set locally");
    } else {
      const { data: anonRows, error: anonErr } = await anonDb
        .from("ai_episodes").select("id_episode").eq("id_episode", createdId);
      check(
        "anon key cannot read an episode that DEMONSTRABLY EXISTS",
        !!anonErr || (anonRows?.length ?? 0) === 0,
        anonErr ? `blocked with ${anonErr.code}` : `RETURNED ${anonRows?.length} ROW(S)`
      );

      // A valid FK, a valid workspace, a valid user — everything Postgres
      // could legitimately reject on is satisfied, so only RLS or table grants
      // can stop this. Uses tomorrow's date to avoid colliding with the
      // one-per-day unique constraint, which would be another false pass.
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const { error: anonWriteErr } = await anonDb.from("ai_episodes").insert({
        id_workspace: (conv as any).id_workspace,
        user_episode: (conv as any).user_created,
        id_conversation_source: (conv as any).id_conversation,
        date_episode: tomorrow,
        information_episode: "rls probe — should never be written",
      });
      check(
        "anon key cannot write episodes",
        !!anonWriteErr,
        anonWriteErr
          ? `blocked with ${anonWriteErr.code}`
          : "INSERT SUCCEEDED — anyone with the public anon key can write episodes"
      );
      // If it DID write, it is cleaned up in the finally block by marker.
      if (anonWriteErr && /23503|23505/.test(anonWriteErr.code || "")) {
        check(
          "the write was blocked by RLS/grants, not by a constraint",
          false,
          `got ${anonWriteErr.code} (foreign key / unique) — this probe is not testing RLS`
        );
      }
    }

    // ── 4. The one-per-day constraint ──
    console.log("\n4. Constraints");
    const { error: dupeErr } = await db.from("ai_episodes").insert(row);
    check(
      "a second episode for the same person/conversation/day is rejected",
      !!dupeErr && dupeErr.code === "23505",
      dupeErr ? `${dupeErr.code}` : "DUPLICATE WAS ACCEPTED — the unique constraint is missing"
    );

    const { error: fkErr } = await db.from("ai_episodes").insert({
      ...row,
      id_conversation_source: "00000000-0000-0000-0000-000000000000",
      date_episode: "1970-01-02",
    });
    check(
      "an episode cannot reference a conversation that does not exist",
      !!fkErr && fkErr.code === "23503",
      fkErr ? `${fkErr.code}` : "ORPHAN ACCEPTED — the foreign key is missing"
    );

    const { error: updErr } = await db
      .from("ai_episodes")
      .update({ count_turns: 2, date_updated: new Date().toISOString() })
      .eq("id_episode", createdId);
    check("in-day update succeeds", !updErr, updErr?.message);

    // ── 5. The actual application path ──
    console.log("\n5. recentEpisodes() + formatEpisodeLedger()");
    const { recentEpisodes, formatEpisodeLedger } = await import("../lib/ai/episodes");
    const mine = await recentEpisodes((conv as any).user_created, (conv as any).id_workspace);
    check("recentEpisodes() returns the row it just wrote", mine.some((e) => e.idEpisode === createdId), `got ${mine.length} row(s)`);

    const excluded = await recentEpisodes((conv as any).user_created, (conv as any).id_workspace, (conv as any).id_conversation);
    check(
      "the current conversation is excluded from its own ledger",
      !excluded.some((e) => e.idEpisode === createdId)
    );

    const ledger = formatEpisodeLedger(mine);
    check("the ledger renders a non-empty block", ledger.length > 0);
    // Only the DATE LINES. The surrounding instruction prose contains the word
    // "today" on purpose — it is what tells the model not to treat a past
    // episode as current — and an earlier version of this check failed on its
    // own instructions rather than on any rendered date.
    const dateLines = ledger.split("\n").filter((l) => l.startsWith("- "));
    check(
      "date lines render absolute, never relative",
      dateLines.length > 0 && !dateLines.some((l) => /\bago\b|yesterday|tomorrow|last week/i.test(l)),
      dateLines[0]
    );
    check("an empty ledger renders as an empty string", formatEpisodeLedger([]) === "");
    if (ledger) {
      const line = ledger.split("\n").find((l) => l.includes("VERIFICATION ROW")) || "";
      console.log(`    rendered: ${line.trim().slice(0, 100)}`);
    }
  } finally {
    if (createdId) {
      const { error } = await db.from("ai_episodes").delete().eq("id_episode", createdId);
      console.log(error ? `\n  ! CLEANUP FAILED for ${createdId}: ${error.message}` : `\n  cleaned up ${createdId}`);
    }
    // Belt and braces: remove anything this script could have written, by its
    // unmistakable marker. A verification script that leaves rows behind in a
    // memory table is worse than no verification script.
    await db.from("ai_episodes").delete().eq("information_episode", "VERIFICATION ROW — safe to delete");
    await db.from("ai_episodes").delete().eq("information_episode", "rls probe — should never be written");

    console.log(`\n${pass} passed, ${fail} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(fail ? 1 : 0);
  }
}

main();
