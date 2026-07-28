import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapNotebook, mapNotebookEntry } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import {
  canReadNotebook,
  loadSourceVisibility,
  visibleEntries,
  type NotebookRow,
} from "@/lib/notebook/access";

const MAX_NOTEBOOKS = 20;

/**
 * GET /api/ai/notebook?workspaceId=...
 * Returns the caller's notebooks plus every team notebook in the workspace,
 * each with the entries THIS caller is allowed to see. The per-entry audience
 * ceiling lives in lib/notebook/access.ts — see the note there on why the
 * stamped flag and the live thread lookup are both required.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data: notebooks, error } = await intelligenceDb
      .from("ai_notebooks")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("flag_archived", 0)
      .or(`user_created.eq.${userId},type_visibility.eq.team`)
      .order("date_created", { ascending: true });
    if (error) throw error;

    const rows = (notebooks || []) as NotebookRow[];
    if (rows.length === 0) return NextResponse.json({ notebooks: [], entries: [] });

    const { data: entryRows, error: entryErr } = await intelligenceDb
      .from("ai_notebook_entries")
      .select("*")
      .in("id_notebook", rows.map((n) => n.id_notebook))
      .order("units_order", { ascending: true })
      .order("date_created", { ascending: false });
    if (entryErr) throw entryErr;

    const all = entryRows || [];
    const sourceVisibility = await loadSourceVisibility(all);
    const byNotebook = new Map(rows.map((n) => [n.id_notebook, n]));
    const allowed = all.filter((e) => {
      const nb = byNotebook.get(e.id_notebook);
      if (!nb || !canReadNotebook(nb, userId, workspaceId)) return false;
      return visibleEntries([e as any], nb, userId, sourceVisibility).length === 1;
    });

    return NextResponse.json({
      notebooks: rows.map(mapNotebook),
      entries: allowed.map(mapNotebookEntry),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST /api/ai/notebook — create a notebook. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  try {
    const { workspaceId, title, description, visibility } = await req.json();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate the enum at EVERY write site — a PATCH-only check has been the
    // hole here before.
    if (visibility !== undefined && visibility !== "private" && visibility !== "team") {
      return NextResponse.json({ error: "visibility must be 'private' or 'team'" }, { status: 400 });
    }

    const { count } = await intelligenceDb
      .from("ai_notebooks")
      .select("*", { count: "exact", head: true })
      .eq("id_workspace", workspaceId)
      .eq("user_created", userId)
      .eq("flag_archived", 0);
    if ((count || 0) >= MAX_NOTEBOOKS) {
      return NextResponse.json(
        { error: `Notebook limit reached (${MAX_NOTEBOOKS}). Archive one to create another.` },
        { status: 400 }
      );
    }

    const { data, error } = await intelligenceDb
      .from("ai_notebooks")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        name_title: (title || "Notebook").toString().slice(0, 120),
        document_description: description ? String(description).slice(0, 500) : null,
        type_visibility: visibility || "private",
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ notebook: mapNotebook(data) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
