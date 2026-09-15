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

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
