import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";
import { generateShotVersion } from "@/lib/design/generate-shot";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/generate
 *
 * Thin HTTP wrapper around the pure generateShotVersion server function.
 * Handles auth + access; everything else lives in lib/design/generate-shot.ts
 * so the AI streamer can call it directly.
 *
 * Body (optional overrides):
 *   - modelId  — override shot.modelId
 *   - prompt   — override shot.prompt
 *   - format   — 'landscape' | 'portrait' | 'square'
 *   - duration — 5 | 10 (video only)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; shotId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;
  const body = await req.json().catch(() => ({}));

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

  const result = await generateShotVersion(sessionId, shotId, userId, {
    modelId: body.modelId,
    prompt: body.prompt,
    format: body.format,
    duration: body.duration === 10 ? 10 : 5,
  });

  if (!result.ok) {
    const status = result.code === "session_not_found" || result.code === "shot_not_found" ? 404
      : result.code === "no_prompt" ? 400
      : result.code === "model_unavailable" ? 501
      : 500;
    return NextResponse.json({ error: result.message }, { status });
  }

  return NextResponse.json({ version: result.version, shot: result.shot });
}
