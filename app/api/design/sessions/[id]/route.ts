import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * GET /api/design/sessions/[id]
 * Returns the full session: session row, brand kit snapshot, shots (with current
 * version), references, tracks + clips, audio tracks, content/customer metadata.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = params.id;

  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("*")
    .eq("id_session", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await checkSessionAccess(id, userId, {
    visibility: (row as any).type_visibility,
    userCreated: (row as any).user_created,
    workspaceId: (row as any).id_workspace,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parallel fetches for child entities + scope metadata
  const [
    { data: brandKit },
    { data: shotsRaw },
    { data: tracksRaw },
    { data: clipsRaw },
    { data: refsRaw },
    { data: versionsRaw },
    { data: client },
    { data: content },
  ] = await Promise.all([
    (row as any).id_brand_kit_snapshot
      ? intelligenceDb.from("design_brand_kits").select("*").eq("id_brand_kit", (row as any).id_brand_kit_snapshot).maybeSingle()
      : Promise.resolve({ data: null }),
    intelligenceDb.from("design_shots").select("*").eq("id_session", id).order("idx", { ascending: true }),
    intelligenceDb.from("design_tracks").select("*").eq("id_session", id).order("idx", { ascending: true }),
    intelligenceDb.from("design_track_clips").select("*, design_tracks!inner(id_session)").eq("design_tracks.id_session", id),
    intelligenceDb.from("design_shot_references").select("*, design_shots!inner(id_session)").eq("design_shots.id_session", id),
    intelligenceDb.from("design_shot_versions").select("*, design_shots!inner(id_session)").eq("design_shots.id_session", id),
    (row as any).id_client
      ? supabase.from("app_clients").select("id_client, name_client, information_industry").eq("id_client", (row as any).id_client).maybeSingle()
      : Promise.resolve({ data: null }),
    (row as any).id_content
      ? supabase.from("app_content").select("id_content, name_content, type_content, information_brief, name_owner, date_due, name_pillar").eq("id_content", (row as any).id_content).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Resolve asset blob URLs for the versions (needed so the canvas can render them)
  const assetIds = Array.from(new Set(
    (versionsRaw || []).map((v: any) => v.id_asset).filter(Boolean)
  ));
  let assetMap = new Map<string, { url: string; type: string }>();
  if (assetIds.length > 0) {
    const { data: assets } = await intelligenceDb
      .from("ai_design_assets")
      .select("id_asset, blob_url, type_asset")
      .in("id_asset", assetIds);
    assetMap = new Map(
      (assets || []).map((a: any) => [a.id_asset, { url: a.blob_url, type: a.type_asset }])
    );
  }

  // Also resolve URLs for any reference assets
  const refAssetIds = Array.from(new Set(
    (refsRaw || []).map((r: any) => r.id_asset).filter(Boolean)
  ));
  let refAssetMap = new Map<string, string>();
  if (refAssetIds.length > 0) {
    const { data: refAssets } = await intelligenceDb
      .from("ai_design_assets")
      .select("id_asset, blob_url")
      .in("id_asset", refAssetIds);
    refAssetMap = new Map((refAssets || []).map((a: any) => [a.id_asset, a.blob_url]));
  }

  const session_payload = {
    id: (row as any).id_session,
    workspaceId: (row as any).id_workspace,
    userCreated: (row as any).user_created,
    name: (row as any).name_session,
    visibility: (row as any).type_visibility,
    isIncognito: !!(row as any).flag_incognito,
    timelineShape: (row as any).type_timeline_shape,
    currentShotId: (row as any).current_shot_id,
    clientId: (row as any).id_client,
    contentId: (row as any).id_content,
    myPermission: access.permission,
    createdAt: (row as any).date_created,
    updatedAt: (row as any).date_updated,
  };

  const brandKitPayload = brandKit ? {
    id: (brandKit as any).id_brand_kit,
    versionTag: (brandKit as any).version_tag,
    visualIdentity: (brandKit as any).visual_identity,
  } : null;

  const versionsByShot = new Map<string, any[]>();
  (versionsRaw || []).forEach((v: any) => {
    const arr = versionsByShot.get(v.id_shot) || [];
    const asset = v.id_asset ? assetMap.get(v.id_asset) : null;
    arr.push({
      id: v.id_version,
      idx: v.idx,
      assetId: v.id_asset,
      assetUrl: asset?.url || null,
      assetType: asset?.type || null,
      promptUsed: v.prompt_used,
      modelId: v.model_id,
      metadata: v.metadata,
      createdAt: v.date_created,
    });
    versionsByShot.set(v.id_shot, arr);
  });

  const refsByShot = new Map<string, any[]>();
  (refsRaw || []).forEach((r: any) => {
    const arr = refsByShot.get(r.id_shot) || [];
    arr.push({
      id: r.id_reference,
      idx: r.idx,
      assetId: r.id_asset,
      assetUrl: r.id_asset ? refAssetMap.get(r.id_asset) || null : null,
      externalUrl: r.external_url,
      seedLocked: !!r.seed_locked,
      caption: r.caption,
    });
    refsByShot.set(r.id_shot, arr);
  });

  const shots = (shotsRaw || []).map((s: any) => ({
    id: s.id_shot,
    idx: s.idx,
    title: s.name_shot,
    beat: s.name_beat,
    duration: Number(s.duration_sec),
    modelId: s.model_id,
    modelNote: s.model_note,
    status: s.status,
    onBrand: s.flag_on_brand === 1,
    prompt: s.prompt,
    promptOverrides: s.prompt_overrides,
    note: s.note,
    seedValue: s.seed_value,
    seedLockedFrom: s.seed_locked_from_shot_id,
    currentVersionId: s.current_version_id,
    versions: (versionsByShot.get(s.id_shot) || []).sort((a, b) => a.idx - b.idx),
    refs: refsByShot.get(s.id_shot) || [],
  }));

  const clipsByTrack = new Map<string, any[]>();
  (clipsRaw || []).forEach((c: any) => {
    const arr = clipsByTrack.get(c.id_track) || [];
    arr.push({
      id: c.id_clip,
      shotId: c.id_shot,
      assetId: c.id_asset,
      startSec: Number(c.start_sec),
      durationSec: Number(c.duration_sec),
      inOffsetSec: Number(c.in_offset_sec),
      outOffsetSec: Number(c.out_offset_sec),
      metadata: c.metadata,
    });
    clipsByTrack.set(c.id_track, arr);
  });

  const tracks = (tracksRaw || []).map((t: any) => ({
    id: t.id_track,
    kind: t.kind,
    idx: t.idx,
    label: t.label,
    clips: (clipsByTrack.get(t.id_track) || []).sort((a, b) => a.startSec - b.startSec),
  }));

  return NextResponse.json({
    session: session_payload,
    brandKit: brandKitPayload,
    shots,
    tracks,
    client: client ? { id: (client as any).id_client, name: (client as any).name_client, industry: (client as any).information_industry } : null,
    content: content ? {
      id: (content as any).id_content,
      title: (content as any).name_content,
      type: (content as any).type_content,
      brief: (content as any).information_brief,
      owner: (content as any).name_owner,
      dueDate: (content as any).date_due,
      pillar: (content as any).name_pillar,
    } : null,
  });
}

/**
 * PATCH /api/design/sessions/[id]
 * Body: { name?, visibility?, timelineShape?, currentShotId? }
 *
 * Only the owner can change visibility. Collaborators can update
 * currentShotId / timelineShape (UI state). View shares cannot mutate.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = params.id;
  const body = await req.json();

  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace")
    .eq("id_session", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await checkSessionAccess(id, userId, {
    visibility: (row as any).type_visibility,
    userCreated: (row as any).user_created,
    workspaceId: (row as any).id_workspace,
  });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.permission === "view") {
    return NextResponse.json({ error: "Read-only access — cannot mutate" }, { status: 403 });
  }

  const patch: Record<string, unknown> = { date_updated: new Date().toISOString() };
  if (typeof body.name === "string") patch.name_session = body.name;
  if (typeof body.timelineShape === "string") patch.type_timeline_shape = body.timelineShape;
  if (typeof body.currentShotId === "string" || body.currentShotId === null) patch.current_shot_id = body.currentShotId;

  // Visibility change is owner-only
  if (typeof body.visibility === "string") {
    if (access.permission !== "owner") {
      return NextResponse.json({ error: "Only the owner can change visibility" }, { status: 403 });
    }
    patch.type_visibility = body.visibility === "team" ? "team" : "private";
  }

  const { data: updated, error } = await intelligenceDb
    .from("design_sessions")
    .update(patch)
    .eq("id_session", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session: updated });
}

/**
 * DELETE /api/design/sessions/[id] — owner only.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = params.id;

  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("user_created")
    .eq("id_session", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).user_created !== userId) {
    return NextResponse.json({ error: "Only the owner can delete" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_sessions")
    .delete()
    .eq("id_session", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
