import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * POST /api/design/sessions/[id]/shots — create a shot in this session.
 * Body: { title?, beat?, duration?, modelId?, modelNote?, prompt?, idx? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const body = await req.json();

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
  if (access.permission === "view") {
    return NextResponse.json({ error: "Read-only" }, { status: 403 });
  }

  // Determine idx — default to count+1
  let idx: number;
  if (typeof body.idx === "number") {
    idx = body.idx;
  } else {
    const { count } = await intelligenceDb
      .from("design_shots")
      .select("id_shot", { count: "exact", head: true })
      .eq("id_session", sessionId);
    idx = (count || 0) + 1;
  }

  const { data: created, error } = await intelligenceDb
    .from("design_shots")
    .insert({
      id_session: sessionId,
      idx,
      name_shot: body.title || `Shot ${idx}`,
      name_beat: body.beat || null,
      duration_sec: typeof body.duration === "number" ? body.duration : 5.0,
      model_id: body.modelId || "runway-g4",
      model_note: body.modelNote || null,
      status: "queued",
      flag_on_brand: 1,
      prompt: body.prompt || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shot: mapShot(created) });
}

function mapShot(s: any) {
  if (!s) return null;
  return {
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
    note: s.note,
    currentVersionId: s.current_version_id,
    versions: [],
    refs: [],
  };
}
