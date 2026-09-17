/**
 * One tool loop, shared by all four provider chains.
 * Run with `npx tsx scripts/verify-tool-loop-guard.ts --self-test`.
 *
 * WHY THIS EXISTS. Until 2026-08-24 there were three implementations: the
 * factory in lib/ai/tool-loop-guard.ts, used by Gemini and OpenAI, and two
 * hand-copied inline loops in streamAnthropic and streamXAIChatCompletions.
 * The module's own docstring promised the four "cannot drift on wording again"
 * because they shared the refusal text — and they drifted on NUMBERS instead:
 * the inline copies carried query_gmail 8, query_slack 8, query_calendar 6 and
 * query_microsoft 6, and the shared table carried none of them. Gmail, calendar
 * and Microsoft are Claude-only so they never registered on the divergent
 * chains, but query_slack is not, and it ran there on a third of its intended
 * budget with nothing to show for it.
 *
 * Sharing constants was not enough. They now share the LOOP.
 *
 * The two inline copies existed for one reason the factory could not serve: a
 * retryable failure has to un-record the call signature, or an honest identical
 * retry is refused as a spiral. That is release(), and it is asserted here.
 *
 * usage() is what makes a flagged answer reviewable: names and counts, never
 * arguments and never results, so the record stays free of third-party text.
 *
 * ADDED 2026-09-16, from thumbs-down #7 (docs/feedback-review.md, review 2):
 *
 *   - WHOSE LIMIT WAS HIT. All three refusals — the two here and
 *     postTaintRefusal in providers.ts — must carry DO_NOT_BLAME_THE_SOURCE
 *     verbatim. The flagged turn spent its query_meetingbrain budget and told
 *     the user a meeting had "(no recording)" when the transcript is 28,563
 *     characters long. Asserted as an exact substring and never as a regex
 *     three differently-worded strings could each satisfy while drifting.
 *     AND WHICH REFUSAL GETS WHICH HALF. The first draft carried one merged
 *     clause into all four branches and pinned it there, and in two of them its
 *     opening sentence was false: a duplicate-signature refusal reached
 *     everything, and a post-taint refusal of generate_slides reached no source
 *     at all. Telling those two to "say the lookup was cut short" instructs
 *     exactly the invented statement this work exists to remove.
 *   - THE CUT-SHORT NOTICE, and the counter split that drives it. Only an
 *     OVER-BUDGET refusal is a hole in the answer; a duplicate-signature
 *     refusal costs the user nothing, and announcing it would cry wolf.
 *   - withoutRoundNarration, the persist-time filter: what the transcript
 *     keeps when a round narrated a plan and then called a tool.
 *   - WIRING, PER CHAIN. Section 8's global count of toolLoopGuard.usage() was
 *     RED at HEAD — it expected 4 and found 16, because the notices added
 *     since each call it — and a global count says nothing about which chain
 *     is missing a line. Four sliced bodies, asserted one at a time.
 *
 * MUTATION LOG (detached worktree, 2026-09-16; each applied alone and restored):
 *   KILLED  the clause dropped from overBudgetNotice → 10 red
 *   KILLED  the clause dropped from repeatedCallNotice → 10 red
 *   KILLED  the clause dropped from postTaintRefusal's read branch → 10 red
 *   KILLED  the clause weakened to two forbidden words → 10 red, on the three
 *           words it stopped naming
 *   KILLED  cutShortLookupNotice reading blockedRepeat → 11 red (and check 38h)
 *   CORRECTED  "the data-source gate removed from dataSubject → killed" was
 *           recorded here and in check 38's log, and re-running it alone shows
 *           it SURVIVES. The gate it names — the `known.service === "document"`
 *           line — is unreachable: no generator in the map carries a `subject`,
 *           so `if (!known || !known.subject) return null` above it has already
 *           answered. It is a second lock on a door the first lock holds shut,
 *           kept for the entry somebody adds later with a subject copied from
 *           the row above, and lib/ai/tool-activity.ts now says so in place.
 *           The mutation that IS killed — 11 red, and 38h red on all four
 *           chains with "a tool nobody mapped produced a sentence about what
 *           the turn failed to read" — is removing the `!known.subject` guard.
 *   KILLED  a duplicate refusal incrementing both counters → 12 red
 *   KILLED  narrationSpans.push deleted from the Anthropic chain → 13 red, and
 *           it names that chain: "streamAnthropic pushes 0 narration spans"
 *   KILLED  the cut-short hook deleted from the Gemini chain → 13 red, Gemini
 *           named, where a whole-file count of four would have stayed green
 *   KILLED  the messages route saving fullText again → 13 red at both sites
 *   SURVIVOR  withoutRoundNarration's clamping of a reversed span. The unit at
 *             9 pins it and nothing else does, because no chain can produce
 *             one: it guards a future chain rather than today's. Kept, and
 *             recorded as a property of the check rather than tidied away.
 *
 * SECOND MUTATION LOG (detached worktree, 2026-09-16), after verifiers drove
 * the persist filter through check 38h's own transport and found it deleting
 * ANSWERS: any text a round wrote went whenever that round ended in tool calls,
 * including a complete briefing, a text block emitted after the tool_use block,
 * and half a numbered list. The rule is now BOUNDED — a span is cut only when
 * it is smaller than what survives it, and the deterministic end-of-turn
 * notices do not count as survivors.
 *   KILLED  the bound removed → 4 red at 9 ("a 184-char answer above \"Done.\"
 *           was cut to \"Done.\"", and the monotonicity unit), plus five
 *           scenarios per chain in 38h
 *   KILLED  the `spokenText.length` boundary dropped from one chain → 13 red,
 *           naming that chain, and 38h red on the two turns whose answers are
 *           shorter than the notice under them
 *   KILLED  the merged clause restored (OUR_LIMIT_CUT_IT_SHORT folded back into
 *           DO_NOT_BLAME_THE_SOURCE and both dropped from the two branches
 *           where they are false) → 5 red at 10
 *   KILLED  scripts/review-answer-quality.ts reading `blocked` alone → 13 red.
 *           IT IS THE ONE READER, and it is the instrument review 2 was written
 *           from: the split was written up as safe because nothing read the
 *           field, and the cast there is hand-written over an `any` column, so
 *           tsc stayed green while "(3 refused)" disappeared from every new row
 *   KILLED  web_search given back its subject while its budget is the default 3
 *
 * MUTATION LOG (detached worktree, 2026-09-16, item 4 — the budget raise):
 *   KILLED  query_meetingbrain returned to 6 while section 1 pins 8 → red
 *   KILLED  the budget raised to 6 for web_search WITHOUT giving its subject
 *           back in lib/ai/tool-activity.ts → check 11 red, naming the file it
 *           is missing from. This is the half that matters: the pair was only
 *           ever proved in one direction, and an item-4 change that raised the
 *           cap and forgot the subject would have left the notice silent on
 *           the one tool the raise was meant to make honest.
 *           → 11 red: a fourth distinct search would end the reply on a warning
 *   KILLED  the closing line's guarantee restored ("and it will be fetched")
 *           → 11 red
 *   KILLED  the backstop deleted → 9 red on the whitespace-only survivor, which
 *           is now the ONLY thing that reaches it: the bound gets to the
 *           everything-is-in-a-span case first, because nothing clears a bar of
 *           zero. Recorded in check 38's log too, where that scenario used to
 *           be the backstop's proof and no longer is.
 */
import { readFileSync } from "fs";
import {
  createToolLoopGuard,
  toolBudgetFor,
  repeatedCallNotice,
  overBudgetNotice,
  cutShortLookupNotice,
  DO_NOT_BLAME_THE_SOURCE,
  OUR_LIMIT_CUT_IT_SHORT,
  type ToolUsage,
} from "../lib/ai/tool-loop-guard";
import { withoutRoundNarration } from "../lib/ai/round-text";
import { dataSubject } from "../lib/ai/tool-activity";
import { postTaintRefusal } from "../lib/ai/providers";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. The budgets every chain now sees");
const EXPECTED: [string, number][] = [
  ["query_xero", 8], ["query_engine", 8], ["query_resourcing", 8],
  ["query_gmail", 8], ["query_slack", 8],
  ["query_meetingbrain", 8], ["query_drive_docs", 6], ["search_notebook", 6],
  ["query_calendar", 6], ["query_microsoft", 6], ["web_search", 6],
  ["generate_image", 3], ["a_tool_that_does_not_exist", 3],
];
for (let i = 0; i < EXPECTED.length; i++) {
  const [name, want] = EXPECTED[i];
  const got = toolBudgetFor(name);
  got === want ? pass(`${name} → ${got}`) : fail(`${name} → ${got}, expected ${want}`);
}

console.log("\n2. The same call twice is refused, and says why");
{
  const g = createToolLoopGuard();
  g.blockFor("query_engine", { report: "contracts_summary" }) === null
    ? pass("first call runs")
    : fail("first call was refused");
  const second = g.blockFor("query_engine", { report: "contracts_summary" });
  second === repeatedCallNotice("query_engine")
    ? pass("identical second call gets the repeated-call notice")
    : fail(`identical second call returned ${String(second).slice(0, 60)}`);
}

console.log("\n3. Different arguments run until the budget is spent");
{
  const g = createToolLoopGuard();
  const budget = toolBudgetFor("query_meetingbrain"); // 8
  let allowed = 0;
  for (let i = 0; i < budget; i++) if (g.blockFor("query_meetingbrain", { q: `q${i}` }) === null) allowed++;
  allowed === budget ? pass(`${budget} distinct calls all ran`) : fail(`only ${allowed} of ${budget} ran`);
  const over = g.blockFor("query_meetingbrain", { q: "one too many" });
  over === overBudgetNotice("query_meetingbrain")
    ? pass("the next one gets the over-budget notice")
    : fail(`over-budget call returned ${String(over).slice(0, 60)}`);
}

console.log("\n4. A repeat is reported as a repeat even when over budget");
// Precedence matters: both inline copies checked the signature FIRST, so a
// duplicate past the budget said "you already called this" rather than "too
// many calls". Telling the model the wrong thing sends it down the wrong path.
{
  const g = createToolLoopGuard();
  for (let i = 0; i < toolBudgetFor("search_notebook"); i++) g.blockFor("search_notebook", { q: `q${i}` });
  const dup = g.blockFor("search_notebook", { q: "q0" });
  dup === repeatedCallNotice("search_notebook")
    ? pass("duplicate wins over budget, as both inline copies did")
    : fail("an over-budget duplicate reported the budget message instead");
}

console.log("\n5. release() — the reason the inline copies existed");
{
  const g = createToolLoopGuard();
  const args = { prompt: "a cat" };
  g.blockFor("generate_image", args);
  const beforeRelease = g.blockFor("generate_image", args);
  beforeRelease !== null ? pass("without release, an identical retry is refused") : fail("a duplicate slipped through");
  g.release("generate_image", args);
  g.blockFor("generate_image", args) === null
    ? pass("after release, an honest retry of a FAILED call runs")
    : fail("release did not permit the retry — image failures would tell the model to give up");
}

console.log("\n6. release() does NOT refund the call count");
// A tool failing over and over must still exhaust its budget, or a broken tool
// becomes an infinite loop with extra steps.
{
  const g = createToolLoopGuard();
  const budget = toolBudgetFor("generate_image"); // 3
  for (let i = 0; i < budget + 2; i++) {
    g.blockFor("generate_image", { prompt: "same" });
    g.release("generate_image", { prompt: "same" });
  }
  const after = g.blockFor("generate_image", { prompt: "same" });
  after === overBudgetNotice("generate_image")
    ? pass("repeated failures still run out of budget")
    : fail("release refunded the count — a failing tool could retry for ever");
}

console.log("\n7. usage() — names and counts, never arguments or results");
{
  const g = createToolLoopGuard();
  g.blockFor("query_engine", { report: "a" });
  g.blockFor("query_engine", { report: "b" });
  g.blockFor("query_engine", { report: "a" });            // duplicate → blocked
  g.blockFor("query_slack", { q: "ceri" });
  const u = g.usage();
  const engine = u.filter((x) => x.name === "query_engine")[0];
  const slack = u.filter((x) => x.name === "query_slack")[0];
  u.length === 2 ? pass("two tools reported") : fail(`${u.length} tools reported, expected 2`);
  engine && engine.calls === 3 ? pass("query_engine calls=3 (attempts, including the refused one)") : fail(`query_engine calls=${engine?.calls}`);
  engine && engine.blockedRepeat === 1 && engine.blockedBudget === 0 ? pass("query_engine blockedRepeat=1 blockedBudget=0") : fail(`query_engine blockedRepeat=${engine?.blockedRepeat} blockedBudget=${engine?.blockedBudget}`);
  slack && slack.calls === 1 && slack.blockedRepeat === 0 && slack.blockedBudget === 0 ? pass("query_slack calls=1, neither counter moved") : fail("query_slack miscounted");
  const serialised = JSON.stringify(u);
  serialised.indexOf("ceri") < 0 && serialised.indexOf("report") < 0
    ? pass("no arguments leak into the record")
    : fail(`usage() carries argument text: ${serialised.slice(0, 120)}`);
  // A tool never called must be ABSENT, not zero — absence is the signal that
  // answers "was a tool that could have answered simply never tried?"
  u.filter((x) => x.name === "query_calendar").length === 0
    ? pass("an uncalled tool is absent, not reported as zero")
    : fail("an uncalled tool appears in usage()");
}

console.log("\n8. No chain keeps its own copy any more");
// Absence cannot be tested behaviourally: a duplicated loop would pass every
// assertion above while quietly diverging again, which is exactly what happened.
const providers = readFileSync("lib/ai/providers.ts", "utf8");
const factories = (providers.match(/createToolLoopGuard\(\)/g) || []).length;
factories === 4
  ? pass("all four chains build a guard from the factory")
  : fail(`${factories} createToolLoopGuard() calls — expected one per chain (anthropic, xai, gemini, openai)`);
providers.indexOf("const executedToolSigs") < 0
  ? pass("no inline signature set remains")
  : fail("a chain still keeps its own executedToolSigs — the copies can drift again");
providers.indexOf("READ_ONLY_TOOL_BUDGET: Record<string, number>") < 0
  ? pass("no inline budget table remains")
  : fail("a chain still keeps its own budget table — this is exactly how query_slack ended up at 3 on two chains");

console.log("\n9. withoutRoundNarration — what the transcript keeps");
// The flagged turn's shape: three plan paragraphs, one per tool round, then the
// answer. Each paragraph lives in a round that ENDED in tool calls, so each is
// a span, and what is saved is what is left.
{
  const cut = (full: string, spans: { start: number; end: number }[] | null) => withoutRoundNarration(full, spans);
  const full = "I'll pull the contract.\n\nPulled it.\n\nContract 255 runs 17 Sep–30 Dec.";
  const plan = { start: 0, end: full.indexOf("Pulled it.") };
  cut(full, [plan]) === "Pulled it.\n\nContract 255 runs 17 Sep–30 Dec."
    ? pass("a leading narration span is cut, and the answer keeps its own shape")
    : fail(`cut left ${JSON.stringify(cut(full, [plan]).slice(0, 60))}`);
  cut(full, []) === full ? pass("no spans is the identity") : fail("an empty span list changed the text");
  cut(full, null) === full ? pass("a null span list is the identity") : fail("a null span list changed the text");
  // Two spans, out of order, and the text appended AFTER the last one survives
  // — this is the artefact case: the executors append image markdown, a deck
  // link and a download link after a round's text ends.
  const two = "AAA" + "BBB" + "CCC" + "DDD";
  const out = cut(two, [{ start: 6, end: 9 }, { start: 0, end: 3 }]);
  out === "BBBDDD" ? pass("two spans out of order are both cut, and what follows survives") : fail(`two spans left ${JSON.stringify(out)}`);
  // Offsets a future chain could get wrong: reversed, negative, past the end,
  // overlapping. None may throw, and none may cut what it does not cover.
  cut(two, [{ start: 9, end: 3 }]) === two ? pass("a reversed span cuts nothing") : fail("a reversed span sliced the text");
  cut(two, [{ start: -50, end: 3 }]) === "BBBCCCDDD" ? pass("a negative start is clamped to 0") : fail(`negative start left ${JSON.stringify(cut(two, [{ start: -50, end: 3 }]))}`);
  cut(two, [{ start: 9, end: 9999 }]) === "AAABBBCCC" ? pass("an end past the text is clamped to its length") : fail("an over-long end mis-sliced");
  // Overlap, with a tail long enough that the bound below is not what decides
  // it: the union goes, and the "BBB" between the two starts does not survive
  // by being in the gap.
  const overlap = "AAABBBCCC" + "DDDDDDDDDDDDDDDDDDDD";
  cut(overlap, [{ start: 0, end: 6 }, { start: 3, end: 9 }]) === "DDDDDDDDDDDDDDDDDDDD"
    ? pass("overlapping spans cut their union, not the gap between them")
    : fail(`overlap left ${JSON.stringify(cut(overlap, [{ start: 0, end: 6 }, { start: 3, end: 9 }]))}`);
  // THE BACKSTOP. A turn whose LAST round ends in tool calls — the loop hitting
  // MAX_TOOL_ROUNDS, or a forced final that failed — has every word inside a
  // span. A blank row against a screen the user watched fill up is far worse
  // than a saved plan paragraph.
  cut(full, [{ start: 0, end: full.length }]) === full
    ? pass("spans that swallow everything return the full text — a turn never saves a blank row")
    : fail("a turn whose whole text was pre-tool would persist as empty");
  cut("   \n\n  ", [{ start: 0, end: 3 }]) === "   \n\n  " ? pass("whitespace-only survivors count as blank and trip the backstop") : fail("a whitespace-only survivor was saved as the answer");
}

// THE BOUND. "Pre-tool" is true of a round's text whatever it holds, and the
// first version of this filter cut all of it. Driven against the four chains it
// deleted answers: a 237-character briefing that ended in a lookup was reduced
// to the next round's "Done."; a numbered list split across a round was saved
// starting at item 3. And it was not monotone — the identical turn with a
// SILENT last round kept everything through the backstop, so adding "Done." was
// what deleted the answer. A span is now cut only when it is SMALLER than what
// survives it.
{
  const cut = (full: string, spans: { start: number; end: number }[], end?: number) => withoutRoundNarration(full, spans, end);
  const PLAN = "I'll pull the contract and the meeting records first.";
  const BRIEFING =
    "Contract 255 runs 17 September to 30 December, 12 CU commissioned and none drawn down yet. " +
    "The kick-off sits on the 22nd with Thomas and Gary, and the September plan row is still open.";
  const SIGNOFF = "Done.";
  // The flagged turn: a plan above an answer many times its length.
  const flagged = `${PLAN}\n\n${BRIEFING}`;
  cut(flagged, [{ start: 0, end: PLAN.length + 2 }]) === BRIEFING
    ? pass("a plan paragraph above a much longer answer is still cut — the incident's own shape")
    : fail(`the flagged shape kept ${JSON.stringify(cut(flagged, [{ start: 0, end: PLAN.length + 2 }]).slice(0, 60))}`);
  // The shape that made this a bound: the round did the work and THEN reached
  // for one more tool, and the next round only signed off.
  const worked = `${BRIEFING}\n\n${SIGNOFF}`;
  cut(worked, [{ start: 0, end: BRIEFING.length + 2 }]) === worked
    ? pass("an answer larger than what follows it is kept, not reduced to the sign-off")
    : fail(`a ${BRIEFING.length}-char answer above "${SIGNOFF}" was cut to ${JSON.stringify(cut(worked, [{ start: 0, end: BRIEFING.length + 2 }]).slice(0, 60))}`);
  // MONOTONE. The same turn ending silently keeps everything through the
  // backstop; adding five characters after it must not delete the rest.
  const silent = cut(BRIEFING, [{ start: 0, end: BRIEFING.length }]);
  silent.indexOf(BRIEFING) >= 0 && cut(worked, [{ start: 0, end: BRIEFING.length + 2 }]).indexOf(BRIEFING) >= 0
    ? pass("a short sign-off after the answer does not delete the answer")
    : fail("adding a sign-off to a turn deletes text that the same turn kept without one");
  // THE NOTICES ARE NOT SURVIVORS. They are three or four hundred characters of
  // OUR deterministic text appended after the model stops, and counting them
  // would make a turn whose answer was deleted look as though plenty survived —
  // on exactly the shape (an answer, then an over-budget lookup) the cut-short
  // notice exists for.
  const NOTICE = cutShortLookupNotice([{ name: "query_meetingbrain", calls: 9, blockedRepeat: 0, blockedBudget: 3 }], dataSubject);
  NOTICE.length > BRIEFING.length
    ? pass(`PRECONDITION — the notice (${NOTICE.length} chars) really is longer than the answer under test`)
    : fail("PRECONDITION — the notice is shorter than the answer, so this unit cannot tell the two readings apart");
  const withNotice = `${BRIEFING}\n\n${SIGNOFF}${NOTICE}`;
  const spanOverAnswer = [{ start: 0, end: BRIEFING.length + 2 }];
  cut(withNotice, spanOverAnswer, BRIEFING.length + 2 + SIGNOFF.length).indexOf(BRIEFING) >= 0
    ? pass("an end-of-turn notice does not count as surviving answer text")
    : fail("the notice was counted as a survivor, so the answer above it was cut");
  cut(withNotice, spanOverAnswer).indexOf(BRIEFING) < 0
    ? pass("...and without the boundary the whole string counts, which is the right reading for a caller with no notices")
    : fail("PRECONDITION — the boundary made no difference here, so the assertion above proves nothing");
  // The bar itself, stated: equal lengths are cut, one character more is kept.
  const six = "AAAAAA";
  cut(six + "BBBBBB", [{ start: 0, end: 6 }]) === "BBBBBB"
    ? pass("a span exactly as long as the survivor is cut")
    : fail("a span the same size as what follows it was kept");
  cut(six + "A" + "BBBBBB", [{ start: 0, end: 7 }]) === six + "A" + "BBBBBB"
    ? pass("one character more than the survivor is kept")
    : fail("a span longer than what follows it was cut");
}

console.log("\n10. Whose limit was hit — two clauses, and which refusal gets which");
// THE INCIDENT. 9 query_meetingbrain calls against a budget of 6, and the reply
// said it could not open "the 1 September client meeting (no recording)" about
// a meeting carrying a 28,563-character transcript on the user's own record.
// The refusals never said the limit was OURS, so the model supplied a reason
// and the reason it invented was a fact about the source.
{
  const carries = (label: string, text: string) =>
    text.indexOf(DO_NOT_BLAME_THE_SOURCE) >= 0
      ? pass(`${label} carries the do-not-blame-the-source clause`)
      : fail(`${label} does not carry the clause verbatim — the chains can drift on it again`);
  carries("repeatedCallNotice", repeatedCallNotice("query_meetingbrain"));
  carries("overBudgetNotice", overBudgetNotice("query_meetingbrain"));
  carries("postTaintRefusal (a read tool)", postTaintRefusal("query_meetingbrain"));
  carries("postTaintRefusal (a blocked tool)", postTaintRefusal("generate_slides"));
  // PRECONDITION: the two postTaintRefusal branches are really different, or
  // the two assertions above are one assertion written twice.
  postTaintRefusal("query_meetingbrain") !== postTaintRefusal("generate_slides")
    ? pass("the two postTaintRefusal branches differ, so both were really tested")
    : fail("PRECONDITION — postTaintRefusal returns the same text for a read tool and a blocked one");

  // AND THE OTHER HALF GOES ONLY WHERE IT IS TRUE. The first draft carried one
  // clause into all four branches, and in two of them its opening sentence —
  // "name what you did not reach and say the lookup was cut short here" — was
  // an instruction to invent. A duplicate-signature refusal REACHED everything
  // (the result is a line above it, and the same notice says so in the sentence
  // before); a post-taint refusal of generate_slides reached no source at all,
  // which is the category error `dataSubject`'s gate exists to prevent in the
  // user-facing notice, made instead in the model-facing text.
  const cutShortIn = (label: string, text: string, want: boolean) =>
    (text.indexOf(OUR_LIMIT_CUT_IT_SHORT) >= 0) === want
      ? pass(`${label} ${want ? "says" : "does not say"} the lookup was cut short`)
      : fail(want
        ? `${label} no longer says OUR limit cut the lookup short — the model is left to guess whose limit it was`
        : `${label} tells the model to say a lookup was cut short, and none was — that is the invented statement this work exists to remove`);
  cutShortIn("overBudgetNotice", overBudgetNotice("query_meetingbrain"), true);
  cutShortIn("postTaintRefusal (the read allowance)", postTaintRefusal("query_meetingbrain"), true);
  cutShortIn("repeatedCallNotice", repeatedCallNotice("query_meetingbrain"), false);
  cutShortIn("postTaintRefusal (a blocked generator)", postTaintRefusal("generate_slides"), false);
  // ...and the two that do not say it say something TRUE of themselves instead,
  // rather than falling silent and leaving the model to fill the gap again.
  /you already HAVE this result/.test(repeatedCallNotice("query_meetingbrain"))
    ? pass("repeatedCallNotice says the result is already in hand")
    : fail("repeatedCallNotice no longer says why this refusal cost the user nothing");
  /this specific STEP was blocked/.test(postTaintRefusal("generate_slides"))
    ? pass("a blocked generator is described to the model as a blocked step")
    : fail("the post-taint refusal of a generator no longer names what it actually was");
  // The clause's CONTENT, so weakening it goes red rather than passing on a
  // substring. Five words, because "(no recording)" was none of them and the
  // model will reach for whichever one is left unnamed.
  const WORDS = ["unavailable", "missing", "unrecorded", "not transcribed", "non-existent"];
  for (let i = 0; i < WORDS.length; i++) {
    DO_NOT_BLAME_THE_SOURCE.indexOf(WORDS[i]) >= 0
      ? pass(`the clause forbids "${WORDS[i]}"`)
      : fail(`the clause no longer forbids "${WORDS[i]}" — that is the word the next answer will use`);
  }
  /OURS, not the source's/.test(OUR_LIMIT_CUT_IT_SHORT)
    ? pass("the cut-short clause says the limit is ours")
    : fail("the clause no longer says whose limit was hit, which is the whole point of it");
  // The universal half must stay universal: nothing in it may claim a lookup
  // happened, or it cannot be carried by the two branches where none did.
  DO_NOT_BLAME_THE_SOURCE.indexOf("cut short") < 0 && DO_NOT_BLAME_THE_SOURCE.indexOf("name what you did not reach") < 0
    ? pass("the universal half instructs no claim about what this particular refusal reached")
    : fail("the clause carried into every refusal has grown an instruction that is false in two of them");
  // The old wording was an INVITATION to blame the source, not merely a
  // missing warning, so it is gone rather than supplemented.
  overBudgetNotice("query_meetingbrain").indexOf("could not fetch and why") < 0
    ? pass('overBudgetNotice no longer asks the model for a "why" it cannot see')
    : fail('overBudgetNotice still says "which parts you could not fetch and why" — that "why" is what produced "(no recording)"');
  repeatedCallNotice("query_meetingbrain").indexOf("isn't available, say so plainly") < 0
    ? pass("repeatedCallNotice no longer invites a claim about the source")
    : fail('repeatedCallNotice still says "if the data isn\'t available, say so plainly"');
}

console.log("\n11. The cut-short notice — only an over-budget refusal is a hole");
{
  const u = (name: string, repeat: number, budget: number): ToolUsage =>
    ({ name, calls: 1 + repeat + budget, blockedRepeat: repeat, blockedBudget: budget });
  const notice = (usage: ToolUsage[] | null) => cutShortLookupNotice(usage, dataSubject);
  notice([]) === "" ? pass("silent on a turn that refused nothing") : fail("a clean turn carries a cut-short notice");
  notice(null) === "" ? pass("silent on null usage") : fail("null usage produced a notice");
  notice([u("query_meetingbrain", 2, 0)]) === ""
    ? pass("silent when the only refusals were duplicates — the result is already above")
    : fail("a duplicate-signature refusal cries wolf about a hole that does not exist");
  const one = notice([u("query_meetingbrain", 0, 3)]);
  /A lookup was cut short/.test(one) && one.indexOf("your meeting records") >= 0
    ? pass("an over-budget refusal speaks, naming what it reads in the user's words")
    : fail(`the over-budget notice is ${JSON.stringify(one.slice(0, 120))}`);
  /not a gap in the source —/.test(one)
    ? pass("and it says the limit is at this end, in the singular")
    : fail("the notice does not say the limit is ours");
  one.indexOf("\n\n---\n\n") === 0 ? pass("it is set apart like its four neighbours") : fail("the notice does not open with the rule its neighbours use");
  // AND IT PROMISES NOTHING THE PRODUCT DOES NOT KEEP. The first draft closed
  // "ask for that part on its own and it WILL be fetched". Driven through the
  // real router: "Summarise the 1 September client meeting" reaches the meeting
  // tools, and "Summarise the call with Thomas" routes conversational with zero
  // hints and is told to answer from what it has. Routing is frozen pending a
  // separate decision, so the sentence is the thing that has to be true.
  one.indexOf("it will be fetched") < 0 && /naming what you want/.test(one)
    ? pass("the closing line asks for a named follow-up rather than guaranteeing one")
    : fail("the notice promises the follow-up will be fetched, which the frozen router does not always do");
  one.indexOf("query_meetingbrain") < 0 ? pass("it never shows the user a tool's machine name") : fail("the notice prints the tool's machine name");
  // A GENERATOR IS NOT A SOURCE. Found by running, not by reading: unscoped,
  // this produced "ran out of its own allowance for reading the deck builder".
  notice([u("generate_slides", 0, 2)]) === ""
    ? pass("silent for a generator — a deck builder is not something the turn failed to read")
    : fail("the notice claims a cut-short LOOKUP of the deck builder");
  notice([u("generate_image", 0, 2)]) === "" ? pass("silent for image generation") : fail("the notice speaks about image generation");
  notice([u("a_tool_nobody_mapped", 0, 2)]) === ""
    ? pass("silent for an unmapped tool — better nothing than a machine name")
    : fail('an unmapped tool produced a sentence about "reading a tool nobody mapped"');
  // WEB SEARCH IS HELD OUT, and this is a judgement rather than a category. It
  // reads a source like the rest, but it is absent from the budget table, so it
  // runs on the default cap of THREE wherever it is a function tool — and an
  // ordinary four-search turn would end on a warning that the answer may be
  // missing something. Review 2's plan item 4 measured it going over in 4 of
  // its 6 turns in the window. A notice on most search turns stops being read.
  // Give web_search a real budget and give it a subject in the same change.
  // Asserted as a PAIR, so item 4 can land without this going red for the
  // wrong reason: web_search speaks if and only if it has a real budget.
  {
    const webSpeaks = notice([u("web_search", 0, 3)]) !== "";
    const webBudget = toolBudgetFor("web_search");
    webSpeaks === webBudget > toolBudgetFor("a_tool_with_no_entry_at_all")
      ? pass(webSpeaks
        ? `web_search speaks, and has a budget of ${webBudget} to justify it`
        : "silent for web_search while it runs on the default budget — a warning on most search turns would stop being read")
      : fail(webSpeaks
        ? `web_search speaks on the default budget of ${webBudget}, so an ordinary four-search turn now ends on a warning`
        : `web_search has a budget of ${webBudget} and still says nothing — item 4 raised the cap without giving it back its subject in lib/ai/tool-activity.ts`);
  }
  const two = notice([u("query_meetingbrain", 0, 2), u("query_drive_docs", 0, 1)]);
  two.indexOf("your meeting records and Drive documents") >= 0 && /not a gap in the sources —/.test(two)
    ? pass("two sources join with \"and\", and the closing clause pluralises")
    : fail(`two sources read ${JSON.stringify(two.slice(0, 160))}`);
  const three = notice([u("query_meetingbrain", 0, 2), u("query_gmail", 0, 1), u("query_drive_docs", 0, 1)]);
  three.indexOf("your meeting records, your mail and Drive documents") >= 0
    ? pass("three sources read as a list")
    : fail(`three sources read ${JSON.stringify(three.slice(0, 160))}`);
  // Two tools reading the same source say it once.
  const dupSubject = notice([u("query_calendar", 0, 1), u("query_calendar", 0, 1)]);
  dupSubject.split("your calendar").length - 1 === 1 ? pass("a repeated subject is named once") : fail("a subject was named twice in one sentence");
}

console.log("\n12. Two counters, because the two refusals mean opposite things");
// Reviewing the flagged turn meant reconstructing which refusal was which
// arithmetically against the budget table. Only the over-budget one is a hole
// in the answer, and only it may drive a user-facing notice.
{
  const g = createToolLoopGuard();
  g.blockFor("query_engine", { report: "a" });
  g.blockFor("query_engine", { report: "a" });            // duplicate
  let e = g.usage().filter((x) => x.name === "query_engine")[0];
  e && e.blockedRepeat === 1 && e.blockedBudget === 0
    ? pass("a duplicate signature moves blockedRepeat alone")
    : fail(`duplicate gave blockedRepeat=${e?.blockedRepeat} blockedBudget=${e?.blockedBudget}`);
  const h = createToolLoopGuard();
  const budget = toolBudgetFor("query_meetingbrain");
  for (let i = 0; i < budget + 2; i++) h.blockFor("query_meetingbrain", { q: `q${i}` });
  const m = h.usage().filter((x) => x.name === "query_meetingbrain")[0];
  m && m.blockedBudget === 2 && m.blockedRepeat === 0
    ? pass("over-budget calls move blockedBudget alone")
    : fail(`over budget gave blockedBudget=${m?.blockedBudget} blockedRepeat=${m?.blockedRepeat}`);
  m && m.calls === budget + 2
    ? pass("calls still counts every attempt, refusals included")
    : fail(`calls=${m?.calls}, expected ${budget + 2}`);
  // Section 4's precedence rule, now visible in the counters: an over-budget
  // DUPLICATE is a repeat, and must not be announced as a hole.
  const dup = h.blockFor("query_meetingbrain", { q: "q0" });
  const m2 = h.usage().filter((x) => x.name === "query_meetingbrain")[0];
  dup === repeatedCallNotice("query_meetingbrain") && m2.blockedRepeat === 1 && m2.blockedBudget === 2
    ? pass("an over-budget duplicate counts as a repeat, not as a second hole")
    : fail(`an over-budget duplicate counted as blockedRepeat=${m2.blockedRepeat} blockedBudget=${m2.blockedBudget}`);
}

console.log("\n13. Every chain is wired to the filter and the notice — per chain, not per file");
// A GLOBAL COUNT USED TO STAND HERE and it was wrong twice over. It asserted
// exactly four `toolLoopGuard.usage()` calls; the end-of-turn notices added
// since call it too, so it read 16 and had been RED at HEAD. And a whole-file
// count cannot say WHICH chain is missing a line — four chains with three
// copies of something between them passes a count of three.
//
// Comments out first, the lesson check 38 (f) paid for: a commented-out wiring
// line still matches a substring search.
{
  const uncommented = (src: string) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
  const src = uncommented(providers);
  const CHAINS = ["streamAnthropic", "streamXAIChatCompletions", "streamGemini", "streamOpenAI"];
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  for (let i = 0; i < CHAINS.length; i++) {
    const at = src.indexOf(`async function ${CHAINS[i]}(`);
    if (at < 0) { fail(`${CHAINS[i]} is not in providers.ts — this check is reading the wrong file or the chain was renamed`); continue; }
    const next = src.indexOf("\nasync function ", at + 10);
    const body = src.slice(at, next < 0 ? src.length : next);
    // PRECONDITION: a body that sliced to nothing would satisfy no assertion
    // below and report nothing either.
    if (body.length < 5000) { fail(`${CHAINS[i]}: sliced body is only ${body.length} chars — the slice is wrong, so nothing below was really tested`); continue; }
    count(body, "narrationSpans.push(") === 1
      ? pass(`${CHAINS[i]} records the rounds that ended in tool calls`)
      : fail(`${CHAINS[i]} pushes ${count(body, "narrationSpans.push(")} narration spans, expected 1 — its plan paragraphs go straight into the transcript`);
    count(body, "keptText: withoutRoundNarration(fullText, narrationSpans, spokenText.length)") === 1
      ? pass(`${CHAINS[i]} returns the filtered copy, bounded by its own text`)
      : fail(`${CHAINS[i]} does not return keptText: withoutRoundNarration(fullText, narrationSpans, spokenText.length) — without the third argument the end-of-turn notices count as surviving answer text`);
    count(body, "cutShortLookupNotice(") === 1
      ? pass(`${CHAINS[i]} says when a lookup was cut short`)
      : fail(`${CHAINS[i]} calls cutShortLookupNotice ${count(body, "cutShortLookupNotice(")} times, expected 1`);
    count(body, "toolLoopGuard.usage()") >= 1
      ? pass(`${CHAINS[i]} reports its tool usage`)
      : fail(`${CHAINS[i]} runs tools without reporting which — its answers cannot be reviewed`);
  }
  // AND THE ROUTE WRITES THE FILTERED COPY. The weakest assertion in this file
  // — a source read, which this repo has on record as reporting a live hole as
  // closed — and it is here because the route has no offline seam: it needs a
  // request, a session and a database. Weak and stated is better than absent,
  // because everything above is undone by one word in this file.
  const ROUTES: [string, number][] = [
    ["app/api/ai/conversations/[id]/messages/route.ts", 2],
    ["app/api/ai/conversations/[id]/fact-check/route.ts", 1],
  ];
  for (let i = 0; i < ROUTES.length; i++) {
    const [file, want] = ROUTES[i];
    const route = uncommented(readFileSync(file, "utf8"));
    count(route, "document_message: keptText") === want
      ? pass(`${file.split("/").slice(-2).join("/")} persists the filtered copy at all ${want} site(s)`)
      : fail(`${file} writes document_message: keptText ${count(route, "document_message: keptText")} times, expected ${want}`);
    count(route, "document_message: fullText") === 0
      ? pass(`${file.split("/").slice(-2).join("/")} persists the streamed copy nowhere`)
      : fail(`${file} still saves fullText — the narration goes back into the transcript, and into every later turn's history`);
  }

  // THE THIRD CONSUMER, and the one this list did not have. The narration fix
  // landed on the two chat routes and missed lib/scheduled/runner.ts, where
  // the text is not only persisted but EMAILED — eleven of forty-eight
  // scheduled answers went out opening with the model's plan for the round.
  // It was invisible twice over: this list named two files, and the runner
  // re-declared the completion shape by hand and read it through `as any`, so
  // keptText being a REQUIRED field of StreamResult proved nothing about it.
  //
  // Asserted on BEHAVIOUR rather than on a spelling: the runner names its own
  // variable `deliverText`, so counting "document_message: keptText" would go
  // green on a file that never reads keptText at all.
  {
    const runner = uncommented(readFileSync("lib/scheduled/runner.ts", "utf8"));
    /^\s*import\s*\{[^}]*\btype StreamResult\b/m.test(runner) || /completion:\s*StreamResult/.test(runner)
      ? pass("the scheduled runner takes its completion shape FROM StreamResult")
      : fail("lib/scheduled/runner.ts re-declares the completion shape by hand — keptText being required proves nothing about a consumer that describes the result in its own words");
    /\bkeptText\b/.test(runner)
      ? pass("the scheduled runner reads keptText")
      : fail("lib/scheduled/runner.ts never mentions keptText — its thread and its EMAIL still carry the model's plan paragraphs");
    /let\s+deliverText\s*=\s*keptText/.test(runner)
      ? pass("and what it delivers starts from the filtered copy")
      : fail("lib/scheduled/runner.ts does not start deliverText from keptText — the email opens with the narration");
    /extractMonitorState\(fullText\)/.test(runner)
      ? pass("while the monitor's state block is still read from the whole text, so a baseline in a tool round is not filtered away")
      : fail("lib/scheduled/runner.ts reads the monitor state from the filtered copy — a state block written in a tool round would be lost and the next run would have no baseline");
  }
  // AND EVERY READER OF data_tools UNDERSTANDS THE NEW NAMES. Splitting
  // `blocked` into two was written up as safe because nothing read it; one
  // thing did, and it is the instrument review 2 was written from. The cast
  // there is a hand-written type over an `any` column, so tsc stayed green
  // while "(3 refused)" quietly disappeared from every row written after the
  // split — the exact "9 calls against a budget of 6" signal that found this
  // incident. Asserted as USE, not existence: this repo has a regex proving a
  // line exists on record as reporting a live hole as closed.
  {
    const file = "scripts/review-answer-quality.ts";
    const src = uncommented(readFileSync(file, "utf8"));
    const at = src.indexOf("data_tools || []");
    if (at < 0) fail(`${file} no longer reads data_tools — find the reader and re-point this assertion, or the split is unreviewable`);
    else {
      const body = src.slice(at, at + 1200);
      count(body, "blockedBudget") >= 1 && count(body, "blockedRepeat") >= 1
        ? pass("the answer-quality reviewer reads both halves of the split")
        : fail(`${file} reads data_tools without blockedRepeat/blockedBudget — every row written since the split renders with no refusal count at all`);
      count(body, "blocked ") + count(body, "blocked;") + count(body, "blocked?") + count(body, "blocked |") + count(body, "t.blocked") >= 1
        ? pass("...and still reads the pre-split rows, which are most of the corpus")
        : fail(`${file} dropped the legacy \`blocked\` field, so every row written before 2026-09-16 renders with no refusal count`);
    }
  }
}

// ── Self-test ───────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n14. Self-test — the detectors fire on the shapes they exist for");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    detects ${name}`);
    else { selfFails++; console.log(`  FAIL  does NOT detect ${name}`); }
  };

  // The divergence that actually happened: a chain-local table missing the
  // personal-data tools, so query_slack capped at the default.
  const localTableMissingSlack: Record<string, number> = {
    query_xero: 8, query_engine: 8, query_meetingbrain: 6, query_drive_docs: 6,
    search_notebook: 6, query_resourcing: 8,
  };
  detects("a budget table missing query_slack (the real divergence)",
    (localTableMissingSlack["query_slack"] ?? 3) !== toolBudgetFor("query_slack"));

  // A guard without release() — image retries refused after a failure.
  const g2 = createToolLoopGuard();
  g2.blockFor("generate_image", { p: 1 });
  detects("a guard that cannot release refuses an honest retry", g2.blockFor("generate_image", { p: 1 }) !== null);
  detects("the real guard exposes release()", typeof createToolLoopGuard().release === "function");
  detects("the real guard exposes usage()", typeof createToolLoopGuard().usage === "function");

  // The source assertions must be capable of failing.
  detects("the inline-copy detector would fire on a reintroduced table",
    "const READ_ONLY_TOOL_BUDGET: Record<string, number> = {".indexOf("READ_ONLY_TOOL_BUDGET: Record<string, number>") >= 0);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
