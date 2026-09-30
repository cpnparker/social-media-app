import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * PATCH /api/design/sessions/[id]/clips/[clipId]
 *
 * Update a timeline clip's timing — start_sec, duration_sec, in/out offsets.
 * Used by the tracks-view drag-to-trim handles.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; clipId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const clipId = params.clipId;
  const body = await req.json().catch(() => ({}));

  // Access
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

  // Verify the clip belongs to a track in this session
  const { data: clip } = await intelligenceDb
    .from("design_track_clips")
    .select("id_clip, id_track, design_tracks!inner(id_session)")
    .eq("id_clip", clipId)
    .maybeSingle();
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  if ((clip as any).design_tracks.id_session !== sessionId) {
    return NextResponse.json({ error: "Clip not in this session" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.startSec === "number" && body.startSec >= 0) patch.start_sec = body.startSec;
  if (typeof body.durationSec === "number" && body.durationSec > 0) patch.duration_sec = body.durationSec;
  if (typeof body.inOffsetSec === "number" && body.inOffsetSec >= 0) patch.in_offset_sec = body.inOffsetSec;
  if (typeof body.outOffsetSec === "number" && body.outOffsetSec >= 0) patch.out_offset_sec = body.outOffsetSec;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await intelligenceDb
    .from("design_track_clips")
    .update(patch)
    .eq("id_clip", clipId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/design/sessions/[id]/clips/[clipId] — remove a clip from a track.
 * Note: this doesn't delete the underlying shot or asset.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; clipId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const clipId = params.clipId;

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
  if (!access.allowed || access.permission === "view") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_track_clips")
    .delete()
    .eq("id_clip", clipId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
