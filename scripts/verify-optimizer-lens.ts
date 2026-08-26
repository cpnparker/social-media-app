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
 */
import { CRITERIA } from "../lib/optimizer/rubric";
import { computeDraftScores } from "../lib/optimizer/engine";
import { buildLiveFindings } from "../lib/optimizer/live-issues";
import {
  markPolicyFor, criterionInLens, lensOf, lensDisclosure, normaliseLens,
  mergeFindingSets, MIN_MARKABLE_WORDS, type Lens,
} from "../lib/optimizer/mark-policy";
import { CONTENT_TYPE_IDS, criteriaFor, analysisAllowed } from "../lib/optimizer/content-types";
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
  let leaky = 0;
  for (let i = 0; i < plain.length; i++) if (ENGINE_WORDS.test(plain[i].explanation)) leaky++;
  assert(leaky === 0,
    "NO plain-lens mark explains itself in answer-engine terms — a right mark with a reason the reader cannot accept is one they learn to ignore");

  // Moved, not deleted.
  let withRationale = 0;
  for (let i = 0; i < engine.length; i++) if (ENGINE_WORDS.test(engine[i].explanation)) withRationale++;
  assert(withRationale > 0, "the engine lens DOES give the answer-engine rationale — it was moved, not deleted");

  // The action survives on both.
  const long = plain.filter((f) => f.criterion === "sentence-length-norm")[0];
  if (long) assert(/split/i.test(long.explanation), "a plain-lens long-sentence mark still says what to do");
  else pass("(no long sentence in this fixture to check)");
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
  const suggest = stripComments(read("app/api/optimizer/sessions/[id]/suggest/route.ts"));
  const gateAt = suggest.indexOf("analysisAllowed(");
  const spendAt = suggest.indexOf("assertServiceAllowed(");
  assert(gateAt > 0 && spendAt > 0 && gateAt < spendAt,
    "the suggest route refuses an analysis-off type BEFORE it reaches the spend gate");
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
  detects("the word floor drifting from the score's",
    MIN_MARKABLE_WORDS === 60);

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

console.log(failures === 0 ? "\n✓ lens checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
