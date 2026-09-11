import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapNotebookEntry } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";

const MAX_NOTE = 2000;

/**
 * Only the entry's AUTHOR may edit or delete it, even inside a team notebook —
 * a shared notebook grants reading, not the right to rewrite someone else's
 * annotation.
 */
async function ownedEntry(id: string, userId: number, workspaceId: string) {
  const { data } = await intelligenceDb
    .from("ai_notebook_entries")
    .select("*")
    .eq("id_entry", id)
    .maybeSingle();
  if (!data || data.id_workspace !== workspaceId || data.user_created !== userId) return null;
  return data;
}

/** PATCH /api/ai/notebook/entries/[id] — annotation, tags, order. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { workspaceId, note, tags, order, clientId } = await req.json();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!(await ownedEntry(id, userId, workspaceId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = { date_updated: new Date().toISOString() };
    if (note !== undefined) patch.document_note = note ? String(note).slice(0, MAX_NOTE) : null;
    if (Array.isArray(tags)) patch.config_tags = tags.slice(0, 12).map((t: unknown) => String(t).slice(0, 40));
    if (typeof order === "number") patch.units_order = Math.trunc(order);
    if (clientId !== undefined) patch.id_client = typeof clientId === "number" ? clientId : null;
    // NOTE: document_quote and flag_private_source are deliberately not
    // patchable. The quote is the captured evidence, and the stamp is the
    // audience floor — letting either be rewritten would let a user relabel
    // private content as shareable.

    const { data, error } = await intelligenceDb
      .from("ai_notebook_entries")
      .update(patch)
      .eq("id_entry", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ entry: mapNotebookEntry(data) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/ai/notebook/entries/[id] */
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
    const entry = await ownedEntry(id, userId, workspaceId);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Deleting a promoted entry leaves its memory in place — the memory is an
    // independent object the user may still rely on. Revoking is an explicit
    // action on the promote route.
    const { error } = await intelligenceDb.from("ai_notebook_entries").delete().eq("id_entry", id);
    if (error) throw error;
    return NextResponse.json({ ok: true, hadMemory: entry.flag_memory === 1 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
