import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

async function authForMutation(sessionId: string, userId: number) {
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return { ok: false, error: "Session not found", status: 404 } as const;

  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed) return { ok: false, error: "Forbidden", status: 403 } as const;
  if (access.permission === "view") return { ok: false, error: "Read-only", status: 403 } as const;
  return { ok: true } as const;
}

/**
 * PATCH /api/design/sessions/[id]/shots/[shotId]
 * Body: { title?, beat?, duration?, modelId?, modelNote?, prompt?, status?, onBrand?, note?, idx?, currentVersionId? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; shotId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;
  const body = await req.json();

  const authz = await authForMutation(sessionId, userId);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const patch: Record<string, unknown> = { date_updated: new Date().toISOString() };
  if (typeof body.title === "string") patch.name_shot = body.title;
  if (typeof body.beat === "string" || body.beat === null) patch.name_beat = body.beat;
  if (typeof body.duration === "number") patch.duration_sec = body.duration;
  if (typeof body.modelId === "string") patch.model_id = body.modelId;
  if (typeof body.modelNote === "string" || body.modelNote === null) patch.model_note = body.modelNote;
  if (typeof body.prompt === "string" || body.prompt === null) patch.prompt = body.prompt;
  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.onBrand === "boolean") patch.flag_on_brand = body.onBrand ? 1 : 0;
  if (typeof body.note === "string" || body.note === null) patch.note = body.note;
  if (typeof body.idx === "number") patch.idx = body.idx;
  if (typeof body.currentVersionId === "string" || body.currentVersionId === null) patch.current_version_id = body.currentVersionId;

  const { error } = await intelligenceDb
    .from("design_shots")
    .update(patch)
    .eq("id_shot", shotId)
    .eq("id_session", sessionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; shotId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;

  const authz = await authForMutation(sessionId, userId);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const { error } = await intelligenceDb
    .from("design_shots")
    .delete()
    .eq("id_shot", shotId)
    .eq("id_session", sessionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
