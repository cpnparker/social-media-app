/**
 * Guards the mark lens — which inline marks a document gets, and why.
 *
 * Run: npx tsx scripts/verify-optimizer-lens.ts --self-test
 *
 * ── WHAT THIS EXISTS TO STOP COMING BACK ────────────────────────────────────
 *
 * A cover letter, opened in the Writer, marked HIGH severity on the words
 * "Dear Mr Suárez Santos," and told its opening should "carry the answer,
 * quotably" because "engines lift openings". Eight such marks, on a letter to a
 * named person. The cause was not a bad heuristic — it was the ABSENCE of one:
 * `buildLiveFindings` took no surface and no content type, so sixteen criteria
 * written to make a page quotable by a machine painted on everything.
 *
 * The type registry could not have saved it, and that is measured rather than
 * assumed: `criteriaFor("cv")` removes three of thirty-four criteria, and every
 * absurd mark above survives it. Check 5 pins that number so nobody "fixes"
 * this by lengthening an exclusion list instead.
 *
 * ── EVERY ASSERTION RUNS THE CODE ───────────────────────────────────────────
 *
 * No regex over source decides anything here. This repo has already shipped a
 * guard that passed while blind because a regex read the wrong window, so the
 * fixtures go through computeDraftScores and buildLiveFindings and the
 * assertions read what a writer would actually see on screen.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  making the lens parameter optional with an "engine" default   → check 3
 * KILLED  classifying anonymous-first-person-facts as plain             → check 4
 * KILLED  criterionInLens returning true for an unregistered key        → check 2
 * KILLED  lensDisclosure taking a reason and interpolating the type     → check 7
 * KILLED  leaving the engine rationale inside REMEDY                    → check 8
 * KILLED  markPolicyFor letting an override beat a judge-off type       → check 6
 * KILLED  mergeFindingSets dropping the talk set                        → check 9
 *
 * 2026-08-27, check 12 — all run in a throwaway git worktree, never this tree
 * (`vercel deploy --prod` uploads the working directory):
 *
 * KILLED  a judge key losing its rationale                             → check 12
 * KILLED  withWhy routed through criterionInLens (the silent-zero trap)→ check 12
 * KILLED  placeholder-guard's rationale removed again                  → check 12
 * KILLED  whyJudge methodology copy pasted in as writer copy           → check 12
 * KILLED  the bare judge set restored at the merge site                → check 12
 * KILLED  the raw post-assess dispatch restored                        → check 12
 * KILLED  the lens-repaint effect's dependency swapped to []           → check 12
 * KILLED  an extra statement smuggled into the effect body             → check 12
 *
 * SURVIVED, then fixed — worth more than the kills. The repaint assertion
 * first looked for "repaintLive()" anywhere ahead of the [policy.lens]
 * dependency array, and `if (false) repaintLive();` sailed through it: the call
 * was still WRITTEN, and written is not run. That is this repo's oldest
 * failure mode wearing a React hat. A source regex cannot prove an effect
 * fires, so the assertion now pins the effect's entire body — leaving nowhere
 * to put a condition — and the three variants above were added to hold it.
 */
import { CRITERIA } from "../lib/optimizer/rubric";
import { computeDraftScores } from "../lib/optimizer/engine";
import { buildLiveFindings, whyFor, withWhy } from "../lib/optimizer/live-issues";
import {
  markPolicyFor, criterionInLens, lensOf, lensDisclosure, normaliseLens,
  mergeFindingSets, MIN_MARKABLE_WORDS, type Lens,
} from "../lib/optimizer/mark-policy";
import { CONTENT_TYPE_IDS, criteriaFor, analysisAllowed } from "../lib/optimizer/content-types";
import { settledStatuses, markersFor, type ResolvedNote } from "../lib/optimizer/highlight-plugin";
import { JUDGE_CRITERION_KEYS, JUDGE_CRITERIA } from "../lib/optimizer/judge-rubric";
import { buildDiscussSystem } from "../lib/optimizer/discuss";
import { parseJudgeResponse, deriveVerdictFindings, anchorJudgeFindings } from "../lib/optimizer/judge";
import { parseDraft } from "../lib/optimizer/parse";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/** Chris's own test document, condensed. The case that produced the bug. */
const COVER_LETTER = `<p>Dear Mr Su&aacute;rez Santos,</p>
<p>I am writing to apply for the role of Head of Communications at the International Organisation of Employers. I have over twenty years of leadership experience in communications at the World Economic Forum, Reuters and at the Geneva-based communications company I co-founded, and I have spent my career on both sides of that conversation, which is exactly the role I am looking to move into now.</p>
<p>As Head of Digital Media at The World Economic Forum for nearly a decade, I built the team and executed the communications strategy that grew the Forum's digital audience to tens of millions, while strengthening its ability to spark collaboration between public and private sectors and making it one of the most followed institutional voices in the world.</p>
<p>In 2019 I co-founded The Content Engine, a Geneva communications company that grew to a team of thirty and develops communications strategies, thought leadership publications and digital campaigns for more than fifty organisations. We are the best in the market at what we do.</p>
<p>I would welcome the chance to discuss this further.</p>`;

const ARTICLE = `<h1>What is generative engine optimisation?</h1>
<p>Generative engine optimisation is the practice of structuring content so AI assistants cite it. We have seen a huge uplift of 300% in citations.</p>
<h2>Why does it matter</h2>
<p>It matters. This is because the landscape is changing rapidly and it is important to understand that the way in which people discover information has fundamentally shifted in recent years.</p>
<p>Our clients say we are the leading provider. [TK add case study]</p>`;

const scoresFor = (html: string, title: string) =>
  computeDraftScores({ body: html, title, targetQueries: [], format: "article" as any });

const keysFrom = (html: string, title: string, lens: Lens) => {
  const s = scoresFor(html, title);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return buildLiveFindings(s, text, lens).map((f) => f.criterion);
};

// ── 1. Every criterion declares a lens ─────────────────────────────────────
console.log("\n1. Classification totality");
{
  const missing = CRITERIA.filter((c) => c.lens !== "engine" && c.lens !== "plain");
  assert(missing.length === 0, `all ${CRITERIA.length} criteria declare a lens`);

  // The fixture's OWN precondition first. A fixture that stops tripping span
  // emitters would otherwise certify totality while testing almost nothing.
  const s = scoresFor(ARTICLE, "What is generative engine optimisation?");
  const emitting: string[] = [];
  for (let p = 0; p < s.pillars.length; p++) {
    const cs = s.pillars[p].criteria;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].spans && cs[i].spans!.length > 0 && emitting.indexOf(cs[i].key) < 0) emitting.push(cs[i].key);
    }
  }
  assert(emitting.length >= 4, `the fixture actually trips span emitters (${emitting.length})`);
  let unclassified = 0;
  for (let i = 0; i < emitting.length; i++) if (lensOf(emitting[i]) === null) unclassified++;
  assert(unclassified === 0, "every criterion that EMITS SPANS is classified");
}

// ── 2. criterionInLens fails closed ────────────────────────────────────────
console.log("\n2. Unregistered keys");
{
  assert(!criterionInLens("not-a-real-criterion", "plain"), "an unknown key shows under NO lens (plain)");
  assert(!criterionInLens("not-a-real-criterion", "engine"), "an unknown key shows under no lens (engine)");
  assert(criterionInLens("sentence-length-norm", "plain"), "a plain criterion shows on the plain lens");
  assert(criterionInLens("answer-first-position", "engine"), "an engine criterion shows on the engine lens");
  assert(!criterionInLens("answer-first-position", "plain"), "an engine criterion does NOT show on the plain lens");
  assert(criterionInLens("sentence-length-norm", "engine"), "the engine lens is a superset — plain marks still show");
}

// ── 3. The lens is required, not defaulted ─────────────────────────────────
console.log("\n3. Arity");
assert(buildLiveFindings.length === 3,
  "buildLiveFindings takes the lens as a REQUIRED third parameter — an optional one lets a new call site silently reinstate the bug");

// ── 4. The cover letter ────────────────────────────────────────────────────
console.log("\n4. The document that caused this");
{
  const plain = keysFrom(COVER_LETTER, "test cover letter", "plain");
  const engine = keysFrom(COVER_LETTER, "test cover letter", "engine");

  let leaked = 0;
  for (let i = 0; i < plain.length; i++) if (lensOf(plain[i]) === "engine") leaked++;
  assert(leaked === 0, "NO engine-lens mark survives on the plain lens");
  assert(plain.indexOf("answer-first-position") < 0,
    'the salutation is not told to "carry the answer, quotably"');
  assert(plain.indexOf("anonymous-first-person-facts") < 0,
    'a first-person letter is not told to name a brand instead of "we"');

  // The engine has NOT been silenced — the same fixture still produces them.
  assert(engine.length > plain.length, "the engine lens still emits more than the plain lens");
  assert(engine.indexOf("answer-first-position") >= 0 || engine.indexOf("tldr-block") >= 0,
    "engine-lens marks are still produced when the engine lens is in force");

  // And the layer is FILTERED, not off. A plain lens that emitted nothing would
  // pass every assertion above while quietly deleting the feature.
  assert(plain.length > 0, "the plain lens still marks the letter — filtered, not switched off");
  assert(plain.indexOf("unverifiable-superlatives") >= 0 || plain.indexOf("promotional-claims") >= 0 ||
         plain.indexOf("sentence-length-norm") >= 0,
    'the useful marks survive — the "best in the market" claim and the long sentences');
}

// ── 5. The type gate could not have done this ──────────────────────────────
console.log("\n5. Why the type registry was not the fix");
{
  const kept = criteriaFor("cv").map((c) => c.key);
  const all = CRITERIA.map((c) => c.key);
  assert(all.length - kept.length === 3,
    `the type gate removes only ${all.length - kept.length} of ${all.length} criteria`);
  assert(kept.indexOf("answer-first-position") >= 0 && kept.indexOf("anonymous-first-person-facts") >= 0,
    "the marks that were absurd on a letter SURVIVE the type gate — lengthening it is not the fix");
}

// ── 6. The policy, across every combination ────────────────────────────────
console.log("\n6. Policy cross-product");
{
  const overrides: (Lens | null)[] = [null, "engine", "plain"];
  let writerEngineWithoutCause = 0;
  let judgeOffRaised = 0;
  let optimiserNotEngine = 0;

  for (let t = 0; t < CONTENT_TYPE_IDS.length; t++) {
    const type = CONTENT_TYPE_IDS[t];
    const judgeOff = !analysisAllowed(type, "judge");
    for (let o = 0; o < overrides.length; o++) {
      for (let q = 0; q < 2; q++) {
        const hasTargetQueries = q === 1;
        const w = markPolicyFor({ surface: "writer", contentTypeId: type, override: overrides[o], hasTargetQueries });
        const p = markPolicyFor({ surface: "optimiser", contentTypeId: type, override: overrides[o], hasTargetQueries });

        // A judge-off type is plain under EVERY override, including "engine".
        if (judgeOff && (w.lens !== "plain" || p.lens !== "plain" || w.canRaise || p.canRaise)) judgeOffRaised++;
        if (judgeOff) continue;

        // The Writer only reaches the engine lens by a declaration: an explicit
        // override, or target queries in the brief.
        if (w.lens === "engine" && overrides[o] !== "engine" && !hasTargetQueries) writerEngineWithoutCause++;
        if (p.lens !== "engine" && overrides[o] !== "plain") optimiserNotEngine++;
      }
    }
  }
  assert(judgeOffRaised === 0,
    "a type with the judge off is plain under every override and cannot be raised");
  assert(writerEngineWithoutCause === 0,
    "the Writer reaches the engine lens only by a person's declaration");
  assert(optimiserNotEngine === 0, "the Optimiser is the engine lens unless explicitly lowered");

  const brief = markPolicyFor({ surface: "writer", contentTypeId: "article", override: null, hasTargetQueries: true });
  assert(brief.lens === "engine" && brief.reason === "brief",
    "target queries in the brief raise the Writer, and the reason says so");
  const bare = markPolicyFor({ surface: "writer", contentTypeId: "article", override: null, hasTargetQueries: false });
  assert(bare.lens === "plain", "a Writer piece with no queries and no override is plain");
}

// ── 7. The disclosure cannot name the unnamed type ─────────────────────────
console.log("\n7. Disclosure silence");
{
  assert(lensDisclosure.length === 0,
    "lensDisclosure takes NO arguments — it cannot vary by a reason that may be the quiet type");
  const text = lensDisclosure().toLowerCase();
  let named = 0;
  for (let i = 0; i < CONTENT_TYPE_IDS.length; i++) {
    if (text.indexOf(String(CONTENT_TYPE_IDS[i]).toLowerCase()) >= 0) named++;
  }
  assert(named === 0, "what the writer reads names no registered content type");
  assert(text.trim().length > 0, "it still SAYS something — not looking and finding nothing must read differently");
}

// ── 8. The remedy is separated from its engine rationale ───────────────────
console.log("\n8. What a mark says under each lens");
{
  const s = scoresFor(ARTICLE, "What is generative engine optimisation?");
  const text = ARTICLE.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const plain = buildLiveFindings(s, text, "plain");
  const engine = buildLiveFindings(s, text, "engine");

  const ENGINE_WORDS = /engine|model|cited|citation|retriev|chunk|quotab/i;

  // BOTH fixtures, and the precondition FIRST.
  //
  // This section previously ran on the article fixture alone, which trips no
  // long sentence — so it printed "(no long sentence in this fixture to check)"
  // and certified nothing about the one criterion that actually leaked. The
  // criterion NAME "Mean sentence length near the cited norm" reached a live
  // cover letter with its remedy correctly stripped, because the name was never
  // treated as copy. A check whose fixture cannot trip the defect is a check
  // that silently tests nothing.
  const letterScores = scoresFor(COVER_LETTER, "test cover letter");
  const letterText = COVER_LETTER.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const letterPlain = buildLiveFindings(letterScores, letterText, "plain");
  assert(letterPlain.filter((f) => f.criterion === "sentence-length-norm").length > 0,
    "the letter fixture DOES trip the criterion whose name leaked — the precondition this section lacked");

  const everyPlain = plain.concat(letterPlain);
  let leaky = 0;
  let example = "";
  for (let i = 0; i < everyPlain.length; i++) {
    if (ENGINE_WORDS.test(everyPlain[i].explanation)) { leaky++; if (!example) example = everyPlain[i].explanation; }
  }
  assert(leaky === 0,
    `NO plain-lens mark explains itself in answer-engine terms — including through the criterion NAME${example ? ` (leaked: "${example.slice(0, 70)}…")` : ""}`);

  // Moved TWICE, and the check has to follow it. First out of REMEDY into
  // RATIONALE; then out of `explanation` into its own `why` field, because
  // running them together made every card four lines and a list of fifteen went
  // unread. The rationale still exists — it is behind a disclosure now.
  let withRationale = 0;
  for (let i = 0; i < engine.length; i++) if (engine[i].why && ENGINE_WORDS.test(String(engine[i].why))) withRationale++;
  assert(withRationale > 0,
    "the engine lens still gives the answer-engine rationale — moved to `why`, not deleted");
  let leakedIntoExplanation = 0;
  for (let i = 0; i < engine.length; i++) if (ENGINE_WORDS.test(engine[i].explanation)) leakedIntoExplanation++;
  assert(leakedIntoExplanation === 0,
    "and it is NOT in the explanation — the scanned line stays short, the consulted line is asked for");
  let plainWhy = 0;
  for (let i = 0; i < plain.length; i++) if (plain[i].why) plainWhy++;
  assert(plainWhy === 0,
    "the plain lens carries no `why` at all — answer-engine reasoning is not that reader's question");

  // The action survives on both.
  const long = letterPlain.filter((f) => f.criterion === "sentence-length-norm")[0];
  assert(!!long && /split/i.test(long.explanation), "a plain-lens long-sentence mark still says what to do");
  assert(!!long && /\d+ words/.test(long.explanation), "and still says how long the sentence is");
}

// ── 8b. A person's decision survives a repaint ─────────────────────────────
//
// `set` fires on every repaint and repaintLive fires on every edit, so
// anchorFindings ran fresh on each keystroke and returned "active" for
// everything — silently resurrecting anything the writer had dismissed one
// character earlier. live-issues.ts states the opposite in a comment beside the
// id it builds ("so a dismissed issue stays dismissed while the writer edits
// elsewhere"). The id was designed to carry it; nothing carried it.
console.log("\n8b. Dismissal survives a repaint");
{
  const mk = (id: string, status: any) => ({ finding: { id } as any, from: 1, to: 2, status });
  const carried = settledStatuses([
    mk("live:a:1-2", "dismissed"),
    mk("live:b:3-4", "active"),
    mk("j1", "resolved"),
    mk("live:c:5-6", "orphaned"),
  ] as any);
  assert(carried["live:a:1-2"] === "dismissed", "a dismissal a person made carries forward");
  assert(carried["j1"] === "resolved", "so does a resolution");
  assert(carried["live:b:3-4"] === undefined,
    "an ACTIVE issue does not carry — it is recomputed from the current text, which is what a repaint is for");
  assert(carried["live:c:5-6"] === undefined,
    "nor does an ORPHAN — a passage the writer restored should light up again");
  assert(Object.keys(settledStatuses(undefined)).length === 0, "no previous state carries nothing");

  // USED, not merely present.
  const plugin = stripComments(read("lib/optimizer/highlight-plugin.ts"));
  assert(/anchorFindings\(next\.doc, action\.findings, prev\.issues\)/.test(plugin),
    "the set reducer actually passes the previous issues — the promise lives or dies here");
  assert(/if \(wasSettled\[f\.id\]\)/.test(plugin),
    "a settled finding claims no range, so it cannot block a live mark over the same sentence");
}

// ── 8c. Conversation notes are a separate channel ─────────────────────────
//
// The design decision of Ship 3, and it is a correctness one rather than a
// visual preference. anchorFindings resolves overlapping ranges by ORPHANING
// the loser, longest quote first. A conversation anchor is typically a whole
// sentence and so is a "sentence runs long" mark — so merging notes into the
// findings list would have made one of the two silently vanish, with nothing on
// screen saying which or why. A margin widget claims no inline range.
console.log("\n8c. Notes claim no range");
{
  const n = (id: string, pos: number, status: any, turn = 0): ResolvedNote => ({ id, turn, pos, status });

  const one = markersFor([n("talk:0:0", 12, "active"), n("talk:0:1", 12, "active"), n("talk:1:0", 40, "active")]);
  assert(one.length === 2, "one marker per block, however many points were made about it");
  assert(one[0].id === "talk:0:0",
    "the FIRST note on a block wins, so the marker leads to the earliest thing said about it");

  assert(markersFor([n("talk:0:0", 0, "orphaned")]).length === 0,
    "an orphan draws nothing — a marker at position 0 would sit on the first paragraph pointing at a comment about another");
  assert(markersFor([n("talk:0:0", 0, "active")]).length === 0, "a zero position never draws");
  assert(markersFor([]).length === 0, "no notes, no markers");

  const plugin = stripComments(read("lib/optimizer/highlight-plugin.ts"));
  // The separation, asserted structurally rather than hoped for.
  assert(/notes: ResolvedNote\[\]/.test(plugin), "notes are their own state, not Issues");
  assert(/Decoration\.widget\(/.test(plugin), "they are drawn as widgets, which claim no inline range");
  assert(!/anchorFindings\([^)]*notes/.test(plugin),
    "notes NEVER go through anchorFindings — that is the function that would orphan a rubric mark");
  assert(/notes: prev\.notes/.test(plugin),
    "a `set` CARRIES notes forward — rebuilding them there would flicker every marker out on each keystroke");
  assert(/tr\.mapping\.mapResult\(n\.pos, -1\)/.test(plugin),
    "markers are MAPPED through edits, not re-resolved mid-keystroke against half-typed words");

  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  assert(/type: "notes", notes/.test(page), "the page dispatches notes as their own action");
  assert(/data-note-turn/.test(page) && /ai-note-marker/.test(page),
    "clicking a marker is handled, delegated on the editor root");
  const panel = stripComments(read("components/optimizer/DiscussPanel.tsx"));
  assert(/onAnchorsChanged\(out\)/.test(panel), "the panel publishes its anchors upward");
  // The scroll must survive the panel being MOUNTED BY the click. The rail is
  // on Suggestions, the panel is unmounted, the marker click mounts it — and the
  // effect runs before the conversation has been fetched. With focusTurn alone
  // in the dependencies it bails and never retries, so the scroll silently does
  // nothing in exactly the case a margin marker is for. Measured in the
  // browser: turn present, flash never applied.
  assert(/\}, \[focusTurn, turns\]\);/.test(panel),
    "the marker scroll retries when the conversation arrives, not only when the click happens");
  assert(/handledNonce/.test(panel),
    "and it fires once per click, so a later reply cannot drag the writer back to an old marker");
  assert(!/streamed[\s\S]{0,120}onAnchorsChanged/.test(panel),
    "anchors come from STORED turns, never the streaming buffer — a half-arrived quote resolves to nothing and would flicker");
}

// ── 9. Merging the producers ───────────────────────────────────────────────
console.log("\n9. Merge");
{
  const merged = mergeFindingSets({
    judge: [{ id: "j1" }], talk: [{ id: "talk:1:a" }], live: [{ id: "live:x:1-2" }, { id: "j1" }],
  });
  assert(merged.length === 3, "all three producers survive and the duplicate is dropped");
  assert(merged.map((f) => f.id).indexOf("talk:1:a") >= 0,
    "the talk set is not dropped — the property that breaks when someone inlines the spread again");
  assert(merged[0].id === "j1", "the judge's considered finding wins a collision");
}

// ── 10. Narrowing ──────────────────────────────────────────────────────────
console.log("\n10. normaliseLens");
{
  const junk: unknown[] = ["engine", "plain", "cv", "article", "ENGINE", "plain ", null, {}, [], 1, true];
  const out = junk.map(normaliseLens);
  let bad = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== null && out[i] !== "engine" && out[i] !== "plain") bad++;
  assert(bad === 0, "only the two literals or null survive");
  assert(normaliseLens("cv") === null && normaliseLens("article") === null,
    "NOTHING TYPE-SHAPED is accepted — a content type must not be settable from a browser");
}

// ── 11. Used, not merely present ───────────────────────────────────────────
console.log("\n11. The studio actually uses it");
{
  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  assert(/markPolicyFor\(/.test(page), "the page calls markPolicyFor");
  assert(/buildLiveFindings\([^)]*policy\.lens/.test(page.replace(/\s+/g, " ")),
    "repaintLive passes the POLICY's lens, not a literal");
  assert(/MIN_MARKABLE_WORDS/.test(page), "the shared word floor gates the live layer");
  assert(!/detectContentType/.test(page),
    "the dead detection import is gone — it was never called and implied typing happened in the studio");
  assert(/surface !== "writer" && chrome\.showAssessAction/.test(page),
    "Assess is the Optimiser's, not the Writer's");

  // ── The control must be reachable ────────────────────────────────────────
  //
  // It lived inside the Suggestions panel, so the one control that answers
  // "why is my cover letter being graded like an article" sat on a tab you had
  // to already suspect the answer to go and open — and on the Writer, where the
  // piece is already plain, the "doesn't fit" wording never rendered at all.
  // Reported by the owner as "I don't see where to click it". It is in the
  // header now, beside the chip, visible whatever the rail shows.
  const header = page.slice(page.indexOf("chrome.showTypeChip"), page.indexOf("chrome.showTypeChip") + 2600);
  assert(/setLens\(policy\.lens === "engine" \? "plain" : "engine"\)/.test(header),
    "the lens control lives in the header and toggles BOTH directions from one place");
  assert(/AI checks on/.test(header) && /AI checks off/.test(header),
    "it states which way round it currently is, rather than only offering a change");
  const list = stripComments(read("components/optimizer/IssueList.tsx"));
  assert(!/onSetLens\(/.test(list),
    "the rail does NOT carry a second copy of the control — two buttons doing one job is how one gets wired to something else");
  const suggest = stripComments(read("app/api/optimizer/sessions/[id]/suggest/route.ts"));
  const gateAt = suggest.indexOf("analysisAllowed(");
  const spendAt = suggest.indexOf("assertServiceAllowed(");
  assert(gateAt > 0 && spendAt > 0 && gateAt < spendAt,
    "the suggest route refuses an analysis-off type BEFORE it reaches the spend gate");
}


// ── 12. The JUDGE's findings answer "Why?" too ─────────────────────────────
//
// Deterministic marks carried a rationale and judge marks carried none — not a
// dead disclosure, an absent one, because both card renderers gate on
// `f.why &&`. So two marks sitting in one list answered different questions and
// nothing on screen said why one of them would not explain itself.
//
// Section 8 above asserts the deterministic half. This is its twin, and the
// assertions are deliberately different in kind: TOTALITY driven off the
// rubric's own key list, because the failure mode here is a table that covers
// some keys. `withRationale > 0` in section 8 would pass with one key of seven.
console.log("\n12. Judge findings carry their reasoning");
{
  // ── Totality, from the source of truth ───────────────────────────────────
  // Driven off JUDGE_CRITERION_KEYS rather than a list written here, so an
  // eighth judge criterion fails the build instead of shipping a card with
  // nothing behind it.
  let missing: string[] = [];
  for (let i = 0; i < JUDGE_CRITERION_KEYS.length; i++) {
    const w = whyFor(JUDGE_CRITERION_KEYS[i], "engine");
    if (!w || w.length < 20) missing.push(JUDGE_CRITERION_KEYS[i]);
  }
  assert(JUDGE_CRITERION_KEYS.length >= 7,
    `the key list is populated (${JUDGE_CRITERION_KEYS.length}) — an empty one would pass the next assertion for free`);
  assert(missing.length === 0,
    missing.length === 0
      ? `every one of the ${JUDGE_CRITERION_KEYS.length} judge criteria has a rationale`
      : `judge criteria with no rationale: ${missing.join(", ")}`);

  // ── It must not be the methodology copy ──────────────────────────────────
  // whyJudge explains why a MODEL scores the criterion rather than the engine.
  // It is written for whoever maintains the rubric, it has no consumer in the
  // app, and pasting it here is the obvious shortcut — it would put "counts
  // KNOWN aliases only ... needs NER" on a writer's screen.
  let leaked: string[] = [];
  for (let i = 0; i < JUDGE_CRITERIA.length; i++) {
    const c: any = JUDGE_CRITERIA[i];
    const w = whyFor(c.key, "engine") || "";
    if (w === c.whyJudge || /\bNER\b|regex|anti-checklist|the engine (counts|detects|scores)/i.test(w)) leaked.push(c.key);
  }
  assert(leaked.length === 0,
    leaked.length === 0
      ? "no rationale is the rubric's own methodology copy, or written about the engine"
      : `methodology copy reached the writer-facing table: ${leaked.join(", ")}`);

  // ── The gate is the LENS, and not criterionInLens ────────────────────────
  // criterionInLens reads the ENGINE's criteria table. None of the judge keys
  // are in it and it fails CLOSED, so routing withWhy through it — which is the
  // tempting symmetry — returns false for every judge finding and the feature
  // does nothing at all, with no error anywhere.
  let inLensWouldZero = 0;
  for (let i = 0; i < JUDGE_CRITERION_KEYS.length; i++) {
    if (!criterionInLens(JUDGE_CRITERION_KEYS[i], "engine")) inLensWouldZero++;
  }
  assert(inLensWouldZero === JUDGE_CRITERION_KEYS.length,
    "criterionInLens still rejects every judge key — so this assertion keeps meaning something");
  const probe = [{ criterion: JUDGE_CRITERION_KEYS[0], why: undefined as string | undefined }];
  assert(!!withWhy(probe, "engine")[0].why,
    "withWhy is NOT routed through criterionInLens — it attaches under the engine lens");
  assert(!withWhy(probe, "plain")[0].why,
    "and attaches nothing under the plain lens");

  // ── Through the REAL pipe, including the findings that skip the parser ────
  // deriveVerdictFindings builds findings from imperfect verdicts entirely in
  // code — they never pass parseJudgeResponse, so a fixture of model findings
  // alone would leave that whole producer unasserted.
  // THE ID FORMATS ARE c<index> AND qt<index>, ZERO-BASED, and the quote must
  // clear parseDraft's five-word floor. A first draft of this fixture used
  // "c1", "q1" and a three-word quotation: every id missed, the quote was not
  // a quote, and only ONE branch of three actually ran — while the section
  // still reported green, because "at least one derived finding" was true.
  const draft = parseDraft({
    body: [
      "<h2>Payment orchestration</h2>",
      "<p>As mentioned above, the second option is the one most teams land on in the end.</p>",
      "<p>“This is absolutely the future of payments for everyone involved,” a spokesperson said.</p>",
      "<p>In our experience the approach works well across a range of operators.</p>",
    ].join(""),
    title: "Payment orchestration explained",
  });
  assert(draft.chunks.length >= 1 && draft.quotes.length >= 1,
    `the fixture parsed to ${draft.chunks.length} chunk(s) and ${draft.quotes.length} quote(s) — the verdict ids below can resolve`);
  const raw = JSON.stringify({
    openingQuotability: { verdict: "no_answer", reason: "scene-setting" },
    chunkSelfContainment: [{ chunkId: "c0", verdict: "dependent", dependency: "as mentioned above" }],
    quoteAttribution: [{ quoteId: "qt0", verdict: "decorative" }],
    queryCoverage: [],
    findings: [{
      criterion: "chunk-self-containment",
      severity: "medium",
      quote: "As mentioned above, the second option is the one most teams land on in the end.",
      prefix: "", suffix: "",
      explanation: "This section leans on text that an extracted answer will not carry with it.",
      suggestedEdit: null,
    }],
    summary: "ok",
  });
  const outcome: any = parseJudgeResponse(raw, draft.text);
  const modelFindings = outcome.response ? outcome.response.findings : [];
  const derived = outcome.response ? deriveVerdictFindings(outcome.response, draft) : [];

  // PRECONDITIONS FIRST. A fixture that yields nothing certifies nothing, and
  // this file has shipped that mistake before.
  assert(modelFindings.length >= 1,
    `the fixture produced ${modelFindings.length} model finding(s) — the parser half is exercised`);
  const derivedKinds: string[] = [];
  for (let i = 0; i < derived.length; i++) if (derivedKinds.indexOf(derived[i].criterion) < 0) derivedKinds.push(derived[i].criterion);
  assert(derivedKinds.length >= 2,
    `the fixture derived ${derived.length} finding(s) across ${derivedKinds.length} criteria (${derivedKinds.join(", ")}) — the producer that skips the parser is exercised on more than one branch`);

  // anchorJudgeFindings returns the ARRAY, not an object wrapping one. A first
  // version read `.anchored || []` and fell back to the UNANCHORED set, so the
  // anchoring step — the one that decides what actually reaches the rail —
  // never ran, and the section reported green over findings that had skipped
  // it. tsx does not typecheck; `next build` did, which is why the build is run
  // by exit code rather than read.
  const anchored = anchorJudgeFindings(draft.text, modelFindings.concat(derived));
  assert(anchored.length >= 2,
    `anchoring returned ${anchored.length} finding(s) — the real anchoring step ran, rather than being skipped by a fallback`);
  const survivors = anchored.filter((a) => !a.orphaned).map((a) => a.finding);
  assert(survivors.length >= 2,
    `${survivors.length} non-orphaned finding(s) reach the merge — enough to assert over`);

  const engineWhys = withWhy(survivors as any, "engine");
  const plainWhys = withWhy(survivors as any, "plain");
  let noWhy: string[] = [];
  for (let i = 0; i < engineWhys.length; i++) if (!engineWhys[i].why) noWhy.push(engineWhys[i].criterion);
  assert(noWhy.length === 0,
    noWhy.length === 0
      ? "every judge finding that reaches the merge carries a why under the engine lens"
      : `judge findings with no why: ${noWhy.join(", ")}`);
  let leakedPlain = 0;
  for (let i = 0; i < plainWhys.length; i++) if (plainWhys[i].why) leakedPlain++;
  assert(leakedPlain === 0, "and none of them carries one under the plain lens");

  // ── The judge's opening finding must not anchor to imported chrome ───────
  // A bare "×" from a close button parses as prose, and deriveVerdictFindings
  // took the first prose sentence — so the card read "the opening cannot be
  // quoted alone as the answer" over a close button. Visible on production the
  // moment judge findings started showing their reasoning.
  {
    const chromey = parseDraft({
      body: "<h1>T</h1><p>×</p><p>Share</p><p>July 3, 2025</p>"
        + "<p>Over the past five years the group has doubled in size and kept growing.</p>",
      title: "T",
    });
    const rawOpen = JSON.stringify({
      openingQuotability: { verdict: "no_answer", reason: "scene-setting" },
      chunkSelfContainment: [], quoteAttribution: [], queryCoverage: [], findings: [], summary: "",
    });
    const oc: any = parseJudgeResponse(rawOpen, chromey.text);
    const opens = oc.response ? deriveVerdictFindings(oc.response, chromey) : [];
    // PRECONDITION: the fixture must really contain the chrome, or the
    // assertion below passes over a document that never had the problem.
    assert(/\u00d7/.test(chromey.text) && /Share/.test(chromey.text),
      "the fixture really does carry a bare glyph and a Share heading ahead of the prose");
    assert(opens.length === 1, `the opening verdict derived ${opens.length} finding(s) — exactly one to inspect`);
    assert(opens.length === 1 && /Over the past five years/.test(opens[0].quote),
      opens.length === 1
        ? `the opening finding anchors to the real opening, not the chrome (${JSON.stringify(opens[0].quote.slice(0, 40))})`
        : "no opening finding to inspect");
  }

  // ── The deterministic half must not have holes either ────────────────────
  // REMEDY had 17 keys and RATIONALE 16; placeholder-guard was the odd one out,
  // so an engine-lens card carried an action and no "Why?" while every card
  // beside it had one. Asserted against REMEDY so the two tables cannot drift.
  const li = read("lib/optimizer/live-issues.ts");
  const keysOf = (name: string) => {
    const a = li.indexOf(`const ${name}`);
    const b = li.indexOf("\n};", a);
    const out: string[] = [];
    const re = /^\s*"([a-z0-9-]+)":/gm;
    let m: RegExpExecArray | null;
    const body = li.slice(a, b);
    while ((m = re.exec(body)) !== null) out.push(m[1]);
    return out;
  };
  const remedyKeys = keysOf("REMEDY");
  assert(remedyKeys.length > 10, `REMEDY parsed to ${remedyKeys.length} keys — the extractor still works`);
  let remedyNoWhy: string[] = [];
  for (let i = 0; i < remedyKeys.length; i++) if (!whyFor(remedyKeys[i], "engine")) remedyNoWhy.push(remedyKeys[i]);
  assert(remedyNoWhy.length === 0,
    remedyNoWhy.length === 0
      ? "every criterion with a remedy also has a rationale"
      : `remedy but no rationale: ${remedyNoWhy.join(", ")}`);

  // ── USED, and the NEGATIVE is the assertion that matters ─────────────────
  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  const flat = page.replace(/\s+/g, " ");
  assert(/mergeFindingSets\(\{ judge: withWhy\(judgeFindingsRef\.current, policy\.lens\)/.test(flat),
    "the merge site wraps the judge set in withWhy with the policy's lens");
  assert(!/judge: judgeFindingsRef\.current[,}]/.test(flat),
    "and no bare judge set survives anywhere — a second, unwrapped call site would satisfy the positive alone");

  // THE BYPASS: counted, not matched. A raw dispatch beside the merged one is a
  // second attach point that can only drift, and it was committing the
  // why-less set into React state whenever repaintLive early-returned.
  assert((page.match(/type: "set"/g) || []).length === 1,
    "exactly ONE 'set' dispatch of findings exists — the post-assess duplicate is gone");

  // THE REPAINT. A why derived at a merge site that nothing re-runs is a why
  // nobody sees: repaintLive was memoised on the lens but never called when it
  // changed, so turning AI checks ON changed no mark until the writer typed.
  // PINNED TO THE EXACT SHAPE, not to the call's presence.
  //
  // The first version of this assertion looked for "repaintLive()" anywhere
  // before the [policy.lens] dependency array, and a mutation that changed the
  // body to `if (false) repaintLive();` SURVIVED it — the call was still
  // written, and written is not run. A source regex cannot prove an effect
  // fires, so it pins the whole body instead: a guard, an extra statement or a
  // swapped dependency all fail, and there is nowhere to put a condition.
  assert(/useEffect\(\(\) => \{ repaintLive\(\); \}, \[policy\.lens\]\);/.test(flat),
    "an effect repaints on the lens flip, unconditionally — so the reasoning appears when it is switched on");
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };

  detects("an engine criterion classified as plain",
    criterionInLens("answer-first-position", "plain") === false);
  detects("an unregistered key shown anyway",
    criterionInLens("invented-key", "plain") === false && criterionInLens("invented-key", "engine") === false);
  detects("an optional lens parameter", buildLiveFindings.length === 3);
  detects("a disclosure that takes a reason", lensDisclosure.length === 0);
  detects("a disclosure naming a content type",
    lensDisclosure().toLowerCase().indexOf("cv") < 0);
  detects("an override beating a judge-off type",
    markPolicyFor({ surface: "writer", contentTypeId: "cv", override: "engine", hasTargetQueries: true }).lens === "plain");
  detects("a judge-off type advertised as raisable",
    markPolicyFor({ surface: "optimiser", contentTypeId: "cv", override: null, hasTargetQueries: false }).canRaise === false);
  detects("mergeFindingSets dropping talk",
    mergeFindingSets({ talk: [{ id: "talk:1" }] }).length === 1);
  detects("a content type accepted as a lens", normaliseLens("cv") === null);
  detects("the plain lens emitting nothing at all",
    keysFrom(COVER_LETTER, "test cover letter", "plain").length > 0);
  detects("the engine lens being silenced",
    keysFrom(COVER_LETTER, "test cover letter", "engine").length >
      keysFrom(COVER_LETTER, "test cover letter", "plain").length);
  {
    // The leak, reproduced: the old composition prefixed the criterion name.
    const oldStyle = (name: string, note: string, remedy: string) => `${name}: ${note}. ${remedy}`;
    detects("the criterion NAME leaking engine vocabulary into a plain mark",
      /cited/i.test(oldStyle("Mean sentence length near the cited norm", "45 words", "Split this into two.")));
  }
  {
    const mk = (id: string, status: any) => ({ finding: { id } as any, from: 1, to: 2, status });
    detects("a repaint resurrecting a dismissed finding",
      settledStatuses([mk("x", "dismissed")] as any)["x"] === "dismissed");
    detects("an active issue being frozen instead of recomputed",
      settledStatuses([mk("y", "active")] as any)["y"] === undefined);
  }
  {
    const n = (id: string, pos: number, status: any): ResolvedNote => ({ id, turn: 0, pos, status });
    detects("two markers stacked on one paragraph",
      markersFor([n("a", 5, "active"), n("b", 5, "active")]).length === 1);
    detects("an orphaned note drawn at position 0",
      markersFor([n("a", 0, "orphaned")]).length === 0);
  }
  detects("the word floor drifting from the score's",
    MIN_MARKABLE_WORDS === 60);

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

// ── 13. The CONVERSATION works under the same lens as the document ─────────
//
// Reported from real use, on a cover letter. The marks layer had correctly
// decided the piece was `plain` — mark-policy.ts was written FOR this document
// and cites it by name — and the Suggestions tab said so on screen. The Discuss
// panel was never told, so it went on talking about answer-engine citability
// over a private letter to one hiring manager, and the model had to talk its
// way out of the frame the product had handed it:
//
//   "a 38 here isn't a verdict on the writing, it's a mismatch of tool to task"
//
// That is the product making the model apologise for a number the product
// should not have quoted.
console.log("\n13. The conversation is told which lens it is under");
{
  const base = { title: "test cover letter", format: "article", grounding: "" };
  const plain = buildDiscussSystem({ ...base, lens: "plain" });
  const engine = buildDiscussSystem({ ...base, lens: "engine" });

  // The fixture's own precondition: the two must actually differ, or every
  // assertion below is about one string wearing two names.
  assert(plain !== engine, "the two lenses produce different prompts");

  assert(/NOT BEING OPTIMISED FOR AI ANSWER ENGINES/.test(plain), "a plain piece is declared as not being optimised for answer engines");
  assert(/Do not quote or reason about an optimisation score/.test(plain), "and the model is told not to quote the score");
  assert(/retrieval|citability/i.test(plain), "the plain block names the vocabulary it is ruling out");
  assert(/makes its case|evidence is specific/.test(plain), "and says what DOES apply, rather than only what does not");

  // The other half: the engine lens must not carry the plain block, or every
  // GEO article loses its frame.
  assert(!/NOT BEING OPTIMISED FOR AI ANSWER ENGINES/.test(engine), "an engine piece carries no such disclaimer");
  assert(buildDiscussSystem(base) === engine, "and an absent lens behaves exactly as engine did before it existed");

  // USED, not merely present, at all three joints.
  const route = read("app/api/optimizer/sessions/[id]/discuss/route.ts");
  assert(/buildDiscussSystem\(\{[\s\S]{0,200}lens,/.test(route), "the route passes a lens into the prompt");
  assert(/const clientLens = normaliseLens\(body\.lens\)/.test(route), "taken from the client, through normaliseLens rather than raw");
  assert(/markPolicyFor\(\{/.test(route), "with a server-side fallback from the same policy the marks use");
  // The near-miss that would route every optimiser session down the Writer
  // branch: the column holds the American spelling, markPolicyFor takes the
  // British one.
  assert(/String\(session\.type_surface\) === "writer" \? "writer" : "optimiser"/.test(route),
    "and maps type_surface explicitly, because the database spells it optimizer and the policy spells it optimiser");

  const panel = read("components/optimizer/DiscussPanel.tsx");
  assert(/selection: selection \|\| null,\n[\s\S]{0,400}\n\s*lens,/.test(panel), "the panel sends its lens with the question");
  const page = read("app/engineai/optimizer/page.tsx");
  // Bounded to the DiscussPanel's OWN props. `lens={policy.lens}` appears twice
  // in this file — the other is a different panel — so an unbounded match let a
  // hardcoded lens on the conversation survive a mutation run while the
  // assertion went green on the other component's prop.
  const at = page.indexOf("<DiscussPanel");
  assert(at > 0, "the DiscussPanel element was located");
  const props = page.slice(at, page.indexOf("/>", at));
  assert(/lens=\{policy\.lens\}/.test(props), "and the conversation gets the SAME policy object the marks and the score read");
  assert(!/lens=\{"/.test(props), "not a literal of its own");
}

// ── 14. Clear leaves something to press ────────────────────────────────────
//
// Both Re-analyse and Clear are gated on there being turns, so clearing the
// conversation removed the one control a writer wants next. Reported by someone
// who had just pasted a revised draft in and wanted it read.
console.log("\n14. An empty conversation offers a way back in");
{
  const panel = read("components/optimizer/DiscussPanel.tsx");
  assert(/const analyse = useCallback/.test(panel), "there is a first-pass analyse action");
  assert(/onClick=\{analyse\}/.test(panel), "the empty state calls it");
  assert(/Read the whole piece/.test(panel), "and says what it does");

  // Distinct from re-analyse, and the difference matters: re-analyse tells the
  // model to take account of its earlier notes, which a cleared conversation
  // does not have.
  const analyseBody = panel.slice(panel.indexOf("const analyse = useCallback"), panel.indexOf("const reanalyse = useCallback"));
  assert(!/already changed since your earlier notes/.test(analyseBody),
    "and does not tell a model with no earlier notes to take account of them");
  const reBody = panel.slice(panel.indexOf("const reanalyse = useCallback"), panel.indexOf("const reanalyse = useCallback") + 900);
  assert(/already changed since your earlier notes/.test(reBody), "while re-analyse still does, which is what makes them two functions");
}

console.log(failures === 0 ? "\n✓ lens checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
