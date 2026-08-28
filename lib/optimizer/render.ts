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

/**
 * A place on the rendered page that an audit finding can point at.
 *
 * Coordinates are DOCUMENT pixels at the render viewport width, so they map
 * onto a full-page screenshot taken at the same width by simple scaling. The
 * alternative — viewport coordinates — is meaningless the moment the page
 * scrolls, and the page is scrolled to the bottom and back before this runs.
 */
export interface RenderSpot {
  /** What kind of thing this is, which is how a finding claims it. */
  kind: "h1" | "heading" | "image-no-alt" | "image" | "date" | "faq" | "first-paragraph";
  x: number;
  y: number;
  w: number;
  h: number;
  /** A few words of the element, so a report can say WHICH one it means. */
  label: string;
}

/** A full-page screenshot, already scaled and encoded for a page to render. */
export interface RenderShot {
  /** data:image/jpeg;base64,… */
  dataUri: string;
  /** Pixel size of the IMAGE, after scaling. */
  width: number;
  height: number;
  /** Document height at the render width, before any clipping. Bigger than
   *  `height / scale` means the page was taller than the capture cap. */
  documentHeight: number;
  /** image pixels per document pixel, so a spot can be placed on it. */
  scale: number;
  /** True when the page was taller than the cap and the tail is missing. Said,
   *  never hidden: a report whose picture silently stops is a report that
   *  claims to have looked at a page it only half saw. */
  clipped: boolean;
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
  /** Null when no screenshot was asked for, or when capture failed — which is
   *  never fatal: an audit without a picture is still an audit. */
  shot: RenderShot | null;
  spots: RenderSpot[];
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
  shot: null, spots: [],
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
/**
 * The widest a capture is scaled to. 900 is a compromise measured against what
 * it is for: wide enough that a heading is legible in a printed report, narrow
 * enough that a tall page stays inside a response.
 */
export const SHOT_WIDTH = 900;

/**
 * The tallest document a capture covers, in render pixels.
 *
 * Chromium refuses past roughly 16,000, and long before that a JPEG of a
 * 30,000-pixel page is both unreadable and too large to send. A page past this
 * is captured to the cap and SAYS the tail is missing.
 */
export const SHOT_MAX_HEIGHT = 7200;

export async function renderPage(
  url: string,
  timeoutMs = 20_000,
  opts?: { shot?: boolean }
): Promise<RenderOutcome> {
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
        docHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        spots: (() => {
          const out = [];
          const push = (el, kind) => {
            const r = el.getBoundingClientRect();
            const y = r.top + window.scrollY;
            const x = r.left + window.scrollX;
            // A zero-sized or off-canvas element has no place on a picture.
            if (r.width < 4 || r.height < 4) return;
            if (y < 0 || x < -50) return;
            const text = (el.innerText || el.getAttribute("alt") || el.getAttribute("src") || "").replace(/\s+/g, " ").trim();
            out.push({ kind: kind, x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), label: text.slice(0, 90) });
          };
          Array.prototype.slice.call(document.querySelectorAll("h1")).forEach((el) => push(el, "h1"));
          Array.prototype.slice.call(document.querySelectorAll("h2, h3")).forEach((el) => push(el, "heading"));
          Array.prototype.slice.call(document.querySelectorAll("img")).forEach((el) => {
            const alt = el.getAttribute("alt");
            push(el, alt === null || alt.trim() === "" ? "image-no-alt" : "image");
          });
          Array.prototype.slice.call(document.querySelectorAll("time, [datetime], .date, .published")).slice(0, 3).forEach((el) => push(el, "date"));
          const faq = document.querySelector('[class*="faq" i], [id*="faq" i], details');
          if (faq) push(faq, "faq");
          const firstP = root ? root.querySelector("p") : document.querySelector("p");
          if (firstP) push(firstP, "first-paragraph");
          return out;
        })(),
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

    /**
     * The picture, and only when asked for.
     *
     * Taken AFTER the measurement pass, which has already scrolled the page to
     * the bottom and back: lazy images are loaded by then, so the capture shows
     * the page a reader sees rather than a column of grey placeholders.
     *
     * Failure here is never fatal. An audit without a picture is still an
     * audit, and losing every check because a screenshot timed out would be a
     * poor trade.
     */
    let shot: RenderShot | null = null;
    if (opts?.shot) {
      try {
        /**
         * Hide the consent overlay before the picture is taken.
         *
         * A cookie banner is not part of the page being audited: it is a fixed
         * sheet that covers the bottom third of the first screen, and a client
         * report whose picture is half consent dialogue looks careless and
         * hides the content the findings are about. Observed on the first real
         * capture.
         *
         * NARROW ON PURPOSE. Only elements that are BOTH fixed-position AND
         * named as consent are hidden. Hiding every fixed element would take
         * the site's own header with it, which is part of the page and is
         * exactly what one of the checks is about. Nothing is removed from the
         * DOM: the measurement pass has already run, so this cannot change a
         * single finding.
         */
        await page.evaluate(`(() => {
          const SEL = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[aria-label*="cookie" i],[data-testid*="cookie" i]';
          const els = Array.prototype.slice.call(document.querySelectorAll(SEL));
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const pos = getComputedStyle(el).position;
            if (pos === "fixed" || pos === "sticky") el.style.setProperty("display", "none", "important");
          }

          /**
           * Scroll-reveal sections, made visible.
           *
           * Pages that fade their sections in on scroll leave a full-page
           * capture full of empty bands: the element is in the document, has
           * height, and is painted at opacity 0 because its reveal either fired
           * for a viewport position the capture does not share, or ran while
           * the page was being scrolled past at speed. The first real report
           * had three of these, and a client report with blank thirds in it
           * looks like a broken tool rather than a page with problems.
           *
           * This shows what is ALREADY IN THE PAGE. It does not add content, it
           * does not change the DOM the measurement pass already read, and it
           * runs after every finding has been computed. Only elements that are
           * invisible AND carry text are touched, so a decorative hidden layer
           * stays hidden.
           */
          const anim = document.createElement("style");
          anim.textContent = "*,*::before,*::after{animation:none !important;transition:none !important;}";
          document.head.appendChild(anim);

          // HEADINGS INCLUDED, and that omission is why this is a list rather
          // than a shrug: the first version listed containers and paragraphs
          // only, so a page whose section headings fade in on scroll produced
          // numbered boxes around visibly nothing. Measured on the live page:
          // every h2 sat at opacity 0 with no transform and no clip path, so
          // the loop below was right and its selector was wrong.
          const all = Array.prototype.slice.call(document.querySelectorAll(
            "h1,h2,h3,h4,h5,h6,section,div,article,header,figure,li,p,span,a,blockquote,figcaption"
          ));
          for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const cs = getComputedStyle(el);
            if (parseFloat(cs.opacity) > 0.05) continue;
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            if (!(el.textContent || "").trim() && !el.querySelector("img")) continue;
            el.style.setProperty("opacity", "1", "important");
            el.style.setProperty("transform", "none", "important");
            el.style.setProperty("filter", "none", "important");
          }
        })()`);
        // One frame for the layout to settle after the styles above.
        await new Promise((r) => setTimeout(r, 350));

        const docHeight: number = Math.max(1, Math.round(measured.docHeight || 0));
        const captureHeight = Math.min(docHeight, SHOT_MAX_HEIGHT);
        const raw = (await page.screenshot({
          type: "jpeg",
          quality: 80,
          clip: { x: 0, y: 0, width: 1280, height: captureHeight, scale: 1 },
        })) as Buffer;
        const sharp = (await import("sharp")).default;
        const scale = SHOT_WIDTH / 1280;
        const resized = await sharp(raw)
          .resize({ width: SHOT_WIDTH })
          .jpeg({ quality: 72, mozjpeg: true })
          .toBuffer();
        shot = {
          dataUri: `data:image/jpeg;base64,${resized.toString("base64")}`,
          width: SHOT_WIDTH,
          height: Math.round(captureHeight * scale),
          documentHeight: docHeight,
          scale,
          clipped: docHeight > SHOT_MAX_HEIGHT,
        };
      } catch (e: any) {
        console.warn("[render] screenshot failed:", String(e?.message || e).slice(0, 120));
      }
    }

    await close();
    return {
      ok: true,
      shot,
      spots: (measured.spots || []) as RenderSpot[],
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
