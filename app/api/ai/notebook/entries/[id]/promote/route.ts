import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapNotebookEntry } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { createMemory } from "@/lib/ai/memory-create";

/**
 * Promote a notebook entry to a real memory, and revoke it again.
 *
 * This is the ONLY path from notebook to ai_memories, and it is always an
 * explicit user action. Nothing here writes memories in bulk: the cap is 50 per
 * user per workspace and every active memory is rendered into every system
 * prompt, so the notebook's job is to be searchable, not to be resident.
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

/** POST — promote. Body: { workspaceId, scope?, category? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { workspaceId, scope, category } = await req.json();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const entry = await ownedEntry(id, userId, workspaceId);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.flag_memory === 1 && entry.id_memory) {
      return NextResponse.json({ error: "Already saved as a memory" }, { status: 400 });
    }

    // The memory text is the user's annotation when there is one — that is the
    // sentence they actually want remembered — else the captured quote.
    const content = (entry.document_note || entry.document_quote || "").toString().trim();
    if (!content) return NextResponse.json({ error: "Nothing to remember" }, { status: 400 });

    const result = await createMemory({
      workspaceId,
      userId,
      memberRole,
      content,
      category: category || "fact",
      scope: scope === "team" ? "team" : "private",
      sourceConversationId: entry.id_conversation,
      // The stamped floor outranks any lookup. Without this, an entry captured
      // from a private thread that was later DELETED has id_conversation NULL,
      // so createMemory would find no source to downgrade against and could
      // mint a team memory out of private content.
      forcePrivate: entry.flag_private_source === 1,
      source: "notebook",
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const { data: updated, error } = await intelligenceDb
      .from("ai_notebook_entries")
      .update({ flag_memory: 1, id_memory: result.memory.id, date_updated: new Date().toISOString() })
      .eq("id_entry", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({
      entry: mapNotebookEntry(updated),
      memory: result.memory,
      ...(result.notice ? { notice: result.notice } : {}),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE — revoke: archive the memory and unlink it from the entry. */
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

    if (entry.id_memory) {
      // Archive rather than delete, matching how memories are retired
      // elsewhere, and scope the update so a stale id can't touch another row.
      await intelligenceDb
        .from("ai_memories")
        .update({ flag_active: 0 })
        .eq("id_memory", entry.id_memory)
        .eq("id_workspace", workspaceId);
    }

    const { data: updated, error } = await intelligenceDb
      .from("ai_notebook_entries")
      .update({ flag_memory: 0, id_memory: null, date_updated: new Date().toISOString() })
      .eq("id_entry", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ entry: mapNotebookEntry(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
