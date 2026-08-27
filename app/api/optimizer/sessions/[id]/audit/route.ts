/**
 * POST /api/optimizer/sessions/[id]/audit — audit the LIVE page behind a
 * URL-imported session.
 *
 * Two layers in one response, because they answer different questions:
 *
 *  - the PAGE audit: title tag, schema, alt text, dates, canonical — the
 *    furniture the draft rubric deliberately does not score, checked against
 *    the page as it is published right now;
 *  - the CONTENT scores: the same deterministic rubric the editor runs, but
 *    computed over the live page's extracted text — so "how would this score
 *    if it were my draft" and "what is wrong with the page around it" sit
 *    side by side.
 *
 * The page is re-fetched on every run, deliberately: the whole point of
 * re-auditing is to see whether a fix went live, and a cached page would
 * report the past with today's timestamp. No model call — the audit is free,
 * so re-running it costs one fetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { fetchPageForAudit, extractArticleRegion } from "@/lib/optimizer/url-import";
import { toEditorHtml } from "@/lib/optimizer/import-html";
import { auditPage } from "@/lib/optimizer/page-audit";
import { renderPage } from "@/lib/optimizer/render";
import { safeFetch } from "@/lib/net/safe-fetch";
import { parseDraft } from "@/lib/optimizer/parse";
import { computeDraftScores } from "@/lib/optimizer/engine";

// The render launches a headless Chromium; a cold start plus a real page is
// comfortably more than the 30s the fetch-only audit needed.
export const maxDuration = 60;
// puppeteer-core and the Chromium binary must not be traced into the bundle by
// webpack — they are loaded at runtime from the serverless filesystem.
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session as any;

  if (session.type_source !== "url" || !session.document_source_ref) {
    return NextResponse.json(
      { error: "This piece was not imported from a URL, so there is no live page to audit." },
      { status: 400 }
    );
  }

  const fetched = await fetchPageForAudit(session.document_source_ref);
  if (!fetched.ok) return NextResponse.json({ error: fetched.error }, { status: 502 });

  // The render runs alongside, and is allowed to fail. The served HTML is the
  // authoritative view for an AI crawler, so a page whose render dies still
  // gets a complete audit — it just loses the JavaScript-gap comparison, and
  // says so rather than reporting a clean bill of health it never checked.
  const render = await renderPage(fetched.finalUrl).catch((e) => {
    return { ok: false, html: null, finalUrl: null, reason: `render threw: ${String(e).slice(0, 120)}`,
             blockedRequests: 0, images: [], renderedWords: 0, contentWords: 0,
             headings: { h1: 0, h2: 0, h3: 0 }, jsonLdBlocks: 0, renderMs: 0 };
  });

  // ── robots.txt and llms.txt ─────────────────────────────────────────────
  //
  // Fetched here, parsed in page-audit, which stays pure and fixture-driven.
  // Both are allowed to fail and BOTH FAIL TO NULL, never to "allowed": a 404,
  // a timeout or a refusal all mean we did not look, and the check renders that
  // differently from a clean bill of health.
  //
  // Through safeFetch like every other outbound request in this app — the host
  // comes from a caller-supplied URL, and a second unguarded fetch path is a
  // second SSRF surface only one of which any check would cover.
  const siteFile = async (path: string): Promise<string | null> => {
    try {
      const u = new URL(fetched.finalUrl);
      const res = await safeFetch(`${u.protocol}//${u.host}${path}`, { timeoutMs: 8000 });
      if (!res.ok) return null;
      const text = await res.text();
      // A site that serves its 404 page as 200 would otherwise be parsed as a
      // robots file; anything with markup in it is not one.
      if (/<html|<!doctype/i.test(text.slice(0, 400))) return null;
      return text.slice(0, 100_000);
    } catch {
      return null;
    }
  };
  const [robotsTxt, llmsTxt] = await Promise.all([siteFile("/robots.txt"), siteFile("/llms.txt")]);

  const canon = session.config_canon || {};
  const brief = session.config_brief || {};
  const brandNames = [canon.brandName, canon.publisherName].concat(canon.brandAliases || []).filter(Boolean);

  const audit = auditPage(
    {
      page: fetched.page,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.httpStatus,
      brandNames,
      targetQueries: brief.targetQueries || [],
      render,
      robotsTxt,
      llmsTxt,
    },
    new Date()
  );

  // The live page's text through the same rubric the editor runs. This is the
  // published reality, which can differ from the draft in the editor — the
  // whole reason the audit exists as a separate view.
  const liveHtml = toEditorHtml(extractArticleRegion(fetched.page), true);
  let liveScores: any = null;
  let liveWords = 0;
  try {
    const parsed = parseDraft({ body: liveHtml, title: session.name_title || "" });
    liveWords = parsed.wordCount;
    liveScores = computeDraftScores({
      body: liveHtml,
      title: session.name_title || "",
      targetQueries: brief.targetQueries || [],
      format: session.type_format || "explainer",
      brandName: canon.brandName,
    publisherName: canon.publisherName,
      brandAliases: canon.brandAliases,
    });
  } catch {
    /* a page whose text cannot be parsed still gets the page audit */
  }

  return NextResponse.json({
    url: session.document_source_ref,
    finalUrl: fetched.finalUrl,
    audit,
    liveScores,
    liveWords,
    render: { ran: render.ok, reason: render.reason, ms: render.renderMs },
  });
}
