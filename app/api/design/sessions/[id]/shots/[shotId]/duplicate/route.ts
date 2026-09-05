import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/duplicate
 *
 * Clones the shot's metadata (title + " copy", beat, duration, model,
 * prompt) into a new shot at the end of the storyboard. Does NOT copy
 * versions, references, or assets — the new shot is empty so the designer
 * can iterate from the same starting point.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; shotId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;

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

  // Source shot
  const { data: src } = await intelligenceDb
    .from("design_shots")
    .select("name_shot, name_beat, duration_sec, model_id, model_note, prompt")
    .eq("id_shot", shotId)
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  // Next idx
  const { count } = await intelligenceDb
    .from("design_shots")
    .select("id_shot", { count: "exact", head: true })
    .eq("id_session", sessionId);
  const nextIdx = (count || 0) + 1;

  const { data: created, error } = await intelligenceDb
    .from("design_shots")
    .insert({
      id_session: sessionId,
      idx: nextIdx,
      name_shot: `${(src as any).name_shot} (copy)`,
      name_beat: (src as any).name_beat,
      duration_sec: (src as any).duration_sec,
      model_id: (src as any).model_id,
      model_note: (src as any).model_note,
      prompt: (src as any).prompt,
      status: "queued",
      flag_on_brand: 1,
    })
    .select("id_shot, idx")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ shot: { id: (created as any).id_shot, idx: (created as any).idx } });
}
