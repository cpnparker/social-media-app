import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";
import { fetchBlobContent } from "@/lib/ai/blob-utils";
import { reframeImage, ratioSupported, type DerivativeRatio } from "@/lib/design/reframe";
import { persistDesignAsset } from "@/lib/ai/providers";

/**
 * POST /api/design/sessions/[id]/publish
 *
 * Phase 2d v1 (pragmatic): instead of rendering a final stitched video
 * (Creatomate / ffmpeg — comes later), we publish by:
 *
 *   1. Validating that the session is scoped to a content item
 *   2. Finding every shot in status='approved' with a current version that
 *      has a generated asset
 *   3. Stamping id_content on those ai_design_assets rows so they surface
 *      in the content's design assets list
 *   4. Writing a design_publish_jobs row to record the publish event
 *
 * Body (optional):
 *   - caption: text — stored on the publish job for later use by the post worker
 *   - formats: array — recorded for posterity (format conversion is v2d.2)
 *
 * Returns { jobId, publishedAssetCount, contentId }.
 *
 * If you want the full Creatomate render-and-stitch path, that's tracked
 * separately in the plan.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const body = await req.json().catch(() => ({}));

  // ── Session + access ──
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace, id_content, flag_incognito")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if ((sessionRow as any).flag_incognito === 1) {
    return NextResponse.json({ error: "Incognito sessions can't publish" }, { status: 400 });
  }

  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.permission === "view") return NextResponse.json({ error: "Read-only — can't publish" }, { status: 403 });

  const contentId: number | null = (sessionRow as any).id_content || null;
  if (!contentId) {
    return NextResponse.json({
      error: "This session isn't linked to a content item. Open Design Mode from a content detail page to publish back to the Engine.",
    }, { status: 400 });
  }

  // ── Gather committed shots (status='approved' with a current version) ──
  const { data: approvedShots } = await intelligenceDb
    .from("design_shots")
    .select("id_shot, idx, name_shot, current_version_id, duration_sec")
    .eq("id_session", sessionId)
    .eq("status", "approved")
    .order("idx", { ascending: true });

  if (!approvedShots || approvedShots.length === 0) {
    return NextResponse.json({
      error: "No committed shots yet. Approve at least one shot (Commit to timeline) before publishing.",
    }, { status: 400 });
  }

  // For each shot, get the current version's asset
  const versionIds = approvedShots
    .map((s: any) => s.current_version_id)
    .filter(Boolean);
  if (versionIds.length === 0) {
    return NextResponse.json({
      error: "Committed shots have no generated version yet. Generate something before publishing.",
    }, { status: 400 });
  }

  const { data: versions } = await intelligenceDb
    .from("design_shot_versions")
    .select("id_version, id_shot, id_asset, model_id, metadata")
    .in("id_version", versionIds);

  const assetIds = (versions || [])
    .map((v: any) => v.id_asset)
    .filter(Boolean);
  if (assetIds.length === 0) {
    return NextResponse.json({
      error: "Committed versions have no asset. (This usually means the generation failed.)",
    }, { status: 400 });
  }

  // Pull asset rows so we can decide image-vs-video for reframing
  const { data: assetRows } = await intelligenceDb
    .from("ai_design_assets")
    .select("id_asset, type_asset, blob_url")
    .in("id_asset", assetIds);
  const assetById = new Map<string, any>((assetRows || []).map((a: any) => [a.id_asset, a]));

  // ── Stamp id_content on source ai_design_assets ──
  const { error: stampErr, count: stampedCount } = await intelligenceDb
    .from("ai_design_assets")
    .update({ id_content: contentId }, { count: "exact" })
    .in("id_asset", assetIds);
  if (stampErr) return NextResponse.json({ error: stampErr.message }, { status: 500 });

  // ── Reframe images to requested ratios + persist as new assets ──
  // Each shot's image asset becomes a set of derivatives (one per ratio).
  // Video reframing requires ffmpeg and is tracked separately — for now
  // videos publish as-is.
  const requestedRatios: DerivativeRatio[] = (Array.isArray(body.formats) ? body.formats : [
    { ratio: "9:16" }, { ratio: "1:1" }, { ratio: "16:9" },
  ])
    .map((f: any) => f.ratio)
    .filter(ratioSupported);

  const derivativeAssetIds: string[] = [];
  for (const v of versions || []) {
    const src = assetById.get(v.id_asset);
    if (!src || src.type_asset !== "image") continue; // skip non-images for v1

    // Fetch the source bytes once
    let sourceBuffer: Buffer;
    try {
      const got = await fetchBlobContent(src.blob_url);
      sourceBuffer = got.buffer;
    } catch (err: any) {
      console.warn("[Publish] fetch source failed:", err?.message);
      continue;
    }

    for (const ratio of requestedRatios) {
      try {
        const { buffer, width, height, contentType: ct } = await reframeImage(sourceBuffer, ratio);
        const tag = ratio.replace(":", "x");
        const filename = `design/publish/${sessionId.slice(0, 8)}/${v.id_version}-${tag}.png`;
        const blob = await put(filename, buffer, { access: "private", contentType: ct });
        const derivativeUrl = `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
        const derivativeId = await persistDesignAsset({
          workspaceId: (sessionRow as any).id_workspace,
          clientId: (sessionRow as any).id_client ?? null,
          contentId,
          userId,
          type: "image",
          source: "dalle",
          blobUrl: derivativeUrl,
          prompt: `Reframed to ${ratio} from version ${v.id_version}`,
          parentId: v.id_asset,
          metadata: {
            reframed_from_version: v.id_version,
            ratio,
            width,
            height,
            published_at: new Date().toISOString(),
          },
        });
        if (derivativeId) derivativeAssetIds.push(derivativeId);
      } catch (err: any) {
        console.warn(`[Publish] reframe ${ratio} failed for version ${v.id_version}:`, err?.message);
      }
    }
  }

  // ── Record the job ──
  const formats = Array.isArray(body.formats) && body.formats.length > 0
    ? body.formats
    : [
        { ratio: "9:16", kind: "story", primary: true },
        { ratio: "1:1", kind: "feed" },
        { ratio: "16:9", kind: "landscape" },
      ];
  const caption: string | null = typeof body.caption === "string" ? body.caption : null;

  const outputAssets = (versions || []).map((v: any) => {
    const shot = approvedShots.find((s: any) => s.id_shot === v.id_shot);
    return {
      shot_idx: shot?.idx,
      shot_title: shot?.name_shot,
      asset_id: v.id_asset,
      version_id: v.id_version,
      model_id: v.model_id,
      duration_sec: shot?.duration_sec,
    };
  });

  const { data: job, error: jobErr } = await intelligenceDb
    .from("design_publish_jobs")
    .insert({
      id_session: sessionId,
      id_content: contentId,
      user_created: userId,
      formats,
      caption,
      status: "uploaded",       // v1 = stamped + ready to view on the content page
      output_assets: outputAssets,
      date_completed: new Date().toISOString(),
    })
    .select("id_job")
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  const totalPublished = (stampedCount || assetIds.length) + derivativeAssetIds.length;
  const note = derivativeAssetIds.length > 0
    ? `Published ${totalPublished} assets to the content piece (${stampedCount || assetIds.length} source + ${derivativeAssetIds.length} reframed derivatives). Video reframing is queued for a follow-up — videos publish as-is for now.`
    : `Published ${totalPublished} source assets to the content piece. (No image reframing — only source images can be reframed today.)`;

  return NextResponse.json({
    jobId: (job as any)?.id_job,
    publishedAssetCount: totalPublished,
    derivativeCount: derivativeAssetIds.length,
    contentId,
    note,
  });
}
