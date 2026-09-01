import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { draftPreview } from "@/lib/slides/preview-model";
import { deckToHtml } from "@/lib/slides/pdf-html";

/**
 * POST /api/slides/pdf — the deck draft as a 16:9 PDF, without Google.
 *
 * The other export path creates a Google Slides file in the user's Drive; this
 * one prints the SAME preview model the chat shows, on the master template's
 * 10 × 5.625 in page, using the headless Chromium this app already runs for
 * the optimizer's page audits. One drawing, three consumers: the chat preview,
 * the Slides build, and this print.
 *
 * Auth-only and spec-in, like /api/slides/preview: the caller already holds
 * the draft, and re-deriving the preview here — rather than trusting a
 * client-rendered picture — keeps the print identical to what a fresh preview
 * would show.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { slides?: any[]; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(body.slides) || !body.slides.length) {
    return NextResponse.json({ error: "No slides" }, { status: 400 });
  }
  if (body.slides.length > 80) {
    return NextResponse.json({ error: "Too many slides for one PDF" }, { status: 400 });
  }
  const title = String(body.title || "Presentation").slice(0, 120);

  const { preview } = draftPreview(body.slides);
  const html = deckToHtml(preview, title);

  // The same launch path the optimizer's audit render uses — @sparticuz
  // chromium on Vercel, the local Chrome in development.
  const onVercel = !!process.env.VERCEL;
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
    executablePath = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    args = ["--no-sandbox", "--disable-dev-shm-usage"];
  }

  let browser: any = null;
  try {
    browser = await puppeteer.launch({ executablePath, args, headless });
    const page = await browser.newPage();
    // "load", not "networkidle0": idle never arrives when a font or image host
    // stalls, and a deck that prints with fallback serifs beats a request that
    // times out whole. The fonts get a bounded wait of their own below.
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    // The fonts are the brand; a PDF that raced them prints Georgia headlines.
    // Bounded, because they are also a network dependency.
    await Promise.race([
      page.evaluateHandle("document.fonts.ready"),
      new Promise((r) => setTimeout(r, 8_000)),
    ]);
    // Give late images one bounded beat too — the deck's photographs are blob
    // URLs that usually arrive well inside this.
    await page
      .evaluate(
        `Promise.all(Array.from(document.images).filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; })))`
      )
      .catch(() => {});
    const pdf = await page.pdf({
      width: "10in",
      height: "5.625in",
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    const filename = `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "deck"}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[Slides PDF] render failed:", e?.message);
    return NextResponse.json({ error: `PDF render failed: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
