import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapNotebook } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { canWriteNotebook, type NotebookRow } from "@/lib/notebook/access";

/** Load the notebook and confirm the caller may modify it (owner only). */
async function ownedNotebook(id: string, userId: number, workspaceId: string) {
  const { data } = await intelligenceDb
    .from("ai_notebooks")
    .select("*")
    .eq("id_notebook", id)
    .maybeSingle();
  return canWriteNotebook(data as NotebookRow | null, userId, workspaceId) ? data : null;
}

/** PATCH /api/ai/notebook/[id] — rename, share/unshare, archive. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const body = await req.json();
    const { workspaceId, title, description, visibility, archived } = body;
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (visibility !== undefined && visibility !== "private" && visibility !== "team") {
      return NextResponse.json({ error: "visibility must be 'private' or 'team'" }, { status: 400 });
    }

    // Only the owner may share a notebook. Sharing is not a re-classification
    // of the entries inside it: captures taken from private threads stay with
    // their author regardless, enforced on read in lib/notebook/access.ts.
    const nb = await ownedNotebook(id, userId, workspaceId);
    if (!nb) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const patch: Record<string, unknown> = { date_updated: new Date().toISOString() };
    if (title !== undefined) patch.name_title = String(title).slice(0, 120);
    if (description !== undefined) {
      patch.document_description = description ? String(description).slice(0, 500) : null;
    }
    if (visibility !== undefined) patch.type_visibility = visibility;
    if (archived !== undefined) patch.flag_archived = archived ? 1 : 0;

    const { data, error } = await intelligenceDb
      .from("ai_notebooks")
      .update(patch)
      .eq("id_notebook", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ notebook: mapNotebook(data) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/ai/notebook/[id] — removes the notebook and cascades entries. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  try {
    if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const nb = await ownedNotebook(id, userId, workspaceId);
    if (!nb) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error } = await intelligenceDb.from("ai_notebooks").delete().eq("id_notebook", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
