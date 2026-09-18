/**
 * Read a Google Doc the user identified by LINK.
 *
 * This exists because "share it with the service account" is a real barrier to
 * the optimiser's primary workflow, and it turns out not to be necessary for
 * the common case. Verified against a live document on 2026-08-21: a Doc set to
 * "Anyone with the link" exports its plain text over
 * docs.google.com/document/d/<id>/export?format=txt to a caller with NO
 * credentials at all — status 200, full body. So a pasted link works where the
 * picker cannot: files.list only ever returns what is explicitly shared with
 * the service account, so a link-shared doc is invisible to the dropdown no
 * matter what permissions it carries.
 *
 * It has a second advantage that matters more than the convenience. The shared
 * Drive tool (lib/gdrive/docs.ts) caps a document at 8,000 characters because
 * its output goes into a model's context. This path has no such reason to
 * truncate, so it can bring in a whole article — and 8,000 characters is only
 * about 1,300 words, well inside the range the rubric is calibrated for.
 *
 * SSRF: the user's URL is never fetched. Only the document ID is taken from it,
 * checked against [A-Za-z0-9_-], and substituted into a hardcoded google.com
 * template — so there is no notation of any internal host that can reach the
 * network through here. That is why this does not route through safeFetch:
 * there is no user-controlled destination to guard.
 */

/** Google file ids are base64url-ish. Anything else is not an id. */
const DOC_ID = /^[A-Za-z0-9_-]{10,200}$/;

export interface DocLinkResult {
  ok: boolean;
  id?: string;
  text?: string;
  /** True when `text` is HTML rather than plain text. The importer needs to
   *  know, because sanitising HTML and converting plain text are different
   *  operations and guessing from the content is guessing. */
  isHtml?: boolean;
  /** What to tell the user. Written for a person, not a model. */
  error?: string;
  /** True when the failure is "we can see it exists but may not read it". */
  permission?: boolean;
}

/**
 * Pull the document id out of anything a person might paste.
 *
 * Handles /document/d/<id>/edit, /document/u/0/d/<id>/, the ?id=<id> form used
 * by older export links, and a bare id. Returns null rather than guessing: a
 * wrong id produces a confusing 404 several steps later.
 */
export function extractDocId(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  if (DOC_ID.test(raw) && raw.indexOf("/") < 0 && raw.indexOf(".") < 0) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Host allowlist, not a substring check: "docs.google.com.evil.test" contains
  // the string "docs.google.com" and must not match.
  const host = url.hostname.toLowerCase();
  if (host !== "docs.google.com" && host !== "drive.google.com") return null;

  const byPath = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,200})/);
  if (byPath) return byPath[1];
  const byQuery = url.searchParams.get("id");
  if (byQuery && DOC_ID.test(byQuery)) return byQuery;
  return null;
}

/**
 * Fetch the document's plain text.
 *
 * Two attempts, in this order:
 *   1. The service account, if configured. Covers docs shared with it AND
 *      link-shared docs, and works for Workspace-domain-restricted files when
 *      the account is in that domain.
 *   2. No credentials. Covers "anyone with the link" when the service account
 *      is not configured or was refused.
 *
 * The unauthenticated attempt runs SECOND on purpose. It can silently return a
 * Google sign-in page with status 200 for a restricted document, so a response
 * that is HTML rather than text is treated as a refusal, not as content.
 */
export async function fetchDocText(
  id: string,
  maxChars: number,
  /** Injected only by scripts/verify-optimizer-import.ts. The sign-in-page
   *  rejection is the most consequential branch in this file — a login page
   *  imported as an article looks exactly like success — and it cannot be
   *  exercised at all without being able to hand this function a response. */
  fetchImpl?: typeof fetch
): Promise<DocLinkResult> {
  const doFetch = fetchImpl || fetch;
  if (!DOC_ID.test(id)) return { ok: false, error: "That does not look like a Google Doc link." };

  // HTML, not txt. The plain-text export throws away every heading, list and
  // bold run, and this product SCORES heading structure — importing an article
  // as one flat block does not score it leniently, it scores a different
  // document. The HTML export carries the real structure.
  const url = `https://docs.google.com/document/d/${id}/export?format=html`;
  let sawPermissionError = false;

  const attempts: (string | null)[] = [];
  try {
    const { googleSaConfigured, getGoogleAccessToken } = await import("./auth");
    if (googleSaConfigured()) attempts.push(await getGoogleAccessToken());
  } catch {
    /* an unusable service account is not a reason to skip the public attempt */
  }
  attempts.push(null);

  for (let i = 0; i < attempts.length; i++) {
    const token = attempts[i];
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "follow",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      sawPermissionError = true;
      continue;
    }
    if (!res.ok) continue;

    // A sign-in interstitial also comes back as 200 text/html, and now so does
    // the document itself — so content-type can no longer tell them apart and
    // the check moved to WHERE the response came from.
    //
    // A successful export redirects to a googleusercontent.com export host
    // (verified live: doc-10-4o-docstext.googleusercontent.com). A refused one
    // redirects to accounts.google.com. Landing on an accounts host is
    // conclusive; the body check below is the backstop for a refusal served
    // without a redirect.
    const finalHost = (() => {
      try { return new URL(res.url || url).hostname.toLowerCase(); } catch { return ""; }
    })();
    if (finalHost.indexOf("accounts.google.com") >= 0) {
      sawPermissionError = true;
      continue;
    }

    let text = await res.text();

    // Backstop: a Google sign-in page, whatever host served it. Matched on the
    // sign-in form's own markers rather than on the word "sign in", which
    // appears in ordinary prose.
    if (
      /<title>[^<]*\bSign in\b[^<]*<\/title>/i.test(text) ||
      text.indexOf("accounts.google.com/ServiceLogin") >= 0 ||
      text.indexOf("identifierId") >= 0
    ) {
      sawPermissionError = true;
      continue;
    }
    // Docs exports carry a UTF-8 BOM in their bytes, which would sit in the
    // editor as an invisible first character and shift every anchor offset by
    // one. Belt and braces only: `Response.text()` is specified as a UTF-8
    // decode, and a UTF-8 decode already strips a leading BOM, so this line is
    // unreachable today. Kept because the property matters more than the line,
    // and deleting it would leave nothing at all if a runtime ever differed.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) return { ok: false, id, error: "That document has no text in it." };
    if (text.length > maxChars) {
      return {
        ok: false,
        id,
        error: `That document is ${Math.round(text.length / 1000)}k characters. The rubric is calibrated for 800-2,500 words — bring it in a section at a time.`,
      };
    }
    return { ok: true, id, text, isHtml: true };
  }

  return {
    ok: false,
    id,
    permission: sawPermissionError,
    error: sawPermissionError
      ? "That document is not readable — set it to “Anyone with the link”, or share it with EngineAI, then try again."
      : "Could not reach that document.",
  };
}

// ── Everything else on those hosts ─────────────────────────────────────────
//
// A native Doc has its own export and its own function above. Sheets, Slides
// and files UPLOADED to Drive each have one too, and until now all three fell
// through to the generic page fetch, which returned the viewer's HTML shell and
// attached Google's menu chrome as the writer's research.
//
// The endpoints differ; the hard part does not. Whether a refusal arrives as a
// redirect to accounts.google.com, as a sign-in page served at 200, or as a
// download interstitial is the same question every time, so it is answered
// once, in fetchGoogleExport, and every kind goes through it.

/** What a Google link points at. `document` keeps its own path — see fetchDocText. */
export type GoogleLinkKind = "document" | "spreadsheet" | "presentation" | "drive-file";

export interface GoogleLinkTarget {
  kind: GoogleLinkKind;
  id: string;
}

/**
 * Which of Google's four shapes was pasted, and the id inside it.
 *
 * Host is matched EXACTLY, never as a substring: "docs.google.com.evil.test"
 * contains "docs.google.com" and is a different registrable domain.
 */
export function classifyGoogleLink(input: string): GoogleLinkTarget | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // A bare id is a Doc by convention — the only shape anyone pastes bare.
    return DOC_ID.test(raw) && raw.indexOf("/") < 0 && raw.indexOf(".") < 0
      ? { kind: "document", id: raw }
      : null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "docs.google.com" && host !== "drive.google.com") return null;

  const id = extractDocId(raw);
  if (!id) return null;

  const path = url.pathname;
  if (/^\/document\//.test(path)) return { kind: "document", id };
  if (/^\/spreadsheets\//.test(path)) return { kind: "spreadsheet", id };
  if (/^\/presentation\//.test(path)) return { kind: "presentation", id };
  // Everything else on these hosts that still yielded an id: a file uploaded to
  // Drive. That is the shape Drive's own share dialog produces, so it is the
  // one somebody sharing a PDF report will paste.
  return { kind: "drive-file", id };
}

/**
 * The export URLs, in one table so they can be read side by side.
 *
 * SSRF: every one is a hardcoded google.com template with a validated id
 * substituted in. The user's URL is never fetched — only the id is taken from
 * it — so there is no notation of any internal host that can reach the network
 * through here, which is why none of this routes through safeFetch.
 *
 * Slides gets TWO candidates because the two spellings are not interchangeable
 * and I could not reach Google to settle which. Trying both costs one extra
 * request in the worst case and removes a guess from a live path.
 */
function exportUrls(kind: GoogleLinkKind, id: string): string[] {
  switch (kind) {
    case "document":
      return [`https://docs.google.com/document/d/${id}/export?format=html`];
    case "spreadsheet":
      // CSV, not xlsx: a source is read as prose and a spreadsheet's meaning is
      // in its cells, not its formatting. CSV exports the FIRST sheet only,
      // which the caller states rather than hides.
      return [`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`];
    case "presentation":
      return [
        `https://docs.google.com/presentation/d/${id}/export/txt`,
        `https://docs.google.com/presentation/d/${id}/export?format=txt`,
      ];
    case "drive-file":
      return [`https://drive.google.com/uc?export=download&id=${id}`];
  }
}

export interface GoogleExport {
  ok: boolean;
  bytes?: Buffer;
  contentType?: string;
  /** True when the failure is "it exists but we may not read it". */
  permission?: boolean;
  error?: string;
}

/** A Google sign-in page, whatever host served it. Shared with fetchDocText's
 *  backstop: the same markers, kept in one place so a fix reaches both. */
function looksLikeSignIn(body: string): boolean {
  return (
    /<title>[^<]*\bSign in\b[^<]*<\/title>/i.test(body) ||
    body.indexOf("accounts.google.com/ServiceLogin") >= 0 ||
    body.indexOf("identifierId") >= 0
  );
}

/**
 * Fetch one of the export URLs, service account first and anonymously second,
 * and refuse anything that is a refusal wearing a 200.
 *
 * Returns BYTES rather than text, because a Drive file may be a PDF and
 * decoding one as UTF-8 destroys it.
 */
export async function fetchGoogleExport(
  kind: GoogleLinkKind,
  id: string,
  fetchImpl?: typeof fetch
): Promise<GoogleExport> {
  const doFetch = fetchImpl || fetch;
  if (!DOC_ID.test(id)) return { ok: false, error: "That does not look like a Google link." };

  const tokens: (string | null)[] = [];
  try {
    const { googleSaConfigured, getGoogleAccessToken } = await import("./auth");
    if (googleSaConfigured()) tokens.push(await getGoogleAccessToken());
  } catch {
    /* an unusable service account is not a reason to skip the public attempt */
  }
  tokens.push(null);

  let sawPermissionError = false;

  for (const url of exportUrls(kind, id)) {
    for (const token of tokens) {
      let res: Response;
      try {
        res = await doFetch(url, {
          redirect: "follow",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        sawPermissionError = true;
        continue;
      }
      if (!res.ok) continue;

      // Landing on an accounts host is conclusive, whatever the status.
      const finalHost = (() => {
        try { return new URL(res.url || url).hostname.toLowerCase(); } catch { return ""; }
      })();
      if (finalHost.indexOf("accounts.google.com") >= 0) {
        sawPermissionError = true;
        continue;
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const bytes = Buffer.from(await res.arrayBuffer());

      // HTML where HTML is not the export format means an interstitial, not a
      // document: a sign-in page, or Drive's "can't scan this file for viruses"
      // confirmation on a large download. Either way the bytes are Google's
      // page and not the writer's file, and attaching them is the exact failure
      // this whole path exists to stop.
      if (kind !== "document" && contentType.indexOf("html") >= 0) {
        const body = bytes.toString("utf8");
        if (looksLikeSignIn(body)) { sawPermissionError = true; continue; }
        if (/virus scan warning|can't scan this file|confirm=/i.test(body)) {
          return {
            ok: false,
            error: "That file is too large for Drive to serve directly. Download it and attach the file instead.",
          };
        }
        sawPermissionError = true;
        continue;
      }
      if (kind === "document" && looksLikeSignIn(bytes.toString("utf8"))) {
        sawPermissionError = true;
        continue;
      }

      if (bytes.length === 0) continue;
      return { ok: true, bytes, contentType };
    }
  }

  return {
    ok: false,
    permission: sawPermissionError,
    error: sawPermissionError
      ? "That file is not readable — set it to “Anyone with the link”, or share it with EngineAI, then try again."
      : "Could not reach that file.",
  };
}

/**
 * A Google link, read as BACKGROUND MATERIAL — words, whatever it is.
 *
 * The four kinds arrive in four formats and leave as one: prose. A Doc exports
 * HTML and is stripped; a Sheet exports CSV and stays as it is, because rows
 * and commas are how a table reads as text; Slides export plain text; and a
 * Drive file is whatever somebody uploaded, so it is dispatched on its
 * content-type — which is the one place a PDF report shared from Drive is
 * finally read rather than refused.
 *
 * A caller wanting a DOCUMENT to score still uses fetchDocText: that path keeps
 * the HTML because the optimiser scores structure. This one is for sources,
 * which are never scored.
 */
export async function fetchGoogleSourceText(
  target: GoogleLinkTarget,
  fetchImpl?: typeof fetch
): Promise<{ ok: true; text: string; title: string; note?: string } | { ok: false; error: string; permission?: boolean }> {
  const got = await fetchGoogleExport(target.kind, target.id, fetchImpl);
  if (!got.ok || !got.bytes) {
    return { ok: false, error: got.error || "Could not read that file.", permission: got.permission };
  }

  const ctype = (got.contentType || "").toLowerCase();
  const strip = (html: string) =>
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

  if (target.kind === "document") {
    const text = strip(got.bytes.toString("utf8"));
    if (!text) return { ok: false, error: "That document has no text in it." };
    return { ok: true, text, title: "Google Doc" };
  }

  if (target.kind === "spreadsheet") {
    const text = got.bytes.toString("utf8").trim();
    if (!text) return { ok: false, error: "That sheet is empty." };
    // SAID, not hidden. Google's CSV export returns the FIRST sheet only, and a
    // writer who attached a ten-tab workbook and got one tab should be told
    // rather than left to notice.
    return { ok: true, text, title: "Google Sheet", note: "Sheets export their first tab only — attach the others separately if you need them." };
  }

  if (target.kind === "presentation") {
    const text = got.bytes.toString("utf8").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return { ok: false, error: "That deck has no text on its slides." };
    return { ok: true, text, title: "Google Slides" };
  }

  // ── A file uploaded to Drive: whatever it is ─────────────────────────────
  if (ctype.indexOf("pdf") >= 0) {
    const { readPdf } = await import("@/lib/optimizer/pdf");
    const r = await readPdf(got.bytes, "drive-file.pdf");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, text: r.text, title: r.title };
  }
  if (ctype.indexOf("wordprocessingml") >= 0 || ctype.indexOf("msword") >= 0) {
    try {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: got.bytes });
      const text = String(out?.value || "").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) return { ok: false, error: "That document appears to be empty." };
      return { ok: true, text, title: "Drive document" };
    } catch {
      return { ok: false, error: "That Word document could not be read." };
    }
  }
  if (ctype.indexOf("html") >= 0) {
    const text = strip(got.bytes.toString("utf8"));
    if (!text) return { ok: false, error: "That file has no text in it." };
    return { ok: true, text, title: "Drive file" };
  }
  if (ctype.indexOf("text/") >= 0 || ctype.indexOf("json") >= 0 || ctype.indexOf("csv") >= 0) {
    const text = got.bytes.toString("utf8").trim();
    if (!text) return { ok: false, error: "That file is empty." };
    return { ok: true, text, title: "Drive file" };
  }

  // NAMED, not "unsupported". Knowing it was a spreadsheet or an image is what
  // tells the writer whether to convert it or give up on it.
  return {
    ok: false,
    error: `That Drive file is ${ctype ? ctype.split(";")[0] : "of a type"} — background material is read as text. Export it as PDF, .docx or .txt and attach the file.`,
  };
}
