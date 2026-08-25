/**
 * POST /api/optimizer/sessions/[id]/generate — stream a draft from the brief.
 *
 * Goes through createStreamingResponse (lib/ai/providers.ts) rather than
 * hand-rolling an SDK loop. That is not laziness: the shared producer carries
 * the 90-second stall guard, the provider fallback chain, the [DONE] sentinel
 * and the onComplete contract. A hand-rolled loop gets none of them, and a hung
 * upstream would burn the full maxDuration and return nothing at all.
 *
 * The brief and the client canon go into the LEADING system block, never a
 * mid-array system message — a role:"system" message in the middle of the
 * messages array is not reliably honoured by every provider this app routes to,
 * and the failure is silent: the model simply writes as though the grounding
 * were never supplied.
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { createStreamingResponse } from "@/lib/ai/providers";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { GENERATE_MODEL } from "@/lib/optimizer/models";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { buildGenerationPrompt } from "@/lib/optimizer/briefs";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* body is optional here — the brief lives on the session row */
  }

  const guard = await requireOptimizer(body.workspaceId || req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session;

  // Generation is for a piece that does not exist yet. Since import landed,
  // a session can arrive already holding a writer's content and an EMPTY brief
  // — and generating over that appends a new version, which the editor then
  // shows instead of their words. Nothing is destroyed (versions are kept), but
  // the writer would open their article and find something else in it, and
  // there is no path in the UI that should ever ask for this.
  //
  // Checked on the DRAFT, not on type_source: a generated piece that has since
  // been rewritten deserves the same protection.
  const { data: existingDrafts } = await intelligenceDb
    .from("optimizer_drafts")
    .select("units_version, document_body")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(1);
  const existingBody = existingDrafts && existingDrafts.length > 0 ? (existingDrafts[0] as any).document_body || "" : "";
  if (existingBody.replace(/<[^>]+>/g, "").trim()) {
    return NextResponse.json(
      { error: "This piece already has content. Generating would put a new draft over it — edit it instead, or start a new piece." },
      { status: 409 }
    );
  }

  // Kill switch and spend cap, on its own source string so the optimizer can be
  // throttled or stopped from the Control Centre without touching chat.
  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  const systemPrompt = buildGenerationPrompt({
    title: session.name_title,
    format: session.type_format,
    platform: session.type_platform,
    brief: session.config_brief || { targetQueries: [], audience: "", goal: "", lengthBand: "800-1500", voice: "" },
    canon: session.config_canon && session.config_canon.clientName ? session.config_canon : null,
  });

  await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: "drafting", date_updated: new Date().toISOString() })
    .eq("id_session", id);

  try {
    const stream = createStreamingResponse(
      [{ role: "user", content: `Write the piece.` }],
      {
        model: GENERATE_MODEL,
        systemPrompt,
        maxTokens: 8000,
        webSearch: false,
        imageGeneration: false,
        preserveLinks: true,
        source: "optimizer",
      } as any,
      // NO inline type annotation, deliberately. This callback used to declare
      // its own permissive shape ending `model?: string` — which kept tsc green
      // while `result.model` was undefined on EVERY run, because StreamResult's
      // field is `modelUsed`. The `|| "claude-sonnet-5"` below then won every
      // time, so every generate row named Sonnet: a grok-4.3 fallback was
      // priced at Sonnet's $10/MTok output instead of $2.50 and charged to the
      // wrong provider cap, and a Control Centre override was invisible.
      // Inference from createStreamingResponse gives the real StreamResult,
      // where modelUsed is REQUIRED — so this cannot silently reopen.
      async (result) => {
        const fullText = result.fullText;

        // Log the spend BEFORE the early return, and before anything that can
        // throw. The tokens were consumed whether or not the generation was
        // usable, and an unlogged call is worse than a wasted one: nothing
        // under app/api/optimizer previously called logAiUsage, so no ai_usage
        // row was ever written with source 'optimizer' — which is exactly what
        // the spend cap filters on. The cap could never fire, optimizer spend
        // was invisible in billing, and the "kill switch and spend cap" comment
        // above was guarding nothing. The guard was written; the data it needs
        // was never produced.
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

        if (!fullText || !fullText.trim()) {
          // Never record an empty generation as a draft_ready draft — the
          // studio would show a blank editor and a score of zero as though the
          // writer had produced them.
          await intelligenceDb
            .from("optimizer_sessions")
            .update({ type_status: "brief", date_updated: new Date().toISOString() })
            .eq("id_session", id);
          return;
        }

        const { data: existing } = await intelligenceDb
          .from("optimizer_drafts")
          .select("units_version")
          .eq("id_session", id)
          .order("units_version", { ascending: false })
          .limit(1);
        const nextVersion = existing && existing.length > 0 ? (existing[0] as any).units_version + 1 : 1;

        await intelligenceDb.from("optimizer_drafts").insert({
          id_session: id,
          units_version: nextVersion,
          document_body: fullText,
          units_words: (fullText.match(/\S+/g) || []).length,
        });

        await intelligenceDb
          .from("optimizer_sessions")
          .update({ type_status: "draft_ready", date_updated: new Date().toISOString() })
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
    console.error("[optimizer] generation failed:", error?.message);
    await intelligenceDb
      .from("optimizer_sessions")
      .update({ type_status: "brief", date_updated: new Date().toISOString() })
      .eq("id_session", id);
    return NextResponse.json({ error: error?.message || "Generation failed" }, { status: 500 });
  }
}
