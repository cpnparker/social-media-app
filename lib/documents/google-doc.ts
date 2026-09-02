/**
 * A generated document, as a Google Doc in the user's own Drive.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Asked for a letter "as a googledoc", EngineAI answered: "I can't create
 * Google Docs directly — that needs a separate scope I don't have."
 *
 * The first half was true and the second was not. There was no code to create a
 * Google Doc anywhere in the app, but the permission was never the obstacle:
 * `drive.file` — requested and granted since slide export shipped — covers
 * every file the app itself creates, a Google Doc included. The model was
 * explaining a missing feature with a missing permission, which is the kind of
 * wrong answer that stops someone asking again.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 *
 * By handing Drive the .docx we already build and asking it to convert. Not by
 * writing a second document builder against the Docs API: the .docx renderer
 * knows how to lay out headings, tables, lists and links, and a parallel
 * implementation would be a second thing to keep in step — the two would agree
 * on the day they shipped and drift after. Uploading the bytes means the Doc
 * and the .docx are the same document by construction.
 *
 * Drive's converter is good but not perfect on complex layouts. That is the
 * honest trade for one renderer, and it is the same trade a person makes when
 * they drag a .docx into Drive by hand, which is exactly what this replaces.
 */

import { getUserGoogleToken, authFailureMessage, type SlidesAuthFailure } from "@/lib/slides/token";

const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export interface GoogleDocResult {
  ok: boolean;
  url?: string;
  documentId?: string;
  title?: string;
  error?: string;
  reason?: SlidesAuthFailure;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Upload `.docx` bytes and have Drive convert them to a Google Doc.
 *
 * multipart rather than resumable: these documents are prose, measured in tens
 * of kilobytes, and a resumable session is two extra round-trips to protect
 * against an interruption that costs one retry.
 */
export async function createGoogleDoc(input: {
  title: string;
  docx: Buffer;
  userEmail: string;
}): Promise<GoogleDocResult> {
  const auth = await getUserGoogleToken(input.userEmail);
  if (!auth.ok || !auth.accessToken) {
    const reason = auth.reason as SlidesAuthFailure;
    return { ok: false, error: authFailureMessage(reason), reason };
  }

  const boundary = `engineai-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const metadata = {
    name: input.title,
    // THE CONVERSION. Naming the Google Docs type as the TARGET mime while the
    // uploaded part is a .docx is what makes Drive convert rather than store.
    mimeType: "application/vnd.google-apps.document",
  };

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`
    ),
    input.docx,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  let res: Response;
  try {
    res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body as any,
    });
  } catch (e: any) {
    console.error("[GoogleDoc] upload failed:", e?.message);
    return { ok: false, error: "Couldn't reach Google Drive just now. Try again in a moment." };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[GoogleDoc] Drive rejected the upload (${res.status}): ${detail.slice(0, 300)}`);
    // A 401/403 here after a token that read as good means the grant was
    // revoked between the two calls. Reported as a reconnect rather than a
    // fault, because that is what it is and the user can fix it.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: authFailureMessage("refresh_failed"), reason: "refresh_failed" };
    }
    return { ok: false, error: `Google Drive refused the document (${res.status}).` };
  }

  const json: any = await res.json().catch(() => ({}));
  if (!json?.id) {
    console.error("[GoogleDoc] Drive returned no file id");
    return { ok: false, error: "Google Drive accepted the document but returned no link." };
  }

  return {
    ok: true,
    documentId: json.id,
    title: json.name || input.title,
    url: `https://docs.google.com/document/d/${json.id}/edit`,
  };
}

/**
 * What the user sees and what the model is told, for one generated document.
 *
 * Pure, and separate from the building and uploading, because the interesting
 * failure is a WORDING one: told only that the Drive step failed, the model
 * reached for "I lack the scope" — the same wrong explanation that sent this
 * feature's first user away believing the product could not do it. What the
 * tool result says is therefore part of the behaviour, and gets asserted like
 * any other part.
 */
export function documentOutcome(input: {
  url: string;
  filename: string;
  doc?: GoogleDocResult | null;
  docActionable?: boolean;
}): { events: Record<string, unknown>[]; marker: string; toolText: string } {
  const events: Record<string, unknown>[] = [{ document_ready: { url: input.url, filename: input.filename } }];
  let marker = `\n\n\u{1F4C4} [Download ${input.filename}](${input.url})\n\n`;
  let toolText = `Word document generated: ${input.filename}. Download: ${input.url} — The download link is already shown to the user. Do NOT write another link.`;

  if (!input.doc) return { events, marker, toolText };

  if (input.doc.ok && input.doc.url) {
    events.push({ google_doc_ready: { url: input.doc.url, title: input.doc.title } });
    marker += `\n\n\u{1F4DD} [Open ${input.doc.title} in Google Docs](${input.doc.url})\n\n`;
    toolText += ` It is ALSO now a Google Doc in their Drive: ${input.doc.url} — that link is already shown too. Do NOT write either link again.`;
    return { events, marker, toolText };
  }

  // The .docx is still theirs. A failed Drive step degrades the answer; it does
  // not withdraw it.
  if (input.docActionable) {
    events.push({ slides_reauth: { message: input.doc.error, reason: input.doc.reason, intent: "doc" } });
  }
  toolText +=
    ` The Google Doc was NOT created: ${input.doc.error}` +
    ` Tell the user the .docx above is ready and that the Google Doc needs their Google connection${input.docActionable ? ", and that the button below reconnects it" : ""}.` +
    ` Do NOT tell them Google Docs is unsupported or that you lack a permission or scope for it — creating Google Docs IS supported and this is a connection problem.`;
  return { events, marker, toolText };
}
