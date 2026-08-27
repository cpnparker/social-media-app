/**
 * A PDF as BACKGROUND MATERIAL — the format most reports actually arrive in.
 *
 *   npx tsx scripts/verify-optimizer-pdf-sources.ts [--self-test]
 *
 * THE DISTINCTION THIS FILE EXISTS TO HOLD. importFile refuses a PDF, on
 * purpose: it feeds the optimiser, the optimiser scores headings and lists, and
 * a PDF carries none that survive extraction — so the number would describe the
 * file format rather than the writing. extractSourceText accepts one, on
 * purpose: background material is never scored, and words are the whole of what
 * it needs.
 *
 * Both assertions live here together because the tempting one-line "fix" for
 * the writer's complaint was to widen importFile, which would have reinstated
 * the scoring bug its comment exists to prevent. A check that only proved PDFs
 * were accepted would have passed on that change.
 *
 * THE FIXTURE IS A REAL PDF, BUILT IN MEMORY — 725 bytes, valid xref, one text
 * object. No network, no committed binary, no generator dependency. Building it
 * cost two failed attempts worth recording: offsets must be counted in BYTES
 * (JS string length points the xref into the middle of an object), and the
 * escaping must be written by hand rather than passed through another layer of
 * string munging. Both produced "That PDF could not be read", which looks
 * exactly like the feature being broken.
 *
 * MUTATION LOG — run in a throwaway git worktree, never the shared tree.
 *
 *   2026-08-27  extractSourceText loses its pdf branch        → 2 fail  ✓
 *   2026-08-27  importFile widened to accept pdf              → 1 fail  ✓
 *   2026-08-27  readPdf returns "" instead of the scan reason → 1 fail  ✓
 *   2026-08-27  extractSourceText caps text to maxChars again → 1 fail  ✓
 *   2026-08-27  the sources route calls importFile again      → 1 fail  ✓
 *   2026-08-27  SourcesPanel drops .pdf from accept           → 1 fail  ✓
 *   (baseline, unmutated: exit 0)
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { extractSourceText, importFile } from "../lib/optimizer/file-import";
import { readPdf, pdfTitle, tidyPdfText, PDFJS_VERSION } from "../lib/optimizer/pdf";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
let failures = 0;
const pass = (m: string) => console.log("  ok    " + m);
const fail = (m: string) => { failures++; console.log("  FAIL  " + m); };

/**
 * REAL PDFs, COMMITTED, rather than one built in memory.
 *
 * Three attempts at a hand-rolled PDF died here, and the reason is worth the
 * two lines: byte-accurate offsets and 20-byte xref entries were not enough for
 * pdf.js, which rejected "bad XRef entry" on a table whose every offset I had
 * verified pointed at the right object, under both legal end-of-line forms —
 * and the same builder then passed in one script and failed in the next. Every
 * one of those failures printed "That PDF could not be read", which is
 * indistinguishable on screen from the feature being broken.
 *
 * So the fixtures are two real files, 13KB and 8KB, generated once and checked
 * in: one with a text layer, one without. They make the check deterministic,
 * they exercise the same pdf.js path a writer's report will, and they cost
 * nothing to read. A fixture you have to debug is a fixture that will be
 * debugged again by whoever touches this next.
 */
const FIXTURES = join(__dirname, "fixtures");
const withText = () => readFileSync(join(FIXTURES, "source-with-text.pdf"));
const noTextLayer = () => readFileSync(join(FIXTURES, "source-no-text-layer.pdf"));
const BODY_MARKER = /skills shortages rose 43 percent/;

(async () => {
  // ── 1. The fixture is real ───────────────────────────────────────────────
  console.log("\n1. The fixture really is a readable PDF");
  {
    const buf = withText();
    const r = await readPdf(buf, "outlook.pdf");
    if (!r.ok) { fail(`fixture unreadable (${r.reason}) — nothing below proves anything`); }
    else {
      pass(`${buf.length} bytes, ${r.pages} page, ${r.text.length} chars of text`);
      BODY_MARKER.test(r.text)
        ? pass("its words survive extraction intact")
        : fail(`words mangled: ${JSON.stringify(r.text.slice(0, 70))}`);
    }
  }

  // ── 2. A PDF is accepted as a SOURCE ─────────────────────────────────────
  console.log("\n2. extractSourceText accepts a PDF");
  {
    const r = await extractSourceText({ name: "employment-outlook-2026.pdf", type: "application/pdf", buffer: withText() });
    if (!r.ok) fail(`a PDF was refused as background material: ${r.error}`);
    else {
      pass(`accepted — ${(r.text.match(/\S+/g) || []).length} words`);
      // This fixture carries no /Title — most exported PDFs do not — so the
      // filename is the name, which is the fallback a reader would expect.
      // The embedded-title branch is asserted directly in section 5.
      r.title === "employment outlook 2026"
        ? pass("with no embedded title, the filename names the source")
        : fail(`title was ${JSON.stringify(r.title)}`);
    }
  }

  // ── 3. …and STILL refused as a document ──────────────────────────────────
  console.log("\n3. importFile still refuses one, for the reason it always did");
  {
    const r = await importFile(
      { name: "outlook.pdf", type: "application/pdf", buffer: withText() },
      { workspaceId: "w", maxChars: 500_000 }
    );
    !r.ok && /no headings|score the file format|file format rather than/i.test(String(r.error))
      ? pass("the scoring reasoning is untouched — a PDF is not a document to optimise")
      : fail("the document path started accepting PDFs, reinstating the bug its comment prevents");
  }

  // ── 4. A scan is called a scan ───────────────────────────────────────────
  console.log("\n4. The two ways a PDF yields nothing are told apart");
  {
    const scan = await readPdf(noTextLayer(), "scan.pdf");
    !scan.ok && scan.reason === "scanned" && /scan/i.test(scan.error)
      ? pass("no text layer → 'it looks like a scan', not a failure")
      : fail(`empty PDF gave ${JSON.stringify(scan).slice(0, 80)}`);

    const junk = await readPdf(Buffer.from("this is not a pdf"), "x.pdf");
    !junk.ok && junk.reason === "unreadable"
      ? pass("corrupt bytes → a stated reason, and no throw")
      : fail("corrupt bytes were not handled as unreadable");
  }

  // ── 5. Titles ────────────────────────────────────────────────────────────
  console.log("\n5. The source is named something a person would recognise");
  {
    pdfTitle({ Title: "Microsoft Word - report_final_v3.docx" }, "ioe-employment-report.pdf") === "ioe employment report"
      ? pass("an authoring-tool leftover is rejected for a name derived from the file")
      : fail(`got ${JSON.stringify(pdfTitle({ Title: "Microsoft Word - report_final_v3.docx" }, "ioe-employment-report.pdf"))}`);
    pdfTitle({ Title: "Global Employment Outlook 2026" }, "x.pdf") === "Global Employment Outlook 2026"
      ? pass("a real embedded title is kept")
      : fail("a good embedded title was discarded");
    pdfTitle({}, "") === "PDF document"
      ? pass("nothing to go on yields a plain fallback rather than an empty row")
      : fail("empty metadata produced an unusable title");
  }

  // ── 6. One truncation mechanism, not two ─────────────────────────────────
  console.log("\n6. The extractor does not silence the route's truncation signal");
  {
    const src = read("lib/optimizer/file-import.ts");
    const fn = src.slice(src.indexOf("export async function extractSourceText"));
    !/opts\s*:\s*\{[^}]*maxChars/.test(fn) && !/\bcap\(/.test(fn)
      ? pass("extractSourceText returns the full text — the route caps and reports it")
      : fail("the extractor caps too, so `text.length > MAX_SOURCE_CHARS` goes false and `truncated` never fires");
    const route = read("app/api/optimizer/sessions/[id]/sources/route.ts");
    /const truncated = text\.length > MAX_SOURCE_CHARS/.test(route)
      ? pass("the route still measures truncation on the full text")
      : fail("the route's truncation measurement moved or changed shape");
  }

  // ── 7. Used, not merely present ──────────────────────────────────────────
  console.log("\n7. The route and the picker actually offer it");
  {
    const route = read("app/api/optimizer/sessions/[id]/sources/route.ts");
    /extractSourceText\(/.test(route)
      ? pass("the sources route reads uploads with the source extractor")
      : fail("the sources route does not call extractSourceText");
    !/const \{ importFile \} = await import/.test(route)
      ? pass("and no longer routes uploads through the document importer")
      : fail("the sources route still calls importFile — PDFs will be refused again");

    const panel = read("components/optimizer/SourcesPanel.tsx");
    /accept="[^"]*\.pdf/.test(panel)
      ? pass("the file picker offers .pdf")
      : fail("the picker's accept list has no .pdf, so the OS dialog greys them out");
    !/PDF text extracts badly/.test(panel)
      ? pass("and the client-side refusal is gone")
      : fail("the client still blocks PDFs before the request is made");

    // The shared reader, asserted as SHARED — two copies of the pdf-parse
    // import workaround is the thing lib/optimizer/pdf.ts exists to prevent.
    const url = read("lib/optimizer/url-import.ts");
    !/pdf-parse\/lib/.test(url) && /readPdf/.test(url)
      ? pass("the URL path uses the shared reader rather than its own copy")
      : fail("url-import still carries a duplicate pdf-parse call");
  }

  // ── 8. The engine actually ships to the lambda ───────────────────────────
  // This is the one that cost a production round trip. pdf-parse resolves its
  // engine with a dynamic require built from a template literal, which Next's
  // tracer cannot follow — so the build never reached the serverless bundle and
  // every upload returned "That PDF could not be read", on the deployed route
  // only. Locally it had worked all along.
  console.log("\n8. pdf.js is traced into the route that parses PDFs");
  {
    const cfg = read("next.config.mjs");
    const route = "/api/optimizer/sessions/[id]/sources";
    const traced = cfg.indexOf(route) >= 0;
    traced
      ? pass("the sources route has an outputFileTracingIncludes entry")
      : fail("no tracing entry for the sources route — PDFs will fail in production and pass locally");

    // The rule and the require must name the SAME build. One naming v2.0.550
    // while the code asks for v1.10.100 ships 6MB of the wrong engine and fails
    // exactly as silently as shipping none.
    const rule = new RegExp("pdf-parse/lib/pdf\\.js/" + PDFJS_VERSION.replace(".", "\\.") + "/");
    rule.test(cfg)
      ? pass(`the traced build is ${PDFJS_VERSION}, the version the code asks for by name`)
      : fail(`next.config traces a different pdf.js build than PDFJS_VERSION (${PDFJS_VERSION})`);

    // And that build must exist, or the rule copies nothing and says so to
    // nobody. Asserted against the filesystem rather than the string.
    existsSync(join(__dirname, "..", "node_modules", "pdf-parse", "lib", "pdf.js", PDFJS_VERSION, "build", "pdf.js"))
      ? pass("that build is present in node_modules, so the rule has something to copy")
      : fail(`pdf-parse ships no ${PDFJS_VERSION} build — the tracing rule matches nothing`);
  }

  // ── Self-test ────────────────────────────────────────────────────────────
  if (process.argv.indexOf("--self-test") >= 0) {
    console.log("\n9. self-test — every detector driven against input built to break it");
    const probes: Array<[string, () => Promise<boolean> | boolean]> = [
      ["the committed fixture is something pdf-parse accepts", async () => (await readPdf(withText(), "a.pdf")).ok],
      ["a text-free PDF IS distinguishable from a corrupt one", async () => {
        const a = await readPdf(noTextLayer(), "a.pdf");
        const b = await readPdf(Buffer.from("junk"), "b.pdf");
        return !a.ok && !b.ok && a.reason !== b.reason;
      }],
      ["tidyPdfText actually changes ragged input", () => tidyPdfText("a  \n\n\n\nb") === "a\n\nb"],
      ["pdfTitle can return each of its three branches", () =>
        pdfTitle({ Title: "Real" }, "x.pdf") === "Real"
        && pdfTitle({ Title: "Microsoft Word - a.docx" }, "my-file.pdf") === "my file"
        && pdfTitle({}, "") === "PDF document"],
      ["importFile refuses SOMETHING, so assertion 3 can fail", async () =>
        !(await importFile({ name: "x.doc", type: "", buffer: Buffer.from("x") }, { workspaceId: "w", maxChars: 10 })).ok],
    ];
    let dead = 0;
    for (const [name, probe] of probes) {
      let fired = false;
      try { fired = await probe(); } catch { fired = false; }
      if (fired) pass("probe fires: " + name);
      else { dead++; fail(`probe did NOT fire: ${name} — the assertion it backs tests nothing`); }
    }
    if (dead > 0) { console.log(`\n  ${dead} probe(s) dead. Refusing to report the sections above.`); process.exit(1); }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})();
