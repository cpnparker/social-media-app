import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/commit
 *
 * Marks the shot as approved and writes (or refreshes) its clip on the V1
 * Shots track at the end of the existing sequence. Idempotent — re-running
 * doesn't duplicate clips.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; shotId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;

  // Access check
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace")
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

  // Find the shot
  const { data: shot } = await intelligenceDb
    .from("design_shots")
    .select("id_shot, duration_sec, current_version_id")
    .eq("id_shot", shotId)
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  // Find the V1 video track (created by default at session boot)
  const { data: track } = await intelligenceDb
    .from("design_tracks")
    .select("id_track")
    .eq("id_session", sessionId)
    .eq("kind", "video")
    .order("idx", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!track) return NextResponse.json({ error: "No video track on this session" }, { status: 500 });

  const trackId = (track as any).id_track;

  // Idempotent: is there already a clip for this shot on this track?
  const { data: existingClip } = await intelligenceDb
    .from("design_track_clips")
    .select("id_clip")
    .eq("id_track", trackId)
    .eq("id_shot", shotId)
    .maybeSingle();

  let clipId: string | null = null;
  if (existingClip) {
    clipId = (existingClip as any).id_clip;
  } else {
    // Compute start_sec as the end of the last clip on this track
    const { data: lastClip } = await intelligenceDb
      .from("design_track_clips")
      .select("start_sec, duration_sec")
      .eq("id_track", trackId)
      .order("start_sec", { ascending: false })
      .limit(1)
      .maybeSingle();
    const startSec = lastClip
      ? Number((lastClip as any).start_sec) + Number((lastClip as any).duration_sec)
      : 0;

    const { data: inserted, error } = await intelligenceDb
      .from("design_track_clips")
      .insert({
        id_track: trackId,
        id_shot: shotId,
        start_sec: startSec,
        duration_sec: Number((shot as any).duration_sec),
        in_offset_sec: 0,
        out_offset_sec: 0,
        metadata: {},
      })
      .select("id_clip")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clipId = (inserted as any)?.id_clip || null;
  }

  // Flip the shot to approved
  await intelligenceDb
    .from("design_shots")
    .update({ status: "approved", date_updated: new Date().toISOString() })
    .eq("id_shot", shotId);

  return NextResponse.json({ ok: true, clipId, committedAt: new Date().toISOString() });
}
