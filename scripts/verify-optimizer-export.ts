/**
 * Getting content OUT, checked by making it fail.
 *
 * This converter is the last thing that touches a writer's words before they
 * leave the product, and every way it can break is quiet. A dropped tag glues
 * two words together and reads as a typo the writer did not make. A non-greedy
 * match on a nested list silently splits it in half and reads as a formatting
 * quirk. A table whose rows are shorter than its header produces markdown that
 * renders as a table with a missing cell rather than as an error.
 *
 * Every fixture here is written the way TIPTAP emits it, not the way HTML is
 * usually written by hand — `<li><p>text</p></li>`, never a bare `<li>`. That
 * distinction has already cost this project one whole class of bug that a
 * parity check could not see, because the check's own fixture emitted markup
 * the editor never produces.
 *
 *   npx tsx scripts/verify-optimizer-export.ts
 *
 * MUTATION LOG — every entry was run in a throwaway git worktree, never the
 * shared tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  unknown tags dropped with "" instead of " "  → §2 red   ✓
 *   2026-08-21  matchBlock stops counting depth (non-greedy) → §3 red   ✓
 *   2026-08-21  <br> dropped instead of becoming a newline   → §2 red   ✓
 *   2026-08-21  short table rows not padded to header width  → §5 red   ✓
 *   2026-08-21  unrecognised markup discarded, not kept      → §8 red   ✓
 *   2026-08-21  entity decode order — ampersand decoded first→ §4 red   ✓
 *   (baseline, unmutated: exit 0)
 *
 * Worth recording: the non-greedy mutation did NOT trip section 7's "every word
 * survives" check. Losing the nesting leaves "Outer two" in the output, just no
 * longer in the list — so the strongest-sounding property here is blind to the
 * defect most likely to actually occur, and the narrow structural assertion in
 * section 3 is what catches it. A round-trip check is not a substitute for
 * saying what the output should look like.
 */
import { htmlToMarkdown, htmlToPlainText } from "../lib/optimizer/export";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

function eq(label: string, got: string, want: string) {
  got === want
    ? pass(label)
    : fail(`${label}\n          got:  ${JSON.stringify(got)}\n          want: ${JSON.stringify(want)}`);
}

// ── 1. Blocks ────────────────────────────────────────────────────────────
console.log(`\n1. Block structure`);
{
  eq(
    "a heading and a paragraph stay separate blocks",
    htmlToMarkdown("<h2>What is GEO?</h2><p>It is the practice of writing for answer engines.</p>"),
    "## What is GEO?\n\nIt is the practice of writing for answer engines."
  );
  eq("h1 through h6 map to their own depth", htmlToMarkdown("<h1>A</h1><h6>B</h6>"), "# A\n\n###### B");
  eq("a horizontal rule survives", htmlToMarkdown("<p>A</p><hr><p>B</p>"), "A\n\n---\n\nB");
  eq(
    "a blockquote prefixes every one of its lines",
    htmlToMarkdown("<blockquote><p>First.</p><p>Second.</p></blockquote>"),
    "> First.\n>\n> Second."
  );
  eq("an empty paragraph does not become a blank block", htmlToMarkdown("<p>A</p><p></p><p>B</p>"), "A\n\nB");
}

// ── 2. The gluing bug ────────────────────────────────────────────────────
console.log(`\n2. Nothing is glued together`);
{
  // The single most likely silent defect: dropping a tag with the empty string
  // rather than a space. It produces real words that were never written.
  eq("a <br> becomes a newline, not a join", htmlToMarkdown("<p>one<br>two</p>"), "one\ntwo");
  const spans = htmlToMarkdown("<p>alpha<span>beta</span></p>");
  spans.indexOf("alphabeta") < 0
    ? pass(`an unknown inline tag does not glue its neighbours (${JSON.stringify(spans)})`)
    : fail(`"alpha" and "beta" were glued into one word: ${JSON.stringify(spans)}`);

  // Precondition: the fixture must actually place two words hard against a tag
  // boundary with no whitespace, or it cannot detect gluing at all.
  const fixture = "<p>alpha<span>beta</span></p>";
  /alpha<[^>]+>beta/.test(fixture)
    ? pass("the gluing fixture really does butt two words against a tag boundary")
    : fail("the gluing fixture has whitespace in it — it cannot detect a glue bug");
}

// ── 3. Lists, the way Tiptap emits them ──────────────────────────────────
console.log(`\n3. Lists`);
{
  eq(
    "a bullet list, with the <p> Tiptap puts inside every <li>",
    htmlToMarkdown("<ul><li><p>One</p></li><li><p>Two</p></li></ul>"),
    "- One\n- Two"
  );
  eq(
    "an ordered list numbers from one",
    htmlToMarkdown("<ol><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ol>"),
    "1. First\n2. Second\n3. Third"
  );

  // Nesting is where a non-greedy `[\s\S]*?` match breaks: it closes the outer
  // list at the INNER </ul>, and the second half of the outer list falls out of
  // the list entirely.
  const nested = htmlToMarkdown(
    "<ul><li><p>Outer one</p><ul><li><p>Inner</p></li></ul></li><li><p>Outer two</p></li></ul>"
  );
  eq("a nested list keeps both outer items and indents the inner one", nested, "- Outer one\n  - Inner\n- Outer two");

  // Precondition: assert the fixture is genuinely nested and has a sibling
  // AFTER the nested list — without that trailing sibling the greedy/non-greedy
  // distinction makes no difference and this proves nothing.
  const nestFixture = "<ul><li><p>Outer one</p><ul><li><p>Inner</p></li></ul></li><li><p>Outer two</p></li></ul>";
  /<\/ul>\s*<\/li>\s*<li>/.test(nestFixture)
    ? pass("the nesting fixture has a list item AFTER the nested list closes")
    : fail("the nesting fixture has no trailing sibling — a non-greedy match would pass it");
}

// ── 4. Inline marks ──────────────────────────────────────────────────────
console.log(`\n4. Inline marks`);
{
  eq("bold", htmlToMarkdown("<p>a <strong>b</strong> c</p>"), "a **b** c");
  eq("italic", htmlToMarkdown("<p>a <em>b</em> c</p>"), "a *b* c");
  eq("code", htmlToMarkdown("<p>a <code>b</code> c</p>"), "a `b` c");
  eq("a link keeps its text and its href", htmlToMarkdown('<p>see <a href="https://x.test/a">this</a></p>'), "see [this](https://x.test/a)");
  eq("a bare link is printed once, not as [x](x)", htmlToMarkdown('<p><a href="https://x.test">https://x.test</a></p>'), "https://x.test");
  eq("bold inside a heading", htmlToMarkdown("<h3>a <strong>b</strong></h3>"), "### a **b**");
  eq("entities are decoded", htmlToMarkdown("<p>Tom &amp; Jerry &lt;3</p>"), "Tom & Jerry <3");
  eq("a double-encoded entity decodes once, not twice", htmlToMarkdown("<p>&amp;lt;p&amp;gt;</p>"), "&lt;p&gt;");
}

// ── 5. Tables ────────────────────────────────────────────────────────────
console.log(`\n5. Tables`);
{
  const table = htmlToMarkdown(
    "<table><tr><th><p>Metric</p></th><th><p>Value</p></th></tr>" +
      "<tr><td><p>Citations</p></td><td><p>38%</p></td></tr></table>"
  );
  eq("a table becomes a markdown table with a separator row", table, "| Metric | Value |\n| --- | --- |\n| Citations | 38% |");

  // A short row must be padded to the header width. Unpadded, the markdown
  // renders as a table with a column silently missing.
  const ragged = htmlToMarkdown(
    "<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>only</p></td></tr></table>"
  );
  ragged.split("\n")[2] === "| only |  |"
    ? pass("a short row is padded to the header width")
    : fail(`a short row rendered as ${JSON.stringify(ragged.split("\n")[2])}`);
}

// ── 6. Plain text ────────────────────────────────────────────────────────
console.log(`\n6. Plain text`);
{
  const html = "<h2>Heading</h2><p>Body <strong>bold</strong>.</p><ul><li><p>Item</p></li></ul>";
  const plain = htmlToPlainText(html);
  plain.indexOf("HeadingBody") < 0
    ? pass("a heading and the paragraph under it are not concatenated")
    : fail(`heading glued to body: ${JSON.stringify(plain)}`);
  plain.indexOf("**") < 0 && plain.indexOf("#") < 0
    ? pass("markdown syntax is stripped from the plain-text form")
    : fail(`markdown syntax survived into plain text: ${JSON.stringify(plain)}`);
  plain.indexOf("bold") >= 0 && plain.indexOf("Item") >= 0
    ? pass("the words themselves all survive")
    : fail(`words were lost: ${JSON.stringify(plain)}`);
  eq("a link keeps its destination in plain text", htmlToPlainText('<p><a href="https://x.test/a">here</a></p>'), "here (https://x.test/a)");
}

// ── 7. Nothing is silently dropped ───────────────────────────────────────
console.log(`\n7. Nothing is silently dropped`);
{
  // The strongest property this converter can have: every word that went in
  // comes out. Asserted over a document using every construct at once, because
  // a per-construct check cannot see a word lost at a boundary BETWEEN two.
  const doc =
    "<h2>Zephyr routing</h2>" +
    "<p>The <strong>Vaultline</strong> study found <em>38%</em> lower latency.</p>" +
    "<ul><li><p>Nordvale adopted it</p><ul><li><p>Kessler followed</p></li></ul></li><li><p>Others waited</p></li></ul>" +
    "<blockquote><p>Quotable claim here.</p></blockquote>" +
    "<table><tr><th><p>Region</p></th><th><p>Uptake</p></th></tr><tr><td><p>Nordic</p></td><td><p>62%</p></td></tr></table>" +
    '<p>See <a href="https://vaultline.example/r">the report</a>.</p>';

  const words = [
    "Zephyr", "routing", "Vaultline", "study", "38%", "latency",
    "Nordvale", "adopted", "Kessler", "followed", "Others", "waited",
    "Quotable", "claim", "Region", "Uptake", "Nordic", "62%", "report",
  ];
  // Precondition: the fixture must use every construct, or "nothing dropped"
  // is being asserted over a document that exercises none of the risky paths.
  const constructs = ["<h2", "<strong", "<em", "<ul", "<blockquote", "<table", "<a href"];
  let present = 0;
  for (let i = 0; i < constructs.length; i++) if (doc.indexOf(constructs[i]) >= 0) present++;
  present === constructs.length
    ? pass(`the round-trip fixture uses all ${constructs.length} constructs`)
    : fail(`the fixture uses only ${present} of ${constructs.length} constructs`);

  const md = htmlToMarkdown(doc);
  const missing: string[] = [];
  for (let i = 0; i < words.length; i++) if (md.indexOf(words[i]) < 0) missing.push(words[i]);
  missing.length === 0
    ? pass(`all ${words.length} words survive the conversion`)
    : fail(`dropped from the output: ${missing.join(", ")}`);

  const plain = htmlToPlainText(doc);
  const missingPlain: string[] = [];
  for (let i = 0; i < words.length; i++) if (plain.indexOf(words[i]) < 0) missingPlain.push(words[i]);
  missingPlain.length === 0
    ? pass(`all ${words.length} words survive into plain text`)
    : fail(`dropped from the plain text: ${missingPlain.join(", ")}`);
}

// ── 8. Robustness ────────────────────────────────────────────────────────
console.log(`\n8. Robustness`);
{
  eq("empty input", htmlToMarkdown(""), "");
  eq("text with no tags at all", htmlToMarkdown("just words"), "just words");
  // Unbalanced markup must not hang or throw. It happens: a paste, a truncated
  // save, an editor bug. Losing formatting is fine; a spinning tab is not.
  const started = Date.now();
  let threw = false;
  let out = "";
  try {
    out = htmlToMarkdown("<ul><li><p>never closed");
  } catch {
    threw = true;
  }
  !threw && out.indexOf("never closed") >= 0
    ? pass("unbalanced markup keeps the words instead of throwing")
    : fail(threw ? "unbalanced markup threw" : `unbalanced markup lost its text: ${JSON.stringify(out)}`);
  Date.now() - started < 2000
    ? pass("unbalanced markup terminates promptly")
    : fail(`unbalanced markup took ${Date.now() - started}ms — the scanner is not advancing`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
