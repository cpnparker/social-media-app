import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

/**
 * GET /api/design/saved-prompts?workspaceId=...&q=...
 * Returns the user's own saved prompts + any team-shared ones in the workspace.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const q = (searchParams.get("q") || "").trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = intelligenceDb
    .from("design_saved_prompts")
    .select("*")
    .eq("id_workspace", workspaceId)
    .or(`user_created.eq.${userId},flag_team.eq.1`)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(80);

  if (q) {
    query = query.or(`name_prompt.ilike.%${q}%,prompt_text.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prompts: (data || []).map((p: any) => ({
      id: p.id_prompt,
      name: p.name_prompt,
      prompt: p.prompt_text,
      modelHint: p.model_hint,
      tags: p.tags || [],
      useCount: p.use_count,
      lastUsedAt: p.last_used_at,
      isTeam: p.flag_team === 1,
      isMine: p.user_created === userId,
      createdAt: p.date_created,
    })),
  });
}

/**
 * POST /api/design/saved-prompts — save a new prompt to the library.
 * Body: { workspaceId, name, prompt, modelHint?, tags?, team? }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const body = await req.json();
  const { workspaceId, name, prompt, modelHint, tags, team } = body;
  if (!workspaceId || !name?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: "workspaceId, name, prompt required" }, { status: 400 });
  }
  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: created, error } = await intelligenceDb
    .from("design_saved_prompts")
    .insert({
      id_workspace: workspaceId,
      user_created: userId,
      name_prompt: name.trim().slice(0, 120),
      prompt_text: prompt.trim(),
      model_hint: modelHint || null,
      tags: Array.isArray(tags) ? tags.map((t: any) => String(t)).slice(0, 10) : null,
      flag_team: team ? 1 : 0,
    })
    .select("id_prompt")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: (created as any).id_prompt });
}

/**
 * PATCH /api/design/saved-prompts — bump use_count when applied to a shot.
 * Body: { id }
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const body = await req.json();
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Anyone with read access can bump their own use_count; we don't restrict here
  // since the prompt library is intentionally open within a workspace.
  const { data: row } = await intelligenceDb
    .from("design_saved_prompts")
    .select("use_count, id_workspace")
    .eq("id_prompt", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await verifyWorkspaceMembership(userId, (row as any).id_workspace))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_saved_prompts")
    .update({
      use_count: ((row as any).use_count || 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id_prompt", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/design/saved-prompts?id=... — delete (creator only).
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: row } = await intelligenceDb
    .from("design_saved_prompts")
    .select("user_created")
    .eq("id_prompt", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).user_created !== userId) {
    return NextResponse.json({ error: "Only the creator can delete" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_saved_prompts")
    .delete()
    .eq("id_prompt", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
