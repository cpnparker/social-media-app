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

  const canon = session.config_canon || {};
  const brief = session.config_brief || {};
  const brandNames = [canon.brandName].concat(canon.brandAliases || []).filter(Boolean);

  const audit = auditPage(
    {
      page: fetched.page,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.httpStatus,
      brandNames,
      targetQueries: brief.targetQueries || [],
      render,
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
