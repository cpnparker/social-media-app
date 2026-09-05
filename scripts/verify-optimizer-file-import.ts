/**
 * Uploaded documents, checked against a REAL .docx built here in memory.
 *
 * The fixture is assembled as actual OOXML — content types, relationships, a
 * styles part, a drawing referencing an embedded PNG — rather than mocked,
 * because every bug this path can have lives in the conversion: a style that
 * does not map, an image relationship that does not resolve, a table that
 * arrives as a wall of text. A mock of mammoth would assert that the mock
 * works.
 *
 *   npx tsx scripts/verify-optimizer-file-import.ts
 *
 * The uploader is injected, which is what makes the interesting half testable:
 * the FAILURE path. An image that cannot be stored has to be dropped AND
 * reported, and "dropped silently" is indistinguishable from success in the
 * output HTML — it is only visible in the warnings, so that is what is
 * asserted.
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the shared
 * tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-24  drop the Title lift (title stays in body)   → 1 fail  ✓
 *   2026-08-24  swallow upload failures (no warning)        → 2 fail  ✓
 *   2026-08-24  remove "img" from import-html's KEEP list   → 3 fail  ✓
 *   2026-08-24  remove "img" from balanceTags' VOID list    → 1 fail  ✓
 *   2026-08-24  allow data: URLs through the img sanitiser  → 1 fail  ✓
 *   2026-08-24  accept .pdf instead of refusing it          → SURVIVED
 *   2026-08-24  ...same mutation, after tightening §5       → 1 fail  ✓
 *   (baseline, unmutated: exit 0)
 *
 * THE SURVIVOR IS THE USEFUL ENTRY. Deleting the PDF branch outright still
 * refuses the file — it falls through to the generic "upload a .docx, .html,
 * .md or .txt", which also contains the word docx, so an assertion matching
 * /structure|docx/ was satisfied by a refusal that had lost its explanation.
 * The check now asserts the REASON each refusal gives (/binary/, /headings/),
 * because a dead end wearing a reason's clothes is what the writer actually
 * suffers from. Asserting that something failed is not the same as asserting
 * it failed for the right reason.
 */
import JSZip from "jszip";
import { importFile, importDocx } from "../lib/optimizer/file-import";
import { toEditorHtml } from "../lib/optimizer/import-html";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

const OPTS = { workspaceId: "56ef624c-7399-4da2-9a5c-8764471e39ff", maxChars: 500000 };

// A 1x1 PNG — the smallest thing that is genuinely an image file.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const imagePara = (relId: string, descr: string) =>
  `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
  `<wp:extent cx="1000000" cy="1000000"/><wp:docPr id="1" name="Picture 1" descr="${descr}"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r></w:p>`;

const table =
  `<w:tbl>` +
  `<w:tr><w:tc>${para("Region")}</w:tc><w:tc>${para("Authorisation rate")}</w:tc></w:tr>` +
  `<w:tr><w:tc>${para("Nordics")}</w:tc><w:tc>${para("94.2%")}</w:tc></w:tr>` +
  `</w:tbl>`;

async function buildDocx(opts: { images: number }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`);
  zip.file("_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`);

  // Style NAMES are what mammoth's styleMap matches on, so the styles part is
  // not optional furniture — without it "Title" is just an unknown id.
  zip.file("word/styles.xml",
    `<w:styles ${NS}>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>` +
    `</w:styles>`);

  const rels: string[] = [
    `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ];
  const bodyParts: string[] = [
    para("The Payment Orchestration Report", "Title"),
    para("What orchestration changes", "Heading1"),
    para("Vaultline routes card transactions across several acquirers, which lifts authorisation rates for cross-border volume."),
    para("How the routing decision works", "Heading2"),
    para("Each transaction is scored against live acquirer performance before it is sent."),
    table,
  ];
  for (let i = 0; i < opts.images; i++) {
    const id = `rIdImg${i}`;
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.png"/>`);
    zip.file(`word/media/image${i}.png`, PNG);
    bodyParts.push(imagePara(id, `Routing diagram ${i}`));
  }

  zip.file("word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  zip.file("word/document.xml", `<w:document ${NS}><w:body>${bodyParts.join("")}</w:body></w:document>`);

  return zip.generateAsync({ type: "nodebuffer" }) as unknown as Promise<Buffer>;
}

/** Records what it was asked to store, so the assertions can check the seam. */
function recordingUploader() {
  const calls: { size: number; type: string }[] = [];
  return {
    calls,
    upload: async (buf: Buffer, contentType: string, i: number) => {
      calls.push({ size: buf.length, type: contentType });
      return `/api/media/file?path=optimizer%2Fw-test%2F${i}.png`;
    },
  };
}

async function main() {
  // ── 1. The fixture is genuinely a docx ──────────────────────────────────
  console.log(`\n1. The fixture is a real .docx, so the conversion is real`);
  const docx = await buildDocx({ images: 2 });
  {
    const zip = await JSZip.loadAsync(docx);
    const names = Object.keys(zip.files);
    names.indexOf("word/document.xml") >= 0 && names.indexOf("word/media/image0.png") >= 0
      ? pass(`built a ${Math.round(docx.length / 1024)}KB docx with ${names.length} parts including an embedded image`)
      : fail("the fixture is not a well-formed docx — every assertion below would be vacuous");
  }

  // ── 2. Structure survives, which is the entire point ────────────────────
  console.log(`\n2. Structure survives — headings, tables, figures`);
  {
    const up = recordingUploader();
    const r = await importDocx(docx, { ...OPTS, uploadImage: up.upload });
    if (!r.ok) { fail(`the document did not convert: ${r.error}`); }
    else {
      const h = r.html || "";
      /<h1>/.test(h) || /<h2>/.test(h)
        ? pass("Word headings arrive as real heading elements")
        : fail("headings were flattened — the rubric would score this as a wall of text");
      /<table>/.test(h) && /Nordics/.test(h)
        ? pass("a table arrives as a table, with its cells")
        : fail("the table was lost or flattened");
      (h.match(/<img\b/g) || []).length === 2
        ? pass("both figures survive as <img> elements")
        : fail(`expected 2 images in the html, found ${(h.match(/<img\b/g) || []).length}`);
      up.calls.length === 2 && up.calls[0].type === "image/png"
        ? pass("both figures were handed to the uploader, with their content type")
        : fail(`the uploader saw ${up.calls.length} call(s): ${JSON.stringify(up.calls)}`);
      r.imageCount === 2
        ? pass("the reported image count matches what was stored")
        : fail(`imageCount is ${r.imageCount}, expected 2`);
    }
  }

  // ── 3. The Title style is lifted, not duplicated ────────────────────────
  console.log(`\n3. The document's title becomes the title, and leaves the body`);
  {
    const up = recordingUploader();
    const r = await importDocx(docx, { ...OPTS, uploadImage: up.upload });
    r.title === "The Payment Orchestration Report"
      ? pass("the Word Title style becomes the piece's title")
      : fail(`title is "${r.title}" — Word's Title style is not a heading and maps to a bare <p> by default`);
    r.ok && (r.html || "").indexOf("The Payment Orchestration Report") < 0
      ? pass("...and is removed from the body, so the rubric does not score the headline twice")
      : fail("the title is still in the body as well as the title field");
  }

  // ── 4. A figure that cannot be stored is DROPPED AND SAID ───────────────
  console.log(`\n4. A failed upload is reported, never silent`);
  {
    const r = await importDocx(docx, { ...OPTS, uploadImage: async () => null });
    (r.html || "").indexOf("<img") < 0
      ? pass("an unstorable figure does not leave a broken <img> in the draft")
      : fail("a figure with no stored URL was left in the html");
    (r.warnings || []).some((w) => /could not be stored/i.test(w))
      ? pass("...and the writer is told it was left out")
      : fail(`a figure vanished with no warning: ${JSON.stringify(r.warnings)} — silent loss is what makes an import untrustworthy`);
  }
  {
    // An uploader that THROWS is the same promise to the writer as one that
    // returns null; both must reach the same warning.
    const r = await importDocx(docx, { ...OPTS, uploadImage: async () => { throw new Error("blob down"); } });
    (r.warnings || []).some((w) => /could not be stored/i.test(w))
      ? pass("an uploader that throws is reported too, not just one that returns null")
      : fail("a throwing uploader produced no warning");
  }

  // ── 5. Routing by type, including the deliberate refusals ───────────────
  console.log(`\n5. File types — including the ones refused on purpose`);
  {
    const buf = Buffer.from("hello");
    const cases: { name: string; expectOk: boolean; expect?: RegExp }[] = [
      { name: "notes.txt", expectOk: true },
      { name: "page.html", expectOk: true },
      // These two assert the SPECIFIC reason, not merely that a refusal
      // happened. Deleting the pdf branch entirely still refuses the file —
      // it falls through to the generic "upload a .docx, .html, .md or .txt",
      // which also contains the word docx — so a looser assertion passed a
      // mutation that had removed the explanation the writer needs. The
      // refusal has to say WHY, or it is a dead end wearing a reason's clothes.
      { name: "old.doc", expectOk: false, expect: /binary/i },
      { name: "report.pdf", expectOk: false, expect: /headings/i },
      { name: "sheet.xlsx", expectOk: false },
      { name: "noextension", expectOk: false },
    ];
    for (const c of cases) {
      const body = /\.(html|txt)$/.test(c.name) ? Buffer.from("<h1>Title</h1><p>Some real prose here.</p>") : buf;
      const r = await importFile({ name: c.name, type: "", buffer: body }, OPTS);
      if (r.ok !== c.expectOk) { fail(`${c.name}: ok=${r.ok}, expected ${c.expectOk} (${r.error || ""})`); continue; }
      if (c.expect && !c.expect.test(r.error || "")) { fail(`${c.name}: refusal did not say what to do instead — "${r.error}"`); continue; }
      pass(`${c.name} → ${c.expectOk ? "imported" : "refused, with a reason"}`);
    }
  }

  // ── 6. The sanitiser's image rules ──────────────────────────────────────
  console.log(`\n6. Images through the sanitiser`);
  {
    const out = toEditorHtml('<p>Before</p><img src="/api/media/file?path=x.png" alt="A diagram"><p>After</p>', true);
    /<img[^>]+src="\/api\/media\/file\?path=x\.png"/.test(out)
      ? pass("a stored figure survives sanitising with its src")
      : fail(`the img was stripped by the sanitiser: ${out}`);
    /alt="A diagram"/.test(out)
      ? pass("...and keeps its alt text, which the alt criteria then score")
      : fail("alt text was dropped");
    out.indexOf("</img>") < 0
      ? pass("no stray </img> — img is treated as a void element")
      : fail("the balancer emitted </img>, which ProseMirror reads as a spurious break");

    // data: is refused. An SVG data URL carries executable script, and a
    // base64 image would ride the draft body through every autosave.
    const dataUrl = toEditorHtml('<p>A</p><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x"><p>B</p>', true);
    dataUrl.indexOf("<img") < 0
      ? pass("a data: image URL is refused")
      : fail(`a data: URL survived sanitising: ${dataUrl}`);
    const js = toEditorHtml('<p>A</p><img src="javascript:alert(1)" alt="x"><p>B</p>', true);
    js.indexOf("javascript:") < 0
      ? pass("a javascript: image URL is refused")
      : fail("a javascript: URL survived sanitising");

    // The negative control: dropping the img must not glue its neighbours.
    /Before|A/.test(dataUrl) && /After|B/.test(dataUrl)
      ? pass("dropping an image leaves the prose either side intact")
      : fail("removing an image damaged the surrounding text");
  }

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main();
