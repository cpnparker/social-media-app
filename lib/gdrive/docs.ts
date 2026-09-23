/**
 * Drive documents tool (READ-ONLY): any file shared with the EngineAI service
 * account becomes queryable by the whole workspace — "share with the robot"
 * IS the publish decision (Chris's chosen policy, 2026-07-22).
 *
 * EXCEPTION: the finance forecast workbook keeps its own finance-flag-gated
 * report and is invisible to this general tool — by name AND by id, because a
 * by-id path that skipped that filter would be a way round the finance flag.
 *
 * Supports: Google Docs/Slides (export text), Google Sheets + Excel (SheetJS),
 * PDFs (pdf-parse), Word (mammoth), plain text/CSV/Markdown.
 *
 * TWO WAYS IN, and the second one exists because the first one failed a user
 * in production (2026-09-21). A name search can only find what the cached list
 * happens to hold; a pasted link carries a file ID, and a file shared straight
 * with the service account is readable BY ID even when no name search would
 * ever turn it up. So a query that carries a Drive link is resolved by id
 * against Drive itself, and a name that matches nothing re-asks Drive once
 * before anybody is told the document is not shared.
 *
 * Two things that review caught in the first version of that fix, because both
 * recreate the incident rather than a hypothetical. The link is found ANYWHERE
 * in the message — demanding that the whole argument parse as a URL sent
 * "please read <link>" and a markdown link straight back to the name search
 * that misses. And a forced re-read that FAILS stamps a different clock from
 * one that succeeded, so the refusal that follows can say which happened
 * instead of asserting the good one.
 */

import * as XLSX from "xlsx";
import { getGoogleAccessToken, googleSaConfigured, googleSaEmail } from "@/lib/gdrive/auth";
// One extractor, not two. `extractDocId` already handles /document/d/<id>/edit,
// the /u/1/d/ form Chris's link had, ?id=<id>, and a bare id, and it matches the
// host EXACTLY so "docs.google.com.evil.test" is not a Google link. Writing a
// second one here would mean two things to fix the next time Google adds a URL
// shape.
import { extractDocId } from "@/lib/gdrive/doc-link";

const FORECAST_FILE_ID = process.env.FINANCE_FORECAST_FILE_ID || "1Skw6rHX5mtQMbkK5anbJrMwEL-2AHDab";
const CACHE_MS = 10 * 60_000;
/** What a NAME read hands the model: a partial-name match may be the wrong
 *  document, and 8,000 characters is enough to find that out. */
const MAX_CHARS = 8000;

/**
 * What a read BY ID hands the model — a link the user pasted, or a bare id.
 *
 * A link names ONE document on purpose, and 8,000 characters was not enough to
 * read it. The final Obama Presidential Center article (Amrize, 2026-09-23) is
 * 12,474 characters as Drive exports it, and the cut fell at 8,000, mid-
 * sentence ("…says Vassil Draganov, a principal at"): the model never saw two
 * of the five question headings, the 150% wind-test figure, or the FAQ at
 * 10,834 — and it was being asked to score that article against a checklist
 * whose tenth point IS the FAQ. The same document attached as a .docx arrived
 * whole, so the attachment was the only road that worked, and the one the
 * user was least likely to take.
 *
 * 24,000 is three times that article, roughly 6,000 tokens, re-sent on each
 * tool round of the turn that read it. A document longer than this still gets
 * the marker below and says how much of it was seen. The formatter in
 * lib/ai/providers.ts slices the JSON it hands the model at DRIVE_RESULT_MAX_CHARS,
 * which must clear this plus JSON escaping, or this number is a promise the
 * next layer breaks — verify-incident-fixes section 19 drives both together.
 */
export const LINK_MAX_CHARS = 24_000;

/**
 * The floor on a forced re-read of the list, so a model that retries in a loop
 * cannot turn every miss into a Drive request. Five seconds is short enough
 * that a person who has just shared a file and asked again gets a fresh answer,
 * and long enough that a tool-loop costs one request rather than ten.
 */
const FORCED_REFRESH_MS = 5_000;

/**
 * The floor on retrying a forced re-read that FAILED, kept on its own clock
 * because the two mean different things. A re-read that succeeded earns its
 * five seconds: the list really is fresh. One that failed earns nothing — it
 * told us only that Drive was unreachable — so it gets a shorter pause, long
 * enough that a flapping Drive is not hammered and short enough that the next
 * question asks again. Sharing one clock between them is what let a single
 * Drive 500 hold a stale "not shared" open while claiming it had just been
 * re-read: the incident's own failure mode, re-created inside its fix.
 */
const FAILED_REFRESH_BACKOFF_MS = 2_000;

/** A file changed within this window is worth naming when nothing matched: the
 *  document somebody has just shared is usually the document they just saved. */
const RECENTLY_CHANGED_MS = 60 * 60_000;

/**
 * The opening of the marker appended to a document that did not fit.
 *
 * DEFINED IN `lib/ai/truncation.ts` and re-exported here, unchanged, so every
 * existing importer keeps working. It moved because the chat's attachment
 * extractor needs the same string and importing this module drags in the Google
 * auth client; copying it instead is exactly what the original note here warned
 * against, since a hand-copied marker goes stale in silence and truncated
 * documents start arriving unlabelled with nothing going red.
 */
export { TRUNCATION_MARKER } from "@/lib/ai/truncation";
import { TRUNCATION_MARKER } from "@/lib/ai/truncation";

interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; driveId?: string }

/**
 * Everything this module remembers between calls, in one object so a test can
 * hand it a fresh one.
 *
 * `forcedAt` is deliberately NOT part of the list cache: it records when a MISS
 * last forced a re-read, which is a different question from when the list was
 * last read, and conflating them is how a rate limit stops rate-limiting.
 *
 * `forcedAt` is stamped only when that re-read SUCCEEDED; a failed attempt goes
 * to `forcedFailedAt`. They are separate because a rate limit that counts
 * ATTEMPTS protects Drive from requests Drive never answered, and leaves the
 * caller free to claim a freshness nobody has.
 */
export interface DriveCaches {
  list: { at: number; files: DriveFile[] };
  /** `text` is at most LINK_MAX_CHARS; `full` is the document's real length,
   *  which the truncation marker reports. */
  content: Map<string, { at: number; text: string; full?: number }>;
  forcedAt: number;
  forcedFailedAt: number;
}

export function newDriveCaches(): DriveCaches {
  return { list: { at: 0, files: [] }, content: new Map(), forcedAt: 0, forcedFailedAt: 0 };
}

const caches = newDriveCaches();

/**
 * The seams this module can be driven through.
 *
 * GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY_B64 live only in Vercel, so there
 * is no way to exercise any of this from a laptop against the real Drive — and
 * a check that needs the network is a check nobody runs. Supplying `getToken`
 * is what tells this module it is configured: a caller holding a token needs no
 * env vars, and the alternative (reading the env and hoping) makes the
 * interesting branches unreachable in a test.
 *
 * Injected by scripts/verify-incident-fixes.ts and by nothing in the app.
 */
export interface DriveDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
  saEmail?: string;
  now?: () => number;
  caches?: DriveCaches;
}

interface Wired {
  fetch: typeof fetch;
  getToken: () => Promise<string>;
  saEmail: string;
  now: () => number;
  caches: DriveCaches;
  configured: boolean;
}

function wire(d?: DriveDeps): Wired {
  return {
    fetch: d && d.fetchImpl ? d.fetchImpl : fetch,
    getToken: d && d.getToken ? d.getToken : getGoogleAccessToken,
    saEmail: d && d.saEmail !== undefined ? d.saEmail : googleSaEmail(),
    now: d && d.now ? d.now : Date.now,
    caches: d && d.caches ? d.caches : caches,
    configured: d && d.getToken ? true : googleSaConfigured(),
  };
}

async function listShared(w: Wired, force?: boolean): Promise<DriveFile[]> {
  // Short cache, and NEVER cache emptiness for long — a freshly shared file
  // must show up promptly ("I shared it and the list is still empty" bug).
  //
  // That mitigation only ever covered an EMPTY list, and the list that failed
  // Chris had three files in it, so his two retries were answered from a
  // snapshot taken before his share landed. A non-empty list can be stale about
  // exactly the file being asked for, which is why a MISS now forces its way
  // past this (see refreshOnMiss) rather than trusting the sixty seconds.
  const ttl = w.caches.list.files.length ? 60_000 : 5_000;
  if (!force && w.now() - w.caches.list.at < ttl) return w.caches.list.files;
  const token = await w.getToken();
  const params = new URLSearchParams({
    // NOTE: no `sharedWithMe = true` — that flag is unreliable for service
    // accounts. An SA owns nothing, so "everything visible" IS the shared set.
    q: "trashed = false",
    fields: "files(id,name,mimeType,modifiedTime,driveId)",
    pageSize: "100",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await w.fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const j = await res.json();
  const files: DriveFile[] = (j.files || [])
    .filter((f: any) => f.id !== FORECAST_FILE_ID) // finance-gated elsewhere
    .filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");
  console.log(`[DriveDocs] list: ${files.length} file(s) visible to the service account`);
  w.caches.list.at = w.now();
  w.caches.list.files = files;
  return files;
}

/**
 * Re-ask Drive because nothing matched.
 *
 * A HIT may be served from cache all day; a MISS may not, because a miss is the
 * one answer whose consequence is telling somebody their document is not shared
 * when it is. Rate-limited so a retrying model costs one request rather than
 * one per attempt, and the caller is told WHICH of three things happened, so it
 * can say so rather than asserting the good one.
 *
 * The third state is the one that was missing. An attempt that threw used to
 * stamp the rate limit anyway, so the next miss was answered from a list up to
 * a minute old under the sentence "it was re-read moments ago" — a claim about
 * a check that did not happen, which is the defect this whole file is fixing.
 */
type MissRefresh = { files: DriveFile[]; state: "refreshed" | "rate-limited" | "unreachable" };

async function refreshOnMiss(w: Wired): Promise<MissRefresh> {
  if (w.now() - w.caches.forcedAt < FORCED_REFRESH_MS) {
    return { files: w.caches.list.files, state: "rate-limited" };
  }
  if (w.now() - w.caches.forcedFailedAt < FAILED_REFRESH_BACKOFF_MS) {
    return { files: w.caches.list.files, state: "unreachable" };
  }
  try {
    const files = await listShared(w, true);
    // On SUCCESS, and nowhere else.
    w.caches.forcedAt = w.now();
    return { files, state: "refreshed" };
  } catch (err) {
    w.caches.forcedFailedAt = w.now();
    throw err;
  }
}

/** How long ago the list in hand actually came from Drive, in plain words. */
function listAge(w: Wired): string {
  if (!w.caches.list.at) return "never read";
  const secs = Math.max(0, Math.round((w.now() - w.caches.list.at) / 1000));
  if (secs < 2) return "just now";
  if (secs < 90) return `${secs} seconds ago`;
  return `${Math.round(secs / 60)} minutes ago`;
}

/** The same phrasing for a file's own modified time, used when offering it. */
function changedAgo(w: Wired, modifiedTime: string): string {
  const t = Date.parse(modifiedTime || "");
  if (isNaN(t)) return "";
  const mins = Math.round((w.now() - t) / 60_000);
  if (mins < 1) return "changed seconds ago";
  if (mins < 90) return `changed ${mins} minute${mins === 1 ? "" : "s"} ago`;
  return `changed ${(modifiedTime || "").slice(0, 10)}`;
}

/**
 * The address a document must be shared with. Not a secret: a service-account
 * address is an identifier you are meant to hand out, and it is useless without
 * the private key. Withholding it made "share it with EngineAI" an instruction
 * nobody could follow.
 */
function shareWith(w: Wired): string {
  return w.saEmail
    ? `share it (Viewer is enough) with ${w.saEmail}`
    : `share it with EngineAI's service account — no address is configured on this deployment, so ask an admin rather than inventing one`;
}

function normTokens(s: string): string[] {
  const out: string[] = [];
  const parts = (s || "").toLowerCase().split(/[^a-z0-9]+/);
  for (let i = 0; i < parts.length; i++) if (parts[i].length > 1) out.push(parts[i]);
  return out;
}

/** Letters in order, so a typo that transposes them still matches: IMT / ITM. */
function letterKey(t: string): string {
  return t.split("").sort().join("");
}

/**
 * The near-miss that was the most useful thing in the failed exchange: Chris
 * typed IMT, the document is called ITM, and offering it by name is what would
 * have unstuck him if the file had genuinely been missing.
 *
 * Two signals, because they catch different things. NAME similarity handles the
 * typo — including the transposition, which no substring test can see. RECENCY
 * handles the case the wording cannot: somebody who has just said "I shared it"
 * is almost always talking about the file that changed minutes ago, whatever
 * they called it.
 */
function rankCandidates(files: DriveFile[], query: string, w: Wired): string[] {
  const qTokens = normTokens(query);
  const qFlat = (query || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const scored: { f: DriveFile; score: number; why: string[] }[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const nameFlat = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const fTokens = normTokens(f.name);
    let score = 0;
    const why: string[] = [];

    if (qFlat && nameFlat && (nameFlat.indexOf(qFlat) >= 0 || qFlat.indexOf(nameFlat) >= 0)) {
      score += 4;
      why.push("name contains what you asked for");
    }
    for (let a = 0; a < qTokens.length; a++) {
      for (let b = 0; b < fTokens.length; b++) {
        if (qTokens[a] === fTokens[b]) { score += 3; continue; }
        if (letterKey(qTokens[a]) === letterKey(fTokens[b])) {
          score += 3;
          why.push(`"${fTokens[b]}" is "${qTokens[a]}" with the letters swapped`);
          continue;
        }
        if (fTokens[b].indexOf(qTokens[a]) >= 0 || qTokens[a].indexOf(fTokens[b]) >= 0) score += 1;
      }
    }

    const age = w.now() - Date.parse(f.modifiedTime || "");
    if (!isNaN(age) && age >= 0 && age < RECENTLY_CHANGED_MS) {
      score += 3;
      why.push(changedAgo(w, f.modifiedTime));
    }

    if (score >= 3) scored.push({ f, score, why });
  }

  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (let i = 0; i < scored.length && i < 3; i++) {
    const why = scored[i].why.length ? ` — ${scored[i].why.join("; ")}` : "";
    out.push(`"${scored[i].f.name}"${why}`);
  }
  return out;
}

function serializeSheetRows(ws: XLSX.WorkSheet, cap: number): string {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const lines: string[] = [];
  for (const r of rows) {
    const cells = r.map((c) => String(c).trim());
    if (!cells.some((c) => c !== "")) continue;
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    lines.push(cells.slice(0, end).join(" | "));
    if (lines.length >= cap) { lines.push("… (truncated)"); break; }
  }
  return lines.join("\n");
}

/**
 * A document's text, normalised — cached at the LARGEST cap and cut by the
 * caller.
 *
 * Cut to the caller's cap here, the cache would hold whichever cap asked
 * first: a name read at 8,000 would then answer the link read that came next
 * with the same 8,000 characters, under a marker telling the model it had seen
 * all a link gets. Held whole, a 300-page PDF would sit in a warm lambda's
 * memory for as long as the lambda lives — nothing evicts this map, entries
 * only go stale. So it holds what the largest reader can be handed, and the
 * real length beside it for the marker.
 */
async function readFileText(f: DriveFile, w: Wired, cap: number = MAX_CHARS): Promise<string> {
  const cached = w.caches.content.get(f.id);
  if (cached && w.now() - cached.at < CACHE_MS) return capText(cached.text, cap, cached.full);

  const token = await w.getToken();
  const auth = { Authorization: `Bearer ${token}` };
  let text = "";

  if (f.mimeType === "application/vnd.google-apps.document" || f.mimeType === "application/vnd.google-apps.presentation") {
    const res = await w.fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`, { headers: auth });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    text = await res.text();
  } else if (f.mimeType === "application/vnd.google-apps.spreadsheet" || f.mimeType.includes("spreadsheetml") || f.mimeType === "application/vnd.ms-excel") {
    const url = f.mimeType === "application/vnd.google-apps.spreadsheet"
      ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
      : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`;
    const res = await w.fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
    const perSheet = Math.max(20, Math.floor(120 / wb.SheetNames.length));
    text = wb.SheetNames.map((n) => `### Sheet: ${n}\n${serializeSheetRows(wb.Sheets[n], perSheet)}`).join("\n\n");
  } else {
    const res = await w.fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: auth });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (f.mimeType === "application/pdf") {
      const pdfParseModule: any = await import("pdf-parse");
      const pdfParse = pdfParseModule.default ?? pdfParseModule;
      text = (await pdfParse(buf)).text || "";
    } else if (f.mimeType.includes("wordprocessingml")) {
      const mammoth: any = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: buf })).value || "";
    } else if (f.mimeType.startsWith("text/") || f.mimeType === "application/json") {
      text = buf.toString("utf8");
    } else {
      throw new Error(`Unsupported file type: ${f.mimeType}`);
    }
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();

  w.caches.content.set(f.id, { at: w.now(), text: text.slice(0, LINK_MAX_CHARS), full: text.length });
  return capText(text, cap);
}

/**
 * Say so when the document does not fit. Cutting silently meant the model
 * read the first third of a brief and answered "the brief doesn't cover
 * budget" — confidently — when budget was on page 6. A marker in the text
 * itself is what reaches the model, whatever formats the result downstream.
 */
function capText(text: string, cap: number, full: number = text.length): string {
  if (full <= cap) return text;
  return (
    text.slice(0, cap) +
    `\n\n${TRUNCATION_MARKER} — showing the first ${cap.toLocaleString()} of ${full.toLocaleString()} characters of this document. ` +
    `You have NOT seen the rest. Do not conclude the document omits something you did not read; ` +
    `say which part you saw and offer to look at a specific section.]`
  );
}

/**
 * A Google link ANYWHERE in what the user said, rather than a string that is
 * nothing but a link.
 *
 * Requiring the whole argument to parse as a URL is how the first version of
 * this fix quietly missed: "please read <link>", a markdown link, angle
 * brackets and a newline before the URL all failed to parse, fell through to
 * the name search, and produced a refusal telling the user to paste the link
 * they had just pasted. This FINDS the link; it does not parse it — the id is
 * still read by extractDocId, which checks the host exactly.
 *
 * The leading boundary is load-bearing: without it "evil.test/docs.google.com/…"
 * matches from the middle. The trailing class stops at whitespace and at the
 * brackets and quotes a link gets wrapped in.
 */
const DRIVE_URL_ANYWHERE = /(?:^|[\s<("'\[])((?:https?:\/\/)?(?:docs|drive)\.google\.com\/[^\s<>"')\]]+)/i;

/** A Google link of any kind in the text, for deciding whether to tell somebody
 *  to paste one. Advising the action they have just taken is the loop. */
function mentionsAGoogleLink(q: string): boolean {
  return /(?:docs|drive)\.google\.com/i.test(q || "");
}

type QueryIdent = { kind: "id"; id: string; fromLink: boolean } | { kind: "folder" };

/**
 * Is this query a Drive link or a file id, rather than a document name?
 *
 * A LINK is unambiguous. A BARE id is not — "ITM-report-exec-draft-2026" is a
 * plausible file name and a plausible id at the same time — so a bare token
 * only takes this path when it is at least 25 characters with a digit in it
 * (real Drive ids are 33 or 44), and the caller falls back to a name search if
 * Drive says it has no such file. A link never falls back: a URL matches no
 * document name, so pretending to search by it would be theatre.
 *
 * NOTE the missing upper bound on a bare token. The length window belongs to
 * fetchById, where it guards the id actually being sent to Drive; duplicating
 * it here would make that guard unobservable, and an unobserved guard is how
 * this repo has reported a hole as closed before.
 */
function driveIdFromQuery(q: string): QueryIdent | null {
  const raw = (q || "").trim();
  if (!raw) return null;

  const m = raw.match(DRIVE_URL_ANYWHERE);
  if (m) {
    // Sentence punctuation clinging to the end of a pasted link.
    const url = m[1].replace(/[.,;:!?]+$/, "");
    // People retype links without the scheme; extractDocId needs a parseable
    // URL, and adding https:// cannot widen the host check behind it.
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const id = extractDocId(withScheme);
    if (id) return { kind: "id", id, fromLink: true };
    // A folder link is a real Drive link with nothing readable behind it, and
    // it is the shape Drive's own "Share" button hands you for a folder. Saying
    // which is far better than a name search that finds nothing and leaves the
    // user blaming their sharing.
    if (/\/folders\//i.test(url)) return { kind: "folder" };
    return null;
  }

  if (raw.length >= 25 && /^[A-Za-z0-9_-]+$/.test(raw) && /[0-9]/.test(raw)) {
    return { kind: "id", id: raw, fromLink: false };
  }
  return null;
}

type ByIdOutcome =
  | { kind: "file"; file: DriveFile }
  | { kind: "not-shared" }
  | { kind: "folder" }
  | { kind: "forbidden"; flavour: "policy" | "quota" | "unknown"; reason: string; detail: string }
  | { kind: "blocked" };

/**
 * Drive's own `error.errors[0].reason`, sorted into the only two groups that
 * change what the reader should DO. Everything else is left alone rather than
 * guessed at: a 403 whose reason we do not recognise gets Drive's words and no
 * interpretation in front of them.
 *
 * This is not a fourth outcome. It is the same 403, reported with the reason
 * Drive supplied instead of the one reason it always used to be given — which
 * told somebody hitting a rate limit that their organisation forbids sharing,
 * over the top of Drive's own "Rate Limit Exceeded" quoted two lines below.
 */
const PERMISSION_403 = ["forbidden", "insufficientfilepermissions", "insufficientpermissions", "domainpolicy", "appnotauthorizedtofile"];
const QUOTA_403 = ["ratelimitexceeded", "userratelimitexceeded", "dailylimitexceeded", "quotaexceeded", "sharingratelimitexceeded"];

function classify403(reason: string): "policy" | "quota" | "unknown" {
  const r = (reason || "").toLowerCase();
  if (PERMISSION_403.indexOf(r) >= 0) return "policy";
  if (QUOTA_403.indexOf(r) >= 0) return "quota";
  return "unknown";
}

/**
 * Ask Drive for one file by its id.
 *
 * This is the path that would have answered Chris's FIRST message. A file
 * shared directly with the service account is readable by id whether or not a
 * name search would ever find it — and on a Shared Drive it often would not,
 * because what files.list returns for a service account is not the same set as
 * what it may open.
 *
 * THREE outcomes, reported apart because they need three different things from
 * the person reading them: 404, nobody has shared it with us (or the link is
 * wrong); 403, it is shared but the owning organisation refuses us; and a file
 * that comes back carrying a driveId, which lives on a Shared Drive and is only
 * reachable because this request says supportsAllDrives. There is no fourth.
 *
 * SSRF: the id is taken from the user's URL, never the URL itself, and Drive's
 * own id grammar is [A-Za-z0-9_-] — checked here before it is substituted into
 * a hardcoded googleapis.com template. There is no notation of an internal host
 * that can survive that, which is why this does not route through safeFetch.
 */
async function fetchById(id: string, w: Wired): Promise<ByIdOutcome> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return { kind: "not-shared" };
  // The finance workbook is gated behind its own flag elsewhere. It is filtered
  // out of the list, so it has to be filtered out of the by-id path too, or
  // this becomes the way round that gate.
  if (id === FORECAST_FILE_ID) return { kind: "blocked" };

  const token = await w.getToken();
  const params = new URLSearchParams({
    fields: "id,name,mimeType,modifiedTime,driveId",
    supportsAllDrives: "true",
  });
  const res = await w.fetch(`https://www.googleapis.com/drive/v3/files/${id}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    console.log(`[DriveDocs] by-id ${id.slice(0, 10)}…: 404, not shared with the service account`);
    return { kind: "not-shared" };
  }
  if (res.status === 403) {
    let detail = "";
    let reason = "";
    try {
      const j: any = await res.json();
      detail = String((j && j.error && j.error.message) || "").slice(0, 200);
      const errs = j && j.error && j.error.errors;
      reason = String((errs && errs.length && errs[0] && errs[0].reason) || (j && j.error && j.error.status) || "").slice(0, 60);
    } catch {
      /* a 403 with an unreadable body is still a 403 */
    }
    const flavour = classify403(reason);
    console.log(`[DriveDocs] by-id ${id.slice(0, 10)}…: 403, refused (${reason || "no reason given"}, read as ${flavour})`);
    return { kind: "forbidden", flavour, reason, detail };
  }
  if (!res.ok) throw new Error(`Drive lookup failed (${res.status})`);
  const j: any = await res.json();
  if (!j || !j.id) return { kind: "not-shared" };
  if (j.mimeType === "application/vnd.google-apps.folder") {
    // A folder id is a real id pointing at something with no text in it. Say
    // which, rather than letting the reader hit "unsupported file type" — and
    // RETURN it rather than throwing, because a thrown message reaches the
    // model dressed as a failed request when the advice in it is correct.
    return { kind: "folder" };
  }
  if (j.id === FORECAST_FILE_ID) return { kind: "blocked" };
  console.log(`[DriveDocs] by-id ${id.slice(0, 10)}…: resolved "${j.name}"${j.driveId ? " (shared drive)" : ""}`);
  return {
    kind: "file",
    file: { id: j.id, name: j.name, mimeType: j.mimeType, modifiedTime: j.modifiedTime, driveId: j.driveId },
  };
}

/**
 * `answered: true` marks a result that IS Drive's answer — not shared, refused,
 * a folder, nothing matching that name — as opposed to a request that broke on
 * the way. They read identically to a model unless something says which, and
 * the formatter used to wrap both in "Drive documents query failed", so a
 * definitive 404 arrived sounding transient and invited exactly the retry the
 * 2026-09-21 incident was made of.
 */
export async function queryDriveDocs(
  action: string,
  name?: string,
  deps?: DriveDeps
): Promise<{ data: any; count: number; error?: string; notice?: string; answered?: boolean }> {
  const w = wire(deps);
  if (!w.configured) {
    return { data: [], count: 0, notice: "Drive documents aren't set up yet (the Google service account isn't configured). An admin needs to add GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY_B64." };
  }
  try {
    if (action === "list" || !name) {
      const files = await listShared(w);
      if (!files.length) {
        return { data: [], count: 0, notice: `No documents have been shared with EngineAI yet. Tell the user: ${shareWith(w)} and it becomes queryable here.` };
      }
      return { data: { documents: files.map((f) => ({ name: f.name, type: f.mimeType.split(".").pop(), modified: f.modifiedTime?.slice(0, 10) })) }, count: files.length };
    }

    // action === "read"
    //
    // A LINK OR AN ID FIRST. This is the branch that makes "here's the doc,
    // build me a deck" work on the first message: it asks Drive about that
    // exact file instead of hoping a cached list of names contains it.
    const ident = driveIdFromQuery(name);
    if (ident && ident.kind === "folder") {
      return {
        data: [],
        count: 0,
        answered: true,
        error: `That link points at a Drive FOLDER, not a document — a folder has no text to read. Open it and paste the link to the file inside it.`,
      };
    }
    if (ident) {
      const outcome = await fetchById(ident.id, w);
      if (outcome.kind === "file") {
        const text = await readFileText(outcome.file, w, LINK_MAX_CHARS);
        if (!text) return { data: [], count: 0, answered: true, error: `"${outcome.file.name}" contained no extractable text.` };
        return {
          data: {
            name: outcome.file.name,
            modified: outcome.file.modifiedTime?.slice(0, 10),
            resolvedBy: outcome.file.driveId
              ? "the link you pasted — the file lives on a Shared Drive, which is why it does not appear in the shared list"
              : "the link you pasted",
            content: text,
          },
          count: 1,
        };
      }
      if (outcome.kind === "folder") {
        return {
          data: [],
          count: 0,
          answered: true,
          error: `That link points at a Drive FOLDER, not a document — a folder has no text to read. Open it and paste the link to the file inside it.`,
        };
      }
      if (outcome.kind === "blocked") {
        return { data: [], count: 0, answered: true, error: `That file is the finance forecast workbook, which this tool cannot open — it has its own finance-gated report.` };
      }
      if (outcome.kind === "forbidden") {
        // Drive's own words, quoted, at the end of all three. What differs is
        // what the reader should do next, and only the permission reasons mean
        // "re-sharing will not help": a rate limit says the opposite.
        const said = outcome.detail ? ` Drive said: "${outcome.detail}"` : "";
        const code = `403${outcome.reason ? `, ${outcome.reason}` : ""}`;
        if (outcome.flavour === "policy") {
          return {
            data: [],
            count: 0,
            answered: true,
            error:
              `Drive knows that file but refused to open it for EngineAI (${code}). It IS shared — the owner's organisation forbids sharing it outside, so no amount of re-sharing from here will help. ` +
              `Ask the owner to allow external access, or to send the file another way.` + said,
          };
        }
        if (outcome.flavour === "quota") {
          return {
            data: [],
            count: 0,
            answered: true,
            error:
              `Drive refused that request for EngineAI (${code}) — a rate or quota limit on OUR side, not a fact about the document and not about who it is shared with. ` +
              `Nothing needs re-sharing; the same request is worth making again shortly.` + said,
          };
        }
        return {
          data: [],
          count: 0,
          answered: true,
          error:
            `Drive refused that request for EngineAI (${code}). That is neither the "not shared with us" answer nor a quota limit, and there is nothing here worth guessing at — relay Drive's own words and say the reason is unknown to us.` + said,
        };
      }
      // not-shared. From a LINK this is conclusive and gets said plainly; from a
      // bare token it may simply have been a document name all along, so fall
      // through to the name search rather than refusing something that exists.
      if (ident.fromLink) {
        return {
          data: [],
          count: 0,
          answered: true,
          error:
            `Drive has just been asked about that link directly, by file id (${ident.id.slice(0, 12)}…), and answered 404: it is not shared with EngineAI, or the id in that link is wrong. ` +
            `Nothing was read from a cache to say so. To fix it, ${shareWith(w)} — then ask again and it will be found immediately.`,
        };
      }
    }

    const q = name.toLowerCase();
    const pick = (files: DriveFile[]) =>
      files.find((f) => f.name.toLowerCase() === q) || files.find((f) => f.name.toLowerCase().includes(q));

    let files = await listShared(w);
    let match = pick(files);
    let refreshState: MissRefresh["state"] | null = null;
    if (!match) {
      // A MISS IS NEVER SERVED FROM AN UNQUESTIONED CACHE. The list that failed
      // Chris was 41 seconds old and three files long; the file he was asking
      // about had been shared 20 seconds earlier. Re-ask before concluding.
      const again = await refreshOnMiss(w);
      files = again.files;
      refreshState = again.state;
      match = pick(files);
    }

    if (!match) {
      const offers = rankCandidates(files, name, w);
      // Say which of the three actually happened. The middle sentence used to
      // be printed unconditionally, so a re-read that failed was reported as a
      // re-read that had just succeeded.
      const freshness =
        refreshState === "refreshed"
          ? `The list was re-read from Drive just now — ${files.length} file(s) are visible to EngineAI.`
          : refreshState === "rate-limited"
            ? `The list was last read from Drive ${listAge(w)} and holds ${files.length} file(s); it was re-read moments ago, so it has not been asked again.`
            : `Drive could NOT be re-read just now — the last attempt to refresh the list failed — so this is a list from ${listAge(w)} holding ${files.length} file(s), and it may be out of date. Say that rather than telling anyone their document is not shared.`;
      const suggestion = offers.length
        ? `Closest to what you asked for: ${offers.join("; ")}. Offer these by name rather than guessing.`
        : `Nothing shared is close to that name.`;
      // Telling somebody to paste a link they have already pasted is how this
      // incident kept going round. If there is a Google URL in the request, the
      // problem is that we could not read a document id out of it — say that.
      const lastResort = mentionsAGoogleLink(name)
        ? `There is a Google link in that request but no document id could be read from it, so do NOT ask for it again — ask which of the documents above it is, or ${shareWith(w)}.`
        : `If it is none of those, ${shareWith(w)} — or paste its Drive link and it will be looked up by id, which works even when the name search cannot see it.`;
      return {
        data: { available: files.map((f) => f.name), candidates: offers },
        count: files.length,
        answered: refreshState !== "unreachable",
        error: [`No shared document matching "${name}".`, freshness, suggestion, lastResort].join(" "),
      };
    }

    const text = await readFileText(match, w);
    if (!text) return { data: [], count: 0, answered: true, error: `"${match.name}" contained no extractable text.` };
    return { data: { name: match.name, modified: match.modifiedTime?.slice(0, 10), content: text }, count: 1 };
  } catch (err: any) {
    console.error("[DriveDocs] Failed:", err?.message);
    return { data: [], count: 0, error: `Drive lookup failed: ${String(err?.message || err).slice(0, 200)}` };
  }
}
