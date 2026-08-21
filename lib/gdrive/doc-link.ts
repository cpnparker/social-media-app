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
