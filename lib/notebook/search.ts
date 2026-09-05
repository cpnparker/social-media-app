/**
 * search_notebook — the model's read path into a user's saved clippings.
 *
 * The notebook is deliberately NOT resident in the system prompt: ai_memories
 * is capped at 50 per user and every active row is rendered into every turn, so
 * a scrapbook that grows to hundreds of entries has to be fetched on demand.
 * Only a one-line index (count + recent topics) goes into the prompt, enough
 * for the model to know the notebook exists and reach for this.
 *
 * PRIVACY: `visibility` is the audience of the OUTPUT, not of the data —
 * identical to searchMemory. In a team thread the answer is readable by every
 * workspace member, so only entries that survive the notebook audience ceiling
 * may be returned. FAILS CLOSED: anything that isn't explicitly "private" is
 * treated as team.
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";
import { loadSourceVisibility, visibleEntries, type NotebookRow } from "@/lib/notebook/access";

export interface NotebookHit {
  quote: string;
  note: string | null;
  type: string;
  notebook: string;
  source: string | null;
  date: string;
}

const MAX_HITS = 12;
const QUOTE_CHARS = 600;

/** Same sanitisation lesson as searchMemory: PostgREST's or() treats commas,
 *  parentheses, dots and quotes as GRAMMAR, so raw user text breaks the whole
 *  filter and the error surfaces as a confident "nothing found". */
function terms(query: string): string[] {
  const sanitized = query.toLowerCase().replace(/[(),."'\\%*?!:;[\]{}]/g, " ");
  const long = sanitized.split(/\s+/).filter((t) => t.length > 2);
  if (long.length > 0) return long.slice(0, 6);
  // Short but meaningful queries — "AI", "Q4", "CU" — must not produce an
  // empty or() (PostgREST 400s on one, and the model reports nothing found).
  return sanitized.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
}

export async function searchNotebook(
  query: string,
  workspaceId: string,
  userId: number,
  visibility?: "private" | "team"
): Promise<{ hits: NotebookHit[]; summary: string }> {
  const soloAudience = visibility === "private";
  if (!visibility) {
    console.warn("[Notebook] searchNotebook called with no visibility — restricting to team-shareable entries (fail-closed)");
  }

  // Which notebooks may be read at all. In a team thread, a private notebook
  // is out of scope entirely even though it belongs to the caller — the answer
  // would be readable by colleagues.
  const nbQuery = intelligenceDb
    .from("ai_notebooks")
    .select("id_notebook, id_workspace, user_created, type_visibility, name_title")
    .eq("id_workspace", workspaceId)
    .eq("flag_archived", 0);
  const { data: notebookRows } = soloAudience
    ? await nbQuery.or(`user_created.eq.${userId},type_visibility.eq.team`)
    : await nbQuery.eq("type_visibility", "team");

  const notebooks = (notebookRows || []) as (NotebookRow & { name_title: string })[];
  if (notebooks.length === 0) {
    return { hits: [], summary: "No notebook entries are available in this context." };
  }

  const words = terms(query);
  let rows: any[] = [];
  if (words.length > 0) {
    const filter = words
      .flatMap((t) => [`document_quote.ilike.%${t}%`, `document_note.ilike.%${t}%`])
      .join(",");
    const { data } = await intelligenceDb
      .from("ai_notebook_entries")
      .select("*")
      .in("id_notebook", notebooks.map((n) => n.id_notebook))
      .or(filter)
      .order("date_created", { ascending: false })
      .limit(MAX_HITS * 3); // over-fetch: the audience filter runs in TS below
    rows = data || [];
  }

  // Apply the SAME ceiling the UI uses — never a second implementation.
  //
  // The userId passed in matters: visibleEntries grants an author unrestricted
  // sight of their OWN entries, which is right in the panel but wrong here when
  // the audience is a team thread. Passing -1 withholds that bypass, so a
  // private-source clipping cannot be read back out into a room of colleagues
  // just because its author asked the question.
  const sourceVisibility = await loadSourceVisibility(rows);
  const byNotebook = new Map(notebooks.map((n) => [n.id_notebook, n]));
  const allowed: any[] = [];
  for (const row of rows) {
    const nb = byNotebook.get(row.id_notebook);
    if (!nb) continue;
    if (visibleEntries([row], nb, soloAudience ? userId : -1, sourceVisibility).length === 1) {
      allowed.push(row);
    }
  }

  const hits: NotebookHit[] = allowed.slice(0, MAX_HITS).map((r) => ({
    quote: String(r.document_quote || "").slice(0, QUOTE_CHARS),
    note: r.document_note ? String(r.document_note).slice(0, 400) : null,
    type: r.type_entry,
    notebook: byNotebook.get(r.id_notebook)?.name_title || "Notebook",
    source: r.name_source_title || null,
    date: String(r.date_created || "").slice(0, 10),
  }));

  const summary = hits.length
    ? `Found ${hits.length} notebook entr${hits.length === 1 ? "y" : "ies"} matching "${query}".`
    : soloAudience
      ? `No notebook entries match "${query}".`
      : `No shareable notebook entries match "${query}". This is a team thread, so entries the user clipped from private chats are not searched — say that rather than concluding nothing was saved.`;

  return { hits, summary };
}

/**
 * One line for the system prompt: enough for the model to know the notebook
 * exists and what it is roughly about, without paying for its contents.
 */
export async function notebookIndex(
  workspaceId: string,
  userId: number,
  visibility?: "private" | "team"
): Promise<string | null> {
  const soloAudience = visibility === "private";
  const nbQuery = intelligenceDb
    .from("ai_notebooks")
    .select("id_notebook, id_workspace, user_created, type_visibility")
    .eq("id_workspace", workspaceId)
    .eq("flag_archived", 0);
  const { data: notebookRows } = soloAudience
    ? await nbQuery.or(`user_created.eq.${userId},type_visibility.eq.team`)
    : await nbQuery.eq("type_visibility", "team");

  const notebooks = (notebookRows || []) as NotebookRow[];
  if (notebooks.length === 0) return null;

  const { data } = await intelligenceDb
    .from("ai_notebook_entries")
    .select("id_entry, id_notebook, user_created, id_conversation, flag_private_source, document_note, document_quote, name_source_title")
    .in("id_notebook", notebooks.map((n) => n.id_notebook))
    .order("date_created", { ascending: false })
    .limit(60);

  const rows = data || [];
  const sourceVisibility = await loadSourceVisibility(rows);
  const byNotebook = new Map(notebooks.map((n) => [n.id_notebook, n]));
  const allowed = rows.filter((r) => {
    const nb = byNotebook.get(r.id_notebook);
    return !!nb && visibleEntries([r as any], nb, soloAudience ? userId : -1, sourceVisibility).length === 1;
  });
  if (allowed.length === 0) return null;

  // Topics come from annotations and source thread titles — short, and written
  // by the user — never from the clipped text itself, which could be long or
  // sensitive and is exactly what the tool is for.
  const topics = Array.from(
    new Set(
      allowed
        .map((r) => (r.document_note || r.name_source_title || "").toString().trim())
        .filter(Boolean)
        .map((t) => t.slice(0, 60))
    )
  ).slice(0, 6);

  return `The user keeps a notebook of saved highlights: ${allowed.length} entr${allowed.length === 1 ? "y" : "ies"} available here${topics.length ? `, covering ${topics.map((t) => `"${t}"`).join(", ")}` : ""}. Use search_notebook to read them — they are things this user explicitly chose to keep, so they carry weight.`;
}
