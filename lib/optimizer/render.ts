/**
 * The technical render — the page as a BROWSER builds it, not as the server
 * shipped it.
 *
 * WHY THIS EXISTS, and why the raw fetch is still the primary source.
 *
 * The audit's question is "what can a machine cite from this page", and the
 * machines that matter here mostly DO NOT EXECUTE JAVASCRIPT. GPTBot, ClaudeBot
 * and PerplexityBot fetch HTML and read it; they do not run a React hydration
 * pass and wait for an XHR to resolve. So the RAW HTML is the authoritative
 * view of what an AI crawler sees, and it stays the primary input to every
 * check in page-audit.ts.
 *
 * The render is here for the COMPARISON. Content that exists only after
 * JavaScript runs is invisible to those crawlers, and the gap between the two
 * views is the finding — arguably the single highest-value thing this audit can
 * report, because it is invisible from the page itself and catastrophic when it
 * is large. A React SPA that renders 2,000 words into an empty <div id="root">
 * is, to an AI crawler, a blank page; nothing in its own HTML says so.
 *
 * It also answers things only a browser knows: which images actually resolved,
 * what their natural dimensions are, and whether a lazy-loaded image ever
 * arrives at all.
 *
 * SSRF: a headless browser pointed at a user-supplied URL is a hole straight
 * through lib/net/safe-fetch. The whole point of safeFetch is that every
 * redirect hop is address-checked before it is contacted; a browser follows
 * redirects, fetches subresources and honours meta-refresh entirely on its own.
 * So this module re-applies the SAME classifier via request interception: the
 * initial URL is checked before launch, and EVERY request the page makes is
 * checked before it is allowed to proceed. Blocked requests are counted and
 * reported rather than swallowed.
 *
 * HONESTY: when the render cannot run — no browser binary, a launch failure, a
 * timeout — this returns ok:false WITH A REASON, and the audit says the render
 * did not run. It must never report "no JavaScript gap" when the truth is
 * "nobody looked". That distinction is the whole difference between an audit
 * and a guess.
 */

import { destinationIsPublicForTest } from "@/lib/net/safe-fetch";

export interface RenderedImage {
  src: string;
  alt: string | null;
  /** Rendered box, CSS pixels. 0 when the image never resolved. */
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  loaded: boolean;
  lazy: boolean;
  /** True when the <img> sits inside the main/article content region. */
  inContent: boolean;
}

export interface RenderOutcome {
  ok: boolean;
  /** Serialized final DOM. Null when the render did not run. */
  html: string | null;
  finalUrl: string | null;
  /** Why the render did not run. Null on success. */
  reason: string | null;
  /** Requests refused by the address fence — a page pulling from an internal
   *  host is worth surfacing, not hiding. */
  blockedRequests: number;
  images: RenderedImage[];
  /** innerText word count of the rendered body — the "after JS" measure. */
  renderedWords: number;
  /** Same, restricted to the content region. */
  contentWords: number;
  headings: { h1: number; h2: number; h3: number };
  jsonLdBlocks: number;
  renderMs: number;
}

/**
 * What the address fence should do with one request URL, as a pure function so
 * a check can drive it without a browser.
 *
 *  "inert"  — data:, blob:, about:. No network, no host, nothing to check.
 *             These MUST NOT count as refusals: they have an empty hostname,
 *             the classifier rejected them, and every inline SVG therefore
 *             incremented the refusal count — which makes the js-dependency
 *             check withhold its verdict. The headline finding switched itself
 *             off on most of the modern web, and looked fine because the one
 *             page it was built against uses none.
 *  "check"  — http/https. Ask the classifier, as safeFetch does.
 *  "refuse" — everything else (file:, ftp:, chrome-extension:). Refused AND
 *             counted, which is exactly what the fence is for.
 */
export function fenceDecision(rawUrl: string): "inert" | "check" | "refuse" {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return "refuse"; }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return "inert";
  if (u.protocol === "http:" || u.protocol === "https:") return "check";
  return "refuse";
}

const FAILED = (reason: string): RenderOutcome => ({
  ok: false, html: null, finalUrl: null, reason,
  blockedRequests: 0, images: [], renderedWords: 0, contentWords: 0,
  headings: { h1: 0, h2: 0, h3: 0 }, jsonLdBlocks: 0, renderMs: 0,
});

/** Where to find a Chrome. On Vercel that is the bundled sparticuz build; in
 *  local dev it is whatever Chrome the developer already has. Resolved lazily
 *  so importing this module never drags Chromium into an unrelated bundle. */
async function launchBrowser(): Promise<{ browser: any; close: () => Promise<void> } | { error: string }> {
  const onVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  try {
    const puppeteer = (await import("puppeteer-core")).default as any;
    let executablePath: string | undefined;
    let args: string[] = [];
    let headless: any = true;

    if (onVercel) {
      const chromium = (await import("@sparticuz/chromium")).default as any;
      executablePath = await chromium.executablePath();
      args = chromium.args;
      headless = chromium.headless;
    } else {
      executablePath =
        process.env.CHROME_EXECUTABLE_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      args = ["--no-sandbox", "--disable-dev-shm-usage"];
    }
    if (!executablePath) return { error: "no Chrome binary available in this environment" };

    const browser = await puppeteer.launch({ executablePath, args, headless });
    return { browser, close: () => browser.close() };
  } catch (e: any) {
    return { error: `browser launch failed: ${String(e?.message || e).slice(0, 160)}` };
  }
}

/**
 * Render `url` and report the final DOM. Never throws — a render that cannot
 * happen is a reported outcome, not an exception, because the audit around it
 * must still deliver its raw-HTML findings.
 */
export async function renderPage(url: string, timeoutMs = 20_000): Promise<RenderOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return FAILED("not a URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return FAILED(`unsupported scheme ${parsed.protocol}`);
  }
  if (!(await destinationIsPublicForTest(parsed.hostname))) {
    return FAILED("destination is not a public address");
  }

  const started = Date.now();
  const launched = await launchBrowser();
  if ("error" in launched) return FAILED(launched.error);
  const { browser, close } = launched;

  let blockedRequests = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 2400 });
    // Identify honestly. A page that serves different HTML to a crawler is
    // itself a finding, and pretending to be Chrome would hide it.
    await page.setUserAgent(
      "Mozilla/5.0 (compatible; EngineAI-Audit/1.0; +https://ai.thecontentengine.com) Chrome/131.0.0.0"
    );

    // The address fence, re-applied per request. A browser follows redirects
    // and pulls subresources on its own, so checking only the entry URL would
    // leave exactly the hole safeFetch exists to close.
    await page.setRequestInterception(true);
    page.on("request", async (req: any) => {
      try {
        const decision = fenceDecision(req.url());
        if (decision === "inert") { req.continue(); return; }
        if (decision === "refuse") { blockedRequests++; req.abort(); return; }
        const host = new URL(req.url()).hostname;
        if (await destinationIsPublicForTest(host)) req.continue();
        else { blockedRequests++; req.abort(); }
      } catch {
        blockedRequests++;
        try { req.abort(); } catch { /* already handled */ }
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });

    // Lazy images below the fold never load at their natural size unless the
    // page is scrolled. Without this the render reports most images as "never
    // loaded", which is a wrong verdict about a perfectly healthy page.
    // Browser-side code is passed as a STRING, not a function, deliberately.
    // esbuild (which tsx and therefore every verify script here uses) injects a
    // `__name` helper into compiled functions; puppeteer serializes the function
    // source and evaluates it in a page that has no such helper, so a function
    // form dies with "__name is not defined". It works under Next's SWC build
    // and fails under tsx — the worst possible split, because the check that is
    // supposed to prove this module works could not run it.
    await page.evaluate(`(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
    })()`);

    const measured: any = await page.evaluate(`(() => {
      const CONTENT_SEL = "main, article, [role=main], #main, .main-content";
      const root = document.querySelector(CONTENT_SEL);
      const words = (t) => t.replace(/\\s+/g, " ").trim().split(" ").filter(Boolean).length;
      const imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
      return {
        html: document.documentElement.outerHTML,
        finalUrl: location.href,
        renderedWords: words(document.body.innerText || ""),
        contentWords: root ? words(root.innerText || "") : 0,
        headings: {
          h1: document.querySelectorAll("h1").length,
          h2: document.querySelectorAll("h2").length,
          h3: document.querySelectorAll("h3").length,
        },
        jsonLdBlocks: document.querySelectorAll('script[type="application/ld+json"]').length,
        images: imgs.map((i) => {
          const r = i.getBoundingClientRect();
          return {
            src: i.currentSrc || i.src || "",
            alt: i.hasAttribute("alt") ? i.getAttribute("alt") : null,
            width: Math.round(r.width),
            height: Math.round(r.height),
            naturalWidth: i.naturalWidth,
            naturalHeight: i.naturalHeight,
            loaded: i.complete && i.naturalWidth > 0,
            lazy: (i.getAttribute("loading") || "").toLowerCase() === "lazy" || i.hasAttribute("data-src"),
            inContent: !!root && root.contains(i),
          };
        }),
      };
    })()`);

    await close();
    return {
      ok: true,
      html: measured.html,
      finalUrl: measured.finalUrl,
      reason: null,
      blockedRequests,
      images: measured.images as RenderedImage[],
      renderedWords: measured.renderedWords,
      contentWords: measured.contentWords,
      headings: measured.headings,
      jsonLdBlocks: measured.jsonLdBlocks,
      renderMs: Date.now() - started,
    };
  } catch (e: any) {
    try { await close(); } catch { /* the browser may already be gone */ }
    const out = FAILED(`render failed: ${String(e?.message || e).slice(0, 160)}`);
    out.blockedRequests = blockedRequests;
    out.renderMs = Date.now() - started;
    return out;
  }
}
