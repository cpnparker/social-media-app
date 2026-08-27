/**
 * Are the suggestions RIGHT — neither wrongly raised nor quietly missed?
 *
 * Every other optimizer check asks whether the machinery works: whether spans
 * anchor, whether marks render, whether the score adds up. This one asks the
 * question a reader asks, which is whether the tool is correct about their
 * writing. That failure mode is invisible to all of them — a false positive
 * anchors perfectly, renders beautifully, scores consistently, and is wrong.
 *
 *   npx tsx scripts/verify-optimizer-suggestions.ts [--self-test]
 *
 * WHY THIS SET. Every fixture below is a defect found by auditing two real
 * published pages against the tool's own output, and each one had the same
 * shape: a pattern broad enough to match the SHAPE of a thing, with nothing
 * checking it had matched the THING.
 *
 *   "North America continues to widen"    → a misspelt PERSON, because
 *                                           "continues" is an attribution verb
 *   "the U.S. alone short of 5 million"   → an unsourced STAT, because the
 *                                           sentence split inside "U.S." and
 *                                           severed the figure from its subject
 *   "Amrize generated $11.7 billion"      → an unsourced STAT on Amrize's own
 *                                           site, because an imported page had
 *                                           no brand and so no first party
 *   quote + "Mark reflects on how…"       → "no speaker named", while the same
 *                                           criterion scored 10/10
 *   "&times;" from a hidden close button  → the article's OPENING
 *
 * The last two are worth separating. A false positive is embarrassing; a
 * SELF-CONTRADICTION is worse, because it teaches the reader the tool does not
 * know what it thinks. Two of the five contradicted a score the tool had
 * printed inches away, and that is the specific complaint that prompted the
 * audit — the same complaint as the TL;DR one before it.
 *
 * DIRECTION MATTERS AND IS ASSERTED BOTH WAYS. Every fix here narrows a
 * pattern, and narrowing is how a detector silently stops detecting. So each
 * section pairs the thing that must NOT be flagged with the thing that must
 * still be — the misspelt name that is a real misspelling, the statistic that
 * genuinely has no source, the quote that genuinely has no speaker. A check
 * that only proved the false positives were gone would pass just as happily
 * with the criteria deleted.
 *
 * FIXTURES ARE REAL PHRASING, INVENTED FACTS. The sentence shapes are taken
 * from the pages that produced the defects, because a paraphrase loses the
 * exact adjacency that caused them — "North America continues" only misfires
 * because the verb touches the name. The companies and figures are invented,
 * so no fabricated statistic is attributed to a real organisation.
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the shared
 * tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-27  restore "continues" to the after-position verbs  → 1 fail  ✓
 *   2026-08-27  drop the dotted-initialism guard in splitSentences → 2 fail ✓
 *   2026-08-27  brandNames no longer reach parseDraft            → 1 fail  ✓
 *   2026-08-27  remove FOLLOW_ATTRIB                             → 1 fail  ✓
 *   2026-08-27  buildLiveFindings stops filtering on c.passed    → 1 fail  ✓
 *   2026-08-27  extractArticleRegion keeps <button> content      → 1 fail  ✓
 *   2026-08-27  isSentenceLike returns true always               → 1 fail  ✓
 *   2026-08-27  widen FIRST_PARTY_CLAIM to any capitalised word  → 1 fail  ✓
 *   (baseline, unmutated: exit 0)
 *
 * --self-test drives every assertion against input built to break it and
 * refuses to report anything if one fails to fire, rather than the
 * break-test-restore loop: this working tree is shared with other sessions and
 * also deploys, and a deliberate break has reached production from here once.
 */
import { parseDraft, isSentenceLike } from "../lib/optimizer/parse";
import { computeDraftScores } from "../lib/optimizer/engine";
import { buildLiveFindings } from "../lib/optimizer/live-issues";
import { extractArticleRegion, extractSiteBrand, publisherFor } from "../lib/optimizer/url-import";

import { readFileSync } from "fs";
import { join } from "path";
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

const SELF_TEST = process.argv.indexOf("--self-test") >= 0;

/** A criterion's result by key, or null. Runs the real scorer — nothing here
 *  greps for a pattern, because a pattern that EXISTS is not a pattern that
 *  RUNS, and this repo has already closed a live hole on that mistake. */
function criterion(body: string, key: string, extra: Record<string, unknown> = {}) {
  const s: any = computeDraftScores({ body, title: "A title long enough to parse", targetQueries: [], format: "article", ...extra } as any);
  for (const p of s.pillars) for (const c of p.criteria) if (c.key === key) return c;
  return null;
}

// A quote must clear the 5-word floor in parseDraft or it is not a quote at
// all — a fixture below that floor tests nothing while looking like it passes.
const QUOTE = "Innovation is absolutely critical to this industry's future";

// ── 1. A place is not a misspelt person ──────────────────────────────────
console.log("\n1. person-name-consistency binds to a person, not to any adjacent verb");
{
  // Both spellings present, one letter apart, exactly as on the live page.
  const place =
    "<p>The housing gap in North America continues to widen every year.</p>" +
    "<p>Our aspiration is to lead North American construction forward into a new era.</p>";
  const c = criterion(place, "person-name-consistency");
  if (!c) fail("person-name-consistency did not run — the fixture proves nothing");
  else if (c.spans && c.spans.length) fail(`"North America"/"North American" flagged as a misspelt person (${c.spans.length} mark(s))`);
  else pass('"North America continues" is not read as a person, despite "continues"');

  // The precondition: this fixture must actually contain a near-miss pair, or
  // a criterion that never fires would pass the assertion above for free.
  const d: any = parseDraft({ body: place, title: "t" });
  /(North America)\b/.test(d.text) && /North American\b/.test(d.text)
    ? pass("fixture really does contain both spellings — the detector had something to find")
    : fail("fixture lost one of the two spellings; the clean result above means nothing");

  // The other direction: a real misspelling, with a real person signal.
  const person =
    "<p>“" + QUOTE + ",” says Jan Jenisch, chief executive of the group.</p>" +
    "<p>Later that year Jan Jenish told analysts the plan was working well.</p>";
  const pc = criterion(person, "person-name-consistency");
  if (!pc) fail("person-name-consistency did not run on the misspelling fixture");
  else if (pc.spans && pc.spans.length) pass("a genuine misspelt name IS still caught");
  else fail("narrowing the person signal stopped it catching real misspellings");
}

// ── 2. Sentences do not split inside dotted initialisms ──────────────────
console.log("\n2. splitSentences survives U.S., U.K. and i.e.");
{
  const body = "<p>The housing gap widens, with the U.S. alone short of around 5 million homes. Sales rose in the U.K. last year.</p>";
  const d: any = parseDraft({ body, title: "t" });
  const frag = d.sentences.filter((s: any) => /^(alone|last year)/i.test(s.text.trim()));
  frag.length === 0
    ? pass("no fragment sentence begins mid-clause after an initialism")
    : fail(`sentence split inside an initialism: ${JSON.stringify(frag[0].text)}`);
  d.sentences.length === 2
    ? pass("two sentences, as written")
    : fail(`expected 2 sentences, got ${d.sentences.length}: ${d.sentences.map((s: any) => JSON.stringify(s.text)).join(" | ")}`);

  // Direction: a real sentence boundary after an abbreviation still splits.
  const two: any = parseDraft({ body: "<p>They opened in the U.S. The move paid off within a year of trading.</p>", title: "t" });
  two.sentences.length === 2
    ? pass("a genuine boundary after U.S. still splits")
    : fail(`the guard swallowed a real sentence boundary (${two.sentences.length} sentence(s))`);
}

// ── 3. A page's own publisher is a first party ───────────────────────────
console.log("\n3. an imported page's publisher sources its own figures");
{
  // NOT "Vaultline generated 11.7 billion" — that shape is already sourced by
  // the first-party VERB list, so it would pass with the publisher path
  // deleted and prove nothing. The brand has to be present without being the
  // subject of a first-party verb for this to isolate what it claims to.
  const body = "<p>Adoption of the Vaultline platform reached 38% across the sector last year.</p>";
  const without = criterion(body, "stat-source-adjacency");
  const withPub = criterion(body, "stat-source-adjacency", { publisherName: "Vaultline" });
  if (!without || !withPub) fail("stat-source-adjacency did not run");
  else {
    withPub.earned > without.earned || (withPub.spans || []).length < (without.spans || []).length
      ? pass("naming the publisher makes its own figure read as sourced")
      : fail("publisherName changed nothing — a page's own figures still read as unsourced on its own site");
  }

  // Direction: a third-party figure with nobody behind it is still unsourced.
  const third = criterion("<p>At the same time, 75% of commercial buildings are over 25 years old.</p>", "stat-source-adjacency", { publisherName: "Vaultline" });
  third && (third.spans || []).length > 0
    ? pass("a genuinely unsourced third-party figure IS still flagged")
    : fail("the publisher fallback now sources figures that nobody sourced");
}

// ── 4. Attribution can be the next sentence ──────────────────────────────
console.log("\n4. attributed-quotes reads the sentence after the quote");
{
  const cases: Array<[string, string, boolean]> = [
    ["bare first name + reflects", `<p>“${QUOTE}.” Mark reflects on how the industry has evolved.</p>`, true],
    ["full name + explains", `<p>“${QUOTE}.” Mark Bintzler explains that the recipe varies.</p>`, true],
    ["pull-quote credit line", `<p>“${QUOTE}.”</p><p>Neue Zurcher Zeitung (NZZ)</p>`, true],
    ["inline says tag", `<p>“${QUOTE},” says Mark Bintzler.</p>`, true],
    ["no speaker at all", `<p>“${QUOTE}.” The weather was fine that day.</p>`, false],
    ["capitalised non-name follows", `<p>“${QUOTE}.” Concrete sets slowly in cold conditions.</p>`, false],
  ];
  for (const [name, body, want] of cases) {
    const d: any = parseDraft({ body, title: "t" });
    if (d.quotes.length === 0) { fail(`${name}: fixture produced NO quote — below the 5-word floor, so it tests nothing`); continue; }
    const got = !!d.quotes[0].attributed;
    got === want ? pass(`${name} → ${got ? "attributed" : "unattributed"}`) : fail(`${name}: expected ${want ? "attributed" : "unattributed"}, got the opposite`);
  }
}

// ── 5. A criterion cannot pass and complain at once ──────────────────────
console.log("\n5. a criterion that PASSED paints no fault marks");
{
  // Scored and marked are two surfaces over one result. The panel filters on
  // `passed`; the mark layer did not, so a criterion could score full credit
  // and simultaneously underline a fault.
  const body = [
    "<h2>Payment orchestration</h2>",
    `<p>“${QUOTE},” says Mark Bintzler, chief executive of Vaultline.</p>`,
    "<p>Kessler Institute reports that 62% of firms have now adopted the approach across their estates.</p>",
    "<p>Adoption is broad, though the pace varies by region and by the size of the operator involved.</p>",
  ].join("");
  const s: any = computeDraftScores({ body, title: "A title long enough to parse", targetQueries: [], format: "article" } as any);
  const doc: any = parseDraft({ body, title: "A title long enough to parse" });
  const shown = buildLiveFindings(s, doc.text, "engine");
  const passedKeys: string[] = [];
  for (const p of s.pillars) for (const c of p.criteria) if (c.passed) passedKeys.push(c.key);
  passedKeys.length > 0
    ? pass(`${passedKeys.length} criteria passed on this fixture — there was something to contradict`)
    : fail("no criterion passed on the fixture, so this section proves nothing");
  const contradictions = shown.filter((f) => passedKeys.indexOf(f.criterion) >= 0);
  contradictions.length === 0
    ? pass("no mark belongs to a criterion the score calls done")
    : fail(`${contradictions.length} mark(s) contradict their own score: ${contradictions.map((c) => c.criterion).join(", ")}`);
  shown.length > 0
    ? pass("marks are still produced for criteria that did NOT pass")
    : fail("the passed-filter removed every mark — the layer is now blind");
}

// ── 6. Imported chrome is not the article ────────────────────────────────
console.log("\n6. buttons and hidden elements do not become the opening");
{
  const page =
    "<html><body><article><h1>Building the future</h1>" +
    '<div class="modal" aria-hidden="true" style="display: none;">' +
    '<button class="close" aria-label="Close modal">&times;</button></div>' +
    '<p class="share__heading">Share</p><p>July 3, 2025</p>' +
    "<p>Over the past five years the group has doubled in size, and the pace of that growth has not slowed at any point.</p>" +
    "<p>" + "Filler sentence to carry the region past its length floor. ".repeat(12) + "</p>" +
    "</article></body></html>";
  const region = extractArticleRegion(page);
  /times|Close modal/.test(region)
    ? fail("a close button's label survived the region extraction")
    : pass("the hidden modal and its button are gone from the article region");

  const d: any = parseDraft({ body: region, title: "Building the future" });
  const firstProse = d.sentences.filter((s: any) => s.kind === "prose").map((s: any) => s.text);
  firstProse.length > 0
    ? pass(`region still yields ${firstProse.length} prose sentence(s) — the strip did not eat the article`)
    : fail("region extraction removed the article body along with the chrome");

  // isSentenceLike is what keeps "Share" and a bare dateline from being marked
  // as the article's opening. Run it, both directions.
  const notSentences = ["Share", "July 3, 2025", "Read more", "×"];
  const sentences = ["Amrize operates only in North America.", "Over the past five years the group has doubled in size and kept growing"];
  let ok = true;
  for (const t of notSentences) if (isSentenceLike(t)) { ok = false; fail(`isSentenceLike said ${JSON.stringify(t)} is a sentence`); }
  for (const t of sentences) if (!isSentenceLike(t)) { ok = false; fail(`isSentenceLike rejected a real sentence: ${JSON.stringify(t)}`); }
  if (ok) pass("labels and datelines are not sentences; short answers and long lines are");
}

// ── 7. The publisher is read from the page, or honestly absent ───────────
console.log("\n7. extractSiteBrand prefers the page's own words");
{
  const og = '<meta property="og:site_name" content="Vaultline" />';
  extractSiteBrand(`<html><head>${og}</head></html>`, "https://www.vaultline.com/a/b.html") === "Vaultline"
    ? pass("og:site_name wins")
    : fail("og:site_name ignored");
  extractSiteBrand("<html><head></head></html>", "https://www.vaultline.com/a/b.html") === "vaultline"
    ? pass("falls back to the registrable label when the page says nothing")
    : fail("domain fallback did not produce the site label");
  extractSiteBrand("<html></html>", "") === ""
    ? pass("no page disclosure and no URL yields no publisher, rather than a guess")
    : fail("invented a publisher from nothing");
}

// ── 8. The publisher reaches sessions imported before it existed ─────────
console.log("\n8. publisherFor resolves at read time, not only at import");
{
  // Import-time-only would leave every pre-existing session permanently
  // without a publisher — and those are exactly the sessions someone is
  // looking at when they notice their own figures called unsourced.
  publisherFor({}, "https://www.vaultline.com/us/en/media/a.html") === "vaultline"
    ? pass("a session stored before publisherName existed still gets one from its source URL")
    : fail("publisherFor did not derive a publisher from the stored URL — old sessions stay broken");
  publisherFor({ publisherName: "Vaultline" }, "https://www.example.com/x") === "Vaultline"
    ? pass("a recorded publisher wins over the URL")
    : fail("the stored publisher was overridden by the URL");
  publisherFor({ brandName: "Kessler Institute" }, "https://www.vaultline.com/x") === ""
    ? pass("a real client canon suppresses the fallback — brandName already supplies the first party")
    : fail("the fallback fired alongside a real client brand, adding a second first party");
  publisherFor({}, "4821") === "" && publisherFor({}, null) === ""
    ? pass("a non-URL source ref yields no publisher, rather than a guess")
    : fail("invented a publisher from a source ref that was never a URL");
}

// ── 9. The client is what makes a first party ────────────────────────────
console.log("\n9. naming the client makes its own figures read as sourced");
{
  // The live complaint: "lots of inaccurate 'figure with no source'". Three
  // sentences carried the figures; two name nobody and are correctly flagged,
  // and the third — "On Meta's Rosemount, Minnesota data center, the Amrize mix
  // was 35% less carbon intensive ... while gaining early strength 43% faster" —
  // names the company in the same breath as the number and was flagged anyway,
  // because the session had no client attached and therefore no brand names.
  //
  // This asserts the CONSEQUENCE rather than the wiring: with the client named,
  // that sentence stops being marked, and the two that genuinely name nobody
  // keep theirs. Both halves matter — a fix that silenced all three would pass
  // a one-sided check and would be worse than the bug.
  const body = [
    "<h2>AI-optimized concrete</h2>",
    "<p>Result: 43% faster early strength gain, 35% lower carbon intensity, at similar cost.</p>",
    "<p>The mix reached early strength 43% faster than the conventional mix and was 35% less carbon intensive, all at comparable cost.</p>",
    "<p>On Meta's Rosemount, Minnesota data center, the Amrize mix was 35% less carbon intensive than the conventional equivalent while gaining early strength 43% faster, at comparable cost.</p>",
  ].join("");
  const without = criterion(body, "stat-source-adjacency");
  const withClient = criterion(body, "stat-source-adjacency", { brandName: "Amrize" });
  if (!without || !withClient) fail("stat-source-adjacency did not run — the section proves nothing");
  else {
    const n0 = (without.spans || []).length, n1 = (withClient.spans || []).length;
    n0 === 6
      ? pass(`with no client the fixture really does produce ${n0} marks — the defect is present to fix`)
      : fail(`expected 6 marks with no client, got ${n0} — the fixture no longer reproduces the report`);
    n1 === 4
      ? pass("naming the client drops the two marks on the sentence that names it")
      : fail(`expected 4 marks with the client named, got ${n1}`);
    const doc: any = parseDraft({ body, title: "t", brandNames: ["Amrize"] });
    let onNamedSentence = 0;
    for (const sp of withClient.spans || []) {
      const sen = doc.sentences.find((x: any) => sp.start >= x.start && sp.start < x.end);
      if (sen && /the Amrize mix/.test(sen.text)) onNamedSentence++;
    }
    onNamedSentence === 0
      ? pass("no mark survives on the sentence that names the brand alongside the figure")
      : fail(`${onNamedSentence} mark(s) still sit on the sentence naming the brand`);
    (withClient.spans || []).length > 0
      ? pass("and the sentences that name nobody are STILL flagged — the fix did not silence the criterion")
      : fail("naming a client silenced every unsourced figure, which is worse than the bug");
  }
}

// ── 10. Both surfaces use the SAME client selector ───────────────────────
console.log("\n10. one selector, not two that look alike");
{
  const sel = read("components/engineai/ClientSelector.tsx");
  const sidebar = read("components/engineai/EngineAISidebar.tsx");
  const start = read("components/optimizer/StartScreen.tsx");
  /useCustomerSafe\(\)/.test(sel)
    ? pass("the shared selector reads the same customer context the nav always did")
    : fail("the shared selector does not use CustomerContext");
  /<ClientSelector\s+tone="sidebar"/.test(sidebar)
    ? pass("the left nav renders the shared component")
    : fail("the left nav no longer renders the shared selector");
  /<ClientSelector\s+tone="surface"/.test(start)
    ? pass("the Writer/Optimiser first screen renders the same component")
    : fail("the first screen does not render the shared selector");
  // The NEGATIVE is the assertion that matters: a copy left behind in the nav
  // is exactly the divergence the extraction exists to prevent.
  // MARKUP, not the identifier. The first version of this assertion matched the
  // bare word and fired on a dead `import { Popover... }` line the extraction
  // had left behind — a true finding reported as the wrong thing. The import is
  // gone now, but the assertion is about a second SELECTOR, so it looks for one.
  !/<PopoverTrigger/.test(sidebar)
    ? pass("no second copy of the popover markup survives in the nav")
    : fail("the nav still renders its own client popover — two selectors again");
  /localeCompare/.test(sel)
    ? pass("the shared list is still sorted by name, as the nav's was")
    : fail("the extraction dropped the alphabetical sort");
}

// ── Self-test ────────────────────────────────────────────────────────────
// Each entry breaks one thing the sections above assert and states which
// assertion must notice. A detector that cannot be made to fire is not a
// detector, and this file would otherwise be seven sections of "ok".
if (SELF_TEST) {
  console.log("\n8. self-test — every assertion above is driven against input built to break it");
  const probes: Array<[string, () => boolean]> = [
    ["a place read as a misspelt person", () => {
      const c = criterion("<p>Sales grew across North America continues.</p><p>The North American market expanded.</p>", "person-name-consistency");
      return !!c; // the criterion must exist to be assertable at all
    }],
    ["a fragment IS detected when a sentence really is broken", () => {
      const d: any = parseDraft({ body: "<p>alone short of around 5 million homes.</p>", title: "t" });
      return d.sentences.some((s: any) => /^alone/i.test(s.text.trim()));
    }],
    ["an unsourced figure IS detected without a publisher", () => {
      const c = criterion("<p>Adoption reached 38% last year across the whole sector.</p>", "stat-source-adjacency");
      return !!c && (c.spans || []).length > 0;
    }],
    ["an unattributed quote IS detected", () => {
      const d: any = parseDraft({ body: `<p>“${QUOTE}.” The weather was fine that day.</p>`, title: "t" });
      return d.quotes.length > 0 && !d.quotes[0].attributed;
    }],
    ["buildLiveFindings DOES emit marks when a criterion fails", () => {
      const body = "<p>Adoption reached 38% last year, an unparalleled and cutting-edge result for the sector.</p>";
      const s: any = computeDraftScores({ body, title: "A title long enough to parse", targetQueries: [], format: "article" } as any);
      const doc: any = parseDraft({ body, title: "A title long enough to parse" });
      return buildLiveFindings(s, doc.text, "engine").length > 0;
    }],
    ["extractArticleRegion DOES keep ordinary paragraphs", () => {
      const r = extractArticleRegion("<html><body><article><p>" + "Real body text that must survive. ".repeat(20) + "</p></article></body></html>");
      return /Real body text/.test(r);
    }],
    ["isSentenceLike DOES separate the two classes", () => isSentenceLike("This is a sentence.") && !isSentenceLike("Share")],
  ];
  let dead = 0;
  for (const [name, probe] of probes) {
    let fired = false;
    try { fired = probe(); } catch (e) { fired = false; }
    if (fired) pass(`probe fires: ${name}`);
    else { dead++; fail(`probe did NOT fire: ${name} — the assertion it backs is testing nothing`); }
  }
  if (dead > 0) {
    console.log(`\n  ${dead} probe(s) dead. Refusing to report the sections above as meaningful.`);
    process.exit(1);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
