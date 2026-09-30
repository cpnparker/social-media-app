/**
 * Pure server function for generating a new version of a shot.
 *
 * Extracted from the API route so the AI streamer can call it directly
 * (when Claude invokes `design_generate_shot`) without going through HTTP.
 * The API route is now a thin wrapper.
 *
 * Mirrors the previous behaviour exactly:
 *   - Resolves brand context from the session's pinned brand kit snapshot
 *   - Routes to Runway / OpenAI image / xAI image based on the model registry
 *   - Brand-checks the result (image only; video poster-frame extraction TBD)
 *   - Persists ai_design_assets + design_shot_versions
 *   - Updates shot.status, flag_on_brand, current_version_id
 *   - Honours flag_incognito (skips persistence)
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";
import { generateImage, generateVideo, persistDesignAsset } from "@/lib/ai/providers";
import type { BrandContext } from "@/lib/ai/branded-prompt";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";
import { evaluateImageAgainstBrand, paletteFromVisualIdentity, defaultRulesFromVisualIdentity, type CertResult } from "@/lib/design/brand-check";
import { fetchBlobContent } from "@/lib/ai/blob-utils";

export interface GenerateShotOptions {
  modelId?: string;
  prompt?: string;
  format?: "landscape" | "portrait" | "square";
  duration?: 5 | 10;
}

export type GenerateShotErrorCode =
  | "session_not_found"
  | "shot_not_found"
  | "no_prompt"
  | "model_unavailable"
  | "generation_failed";

export type GenerateShotResult =
  | {
      ok: true;
      version: {
        id: string | null;
        idx: number;
        modelId: string;
        assetId: string | null;
        blobUrl: string;
        promptUsed: string;
        metadata: Record<string, unknown>;
      };
      shot: {
        id: string;
        status: "review" | "drift";
        onBrand: boolean;
      };
    }
  | { ok: false; code: GenerateShotErrorCode; message: string };

/**
 * Generate a new version for a shot. The caller is responsible for the
 * access check (the HTTP route does it; the AI streamer trusts its
 * studio context).
 */
export async function generateShotVersion(
  sessionId: string,
  shotId: string,
  userId: number,
  options: GenerateShotOptions = {},
): Promise<GenerateShotResult> {
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("id_workspace, id_client, id_content, id_brand_kit_snapshot, flag_incognito")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return { ok: false, code: "session_not_found", message: "Session not found" };

  const { data: shot } = await intelligenceDb
    .from("design_shots")
    .select("*")
    .eq("id_shot", shotId)
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!shot) return { ok: false, code: "shot_not_found", message: "Shot not found" };

  let modelId: string = options.modelId || (shot as any).model_id || "runway-g4-5";
  if (LEGACY_MODEL_ALIASES[modelId]) modelId = LEGACY_MODEL_ALIASES[modelId];
  const model = DESIGN_MODELS.find((m) => m.id === modelId);

  const prompt: string = (options.prompt || (shot as any).prompt || "").trim();
  if (!prompt) {
    return { ok: false, code: "no_prompt", message: "Shot has no prompt — set one before generating" };
  }

  // Brand context
  let brand: BrandContext | null = null;
  if ((sessionRow as any).id_brand_kit_snapshot) {
    const { data: kit } = await intelligenceDb
      .from("design_brand_kits")
      .select("visual_identity")
      .eq("id_brand_kit", (sessionRow as any).id_brand_kit_snapshot)
      .maybeSingle();
    if (kit) {
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
      brand = { clientName, visualIdentity: (kit as any).visual_identity, documentContext: null };
    }
  }

  // Mark generating
  await intelligenceDb
    .from("design_shots")
    .update({ status: "generating", date_updated: new Date().toISOString() })
    .eq("id_shot", shotId);

  const incognito = (sessionRow as any).flag_incognito === 1;
  let blobUrl: string;
  let metadata: Record<string, any> = { model_id: modelId };
  let type: "image" | "video" = "image";
  let source: "dalle" | "grok_imagine" | "runway" = "dalle";

  try {
    if (model?.provider === "runway") {
      type = "video";
      source = "runway";
      const duration: 5 | 10 = options.duration === 10 ? 10 : 5;
      const result = await generateVideo(prompt, {
        duration,
        format: options.format,
        model: (model.runwayModel as any) || "gen4.5",
        brand,
      });
      blobUrl = result.videoUrl;
      metadata = {
        model_id: modelId,
        runway_model: result.model,
        duration_sec: result.durationSec,
        format: options.format || "landscape",
        brand_applied: !!brand,
      };
    } else if (model?.provider === "higgsfield" || model?.provider === "sora") {
      await intelligenceDb
        .from("design_shots")
        .update({ status: "review" })
        .eq("id_shot", shotId);
      return {
        ok: false,
        code: "model_unavailable",
        message: `${model.name} isn't wired yet — pick one of the Runway-hosted video models (Gen-4.5, Veo 3.1, Kling 3 Pro, Seedance 2).`,
      };
    } else {
      type = "image";
      source = modelId === "grok-img" ? "grok_imagine" : "dalle";
      const provider: "openai" | "xai" | "anthropic" = modelId === "grok-img" ? "xai" : "openai";
      const size: "1024x1024" | "1792x1024" | "1024x1792" =
        options.format === "portrait" ? "1024x1792" :
        options.format === "landscape" ? "1792x1024" :
        "1024x1024";
      blobUrl = await generateImage(prompt, size, provider, brand);
      metadata = { model_id: modelId, size, brand_applied: !!brand };
    }
  } catch (err: any) {
    console.error("[generateShotVersion] failed:", err?.message);
    await intelligenceDb
      .from("design_shots")
      .update({ status: "review" })
      .eq("id_shot", shotId);
    return { ok: false, code: "generation_failed", message: err?.message || "Generation failed" };
  }

  // Persist asset
  let assetId: string | null = null;
  if (!incognito) {
    assetId = await persistDesignAsset({
      conversationId: null,
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
      await intelligenceDb
        .from("ai_design_assets")
        .update({ id_shot: shotId })
        .eq("id_asset", assetId);
    }
  }

  // Persist version
  let nextIdx = 1;
  let versionId: string | null = null;
  if (!incognito) {
    const { data: maxRow } = await intelligenceDb
      .from("design_shot_versions")
      .select("idx")
      .eq("id_shot", shotId)
      .order("idx", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextIdx = ((maxRow as any)?.idx || 0) + 1;

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

  // Brand check (image only)
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
      }
    } catch (e: any) {
      console.warn("[BrandCheck] failed (non-fatal):", e?.message);
    }
  }
  const status: "review" | "drift" = onBrand ? "review" : "drift";

  if (!incognito && versionId && brandResults.length > 0) {
    try {
      await intelligenceDb
        .from("design_brand_certificates")
        .insert({ id_session: sessionId, id_version: versionId, results: brandResults });
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

  // Final shot update
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

  return {
    ok: true,
    version: {
      id: versionId,
      idx: nextIdx,
      modelId,
      assetId,
      blobUrl,
      promptUsed: prompt,
      metadata,
    },
    shot: { id: shotId, status, onBrand },
  };
}
