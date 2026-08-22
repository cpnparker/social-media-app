import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapNotebookEntry } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { canReadNotebook, stampPrivateSource, type NotebookRow } from "@/lib/notebook/access";

const MAX_QUOTE = 8000;
const MAX_NOTE = 2000;
const MAX_ENTRIES_PER_NOTEBOOK = 500;
const ENTRY_TYPES = ["highlight", "answer", "prompt", "note"] as const;

/**
 * POST /api/ai/notebook/entries — save a capture.
 *
 * The quote is supplied by the client (it is a selection out of a rendered
 * message), so provenance is NOT taken on trust: stampPrivateSource resolves
 * the named conversation, checks it is in this workspace and readable by this
 * caller, and returns a private stamp for anything it cannot confirm.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const {
      workspaceId, notebookId, quote, note, type, conversationId, messageId, clientId, tags,
    } = body;

    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    if (!quote || !String(quote).trim()) {
      return NextResponse.json({ error: "quote is required" }, { status: 400 });
    }
    if (type !== undefined && !ENTRY_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${ENTRY_TYPES.join(", ")}` }, { status: 400 });
    }
    if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Resolve the target notebook — explicit, else the caller's default, which
    // is created lazily on first save so the UI never has to bootstrap one.
    let notebook: NotebookRow | null = null;
    if (notebookId) {
      const { data } = await intelligenceDb
        .from("ai_notebooks").select("*").eq("id_notebook", notebookId).maybeSingle();
      // You may only write into a notebook you own. Team visibility grants
      // READ across the workspace, not the right to add to someone else's book.
      if (!data || !canReadNotebook(data as NotebookRow, userId, workspaceId) || data.user_created !== userId) {
        return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
      }
      notebook = data as NotebookRow;
    } else {
      const { data } = await intelligenceDb
        .from("ai_notebooks").select("*")
        .eq("id_workspace", workspaceId).eq("user_created", userId).eq("flag_archived", 0)
        .order("date_created", { ascending: true }).limit(1).maybeSingle();
      if (data) {
        notebook = data as NotebookRow;
      } else {
        const { data: created, error: createErr } = await intelligenceDb
          .from("ai_notebooks")
          .insert({ id_workspace: workspaceId, user_created: userId, name_title: "Notebook" })
          .select().single();
        if (createErr) throw createErr;
        notebook = created as NotebookRow;
      }
    }

    const { count } = await intelligenceDb
      .from("ai_notebook_entries")
      .select("*", { count: "exact", head: true })
      .eq("id_notebook", notebook.id_notebook);
    if ((count || 0) >= MAX_ENTRIES_PER_NOTEBOOK) {
      return NextResponse.json(
        { error: `This notebook is full (${MAX_ENTRIES_PER_NOTEBOOK} entries). Create another to keep saving.` },
        { status: 400 }
      );
    }

    const stamp = await stampPrivateSource(conversationId, workspaceId, userId);

    const { data, error } = await intelligenceDb
      .from("ai_notebook_entries")
      .insert({
        id_notebook: notebook.id_notebook,
        id_workspace: workspaceId,
        user_created: userId,
        type_entry: type || "highlight",
        document_quote: String(quote).slice(0, MAX_QUOTE),
        document_note: note ? String(note).slice(0, MAX_NOTE) : null,
        id_conversation: stamp.conversationId,
        // Only keep the message pointer when the conversation itself was
        // verified — a message id from an unreadable thread is not provenance.
        id_message: stamp.conversationId && messageId ? messageId : null,
        name_source_title: stamp.sourceTitle,
        flag_private_source: stamp.flag,
        id_client: typeof clientId === "number" ? clientId : null,
        config_tags: Array.isArray(tags) ? tags.slice(0, 12).map((t: unknown) => String(t).slice(0, 40)) : [],
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ entry: mapNotebookEntry(data), notebookId: notebook.id_notebook });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
