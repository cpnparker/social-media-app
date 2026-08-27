/**
 * One-slide deck edits: that they APPLY, and that a failure is LOUD.
 *
 * WHY THIS EXISTS. On 2026-08-27 a user asked Engine AI to add a slide after
 * slide 5. The model called generate_slides, wrote a confident description of
 * the new slide and what was on it, and the deck never changed — both drafts
 * saved in that thread are byte-identical, eight slides, no new slide. Two
 * faults, and they compounded:
 *
 *   1. editSlide could only PATCH an existing slide. There was no insert, so
 *      "add a slide" was structurally impossible.
 *   2. applyEditSlide returned the deck UNCHANGED when it could not apply the
 *      edit. A silent no-op is indistinguishable from success — the route saved
 *      the untouched deck and the model narrated a change that never happened.
 *
 * So this check asserts the SHAPE OF THE RESULT, never merely that nothing
 * threw. A check that only proved "no error" would pass against the exact code
 * this replaces, which returned the deck unchanged and raised nothing.
 *
 * MUTATION LOG
 * - Restoring `if (idx < 0 || idx >= slides.length) return slides;` in place of
 *   the throw turns checks 5 and 6 red ("expected a throw, deck came back
 *   unchanged"). This is the production bug; it is the reason the file exists.
 * - Deleting the insert branch turns 1-4 red.
 * - Weakening check 2 to `slides.length === 9` alone still passes if the slide
 *   is appended at the END rather than inserted at the index asked for — which
 *   is why 2 pins the POSITION and 3 pins the neighbours. "The deck grew" is
 *   not the same claim as "the slide went where it was asked for".
 */
import { applyEditSlide, unrenderableSlides } from "../lib/slides/edit";
import { deleteSlide } from "../lib/slides/draft-edit";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** A deck standing in for the real one: eight slides, distinct titles. */
function deck(): any[] {
  const out: any[] = [];
  for (let i = 1; i <= 8; i++) out.push({ layout: "content", title: `Slide ${i}`, body: `Body ${i}` });
  return out;
}

/** Runs `fn`, returning the thrown Error or null. Never swallows. */
function thrown(fn: () => any): Error | null {
  try { fn(); return null; } catch (e: any) { return e; }
}

console.log("\nSlide edit: insert, patch, and loud failure\n");

// ── 1. Insert grows the deck ────────────────────────────────────────────────
console.log("1. Inserting adds exactly one slide");
{
  const before = deck();
  const after = applyEditSlide(before, { insertAfter: 5, title: "New", body: "B" });
  if (after.length !== before.length + 1) fail(`expected ${before.length + 1} slides, got ${after.length}`);
  else if (before.length !== 8) fail("the input deck was mutated in place");
  else pass(`8 slides + 1 insert = ${after.length}`);
}

// ── 2. It lands where it was ASKED for, not merely somewhere ────────────────
console.log("\n2. The new slide lands at the requested index");
{
  const after = applyEditSlide(deck(), { insertAfter: 5, title: "INSERTED", body: "B" });
  // insertAfter:5 means it becomes slide 6, i.e. index 5.
  if (after[5]?.title !== "INSERTED") {
    const at = after.findIndex((s: any) => s.title === "INSERTED");
    fail(`asked for position 6, landed at position ${at + 1}`);
  } else pass("insertAfter:5 puts it at slide 6");
}

// ── 3. Its neighbours are untouched, and nothing else moved ─────────────────
console.log("\n3. Every other slide survives, in order");
{
  const after = applyEditSlide(deck(), { insertAfter: 5, title: "INSERTED", body: "B" });
  if (after[4]?.title !== "Slide 5") fail(`slide 5 should still precede it, found ${JSON.stringify(after[4]?.title)}`);
  else if (after[6]?.title !== "Slide 6") fail(`old slide 6 should follow it, found ${JSON.stringify(after[6]?.title)}`);
  else {
    const originals = after.filter((s: any) => s.title !== "INSERTED").map((s: any) => s.title).join(",");
    if (originals !== "Slide 1,Slide 2,Slide 3,Slide 4,Slide 5,Slide 6,Slide 7,Slide 8")
      fail(`original slides reordered or lost: ${originals}`);
    else pass("slide 5 before, old slide 6 after, all eight originals intact and in order");
  }
}

// ── 4. The boundaries ───────────────────────────────────────────────────────
console.log("\n4. insertAfter 0 places first, insertAfter length appends");
{
  const first = applyEditSlide(deck(), { insertAfter: 0, title: "FIRST", body: "B" });
  const last = applyEditSlide(deck(), { insertAfter: 8, title: "LAST", body: "B" });
  if (first[0]?.title !== "FIRST") fail("insertAfter:0 did not place the slide first");
  else if (last[8]?.title !== "LAST") fail("insertAfter:8 did not append the slide");
  else pass("0 places first, 8 appends");
}

// ── 5. THE PRODUCTION BUG: an impossible edit must THROW ────────────────────
console.log("\n5. An edit that cannot apply throws instead of returning the deck");
{
  const cases: [string, any][] = [
    ["slideNumber past the end", { slideNumber: 9, title: "x" }],
    ["slideNumber 0 (not 1-based)", { slideNumber: 0, title: "x" }],
    ["no slideNumber at all", { title: "x" }],
    ["insertAfter past the end", { insertAfter: 99, title: "x" }],
    ["insertAfter negative", { insertAfter: -1, title: "x" }],
  ];
  let bad = 0;
  for (let i = 0; i < cases.length; i++) {
    const [name, edit] = cases[i];
    const before = deck();
    const err = thrown(() => applyEditSlide(before, edit));
    if (!err) { fail(`${name}: expected a throw, the call returned instead`); bad++; }
    else if (!/\d/.test(err.message)) { fail(`${name}: threw, but the message names no slide number: "${err.message}"`); bad++; }
  }
  if (bad === 0) pass(`all ${cases.length} impossible edits threw, each naming the deck size or index`);
}

// ── 6. An edit naming NO change throws too ──────────────────────────────────
console.log("\n6. An edit with nothing to change throws");
{
  const err = thrown(() => applyEditSlide(deck(), { slideNumber: 3 }));
  if (!err) fail("a slideNumber with no fields returned the deck unchanged — the silent no-op is back");
  else pass("a change-less edit is refused, not silently applied");
  const empty = thrown(() => applyEditSlide(deck(), { insertAfter: 2 }));
  if (!empty) fail("an insert with no title or body produced an empty slide");
  else pass("an empty insert is refused");
}

// ── 7. A real patch still works, and touches only its own slide ─────────────
console.log("\n7. Patching one slide leaves the other seven byte-identical");
{
  const before = deck();
  const after = applyEditSlide(before, { slideNumber: 3, title: "CHANGED" });
  if (after.length !== 8) fail(`patch changed the deck length to ${after.length}`);
  else if (after[2].title !== "CHANGED") fail("the named slide was not changed");
  else {
    let drifted = "";
    for (let i = 0; i < 8; i++) {
      if (i === 2) continue;
      if (JSON.stringify(after[i]) !== JSON.stringify(before[i])) drifted += ` ${i + 1}`;
    }
    if (drifted) fail(`slides${drifted} changed and should not have`);
    else pass("slide 3 changed, the other seven byte-for-byte identical");
  }
}

// ── 8. A new picture drops the resolved one so it is fetched again ──────────
console.log("\n8. Replacing a picture clears the resolved image");
{
  const before: any[] = deck();
  before[1].image = { query: "old" };
  before[1].resolvedImage = { url: "https://example.test/old.png" };
  before[1].imageUnavailable = true;
  const after = applyEditSlide(before, { slideNumber: 2, imageQuery: "a data centre" });
  if (after[1].image?.query !== "a data centre") fail("the new image brief was not set");
  else if (after[1].resolvedImage) fail("the stale resolved image survived — the deck would show the OLD picture");
  else if (after[1].imageUnavailable) fail("imageUnavailable survived, so resolution would be skipped");
  else pass("brief replaced, stale resolution and unavailable flag cleared");
}

// ── 9. THE BLANK SLIDE: a layout this tool cannot fill is refused ───────────
//
// The second production fault, 2026-08-27. The insert worked, landed in the
// right place, and the user got an EMPTY slide: the model chose `cards`, which
// is drawn from a `cards` array, and editSlide had no field to carry one. The
// slide had a correct title and nothing beneath it. "Has a title" is not the
// same claim as "is renderable", which is why check 6 could not catch this.
console.log("\n9. A layout that cannot be filled from these fields is refused");
{
  const structured = ["stat", "bar-chart", "stacked-bar", "swot", "matrix", "timeline", "quote", "process", "logo-wall", "venn", "scatter", "comparison", "image-grid"];
  let bad = 0;
  for (let i = 0; i < structured.length; i++) {
    const err = thrown(() =>
      applyEditSlide(deck(), { insertAfter: 5, layout: structured[i], title: "T", subtitle: "S" })
    );
    if (!err) { fail(`layout "${structured[i]}" was inserted with no payload — it would draw blank`); bad++; }
    else if (!/blank|slides/i.test(err.message)) { fail(`layout "${structured[i]}" threw but does not say what to do: "${err.message}"`); bad++; }
  }
  if (bad === 0) pass(`all ${structured.length} payload-driven layouts refused, each naming the way out`);
}

// ── 10. The exact production slide, rebuilt ────────────────────────────────
console.log("\n10. The slide that shipped blank");
{
  // Verbatim shape of what was stored: cards layout, title and subtitle, no cards.
  const err = thrown(() =>
    applyEditSlide(deck(), {
      insertAfter: 5,
      layout: "cards",
      title: "What strategy-lite actually covers",
      subtitle: "Diagnostic work that sharpens direction before content starts",
    })
  );
  if (!err) fail("the exact production insert was accepted again — it draws an empty slide");
  else pass("refused, with the reason");

  // And the version that should have been sent renders.
  const good = applyEditSlide(deck(), {
    insertAfter: 5,
    layout: "cards",
    title: "What strategy-lite actually covers",
    cards: [
      { marker: "AUDIT", title: "AI Authority Audit-Lite", body: "How the brand shows up in AI answers." },
      { marker: "ASSESS", title: "Media vs Impact", body: "Activity against demonstrated reach." },
    ],
  });
  const slide: any = good[5];
  if (good.length !== 9) fail(`expected 9 slides, got ${good.length}`);
  else if (slide?.layout !== "cards") fail(`layout was ${slide?.layout}`);
  else if (!Array.isArray(slide.cards) || slide.cards.length !== 2) fail("the cards did not survive onto the slide");
  else if (slide.cards[0].title !== "AI Authority Audit-Lite") fail("card content was dropped or reordered");
  else pass("the same insert WITH cards lands at slide 6 carrying both cards");

  // A cards slide with one card is still a near-empty slide.
  const thin = thrown(() => applyEditSlide(deck(), { insertAfter: 5, layout: "cards", title: "T", cards: [{ title: "only one" }] }));
  if (!thin) fail("a single-card cards slide was accepted");
  else pass("fewer than two cards refused");
}

// ── 11. THE LOOP: a blank slide resent as part of a FULL deck ──────────────
//
// The third fault, and the one that made the first two fixes look useless. The
// model does not only insert — it resends the whole deck through `slides`, and
// the deck it resends is the stored one replayed into its context. So the blank
// slide was copied forward verbatim on every regeneration, and the insert-only
// guard never ran again. The user re-asked twice and got the same empty slide.
console.log("\n11. A blank slide is caught wherever it arrives from, not only on insert");
{
  // The exact stored slide 6, in a full nine-slide deck.
  const full: any[] = deck();
  full.splice(5, 0, {
    title: "What strategy-lite actually covers",
    layout: "cards",
    subtitle: "Diagnostic work that sharpens direction before content starts",
  });
  const faults = unrenderableSlides(full);
  if (faults.length !== 1) fail(`expected exactly 1 fault, got ${faults.length}`);
  else if (!/slide 6/.test(faults[0])) fail(`the fault does not name slide 6: ${faults[0]}`);
  else if (!/cards/.test(faults[0])) fail(`the fault does not name the missing field: ${faults[0]}`);
  else pass("the resent deck is rejected, naming slide 6 and the missing `cards`");

  // Every payload-driven layout, missing its payload.
  const pairs: [string, string][] = [
    ["stat", "stats"], ["bar-chart", "chart"], ["stacked-bar", "chart"], ["line-chart", "chart"],
    ["swot", "swot"], ["matrix", "matrix"], ["comparison", "comparison"], ["scatter", "scatter"],
    ["venn", "venn"], ["timeline", "milestones"], ["timeline-parallel", "tracks"],
    ["process", "stages"], ["logo-wall", "logos"], ["quote", "quote"], ["image-grid", "images"],
  ];
  let missed = 0;
  for (let i = 0; i < pairs.length; i++) {
    const f = unrenderableSlides([{ layout: pairs[i][0], title: "T" }]);
    if (f.length !== 1) { fail(`layout "${pairs[i][0]}" with no ${pairs[i][1]} was not caught`); missed++; }
  }
  if (missed === 0) pass(`all ${pairs.length} payload-driven layouts caught when their payload is missing`);

  // NEGATIVE CONTROL: a well-formed deck must pass cleanly, or the guard would
  // reject every deck and this whole check would be worthless.
  const good: any[] = deck();
  good.splice(5, 0, {
    title: "What strategy-lite actually covers", layout: "cards",
    cards: [{ title: "Audit", body: "x" }, { title: "Assess", body: "y" }],
  });
  good.push({ layout: "stat", title: "The investment", stats: [{ value: "CHF 14,750", label: "total" }] });
  good.push({ layout: "quote", title: "Q", quote: { text: "t", speaker: "s" } });
  const clean = unrenderableSlides(good);
  if (clean.length) fail(`a well-formed deck was rejected: ${clean.join(" | ")}`);
  else pass("a well-formed deck with cards, stat and quote passes — the guard is not just refusing everything");

  // Empty deck must not fault.
  if (unrenderableSlides([]).length) fail("an empty deck produced a fault");
  else pass("an empty deck produces no fault");
}

// ── 12. Deleting a slide from the draft, locally ───────────────────────────
//
// deleteSlide is the DIRECT one — no model, no round trip — because removing a
// slide needs no content written. It patches two arrays that must stay in step:
// `slides` is what publishes, `preview.slides` is what the user is looking at,
// and letting them drift is how a preview stops predicting the deck.
console.log("\n12. Delete removes from the spec and the preview together");
{
  const mk = (n: number) => ({
    title: "Deck",
    slides: Array.from({ length: n }, (_, i) => ({ layout: "content", title: `Slide ${i + 1}` })),
    preview: { width: 720, height: 405, slides: Array.from({ length: n }, (_, i) => ({ background: "#fff", elements: [{ kind: "text", text: `Slide ${i + 1}` }] })) },
  }) as any;

  const after = deleteSlide(mk(5), 2);
  if (after.slides.length !== 4) fail(`spec has ${after.slides.length} slides, expected 4`);
  else if (after.preview.slides.length !== 4) fail(`preview has ${after.preview.slides.length} slides, expected 4 — the two arrays drifted`);
  else if (after.slides[2].title !== "Slide 4") fail("the wrong slide was removed from the spec");
  else if (after.preview.slides[2].elements[0].text !== "Slide 4") fail("spec and preview removed DIFFERENT slides");
  else pass("slide 3 gone from both arrays, and they still describe the same deck");

  // The guards. Without the first, deleting the last slide leaves a draft with
  // nothing to render and publishes an empty presentation.
  const one = mk(1);
  if (deleteSlide(one, 0) !== one) fail("deleting the only slide was allowed — the deck would publish empty");
  else pass("refuses to empty the deck");

  const five = mk(5);
  if (deleteSlide(five, 9) !== five) fail("an out-of-range index returned a NEW draft, so callers would treat a no-op as a delete");
  else if (deleteSlide(five, -1) !== five) fail("a negative index was accepted");
  else pass("an index that is not there is refused, not silently ignored");

  // The input must not be mutated, or React sees the same object and the strip
  // keeps showing the slide that was just deleted.
  const src = mk(4);
  deleteSlide(src, 1);
  if (src.slides.length !== 4) fail("deleteSlide mutated its input — the preview would not re-render");
  else pass("the input draft is left alone");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
