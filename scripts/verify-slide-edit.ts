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
import { applyEditSlide, unrenderableSlides, normaliseSlide, insertableLayout, hubHasConnections, SlideCallRefusal, isSlideCallRefusal, blankSlideFaults } from "../lib/slides/edit";
import { deleteSlide } from "../lib/slides/draft-edit";
import { densityFromAsk, densityFromAsks, askOpening } from "../lib/slides/density-from-ask";
import { prepareSlidesForBuild, recentUserAsks, __setStoredDraftReader, SLIDES_GEN_OPENAI_TOOL } from "../lib/ai/providers";
import { DECK_ASK_WINDOW } from "../lib/slides/claim";
import { stampDeckChrome, stampDensity, densityOf, splitOverflowingSlides } from "../lib/slides/generate";
import { DEFAULT_DENSITY } from "../lib/slides/brand";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** A deck standing in for the real one: eight slides, distinct titles. */
function deck(): any[] {
  const out: any[] = [];
  for (let i = 1; i <= 8; i++) out.push({ layout: "content", title: `Slide ${i}`, body: `Body ${i}` });
  return out;
}

/** A slide without the spine the builder stamps on it. */
function withoutStep(slide: any): any {
  const out = { ...(slide || {}) };
  delete out.step;
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
      // `step` IS THE BUILDER'S, and it is re-derived on every edit — see
      // stampSteps. It is the one field on a slide that does not belong to the
      // slide, so it is compared separately (check 15) rather than counted as
      // drift here: a deck whose spine did NOT change on an edit is the defect,
      // not the other way round.
      if (JSON.stringify(withoutStep(after[i])) !== JSON.stringify(withoutStep(before[i]))) drifted += ` ${i + 1}`;
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

// ── 13. A hub is read wherever its fields landed ───────────────────────────
//
// The fourth production fault, 2026-09-15. A new chat asked for a deck and the
// model's first call put the hub's `caption` and `groups` BESIDE the slide's
// title instead of inside `hub` — the tool schema had never declared `hub` at
// all, so it was guessing from a sentence of prose. The guard refused the slide
// as blank, the refusal reached the user, and fifteen slides were re-streamed
// to fix one. The fields were misplaced, not missing, so normaliseSlide moves
// them; and the guard now asks whether a hub DRAWS a connection, because
// `hub.items`, a hub array, bare-string items, `nodes` and a title-only hub all
// passed "is `hub` present" and built a slide with nothing wired to anything.
//
// The key assertions are STRUCTURAL. A lifted caption is drawn byte-identical
// whether or not its old copy was deleted, so nothing that reads the drawn text
// can tell a clean spec from one that will replay the mistake next turn.
//
// MUTATION LOG (detached worktree, 2026-09-15). Run against this block AND
// check 37 of verify-slide-layouts.ts, which drives the same code through the
// routes. Where one survived here, the other is named.
//   killed   `delete out.groups` removed (top-level groups left behind)
//   killed   the lifted caption's delete removed (also breaks idempotence)
//   killed   the identical-caption delete removed. SURVIVED check 37: the
//            caption is drawn identically either way, which is exactly why
//            the assertion here is on the key and not on the drawing
//   killed   the guard back to presence-only for a hub
//   killed   batch entries not normalised (SURVIVED 37, whose batch case is
//            reached only through prepareSlidesForBuild's own normalisation)
//   killed   a single insert not normalised
//   killed   a patch that does not lift — first as an uncaught throw, which is
//            why (g) is now wrapped: a crash and a pass look alike in a log
//   killed   a patch that REPLACES the stored hub instead of merging (SURVIVED
//            37, whose patched slide had no hub to lose)
//   killed   a headline copied into the circle (<= 99 words) (SURVIVED 37)
//   killed   `nodes` lifted as if it were `items`
//   killed   bare-string items not mapped to { title }
//   killed   a hub array not lifted
//   killed   the refusal no longer saying caption and groups go INSIDE hub
//   killed   the non-hub early return removed (SURVIVED 37)
//   killed   `delete work.items` removed (SURVIVED 37)
//   killed   `delete out.items` removed (SURVIVED 37)
//   killed   the predicate counting untitled items
//   Not reachable from here, so SURVIVED this block by construction and killed
//   by 37: the guard not normalising, buildSlideRequests not read-tolerant,
//   the fold dropping payloads, the visual audit on raw length, and all four
//   schema mutations.
//
// SECOND MUTATION LOG (detached worktree, 2026-09-15), for (h) and (i), added
// after a verifier showed a patch INSIDE `hub` punished and a layout-less hub
// drawn as prose on every route but the insert:
//   killed   N1 normaliseSlide not setting layout "hub" on a layout-less hub
//            that draws (i: "not a hub (layout undefined)"; also 37h, 12 FAILs)
//   killed   P1 an explicit `hub` replacing the stored hub again (h: the name
//            or connections lost, and the guard refuses what is left; also
//            37i, where the route threw "would be drawn blank")
//   killed   P2 the merge order reversed, stored fields winning over the edit
//            (h and g). SURVIVED 37, whose patch changed only a caption it
//            then read back through a route that also reads the stored name.
console.log("\n13. A hub is read wherever its fields landed, and one that draws nothing is refused");
{
  const CAP = "One workspace that reads the systems the team already uses";
  const ITEMS = [
    { title: "Slack", icon: "message-square" }, { title: "Gmail & Calendar", icon: "mail" },
    { title: "Google Drive", icon: "folder" }, { title: "Xero Finance", icon: "credit-card" },
    { title: "HubSpot CRM", icon: "users" }, { title: "MeetingBrain", icon: "mic" },
    { title: "HR Absence Calendar", icon: "calendar" }, { title: "AuthorityOn AI Data", icon: "database" },
  ];
  const GROUP = () => ({ name: "CONNECTED SYSTEMS", tone: "blue", items: ITEMS.slice() });
  const flat = (): any => ({ layout: "hub", title: "EngineAI", caption: CAP, groups: [GROUP()] });
  const own = (o: any, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const titled = (s: any) => {
    let n = 0;
    const groups = (s && s.hub && Array.isArray(s.hub.groups)) ? s.hub.groups : [];
    for (let g = 0; g < groups.length; g++) {
      const items = (groups[g] && groups[g].items) || [];
      for (let i = 0; i < items.length; i++) if (items[i] && typeof items[i].title === "string" && items[i].title) n++;
    }
    return n;
  };
  const before13 = failures;

  // a) The incident's shape: lifted, and the old keys GONE.
  {
    const input = flat();
    const snapshot = JSON.stringify(input);
    const n: any = normaliseSlide(input);
    if (JSON.stringify(input) !== snapshot) fail("normaliseSlide mutated its input");
    if (own(n, "groups") || own(n, "caption")) fail(`the incident slide keeps its misplaced keys (${Object.keys(n).join(", ")}) — the stored spec would replay the mistake next turn`);
    if (titled(n) !== 8) fail(`the incident slide carries ${titled(n)} titled connections, expected 8`);
    if (!n.hub || n.hub.title !== "EngineAI" || n.hub.caption !== CAP) fail(`the centre name and caption did not land in the hub (${JSON.stringify(n.hub && { title: n.hub.title, caption: n.hub.caption })})`);
    if (unrenderableSlides([{ layout: "cover", title: "Deck" }, input]).length) fail("the guard still refuses the incident's slide");
  }

  // b) Every other misplaced shape comes out drawing its nodes, with nothing
  //    left where it was.
  const shapes: [string, any, number, string[]][] = [
    ["hub.items with no groups", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", items: ITEMS } }, 8, ["hub.items"]],
    ["hub sent as an array of groups", { layout: "hub", title: "EngineAI", hub: [GROUP()] }, 8, []],
    ["items as bare strings", { layout: "hub", title: "EngineAI", hub: { groups: [{ name: "X", items: ["Slack", "Xero", "Email"] }] } }, 3, []],
    ["items at the top level", { layout: "hub", title: "EngineAI", items: ITEMS }, 8, ["items"]],
    ["groups at the top level with no layout", { title: "EngineAI", groups: [GROUP()] }, 8, ["groups"]],
  ];
  for (let i = 0; i < shapes.length; i++) {
    const [name, shape, want, gone] = shapes[i];
    const out: any = normaliseSlide(shape);
    if (titled(out) !== want) fail(`${name}: ${titled(out)} titled connections, expected ${want}`);
    for (let g = 0; g < gone.length; g++) {
      const path = gone[g].split(".");
      const holder = path.length > 1 ? out[path[0]] : out;
      if (own(holder, path[path.length - 1])) fail(`${name}: \`${gone[g]}\` is still there after being lifted`);
    }
    if (!hubHasConnections(out.hub)) fail(`${name}: normalised, but the guard's predicate still sees no connection`);
  }

  // c) A caption: moved when the hub has none, dropped when identical, LEFT
  //    when different so droppedContent reports it instead of this choosing.
  {
    const diff: any = normaliseSlide({ layout: "hub", title: "EngineAI", caption: "Something else", hub: { caption: CAP, groups: [GROUP()] } });
    if (!own(diff, "caption") || diff.hub.caption !== CAP) fail("a DIFFERENT top-level caption was moved or merged rather than left to be reported");
    const same: any = normaliseSlide({ layout: "hub", title: "EngineAI", caption: CAP, hub: { caption: CAP, groups: [GROUP()] } });
    if (own(same, "caption")) fail("a top-level caption identical to hub.caption was left behind");
  }

  // d) The centre name: a short title is copied, a headline is not.
  {
    const long: any = normaliseSlide({ layout: "hub", title: "Everything TCE runs on, in {one place}", groups: [GROUP()] });
    if (long.hub && long.hub.title) fail(`a headline was copied into the circle: "${long.hub.title}"`);
    const short: any = normaliseSlide({ layout: "hub", title: "The {EngineAI}", groups: [GROUP()] });
    if (!short.hub || short.hub.title !== "The EngineAI") fail(`a three-word title was not copied, braces stripped (${short.hub && short.hub.title})`);
    const kept: any = normaliseSlide({ layout: "hub", title: "Hub", hub: { title: "EngineAI", groups: [GROUP()] } });
    if (kept.hub.title !== "EngineAI") fail("an existing centre name was overwritten by the slide title");
  }

  // e) A no-op on everything that is not a hub, and idempotent on everything.
  {
    const others: any[] = [
      { layout: "content", title: "x", body: "y", items: ["a"], caption: "c" },
      { layout: "table", title: "t", table: { columns: ["A"], rows: [["1"]] }, groups: [] },
      { layout: "cards", title: "c", cards: [{ title: "a" }, { title: "b" }] },
    ];
    for (let i = 0; i < others.length; i++) {
      if (JSON.stringify(normaliseSlide(others[i])) !== JSON.stringify(others[i])) fail(`a non-hub slide was changed: ${JSON.stringify(others[i]).slice(0, 60)}`);
    }
    const all = shapes.map((s) => s[1]).concat([flat(), { layout: "hub", title: "EngineAI", caption: "Other", hub: { caption: CAP, groups: [GROUP()] } }], others);
    for (let i = 0; i < all.length; i++) {
      const once = normaliseSlide(all[i]);
      if (JSON.stringify(normaliseSlide(once)) !== JSON.stringify(once)) fail(`normaliseSlide is not idempotent on ${JSON.stringify(all[i]).slice(0, 60)}`);
    }
  }

  // f) What is NOT repaired is refused, and the refusal names the shape.
  {
    const refused: [string, any][] = [
      ["`nodes` in place of groups", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", nodes: ITEMS } }],
      ["`connections` in place of groups", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", connections: [GROUP()] } }],
      ["a hub with only a title", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI" } }],
      ["items with no titles", { layout: "hub", title: "EngineAI", hub: { groups: [{ items: [{ name: "Slack" }, { name: "Xero" }] }] } }],
    ];
    for (let i = 0; i < refused.length; i++) {
      const [name, slide] = refused[i];
      const lifted: any = normaliseSlide(slide);
      if (lifted.hub && Array.isArray(lifted.hub.groups) && titled(lifted) > 0) fail(`${name}: normaliseSlide lifted a guess into groups`);
      const faults = unrenderableSlides([slide]);
      if (faults.length !== 1) fail(`${name}: the guard accepted a hub that draws no connection (${faults.length} faults)`);
      else if (!/groups/.test(faults[0]) || !/INSIDE hub/.test(faults[0])) fail(`${name}: refused, but the message does not name the shape: ${faults[0].slice(0, 120)}`);
      if (insertableLayout("hub", slide).ok) fail(`${name}: insertableLayout lets it be inserted`);
    }
  }

  // g) The edit routes carry misplaced hub fields onto the slide. Wrapped: a
  //    route that regresses THROWS, and an escaped throw ends the script with
  //    no FAIL line — indistinguishable in a log from a crash in the harness.
  try {
    const batch = applyEditSlide(deck(), { insertAfter: 8, insertSlides: [flat(), { title: "Hub", groups: [GROUP()] }] });
    const b = batch[8], nb = batch[9];
    if (!b || own(b, "groups") || own(b, "caption") || titled(b) !== 8) fail(`an insertSlides entry in the incident's shape was not repaired (keys ${b && Object.keys(b).join(",")}, ${titled(b)} connections)`);
    if (!nb || nb.layout !== "hub") fail(`an insertSlides entry carrying only groups was not made a hub (layout ${nb && nb.layout})`);

    const single = applyEditSlide(deck(), { insertAfter: 2, layout: "hub", title: "EngineAI", caption: CAP, groups: [GROUP()] });
    if (titled(single[2]) !== 8 || single[2].hub.caption !== CAP) fail(`a single insert with top-level groups lost them (${titled(single[2])} connections)`);
    if (unrenderableSlides(single).length) fail("the deck after a single hub insert is refused");

    const stored: any[] = deck();
    stored[1] = { layout: "hub", title: "Our integrations today", hub: { title: "EngineAI", caption: CAP, groups: [{ name: "OLD", items: ITEMS.slice(0, 2) }] } };
    const regrouped = applyEditSlide(stored, { slideNumber: 2, groups: [GROUP()] });
    const r = regrouped[1];
    if (titled(r) !== 8) fail(`a patch sending groups beside the slide number did not replace the connections (${titled(r)})`);
    if (r.hub.title !== "EngineAI" || r.hub.caption !== CAP) fail("a patch of groups alone threw away the stored centre name or caption");
    const recaptioned = applyEditSlide(stored, { slideNumber: 2, caption: "A new line under the name" });
    if (recaptioned[1].hub.caption !== "A new line under the name" || titled(recaptioned[1]) !== 2) fail("a caption patch on a hub slide did not reach hub.caption, or lost the groups");
    const onContent = thrown(() => applyEditSlide(deck(), { slideNumber: 3, groups: [GROUP()] }));
    if (!onContent) fail("groups sent to a CONTENT slide were accepted — stored and never drawn, the silent no-op");

    // A stored deck with a misplaced hub no longer blocks an unrelated edit.
    const lockout: any[] = deck();
    lockout[1] = flat();
    const renamed = applyEditSlide(lockout, { slideNumber: 1, title: "Renamed" });
    if (unrenderableSlides(renamed).length) fail(`an unrelated edit over a stored misplaced hub is refused: ${unrenderableSlides(renamed)[0].slice(0, 80)}`);
  } catch (e: any) {
    fail(`an edit route refused a misplaced hub it should carry: ${String((e && e.message) || e).slice(0, 140)}`);
  }

  // h) THE SHAPE THE SCHEMA ASKS FOR is merged too. A patch sending its fields
  //    INSIDE `hub` used to replace the whole hub: `hub: { caption }` was
  //    refused as a hub with no connections, and `hub: { groups }` was accepted
  //    with the centre name and caption silently gone — while the misplaced
  //    top-level form of the same edit kept both. Each route is wrapped on its
  //    own, so one that throws does not hide what the others do.
  {
    const stored = (): any[] => {
      const d = deck();
      d[1] = { layout: "hub", title: "Everything TCE runs on", hub: { title: "EngineAI", caption: CAP, groups: [{ name: "OLD", tone: "teal", items: ITEMS.slice(0, 2) }] } };
      return d;
    };
    const patches: [string, any, (h: any) => string][] = [
      ["hub: { caption }", { slideNumber: 2, hub: { caption: "A new line under the name" } },
        (h) => (h.caption === "A new line under the name" && h.title === "EngineAI" && titled({ hub: h }) === 2 ? "" : "the name or the connections were lost, or the caption did not change")],
      ["hub: { title }", { slideNumber: 2, hub: { title: "Engine Platform" } },
        (h) => (h.title === "Engine Platform" && h.caption === CAP && titled({ hub: h }) === 2 ? "" : "the caption or the connections were lost, or the name did not change")],
      ["hub: { groups }", { slideNumber: 2, hub: { groups: [GROUP()] } },
        (h) => (h.title === "EngineAI" && h.caption === CAP && titled({ hub: h }) === 8 && h.groups.length === 1 ? "" : "the name or caption were lost, or the groups were not replaced")],
      ["hub sent as an array of groups", { slideNumber: 2, hub: [GROUP()] },
        (h) => (h.title === "EngineAI" && h.caption === CAP && titled({ hub: h }) === 8 ? "" : "the name or caption were lost")],
    ];
    for (let i = 0; i < patches.length; i++) {
      const [name, edit, judge] = patches[i];
      try {
        const out = applyEditSlide(stored(), edit);
        const why = judge(out[1].hub || {});
        if (why) fail(`a patch of ${name} on a hub slide: ${why} (${JSON.stringify(out[1].hub).slice(0, 120)})`);
        if (unrenderableSlides(out).length) fail(`a patch of ${name} leaves a hub the guard refuses`);
      } catch (e: any) {
        fail(`a patch of ${name} on a hub slide was refused: ${String((e && e.message) || e).slice(0, 120)}`);
      }
    }
    // A hub patched onto a CONTENT slide is still a payload replacement, not a
    // merge into something that is not drawn.
    const onContent = applyEditSlide(deck(), { slideNumber: 3, hub: { title: "EngineAI", groups: [GROUP()] } });
    if (onContent[2].layout !== "content") fail("a hub patched onto a content slide changed its layout without being asked");
  }

  // i) NO LAYOUT, BUT A HUB THAT DRAWS: a hub, decided in normaliseSlide, the
  //    one place every reader goes through. The insert paths used to decide it
  //    themselves while the full route and the builder called it "content".
  {
    const bare: any = normaliseSlide({ title: "Everything we connect", hub: { title: "EngineAI", groups: [GROUP()] } });
    if (bare.layout !== "hub") fail(`a layout-less slide whose hub draws connections is not a hub (layout ${bare.layout})`);
    const flatBare: any = normaliseSlide({ title: "EngineAI", caption: CAP, groups: [GROUP()] });
    if (flatBare.layout !== "hub" || titled(flatBare) !== 8) fail(`a layout-less slide with groups at the top is not a hub drawing 8 (layout ${flatBare.layout}, ${titled(flatBare)})`);
    const hollow = { title: "Prose", body: "A line", hub: { title: "EngineAI" } };
    if (JSON.stringify(normaliseSlide(hollow)) !== JSON.stringify(hollow)) fail("a layout-less slide whose hub draws nothing was changed — a stray hub would turn prose into a lone circle");
    const chosen = { layout: "content", title: "Prose", body: "A line", hub: { title: "EngineAI", groups: [GROUP()] } };
    if ((normaliseSlide(chosen) as any).layout !== "content") fail("an explicit content layout was overridden by a hub");
    // The scan the guard runs reads the same default.
    if (unrenderableSlides([{ layout: "cover", title: "Deck" }, { title: "No layout", hub: { title: "EngineAI", nodes: ITEMS } }]).length) fail("the scan judged a layout-less slide as a hub without the builder agreeing");
    if (JSON.stringify(normaliseSlide(bare)) !== JSON.stringify(bare)) fail("normaliseSlide is not idempotent on a layout-less hub");
  }

  if (failures === before13) pass("misplaced hub fields are lifted (old keys deleted), guesses and empty hubs are refused naming the shape, and every edit route carries the repair");
}

// ── 14. Every refusal says who it is for ───────────────────────────────────
//
// The same incident, the other half. Every throw in applyEditSlide is written
// for the MODEL — it names fields and says what to send next — and every one
// was a plain Error, so the four provider chains could not tell it from a real
// fault and forwarded it to the user's toast. On 2026-09-15 that put "Fix and
// send again — do NOT tell the user the slide is done" on screen while the
// model quietly retried and the deck built. The class is the audience;
// lib/slides/failure.ts reads nothing else. Check 38 of verify-slide-layouts.ts
// drives the helper, the notice and the wiring.
//
// The structured faults are asserted as well as the class, because they are
// what a person is told if the turn ENDS refused, and a fault numbered by the
// batch ("slide 2") rather than by the deck ("slide 10") would name the wrong
// slide in a notice nobody would think to doubt.
//
// MUTATION LOG (detached worktree, 2026-09-15). Run against this block AND
// check 38 of verify-slide-layouts.ts; where one survived, the other is named.
//   killed   the batch insert refusal thrown as a plain Error (also 38)
//   killed   the remove-all refusal thrown as a plain Error. SURVIVED 38, which
//            drives no removal — this block is the only thing pinning it
//   killed   isSlideCallRefusal answering true for everything, by the negative
//            control (also 38, which sees every real fault go silent)
//   killed   a batch fault numbered within the batch (2), not the deck (10)
//   killed   the batch refusal losing its "insert" scope
//   killed   blankSlideFaults returning nothing
//   SURVIVED the whole-deck scan's person reason rewritten with the model's
//            field name in backticks: this block reads applyEditSlide's faults
//            and only COUNTS the scan's; killed by 38, which reads the notice
//            where that reason reaches a person
//   SURVIVED (and survives 38) removing Object.setPrototypeOf from the class:
//            tsx and the server bundle both emit native classes, so instanceof
//            holds without it. It guards an ES5 downlevel nothing here compiles
//            to — kept as insurance, recorded rather than claimed as tested.
//   SURVIVED here, killed by 38a (the route cases live there): T2 the edit's
//            own text check disabled, so `imageQuery: 5` threw a TypeError
//            again; T3 a batch entry's bad text field no longer reported by
//            the batch — first a survivor of 38a too, because the guard's scan
//            refuses the same slide by its deck number; 38a now asserts the
//            model is told "slide 1 of the batch", and kills it.
console.log("\n14. Every refusal is a SlideCallRefusal, and names its slide for a person");
{
  const before14 = failures;
  const MARKERS = /do NOT|generate_slides|editSlide|insertSlides|Fix and send|`/;
  // `nodes` is a guess normaliseSlide deliberately does not lift, so this hub
  // is refused after normalisation — unlike the incident's own flat shape,
  // which now builds.
  const NODES_HUB = (): any => ({ layout: "hub", title: "The {EngineAI}", hub: { title: "EngineAI", nodes: [{ title: "Slack" }] } });
  const cases: [string, () => any][] = [
    ["slideNumber past the end", () => applyEditSlide(deck(), { slideNumber: 9, title: "x" })],
    ["no slideNumber at all", () => applyEditSlide(deck(), { title: "x" })],
    ["insertAfter past the end", () => applyEditSlide(deck(), { insertAfter: 99, title: "x" })],
    ["a patch with no change", () => applyEditSlide(deck(), { slideNumber: 3 })],
    ["an empty insert", () => applyEditSlide(deck(), { insertAfter: 2 })],
    ["a payload layout with no payload", () => applyEditSlide(deck(), { insertAfter: 5, layout: "swot", title: "T" })],
    ["an unknown layout", () => applyEditSlide(deck(), { insertAfter: 5, layout: "nonsense", title: "T" })],
    ["a one-card cards slide", () => applyEditSlide(deck(), { insertAfter: 5, layout: "cards", title: "T", cards: [{ title: "only" }] })],
    ["an empty insertSlides", () => applyEditSlide(deck(), { insertAfter: 2, insertSlides: [] })],
    ["a batch carrying a hub of `nodes`", () => applyEditSlide(deck(), { insertAfter: 8, insertSlides: [{ layout: "content", title: "Fine", body: "b" }, NODES_HUB()] })],
    ["removing a slide that is not there", () => applyEditSlide(deck(), { removeSlides: [12] })],
    ["removing every slide", () => applyEditSlide(deck(), { removeSlides: [1, 2, 3, 4, 5, 6, 7, 8] })],
    ["removing and inserting in one call", () => applyEditSlide(deck(), { removeSlides: [2], insertAfter: 1, title: "x" })],
  ];
  const errs: { [name: string]: any } = {};
  for (let i = 0; i < cases.length; i++) {
    const err: any = thrown(cases[i][1]);
    errs[cases[i][0]] = err;
    if (!err) fail(`${cases[i][0]}: did not throw`);
    else if (!(err instanceof SlideCallRefusal) || !isSlideCallRefusal(err)) fail(`${cases[i][0]}: threw a plain ${err && err.name} — the chains would send its model-directed message to the user's toast`);
    else if (err.faults.length === 0 && !err.userReason) fail(`${cases[i][0]}: a refusal with neither faults nor a reason, so an unresolved turn could only tell the user "something" failed`);
  }

  // The faults, numbered in the deck the user would have seen.
  const batch: any = errs["a batch carrying a hub of `nodes`"];
  if (batch && batch.faults) {
    const f = batch.faults;
    if (f.length !== 1) fail(`the batch refusal carries ${f.length} faults, expected 1 (only the hub is at fault)`);
    else {
      if (f[0].slide !== 10) fail(`the refused batch slide is numbered ${f[0].slide}; inserted after 8 as the batch's second slide it would have been slide 10`);
      if (f[0].title !== "The EngineAI" || f[0].layout !== "hub") fail(`the batch fault names ${JSON.stringify(f[0].title)} / ${f[0].layout}`);
      if (MARKERS.test(f[0].reason) || /hub\.|groups|nodes/.test(f[0].reason)) fail(`the batch fault's reason is written for the model: "${f[0].reason}"`);
    }
    if (batch.scope !== "insert") fail(`the batch refusal's scope is ${batch.scope}, so a notice would say the deck was not changed rather than that slides were not added`);
  }
  const single: any = errs["a payload layout with no payload"];
  if (single && single.faults && (single.faults.length !== 1 || single.faults[0].slide !== 6 || single.faults[0].layout !== "swot")) {
    fail(`a single insert after slide 5 does not name slide 6 as a swot (${JSON.stringify(single.faults)})`);
  }
  const patch: any = errs["a patch with no change"];
  // Nothing about slide 3 fails to draw, so it is a reason naming the slide,
  // not a fault — a notice would otherwise say slide 3 "could not be drawn".
  if (patch && patch.faults && (patch.scope !== "edit" || patch.faults.length || !/slide 3 \("Slide 3"\)/.test(String(patch.userReason)))) {
    fail(`a change-less patch of slide 3 is not reported as an edit naming "Slide 3" in plain words (${patch.scope}, ${JSON.stringify(patch.faults)}, ${patch.userReason})`);
  }
  const gone: any = errs["removing a slide that is not there"];
  if (gone && gone.scope !== undefined && (gone.scope !== "remove" || String(gone.userReason).indexOf("12") < 0)) {
    fail(`removing slide 12 is not reported as a removal naming 12 (${gone.scope}: ${gone.userReason})`);
  }
  for (let i = 0; i < cases.length; i++) {
    const e: any = errs[cases[i][0]];
    if (!e || !e.faults) continue;
    for (let j = 0; j < e.faults.length; j++) {
      if (MARKERS.test(e.faults[j].reason) || MARKERS.test(e.faults[j].title)) fail(`${cases[i][0]}: a person-facing fault carries model text: ${JSON.stringify(e.faults[j])}`);
    }
    if (e.userReason && MARKERS.test(e.userReason)) fail(`${cases[i][0]}: userReason is written for the model: ${e.userReason}`);
  }

  // The whole-deck scan gives the same answer in both registers.
  const scanned = [{ layout: "cover", title: "Deck" }, NODES_HUB(), { layout: "cards", title: "No cards" }];
  const people = blankSlideFaults(scanned);
  if (people.length !== unrenderableSlides(scanned).length) fail(`blankSlideFaults finds ${people.length} slides and unrenderableSlides ${unrenderableSlides(scanned).length}: the notice and the model would disagree`);
  else if (people.length !== 2 || people[0].slide !== 2 || people[1].slide !== 3 || people[1].layout !== "cards") fail(`blankSlideFaults names ${JSON.stringify(people)}`);

  // NEGATIVE CONTROL. A real fault is NOT a refusal, or every crash would be
  // silenced along with the refusals.
  if (isSlideCallRefusal(new Error("boom")) || isSlideCallRefusal(new SyntaxError("Unexpected end of JSON input"))) fail("a plain Error is classed as a refusal — real faults would be hidden from the user");
  if (isSlideCallRefusal({ audience: "model", message: "not an error" })) fail("a non-Error object is classed as a refusal");

  if (failures === before14) pass(`all ${cases.length} refusals are SlideCallRefusals, faults are numbered in the deck and worded for a person, and a plain Error is not one`);
}

// ── 15. THE STEPPER RENUMBERS ON AN EDIT ────────────────────────────────────
//
// Stage 3 of docs/PLAN-slides-creative-2026-09.md. The stepper answers "where
// am I, how much is left", and a rail that says 4 of 7 on a deck that now has
// eight things is answering it with a lie — which is exactly the objection that
// kept a page number off these slides for a year. The resolution was that the
// number is DERIVED, at build, and re-derived on every edit; this is the half
// of it that an edit can break, because applyEditSlide has nine return paths
// and a stamp written at eight of them passes every other check in this file.
//
// Driven through the PUBLIC function on a REAL insert, not by calling
// stampSteps directly: what is being asserted is that the edit path re-derives,
// and a check that calls the stamper itself would pass with the call site gone.
console.log("\n15. An insert renumbers every step after it");
{
  const before15 = failures;
  const spine = () => {
    const out: any[] = [{ layout: "cover", title: "Seven things" }];
    for (let i = 1; i <= 5; i++) out.push({ layout: "content", title: `Thing ${i}`, body: `Body ${i}` });
    out.push({ layout: "closing", title: "Thank you" });
    return out;
  };
  const stamped = applyEditSlide(spine(), { slideNumber: 1, subtitle: "A guide" });
  const rail = (d: any[]) => d.map((x) => (x.step ? `${x.step.n}/${x.step.of}` : "-")).join(" ");
  // PRECONDITION. A deck with no rail at all would pass every assertion below
  // by drawing nothing, which is the check that silently tests nothing.
  if (rail(stamped) !== "- 1/5 2/5 3/5 4/5 5/5 -") {
    fail(`precondition: a cover, five things and a closing did not stamp as five steps — got "${rail(stamped)}"`);
  } else {
    const grown = applyEditSlide(stamped, {
      insertAfter: 3, layout: "content", title: "A new thing", body: "Inserted between 2 and 3",
    });
    const got = rail(grown);
    if (got !== "- 1/6 2/6 3/6 4/6 5/6 6/6 -") {
      fail(`inserting after the second thing left the rail as "${got}" — every step after the insert must renumber,`
        + ` and the total must go to six, or slide 5 is marked 4 of 5 for the rest of the deck`);
    } else pass("five steps became six, the inserted slide took step 3, and everything after it moved up");
    // AND IN THE OTHER DIRECTION. A removal that did not renumber would leave a
    // rail counting to six on a deck of five, which is the same lie.
    const cut = applyEditSlide(stamped, { removeSlides: [4] });
    const cutRail = rail(cut);
    if (cutRail !== "- 1/4 2/4 3/4 4/4 -") {
      fail(`removing the third thing left the rail as "${cutRail}" — a removal must renumber too`);
    } else pass("removing a thing takes the rail to four, renumbered from the cut");
    // AND THE COVER AND CLOSING NEVER CARRY ONE. They are not in the series;
    // the source deck marks neither, and the folio already numbers the page.
    if (grown[0].step || grown[grown.length - 1].step) {
      fail("the cover or the closing was given a step — neither is one of the things the rail counts");
    } else pass("the cover and the closing carry no step");
    // AND THE DECK HANDED IN IS NOT TOUCHED. The result is a fresh ARRAY whose
    // entries are the caller's own slide objects, so a stamper that wrote
    // through would put a rail on the deck the user is looking at — including
    // on the path where the edit is then REFUSED, which leaves the screen
    // showing something nobody asked for. Check 7 compares the slides with
    // `step` removed, so it cannot see this; only this can.
    const source = spine();
    const stampedOnce = applyEditSlide(source, { slideNumber: 1, subtitle: "A guide" });
    if (source.some((x: any) => x.step)) {
      fail("applyEditSlide stamped the spine onto the deck it was handed, not onto the deck it returned");
    } else if (!stampedOnce.some((x: any) => x.step)) {
      fail("precondition: the returned deck carries no rail, so the copy assertion above proves nothing");
    } else pass("the rail is stamped on the returned deck and the deck handed in is untouched");
    // A DECK THAT IS NOT A SERIES CARRIES NO RAIL, and the stale one is
    // cleared rather than left behind. Cutting to two things takes it under
    // the floor: "1 2" is not a progress bar.
    const tiny = applyEditSlide(stamped, { removeSlides: [4, 5, 6] });
    if (tiny.some((x: any) => x.step)) {
      fail(`cutting to two things left a stale rail: "${rail(tiny)}" — under the floor the field must be removed, not kept`);
    } else pass("a deck that drops under the floor loses its rail entirely rather than keeping a stale one");
  }
  if (failures === before15) pass("the spine is the builder's, and every edit re-derives it");
}


// ── 16. A DECK'S DENSITY IS DECIDED ONCE, AT CREATION, AND AN EDIT NEVER ─────
//        CHANGES IT.
//
// WHY THIS EXISTS. `present` is the preset for a deck somebody stands up and
// talks through — ~30pt titles, bodyY at 158.40 instead of 103.68, a body band
// a fifth shorter, about half the words on a page. `read` stays the default
// (decided 2026-09-21) because a default that silently reshapes decks already
// sent to clients is a migration, not a default. So `present` is CHOSEN, and
// it is chosen by inferring from the user's own words.
//
// The hazard that the design has to make impossible rather than unlikely:
// inference running on every turn. Run the rule per turn over the 78 stored
// deck drafts and 4 of the 36 later turns re-stamp a deck that already exists;
// three of them match on QUOTED SLIDE COPY pasted into a build request rather
// than on the ask — "or talk it through", "before a meeting", "for a meeting"
// inside notes — and the opening clamp removes those three, leaving 1 in 36.
// That one is a genuine occasion phrase on a turn that rebuilds an existing
// deck, and no text rule stops it: only the creation/edit asymmetry does.
// Three of the four are consecutive turns in ONE thread (04c5d402,
// 2026-09-15): the deck would have reflowed under the user three times while
// they were editing it. That is the same thread and the same failure mode
// CLAUDE.md already records for `meeting_data` routing.
//
// So the assertions below are not "the predicate is right". They are:
//   - creation INFERS, and an edit, an insert, a reorder, a SPLIT and a
//     FULL-DECK RESEND all INHERIT — the resend most of all, because a resend
//     is what the tool tells the model to do for a revision and it arrives
//     with `edited: false`;
//   - "creation" means the deck lookup LOOKED AND FOUND NOTHING. A lookup that
//     could not run is a third answer, and read as the first it let a resend
//     re-decide the density of a deck that already exists (16k);
//   - the ask is the USER's, over the last few turns rather than only the
//     newest, because the occasion and the build request are usually two
//     different messages (16l);
//   - the predicate is USED, not merely written (this repo has closed a live
//     security hole on the strength of a line merely existing);
//   - the publish path never re-stamps, because publishing has no ask.
//
// AND THE FIXTURES ARE THE CORPUS, not invented sentences. Every trigger in
// the predicate was measured twice: over the 42 creation asks, and over all
// 2,936 stored user messages, because a trigger's cost is how often its WORD
// occurs in this workspace at all. Four triggers died on that second
// measurement — the bare verb "present" (19 messages, about five of them
// speaking, twice the adjective), the bare noun "pitch" (23 messages, 22 of
// them a media pitch), "run through" (4, all the reading sense) and a
// subject-only "I'm giving/running/doing" (fires on "I am doing some ideation
// for IPU" and earns nothing) — and 16a holds a real message for each.
//
// MUTATION LOG (detached worktree, 2026-09-21) — kills AND survivors:
//   killed   the word boundary dropped from the speaking verb: the Siemens ITM
//            read control, whose only present-stem is "stock images ... that
//            represent the subject", flips to present.
//   killed   the speaking verb unbound from a person (the bare stem restored):
//            four real messages flip, including the ADJECTIVE in "which
//            companies apart from Hiscox are present in this space?".
//   killed   "presentation" added to the speaking verbs: 12 of the 42 stored
//            creations flip on a word that is a plain synonym for deck.
//   killed   the bare noun "pitch" readmitted: three real article-pitch
//            messages flip.
//   killed   "run" readmitted beside walk and talk: "Run through these
//            interview transcripts" flips.
//   killed   "board" readmitted to the occasion nouns: "slides for the board
//            pack" flips — a document, and the only synthetic fixture in 16a,
//            because no stored message says the phrase at all. That is the
//            argument: a word that occurs 0 times as an occasion cannot be in
//            the list on the strength of sounding like one.
//   killed   the subject-only "I'm giving/running/doing" pattern readmitted.
//   killed   the opening clamp removed (askOpening returns the whole text):
//            the 04c5d402 edit turns flip on their own slide copy.
//   killed   the clamp cutting at exactly 300 rather than on a whole word: an
//            ask whose 300th character falls inside "meetings" is truncated
//            into "for our meeting", manufacturing an occasion the text does
//            not contain.
//   killed   stampDensity folded into stampDeckChrome: a present deck reverts
//            to read the moment either build entry point stamps its chrome —
//            and check 47b of verify-slide-layouts (DEFAULT_DENSITY === "read")
//            stays green the whole time, which is why that mutation needs an
//            assertion of its own.
//   killed   creation defined as `edited === false` rather than "no stored
//            deck": the full-deck resend re-infers and reshapes the deck.
//   killed   the edit branch inheriting without re-stamping: an INSERTED slide
//            arrives with no density and is drawn at read inside a present
//            deck — a deck with two densities in it is two decks.
//   killed   the build branch reading "could not look" as "no deck" (which is
//            what it did until 2026-09-21): a resend during a blip infers
//            present,present,present,present over a deck that already exists.
//   killed   a stored-draft reader that THROWS mapped to an empty conversation.
//   killed   carriedDensity accepting slides that disagree about their density.
//   killed   the two edit refusals merged into one message: an edit whose
//            lookup merely failed is told to "build one first with `slides`",
//            and the model — which has the whole deck in its context — would
//            resend it into the build branch as a new deck.
//   killed   recentUserAsks reading only the newest turn, reading the
//            ASSISTANT's turns, and densityFromAsks ignoring DECK_ASK_WINDOW.
//   killed   bare "call" readmitted to the OCCASION noun list, by the
//            "Prep before each call" fixture — which is a line of slide copy
//            from 04c5d402, not an invented string. Predicted to survive and
//            did not: worth saying, because the argument for excluding bare
//            "call" is the 0-for-9 corpus measurement and this shows one real
//            line of copy is enough to pin it.
//   SURVIVED deleting `if (!opening) return "read"` in densityFromAsk. The
//            loop below it returns "read" for an empty string anyway, so no
//            input distinguishes the branch. A finding about the check, not an
//            omission to tidy away: the early return is a statement of the
//            rule ("nothing said means read"), and nothing can pin it.
//   SURVIVED deleting carriedDensity's empty-list early return — the loop
//            below returns the same value for an empty list. Same shape as the
//            one above, and left in for the same reason.
//   SURVIVED a cache hit reporting `couldNotLook: stored.couldNotLook` instead
//            of false. Nothing reads the flag when a deck was found, so no
//            input distinguishes it. It records something true about the
//            design — the flag is only ever consulted on an empty answer —
//            rather than a hole in the check.
//   NOT REACHABLE from here, and said plainly rather than left implied: the
//            real reader's own `if (error)` branch. The seam that lets 16k
//            drive all three answers also means the check never runs the
//            supabase call, so "a failed query is reported, not thrown" is
//            asserted of the CALLER only. It needs a database to pin.
//   And the one that shows why 16i has to exist: under the stampDeckChrome
//   mutation, `npx tsx scripts/verify-slide-layouts.ts` exits 0 with zero 47b
//   failures while every present deck silently reverts to read at publish.
//
// THE POSSESSION FORM (HELD), 2026-09-23 — detached worktree at 4571a26 plus
// the change, each mutant alone. The ask it exists for is 3ec51a09's "we have
// a workshop with Amrize", which built the canonical present deck at read.
//   killed   HELD removed from densityFromAsk → 16a, six cases: the Amrize
//            ask, the two stored progressive/`holding` sentences, the
//            synthetic `'ve got` — and 16m's precondition.
//   killed   `had` admitted → 16a on two real messages ("We had a meeting with
//            Siemens yesterday. Can you give me a summary"). Measured over the
//            corpus, four stored messages flip under it; this guard is the
//            one the corpus demands.
//   killed   the determiner made optional → 16a perfect-synth only.
//   killed   the head-noun rule removed → 16a notes-synth only.
//   killed   the question guard removed → 16a question-synth only.
//            THOSE THREE ARE KILLED BY SYNTHETIC FIXTURES AND BY NOTHING
//            REAL: measured, removing any one of them changes the answer for
//            none of the 2,970 stored messages. Recorded rather than hidden,
//            the way the clamp's word-boundary fixture is — the guards are
//            there because `have` is one of the commonest verbs in the
//            corpus, not because a stored sentence has needed them yet.
//   killed   `'ve got` dropped → 16a got-synth (synthetic: 0 stored uses).
//   killed   `holding` dropped → 16a b443f6fe, the farewell-speech message.
//   killed   an edit inferring its density from the ask, and a resend into a
//            thread that has a deck re-inferring → 16d, 16g, 16k and 16l as
//            before, and 16m on the Amrize thread's own shape: an insert, a
//            patch and a resend of its stored read deck, with the ask that
//            now infers present one turn back, all re-stamped present.
//
// THE FOURTH PASS, 2026-09-23 — the hyphenated modifier, the question test,
// the reading veto and the clause-ending alternative taken out; detached
// worktree at d1c7faf plus the change, each mutant alone. Two of these close
// survivors the verification of d1c7faf found (N16, N9).
//   killed   MODIFIERS back to `\w+` → 16a on 9fc715be, the real "follow-up
//            meeting" ask, and the hyphen synth.
//   killed   HELD losing `\s+are` → 16a on 0ce3417e, the stored sentence the
//            header cites for it (N16: it survived until that was a case).
//   killed   the question test replaced by HELD on the whole opening → 16a on
//            the four question synths, the first of them the old one.
//   killed   the question asked of the whole opening rather than the HELD
//            sentence → 16a then-ask-synth: a statement followed by a request
//            ending in "?" read as a question.
//   killed   the reading veto removed → 16a on its four synths, and each of
//            its phrases alone (pre-read, leave-behind, send round) → its own
//            synth. The veto's fixtures are checked PRESENT without their
//            phrase, so none of them passes by being read for another reason.
//   killed   a reading turn not ending the window's search → 16a, both window
//            cases.
//   N9, the clause-ending alternative ("we have a workshop."), was not
//            pinned but REMOVED: it had no stored sentence behind it — taken
//            out, not one of 2,987 stored messages changes — and this file's
//            rule for a trigger is a real sentence.
//   No survivors. The synthetic cases are said to be synthetic where they
//            are listed, for the reason the clamp's word-boundary one is.
;(async () => {
const before16 = failures;
console.log("\n16. Density is decided once, at creation, and an edit never changes it");

/** A deck standing in for a stored one, at whatever density it was built at. */
const plainDeck = () => [
  { layout: "cover", title: "AI tools at TCE" },
  { layout: "content", title: "What it does", body: "One" },
  { layout: "content", title: "What it costs", body: "Two" },
  { layout: "content", title: "What happens next", body: "Three" },
];
const densities = (slides: any[]) => slides.map((s: any) => densityOf(s)).join(",");
const allAt = (slides: any[], d: string) => slides.length > 0 && slides.every((s: any) => densityOf(s) === d);

// THE STORED-DRAFT STORE, STUBBED FOR THE WHOLE OF 16 — and the reason it has
// to be is the first thing this check found about itself. There is no database
// reachable from a laptop or from CI, so against the real reader EVERY lookup
// answers "could not look", and the whole of 16 used to run on the in-process
// turn cache alone. That cache is warm for exactly one lambda. The path
// production takes on every turn after the one that built the deck — read the
// stored draft, inherit its density — had no coverage at all, so 16d and 16g
// passed for a reason that does not exist in production.
//
// STORE holds what the route would have written; UNREADABLE is a conversation
// whose lookup fails, which is a third answer and not an empty conversation.
const STORE = new Map<string, any>();
const UNREADABLE = new Set<string>();
const restoreStore = __setStoredDraftReader(async (conversationId: string) => {
  if (UNREADABLE.has(conversationId)) return { draft: null, couldNotLook: true };
  return { draft: STORE.get(conversationId) || null, couldNotLook: false };
});

try {
  // (a) THE PREDICATE ITSELF. Every fixture that is not synthetic is a real
  //     ask, copied out of intelligence.ai_messages verbatim.
  const CASES: [string, string, string][] = [
    // The six stored creations that say plainly the deck will be spoken.
    ["6d0ec81b", "Can you help me prepare for tomorrow's morning meeting. We need to include an agenda for the following.", "present"],
    ["1d14b7c2", "Can you check and update this presentation. create a new deck that works for sales pitches for the AI products we are now selling", "present"],
    ["05f0536c", "Can you use AuthorityOn to write a report for the Siemens ITM report brand's AI authority performance. make a google presentation to walk through the findings", "present"],
    ["edbcfadf", "I'm giving a briefing to the team on AI tools for TCE tomorrow morning. can you make me a great presentation for me.", "present"],
    ["cd96db5a", "can you create a slide deck for my 10am meeting on nature finance", "present"],
    ["e35a5600", "Can you review these slides, fix the formatting issues and produce a Google Slides presentation for me to present for the client?", "present"],
    // The plan's own example, kept working — and the reason bare "call" is out.
    ["plan", "a deck for Thursday's call", "present"],
    // THE CANONICAL READ CONTROL. Its only present-stem is "represent".
    ["4e54d076", "Turn the Siemens ITM 2025 — AI visibility audit — Executive report report into a TCE-branded slide deck. It should summarise the executive report in a clear and insightful way so that C-suite executives are able to digest it in a time-pressured environment. For visuals, pull in stock images where appropriate that represent the subject of the slide.", "read"],
    // "presentation" is a synonym for deck, in four separate conversations.
    ["conversion", "Can you make this presentation in TCE format. keep the content the same just change the format to match the company style.", "read"],
    ["04c5d402", "can you make me a 10 slide presentation on this", "read"],
    // The ordinary edit the whole asymmetry exists for.
    ["edit", "can you make slide 4's presentation of the numbers clearer", "read"],
    // QUOTED SLIDE COPY, verbatim from the corpus turns that wrongly flip.
    ["copy-1", "Prep before each call", "read"],
    ["copy-3", "here are the notes from Gabi and my prep meeting. can you update the presentation", "read"],
    ["copy-4", "MeetingBrain writes up your meetings", "read"],
    ["copy-5", "build it in three tool calls, not one", "read"],
    // What the ask usually looks like: nothing about purpose at all. 34 of 42.
    ["bare-1", "can you make some slides for this", "read"],
    ["bare-2", "ok. generate the slides", "read"],
    ["bare-3", "Build the timeline as a deck first.", "read"],
    ["", "", "read"],
    // THE WORDS THAT MEAN SOMETHING ELSE HERE. Each of these is a real stored
    // message, and each was measured across all 2,936 of them before the
    // trigger that matched it was narrowed or dropped. They matter more than
    // fixtures usually do, because any of them can now be the turn BEFORE a
    // build request and decide a deck's shape from one turn back (16l).
    //
    // A PITCH IS A WRITTEN THING IN THIS WORKSPACE: 22 of the 23 stored
    // messages containing the word are an article pitch, and only the bound
    // form ("for sales pitches", above) is a deck somebody stands up with.
    ["pitch-1", "Write a 50 article word pitch for the first key trend on global equity. Suggest the most engaging article type and list the researchers that would need to be interviewed", "read"],
    ["pitch-2", "Do you think there is an article pitch that would fall under his leadership pillar?", "read"],
    ["pitch-3", "I don't think this fund has been attributed to the fellowship projects. Omit this part of the pitch.", "read"],
    // THE BARE VERB "present" IS USUALLY "lay out", and twice the adjective —
    // which no word boundary can exclude, only a binding to a person can.
    ["present-1", "Please suggest some formats we can use to present IPU's I say yes campaign, specifically unpacking the 6 pledges", "read"],
    ["present-2", "Thanks. Which companies apart from Hiscox are present in this space?", "read"],
    ["present-3", "You are an ideation specialist. I need to come up with some ideas for how to present this new Horizon biotech funding research on LinkedIn.", "read"],
    ["present-4", "Here's how I propose presenting these ideas to the client in an email. Does that tally with what the client said?", "read"],
    // "run through" IS THE READING SENSE HERE, every one of the four stored
    // messages that says it. "walk through" and "talk through" stay.
    ["run-1", "Run through these interview transcripts and identify the main themes", "read"],
    ["run-2", "can you give me a summary of clients to run through (ie account managers)", "read"],
    // AND THE SUBJECT WITHOUT THE OBJECT SAYS NOTHING: "I'm doing/running/
    // giving" constrained who, not what, and fired on this.
    ["doing-1", "I am doing some ideation for IPU. Please generate some ideas to promote the youth participation report attached", "read"],
    // SYNTHETIC, and the only one here that is: no stored message says "board
    // pack", which is exactly why the word cannot be in the occasion list on
    // the strength of sounding like an occasion. A board MEETING still is one.
    ["board-pack", "Turn this proposal into slides for the board pack", "read"],
    ["board-meeting", "Turn this proposal into slides for the board meeting on Thursday", "present"],
    // THE POSSESSION FORM (HELD), 2026-09-23. The occasion OWNED rather than
    // served: no binding preposition, so OCCASION missed it, and the canonical
    // present deck was built at read. The first is that ask, verbatim, typo
    // and all; the next two are the other stored sentences that carry the
    // progressive and `holding`, each an occasion the writer is about to run.
    ["3ec51a09", "we have a workshop with Amrize toi show them how to create and optimise content for AI. Can you build a presentation based on the work we have done for them and best practice.", "present"],
    ["0e26a900", "I'm having a workshop with Gabi and Roberts this morning. This is to discuss how we ^split respionsibilities and operational duties between the three directors.", "present"],
    ["b443f6fe", "Can you help me write up a speech for Georgie's departure? I am holding a farewell meeting with the team and her today and would like to say a few nice words.", "present"],
    // THE BRITISH SPELLING OF THE SAME VERB — synthetic, because it occurs
    // nowhere in the 2,974 stored messages; admitted as `have`, not as a new
    // trigger, and measured to fire on nothing else.
    ["got-synth", "we've got a meeting with Siemens on Thursday, can you pull a deck together", "present"],
    // PAST TENSE: real, and the guard the corpus demands — four of the five
    // stored `had` sentences flip the moment it is admitted.
    ["02fb7331", "We had a meeting with Siemens yesterday. Can you give me a summary", "read"],
    ["5d8e9224", "we had a meeting in which we discussed how we should commission CUs for the contract", "read"],
    // THE REAL NEAR-MISS: "have" as an auxiliary, the noun as a modifier.
    ["d03ae52c", "I have attached the briefing document for SCOPE now. This should help.", "read"],
    // SYNTHETIC, one per guard no stored message needs today (the header of
    // density-from-ask.ts says which): the perfect tense (the determiner), a
    // document named after an occasion (the head noun), and a calendar
    // QUESTION, which is the commonest thing this app is asked about meetings.
    ["perfect-synth", "We have finished the workshop with Amrize, can you write up the actions", "read"],
    ["notes-synth", "we have the meeting notes from Tuesday, can you turn them into a summary", "read"],
    ["question-synth", "Do we have a meeting with Siemens tomorrow?", "read"],
    // THE PROGRESSIVE WITH `are`, the stored sentence the header of
    // density-from-ask.ts cites for it — verbatim, "to day" and all.
    ["0ce3417e", "We are having a morning meeting to day goodbye to Holly this morning. Can you write me a script. here are some notes but can you also check the Engine and notes for more.", "present"],
    // THE HYPHENATED MODIFIER, 2026-09-23: the real ask, verbatim, that `\w+`
    // could not step over — built at read, where "follow up meeting" would
    // have been present.
    ["9fc715be", "I am preparing a deck for a follow-up meeting will who is leading the North American corporate comms team at BeOne Medicines. \n\nFrom Ed's captured meeting notes, can you remind me what is important for the client that I should convey in the follow-up meeting and presentation? \n\nEd will also be attending and presenting a few slides with ideas for their CEO thought leadership.", "present"],
    ["hyphen-synth", "We have a half-day workshop with Amrize on Thursday, can you build the deck", "present"],
    // A QUESTION IS ASKED OF ITS OWN SENTENCE. SYNTHETIC, all four: the
    // lookbehind these replace caught "do we" and "did we" with one space and
    // nothing else, and measured, the sentence test changes no stored message.
    // The last is the other direction — a statement followed by a question is
    // still a statement.
    ["didnt-synth", "Didn't we have a meeting with Siemens last week?", "read"],
    ["will-synth", "Will we have a meeting with Siemens next week?", "read"],
    ["know-synth", "Do you know if we have a meeting with Siemens tomorrow?", "read"],
    ["then-ask-synth", "We have a workshop with Amrize on Thursday. Can you build a deck for it?", "present"],
    // THE READING VETO. The two stored openings it matches are already read
    // (a veto that narrows needs no sentence to exist; it needs to cost no
    // stored `present`, and measured it costs none), so the fixtures that
    // pin it are SYNTHETIC, each one present by another rule without it.
    ["db3ab475", "Thanks for providing your sources, could you choose the best five resources for me to read and provide a list with link and short summary of key points", "read"],
    ["read-synth", "I have a meeting with Siemens tomorrow, summarise the notes into slides for me to read before it", "read"],
    ["preread-synth", "Turn this proposal into a pre-read for the board meeting on Thursday", "read"],
    ["leave-synth", "Make a leave-behind deck for my 10am meeting with Siemens", "read"],
    ["send-synth", "Build slides to send round before the workshop with Amrize", "read"],
  ];
  for (let i = 0; i < CASES.length; i++) {
    const got = densityFromAsk(CASES[i][1]);
    if (got !== CASES[i][2]) {
      fail(`16a ${CASES[i][0] || "empty"}: expected ${CASES[i][2]}, got ${got} — ${JSON.stringify(CASES[i][1].slice(0, 70))}`);
    }
  }
  // THE VETO'S FIXTURES MUST BE PRESENT WITHOUT IT, or they pin nothing: each
  // one, its reading phrase struck out, has to read present.
  const VETOED: [string, string][] = [
    ["read-synth", "I have a meeting with Siemens tomorrow, summarise the notes into slides before it"],
    ["preread-synth", "Turn this proposal into slides for the board meeting on Thursday"],
    ["leave-synth", "Make a deck for my 10am meeting with Siemens"],
    ["send-synth", "Build slides before the workshop with Amrize"],
  ];
  for (let i = 0; i < VETOED.length; i++) {
    if (densityFromAsk(VETOED[i][1]) !== "present") fail(`16a precondition: ${VETOED[i][0]} is not present without its reading phrase, so it does not test the veto`);
  }
  // NEWEST DECISIVE TURN WINS, both ways: a turn that says the deck is for
  // reading is not overruled by an occasion one turn back.
  if (densityFromAsks(["summarise the notes into slides for me to read before it", "I have a meeting with Siemens tomorrow"]) !== "read") {
    fail("16a a reading purpose in the newest turn was overruled by an occasion one turn back");
  }
  if (densityFromAsks(["can you build the slides", "summarise the notes for me to read", "I have a meeting with Siemens tomorrow"]) !== "read") {
    fail("16a an older reading purpose did not end the search before the occasion behind it");
  }

  // (b) THE CLAMP. Slide copy far into a long message is content, not the ask.
  //     Both fixtures are the real corpus shape: a long, precise build request
  //     whose OWN SLIDE COPY carries the words. "or talk it through" is a
  //     caption inside a `process` stage in 04c5d402; as a bare fragment it is
  //     a speaking verb and the rule is right to read it as one, which is
  //     exactly why the scope — not the wording — has to be what saves it.
  const PREAMBLE = "Rebuild this deck as exactly these 10 slides, as a new version of the deck. Use fidelity \"preserve\": these layouts, titles, fields and wording, nothing added or reworded. imageStyle: \"deep navy and electric blue, abstract light and data, calm, no people\". Use hyphens, never em or en dashes. Slide 1 cover, slide 2 content, slide 3 process. ";
  const BURIED: [string, string][] = [
    ["an occasion phrase", "for my 10am meeting on nature finance"],
    ["a stage caption", "stage 4 caption \"Ask MeetingBrain, or talk it through\""],
    ["a slide's own line", "slide 6 body \"Prep before Thursday's meeting\""],
  ];
  for (let i = 0; i < BURIED.length; i++) {
    const tail = BURIED[i][1];
    const whole = PREAMBLE + tail;
    if (PREAMBLE.length < 300) {
      fail(`16b precondition: the preamble is only ${PREAMBLE.length} characters, so the buried copy is inside the clamp and this fixture pins nothing`);
      break;
    }
    if (densityFromAsk(tail) !== "present") {
      fail(`16b precondition: ${BURIED[i][0]} does not infer present on its own, so the clamp assertion proves nothing — ${JSON.stringify(tail)}`);
    } else if (densityFromAsk(whole) !== "read") {
      fail(`16b ${BURIED[i][0]} buried in a build request still re-stamps the deck — the opening clamp is not being applied`);
    }
  }
  // AND THE CLAMP CUTS ON A WHOLE WORD, because a cut mid-word can MANUFACTURE
  // a trigger the text does not contain. Synthetic, because no stored ask does
  // this — and pinned precisely because only a synthetic fixture ever will.
  // `new Array(n).join` rather than String.repeat: scripts/ is type-checked by
  // next build and tsconfig sets no target.
  //
  // The word is "meetings": cut at exactly 300 it becomes "for our meeting",
  // which is an occasion, and the plural is not one. Whether it OUGHT to be is
  // a separate question the corpus has not answered — the point here is that
  // truncation must not answer it by accident. (This fixture used to straddle
  // "presentation"; since the speaking verb was bound to a person, a truncated
  // "present" is inert and that fixture asserted nothing.)
  const straddle = new Array(285).join("x") + " for our meetings on nature finance";
  const cut = straddle.slice(0, 300);
  const opened = askOpening(straddle);
  if (cut.slice(-16) !== " for our meeting" || straddle.charAt(300) !== "s") {
    fail(`16b precondition: the 300th character does not fall inside "meetings" (${JSON.stringify(straddle.slice(290, 306))}), so the whole-word cut is not being exercised`);
  } else if (densityFromAsk(cut) !== "present") {
    fail("16b precondition: a bare 300-character cut does not manufacture a trigger, so there is nothing here for the whole-word cut to prevent");
  } else if (opened.indexOf("meetings") < 0) {
    fail(`16b askOpening cut inside "meetings" and manufactured the trigger: ${JSON.stringify(opened.slice(-20))}`);
  } else if (densityFromAsk(straddle) !== "read") {
    fail(`16b a truncated word still infers present: ${JSON.stringify(opened.slice(-24))}`);
  }

  // (c) CREATION INFERS. Driven through the real call site, not the predicate.
  const convP = `verify-density-present-${process.pid}`;
  const madeP = await prepareSlidesForBuild({ title: "Nature finance", slides: plainDeck() }, convP,
    ["can you create a slide deck for my 10am meeting on nature finance"]);
  if (madeP.density !== "present") fail(`16c a deck asked for a 10am meeting was created at ${madeP.density}`);
  else if (!allAt(madeP.slides, "present")) fail(`16c the inferred density did not reach every slide: ${densities(madeP.slides)}`);

  const convR = `verify-density-read-${process.pid}`;
  const madeR = await prepareSlidesForBuild({ title: "AI tools at TCE", slides: plainDeck() }, convR,
    ["can you make me a 10 slide presentation on this"]);
  if (madeR.density !== "read") fail(`16c an ordinary ask was created at ${madeR.density}, not the default`);
  else if (!allAt(madeR.slides, "read")) fail(`16c a read deck is not uniformly read: ${densities(madeR.slides)}`);
  if (DEFAULT_DENSITY !== "read") fail(`16c precondition: the default is ${DEFAULT_DENSITY}, so "stayed read" says nothing about inheritance`);

  // (d) AN EDIT INHERITS, EVEN WHEN ITS OWN WORDS SAY THE OTHER THING.
  //     This is the assertion that would have caught 04c5d402.
  const EDIT_ASK = "Build a NEW 10-slide deck to replace the one above, for tomorrow's team briefing.";
  if (densityFromAsk(EDIT_ASK) !== "present") {
    fail("16d precondition: the edit ask does not infer present on its own, so the inheritance assertions below are vacuous");
  }
  const edited = await prepareSlidesForBuild(
    { slides: [], editSlide: { slideNumber: 2, body: "One, rewritten" } }, convR, [EDIT_ASK]);
  if (edited.density !== "read") fail(`16d an edit re-stamped the deck to ${edited.density} from the words in the edit`);
  else if (!allAt(edited.slides, "read")) fail(`16d an edit reflowed part of a read deck: ${densities(edited.slides)}`);

  //     And the other direction, so "stayed read" is not just the default
  //     showing through: a present deck survives a plain edit.
  const editedP = await prepareSlidesForBuild(
    { slides: [], editSlide: { slideNumber: 2, body: "One, rewritten" } }, convP, ["tidy up slide 2"]);
  if (!allAt(editedP.slides, "present")) fail(`16d a present deck lost its density on an ordinary edit: ${densities(editedP.slides)}`);

  // (e) AN INSERT — and the inserted slides carry it too, which they do only
  //     because the inherited density is RE-STAMPED over the whole result.
  const inserted = await prepareSlidesForBuild(
    { slides: [], editSlide: { insertAfter: 2, insertSlides: [
      { layout: "content", title: "Writer", body: "From brief to first draft" },
      { layout: "content", title: "Optimiser", body: "Score, then rewrite" },
    ] } }, convP, ["add two slides about Writer and Optimiser for tomorrow's team briefing"]);
  if (inserted.slides.length !== 6) fail(`16e precondition: the insert did not grow the deck (${inserted.slides.length})`);
  else if (!allAt(inserted.slides, "present")) fail(`16e inserted slides were drawn at a different density from the deck they joined: ${densities(inserted.slides)}`);
  else if (inserted.slides[2].title !== "Writer") fail("16e precondition: the inserted slide is not where it was asked for");

  // (f) A REORDER, done the way the tool makes a user do it: remove, then
  //     insert back somewhere else. Two calls, because the numbering shifts.
  const removed = await prepareSlidesForBuild(
    { slides: [], editSlide: { removeSlides: [3] } }, convP, ["drop slide 3 before Thursday's meeting"]);
  if (removed.slides.length !== 5) fail(`16f precondition: the remove did not apply (${removed.slides.length})`);
  else if (!allAt(removed.slides, "present")) fail(`16f a removal changed the deck's density: ${densities(removed.slides)}`);
  const reordered = await prepareSlidesForBuild(
    { slides: [], editSlide: { insertAfter: 5, insertSlides: [{ layout: "content", title: "Optimiser", body: "Score, then rewrite" }] } },
    convP, ["put it back at the end, ready for the briefing"]);
  if (reordered.slides.length !== 6) fail(`16f precondition: the reorder's insert did not apply (${reordered.slides.length})`);
  else if (!allAt(reordered.slides, "present")) fail(`16f a reorder left the deck at two densities: ${densities(reordered.slides)}`);

  // (g) A FULL-DECK RESEND IS A REVISION, NOT A NEW DECK. It arrives with
  //     `edited: false` — the tool's own description tells the model to resend
  //     the whole list for every change — so keying creation on `edited` would
  //     re-infer here, against the user's newest sentence, on a deck they are
  //     part-way through editing.
  const resent = await prepareSlidesForBuild(
    { title: "AI tools at TCE", slides: plainDeck().concat([{ layout: "content", title: "One more", body: "Four" }]) },
    convR, [EDIT_ASK]);
  if (resent.edited !== false) fail("16g precondition: the resend is reported as an edit, so it does not exercise the built branch");
  else if (resent.density !== "read") fail(`16g a full-deck resend re-inferred and reshaped an existing deck to ${resent.density}`);
  else if (!allAt(resent.slides, "read")) fail(`16g a full-deck resend reflowed the deck: ${densities(resent.slides)}`);

  // (h) A SPLIT. A body one paragraph too long becomes two slides, and the
  //     continuation is the same deck — it is drawn at the same density or the
  //     page it continues changes shape halfway down.
  const paras: string[] = [];
  for (let i = 0; i < 40; i++) paras.push(`The engine reads the brief and writes the first draft, then scores it and rewrites the weakest section (${i + 1}).`);
  const long = paras.join("\n");
  const split = splitOverflowingSlides(stampDensity(
    [{ layout: "content", title: "Writer", body: long }] as any, "present") as any);
  if (split.length < 2) fail(`16h precondition: the body did not split (${split.length} slide(s)), so nothing about continuations is proved`);
  else if (!allAt(split as any[], "present")) fail(`16h a continuation slide is drawn at a different density from the slide it continues: ${densities(split as any[])}`);

  // (i) PUBLISHING HAS NO ASK, SO IT CANNOT INFER — and the one way it would
  //     start to is somebody folding stampDensity into the other deck-wide
  //     stamper for tidiness. Asserted on stampDeckChrome itself, because that
  //     is what both build entry points call.
  const chromed = stampDeckChrome(stampDensity(plainDeck() as any, "present") as any, "AI tools at TCE");
  if (!allAt(chromed as any[], "present")) fail(`16i stamping the deck's chrome reverted its density to ${densities(chromed as any[])} — a present deck would become a read deck the moment it reached Drive`);
  if (!(chromed as any[])[1].footer) fail("16i precondition: stampDeckChrome stamped no footer, so the assertion above may be testing nothing");

  //     And it survives the round trip through storage, because the publish
  //     button posts the stored draft back from the browser.
  const stored = JSON.parse(JSON.stringify({ title: "AI tools at TCE", slides: chromed }));
  if (densityOf(stored.slides[0]) !== "present") fail("16i density did not survive the draft's round trip through JSON storage");

  // (j) THE MODEL IS TOLD, and it is told inside the schema it is actually
  //     sent. The stamp alone half-works: the geometry changes, the model goes
  //     on writing read-length copy, and the deck grows in thin continuation
  //     slides (measured: 80 slides to 84 across the six inferred decks).
  const toolJson = JSON.stringify(SLIDES_GEN_OPENAI_TOOL);
  if (toolJson.indexOf("HALF the words per slide") < 0) {
    fail("16j nothing in generate_slides tells the model that a spoken deck holds half the words — the stamp would change the geometry under copy written for read");
  }
  if (toolJson.length > 55000) fail(`16j generate_slides is ${toolJson.length} characters, over its 55,000 ceiling`);

  // (k) THE LOOKUP HAS THREE ANSWERS AND ONLY ONE OF THEM MAY INFER.
  //     Everything above this point runs with the turn cache warm, because the
  //     same process built the deck it then edits. Production is not like
  //     that: the lambda that built the deck is usually gone by the next turn
  //     and the deck comes back from the stored draft. So these run COLD — a
  //     conversation id this process has never built in — and the answer comes
  //     from the store.
  //
  //     "Nothing stored" and "could not read the store" are one value in a
  //     nullable, and read as the first, the second let a resend re-decide the
  //     density of a deck that already exists. The edit branch has always
  //     failed CLOSED in that state; the build branch failed open in it.
  {
    const ASK_READ = ["can you make me a 10 slide presentation on this"];
    const ASK_PRESENT = ["can you create a slide deck for my 10am meeting on nature finance"];
    const storedPresent = () => ({ title: "Nature finance", slides: stampDensity(plainDeck() as any, "present") });
    if (densityFromAsks(ASK_READ) !== "read" || densityFromAsks(ASK_PRESENT) !== "present") {
      fail("16k precondition: the two asks do not infer opposite densities, so nothing below distinguishes inheriting from inferring");
    }

    // FOUND: the stored deck decides, and the ask is not consulted at all.
    const convFound = `verify-density-found-${process.pid}`;
    STORE.set(convFound, storedPresent());
    const found = await prepareSlidesForBuild({ title: "Nature finance", slides: plainDeck() }, convFound, ASK_READ);
    if (!allAt(found.slides, "present")) fail(`16k a resend into a conversation whose STORED deck is present came back ${densities(found.slides)} — the stored density was not inherited`);

    // LOOKED AND FOUND NOTHING: the one answer that may infer.
    const convEmpty = `verify-density-empty-${process.pid}`;
    const empty = await prepareSlidesForBuild({ title: "Nature finance", slides: plainDeck() }, convEmpty, ASK_PRESENT);
    if (!allAt(empty.slides, "present")) fail(`16k a first deck in an empty conversation did not infer from the ask: ${densities(empty.slides)}`);

    // COULD NOT LOOK: never infers, however loudly the ask asks.
    const convBlind = `verify-density-blind-${process.pid}`;
    UNREADABLE.add(convBlind);
    const blind = await prepareSlidesForBuild({ title: "Nature finance", slides: plainDeck() }, convBlind, ASK_PRESENT);
    if (!allAt(blind.slides, "read")) fail(`16k a build whose deck lookup FAILED inferred ${densities(blind.slides)} from the ask — a blip would re-decide the density of a deck that already exists`);

    //     …and it still inherits from the only other place the value survives:
    //     the slides the model resent, which came from the deck context.
    const convBlindResend = `verify-density-blind-resend-${process.pid}`;
    UNREADABLE.add(convBlindResend);
    const resentPresent = await prepareSlidesForBuild(
      { title: "Nature finance", slides: stampDensity(plainDeck() as any, "present") }, convBlindResend, ASK_READ);
    if (!allAt(resentPresent.slides, "present")) fail(`16k a failed lookup threw away the density the resent slides were carrying: ${densities(resentPresent.slides)}`);

    //     …but a deck that does not all agree is not evidence of anything.
    const convBlindMixed = `verify-density-blind-mixed-${process.pid}`;
    UNREADABLE.add(convBlindMixed);
    const mixed = plainDeck() as any[];
    stampDensity(mixed, "present");
    mixed[2].density = "read";
    const mixedOut = await prepareSlidesForBuild({ title: "Nature finance", slides: mixed }, convBlindMixed, ASK_PRESENT);
    if (!allAt(mixedOut.slides, "read")) fail(`16k slides that disagree about their density were read as inheritance: ${densities(mixedOut.slides)}`);

    //     A READER THAT THROWS IS THE SAME ANSWER. The real one catches its
    //     own faults, but what "no draft" means is decided in one place and an
    //     exception must not arrive there as an empty conversation.
    const convThrow = `verify-density-throw-${process.pid}`;
    const restoreThrow = __setStoredDraftReader(async () => { throw new Error("connection reset"); });
    const thrown = await prepareSlidesForBuild({ title: "Nature finance", slides: plainDeck() }, convThrow, ASK_PRESENT);
    restoreThrow();
    if (!allAt(thrown.slides, "read")) fail(`16k a stored-draft read that THREW was treated as an empty conversation and inferred ${densities(thrown.slides)}`);

    //     AND THE EDIT BRANCH SAYS WHICH REFUSAL IT IS. "Build one first with
    //     `slides`" is the one instruction that must not be given here: the
    //     model has the whole deck in its context and would resend it, into
    //     the build branch, as a new deck.
    const convBlindEdit = `verify-density-blind-edit-${process.pid}`;
    UNREADABLE.add(convBlindEdit);
    let refusal: any = null;
    try {
      await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 1, body: "One, rewritten" } }, convBlindEdit, ASK_READ);
    } catch (e: any) { refusal = e; }
    if (!refusal || !isSlideCallRefusal(refusal)) {
      fail("16k an edit whose deck lookup failed did not refuse");
    } else if (/build one first/i.test(String(refusal.message))) {
      fail("16k an edit whose lookup merely FAILED was told to build a new deck — the model would resend the deck it already has, as a creation");
    } else if (!/could not be loaded/i.test(String(refusal.message))) {
      fail(`16k the refusal for a failed lookup does not say the deck could not be read: ${String(refusal.message).slice(0, 80)}`);
    }
    //     And the empty conversation still gets the OTHER refusal, so the two
    //     have not simply been merged into one message.
    const convEmptyEdit = `verify-density-empty-edit-${process.pid}`;
    let refusal2: any = null;
    try {
      await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 1, body: "One, rewritten" } }, convEmptyEdit, ASK_READ);
    } catch (e: any) { refusal2 = e; }
    if (!refusal2 || !/build one first/i.test(String(refusal2.message))) {
      fail(`16k an edit in a genuinely empty conversation no longer tells the model to build one first: ${String(refusal2 && refusal2.message).slice(0, 80)}`);
    }
  }

  // (l) THE OCCASION IS OFTEN A TURN OR TWO BACK, and it is read from the
  //     USER's turns only.
  //
  //     04c5d402 is the deck this window exists for, and its real shape: the
  //     briefing is named in the FIRST message of the conversation, the deck
  //     is asked for eighteen minutes later with a sentence that says nothing
  //     about purpose, and the deck was published to Drive at read.
  {
    const FIRST = "I'm giving a briefing to the team on AI tools for TCE tomorrow morning. can you make me an outline of this for me.";
    const THEN = "can you make me a 10 slide presentation on this";
    const REPLY = "Here is the outline for your briefing tomorrow morning, ready to walk the team through.";
    const msgs: any[] = [
      { role: "user", content: FIRST },
      { role: "assistant", content: REPLY },
      { role: "user", content: THEN },
    ];
    const asks = recentUserAsks(msgs);
    if (asks.length !== 2 || asks[0] !== THEN || asks[1] !== FIRST) {
      fail(`16l recentUserAsks did not return the user's own turns newest first (${asks.length}: ${JSON.stringify(asks.map((a) => a.slice(0, 24)))})`);
    }
    if (densityFromAsk(THEN) !== "read") fail("16l precondition: the build request infers present on its own, so the window proves nothing");
    if (densityFromAsk(FIRST) !== "present") fail("16l precondition: the opening turn does not infer present, so there is nothing for the window to carry");
    const convWindow = `verify-density-window-${process.pid}`;
    const built = await prepareSlidesForBuild({ title: "AI tools at TCE", slides: plainDeck() }, convWindow, asks);
    if (!allAt(built.slides, "present")) fail(`16l the briefing named one user turn earlier was lost: ${densities(built.slides)}`);

    //     THE ASSISTANT'S WORDS ARE NEVER THE ASK. The reply above would infer
    //     present on its own — it is the model's paraphrase, and a deck's shape
    //     is not decided by the model describing what it just did.
    if (densityFromAsk(REPLY) !== "present") {
      fail("16l precondition: the assistant's reply does not infer present, so excluding it is not being tested");
    }
    const convSpoken = `verify-density-assistant-${process.pid}`;
    const spokenOnly = await prepareSlidesForBuild({ title: "AI tools at TCE", slides: plainDeck() },
      convSpoken, recentUserAsks([{ role: "user", content: "here are the notes" }, { role: "assistant", content: REPLY }, { role: "user", content: THEN }] as any));
    if (!allAt(spokenOnly.slides, "read")) fail(`16l the model's own reply decided the deck's density: ${densities(spokenOnly.slides)}`);

    //     AND IT IS BOUNDED, by the window the route already uses for deck
    //     asks rather than by a second number written down here.
    const far: string[] = [THEN];
    for (let i = 1; i < DECK_ASK_WINDOW; i++) far.push("and add the Q3 figures");
    far.push(FIRST);
    if (densityFromAsk(far[far.length - 1]) !== "present") fail("16l precondition: the out-of-window turn does not infer present");
    if (densityFromAsks(far) !== "read") fail(`16l a turn ${far.length - 1} back still decided the density — the window is not bounded at DECK_ASK_WINDOW (${DECK_ASK_WINDOW})`);
    const edge = far.slice(0, DECK_ASK_WINDOW - 1).concat([FIRST]);
    if (densityFromAsks(edge) !== "present") fail(`16l the turn at the edge of the window was dropped (${edge.length} turns, window ${DECK_ASK_WINDOW})`);
    const many: any[] = [];
    for (let i = 0; i < 8; i++) many.push({ role: "user", content: `turn ${i}` });
    if (recentUserAsks(many).length !== DECK_ASK_WINDOW) fail(`16l recentUserAsks returned ${recentUserAsks(many).length} turns, not DECK_ASK_WINDOW (${DECK_ASK_WINDOW})`);

    //     AND AN EDIT STILL INHERITS, even when a turn inside the window says
    //     the other thing. Reading back over turns makes the asymmetry matter
    //     more, not less.
    const editedWindow = await prepareSlidesForBuild(
      { slides: [], editSlide: { slideNumber: 2, body: "One, rewritten" } }, convR, ["tidy up slide 2", FIRST]);
    if (!allAt(editedWindow.slides, "read")) fail(`16l an edit inherited from the window instead of from the deck: ${densities(editedWindow.slides)}`);
  }

  // (m) THE AMRIZE THREAD ITSELF (3ec51a09). Its deck was CREATED at `read`
  //     on 2026-09-22, before the possession form existed, and the widening
  //     must not reach back and reshape it: the next turn in that thread
  //     attaches two files and asks for new slides, and the original ask —
  //     which now infers present — is still inside DECK_ASK_WINDOW. So the
  //     same ask is driven both ways: a NEW deck from it is present, and an
  //     edit, an insert and a full-deck resend of the STORED read deck, with
  //     that ask one turn back, all stay read.
  {
    const AMRIZE = "we have a workshop with Amrize toi show them how to create and optimise content for AI. Can you build a presentation based on the work we have done for them and best practice.";
    const NEXT = "Attached: our editorial optimisation doc and demand analysis. Final Obama article: https://docs.google.com/document/d/x. Update the deck: swap the stats on slides 3 and 5 for Amrize's own baseline from the spreadsheet, then after slide 16 add the 12-point checklist scored across all four articles.";
    if (densityFromAsk(AMRIZE) !== "present") fail("16m precondition: the Amrize ask does not infer present, so nothing below is tested");
    if (densityFromAsk(NEXT) !== "read") fail("16m precondition: the follow-up ask infers present on its own, so the window is not what is being tested");
    const convNew = `verify-density-amrize-new-${process.pid}`;
    const made = await prepareSlidesForBuild({ title: "AI Search Content Workshop — Amrize", slides: plainDeck() }, convNew, [AMRIZE]);
    if (!allAt(made.slides, "present")) fail(`16m a NEW deck from the Amrize ask was created at ${densities(made.slides)}`);
    const convOld = `verify-density-amrize-stored-${process.pid}`;
    STORE.set(convOld, { title: "AI Search Content Workshop — Amrize", slides: stampDensity(plainDeck() as any, "read") });
    const asks = [NEXT, AMRIZE];
    const inserted = await prepareSlidesForBuild(
      { slides: [], editSlide: { insertAfter: 3, insertSlides: [{ layout: "content", title: "The 12-point checklist", body: "Title tag\nMeta description" }] } },
      convOld, asks);
    if (inserted.density !== "read" || !allAt(inserted.slides, "read")) fail(`16m an insert into the stored Amrize deck re-stamped it: ${densities(inserted.slides)}`);
    const patched = await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 3, body: "26 AI citations against GAF's 3,967" } }, convOld, asks);
    if (patched.density !== "read" || !allAt(patched.slides, "read")) fail(`16m a patch to the stored Amrize deck re-stamped it: ${densities(patched.slides)}`);
    const resentOld = await prepareSlidesForBuild({ title: "AI Search Content Workshop — Amrize", slides: plainDeck() }, convOld, asks);
    if (resentOld.density !== "read" || !allAt(resentOld.slides, "read")) fail(`16m a full-deck resend of the stored Amrize deck re-inferred it: ${densities(resentOld.slides)}`);
  }
} catch (e: any) {
  fail(`16 driving the density decision threw: ${String(e?.message || e).slice(0, 160)}`);
} finally {
  restoreStore();
}
if (failures === before16) {
  pass("a new deck infers its density from the ask, and an edit, an insert, a reorder, a split, a full-deck resend and the publish all inherit it");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
})();
