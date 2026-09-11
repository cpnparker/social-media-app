/**
 * Guards the one thing this report exists to produce: a PDF someone sends to a
 * client.
 *
 * Run: npx tsx scripts/verify-optimizer-print.ts
 *
 * ── WHY THIS IS A BROWSER AND NOT A REGEX ───────────────────────────────────
 *
 * The print stylesheet shipped broken and the existing guard said it was fine.
 * That guard asserted the RULES EXISTED: a print stylesheet, an @page size, a
 * break-inside on a finding, a rule hiding the app's chrome. Every one of those
 * was present. The report still printed as one blank sheet, because the rule
 * hiding the chrome was
 *
 *     body > *:not(.audit-print-root) { display: none !important; }
 *
 * and the report is not a child of body. The shell wraps it three deep, so that
 * selector matched the report's own ANCESTOR and switched it off. Measured on
 * production: computed display of the shell "none", the report's rect 0x0,
 * document.body.innerText zero characters while the report held 5,727.
 *
 * This is the failure mode this repo has already paid for twice, written down
 * in CLAUDE.md: a check that proves a line was WRITTEN rather than that it
 * WORKS. There is no way to tell those apart by reading CSS. The selector is
 * correct or not only with respect to a DOM, so this check builds the DOM, puts
 * the real stylesheet on it, switches the browser into print media, and asks
 * what is actually left on the page.
 *
 * The stylesheet is EXTRACTED FROM THE COMPONENT rather than copied here. A
 * copy would drift, and a check passing against its own stale copy of the rules
 * is worse than no check.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * The self-test at the bottom is the mutation log: it re-injects the shipped
 * bug (the depth-dependent selector) and the two hazards beside it, and refuses
 * to report anything unless each one turns this check red.
 *
 * KILLED  body > *:not(.audit-print-root)  (the original blank page)
 * KILLED  the ancestor chain left as flex boxes with their own scrollers
 * KILLED  print-color-adjust removed
 * KILLED  the light-token override removed (dark mode printed white on white)
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/**
 * The print block, lifted out of the component that ships it.
 *
 * Brace-counted rather than regexed: the block contains nested rules and CSS
 * comments, and a lazy `[\s\S]*?}` stops at the first inner brace.
 */
export function extractPrintCss(source: string): string {
  const at = source.indexOf("@media print {");
  if (at < 0) return "";
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        // Inside a JS template literal, so backticks arrive escaped.
        return source.slice(at, i + 1).replace(/\\`/g, "`");
      }
    }
  }
  return "";
}

/**
 * A page shaped like the real one.
 *
 * The nesting is the whole point, so it mirrors what the app actually renders:
 * `.engine-ai-scope` from the shell, a flex row inside it, and the report's own
 * scroller three levels down. Siblings are planted at EVERY level, because the
 * rule has to hide the sidebar (a sibling of the report's parent) as well as
 * the chrome beside the shell, and a fixture with only one of them cannot tell
 * a working selector from a lucky one.
 */
export function fixtureHtml(printCss: string, findingCount = 24): string {
  const findings = Array.from({ length: findingCount }, (_, i) =>
    `<li class="audit-finding" style="height:120px;border:1px solid #ddd;margin:8px 0">
       <span class="badge" style="background:#ef4444;color:#fff">${i + 1}</span> Finding ${i + 1}
     </li>`
  ).join("");
  // The fixture runs in DARK MODE on purpose. The print block forces white
  // paper, and the report's own text is `text-foreground`; in dark mode that
  // resolves to near-white, so the two together printed white on white. A
  // light-mode fixture cannot see that at all.
  return `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; font: 14px system-ui; }
    :root { --foreground: 224 71% 4%; --muted-foreground: 220 9% 40%; --border: 220 13% 91%; }
    html.dark { --foreground: 210 20% 96%; --muted-foreground: 217 12% 65%; --border: 215 20% 22%; }
    .audit-report { color: hsl(var(--foreground)); }
    .muted { color: hsl(var(--muted-foreground)); }
    .engine-ai-scope { display: flex; height: 100vh; overflow: hidden; }
    .rail { width: 300px; background: #eee; }
    .col { flex: 1; min-height: 0; display: flex; }
    .audit-print-root { flex: 1; min-height: 0; overflow-y: auto; }
    ${printCss}
  </style></head><body>
    <script>var x = 1;</script>
    <div class="engine-ai-scope">
      <aside class="rail chrome-sibling-of-report-parent">SIDEBAR THAT MUST NOT PRINT</aside>
      <div class="col">
        <div class="audit-print-root">
          <div class="audit-report">
            <h1>REPORT TITLE MARKER</h1>
            <p class="muted">MUTED LINE</p>
            <button class="audit-no-print">CONTROL THAT MUST NOT PRINT</button>
            <ul>${findings}</ul>
            <footer>REPORT FOOTER MARKER</footer>
          </div>
        </div>
      </div>
    </div>
    <section class="chrome-sibling-of-shell">TOAST THAT MUST NOT PRINT</section>
  </body></html>`;
}

interface Probe {
  reportVisible: boolean;
  reportHeight: number;
  bodyScrollHeight: number;
  visibleText: string;
  printRootOverflowY: string;
  colorAdjust: string;
  reportColor: string;
  mutedColor: string;
  chromeDisplays: string[];
}

/** What is actually left on the page once the browser is in print media. */
async function probe(page: any): Promise<Probe> {
  return await page.evaluate(`(() => {
    const rep = document.querySelector('.audit-report');
    const r = rep ? rep.getBoundingClientRect() : { width: 0, height: 0 };
    const pr = document.querySelector('.audit-print-root');
    const badge = document.querySelector('.badge');
    const chrome = ['.chrome-sibling-of-shell', '.chrome-sibling-of-report-parent', '.audit-no-print'];
    return {
      reportVisible: r.width > 0 && r.height > 0,
      reportHeight: Math.round(r.height),
      bodyScrollHeight: document.body.scrollHeight,
      visibleText: document.body.innerText,
      printRootOverflowY: pr ? getComputedStyle(pr).overflowY : 'missing',
      reportColor: rep ? getComputedStyle(rep).color : '',
      mutedColor: (() => { const m = document.querySelector('.muted'); return m ? getComputedStyle(m).color : ''; })(),
      colorAdjust: badge ? (getComputedStyle(badge).printColorAdjust || getComputedStyle(badge).webkitPrintColorAdjust || '') : '',
      chromeDisplays: chrome.map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'absent'; }),
    };
  })()`);
}

async function main() {
  const exe =
    process.env.CHROME_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(exe)) {
    // Not looking and finding nothing are different claims. A print check that
    // silently skips is exactly the "reads as a pass" failure it exists to stop.
    console.log(`\n✗ cannot run: no Chrome at ${exe}. Set CHROME_EXECUTABLE_PATH.\n`);
    process.exit(1);
  }

  const printCss = extractPrintCss(read("components/optimizer/AuditReport.tsx"));
  console.log("\n1. The stylesheet under test");
  assert(printCss.length > 0, "the print block is read out of the component that ships it, not copied here");
  assert(/@page/.test(printCss), "and carries a page size");

  const puppeteer = (await import("puppeteer-core")).default as any;
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });

  const run = async (css: string): Promise<Probe> => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(fixtureHtml(css), { waitUntil: "load" });
    await page.emulateMediaType("print");
    const out = await probe(page);
    await page.close();
    return out;
  };

  try {
    console.log("\n2. What survives into print");
    const p = await run(printCss);
    assert(p.reportVisible, `the report is on the printed page at all (${p.reportHeight}px tall)`);
    assert(p.visibleText.indexOf("REPORT TITLE MARKER") >= 0, "its title is there");
    assert(p.visibleText.indexOf("REPORT FOOTER MARKER") >= 0, "and so is the end of it, which is the half a clipped scroller loses");

    console.log("\n3. Nothing is clipped to one screen");
    // The report is ~24 findings at 120px, far taller than the 800px viewport.
    assert(p.reportHeight > 1600, `the fixture report is genuinely taller than the viewport (${p.reportHeight}px vs 800px), or this proves nothing`);
    assert(p.printRootOverflowY === "visible", `the report's own scroller is neutralised (overflow-y: ${p.printRootOverflowY})`);
    assert(p.bodyScrollHeight >= p.reportHeight, `the document grows to the whole report, so the browser paginates all of it (body ${p.bodyScrollHeight} vs report ${p.reportHeight})`);

    console.log("\n4. The app is not in the document");
    assert(p.chromeDisplays[0] === "none", "chrome beside the shell is gone");
    assert(p.chromeDisplays[1] === "none", "the sidebar next to the report is gone");
    assert(p.chromeDisplays[2] === "none", "and so are the report's own controls");
    assert(p.visibleText.indexOf("MUST NOT PRINT") < 0, "no chrome text reaches the page");

    console.log("\n5. The colours survive");
    assert(p.colorAdjust === "exact", `status colours are forced through (print-color-adjust: ${p.colorAdjust || "unset"})`);

    console.log("\n6. Printed from dark mode, it is still a light document");
    // The paper is forced white, so any text that stayed light is invisible.
    // Luminance rather than an exact colour: the point is dark-on-white, not
    // one particular hex.
    const lum = (css: string): number => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m) return -1;
      const [r, g, b] = m[1].split(",").map((n) => parseFloat(n) / 255);
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    assert(lum(p.reportColor) >= 0, `precondition: the fixture is in dark mode and a colour was read back (${p.reportColor})`);
    assert(lum(p.reportColor) < 0.2, `the report's body text prints dark on white paper (${p.reportColor})`);
    assert(lum(p.mutedColor) < 0.35, `and so does its muted text (${p.mutedColor})`);

    // ── Self-test: put the shipped bug back and require this check to catch it
    console.log("\n── self-test: each detector against the bug it exists to catch ──");
    const broken = printCss.replace(
      /:has\(\.audit-print-root\) > \*:not\(:has\(\.audit-print-root\)\):not\(\.audit-print-root\) \{ display: none !important; \}/,
      "body > *:not(.audit-print-root) { display: none !important; }"
    );
    assert(broken !== printCss, "precondition: the original depth-dependent selector could be reinjected");
    const b1 = await run(broken);
    assert(!b1.reportVisible || b1.visibleText.indexOf("REPORT TITLE MARKER") < 0,
      "fires on the selector that assumes the report is a child of body (the blank PDF)");

    const noUnwrap = printCss.replace(/overflow: visible !important;/g, "");
    assert(noUnwrap !== printCss, "precondition: the overflow unwrapping could be removed");
    const b2 = await run(noUnwrap);
    assert(b2.printRootOverflowY !== "visible" || b2.bodyScrollHeight < b2.reportHeight,
      "fires on the report being left inside its own scroller (one screenful printed, silently)");

    const noColor = printCss.replace(/print-color-adjust: exact !important;/g, "");
    assert(noColor !== printCss, "precondition: the colour rule could be removed");
    const b3 = await run(noColor);
    assert(b3.colorAdjust !== "exact", "fires on the status colours being left to the browser to drop");

    const noTokens = printCss.replace(/--foreground: 224 71% 4%;/, "");
    assert(noTokens !== printCss, "precondition: the light-token override could be removed");
    const b4 = await run(noTokens);
    assert(lum(b4.reportColor) >= 0.2, "fires on a dark-mode print coming out white on white");
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\n✓ the report prints\n" : `\n✗ ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
