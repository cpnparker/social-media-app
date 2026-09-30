/**
 * Version history for a draft.
 *
 * ── WHY THIS NEEDED NO MIGRATION AND NO NEW TABLE ───────────────────────────
 *
 * `optimizer_drafts` has carried `units_version`, `units_words` and
 * `date_created` since the first migration, with a UNIQUE index on
 * (session, version). What it did NOT have was anything writing more than one
 * row: generation inserts a new version, and the autosave PATCH updates the
 * latest row IN PLACE. So a writer's whole editing history — including every
 * change applied from the conversation — overwrote itself, and the version
 * column recorded only how many times a draft had been generated.
 *
 * ── WHAT COUNTS AS A VERSION ────────────────────────────────────────────────
 *
 * Not every keystroke. The editor autosaves on a 600ms debounce, so a row per
 * save would be thousands of near-identical rows and a history nobody could
 * read. A version is cut where the writer would want to go BACK to: before a
 * change they did not type themselves — a rewrite applied from the
 * conversation — and before a restore, so undoing a restore is possible too.
 *
 * ── THE ORDERING PROBLEM, AND WHY THE CLIENT SENDS BOTH BODIES ──────────────
 *
 * The obvious shape — "snapshot the current row, then let autosave write the
 * new content" — races its own autosave. The debounce can fire first, writing
 * the NEW content into the row we were about to preserve, and the snapshot then
 * copies the new content into both rows: history silently lost, with the
 * feature appearing to work.
 *
 * So the caller sends what it had AND what it now has. The server pins the
 * previous version to `previous` and inserts `next` above it, which is correct
 * whichever order the autosave landed in. The client knows both truths; the
 * server should not have to guess at one of them.
 */
import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";

export const maxDuration = 30;

/** A history nobody can scroll is not a history. Oldest fall off. */
const MAX_VERSIONS = 40;

const wordsIn = (html: string) =>
  (String(html || "").replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const wanted = req.nextUrl.searchParams.get("version");

  // One version's body, for preview or restore. Requested explicitly because
  // the list must not carry every body — forty drafts of an article is
  // megabytes over the wire to render a list of dates.
  if (wanted) {
    const { data, error } = await intelligenceDb
      .from("optimizer_drafts")
      .select("units_version, document_body, units_words, date_created")
      .eq("id_session", id)
      .eq("units_version", Number(wanted))
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Could not read that version" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "No such version" }, { status: 404 });
    return NextResponse.json({ version: data });
  }

  const { data, error } = await intelligenceDb
    .from("optimizer_drafts")
    .select("units_version, units_words, date_created")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(MAX_VERSIONS);

  if (error) return NextResponse.json({ error: "Could not read the history" }, { status: 500 });
  return NextResponse.json({ versions: data || [] });
}

/**
 * Cut a version: pin what was there, and record what replaced it.
 *
 * Both bodies come from the caller for the reason in the header — the autosave
 * debounce can land either side of this call, and only the client knows both
 * states with certainty.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body?.workspaceId || null);
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const previous = typeof body?.previous === "string" ? body.previous : null;
  const next = typeof body?.next === "string" ? body.next : null;
  if (previous === null || next === null) {
    return NextResponse.json({ error: "Both bodies are required" }, { status: 400 });
  }
  // Nothing actually changed. A version whose content equals the one below it
  // is a row that makes the history longer and tells the reader nothing.
  if (previous === next) return NextResponse.json({ cut: false });

  const { data: rows, error: readError } = await intelligenceDb
    .from("optimizer_drafts")
    .select("id_draft, units_version")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(1);
  if (readError) return NextResponse.json({ error: "Could not read the draft" }, { status: 500 });

  const latest = rows && rows.length > 0 ? (rows[0] as any) : null;

  if (!latest) {
    // No draft row at all: the piece has never been saved. There is no history
    // to preserve, so this is simply version 1.
    const { error } = await intelligenceDb.from("optimizer_drafts").insert({
      id_session: id,
      units_version: 1,
      document_body: next,
      units_words: wordsIn(next),
    });
    if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
    return NextResponse.json({ cut: true, version: 1 });
  }

  // Pin the old content to the existing row, whether or not the autosave has
  // already overwritten it with the new content.
  await intelligenceDb
    .from("optimizer_drafts")
    .update({ document_body: previous, units_words: wordsIn(previous) })
    .eq("id_draft", latest.id_draft);

  const version = latest.units_version + 1;
  const { error } = await intelligenceDb.from("optimizer_drafts").insert({
    id_session: id,
    units_version: version,
    document_body: next,
    units_words: wordsIn(next),
  });
  if (error) {
    // The unique index on (session, version) is doing its job: two applies in
    // the same instant computed the same next version. The draft itself is
    // safe — the autosave owns it — so this is a lost history entry, not lost
    // work, and it says so rather than failing the writer's edit.
    console.error("[optimizer] version cut failed:", error.message);
    return NextResponse.json({ cut: false, error: "Could not record that version" }, { status: 200 });
  }

  // Trim, oldest first, keeping the row the autosave is writing into.
  const { data: all } = await intelligenceDb
    .from("optimizer_drafts")
    .select("id_draft, units_version")
    .eq("id_session", id)
    .order("units_version", { ascending: false });
  if (all && all.length > MAX_VERSIONS) {
    const doomed = all.slice(MAX_VERSIONS).map((r: any) => r.id_draft);
    if (doomed.length > 0) {
      await intelligenceDb.from("optimizer_drafts").delete().in("id_draft", doomed);
    }
  }

  return NextResponse.json({ cut: true, version });
}
