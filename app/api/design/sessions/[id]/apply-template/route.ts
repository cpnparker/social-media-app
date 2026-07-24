import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";
import { findTemplate } from "@/lib/design/templates";

/**
 * POST /api/design/sessions/[id]/apply-template
 * Body: { templateId }
 *
 * Inserts the template's shot seeds into the session. Idx auto-increments
 * from the current count. Doesn't generate — designers iterate on the
 * prompts before kicking generation.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const body = await req.json();
  const templateId: string = body.templateId;

  const template = findTemplate(templateId);
  if (!template) return NextResponse.json({ error: "Unknown template" }, { status: 400 });

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

  // Current shot count to set idx
  const { count } = await intelligenceDb
    .from("design_shots")
    .select("id_shot", { count: "exact", head: true })
    .eq("id_session", sessionId);
  const baseIdx = count || 0;

  const rows = template.shots.map((s, i) => ({
    id_session: sessionId,
    idx: baseIdx + i + 1,
    name_shot: s.title,
    name_beat: s.beat || null,
    duration_sec: s.duration,
    model_id: s.modelId,
    status: "queued",
    flag_on_brand: 1,
    prompt: s.prompt,
  }));

  const { data: inserted, error } = await intelligenceDb
    .from("design_shots")
    .insert(rows)
    .select("id_shot, idx");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the session has no current shot yet, focus the first one created
  if (inserted && inserted.length > 0) {
    await intelligenceDb
      .from("design_sessions")
      .update({ current_shot_id: (inserted[0] as any).id_shot, date_updated: new Date().toISOString() })
      .eq("id_session", sessionId);
  }

  return NextResponse.json({
    templateId,
    templateName: template.name,
    shotsCreated: inserted?.length || 0,
    firstShotId: (inserted?.[0] as any)?.id_shot || null,
  });
}
