/**
 * Find bad answers WITHOUT waiting for anyone to click thumbs-down.
 *
 *   npx tsx scripts/review-answer-quality.ts            # last 30 days
 *   npx tsx scripts/review-answer-quality.ts --days=90
 *   npx tsx scripts/review-answer-quality.ts --show      # print the transcripts
 *   npx tsx scripts/review-answer-quality.ts --self-test # prove the detectors fire
 *
 * WHY. Thumbs-down is too rare to steer by: 3 flags against 2,229 assistant
 * messages is 0.13%, and 99.8% of answers are unrated. Worse, it is rare in a
 * biased way — the April message that said "I fabricated those. They sounded
 * plausible but I made them up" was never rated at all. The worst answer in the
 * corpus produced no signal.
 *
 * But bad answers leave traces in ordinary message text, because the model
 * frequently ADMITS the error a turn later. Both diagnosable thumbs-down cases
 * contained an explicit retraction — "So my earlier answer was wrong", "Yes, I
 * did" — and those retractions are reachable by the same query that finds the
 * ratings. This mines them.
 *
 * THE HEADLINE NUMBER IS THE POINT. Individual hits are useful for debugging,
 * but self-corrections per 100 assistant messages is the trend line worth
 * watching — it moves when quality moves, and it needs no user to do anything.
 *
 * ON PRECISION. The first version of this counted 36 hits at 1.62%; 31 were one
 * loose pattern matching the model DOCUMENTING corrections to a client's copy
 * ("my prior correction"), not correcting itself. The honest number was 5. Every
 * pattern here is therefore anchored to first-person retraction, and --self-test
 * asserts both that each fires on a real example and that it does NOT fire on
 * the editorial-prose decoys that produced that inflation.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || "";
const has = (n: string) => process.argv.indexOf(`--${n}`) >= 0;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ─────────────── Detectors ─────────────── */

export interface Detector {
  key: string;
  what: string;
  test: (assistantText: string, priorUserText: string) => boolean;
}

/** First-person retraction. Anchored to "I"/"my" so editorial use of the word
 *  "correction" in client copy does not count. */
const SELF_CORRECTION =
  /\b(my (earlier|previous|last|first) (answer|response|reply|statement)[^.]{0,40}\b(was|is) (wrong|incorrect|mistaken))\b|\bI (was|got that|had that) wrong\b|\bI (misread|misstated|miscounted|mislabelled|mislabeled|misattributed|misremembered)\b|\bto correct myself\b|\bcorrecting myself\b|\bI apologi[sz]e[^.]{0,50}\b(wrong|mistake|error|mixed up|swapped)\b/i;

/** An admission of invention — the most serious class, and the one that got no
 *  thumbs-down when it happened. */
const FABRICATION =
  /\bI (fabricated|invented|made (them|it|that|those) up)\b|\bI made up\b|\bthose (were|are) (not real|invented|fabricated)\b/i;

/** A capability DENIED and then exercised in the same message. Case 3 turn 3
 *  is the textbook instance: "I don't actually have a way to see the organiser
 *  field … Yes — the organiser is cpiot@gavi.org." Never rated. */
// ABILITY, not possession. "I don't have a link to that article — let me search
// … here it is" is CORRECT behaviour: it lacked a datum, fetched it, delivered
// it. What matters is denying a CAPABILITY and then exercising it, which is what
// "I don't actually have a way to see the organiser field … Yes — the organiser
// is cpiot@gavi.org" does. The first version matched both and ran at 25%
// precision on this corpus.
const DENIAL =
  /\bI (don't|do not) (actually )?have (a|any) way to\b|\bI have no way to\b|\bI (don't|do not) (actually )?have the ability\b|\bI'?m not able to (see|access|read|retrieve)\b|\bI (cannot|can't) (actually )?(see|access|read|retrieve) (the|that|any)\b/i;
const THEN_DELIVERED = /\b(yes\s*[—\-–,:]|actually,? (it|the|there)|here (it is|they are)|the (organiser|answer|value) is)\b/i;

/** The user telling the model it was wrong. Their words are the cheapest
 *  ground truth in the corpus. */
const USER_REPAIR =
  /\b(that'?s (wrong|not right|incorrect))\b|\b(you (just )?(gave|got|told) me the wrong)\b|\bhave you just given me the wrong\b|\b(no,? (it|that|they)'?s not)\b|\bwrong (day|date|time|number|client|name)s?\b/i;

export const DETECTORS: Detector[] = [
  { key: "fabrication", what: "the model admits it invented something", test: (a) => FABRICATION.test(a) },
  { key: "self-correction", what: "the model retracts an earlier answer", test: (a) => SELF_CORRECTION.test(a) },
  {
    key: "denied-then-did-it",
    what: "claims a limitation, then exercises the capability in the same message",
    test: (a) => {
      const m = a.match(DENIAL);
      if (!m) return false;
      const after = a.slice(a.indexOf(m[0]) + m[0].length);
      return THEN_DELIVERED.test(after);
    },
  },
  {
    key: "user-repair",
    what: "the user says the answer was wrong",
    // Length-gated. A repair is a short reaction; a 4,000-character paste is
    // source material, and "wrong name" inside a pasted transcript is not the
    // user correcting anything. Three of the first run's hits were exactly that.
    test: (_a, prior) => prior.length > 0 && prior.length <= 300 && USER_REPAIR.test(prior),
  },
];

/* ─────────────── Self-test ─────────────── */

if (has("self-test")) {
  console.log("\nSelf-test — every detector fires on the real example, and not on the decoys");
  let bad = 0;
  const t = (name: string, ok: boolean) => {
    if (ok) console.log(`  ok    ${name}`);
    else { bad++; console.log(`  FAIL  ${name}`); }
  };
  const find = (k: string) => DETECTORS.filter((d) => d.key === k)[0];

  t("fabrication fires on the April message",
    find("fabrication").test("(complex setup steps) — **I fabricated those**. They sounded plausible but I made them up, and that was wrong of me.", ""));
  t("self-correction fires on the Carol message",
    find("self-correction").test("Yes — the organiser is **cpiot@gavi.org**, which is Carol Piot. So my earlier answer was wrong.", ""));
  t("denied-then-did-it fires on the same message",
    find("denied-then-did-it").test("I don't actually have a way to see the organiser field from that calendar entry. Let me check your calendar directly. Yes — the organiser is cpiot@gavi.org.", ""));
  t("user-repair fires on the voice transcript",
    find("user-repair").test("", "So have you just given me the wrong days when I asked you about tomorrow?"));

  // The decoys that inflated the first version of this from 5 hits to 36.
  const DECOYS = [
    'Claim: "Over 486,000" (my prior correction) → Updated to over 533,000 members.',
    "Correction: the client's style guide says sentence case.",
    "I don't have the Q3 figures to hand — shall I pull them?",
    "Here is the revised copy with corrections marked up.",
    "The report contains a correction notice on page 4.",
  ];
  let falsePositives = 0;
  for (let i = 0; i < DECOYS.length; i++) {
    for (let j = 0; j < DETECTORS.length; j++) {
      if (DETECTORS[j].key === "user-repair") continue;
      if (DETECTORS[j].test(DECOYS[i], "")) { falsePositives++; console.log(`        (${DETECTORS[j].key} matched decoy: "${DECOYS[i].slice(0, 60)}…")`); }
    }
  }
  t(`no detector fires on ${DECOYS.length} editorial decoys (${falsePositives} false positives)`, falsePositives === 0);

  if (bad) { console.log(`\n  ${bad} detector(s) do not work.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working\n");
  if (!url || !key) process.exit(0);
}

if (!url || !key) { console.log("\n  Missing Supabase credentials.\n"); process.exit(2); }
const db = createClient(url!, key!, { db: { schema: "intelligence" } });

/* ─────────────── Sweep ─────────────── */

async function main() {
  const days = Number(arg("days") || 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Every message in the window, both roles — a detector needs the user turn
  // before the assistant turn, and the user's own words are the cheapest
  // ground truth in the corpus.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("ai_messages")
      .select("id_message, id_conversation, role_message, document_message, date_created, name_model, rating_message, data_tools")
      .gte("date_created", since)
      .order("date_created", { ascending: true })
      .range(from, from + 999);
    if (error) { console.log(`\n  query failed: ${error.message}\n`); process.exit(2); }
    const batch = (data || []) as any[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }

  const assistants = rows.filter((r) => r.role_message === "assistant");
  if (!assistants.length) { console.log(`\n  No assistant messages in the last ${days} days.\n`); return; }

  // Index the preceding user message per conversation, in order.
  //
  // TIE-BREAK ON ROLE, and it is not cosmetic. Voice turns are written with the
  // SAME timestamp for the user utterance and the reply it produced — in the
  // transcript that started this review, both sit at 09:26:58.395819. Ordering
  // by date alone can place the assistant first, so its prior user message
  // resolves to the turn before, and the repair that names the error
  // ("have you just given me the wrong days?") never lands against the answer
  // it was about. That silently zeroed the user-repair detector.
  rows.sort((a, b) => {
    const d = String(a.date_created).localeCompare(String(b.date_created));
    if (d !== 0) return d;
    const rank = (x: any) => (x.role_message === "user" ? 0 : 1);
    return rank(a) - rank(b);
  });

  const priorUser = new Map<string, string>();
  const lastUserByConv = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.role_message === "user") lastUserByConv.set(r.id_conversation, r.document_message || "");
    else priorUser.set(r.id_message, lastUserByConv.get(r.id_conversation) || "");
  }

  // ONE event per message, not one per detector that fires. The Carol message
  // trips both self-correction and denied-then-did-it, and counting it twice
  // inflates the only number this script exists to report.
  const hits: { d: Detector; keys: string[]; row: any }[] = [];
  for (let i = 0; i < assistants.length; i++) {
    const r = assistants[i];
    const text = r.document_message || "";
    const prior = priorUser.get(r.id_message) || "";
    const fired: Detector[] = [];
    for (let j = 0; j < DETECTORS.length; j++) if (DETECTORS[j].test(text, prior)) fired.push(DETECTORS[j]);
    if (fired.length) hits.push({ d: fired[0], keys: fired.map((f) => f.key), row: r });
  }

  const rated = assistants.filter((r) => r.rating_message === -1);
  const per100 = (hits.length / assistants.length) * 100;

  console.log(`\n  ${days} days — ${assistants.length.toLocaleString()} assistant messages\n`);
  console.log(`  QUALITY EVENTS FOUND BY MINING : ${hits.length}   (${per100.toFixed(2)} per 100)`);
  console.log(`  thumbs-down in the same window : ${rated.length}   (${((rated.length / assistants.length) * 100).toFixed(2)} per 100)`);

  // OVERLAP IS AN INCIDENT QUESTION, NOT A MESSAGE-ID ONE.
  //
  // Comparing message ids said "zero overlap" and was technically true and
  // practically wrong: the model's retraction lands on the message AFTER the
  // answer that was flagged, so the Carol correction and the Carol answer are
  // two ids describing one incident. Counting them separately inflated the
  // headline — it reported nine distinct events across the corpus when four of
  // them were second halves of ones already flagged.
  //
  // Same conversation = same incident. Coarse, and deliberately so: a
  // conversation is a single line of enquiry, and two problems in one thread
  // are usually the same problem seen twice.
  const flaggedIds = new Set(rated.map((r) => r.id_message));
  const flaggedConvs = new Set(rated.map((r) => r.id_conversation));
  const sameMessage = hits.filter((h) => flaggedIds.has(h.row.id_message)).length;
  const sameIncident = hits.filter((h) => flaggedConvs.has(h.row.id_conversation)).length;
  const novel = hits.filter((h) => !flaggedConvs.has(h.row.id_conversation)).length;
  const incidents = flaggedConvs.size + new Set(
    hits.filter((h) => !flaggedConvs.has(h.row.id_conversation)).map((h) => h.row.id_conversation)
  ).size;
  console.log(`  same message as a flag         : ${sameMessage}`);
  console.log(`  same INCIDENT as a flag        : ${sameIncident}   (the retraction lands after the answer that was flagged)`);
  console.log(`  → ${novel} mined event(s) in threads nobody flagged at all`);
  console.log(`\n  DISTINCT INCIDENTS THIS WINDOW : ${incidents}   (vs ${rated.length} from thumbs alone)\n`);

  let multi = 0;
  for (let j = 0; j < DETECTORS.length; j++) {
    const d = DETECTORS[j];
    const n = hits.filter((h) => h.keys.indexOf(d.key) >= 0).length;
    console.log(`   ${String(n).padStart(4)}  ${d.key.padEnd(20)} ${d.what}`);
  }
  multi = hits.filter((h) => h.keys.length > 1).length;
  if (multi) console.log(`   (these sum to more than ${hits.length}: ${multi} message(s) trip several detectors and are counted once as an event)`);

  // By model — only meaningful for messages written AFTER name_model started
  // recording the model that actually ANSWERED rather than the one the route
  // chose. Before 2026-08-24 a fallback answer carries the failed model's name.
  console.log(`\n  By model (unreliable before 2026-08-24 — fallbacks logged the model that FAILED):`);
  const byModel = new Map<string, number>();
  for (let i = 0; i < hits.length; i++) {
    const m = hits[i].row.name_model || "(unrecorded)";
    byModel.set(m, (byModel.get(m) || 0) + 1);
  }
  const models = Array.from(byModel.keys()).sort((a, b) => (byModel.get(b) || 0) - (byModel.get(a) || 0));
  for (let i = 0; i < models.length; i++) console.log(`   ${String(byModel.get(models[i])).padStart(4)}  ${models[i]}`);

  if (has("show")) {
    console.log(`\n${"=".repeat(96)}\n  THE HITS\n${"=".repeat(96)}`);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      console.log(`\n[${i + 1}] ${h.d.key}  ${h.row.date_created}  ${h.row.name_model || "?"}${flaggedIds.has(h.row.id_message) ? "  (also thumbed down)" : ""}`);
      console.log(`    conv=${h.row.id_conversation}`);
      const prior = priorUser.get(h.row.id_message) || "";
      if (prior) console.log(`    ASKED: ${prior.slice(0, 200).replace(/\s+/g, " ")}`);
      console.log(`    SAID : ${(h.row.document_message || "").slice(0, 400).replace(/\s+/g, " ")}`);
      // The question a reviewer actually has. A turn that answered from nothing,
      // or that never tried the tool holding the answer, looks identical in the
      // text — this is the only place the difference shows.
      const tools = (h.row.data_tools || []) as { name: string; calls: number; blocked: number }[];
      if (tools.length) {
        const parts: string[] = [];
        for (let k = 0; k < tools.length; k++) {
          parts.push(`${tools[k].name}×${tools[k].calls}${tools[k].blocked ? ` (${tools[k].blocked} refused)` : ""}`);
        }
        console.log(`    TOOLS: ${parts.join(", ")}`);
      } else {
        console.log(`    TOOLS: ${h.row.data_tools === null || h.row.data_tools === undefined ? "not recorded (turn predates 2026-08-24)" : "NONE — answered without calling anything"}`);
      }
    }
  } else if (hits.length) {
    console.log(`\n  Re-run with --show to read them.`);
  }

  // How much of the window can even be read this way — a rate computed over
  // rows with no tool record is a rate about a different question.
  const withTools = assistants.filter((r) => r.data_tools !== null && r.data_tools !== undefined).length;
  console.log(`\n  ${withTools}/${assistants.length} message(s) carry a tool record (recording began 2026-08-24).`);
  if (withTools === 0) console.log(`  Until that covers a useful span, "answered without calling anything" cannot be told from "not recorded".`);

  console.log(`\n  Track "${per100.toFixed(2)} per 100" over time. It moves when quality moves, and needs nobody to click anything.\n`);
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
