/**
 * The free annotation layer, checked by making it fail.
 *
 * This layer paints marks on a writer's own words with no model in the loop, so
 * its failures are quiet by nature: a span off by a few characters underlines
 * half a word, a span computed against a different string underlines something
 * unrelated, and both look like "the highlighting is a bit odd" rather than a
 * bug. It has already cost this feature once — the whole reason inline marks
 * were missing was that anchoring failed silently and reported an empty result.
 *
 * THE COUPLING THIS EXISTS TO PROTECT: engine spans are offsets into
 * ParsedDraft.text, and NOTHING in the type system says so. Pass any other
 * derivation of the draft — the raw HTML, the editor's getHTML(), a trimmed
 * copy — and every quote comes out subtly wrong while every type checks. §2
 * asserts the slices against the text they claim to index.
 *
 *   npx tsx scripts/verify-optimizer-live.ts
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the shared
 * tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  prefix taken from the wrong side of the quote  → 3 fail  ✓
 *   2026-08-21  out-of-range span guard removed                → 1 fail  ✓ (3rd try)
 *   2026-08-21  id keyed on array index, not text position     → 1 fail  ✓ (4th try)
 *   2026-08-21  a suggested rewrite is offered                 → 1 fail  ✓
 *   2026-08-21  unsourced statistics demoted to low severity   → 1 fail  ✓
 *   2026-08-21  engine stops emitting spans entirely           → 4 fail  ✓
 *   2026-08-21  MAX_SPANS_PER_CRITERION cap removed  → SURVIVED, see below
 *   (baseline, unmutated: exit 0)
 *
 * TWO OF THESE TOOK SEVERAL ATTEMPTS, and the reasons are worth more than the
 * kills. Both times the check named a real rule, passed, and proved nothing.
 *
 *   THE RANGE GUARD (three attempts). "Is the quote a substring?" cannot see
 *   the bug, because String.slice() CLAMPS — a span running past the end yields
 *   a shorter quote that is still a valid substring. Truncating the text
 *   arbitrarily also failed: a span lying entirely past the end slices to "" and
 *   a different guard catches it. Only a span STRADDLING the boundary exercises
 *   the range check, so §3 now constructs one deliberately.
 *
 *   THE ID SCHEME (four attempts). An identical recompute cannot separate a
 *   position-keyed id from an index-keyed one — same input, same order, same
 *   ids either way. The property that separates them is that an id must never
 *   be REUSED for different text, and testing it needs an edit that shifts
 *   indices while leaving at least one offset alone. Prepending shifted every
 *   offset (nothing shared to compare); inserting near the end shifted no index
 *   (the only unsourced statistics were already above it). Inserting straight
 *   after the first heading does both, which is why §4's fixture is built the
 *   way it is and must not be casually "tidied".
 *
 * THE SURVIVOR: removing the per-criterion span cap changes nothing here,
 * because the fixture never produces more than eight spans for one criterion.
 * That cap is a readability judgement rather than a correctness property — it
 * stops a draft with fifty long sentences turning the editor into wallpaper —
 * and it is recorded as untested rather than papered over with a fixture built
 * only to satisfy it.

 * LENS PARAMETER (2026-08-26). Every call here passes "engine" deliberately:
 * these assertions were earned against the full criterion set, and running them
 * on the plain lens would silently narrow what they cover while staying green.
 * The lens's own behaviour is asserted in verify-optimizer-lens.ts, including
 * that the engine lens still emits everything this file expects.
 */
import { parseDraft } from "../lib/optimizer/parse";
import { computeDraftScores } from "../lib/optimizer/engine";
import { buildLiveFindings, isLiveFinding } from "../lib/optimizer/live-issues";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

/** Everything is fictional — Vaultline, Nordvale, Kessler are invented, as in
 *  the other fixtures, so no fabricated statistic is ever attributed to a real
 *  institution in this repo. */
const DRAFT = [
  "<h2>Payment orchestration</h2>",
  "<p>Adoption reached 38% last year and the market grew to EUR 5 million.</p>",
  "<p>In today's rapidly evolving landscape, organisations seeking to leverage payment orchestration must navigate a genuinely remarkable number of competing considerations before they can realistically hope to arrive at anything resembling a defensible architectural decision that survives contact with production traffic.</p>",
  "<h2>What the data shows</h2>",
  "<p>Kessler Institute reports 62% uptake. This is not just a trend — it is a shift.</p>",
].join("");

const parsed = parseDraft({ body: DRAFT, title: "Payment orchestration" });
const scores = computeDraftScores({
  body: DRAFT, title: "Payment orchestration", targetQueries: ["payment orchestration"], format: "explainer",
});
const findings = buildLiveFindings(scores, parsed.text, "engine");

// ── 1. The fixture exercises the thing ───────────────────────────────────
console.log(`\n1. Preconditions`);
{
  // Without this, every assertion below passes over an empty array and the
  // whole script reports green while proving nothing. This is the exact
  // failure mode the other scripts in this directory keep rediscovering.
  findings.length >= 3
    ? pass(`the fixture produces ${findings.length} live findings`)
    : fail(`only ${findings.length} finding(s) — every section below would pass over an empty array and prove nothing`);

  const criteria: { [k: string]: true } = {};
  for (let i = 0; i < findings.length; i++) criteria[findings[i].criterion] = true;
  const distinct = Object.keys(criteria);
  distinct.length >= 2
    ? pass(`spanning ${distinct.length} criteria: ${distinct.join(", ")}`)
    : fail(`all findings come from one criterion — the conversion is only exercised once`);

  // And the engine must genuinely be emitting spans, or this is testing the
  // empty case of a function that never receives input.
  let withSpans = 0;
  for (let pi = 0; pi < scores.pillars.length; pi++) {
    const cs = scores.pillars[pi].criteria;
    for (let ci = 0; ci < cs.length; ci++) if (cs[ci].spans && cs[ci].spans!.length) withSpans++;
  }
  withSpans >= 2
    ? pass(`${withSpans} criteria carry spans out of the engine`)
    : fail(`only ${withSpans} criterion emits spans — the engine half is barely covered`);
}

// ── 2. The coupling: quotes must be slices of the text they index ────────
console.log(`\n2. Every quote is a real slice of ParsedDraft.text`);
{
  let mismatched = 0;
  let notFound = 0;
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (parsed.text.indexOf(f.quote) < 0) {
      notFound++;
      if (notFound <= 3) fail(`quote not present in the text at all: ${JSON.stringify(f.quote.slice(0, 50))}`);
    }
    // The prefix and suffix must ABUT the quote in the source, or the anchor's
    // context check rejects its own finding.
    const at = parsed.text.indexOf(f.prefix + f.quote + f.suffix);
    if (at < 0) {
      mismatched++;
      if (mismatched <= 3) {
        fail(
          `prefix+quote+suffix is not a contiguous run of the text — the anchor cannot match its own context\n` +
          `          quote:  ${JSON.stringify(f.quote.slice(0, 40))}\n` +
          `          prefix: ${JSON.stringify(f.prefix)}`
        );
      }
    }
  }
  notFound === 0 ? pass(`all ${findings.length} quotes are present in the text`) : null;
  mismatched === 0 ? pass("every prefix + quote + suffix is contiguous in the source") : null;
}

// ── 3. Passing a DIFFERENT string must not produce garbage ───────────────
console.log(`\n3. The wrong string is refused, not silently mis-anchored`);
{
  // The realistic mistake: handing it the raw HTML instead of the parsed text.
  // Offsets computed against one and sliced from the other produce quotes that
  // are real strings, type-check fine, and mean nothing.
  const wrong = buildLiveFindings(scores, DRAFT, "engine");
  let bogus = 0;
  for (let i = 0; i < wrong.length; i++) if (parsed.text.indexOf(wrong[i].quote) < 0) bogus++;

  // Precondition: the two strings must actually differ, or this proves nothing.
  DRAFT !== parsed.text
    ? pass("the html and the parsed text genuinely differ")
    : fail("the fixture's html and parsed text are identical — section 3 cannot detect a wrong-string bug");

  // Out-of-range spans must be DROPPED, not clamped.
  //
  // Two earlier versions of this could not detect the bug, and both are worth
  // recording. Asking "is the quote a substring?" fails because String.slice()
  // clamps — a span running past the end yields a SHORTER quote that is still a
  // valid substring. Truncating the text arbitrarily also fails, because a span
  // lying entirely past the end slices to "" and a different guard drops it.
  //
  // The only case that exercises the range check is a span STRADDLING the end,
  // so the fixture is built to straddle one deliberately.
  const firstSpan = (() => {
    for (let pi = 0; pi < scores.pillars.length; pi++) {
      const cs = scores.pillars[pi].criteria;
      for (let ci = 0; ci < cs.length; ci++) {
        const sp = cs[ci].spans || [];
        // Needs room on both sides, or it cannot straddle.
        for (let k = 0; k < sp.length; k++) if (sp[k].end - sp[k].start >= 4) return sp[k];
      }
    }
    return null;
  })();

  if (!firstSpan) {
    fail("no span is long enough to straddle a boundary — the range guard cannot be exercised");
  } else {
    const cut = firstSpan.start + 2;           // inside the span, so it straddles
    const straddled = parsed.text.slice(0, cut);
    cut > firstSpan.start && cut < firstSpan.end
      ? pass(`the truncation at ${cut} genuinely straddles a span (${firstSpan.start}-${firstSpan.end})`)
      : fail("the truncation does not straddle the span — the range guard is not reached");

    const out = buildLiveFindings(scores, straddled, "engine");
    // Every surviving finding must be exactly as long as its span claimed. A
    // clamped one is shorter, and that is the whole defect.
    let clamped = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i].quote !== straddled.slice(0, straddled.length) && out[i].quote.length === 0) continue;
      if (straddled.indexOf(out[i].quote) < 0) { clamped++; continue; }
    }
    const straddlingSurvived = out.filter(
      (f) => f.quote.length > 0 && straddled.slice(firstSpan.start).indexOf(f.quote) === 0
    ).length;
    straddlingSurvived === 0 && clamped === 0
      ? pass("a span straddling the end of the text is rejected, not clamped to a fragment")
      : fail(
          `a straddling span produced a finding — the quote is a truncated fragment of what the span described ` +
          `(${straddlingSurvived} straddling, ${clamped} not found)`
        );
  }

  bogus > 0
    ? pass(`passing the wrong string produces ${bogus} quote(s) that are NOT in the parsed text — detectable, not silent`)
    : pass("passing the html happens to produce only valid slices here (weak signal, not a failure)");
}

// ── 4. Ids are stable, so a dismissal survives an edit elsewhere ─────────
console.log(`\n4. Identity`);
{
  const again = buildLiveFindings(scores, parsed.text, "engine");
  let sameIds = true;
  if (again.length !== findings.length) sameIds = false;
  else for (let i = 0; i < again.length; i++) if (again[i].id !== findings[i].id) sameIds = false;
  sameIds
    ? pass("recomputing the same draft yields identical ids — a dismissed mark stays dismissed")
    : fail("ids changed across an identical recompute — every dismissal would resurrect on the next keystroke");

  // The identical-recompute check above is weak on its own: an id built from
  // the array INDEX also survives it, because the same input produces the same
  // order. The property that matters is that an id tracks the TEXT, so adding
  // an issue earlier in the draft does not renumber the ones after it — which
  // is exactly what would resurrect every dismissal on the next edit.
  // Inserted in the MIDDLE, not at the start, and the distinction is the whole
  // point. Prepending shifts every offset, so no id is shared between the runs
  // and the reuse check below passes over nothing — its own precondition caught
  // that. An insertion partway down leaves the marks ABOVE it untouched, which
  // is the only shape where a position-keyed id and an index-keyed one behave
  // differently.
  //
  // The insertion point is load-bearing and took three attempts to get right.
  // It must land AHEAD of the marks whose index would shift, while leaving at
  // least one mark's OFFSET untouched — otherwise one of the two schemes has
  // nothing shared to compare and the check passes vacuously. Placing it after
  // the first heading does both: the heading keeps its offset (so an id IS
  // shared under either scheme) while every statistic after it shifts by one
  // position (so an index-keyed id would be reused for different text).
  //
  // Earlier attempts failed for instructive reasons: prepending shifted every
  // offset, so nothing was shared; inserting near the end shifted no index,
  // because the only unsourced statistics were already above it.
  const withEarlier =
    DRAFT.replace(
      "<h2>Payment orchestration</h2>",
      "<h2>Payment orchestration</h2><p>Growth hit 12% in Q1.</p>"
    );
  const p2 = parseDraft({ body: withEarlier, title: "Payment orchestration" });
  const s2 = computeDraftScores({
    body: withEarlier, title: "Payment orchestration",
    targetQueries: ["payment orchestration"], format: "explainer",
  });
  const f2 = buildLiveFindings(s2, p2.text, "engine");
  // Precondition: the edit must actually add a finding ahead of the others.
  f2.length > findings.length
    ? pass(`inserting text earlier adds ${f2.length - findings.length} finding(s), so renumbering is possible`)
    : fail("the edit added no finding — this cannot detect index-based ids");

  // An id keyed on offsets legitimately changes when text shifts, so what is
  // asserted is that the CRITERION and QUOTE still identify the same mark.
  let survived = 0;
  for (let i = 0; i < findings.length; i++) {
    const orig = findings[i];
    for (let j = 0; j < f2.length; j++) {
      if (f2[j].criterion === orig.criterion && f2[j].quote === orig.quote) { survived++; break; }
    }
  }
  survived === findings.length
    ? pass(`all ${findings.length} original marks are still identifiable after an edit above them`)
    : fail(`${findings.length - survived} mark(s) lost their identity when text was inserted earlier`);

  // THE SAFETY PROPERTY, and the one that separates a position-keyed id from an
  // index-keyed one. Both survive an identical recompute, so that check cannot
  // tell them apart — a mutation proved it.
  //
  // With offsets, inserting text above a mark gives it a NEW id, and a stale
  // dismissal is simply lost. Mildly annoying, and safe. With an array index,
  // the id stays the SAME while now referring to a DIFFERENT mark — so
  // dismissing one issue silently dismisses an unrelated one, and the writer
  // never learns which. An id may be forgotten; it must never be REUSED.
  const byId: { [k: string]: string } = {};
  for (let i = 0; i < findings.length; i++) byId[findings[i].id] = findings[i].quote;
  let reused = 0;
  for (let i = 0; i < f2.length; i++) {
    const prevQuote = byId[f2[i].id];
    if (prevQuote !== undefined && prevQuote !== f2[i].quote) {
      reused++;
      if (reused === 1) {
        fail(
          `an id now points at different text than before the edit — dismissing one mark would dismiss another\n` +
          `          id:     ${f2[i].id}\n` +
          `          was:    ${JSON.stringify(prevQuote.slice(0, 40))}\n` +
          `          is now: ${JSON.stringify(f2[i].quote.slice(0, 40))}`
        );
      }
    }
  }
  reused === 0 ? pass("no id was reused for different text after an edit") : null;

  // Precondition: some id must actually be shared across the two runs, or there
  // is nothing to reuse and this passes vacuously.
  let shared = 0;
  for (let i = 0; i < f2.length; i++) if (byId[f2[i].id] !== undefined) shared++;
  shared > 0
    ? pass(`${shared} id(s) appear in both runs, so reuse is genuinely possible`)
    : fail("no id is shared between the two runs — the reuse check passes over nothing");

  let allLive = true;
  for (let i = 0; i < findings.length; i++) if (!isLiveFinding(findings[i])) allLive = false;
  allLive
    ? pass("every finding is identifiable as live, so the two layers can be told apart")
    : fail("a finding is not recognised as live — it would be mistaken for judge output");

  const ids: { [k: string]: number } = {};
  for (let i = 0; i < findings.length; i++) ids[findings[i].id] = (ids[findings[i].id] || 0) + 1;
  let dupes = 0;
  const keys = Object.keys(ids);
  for (let i = 0; i < keys.length; i++) if (ids[keys[i]] > 1) dupes++;
  dupes === 0
    ? pass("no two findings share an id")
    : fail(`${dupes} id(s) are duplicated — dismissing one would dismiss another`);
}

// ── 5. The fabrication guard ─────────────────────────────────────────────
console.log(`\n5. Deterministic findings never propose prose`);
{
  // The deepest failure this product could have is one click putting invented
  // words into a client's published content. This layer runs no model, so it
  // cannot know what a sentence SHOULD say — and must never imply that it does.
  let withEdit = 0;
  for (let i = 0; i < findings.length; i++) if (findings[i].suggestedEdit !== null) withEdit++;
  withEdit === 0
    ? pass(`all ${findings.length} findings carry suggestedEdit: null`)
    : fail(`${withEdit} finding(s) propose replacement text — this layer runs no model and cannot know what the text should say`);

  // Every finding must still tell the writer what to DO. A highlight with no
  // remedy is criticism, not a tool.
  let empty = 0;
  for (let i = 0; i < findings.length; i++) if (!findings[i].explanation || findings[i].explanation.length < 20) empty++;
  empty === 0
    ? pass("every finding carries an explanation with a remedy in it")
    : fail(`${empty} finding(s) have no usable explanation`);
}

// ── 6. Severity is meaningful ────────────────────────────────────────────
console.log(`\n6. Severity`);
{
  // An unsourced statistic is the defect that actually stops an engine citing a
  // passage. If it ever ranks equal to a long sentence, the colour stops
  // carrying information.
  const stat = findings.filter((f) => f.criterion === "stat-source-adjacency");
  const long = findings.filter((f) => f.criterion === "sentence-length-norm");
  stat.length > 0
    ? pass(`${stat.length} unsourced-statistic finding(s) in the fixture`)
    : fail("the fixture contains no unsourced statistic — severity ranking is untested");
  stat.every((f) => f.severity === "high")
    ? pass("unsourced statistics are high severity")
    : fail("an unsourced statistic is not high severity — the most citation-relevant defect reads as minor");
  long.every((f) => f.severity !== "high")
    ? pass("a long sentence is not high severity")
    : fail("a long sentence ranks as high — if everything is urgent, nothing is");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
