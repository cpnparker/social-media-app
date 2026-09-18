/**
 * Turning imported content into editor HTML, checked by making it fail.
 *
 * This code exists because of a bug that was invisible for exactly the reason
 * these checks are written the way they are: nothing converted an import into
 * HTML, so every pasted or Google-Doc article reached Tiptap as plain text and
 * became ONE paragraph with no headings. It did not look like a parsing bug. It
 * looked like a low score, and the writer was shown a list of structural
 * problems the import had introduced.
 *
 * THE RULE WITH TWO DIRECTIONS, which is the heart of this file. When an
 * unknown tag is unwrapped, what replaces it?
 *   - a BLOCK tag must become a SPACE, or "alpha</div><div>beta" glues into
 *     "alphabeta" — words nobody wrote;
 *   - an INLINE tag must become NOTHING, or Google Docs' habit of splitting
 *     words across spans ("<span>Headlin</span><span>e</span>") breaks real
 *     words into "Headlin e".
 * Both were shipped wrong at some point, in opposite directions, and a check
 * asserting only one of them passes happily while the other is broken. Section
 * 2 asserts both.
 *
 *   npx tsx scripts/verify-optimizer-import-html.ts
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the shared
 * tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  inline unwrap inserts a space (Headlin e) → 4 fail  ✓
 *   2026-08-21  block unwrap drops to "" (alphabeta)      → 1 fail  ✓ (2nd try)
 *   2026-08-21  <style> nuked before classes resolved     → 1 fail  ✓
 *   2026-08-21  plain text no longer split into blocks    → 3 fail  ✓
 *   2026-08-21  href allowlist → javascript-only blacklist→ 2 fail  ✓ (2nd try)
 *   2026-08-21  comment-anchor rejoin removed             → 1 fail  ✓
 *   2026-08-21  any "<" counts as html                    → 1 fail  ✓ (2nd try)
 *   (baseline, unmutated: exit 0)
 *
 * THREE OF THOSE SURVIVED THE FIRST TIME, and the reasons are the point:
 *
 *   - the block-gluing fixture was `<p>alpha</p><div>beta</div>`, where the
 *     KEPT `</p>` already separates the two words. Dropping div to "" glued
 *     nothing. The check named the rule and could not test it. Now the words
 *     are separated by unknown tags only, and the fixture asserts that.
 *   - the href fixture used only `javascript:`, so a blacklist that blocks
 *     exactly "javascript" passed it. `data:` and `vbscript:` were added,
 *     which is the whole reason the real rule is an allowlist.
 *   - the html-sniff fixture was one paragraph of prose containing "<". Routed
 *     down either path it came back looking similar, so mis-routing was
 *     invisible. With two paragraphs the difference is structural — and the
 *     mutated run showed the "<" being eaten out of "< 200ms" as well.
 *
 * Each was a check that named a real rule, passed, and proved nothing. That is
 * the failure mode this repo keeps rediscovering, and it is only ever found by
 * running the mutation rather than by reading the check.
 *
 * MUTATION LOG (2026-08-24) — run in a throwaway worktree.
 *   layout-table unwrap disabled                  -> 4 fail  ✓
 *   data tables also flattened (over-broad)       -> 3 fail  ✓
 *   empty headings/paragraphs left in place       -> 3 fail  ✓
 *   (baseline: exit 0)
 *
 * Two of these first reported as SURVIVORS and were not: the mutation had
 * failed to apply through shell escaping. A mutation that does not apply looks
 * exactly like one the check missed, so every entry here asserts the edit
 * changed the file before drawing a conclusion.
 */
import { plainTextToHtml, sanitizeImportedHtml, toEditorHtml } from "../lib/optimizer/import-html";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const eq = (label: string, got: string, want: string) =>
  got === want ? pass(label) : fail(`${label}\n          got:  ${JSON.stringify(got)}\n          want: ${JSON.stringify(want)}`);
const has = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) >= 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} not in ${JSON.stringify(hay.slice(0, 160))}`);
const hasnt = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) < 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} IS present in ${JSON.stringify(hay.slice(0, 160))}`);

// ── 1. The original bug ──────────────────────────────────────────────────
console.log(`\n1. Plain text becomes real blocks`);
{
  // The exact shape a textarea paste produces, and the exact failure: Tiptap
  // parses its input as HTML, where newlines are whitespace.
  const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
  const html = plainTextToHtml(text);
  const paras = (html.match(/<p\b/g) || []).length;
  paras === 3
    ? pass("three blank-line-separated blocks become three paragraphs")
    : fail(`three blocks became ${paras} paragraph(s) — this is the original bug: ${JSON.stringify(html)}`);

  // Precondition: the fixture must actually be plain text with blank lines. A
  // fixture that already contained <p> would pass this section trivially.
  text.indexOf("<") < 0 && text.indexOf("\n\n") > 0
    ? pass("the fixture really is tag-free text with blank lines in it")
    : fail("the fixture is not plain text — section 1 proves nothing");

  // A hard-wrapped document must NOT become one paragraph per line.
  const wrapped = plainTextToHtml("A sentence that was\nhard wrapped by the editor.\n\nA second paragraph.");
  (wrapped.match(/<p\b/g) || []).length === 2
    ? pass("single newlines are soft breaks, not new paragraphs")
    : fail(`hard-wrapped text became ${(wrapped.match(/<p\b/g) || []).length} paragraphs: ${JSON.stringify(wrapped)}`);

  eq("a markdown heading becomes a heading", plainTextToHtml("## Why it matters"), "<h2>Why it matters</h2>");
  eq(
    "bullets become a list Tiptap's shape",
    plainTextToHtml("- one\n- two"),
    "<ul><li><p>one</p></li><li><p>two</p></li></ul>"
  );
  eq(
    "the bullet character a Docs export actually emits also works",
    plainTextToHtml("• one\n• two"),
    "<ul><li><p>one</p></li><li><p>two</p></li></ul>"
  );
  eq("numbered lines become an ordered list", plainTextToHtml("1. one\n2. two"), "<ol><li><p>one</p></li><li><p>two</p></li></ol>");

  // Guessing is deliberately NOT done. A short line is a paragraph.
  const shortLine = plainTextToHtml("The Opening Line\n\nBody text follows here.");
  hasnt("a short line is NOT guessed into a heading", shortLine, "<h");
}

// ── 2. The unwrap rule, in BOTH directions ───────────────────────────────
console.log(`\n2. Unwrapping unknown tags — both directions`);
{
  // INLINE → nothing. Google Docs splits words across spans routinely.
  eq("an inline span is unwrapped to NOTHING, keeping the word whole",
     sanitizeImportedHtml("<p>Headlin<span>e</span></p>"), "<p>Headline</p>");
  eq("several spans inside one word", sanitizeImportedHtml("<p><span>Head</span><span>line</span></p>"), "<p>Headline</p>");
  for (const t of ["sup", "font", "small", "ins"]) {
    const out = sanitizeImportedHtml(`<p>Headlin<${t}>e</${t}></p>`);
    out === "<p>Headline</p>"
      ? pass(`<${t}> is treated as inline`)
      : fail(`<${t}> broke the word: ${JSON.stringify(out)}`);
  }

  // BLOCK → a space. The opposite failure.
  //
  // The fixture must separate the two words with NOTHING BUT unknown tags. An
  // earlier version used `<p>alpha</p><div>beta</div>`, where the kept `</p>`
  // already separates them — so dropping div to "" glued nothing and the
  // mutation survived. The check passed while the rule it names was broken.
  const block = sanitizeImportedHtml("<div>alpha</div><div>beta</div>");
  hasnt("a block-level unknown tag does NOT glue words together", block, "alphabeta");
  has("...and its text is kept", block, "beta");
  // Assert the fixture can actually detect it: no kept tag may sit between the
  // two words in the INPUT.
  /^<div>alpha<\/div><div>beta<\/div>$/.test("<div>alpha</div><div>beta</div>")
    ? pass("the block fixture separates the two words with unknown tags only")
    : fail("the block fixture contains a kept tag between the words — it cannot detect gluing");

  // Precondition for BOTH: each fixture must butt two fragments against a tag
  // boundary with no whitespace, or neither direction is being tested.
  /Headlin<[a-z]+>e/.test("<p>Headlin<span>e</span></p>")
    ? pass("the inline fixture really splits a word across a tag boundary")
    : fail("the inline fixture has whitespace — it cannot detect a space-inserting bug");

}

// ── 3. Google Docs, as it actually exports ───────────────────────────────
console.log(`\n3. Google Docs export quirks (verified against a real export)`);
{
  // Docs emits NO <strong>. Bold is a class, defined in a <style> block that a
  // naive sanitiser strips first — losing every bold run in the document.
  const docs =
    '<html><head><style>.c4{font-weight:700}.c9{font-style:italic}.c1{color:#000}</style></head>' +
    '<body><p class="c1"><span class="c1">plain </span><span class="c4">bold</span>' +
    '<span class="c9"> italic</span></p></body></html>';
  const out = sanitizeImportedHtml(docs);
  has("a bold CSS class becomes <strong>", out, "<strong>bold</strong>");
  has("an italic CSS class becomes <em>", out, "<em> italic</em>");
  hasnt("the style block itself is gone", out, "font-weight");

  // Precondition: the fixture must express bold ONLY via a class, with no
  // <strong> and no inline style, or it is not testing class resolution.
  docs.indexOf("<strong") < 0 && docs.indexOf('style="') < 0
    ? pass("the Docs fixture uses a CSS class and nothing else for bold")
    : fail("the Docs fixture already contains <strong> or an inline style — class resolution is untested");

  // Inline style is the OTHER way it arrives (a clipboard paste), so both paths.
  has("an inline font-weight style also becomes <strong>",
      sanitizeImportedHtml('<p><span style="font-weight:700">b</span></p>'), "<strong>b</strong>");

  // Comment anchors are editorial chatter, and Docs splits the paragraph around
  // them — so removing the marker must also undo the split it caused.
  const commented =
    '<p><span>Headlin</span></p><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup><p><span>e</span></p>';
  const fixed = sanitizeImportedHtml(commented);
  eq("a comment anchor is removed AND the word it split is rejoined", fixed, "<p>Headline</p>");
}

// ── 4. Safety ────────────────────────────────────────────────────────────
console.log(`\n4. Safety — the input is a third-party document`);
{
  const nasty =
    '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(1)">' +
    '<a href="javascript:alert(1)">click</a><p onclick="alert(1)">y</p>' +
    '<iframe src="https://evil.test"></iframe><style>body{}</style>';
  const clean = sanitizeImportedHtml(nasty);
  hasnt("no script tag survives", clean, "script");
  hasnt("no event handler attribute survives", clean.toLowerCase(), "onerror");
  hasnt("no onclick survives", clean.toLowerCase(), "onclick");
  hasnt("no javascript: URL survives", clean.toLowerCase(), "javascript:");
  // A blacklist that blocks only "javascript" passes the line above while
  // letting these through, which is why the scheme rule is an ALLOWLIST. Each
  // of these is a real XSS vector in a link.
  for (const scheme of ["data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "JaVaScRiPt:alert(1)"]) {
    const out = sanitizeImportedHtml(`<p><a href="${scheme}">x</a></p>`);
    out.toLowerCase().indexOf(scheme.split(":")[0].toLowerCase() + ":") < 0
      ? pass(`a ${scheme.split(":")[0]} URL is stripped from the href`)
      : fail(`a ${scheme.split(":")[0]} URL survived: ${JSON.stringify(out)}`);
  }
  hasnt("no iframe survives", clean, "iframe");
  has("the writer's actual prose survives all of it", clean, "ok");

  // A comment can hide a whole tag from a naive tag-stripper.
  hasnt("a tag hidden inside an HTML comment does not survive",
        sanitizeImportedHtml("<p>a</p><!-- <script>alert(1)</script> -->"), "script");

  // An http link is content and must be KEPT — over-stripping is its own bug.
  has("an ordinary https link is kept", sanitizeImportedHtml('<p><a href="https://x.test/a">t</a></p>'), 'href="https://x.test/a"');
}

// ── 5. toEditorHtml routes correctly ─────────────────────────────────────
console.log(`\n5. Routing between the two converters`);
{
  has("html input is sanitised, not paragraph-wrapped", toEditorHtml("<h2>T</h2><p>b</p>"), "<h2>T</h2>");
  has("plain input is converted to blocks", toEditorHtml("one\n\ntwo"), "<p>one</p><p>two</p>");

  // Prose containing a less-than sign is NOT html. Treating it as html would
  // silently delete the rest of the sentence.
  // The fixture needs TWO paragraphs, or mis-routing to the html path is
  // undetectable: a single block comes back looking the same either way, and
  // the earlier one-paragraph version let that mutation survive.
  const prose = toEditorHtml("Latency was < 200ms and that mattered.\n\nA second paragraph.");
  has("prose containing '<' keeps its words", prose, "200ms and that mattered");
  (prose.match(/<p\b/g) || []).length === 2
    ? pass("prose containing '<' is still split into paragraphs, so it took the text path")
    : fail(`prose containing '<' was routed to the html path: ${JSON.stringify(prose)}`);

  // An explicit flag beats the sniff, in both directions.
  has("contentIsHtml:false forces text handling", toEditorHtml("<p>a</p>", false), "&lt;p&gt;");
  eq("contentIsHtml:true forces html handling", toEditorHtml("<p>a</p>", true), "<p>a</p>");
  eq("empty in, empty out", toEditorHtml(""), "");
}

// ── 6. Nothing is silently dropped ───────────────────────────────────────
console.log(`\n6. Nothing is silently dropped`);
{
  const doc =
    '<html><head><style>.b{font-weight:700}</style></head><body>' +
    '<h2>Zephyr routing</h2><p>The <span class="b">Vaultline</span> study found 38% lower latency.</p>' +
    '<ul><li><p>Nordvale adopted it</p></li></ul>' +
    '<table><tr><td><p>Nordic</p></td><td><p>62%</p></td></tr></table>' +
    '<p>See <a href="https://vaultline.example/r">the report</a>.</p></body></html>';
  const out = sanitizeImportedHtml(doc);
  const words = ["Zephyr", "routing", "Vaultline", "study", "38%", "latency", "Nordvale", "adopted", "Nordic", "62%", "report"];
  const missing: string[] = [];
  for (let i = 0; i < words.length; i++) if (out.indexOf(words[i]) < 0) missing.push(words[i]);
  missing.length === 0 ? pass(`all ${words.length} words survive`) : fail(`dropped: ${missing.join(", ")}`);
  has("the heading survives as a heading", out, "<h2>");
  has("the list survives", out, "<li>");
  has("the table survives", out, "<td>");

  // Tags must be balanced, or Tiptap silently restructures the document.
  const opens = (out.match(/<(p|h2|ul|li|table|tr|td|strong|a)\b/g) || []).length;
  const closes = (out.match(/<\/(p|h2|ul|li|table|tr|td|strong|a)\s*>/g) || []).length;
  opens === closes
    ? pass(`tags balance (${opens} open, ${closes} close)`)
    : fail(`unbalanced: ${opens} open vs ${closes} close — Tiptap will restructure this`);
}

// ── 7. The article-template table ────────────────────────────────────────
console.log(`\n7. The Docs article template unwraps into real structure`);
{
  // Shaped like the REAL template, including the workflow row that broke the
  // first version of the guard ("Please tick and initial" is 4 words, and a
  // label-length bail-out killed the whole unwrap because of it).
  const template =
    "<table>" +
    "<tr><td><p>Headline</p></td><td><p><strong>How Zephyr Reshapes Routing</strong></p></td></tr>" +
    "<tr><td><p>Byline</p></td><td><p>Ana Kessler, Vaultline</p></td></tr>" +
    "<tr><td><p>Standfirst</p></td><td><p></p></td></tr>" +
    "<tr><td><p>Article</p></td><td><p>The body of the piece, long enough to dominate the table by a wide margin. " +
    "It keeps going with a second sentence, and a third, so the body share is unmistakable.</p>" +
    "<p><strong>Why routing changed</strong></p><p>More body follows the pseudo-heading here.</p></td></tr>" +
    "<tr><td><p>Please tick and initial</p></td><td><p>KM / AB</p></td></tr>" +
    "</table>";
  const out = sanitizeImportedHtml(template);
  has("the headline row becomes an h1", out, "<h1>How Zephyr Reshapes Routing</h1>");
  hasnt("the table itself is gone", out, "<table>");
  has("the body flows out as paragraphs", out, "The body of the piece");
  has("a whole-line bold paragraph inside the body becomes a heading", out, "<h2>Why routing changed</h2>");
  has("the byline survives as content", out, "Ana Kessler");
  hasnt("the workflow row's label is dropped as scaffold", out, "tick and initial");
  // The VALUE must go too. A mutation that leaked workflow rows as content
  // survived, because only the label was asserted absent — the initials
  // "KM / AB" flowed into the article and nothing noticed.
  hasnt("the workflow row's value is dropped with it", out, "KM / AB");
  hasnt("the label cells are dropped as scaffold", out, "<p>Article</p>");

  // Precondition: the fixture must carry the row that broke the first version.
  template.indexOf("Please tick and initial") >= 0
    ? pass("the fixture includes the workflow row that defeated the first guard")
    : fail("the workflow row is missing — the guard that failed on the real doc is untested");

  // A DATA table must never unwrap — tables are FOR data.
  const data =
    "<table><tr><td><p>Region</p></td><td><p>Uptake</p></td></tr>" +
    "<tr><td><p>Nordic</p></td><td><p>62%</p></td></tr>" +
    "<tr><td><p>Baltic</p></td><td><p>48%</p></td></tr></table>";
  has("a data table stays a table", sanitizeImportedHtml(data), "<table>");

  // Bold promotion limits: a short emphatic SENTENCE keeps its punctuation and
  // stays a paragraph; a single word is not a heading either.
  has("a bold sentence with a full stop is NOT promoted",
      sanitizeImportedHtml("<p><strong>This changes everything.</strong></p>"), "<p><strong>This changes everything.</strong></p>");
  has("a single bold word is NOT promoted",
      sanitizeImportedHtml("<p><strong>Important</strong></p>"), "<p><strong>Important</strong></p>");
  has("a mid-length bold line IS promoted",
      sanitizeImportedHtml("<p><strong>Modernising the healthcare sector</strong></p>"), "<h2>Modernising the healthcare sector</h2>");
}


// ── Layout tables and the debris a .docx conversion leaves ────────────────
//
// A Word writer sets a definition box or a row of contributor cards as a
// TABLE. The parser ranks a table row above a heading, so a heading inside a
// cell never opens its own block: on the founder's own import, seven of
// nineteen headings — including the only question-shaped one in the piece —
// were invisible to every heading criterion. None of the fixtures here had a
// heading inside a table, which is why thirteen green checks said nothing.
console.log(`\nLayout tables, empty headings and empty paragraphs`);
{
  const layout = `<table><tbody><tr><th><h1>What is MAXtect?</h1><p></p><p>MAXtect is an ultra-high-performance concrete.</p></th></tr></tbody></table>`;
  const outL = toEditorHtml(layout, true);
  /<h1>What is MAXtect\?<\/h1>/.test(outL) && !/<table/i.test(outL)
    ? pass("a heading inside a layout table is freed to top level")
    : fail(`the layout table was not unwrapped: ${outL.slice(0, 130)}`);
  /MAXtect is an ultra-high-performance concrete\./.test(outL)
    ? pass("...and the cell's prose survives the unwrap")
    : fail("unwrapping the layout table lost its text");

  // The other direction, which matters just as much: a DATA table is what
  // tables are for, and must survive untouched.
  const data = `<table><tbody><tr><th>Region</th><th>Rate</th></tr><tr><td>Nordics</td><td>94.2%</td></tr></tbody></table>`;
  const outD = toEditorHtml(data, true);
  /<table/i.test(outD) && /Nordics/.test(outD) && /94\.2%/.test(outD)
    ? pass("a data table — no headings in its cells — is left alone")
    : fail(`a data table was flattened: ${outD.slice(0, 130)}`);

  // Word leaves a heading behind wherever a heading-styled paragraph held only
  // an image, and an empty paragraph wherever an image sat.
  //
  // THE SHAPES HERE ARE THE REAL ONES. The first version of this fixture used
  // `<h1></h1>`, which never occurs: a .docx is full of bookmark anchors, so
  // the blank headings arrive as `<h1><a></a></h1>`. The rule was a regex
  // listing the whitespace it tolerated, it matched nothing, and both the
  // check and the measurement reported success while four blank headings sat
  // in the document. Emptiness is judged on TEXT CONTENT for that reason.
  const debris = `<h1>Real heading</h1><h1><a></a></h1><h1></h1><h3>  </h3><p>Prose.</p><p><a></a></p><p></p><p>More prose.</p>`;
  const outE = toEditorHtml(debris, true);
  (outE.match(/<h[1-6]>/g) || []).length === 1
    ? pass("headings emptied by the conversion are dropped")
    : fail(`expected 1 heading, got ${(outE.match(/<h[1-6]>/g) || []).length}: ${outE.slice(0, 120)}`);
  !/<p><\/p>/.test(outE) && /Prose\./.test(outE) && /More prose\./.test(outE)
    ? pass("empty paragraphs go, real ones stay")
    : fail(`empty paragraph handling wrong: ${outE.slice(0, 130)}`);


  // And the direction that matters more, because getting it wrong deletes the
  // writer's figures: a block whose only content is an IMAGE has no text and
  // is emphatically not empty. Judging on text alone removed all twelve images
  // from the founder's document, since Word wraps each one in its own
  // paragraph.
  const figures = toEditorHtml(`<p>Before.</p><p><img src="/api/media/file?path=a.jpg" alt="A figure"></p><p>After.</p>`, true);
  (figures.match(/<img/g) || []).length === 1
    ? pass("a paragraph holding only a figure survives — text-only emptiness would delete it")
    : fail(`the image-only paragraph was deleted: ${figures}`);
  /Before\./.test(figures) && /After\./.test(figures)
    ? pass("...and the prose either side is untouched")
    : fail("removing blank blocks damaged the surrounding prose");

  // The empty paragraph is not cosmetic: it sat between a question heading and
  // the sentence answering it, and the answer criterion reads the NEXT block.
  const gap = toEditorHtml(`<h1>What is MAXtect?</h1><p></p><p>MAXtect is a concrete.</p>`, true);
  /<h1>What is MAXtect\?<\/h1><p>MAXtect is a concrete\.<\/p>/.test(gap)
    ? pass("a question heading ends up adjacent to its answer")
    : fail(`an empty block still separates the heading from its answer: ${gap}`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
