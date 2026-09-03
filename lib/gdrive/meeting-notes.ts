/**
 * The notes document attached to a meeting, read with the user's own grant.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Asked to summarise a call that had just happened, EngineAI said MeetingBrain
 * had "no transcript and no summary" for it. The meeting row disagrees: it
 * carries a `document_id` — a Google Doc of notes attached to the calendar
 * event — alongside
 *
 *     error: "Document too short to extract tasks"
 *
 * and `transcript`, `local_transcript` and `summary` all null. MeetingBrain
 * fetched the notes, judged them too short to mine for TASKS, and then stored
 * nothing at all. "Too short to extract tasks" should mean "no tasks"; it
 * became "no meeting".
 *
 * That half belongs to MeetingBrain. This half is ours: the notes are still
 * sitting in Drive, the user's grant already carries `documents.readonly`, and
 * the id is on the row. So when a meeting has no record but does have a notes
 * document, read the document.
 *
 * ── WHY THE DOCS API AND NOT THE DRIVE EXPORT ───────────────────────────────
 *
 * `fetchGoogleExport` in lib/gdrive/doc-link.ts tries a service account and
 * then anonymous, which is right for a link somebody pasted and wrong here: a
 * meeting-notes doc is private to its attendees, so neither identity can open
 * it. The scope that CAN is the user's own `documents.readonly`, and that scope
 * addresses the Docs API rather than Drive's export endpoint — `drive.export`
 * needs `drive.readonly`, which this app deliberately does not request.
 */

import { getUserGoogleToken } from "@/lib/slides/token";

/** Google file ids: the same shape doc-link.ts accepts. */
const DOC_ID = /^[a-zA-Z0-9_-]{20,}$/;

export interface MeetingNotes {
  ok: boolean;
  title?: string;
  text?: string;
  reason?: "no_id" | "no_grant" | "not_found" | "forbidden" | "empty" | "error";
}

/** Flatten a Docs API document to plain text: paragraphs and table cells. */
export function docToText(doc: any): string {
  const out: string[] = [];
  const walk = (content: any[]) => {
    for (const el of content || []) {
      if (el.paragraph) {
        let line = "";
        for (const pe of el.paragraph.elements || []) line += pe.textRun?.content || "";
        out.push(line.replace(/\n+$/, ""));
      }
      // Notes are very often a table — an agenda column and a decisions column.
      // Skipping tables was how a "short" document became an empty one.
      if (el.table) {
        for (const row of el.table.tableRows || []) {
          const cells: string[] = [];
          for (const cell of row.tableCells || []) {
            const before = out.length;
            walk(cell.content || []);
            cells.push(out.splice(before).join(" ").trim());
          }
          out.push(cells.filter(Boolean).join(" | "));
        }
      }
      if (el.tableOfContents) walk(el.tableOfContents.content || []);
    }
  };
  walk(doc?.body?.content || []);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchMeetingNotes(
  documentId: string | null | undefined,
  userEmail: string
): Promise<MeetingNotes> {
  const id = String(documentId || "").trim();
  if (!id || !DOC_ID.test(id)) return { ok: false, reason: "no_id" };

  const auth = await getUserGoogleToken(userEmail);
  if (!auth.ok || !auth.accessToken) return { ok: false, reason: "no_grant" };

  let res: Response;
  try {
    res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    console.warn(`[MeetingNotes] fetch failed for ${id}: ${e?.message}`);
    return { ok: false, reason: "error" };
  }

  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden" };
  if (!res.ok) {
    console.warn(`[MeetingNotes] Docs API ${res.status} for ${id}`);
    return { ok: false, reason: "error" };
  }

  const doc: any = await res.json().catch(() => null);
  const text = docToText(doc);
  if (!text) return { ok: false, reason: "empty" };
  // Generous, and the same reasoning as the transcript cap: a model with room
  // to read the whole thing gives a better answer than one reading half.
  return { ok: true, title: doc?.title || undefined, text: text.slice(0, 100000) };
}
