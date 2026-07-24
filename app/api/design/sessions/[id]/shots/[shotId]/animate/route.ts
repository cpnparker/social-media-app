import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";
import { generateVideo, persistDesignAsset, linkAssetToShot, loadBrandContext } from "@/lib/ai/providers";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/animate
 *
 * One-click image-to-video. Takes the source shot's current version (must be
 * an image), creates a NEW downstream shot in the session referencing the
 * still, and generates a 5-second Runway image_to_video clip with the given
 * motion prompt.
 *
 * Body:
 *   - motionPrompt?: string — defaults to a sensible patient-camera motion
 *   - duration?: 5 | 10
 *   - format?: 'landscape' | 'portrait' | 'square'
 *   - model?: Runway model id (default 'gen4.5')
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; shotId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;
  const body = await req.json().catch(() => ({}));

  // Access
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace, id_client, id_content, flag_incognito")
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

  // Source shot + current version
  const { data: shot } = await intelligenceDb
    .from("design_shots")
    .select("id_shot, idx, name_shot, name_beat, current_version_id, prompt")
    .eq("id_shot", shotId)
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  if (!(shot as any).current_version_id) {
    return NextResponse.json({ error: "Shot has no version yet — generate v1 first" }, { status: 400 });
  }

  const { data: srcVersion } = await intelligenceDb
    .from("design_shot_versions")
    .select("id_asset, prompt_used")
    .eq("id_version", (shot as any).current_version_id)
    .maybeSingle();
  if (!srcVersion) return NextResponse.json({ error: "Source version not found" }, { status: 404 });

  const { data: srcAsset } = await intelligenceDb
    .from("ai_design_assets")
    .select("type_asset, blob_url")
    .eq("id_asset", (srcVersion as any).id_asset)
    .maybeSingle();
  if (!srcAsset || (srcAsset as any).type_asset !== "image") {
    return NextResponse.json({ error: "Source must be an image (got " + (srcAsset as any)?.type_asset + ")" }, { status: 400 });
  }
  const sourceImageUrl: string = (srcAsset as any).blob_url;

  // Motion prompt — default if not provided
  const motionPrompt: string =
    body.motionPrompt
    || `Animate this image with a slow cinematic camera push and natural ambient motion. Keep the composition as-is. ${(shot as any).prompt || ""}`.trim();

  // Brand context
  const brand = await loadBrandContext((sessionRow as any).id_workspace, (sessionRow as any).id_client);

  // Generate
  const incognito = (sessionRow as any).flag_incognito === 1;
  const duration: 5 | 10 = body.duration === 10 ? 10 : 5;
  const format = body.format as ("landscape" | "portrait" | "square") | undefined;
  const model = (body.model as any) || "gen4.5";

  let videoUrl: string;
  let durationSec: number;
  let modelUsed: string;
  try {
    const result = await generateVideo(motionPrompt, {
      duration,
      format,
      imageUrl: sourceImageUrl,
      model,
      brand,
    });
    videoUrl = result.videoUrl;
    durationSec = result.durationSec;
    modelUsed = result.model;
  } catch (err: any) {
    console.error("[Animate] failed:", err?.message);
    return NextResponse.json({ error: err?.message || "Generation failed" }, { status: 500 });
  }

  if (incognito) {
    // Return without persisting — designer can still see the video in-flight
    return NextResponse.json({ video_url: videoUrl, incognito: true });
  }

  // Create a new downstream shot. Title takes the cue from the source shot.
  const { count } = await intelligenceDb
    .from("design_shots")
    .select("id_shot", { count: "exact", head: true })
    .eq("id_session", sessionId);
  const nextIdx = (count || 0) + 1;

  const { data: newShot, error: shotErr } = await intelligenceDb
    .from("design_shots")
    .insert({
      id_session: sessionId,
      idx: nextIdx,
      name_shot: `${(shot as any).name_shot} — animated`,
      name_beat: (shot as any).name_beat,
      duration_sec: durationSec,
      model_id: "runway-g4-5",
      model_note: "Image-to-video (Runway)",
      status: "review",
      flag_on_brand: 1,
      prompt: motionPrompt,
      seed_locked_from_shot_id: shotId,
    })
    .select("id_shot")
    .single();
  if (shotErr) return NextResponse.json({ error: shotErr.message }, { status: 500 });
  const newShotId = (newShot as any).id_shot;

  // Persist + link asset
  const assetId = await persistDesignAsset({
    workspaceId: (sessionRow as any).id_workspace,
    clientId: (sessionRow as any).id_client ?? null,
    contentId: (sessionRow as any).id_content ?? null,
    userId,
    type: "video",
    source: "runway",
    blobUrl: videoUrl,
    prompt: motionPrompt,
    metadata: { duration_sec: durationSec, model: modelUsed, format: format || "landscape", brand_applied: !!brand, animated_from_shot_id: shotId },
  });

  let versionId: string | null = null;
  if (assetId) {
    const linked = await linkAssetToShot({
      sessionId,
      focusedShotId: newShotId,
      assetId,
      prompt: motionPrompt,
      modelId: modelUsed,
      metadata: { duration_sec: durationSec, format: format || "landscape", animated_from_shot_id: shotId },
    });
    versionId = linked.versionId;
  }

  // Drop a reference on the new shot pointing back at the source image so the
  // refs grid shows the original still.
  await intelligenceDb
    .from("design_shot_references")
    .insert({
      id_shot: newShotId,
      idx: 1,
      id_asset: (srcVersion as any).id_asset,
      seed_locked: 1,
      caption: `Source still from S${String((shot as any).idx).padStart(2, "0")}`,
    });

  return NextResponse.json({
    shotId: newShotId,
    versionId,
    assetId,
    videoUrl,
    durationSec,
    model: modelUsed,
  });
}
