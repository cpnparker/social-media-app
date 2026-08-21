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
import { requireOptimizer, loadOwnedSession } from "../../../_lib/access";
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

  const owned = await loadOwnedSession(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session;

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
        model: "claude-sonnet-5",
        systemPrompt,
        maxTokens: 8000,
        webSearch: false,
        imageGeneration: false,
        preserveLinks: true,
        source: "optimizer",
      } as any,
      async ({ fullText }: { fullText: string }) => {
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
