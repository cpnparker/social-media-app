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
import { normaliseLens } from "@/lib/optimizer/mark-policy";
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
    // THE PRIVACY FLOOR, enforced here rather than by hiding a control.
    //
    // A piece created from a private or incognito-adjacent conversation carries
    // flag_private_source. The thread's privacy is not the piece's to spend: a
    // one-click "start a piece from this answer" must not become a one-click
    // route from a private thread to a team-visible document. The UI hides the
    // Team option for these, but a hidden control is not a guard — this is.
    if (body.visibility === "team" && (owned.session as any).flag_private_source) {
      return NextResponse.json(
        {
          error:
            "This piece came from a private conversation, so it cannot be shared with the team. Copy what you need into a new piece if you want to share it.",
        },
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

  /**
   * The rest of the brief.
   *
   * Only targetQueries was patchable, so everything else — the audience, the
   * takeaway, the length, the voice, and now the whole assignment layer — could
   * be set at CREATE and never changed. A brief you cannot correct is a brief
   * you rewrite by starting a new document.
   *
   * Collaborator-writable, not owner-only: a brief is the shared instruction
   * for the work, unlike the title and the visibility, which are the owner's
   * because they decide what this thing IS and who sees it.
   *
   * Spreads the existing object for the same reason the block above does —
   * config_brief is one jsonb column, and writing a fresh object would erase
   * every field absent from this request.
   */
  const TEXT_FIELDS = ["audience", "goal", "lengthBand", "voice", "commission"] as const;
  const LIST_FIELDS = ["mustInclude", "mustAvoid"] as const;
  const briefPatch: Record<string, unknown> = {};
  for (let i = 0; i < TEXT_FIELDS.length; i++) {
    const k = TEXT_FIELDS[i];
    if (typeof body[k] === "string") briefPatch[k] = body[k].slice(0, 4000);
  }
  for (let i = 0; i < LIST_FIELDS.length; i++) {
    const k = LIST_FIELDS[i];
    if (!Array.isArray(body[k])) continue;
    const out: string[] = [];
    for (let j = 0; j < body[k].length && out.length < 20; j++) {
      const v = body[k][j];
      if (typeof v !== "string") continue;
      const t = v.trim().slice(0, 400);
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    briefPatch[k] = out;
  }
  /**
   * The mark lens for this piece — a person's decision, kept with the piece.
   *
   * In config_brief and not a new column, deliberately: this repo has already
   * left an optimizer feature dark waiting on a hand-run migration, and a lens
   * is exactly the kind of thing the brief is for. Collaborator-writable for
   * the same reason the rest of the brief is.
   *
   * NOTHING TYPE-SHAPED IS ACCEPTED HERE, and that is not an omission. The
   * content type carries a deliberately unnamed value; letting a browser write
   * one would make "set this piece to the quiet type" expressible from the
   * client, which is precisely what verify-optimizer-types check 2 exists to
   * prevent. The lens is two literals, narrowed by a function a script can run.
   */
  if ("lens" in body) {
    const lens = normaliseLens(body.lens);
    if (lens === null && body.lens !== null) {
      return NextResponse.json({ error: "Unknown lens" }, { status: 400 });
    }
    briefPatch.lens = lens;
  }

  if (Object.keys(briefPatch).length > 0) {
    patch.config_brief = { ...(owned.session.config_brief || {}), ...(patch.config_brief || {}), ...briefPatch };
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
