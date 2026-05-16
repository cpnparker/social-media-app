import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";
import { generateImage, generateVideo, persistDesignAsset } from "@/lib/ai/providers";
import type { BrandContext } from "@/lib/ai/branded-prompt";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";
import { evaluateImageAgainstBrand, paletteFromVisualIdentity, defaultRulesFromVisualIdentity, type CertResult } from "@/lib/design/brand-check";
import { fetchBlobContent } from "@/lib/ai/blob-utils";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/generate
 *
 * Generates a new version for the given shot using the shot's current model
 * + prompt + (optionally overridden) options. Brand context is auto-injected
 * from the session's pinned brand kit snapshot.
 *
 * Body (optional overrides):
 *   - modelId: override shot.modelId
 *   - prompt:  override shot.prompt
 *   - format:  'landscape' | 'portrait' | 'square'  (video only)
 *   - duration: 5 | 10                              (video only)
 *
 * Returns: { version: { id, idx, modelId, assetId, blobUrl, metadata }, status: 'review' | 'drift' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; shotId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;
  const body = await req.json().catch(() => ({}));

  // ── Session + access ──
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace, id_client, id_content, id_brand_kit_snapshot, flag_incognito")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.permission === "view") return NextResponse.json({ error: "Read-only" }, { status: 403 });

  // ── Shot + last version idx ──
  const { data: shot } = await intelligenceDb
    .from("design_shots")
    .select("*")
    .eq("id_shot", shotId)
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  let modelId: string = body.modelId || (shot as any).model_id || "runway-g4-5";
  // Migrate legacy ids transparently
  if (LEGACY_MODEL_ALIASES[modelId]) modelId = LEGACY_MODEL_ALIASES[modelId];
  const model = DESIGN_MODELS.find((m) => m.id === modelId);
  const prompt: string = body.prompt || (shot as any).prompt || "";
  if (!prompt.trim()) {
    return NextResponse.json({ error: "Shot has no prompt — set one before generating" }, { status: 400 });
  }

  // ── Brand context (from pinned snapshot) ──
  let brand: BrandContext | null = null;
  if ((sessionRow as any).id_brand_kit_snapshot) {
    const { data: kit } = await intelligenceDb
      .from("design_brand_kits")
      .select("visual_identity")
      .eq("id_brand_kit", (sessionRow as any).id_brand_kit_snapshot)
      .maybeSingle();
    if (kit) {
      // Resolve client name for nicer logs
      let clientName: string | undefined;
      if ((sessionRow as any).id_client) {
        const { supabase } = await import("@/lib/supabase");
        const { data: c } = await supabase
          .from("app_clients")
          .select("name_client")
          .eq("id_client", (sessionRow as any).id_client)
          .maybeSingle();
        clientName = (c as any)?.name_client || undefined;
      }
      brand = {
        clientName,
        visualIdentity: (kit as any).visual_identity,
        documentContext: null,
      };
    }
  }

  // ── Mark shot as generating ──
  await intelligenceDb
    .from("design_shots")
    .update({ status: "generating", date_updated: new Date().toISOString() })
    .eq("id_shot", shotId);

  // ── Generate ──
  const incognito = (sessionRow as any).flag_incognito === 1;
  let blobUrl: string;
  let metadata: Record<string, any> = { model_id: modelId };
  let type: "image" | "video" = "image";
  let source: "dalle" | "grok_imagine" | "runway" = "dalle";

  try {
    // Route per the model registry.
    if (model?.provider === "runway") {
      // Video — Runway, Veo, Kling, Seedance all flow through Runway's unified API.
      type = "video";
      source = "runway";
      const duration: 5 | 10 = body.duration === 10 ? 10 : 5;
      const format = body.format as ("landscape" | "portrait" | "square") | undefined;
      const result = await generateVideo(prompt, {
        duration,
        format,
        // Pass the actual Runway model string (e.g. "gen4.5", "veo3.1", "kling3.0_pro")
        model: (model.runwayModel as any) || "gen4.5",
        brand,
      });
      blobUrl = result.videoUrl;
      metadata = {
        model_id: modelId,
        runway_model: result.model,
        duration_sec: result.durationSec,
        format: format || "landscape",
        brand_applied: !!brand,
      };
    } else if (model?.provider === "higgsfield" || model?.provider === "sora") {
      // Not yet wired — clean error so the UI can surface "coming soon".
      await intelligenceDb
        .from("design_shots")
        .update({ status: "review" })
        .eq("id_shot", shotId);
      return NextResponse.json({
        error: `${model.name} isn't wired yet — pick one of the Runway-hosted video models for now (Gen-4.5, Veo 3.1, Kling 3 Pro, or Seedance 2).`,
      }, { status: 501 });
    } else {
      // Image — dalle-3 / gpt-img-1 / grok-img
      type = "image";
      source = modelId === "grok-img" ? "grok_imagine" : "dalle";
      const provider: "openai" | "xai" | "anthropic" = modelId === "grok-img" ? "xai" : "openai";
      const size: "1024x1024" | "1792x1024" | "1024x1792" =
        body.format === "portrait" ? "1024x1792" :
        body.format === "landscape" ? "1792x1024" :
        "1024x1024";
      blobUrl = await generateImage(prompt, size, provider, brand);
      metadata = {
        model_id: modelId,
        size,
        brand_applied: !!brand,
      };
    }
  } catch (err: any) {
    console.error("[Design generate] failed:", err?.message || err);
    await intelligenceDb
      .from("design_shots")
      .update({ status: "review" })
      .eq("id_shot", shotId);
    return NextResponse.json({ error: err?.message || "Generation failed" }, { status: 500 });
  }

  // ── Persist asset + version ──
  let assetId: string | null = null;
  if (!incognito) {
    assetId = await persistDesignAsset({
      conversationId: null, // design v2 sessions are independent of ai_conversations
      workspaceId: (sessionRow as any).id_workspace,
      clientId: (sessionRow as any).id_client ?? null,
      contentId: (sessionRow as any).id_content ?? null,
      userId,
      type,
      source,
      blobUrl,
      prompt,
      metadata: { ...metadata, design_session_id: sessionId, design_shot_id: shotId },
    });
    if (assetId) {
      // Attach to the shot
      await intelligenceDb
        .from("ai_design_assets")
        .update({ id_shot: shotId })
        .eq("id_asset", assetId);
    }
  }

  // Determine next idx for this shot's versions
  let nextIdx = 1;
  if (!incognito) {
    const { data: maxRow } = await intelligenceDb
      .from("design_shot_versions")
      .select("idx")
      .eq("id_shot", shotId)
      .order("idx", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextIdx = ((maxRow as any)?.idx || 0) + 1;
  }

  let versionId: string | null = null;
  if (!incognito) {
    const { data: ver } = await intelligenceDb
      .from("design_shot_versions")
      .insert({
        id_shot: shotId,
        idx: nextIdx,
        id_asset: assetId,
        prompt_used: prompt,
        model_id: modelId,
        metadata,
      })
      .select("id_version")
      .single();
    versionId = (ver as any)?.id_version || null;

    if (versionId && assetId) {
      await intelligenceDb
        .from("ai_design_assets")
        .update({ id_version: versionId })
        .eq("id_asset", assetId);
    }
  }

  // ── Real brand-check (palette histogram) ──
  // Runs only on still images for v1; videos get a placeholder pass until we
  // wire poster-frame extraction.
  let onBrand = true;
  let brandResults: CertResult[] = [];
  let brandHistogram: Record<string, number> = {};
  if (type === "image" && brand?.visualIdentity) {
    try {
      const palette = paletteFromVisualIdentity(brand.visualIdentity);
      const rules = defaultRulesFromVisualIdentity(brand.visualIdentity);
      if (palette.length > 0 && rules.length > 0) {
        const { buffer } = await fetchBlobContent(blobUrl);
        const outcome = await evaluateImageAgainstBrand(buffer, palette, rules);
        onBrand = outcome.onBrand;
        brandResults = outcome.results;
        brandHistogram = outcome.histogram;
        console.log(`[BrandCheck] shot=${shotId} on_brand=${onBrand} results=${JSON.stringify(brandResults.map(r => ({ rule: r.rule, status: r.status, value: r.value })))}`);
      }
    } catch (e: any) {
      console.warn("[BrandCheck] failed (non-fatal):", e?.message);
    }
  } else if (type === "video") {
    // Video poster-frame extraction is queued; assume on-brand for now.
    onBrand = true;
  }
  const status = onBrand ? "review" : "drift";

  // Persist the brand certificate alongside the version
  if (!incognito && versionId && brandResults.length > 0) {
    try {
      await intelligenceDb
        .from("design_brand_certificates")
        .insert({
          id_session: sessionId,
          id_version: versionId,
          results: brandResults,
        });
      // Stash the headline metric in the version metadata so the
      // sandstone-cap meter can read it without a join.
      const sandstoneResult = brandResults.find((r) => /sandstone|gold/i.test(r.rule));
      if (sandstoneResult) {
        await intelligenceDb
          .from("design_shot_versions")
          .update({
            metadata: {
              ...metadata,
              brand_check: brandResults,
              brand_histogram: brandHistogram,
              sandstone_pct: sandstoneResult.value,
            },
          })
          .eq("id_version", versionId);
      }
    } catch (e: any) {
      console.warn("[BrandCheck] persist failed:", e?.message);
    }
  }

  // ── Update shot: status + current_version_id + model + prompt + flag_on_brand ──
  if (!incognito && versionId) {
    await intelligenceDb
      .from("design_shots")
      .update({
        status,
        current_version_id: versionId,
        model_id: modelId,
        prompt,
        flag_on_brand: onBrand ? 1 : 0,
        note: !onBrand && brandResults.length > 0 ? brandResults.find((r) => r.status === "fail")?.detail || null : null,
        date_updated: new Date().toISOString(),
      })
      .eq("id_shot", shotId);
  } else {
    await intelligenceDb
      .from("design_shots")
      .update({ status, date_updated: new Date().toISOString() })
      .eq("id_shot", shotId);
  }

  return NextResponse.json({
    version: {
      id: versionId,
      idx: nextIdx,
      modelId,
      assetId,
      blobUrl,
      promptUsed: prompt,
      metadata,
    },
    shot: {
      id: shotId,
      status,
      onBrand,
    },
  });
}
