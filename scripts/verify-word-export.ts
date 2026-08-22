/**
 * Assertion script for lib/documents/word.ts — run with `npx tsx`.
 *
 * A markdown→docx regression does not throw. It produces a perfectly valid file
 * with the content quietly mangled: a table rendered as literal `| a | b |`
 * text, a heading left as `## Heading`, a link shown as raw markdown. The only
 * way to catch that is to build a real document and read the XML back.
 *
 * No test runner in this repo (precedent: scripts/verify-engine-scoping.ts).
 */
import { Packer, Document } from "docx";
import { markdownToDocxBlocks } from "../lib/documents/word";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

const SAMPLE = `# Cover Letter

Dear **Nature Finance**,

We are pleased to submit our proposal. It covers _three_ options and a \`budget\` breakdown.

## Option 1 — Retainer

- Monthly content programme
- Dedicated account manager
  - Named lead
- Quarterly review

1. Discovery
2. Build
3. Launch

## Comparison

| Option | Monthly cost | Commitment |
| --- | --- | --- |
| Retainer | £12,000 | 12 months |
| Project | £18,000 | One-off |

> This pricing holds until the end of the quarter.

---

See [our website](https://thecontentengine.com) for detail.

\`\`\`
npm run deploy
\`\`\`
`;

const isTable = (b: unknown) => (b as any)?.constructor?.name === "Table";

/** Build a real .docx from blocks and read word/document.xml back out of it. */
async function renderXml(blocks: any[]): Promise<string> {
  const { execSync } = await import("child_process");
  const { writeFileSync, mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: blocks }] }));
  const dir = mkdtempSync(join(tmpdir(), "docxcheck-"));
  const file = join(dir, "out.docx");
  writeFileSync(file, Buffer.from(buf));
  return execSync(`unzip -p ${JSON.stringify(file)} word/document.xml`, {
    maxBuffer: 20 * 1024 * 1024,
  }).toString();
}

async function main() {
  const blocks = markdownToDocxBlocks(SAMPLE);
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: blocks }] }));
  const xml = await renderXml(blocks);

  console.log(`\nBuilt ${(buf as Buffer).length} bytes, document.xml ${xml.length} chars\n`);

  console.log("Structure");
  check("produced blocks", blocks.length > 10, `got ${blocks.length}`);
  check("headings become real Word headings", /w:pStyle w:val="Heading1"/.test(xml));
  check("h2 becomes Heading2", /w:pStyle w:val="Heading2"/.test(xml));
  check("a table element exists", /<w:tbl>/.test(xml));
  check("table has a header cell", xml.includes("Monthly cost"));
  check("table body cell present", xml.includes("£12,000"));
  check("bullets use Word list formatting", /<w:numPr>/.test(xml));

  console.log("\nNothing leaks as literal markdown");
  check("no '## ' left in output", !xml.includes("## "), "a heading was not converted");
  check("no '| ---' table divider left", !xml.includes("| ---"));
  check("no pipe-delimited row left", !/\|\s*Retainer\s*\|/.test(xml));
  check("no '**' bold markers left", !xml.includes("**"));
  check("no '](http' link syntax left", !xml.includes("](http"));
  check("no '```' fence left", !xml.includes("```"));
  check("no leading '> ' quote marker", !/>\s?This pricing holds/.test(xml.replace(/<[^>]+>/g, "")));

  console.log("\nInline formatting");
  check("bold run emitted", /<w:b\b/.test(xml));
  check("italic run emitted", /<w:i\b/.test(xml));
  check("hyperlink emitted", /<w:hyperlink/.test(xml));
  check("link label kept", xml.includes("our website"));
  check("code span uses Consolas", xml.includes("Consolas"));
  check("code block content kept", xml.includes("npm run deploy"));

  console.log("\nContent survives intact");
  const text = xml.replace(/<[^>]+>/g, "");
  for (const phrase of [
    "Cover Letter",
    "Nature Finance",
    "Monthly content programme",
    "Dedicated account manager",
    "Discovery",
    "This pricing holds until the end of the quarter.",
  ]) {
    check(`kept: "${phrase.slice(0, 40)}"`, text.includes(phrase));
  }

  console.log("\nEdge cases");
  check("empty input yields no blocks", markdownToDocxBlocks("").length === 0);
  check("plain text yields one paragraph", markdownToDocxBlocks("just a sentence").length === 1);
  const ragged = markdownToDocxBlocks("| a | b |\n| --- | --- |\n| only-one |");
  check("ragged table row does not throw and still builds", ragged.length >= 1);
  const pipesNoDivider = markdownToDocxBlocks("a | b | c");
  check("pipes without a divider are NOT a table", !pipesNoDivider.some(isTable));

  // Everything below is a defect an adversarial review found in the first cut
  // of this converter. Each one produced a valid file with content quietly
  // wrong, which is the failure mode worth guarding hardest against.
  console.log("\nRegressions from review");

  // 1. A bare `---` section break is not a table divider. Previously any prose
  //    line containing a pipe, followed by ---, became a table header.
  const hrCase = markdownToDocxBlocks(
    "Revenue | Costs shown below.\n---\nA following line.\n\nAfter blank."
  );
  check("bare --- after a pipe line is NOT a table", !hrCase.some(isTable));

  // 2. A real table still parses (the fix must not over-correct).
  check(
    "a genuine table still parses",
    markdownToDocxBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |").some(isTable)
  );
  check(
    "single-column table still parses",
    markdownToDocxBlocks("| Only |\n| --- |\n| one |").some(isTable)
  );

  // 3. A bullet containing a pipe, straight after a table, stays a bullet.
  const afterTable = markdownToDocxBlocks("| A | B |\n|---|---|\n| 1 | 2 |\n- note: use A | B\n- second note");
  const tables = afterTable.filter(isTable);
  check("table followed by pipe-bearing bullet: exactly one table", tables.length === 1);
  const afterXml = await renderXml(afterTable);
  check("the bullet survives as a bullet, not a row", /<w:numPr>/.test(afterXml));
  check("bullet text is not split across cells", afterXml.includes("note: use A"));

  // 4. A row with MORE cells than the header keeps its surplus content.
  const wideXml = await renderXml(
    markdownToDocxBlocks("| Metric | Value |\n| --- | --- |\n| Split paid | organic | 60/40 |\n| Users | 1,204 |")
  );
  check("surplus cell content is not dropped", wideXml.includes("60/40"), "a value vanished from the table");
  check("other rows still intact", wideXml.includes("1,204"));

  console.log(failures === 0 ? "\nAll assertions passed.\n" : `\n${failures} FAILURE(S).\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
