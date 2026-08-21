/**
 * PATCH /api/optimizer/sessions/[id] — amend the brief of an open piece.
 *
 * This exists because of imported content. An import has no target query, so
 * Relevance — the heaviest pillar in the rubric — skips, and the writer adds
 * one from the score panel once they can see the gap. That query has to reach
 * the DATABASE, not just React state: the assess route reads `config_brief`
 * from the row, so a query held only in the browser would score in the live
 * engine and be invisible to the judge, and the two numbers would disagree for
 * a reason nobody could see.
 *
 * Deliberately narrow. Only the fields a writer edits after the brief exist
 * here; status, canon, rubric version and client are all set by the server and
 * must not be writable from the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../_lib/access";

export const maxDuration = 30;

const MAX_QUERIES = 5;
const MAX_QUERY_CHARS = 160;

/**
 * DELETE /api/optimizer/sessions/[id] — remove an article.
 *
 * OWNER ONLY, matching how a conversation is deleted. A team article is
 * editable by any workspace member, but deleting one is not editing it: the
 * collaborator loses nothing and the owner loses the piece, and there is no
 * undo. The drafts, assessments and findings go with it by FK cascade.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  if (owned.permission !== "owner") {
    return NextResponse.json({ error: "Only the owner can delete this piece" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("optimizer_sessions")
    .delete()
    .eq("id_session", id)
    // Ownership was checked above; this is belt and braces on a service-role
    // client that bypasses RLS, where a wrong id is an unscoped delete.
    .eq("id_workspace", guard.caller.workspaceId)
    .eq("user_created", guard.caller.userId);

  if (error) {
    console.error("[optimizer] delete failed:", error.message);
    return NextResponse.json({ error: "Could not delete that" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const isOwner = owned.permission === "owner";

  const patch: any = { date_updated: new Date().toISOString() };

  // Renaming and publishing are the owner's, matching conversations: a
  // collaborator on a team article can do the WORK (edit the draft, sharpen the
  // brief) without being able to rename it out from under the person whose
  // sidebar it lives in, or unpublish it.
  if (typeof body.title === "string" && body.title.trim()) {
    if (!isOwner) {
      return NextResponse.json({ error: "Only the owner can rename this piece" }, { status: 403 });
    }
    patch.name_title = body.title.trim().slice(0, 300);
  }

  if (typeof body.visibility === "string") {
    if (["private", "team"].indexOf(body.visibility) < 0) {
      return NextResponse.json({ error: "Unknown visibility" }, { status: 400 });
    }
    if (!isOwner) {
      return NextResponse.json(
        { error: "Only the owner can change who can see this piece" },
        { status: 403 }
      );
    }
    patch.type_visibility = body.visibility;
  }

  if (Array.isArray(body.targetQueries)) {
    const seen: string[] = [];
    for (let i = 0; i < body.targetQueries.length; i++) {
      const q = body.targetQueries[i];
      if (typeof q !== "string") continue;
      const trimmed = q.trim().slice(0, MAX_QUERY_CHARS);
      if (!trimmed) continue;
      if (seen.indexOf(trimmed) >= 0) continue;
      seen.push(trimmed);
      if (seen.length >= MAX_QUERIES) break;
    }
    // Spread the EXISTING brief so a partial patch cannot silently drop the
    // audience, goal or voice the generation was briefed with — config_brief is
    // one jsonb column, so writing a fresh object would erase everything absent
    // from this request.
    patch.config_brief = { ...(owned.session.config_brief || {}), targetQueries: seen };
  }

  // Nothing but the timestamp: refuse rather than writing a no-op row that
  // reorders the session list for no reason.
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await intelligenceDb
    .from("optimizer_sessions")
    .update(patch)
    .eq("id_session", id)
    // Ownership was already checked; this is belt and braces on a service-role
    // client that bypasses RLS, where a wrong id is an unscoped write.
    .eq("id_workspace", guard.caller.workspaceId);

  if (error) {
    console.error("[optimizer] session patch failed:", error.message);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    targetQueries: patch.config_brief ? patch.config_brief.targetQueries : undefined,
    title: patch.name_title,
  });
}
