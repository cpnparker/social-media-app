/**
 * Remove one background document from a piece.
 *
 * Scoped by BOTH ids in the WHERE clause, not just the source id. A source id
 * is a uuid a caller supplies, and deleting on it alone would let anyone with
 * access to any session delete a source belonging to a different one — the
 * session check above would pass while the row removed came from elsewhere.
 */
import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../../../_lib/access";
import { listSources } from "@/lib/optimizer/sources";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  const { id, sourceId } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const { error } = await intelligenceDb
    .from("optimizer_sources")
    .delete()
    .eq("id_source", sourceId)
    .eq("id_session", id);

  if (error) {
    console.error("[optimizer] source delete failed:", error.message);
    return NextResponse.json({ error: "Could not remove that" }, { status: 500 });
  }

  const sources = await listSources(id);
  return NextResponse.json({ sources: sources.map((s) => ({ ...s, text: undefined, chars: s.text.length })) });
}
