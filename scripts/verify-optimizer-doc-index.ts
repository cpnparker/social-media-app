/**
 * Does the editor agree with the parser about what the text is?
 *
 * anchors.ts finds a span by offset into ParsedDraft.text. The editor needs a
 * ProseMirror position. doc-index.ts bridges the two — and it can only do that
 * if its idea of "the plain text of this document" is BYTE-IDENTICAL to the
 * parser's. Not close. Identical.
 *
 * Off by one character is the dangerous case, not off by ten. Ten lands the
 * highlight somewhere obviously wrong. One silently drops a sentence's final
 * period, so Apply rewrites the sentence and eats its punctuation — nothing
 * throws, the panel looks right, and the writer's text is quietly damaged.
 *
 * Two implementations reconstructing the same string WILL drift. It has
 * already happened once: stripTags was changed to substitute a space for a tag
 * rather than nothing, which invalidated every assumption a hand-checked index
 * would have rested on. So section 1 asserts equality directly against the real
 * parseDraft, for every fixture, and that assertion is the only thing keeping
 * the two in step. Section 2 then proves the mapping round-trips: every span
 * anchors.ts could find must resolve to a ProseMirror range holding exactly
 * that text.
 *
 *   npx tsx scripts/verify-optimizer-doc-index.ts
 *
 * MUTATION LOG — every entry actually run, in a throwaway git worktree and
 * never the shared tree (vercel deploy --prod uploads the working directory):
 *   2026-08-21  hardBreak contributes "" not " "   →  3 failures, exit 1  ✓
 *   2026-08-21  codeBlock text included in index   →  2 failures, exit 1  ✓
 *   2026-08-21  blocks joined with "\n" not "\n\n" → 10 failures, exit 1  ✓
 *   2026-08-21  textRangeToPos returns from-1      →  6 failures, exit 1  ✓  (see below)
 *   (baseline, unmutated: 0 failures, exit 0)
 *
 * THE FOURTH ONE INITIALLY PASSED, and that is the most useful thing in this
 * log. An off-by-one on `from` — the exact failure this file is named for —
 * produced ZERO failures against the first version of section 2, because
 * `doc.textBetween` clamps a position sitting inside a block-open token and
 * returned the identical string. The check was asserting the text it read, not
 * the range it read it from. Section 2 now asserts the EDGES are tight, and the
 * mutation goes red six times. Reading correctly is not the same as pointing
 * correctly, and only the second one is safe to hand to a replace.
 */
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { buildDocIndex, textRangeToPos } from "../lib/optimizer/doc-index";
import { parseDraft } from "../lib/optimizer/parse";
import { findAnchor } from "../lib/optimizer/anchors";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } })] as any);

function p(text: string) { return { type: "paragraph", content: [{ type: "text", text }] }; }

/**
 * Each fixture is a ProseMirror doc AND the HTML the editor would serialise it
 * to. Both must produce the same plain text — that is the whole assertion.
 */
const FIXTURES: { name: string; json: any; html: string }[] = [
  {
    name: "plain paragraphs",
    json: { type: "doc", content: [p("First sentence here."), p("Second sentence here.")] },
    html: "<p>First sentence here.</p><p>Second sentence here.</p>",
  },
  {
    name: "heading and marks",
    json: {
      type: "doc", content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "The Claim" }] },
        { type: "paragraph", content: [
          { type: "text", text: "Retention beats " },
          { type: "text", marks: [{ type: "bold" }], text: "acquisition" },
          { type: "text", text: " every time." },
        ]},
      ],
    },
    html: "<h2>The Claim</h2><p>Retention beats <strong>acquisition</strong> every time.</p>",
  },
  {
    name: "list items (Tiptap nests a paragraph inside each)",
    json: {
      type: "doc", content: [
        { type: "bulletList", content: [
          { type: "listItem", content: [p("First item")] },
          { type: "listItem", content: [p("Second item")] },
        ]},
      ],
    },
    html: "<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>",
  },
  {
    name: "hard break — the one-character trap",
    json: {
      type: "doc", content: [
        { type: "paragraph", content: [
          { type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" },
        ]},
      ],
    },
    html: "<p>one<br>two</p>",
  },
  {
    name: "code block (parser deletes it, so the index must too)",
    json: {
      type: "doc", content: [
        p("Before the sample."),
        { type: "codeBlock", content: [{ type: "text", text: "const rate = 44.2; // according to nobody" }] },
        p("The final sentence carries the proof."),
      ],
    },
    html: "<p>Before the sample.</p><pre><code>const rate = 44.2; // according to nobody</code></pre><p>The final sentence carries the proof.</p>",
  },
  {
    name: "blockquote wrapping a paragraph",
    json: {
      type: "doc", content: [
        p("Lead in."),
        { type: "blockquote", content: [p("The uplift is real but not uniform.")] },
      ],
    },
    html: "<p>Lead in.</p><blockquote><p>The uplift is real but not uniform.</p></blockquote>",
  },
];

console.log(`\nverify-optimizer-doc-index   ${FIXTURES.length} fixtures\n`);

// ── 1. The index agrees with the parser, byte for byte ───────────────────

console.log("1. The index text is byte-identical to what the parser produced");
{
  for (let i = 0; i < FIXTURES.length; i++) {
    const fx = FIXTURES[i];
    const doc = schema.nodeFromJSON(fx.json);
    const index = buildDocIndex(doc);
    const parsed = parseDraft({ body: fx.html, title: "" });

    if (index.text === parsed.text) {
      pass(`${fx.name}`);
    } else {
      fail(`${fx.name}: index and parser disagree`,
        `index:  ${JSON.stringify(index.text)}\n        parser: ${JSON.stringify(parsed.text)}\n        ` +
        `A highlight computed from one and applied to the other lands off by the difference. One character is enough to eat a sentence's punctuation on Apply.`);
    }
  }
}

// ── 2. Offsets round-trip to the right text ──────────────────────────────

console.log("\n2. Every anchorable span resolves to a range holding exactly that text");
{
  // PRECONDITION COUNTER. The two `continue`s below used to skip silently, so a
  // fixture that produced no text — or a bug that made every fixture produce no
  // text — would have left this section green having tested nothing at all.
  // That is the same shape as a regex extraction that matches nothing and
  // reports "no drift": a check that cannot fail. The count is asserted at the
  // end, from a different direction than the property being tested.
  let exercised = 0;

  for (let i = 0; i < FIXTURES.length; i++) {
    const fx = FIXTURES[i];
    const doc = schema.nodeFromJSON(fx.json);
    const index = buildDocIndex(doc);
    if (!index.text) {
      fail(`${fx.name}: produced no text at all`, "A fixture that yields nothing cannot exercise the mapping.");
      continue;
    }

    // Take a real span the way a finding would: a sentence out of the middle.
    const sentences = index.text.split(/\n\n/);
    const target = sentences[sentences.length - 1];
    if (!target || target.length < 6) {
      fail(`${fx.name}: its last block is too short to anchor (${JSON.stringify(target)})`,
           "Fixtures must carry a real span; skipping one quietly is how a section stays green while testing nothing.");
      continue;
    }
    exercised++;

    const anchor = findAnchor(index.text, { quote: target });
    if (!anchor.ok) { fail(`${fx.name}: could not anchor its own last block`); continue; }

    const range = textRangeToPos(index, anchor.start, anchor.end);
    if (!range) {
      fail(`${fx.name}: a span the anchorer found did not resolve to a position`,
           "An unresolvable range loses a highlight. Returning a guess instead would rewrite the wrong text.");
      continue;
    }

    const got = doc.textBetween(range.from, range.to, "\n\n", " ");
    if (got !== target) {
      fail(`${fx.name}: the resolved range holds the wrong text`,
           `wanted: ${JSON.stringify(target)}\n        got:    ${JSON.stringify(got)}`);
      continue;
    }

    // textBetween ALONE is not enough, and this is not a hypothetical: an
    // off-by-one on `from` passed the equality check above, because a position
    // one earlier sits inside a block-open token that contributes no text.
    // Harmless for reading; NOT harmless for insertText, which would delete the
    // block boundary and merge two paragraphs on Apply. So assert `from` points
    // AT the first character, not merely near it.
    const firstChar = doc.textBetween(range.from, range.from + 1, "", "");
    const lastChar = doc.textBetween(range.to - 1, range.to, "", "");
    if (firstChar !== target[0] || lastChar !== target[target.length - 1]) {
      fail(`${fx.name}: the range reads correctly but its edges are not tight`,
           `from points at ${JSON.stringify(firstChar)} (want ${JSON.stringify(target[0])}), ` +
           `to ends at ${JSON.stringify(lastChar)} (want ${JSON.stringify(target[target.length - 1])}). ` +
           `A replace across a loose edge eats a block boundary.`);
      continue;
    }
    pass(`${fx.name}: "${target.slice(0, 42)}${target.length > 42 ? "…" : ""}" (edges tight)`);
  }

  exercised === FIXTURES.length
    ? pass(`all ${FIXTURES.length} fixtures actually exercised the mapping`)
    : fail(`only ${exercised} of ${FIXTURES.length} fixtures exercised the mapping`,
           "The rest were skipped. Every 'ok' above is real, but the section did not cover what it claims to.");
}

// ── 3. Refusing rather than guessing ─────────────────────────────────────

console.log("\n3. Unresolvable ranges return null, not a guess");
{
  const doc = schema.nodeFromJSON(FIXTURES[0].json);
  const index = buildDocIndex(doc);

  textRangeToPos(index, 10_000, 10_010) === null
    ? pass("an out-of-range offset returns null")
    : fail("an out-of-range offset resolved to a position", "That position points at real text the finding is not about.");

  textRangeToPos(index, 5, 5) === null
    ? pass("an empty range returns null")
    : fail("an empty range resolved");

  textRangeToPos(index, 8, 3) === null
    ? pass("an inverted range returns null")
    : fail("an inverted range resolved");

  // An empty paragraph carries NO content node — ProseMirror rejects empty
  // text nodes outright, so `{content: [{type:"text", text:""}]}` is not the
  // shape an empty editor produces.
  const empty = buildDocIndex(schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph" }] }));
  empty.text === "" && empty.spans.length === 0
    ? pass("an empty document yields an empty index rather than throwing")
    : fail(`an empty document produced text=${JSON.stringify(empty.text)}`);
}

// ── 4. The specific mistakes that are off by one ─────────────────────────

console.log("\n4. The off-by-one traps, named");
{
  const brDoc = schema.nodeFromJSON(FIXTURES[3].json);
  const brIndex = buildDocIndex(brDoc);
  brIndex.text === "one two"
    ? pass('a hard break contributes one space ("one two", not "onetwo")')
    : fail(`a hard break produced ${JSON.stringify(brIndex.text)}`,
           "parse.ts substitutes a space for every tag. An index that drops it is off by one for the rest of the block.");

  const codeDoc = schema.nodeFromJSON(FIXTURES[4].json);
  const codeIndex = buildDocIndex(codeDoc);
  codeIndex.text.indexOf("44.2") < 0
    ? pass("code-block content is absent from the index, as it is from the parser")
    : fail("code-block text leaked into the index",
           "Every offset after the first code block would be wrong, and the sample's numbers would read as statistics.");

  // And the round-trip through the code fixture specifically: this is where a
  // leaked code block would land the highlight in the wrong paragraph.
  const target = "The final sentence carries the proof.";
  const a = findAnchor(codeIndex.text, { quote: target });
  if (a.ok) {
    const r = textRangeToPos(codeIndex, a.start, a.end);
    const got = r ? codeDoc.textBetween(r.from, r.to, "\n\n", " ") : "(unresolved)";
    got === target
      ? pass("a sentence AFTER a code block still resolves exactly")
      : fail(`the sentence after a code block resolved to ${JSON.stringify(got)}`);
  } else {
    fail("could not anchor the sentence after a code block");
  }
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
