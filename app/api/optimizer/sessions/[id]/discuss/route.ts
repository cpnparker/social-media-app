/**
 * The conversation about a draft. GET reads it, POST asks a question.
 *
 * ── WHY THE DRAFT COMES FROM THE CLIENT ─────────────────────────────────────
 *
 * The editor autosaves on a 600ms debounce, so the stored draft is always at
 * least slightly behind what is on screen — and after a burst of typing, or a
 * failed save, it can be a great deal behind. A writer who rewrites a paragraph
 * and immediately asks "is that better?" must not be answered about the version
 * before the rewrite: that produces a confident, wrong answer with nothing on
 * either side showing why. So the browser sends what it is displaying, and the
 * stored draft is only the fallback for when it sends nothing.
 *
 * This is the writer's own document either way — the same bytes they can read,
 * edit and export — so accepting it from them grants no access they lack. It is
 * bounded here regardless, because size is a cost question rather than a trust
 * one.
 *
 * ── SPEND ───────────────────────────────────────────────────────────────────
 *
 * POST calls a model, so it carries the gate and logs usage in onComplete,
 * before anything that can throw. GET does neither because it does neither:
 * it reads a jsonb column.
 */
import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { createStreamingResponse } from "@/lib/ai/providers";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { DISCUSS_MODEL } from "@/lib/optimizer/models";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { buildGroundingBlock } from "@/lib/optimizer/briefs";
import { loadClientStyle } from "@/lib/optimizer/client-style";
import { listSources } from "@/lib/optimizer/sources";
import {
  readTurns,
  trimForPrompt,
  trimForStorage,
  buildDiscussSystem,
  buildDiscussTurn,
  DISCUSS_MAX_QUESTION,
  DISCUSS_MAX_DRAFT_CHARS,
  type DiscussTurn,
} from "@/lib/optimizer/discuss";

export const maxDuration = 120;

/**
 * The editor's HTML as the text a reader would see.
 *
 * Block tags become breaks BEFORE the tags are stripped. Stripping first would
 * run every heading into the paragraph beneath it, and a model asked about
 * "the second heading" would be looking at prose with no headings in it.
 */
function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  return NextResponse.json({ turns: readTurns((owned.session as any).config_chat) });
}

/**
 * Clear the conversation.
 *
 * Its own method rather than a flag on POST, and that is not style. It was
 * written as `if (body.clear === true)` BELOW the "ask a question first" check,
 * which made it unreachable: clearing required sending a question, and sending
 * a question meant it was never a clear. The branch existed, type-checked and
 * read correctly — the failure this repo keeps finding, where code is written
 * but never actually run. A verb cannot be shadowed by another parameter.
 *
 * No spend gate: it calls no model. Deliberately no gate, in fact, for the
 * reason the style route gives — refusing to clear a conversation because a
 * BUDGET is exhausted would block a free action on an unrelated condition.
 *
 * The draft is untouched. This clears the talk ABOUT the piece, never the piece.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const { error } = await intelligenceDb
    .from("optimizer_sessions")
    .update({ config_chat: [] })
    .eq("id_session", id);
  if (error) return NextResponse.json({ error: "Could not clear that" }, { status: 500 });
  return NextResponse.json({ turns: [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any = {};
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

  const question = String(body.question || "").trim().slice(0, DISCUSS_MAX_QUESTION);
  if (!question) return NextResponse.json({ error: "Ask a question first" }, { status: 400 });

  // ── The column has to exist before we spend anything ─────────────────────
  //
  // This ships in a migration run by hand. Without it the conversation would
  // still STREAM — the writer would read a perfectly good answer — and then
  // vanish on reload, because the write of config_chat fails with 42703 inside
  // onComplete, long after the response has been handed back. That is the
  // shape of failure this codebase keeps finding: something that looks like it
  // worked, costs money, and quietly kept nothing. Checked BEFORE the model
  // call so nothing is paid for a conversation that cannot be saved.
  //
  // `select("*")` simply omits a column that does not exist, so undefined is
  // the signal. An existing but empty column is [].
  if (typeof session.config_chat === "undefined") {
    return NextResponse.json(
      { error: "This deployment's database has not been migrated for the writing conversation yet. Run supabase/migrations/20260826_writer_chat.sql." },
      { status: 503 }
    );
  }

  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Engine AI is temporarily unavailable" }, { status: 503 });
  }

  // What is on the writer's screen, falling back to what was last saved.
  let draftText = "";
  if (typeof body.draftHtml === "string" && body.draftHtml.trim()) {
    draftText = htmlToText(body.draftHtml).slice(0, DISCUSS_MAX_DRAFT_CHARS * 2);
  } else {
    const { data: drafts } = await intelligenceDb
      .from("optimizer_drafts")
      .select("document_body")
      .eq("id_session", id)
      .order("units_version", { ascending: false })
      .limit(1);
    if (drafts && drafts.length > 0) draftText = htmlToText((drafts[0] as any).document_body || "");
  }

  const clientStyle = session.id_client
    ? await loadClientStyle(
        guard.caller.workspaceId,
        session.id_client,
        (session.config_canon && session.config_canon.clientName) || `Client ${session.id_client}`
      )
    : null;
  const sources = await listSources(id);

  // The SAME grounding that produced the draft. Not a paraphrase of it.
  const grounding = buildGroundingBlock({
    title: session.name_title,
    format: session.type_format,
    platform: session.type_platform,
    brief: session.config_brief || { targetQueries: [], audience: "", goal: "", lengthBand: "800-1500", voice: "" },
    canon: session.config_canon && session.config_canon.clientName ? session.config_canon : null,
    style: clientStyle,
    sources,
  } as any);

  const systemPrompt = buildDiscussSystem({
    title: session.name_title,
    format: session.type_format,
    grounding,
  });

  const history = readTurns(session.config_chat);
  const now = new Date().toISOString();

  // History carries the writer's words only — never the copy of the draft that
  // rode with them. Ten turns each holding their own snapshot would grow the
  // prompt by the length of the article per question asked, and would invite an
  // answer about a version since rewritten.
  const promptTurns = trimForPrompt(history).map((t) => ({ role: t.role, content: t.content }));
  const selection = typeof body.selection === "string" ? body.selection : null;
  promptTurns.push({
    role: "user",
    content: buildDiscussTurn({ draftText, selection, question }),
  });

  try {
    const stream = createStreamingResponse(
      promptTurns as any,
      {
        model: DISCUSS_MODEL,
        systemPrompt,
        maxTokens: 2000,
        webSearch: false,
        imageGeneration: false,
        preserveLinks: true,
        source: "optimizer",
      } as any,
      // No inline annotation: inference gives the real StreamResult, where
      // modelUsed is required. A hand-written shape here is how every generate
      // row came to name Sonnet regardless of which model answered.
      async (result) => {
        logAiUsage({
          workspaceId: guard.caller.workspaceId,
          userId: guard.caller.userId,
          model: result.modelUsed,
          source: "optimizer",
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
          cacheReadTokens: result.cacheReadTokens,
          cacheWriteTokens: result.cacheWriteTokens,
        });

        const reply = (result.fullText || "").trim();
        // An empty reply is not recorded. A stored blank assistant turn would
        // render as a silent bubble the writer cannot interpret, and would then
        // be sent back as context on every later turn.
        if (!reply) return;

        const next: DiscussTurn[] = trimForStorage(
          history.concat([
            { role: "user", content: question, at: now },
            { role: "assistant", content: reply, at: new Date().toISOString() },
          ])
        );
        await intelligenceDb
          .from("optimizer_sessions")
          .update({ config_chat: next })
          .eq("id_session", id);
      }
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[optimizer] discuss failed:", error?.message);
    return NextResponse.json({ error: error?.message || "Could not answer just now" }, { status: 500 });
  }
}
