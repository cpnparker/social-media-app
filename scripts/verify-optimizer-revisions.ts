/**
 * Before and after, section by section — checked by making the alignment lie.
 *
 *   npx tsx scripts/verify-optimizer-revisions.ts [--self-test]
 *
 * THE FAILURE THIS FILE EXISTS FOR is not a wrong diff. It is a wrong PAIRING.
 * Diffing two strings is settled; deciding which old section corresponds to
 * which new one is not, and getting it wrong produces the most confident kind
 * of nonsense — a renamed heading reads as one section deleted and another
 * invented, so a delivery view tells a client their "What it costs" section was
 * removed when it was retitled "Price". A reader cannot tell that from a real
 * deletion, which is precisely why it has to be asserted here.
 *
 * So the fixtures are the four things that actually happen to a draft between
 * versions: a heading survives, a heading is renamed, a section is genuinely
 * added, and a section is genuinely removed. All four in ONE pair of documents,
 * because they co-occur in real edits and a fixture containing only one of them
 * cannot catch a rule that mistakes it for another.
 *
 * DIRECTION IS ASSERTED BOTH WAYS. Every rule here narrows or widens what
 * counts as "the same section", and both errors are silent: too strict and
 * every retitle becomes a delete-plus-add, too loose and two unrelated sections
 * are paired and the diff shows a rewrite that never happened. The overlap
 * threshold is therefore driven from both sides.
 *
 * MUTATION LOG — run in a throwaway git worktree, never the shared tree.
 *
 *   2026-08-27  drop the retitle pass entirely            → 3 fail  ✓
 *   2026-08-27  RETITLE_OVERLAP lowered to 0.05           → 2 fail  ✓
 *   2026-08-27  allow headed sections to pair by position, ONE guard → SURVIVED
 *   2026-08-27  ...the SAME rule with BOTH guards removed  → 4 fail  ✓
 *   2026-08-27  wordDiff returns [] instead of null past the cap → 1 fail ✓
 *   2026-08-27  basis always reported as "heading"        → 2 fail  ✓
 *   2026-08-27  drop the common-tail trim in wordDiff  → SURVIVED, see below
 *   (baseline, unmutated: exit 0)
 *
 * TWO OF THESE ARE WORTH MORE THAN THE KILLS.
 *
 *   HEADED SECTIONS PAIRED BY POSITION took two goes to kill, and failed for a
 *   different reason each time.
 *
 *   First the CHECK was inadequate: section 5 inserts a section and asserts
 *   nothing below it moved, which reads like the right test and never reaches
 *   the rule — every section in that fixture pairs on its heading in pass 1, so
 *   pass 3 never executes. Section 5b is the fixture that reaches it, and it
 *   asserts its own precondition first, because two fixtures whose bodies
 *   happened to overlap would pair in pass 2 and prove nothing while passing.
 *
 *   Then the MUTATION was inadequate, which is the more interesting half. Pass
 *   3 guards both sides — `a[i].heading` and `b[j].heading` — and removing only
 *   one leaves the other still refusing the pairing, so the "mutation" never
 *   created the defect and its survival said nothing about the check. With both
 *   removed it dies on four assertions, 5b's among them, reporting two
 *   unrelated sections as one rewrite. A surviving mutation is a claim about
 *   the check ONLY if the mutation actually broke something.
 *
 *   THE COMMON-TAIL TRIM survives on purpose and is left recorded rather than
 *   chased. Removing it does not change the OUTPUT for any input tried — the
 *   LCS finds the same trailing run by itself; it changes only the work done to
 *   get there. An assertion that pinned it would be asserting an implementation
 *   detail, and the honest statement is that the trim is a cost optimisation
 *   whose absence is invisible, not a correctness rule.
 */
import { parseDraft } from "../lib/optimizer/parse";
import {
  alignRevisions, summariseRevisions, wordDiff, bodyOverlap,
  RETITLE_OVERLAP, MAX_DIFF_WORDS,
} from "../lib/optimizer/revisions";

let failures = 0;
const pass = (m: string) => console.log("  ok    " + m);
const fail = (m: string) => { failures++; console.log("  FAIL  " + m); };

const doc = (body: string) => parseDraft({ title: "A title long enough to parse", body });

// All four kinds of change in one pair, because they co-occur.
const BEFORE = doc(
  "<h2>What it costs</h2><p>The mix landed at comparable cost to the conventional equivalent.</p>" +
  "<h2>Why it matters</h2><p>Concrete is where the carbon sits.</p>" +
  "<h2>Legacy notes</h2><p>This section is going away entirely and has nothing in common.</p>"
);
const AFTER = doc(
  "<h2>Price</h2><p>The mix landed at comparable cost to the conventional equivalent.</p>" +
  "<h2>Why it matters</h2><p>Concrete is where the carbon sits, and a data centre uses a great deal of it.</p>" +
  "<h2>Where it goes next</h2><p>Entirely fresh material about future segments.</p>"
);

const sections = alignRevisions(BEFORE, AFTER);
const find = (heading: string) =>
  sections.find((s) => (s.headingAfter || s.headingBefore || "") === heading);

// ── 1. The fixture really contains all four cases ────────────────────────
console.log("\n1. The fixture can trip every rule");
{
  BEFORE.chunks.length === 3 && AFTER.chunks.length === 3
    ? pass(`three sections either side (${BEFORE.chunks.length} → ${AFTER.chunks.length})`)
    : fail(`parsed ${BEFORE.chunks.length} → ${AFTER.chunks.length} sections; the cases below cannot all occur`);
  bodyOverlap(
    "The mix landed at comparable cost to the conventional equivalent.",
    "The mix landed at comparable cost to the conventional equivalent."
  ) >= RETITLE_OVERLAP
    ? pass("the retitled pair's bodies really do overlap past the threshold")
    : fail("the retitle fixture cannot reach the threshold, so pass 2 is untested");
  bodyOverlap(
    "This section is going away entirely and has nothing in common.",
    "Entirely fresh material about future segments."
  ) < RETITLE_OVERLAP
    ? pass("and the removed/added pair does NOT — so they must not be paired")
    : fail("the removed and added fixtures overlap; they would pair and prove nothing");
}

// ── 2. A retitled section is one section, not two ────────────────────────
console.log("\n2. A renamed heading is a retitle, not a deletion");
{
  const price = find("Price");
  if (!price) fail("no section for the retitled heading — alignment dropped it");
  else {
    price.status === "edited"
      ? pass("the retitled section is EDITED, not added")
      : fail(`the retitled section came back as ${price.status}`);
    price.retitled && price.headingBefore === "What it costs"
      ? pass("and it remembers the old heading, so the view can show the rename")
      : fail(`retitled=${price.retitled} headingBefore=${JSON.stringify(price.headingBefore)}`);
    price.basis === "body"
      ? pass("matched by BODY, and says so — the view can present it as an inference")
      : fail(`basis was ${price.basis}; a body match reported as certain is the dishonest case`);
  }
  !sections.some((s) => s.status === "removed" && s.headingBefore === "What it costs")
    ? pass("the old heading is NOT also reported as a removal")
    : fail("the retitled section appears as a removal as well — counted twice");
}

// ── 3. Real additions and removals survive ───────────────────────────────
console.log("\n3. A genuine add and a genuine remove are still called that");
{
  const added = find("Where it goes next");
  added && added.status === "added" && added.before === null
    ? pass("new material is an addition with no before")
    : fail(`added section came back as ${JSON.stringify(added && added.status)}`);
  const removed = find("Legacy notes");
  removed && removed.status === "removed" && removed.after === null
    ? pass("deleted material is a removal with no after")
    : fail(`removed section came back as ${JSON.stringify(removed && removed.status)}`);
}

// ── 4. A surviving heading is matched with certainty ─────────────────────
console.log("\n4. A surviving heading is an exact match");
{
  const kept = find("Why it matters");
  kept && kept.basis === "heading"
    ? pass("matched on the heading, reported as certain")
    : fail(`basis was ${JSON.stringify(kept && kept.basis)}`);
  kept && kept.status === "edited"
    ? pass("and its edited body is detected")
    : fail("a changed body under an unchanged heading read as unchanged");
}

// ── 5. Headed sections never pair on position alone ──────────────────────
// Insert a section at the top and everything below shifts. Pairing by position
// would compare the new opening with the old one and report a total rewrite of
// every section in the piece.
console.log("\n5. Inserting a section does not rewrite the ones below it");
{
  const shifted = doc(
    "<h2>Brand new opening</h2><p>Inserted above everything else in the piece.</p>" +
    "<h2>What it costs</h2><p>The mix landed at comparable cost to the conventional equivalent.</p>" +
    "<h2>Why it matters</h2><p>Concrete is where the carbon sits.</p>" +
    "<h2>Legacy notes</h2><p>This section is going away entirely and has nothing in common.</p>"
  );
  const s = alignRevisions(BEFORE, shifted);
  const sum = summariseRevisions(s);
  sum.added === 1 && sum.edited === 0 && sum.removed === 0
    ? pass(`one addition and nothing else touched (${sum.unchanged} unchanged)`)
    : fail(`inserting one section reported ${sum.added} added, ${sum.edited} edited, ${sum.removed} removed`);
}

// ── 5b. Two unrelated headed sections are not paired by position ─────────
// The section above proves inserting a section leaves the others alone, but it
// cannot reach pass 3 at all: every section there matches on its heading. This
// is the fixture that DOES reach it — two headed sections sharing neither a
// heading nor a body — and it is the one that fails if headed sections are ever
// allowed to pair on position. Without that guard these two are reported as one
// section rewritten, which is a total fabrication: a client is shown a revision
// that never happened, between two texts that have nothing to do with each other.
console.log("\n5b. Unrelated headed sections are a removal and an addition");
{
  const alpha = doc("<h2>Alpha section</h2><p>Rope ladders and marine varnish for wooden hulls.</p>");
  const beta = doc("<h2>Beta section</h2><p>Quarterly payroll reconciliation for contractors.</p>");
  // PRECONDITION: they must be unmatchable by the first two passes, or pass 3
  // is never reached and this proves nothing.
  bodyOverlap(
    "Rope ladders and marine varnish for wooden hulls.",
    "Quarterly payroll reconciliation for contractors."
  ) < RETITLE_OVERLAP
    ? pass("the two fixtures share no body, so passes 1 and 2 cannot pair them")
    : fail("the fixtures overlap; pass 3 is not reached and the assertion below is empty");

  const s = alignRevisions(alpha, beta);
  const statuses = s.map((x) => x.status).sort().join(",");
  statuses === "added,removed"
    ? pass("reported as one removal and one addition, never as a rewrite")
    : fail(`two unrelated headed sections came back as ${statuses}`);
  !s.some((x) => x.basis === "position")
    ? pass("and nothing was paired on position alone")
    : fail("a headed section was paired by position — the fabrication case");
}

// ── 6. The summary counts what the view will print ───────────────────────
console.log("\n6. The summary agrees with the sections");
{
  const sum = summariseRevisions(sections);
  sum.edited + sum.added + sum.removed + sum.unchanged === sections.length
    ? pass(`every section is counted exactly once (${sections.length})`)
    : fail(`counts sum to ${sum.edited + sum.added + sum.removed + sum.unchanged}, sections are ${sections.length}`);
  sum.inferred >= 1
    ? pass(`${sum.inferred} pairing reported as inferred rather than certain`)
    : fail("the body-matched pair is not counted as inferred, so the header cannot warn about it");
}

// ── 7. The word diff ─────────────────────────────────────────────────────
console.log("\n7. Words, and the honest refusal past the cap");
{
  const d = wordDiff(
    "Concrete is where the carbon sits.",
    "Concrete is where the carbon sits, and a data centre uses a great deal of it."
  );
  if (!d) fail("a short diff returned null");
  else {
    const same = d.filter((p) => p.kind === "same").map((p) => p.text).join(" ");
    const add = d.filter((p) => p.kind === "add").map((p) => p.text).join(" ");
    /Concrete is where the carbon/.test(same)
      ? pass("the untouched opening is marked as unchanged, not re-added")
      : fail(`the common head was not preserved: ${JSON.stringify(d)}`);
    /data centre uses a great deal/.test(add)
      ? pass("the new clause is marked as an addition")
      : fail(`the addition was not found: ${JSON.stringify(add)}`);
    d.some((p) => p.kind === "del")
      ? pass("and the replaced fragment is marked as a deletion")
      : fail("nothing was marked deleted, so the reader cannot see what went");
  }

  // Identical text produces no marks at all.
  const none = wordDiff("exactly the same words here", "exactly the same words here");
  none && none.length === 1 && none[0].kind === "same"
    ? pass("identical text diffs to a single unchanged run")
    : fail(`identical text produced ${JSON.stringify(none)}`);

  // PRECONDITION then assertion: the cap must actually be exceeded.
  const long = new Array(MAX_DIFF_WORDS + 50).fill("word").join(" ");
  (long.match(/\S+/g) || []).length > MAX_DIFF_WORDS
    ? pass(`the oversized fixture really is past the ${MAX_DIFF_WORDS}-word cap`)
    : fail("the oversized fixture is not oversized; the next assertion tests nothing");
  wordDiff(long, long + " extra") === null
    ? pass("past the cap it returns null — the caller says the section changed without pretending to know where")
    : fail("an oversized diff returned parts; the cost guard is not firing");
}

// ── Self-test ────────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n8. self-test — every detector driven against input built to break it");
  const probes: Array<[string, () => boolean]> = [
    ["alignment CAN report a removal", () =>
      alignRevisions(BEFORE, doc("<h2>Only this</h2><p>Nothing else at all here now.</p>"))
        .some((s) => s.status === "removed")],
    ["alignment CAN report an addition", () =>
      alignRevisions(doc("<h2>Only this</h2><p>Nothing else at all here now.</p>"), AFTER)
        .some((s) => s.status === "added")],
    ["alignment CAN report unchanged", () =>
      alignRevisions(BEFORE, BEFORE).every((s) => s.status === "unchanged")],
    ["bodyOverlap spans its range", () =>
      bodyOverlap("a b c", "a b c") === 1 && bodyOverlap("a b c", "x y z") === 0],
    ["wordDiff CAN return null", () => wordDiff(new Array(MAX_DIFF_WORDS + 1).fill("w").join(" "), "x") === null],
    ["wordDiff CAN mark a deletion", () =>
      (wordDiff("one two three four", "one four") || []).some((p) => p.kind === "del")],
  ];
  let dead = 0;
  for (const [name, probe] of probes) {
    let fired = false;
    try { fired = probe(); } catch { fired = false; }
    if (fired) pass("probe fires: " + name);
    else { dead++; fail(`probe did NOT fire: ${name} — the assertion it backs tests nothing`); }
  }
  if (dead > 0) { console.log(`\n  ${dead} probe(s) dead. Refusing to report the sections above.`); process.exit(1); }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
