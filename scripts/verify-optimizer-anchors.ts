/**
 * Span anchoring, checked by trying to break it.
 *
 * This is the module where a bug is most expensive in the Content Optimizer:
 * an anchor that resolves to the wrong span does not throw, does not look
 * wrong, and then REWRITES a sentence the writer never asked to change. Every
 * other failure in the studio is visible; this one is not.
 *
 * So the assertions below are mostly about REFUSING. It is easy to write a
 * matcher that always finds something — `indexOf` with a similarity fallback
 * will anchor almost any quote to almost any document. The checks that matter
 * here are the ones proving it declines: ambiguous repeats, edited text, a
 * paraphrased quote the model did not copy verbatim.
 *
 *   npx tsx scripts/verify-optimizer-anchors.ts
 *
 * MUTATION LOG — every entry actually run, in a throwaway git worktree and
 * never the shared tree (vercel deploy --prod uploads the working directory,
 * so a deliberate break left in it can ship):
 *   2026-08-21  accept the first hit when ambiguous  → 2 failures, exit 1  ✓
 *   2026-08-21  drop the offset map in normalisation → 1 failure,  exit 1  ✓
 *   2026-08-21  add a substring-similarity fallback  → 2 failures, exit 1  ✓
 *   2026-08-21  skip the overlap check in anchorAll  → 1 failure,  exit 1  ✓
 *   (baseline, unmutated: 0 failures, exit 0)
 *
 * The third one is the mutation worth re-running whenever this file changes.
 * "Anchor to the nearest long word" is a genuinely tempting improvement — it
 * makes orphans disappear, which looks like progress — and it is precisely the
 * change that turns a paraphrased quote into a rewrite of text the model never
 * quoted.
 */
import { findAnchor, validateAnchor, anchorAll, MAX_QUOTE_LENGTH } from "../lib/optimizer/anchors";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const DOC = [
  "Payment orchestration routes each transaction to the acquirer most likely to authorise it.",
  "",
  "Authorisation rates improve by roughly 4% once a fallback route is live, according to the Nordvale Treasury Benchmark.",
  "",
  "Merchants below EUR 5 million rarely recover the cost. The fee outruns the benefit.",
  "",
  "The fee outruns the benefit at low volume, which is why the threshold matters.",
].join("\n");

console.log("\nverify-optimizer-anchors\n");

// ── 1. It finds what is there ──
console.log("1. Anchoring text that is present");
{
  const m = findAnchor(DOC, { quote: "roughly 4% once a fallback route is live" });
  m.ok && DOC.slice(m.start, m.end) === "roughly 4% once a fallback route is live"
    ? pass(`exact match resolves to the right span (confidence "${m.ok ? m.confidence : ""}")`)
    : fail("an unambiguous quote did not anchor", JSON.stringify(m));

  const first = findAnchor(DOC, { quote: "Payment orchestration routes" });
  first.ok && first.start === 0
    ? pass("a quote at position 0 anchors (falsy-index bug check)")
    : fail("a quote at the very start of the document did not anchor", JSON.stringify(first));
}

// ── 2. It refuses when it cannot tell ──
console.log("\n2. Refusing rather than guessing");
{
  // "The fee outruns the benefit" appears twice, with nothing to separate them.
  const ambiguous = findAnchor(DOC, { quote: "The fee outruns the benefit" });
  !ambiguous.ok && ambiguous.reason === "ambiguous"
    ? pass("a quote appearing twice with no context is refused, not guessed")
    : fail(
        "an ambiguous quote was anchored anyway",
        "This is the dangerous case: applying a rewrite here edits whichever copy the matcher happened to hit first."
      );

  // The same quote, disambiguated by what follows it.
  const disambiguated = findAnchor(DOC, {
    quote: "The fee outruns the benefit",
    suffix: " at low volume, which is why",
  });
  disambiguated.ok && disambiguated.start > 200
    ? pass("the same quote anchors once a suffix identifies which occurrence")
    : fail("context did not disambiguate a repeated quote", JSON.stringify(disambiguated));

  const gone = findAnchor(DOC, { quote: "a sentence the writer has since deleted entirely" });
  !gone.ok && gone.reason === "not_found"
    ? pass("text that is no longer in the document is reported not_found")
    : fail("a deleted quote matched something", JSON.stringify(gone));

  // The single most likely real-world failure: the judge paraphrases instead
  // of copying. A similarity-based matcher would happily anchor this.
  const paraphrased = findAnchor(DOC, { quote: "Authorization rates get better by around 4 percent" });
  !paraphrased.ok
    ? pass("a paraphrase of real text is refused (no similarity fallback)")
    : fail(
        "a paraphrased quote was anchored",
        "There is a fuzzy-matching path in findAnchor. A model that paraphrases will now silently rewrite text it never quoted."
      );
}

// ── 3. Normalisation, and its offset map ──
console.log("\n3. Typographic normalisation without offset drift");
{
  const typographic = 'She said “the uplift is real” and left.';
  // The model returned straight quotes where the document has curly ones.
  const m = findAnchor(typographic, { quote: '"the uplift is real"' });
  if (!m.ok) {
    fail("a straight-quote version of curly-quoted text did not anchor", JSON.stringify(m));
  } else {
    const got = typographic.slice(m.start, m.end);
    got === "“the uplift is real”"
      ? pass("smart quotes match straight quotes AND the span maps back correctly")
      : fail(
          `normalised match returned the wrong span: ${JSON.stringify(got)}`,
          "The offset map is wrong. Normalisation collapses characters, so a normalised index is not a source index — this is how a 'fallback' silently anchors off by a few characters."
        );
  }

  // Collapsed whitespace is the case that actually shifts offsets.
  const spaced = "The   fee    outruns     the benefit here.";
  const w = findAnchor(spaced, { quote: "The fee outruns the benefit" });
  if (!w.ok) {
    fail("whitespace-normalised text did not anchor", JSON.stringify(w));
  } else {
    const got = spaced.slice(w.start, w.end);
    got === "The   fee    outruns     the benefit"
      ? pass("collapsed whitespace maps back to the full original span")
      : fail(`whitespace mapping returned ${JSON.stringify(got)}`, "Offsets drift by the number of collapsed spaces.");
  }
}

// ── 4. Survives edits elsewhere ──
console.log("\n4. Surviving edits above and below the span");
{
  const edited = "A new opening paragraph the writer just added.\n\n" + DOC;
  const m = findAnchor(edited, { quote: "roughly 4% once a fallback route is live" });
  m.ok && edited.slice(m.start, m.end) === "roughly 4% once a fallback route is live"
    ? pass("inserting text ABOVE the span still resolves correctly (offsets would have rotted)")
    : fail("an edit above the span broke the anchor", JSON.stringify(m));

  const trimmed = DOC.replace("Merchants below EUR 5 million rarely recover the cost. ", "");
  const after = findAnchor(trimmed, { quote: "roughly 4% once a fallback route is live" });
  after.ok
    ? pass("deleting an unrelated sentence does not break other anchors")
    : fail("deleting unrelated text orphaned an unrelated finding", JSON.stringify(after));

  // Editing INSIDE the span must orphan it — this is the guard that stops an
  // Apply from overwriting words the writer has since changed.
  const inside = DOC.replace("roughly 4%", "roughly 6%");
  const changed = findAnchor(inside, { quote: "roughly 4% once a fallback route is live" });
  !changed.ok
    ? pass("editing INSIDE the span orphans the finding rather than rewriting the writer's change")
    : fail("a finding still anchored after its own text was edited", "Applying it would discard the writer's edit.");
}

// ── 5. The judge's output contract ──
console.log("\n5. The contract, checked on the way in");
{
  const cases: { anchor: any; shouldPass: boolean; why: string }[] = [
    { anchor: { quote: "a normal short quote" }, shouldPass: true, why: "a plain quote" },
    { anchor: { quote: "" }, shouldPass: false, why: "empty quote" },
    { anchor: { quote: "   " }, shouldPass: false, why: "whitespace-only quote" },
    { anchor: { quote: "x".repeat(MAX_QUOTE_LENGTH + 1) }, shouldPass: false, why: "over the length cap" },
    { anchor: { quote: "the start … the end" }, shouldPass: false, why: "elided with an ellipsis character" },
    { anchor: { quote: "the start ... the end" }, shouldPass: false, why: "elided with three dots" },
    { anchor: { quote: "one para\n\nanother para" }, shouldPass: false, why: "spans a paragraph boundary" },
  ];
  let bad = 0;
  for (const c of cases) {
    const r = validateAnchor(c.anchor);
    if (r.ok !== c.shouldPass) {
      bad++;
      fail(`validateAnchor got ${c.why} wrong`, c.shouldPass ? "should have been accepted" : "should have been rejected");
    }
  }
  if (!bad) pass(`all ${cases.length} contract cases behave (empty, over-length, elided, multi-paragraph)`);
}

// ── 6. Several findings at once ──
console.log("\n6. Anchoring a whole assessment");
{
  const findings = [
    { id: "a", quote: "roughly 4% once a fallback route is live" },
    { id: "b", quote: "Merchants below EUR 5 million rarely recover the cost" },
    { id: "c", quote: "a claim that is no longer in the draft at all" },
    { id: "d", quote: "The fee outruns the benefit" }, // ambiguous
  ];
  const anchored = anchorAll(DOC, findings);

  anchored.length === findings.length
    ? pass("every finding comes back, anchored or orphaned — none silently dropped")
    : fail(`${anchored.length} of ${findings.length} findings returned`, "An orphan must still reach the panel; the finding is true even when its location is lost.");

  const byId: any = {};
  for (const a of anchored) byId[(a.finding as any).id] = a;

  byId.a && !byId.a.orphaned ? pass("a resolvable finding is anchored") : fail("finding 'a' should have anchored");
  byId.c && byId.c.orphaned ? pass("a deleted quote is marked orphaned, not dropped") : fail("finding 'c' should be orphaned");
  byId.d && byId.d.orphaned ? pass("an ambiguous quote is orphaned rather than placed arbitrarily") : fail("finding 'd' should be orphaned");

  // Nested quotes: the shorter must not steal the longer one's region.
  const nested = anchorAll(DOC, [
    { id: "long", quote: "Authorisation rates improve by roughly 4% once a fallback route is live" },
    { id: "short", quote: "roughly 4%" },
  ]);
  const longOne = nested.filter((n) => (n.finding as any).id === "long")[0];
  const shortOne = nested.filter((n) => (n.finding as any).id === "short")[0];
  longOne && !longOne.orphaned && shortOne && shortOne.orphaned
    ? pass("a nested shorter quote yields to the longer finding it sits inside")
    : fail(
        "overlapping findings both claimed a span",
        "Two highlights over the same words means at least one Apply would edit text the other finding described."
      );
}

// ── 7. Degenerate input ──
console.log("\n7. Degenerate input");
{
  let broke = 0;
  const inputs: [string, any][] = [
    ["", { quote: "anything" }],
    ["some text", { quote: "" }],
    ["some text", {}],
    ["some text", { quote: "text", prefix: undefined, suffix: undefined }],
  ];
  for (const [text, anchor] of inputs) {
    try {
      const r = findAnchor(text, anchor);
      if (typeof r !== "object" || typeof (r as any).ok !== "boolean") { broke++; fail("findAnchor returned a malformed result"); }
    } catch (e) {
      broke++;
      fail("findAnchor threw on degenerate input", String(e));
    }
  }
  if (!broke) pass("empty documents, empty quotes and missing fields are handled without throwing");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
