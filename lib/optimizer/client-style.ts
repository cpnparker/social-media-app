/**
 * Client style — how a client SOUNDS, as distinct from what is true about them.
 *
 * The canon (client-canon.ts) answers "what may I assert": names, aliases,
 * facts with provenance, target queries. It has never answered "how should this
 * read", and the gap showed: generation borrowed the workspace's default voice
 * for every client, and the judge's tone criteria had nothing to check against
 * except the model's own taste.
 *
 * `optimizer_client_canon.document_voice` has existed since the schema shipped
 * (20260821 sql:230) with a default of '' and — verified 2026-08-25 — NO WRITER
 * AND NO READER anywhere in the codebase. A column-shaped intention. This module
 * is the intention carried out.
 *
 * ── WHY DERIVED, NOT WRITTEN BY HAND ────────────────────────────────────────
 *
 * Asking an account manager to describe a client's voice produces adjectives
 * ("professional, approachable") that constrain nothing. Deriving it from the
 * client's own finished drafts produces observations a model can act on and a
 * judge can check: which person they write in, whether they use the industry
 * term or the plain one, how long their sentences run. The card is EDITABLE
 * because a derived observation can be wrong and the person who noticed is the
 * one holding the client relationship — and an edited card is never silently
 * overwritten by a refresh, because a hand-tuned voice is a deliberate artifact
 * rather than a cache entry.
 *
 * ── WHY IT IS NOT AUTOMATIC SPEND ───────────────────────────────────────────
 *
 * Derivation runs on CLIENT SELECTION — a click — and is memoised for 30 days.
 * That keeps it inside the manual `optimizer` service row rather than needing
 * one of the automatic rows, and keeps Stage 1's promise that it adds no
 * background spend. A studio that silently re-derives a style card every time a
 * session opens is the shape of every billing fault found in this repo.
 */
import { intelligenceDb } from "@/lib/supabase-intelligence";

/** Bumped when the derivation prompt or the card's shape changes. */
export const STYLE_VERSION = "1.0.0";

/** Re-derive after this long. A client's voice moves slowly; 30 days is generous. */
export const STYLE_STALE_DAYS = 30;

/** Hard cap on the card, so it cannot bloat the cached prefix of every prompt. */
export const STYLE_MAX_CHARS = 1400;

export interface ClientStyle {
  clientId: number;
  clientName: string;
  /** The card itself: plain prose, a handful of observations. May be "". */
  text: string;
  /** True when a person has edited it — refresh must then ask before replacing. */
  edited: boolean;
  refreshedAt: string | null;
  /** Why the card is thin or absent. A thin style must LOOK thin. */
  gap: string | null;
}

export const EMPTY_STYLE = (clientId: number, clientName: string, gap: string): ClientStyle => ({
  clientId,
  clientName,
  text: "",
  edited: false,
  refreshedAt: null,
  gap,
});

/**
 * The system prompt for derivation.
 *
 * Deliberately asks for OBSERVATIONS, not praise, and forbids inventing a voice
 * for a client with too little material — the same doctrine as the canon's
 * `gaps`: a thin answer must look thin rather than look complete.
 */
export const STYLE_SYSTEM = `You are reading a client's own published writing to describe how it SOUNDS, so that other writing can match it.

Report only what you can SEE in the samples. Write 4-7 short observations, one per line, no bullets, no preamble, no summary sentence.

Cover only what is actually evident:
- person and stance (first person plural? third person? does it address the reader as "you"?)
- sentence rhythm (short and declarative? long with subordinate clauses?)
- vocabulary they USE for their own domain, and any plainer synonym they avoid
- how they name their own products and whether they capitalise them
- whether they hedge ("may", "we believe") or state flatly
- anything they conspicuously never do (no exclamation marks, no rhetorical questions, no first person)

Rules:
- Quote a short phrase as evidence where it makes an observation concrete.
- If the samples are too few or too similar to support an observation, say so in one line and stop. Do NOT pad with generic advice that would be true of any business.
- Never recommend changes. This is a description of how they write, not a critique.`;

/** Rows we consider representative: the client's finished work in this studio. */
const SAMPLE_LIMIT = 5;
const SAMPLE_CHARS = 6000;

/**
 * Gather the client's own finished drafts as derivation input.
 *
 * Finalised sessions only — a half-written draft is not evidence of voice, and
 * including one would teach the model the client sounds unfinished.
 */
export async function gatherStyleSamples(
  workspaceId: string,
  clientId: number
): Promise<{ samples: string[]; gap: string | null }> {
  try {
    const { data: sessions, error } = await intelligenceDb
      .from("optimizer_sessions")
      .select("id_session, name_title, type_status, date_updated")
      .eq("id_workspace", workspaceId)
      .eq("id_client", clientId)
      .in("type_status", ["finalised", "refining", "draft_ready"])
      .order("date_updated", { ascending: false })
      .limit(SAMPLE_LIMIT);
    if (error) return { samples: [], gap: `Could not read past work (${error.code || "error"}).` };
    if (!sessions || sessions.length === 0) {
      return { samples: [], gap: "No finished work for this client in the studio yet." };
    }

    const ids = sessions.map((s: any) => s.id_session);
    const { data: drafts } = await intelligenceDb
      .from("optimizer_drafts")
      .select("id_session, document_body, units_version")
      .in("id_session", ids)
      .order("units_version", { ascending: false });

    // One draft per session — the highest version, which is the finished one.
    const seen: Record<string, boolean> = {};
    const samples: string[] = [];
    for (let i = 0; i < (drafts || []).length; i++) {
      const d: any = (drafts as any[])[i];
      if (seen[d.id_session]) continue;
      seen[d.id_session] = true;
      const body = String(d.document_body || "").trim();
      if (body.length < 400) continue; // too short to show a voice
      samples.push(body.slice(0, SAMPLE_CHARS));
    }
    if (!samples.length) {
      return { samples: [], gap: "Past work for this client is too short to read a voice from." };
    }
    return { samples, gap: null };
  } catch (e: any) {
    return { samples: [], gap: `Could not read past work (${e?.message || e}).` };
  }
}

/** Read the stored card. Never throws — a missing style must not block a studio. */
export async function loadClientStyle(
  workspaceId: string,
  clientId: number,
  clientName: string
): Promise<ClientStyle> {
  try {
    const { data, error } = await intelligenceDb
      .from("optimizer_client_canon")
      .select("document_voice, date_refreshed")
      .eq("id_workspace", workspaceId)
      .eq("id_client", clientId)
      .maybeSingle();
    if (error || !data) return EMPTY_STYLE(clientId, clientName, "Not derived yet.");
    const raw = String((data as any).document_voice || "");
    if (!raw.trim()) return EMPTY_STYLE(clientId, clientName, "Not derived yet.");
    const parsed = parseStored(raw);
    return {
      clientId,
      clientName,
      text: parsed.text,
      edited: parsed.edited,
      refreshedAt: (data as any).date_refreshed || null,
      gap: null,
    };
  } catch {
    return EMPTY_STYLE(clientId, clientName, "Not derived yet.");
  }
}

/**
 * The column is `text NOT NULL DEFAULT ''`, and we need one bit more than text:
 * whether a person edited the card, so a refresh can refuse to overwrite their
 * work silently.
 *
 * Stored as JSON, not as a sentinel prefix. The first attempt used a marker
 * string and the constant silently acquired two U+0001 bytes, which would have
 * been written into the database on every save. This repo already has one file
 * `grep` cannot read because of stray control bytes; a COLUMN carrying them
 * would be worse, and nothing would have reported it. JSON has no such failure
 * mode, and `stripControl` makes a recurrence impossible rather than merely
 * unlikely.
 *
 * Anything that does not parse as our JSON is read as plain derived text. That
 * covers the pre-existing default (''), a value typed by hand in the SQL
 * editor, and any future writer that does not know this encoding — all of which
 * should read as "a style card, not edited", never as an error.
 */
interface StoredStyle { v: 1; edited: boolean; text: string }

/**
 * Control characters have no business in a prompt or a text column.
 *
 * Applied on the way IN and on the way OUT: a value already stored by an older
 * writer is cleaned on read rather than trusted.
 */
export function stripControl(s: string): string {
  return s.replace(new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g"), "");
}

function parseStored(raw: string): { text: string; edited: boolean } {
  const trimmed = raw.trim();
  if (trimmed.charAt(0) === "{") {
    try {
      const j = JSON.parse(trimmed) as StoredStyle;
      if (j && typeof j.text === "string") {
        return { text: stripControl(j.text), edited: !!j.edited };
      }
    } catch { /* not ours — fall through and treat it as plain text */ }
  }
  return { text: stripControl(raw), edited: false };
}

export function encodeStored(text: string, edited: boolean): string {
  const clipped = stripControl(text).trim().slice(0, STYLE_MAX_CHARS);
  const payload: StoredStyle = { v: 1, edited, text: clipped };
  return JSON.stringify(payload);
}

/** Write the card. Upserts the canon row so a client with no canon still gets a style. */
export async function saveClientStyle(
  workspaceId: string,
  clientId: number,
  text: string,
  edited: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await intelligenceDb
      .from("optimizer_client_canon")
      .upsert(
        {
          id_workspace: workspaceId,
          id_client: clientId,
          document_voice: encodeStored(text, edited),
          date_refreshed: new Date().toISOString(),
          date_updated: new Date().toISOString(),
        },
        { onConflict: "id_workspace,id_client" }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function isStale(refreshedAt: string | null): boolean {
  if (!refreshedAt) return true;
  const t = Date.parse(refreshedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STYLE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The prompt block, for the STABLE region of every generation prompt.
 *
 * SHAPE IS CONSTANT. A client with no style yields the same "no house style
 * recorded" block rather than nothing at all, because the prefix must be
 * byte-stable in SHAPE for prompt caching: a block that appears and disappears
 * between clients changes the prefix length and moves the cache breakpoint,
 * which costs a full cache write on every switch. Same reason the block is
 * built here rather than interpolated at each call site.
 */
export function styleBlock(style: ClientStyle | null): string {
  const head = "# House style";
  if (!style || !style.text.trim()) {
    return `${head}\nNo house style recorded for this client. Write in the workspace's neutral register: plain, direct, third person.`;
  }
  return (
    `${head}\n` +
    `How ${style.clientName} writes, observed from their own published work. Match it. ` +
    `These are observations, not instructions to mention:\n${style.text.trim()}`
  );
}

/** The bytes a style contributes to a memo key — so a style change invalidates. */
export function styleKeyPart(style: ClientStyle | null): string {
  if (!style || !style.text.trim()) return `style:none@${STYLE_VERSION}`;
  // Length + a cheap hash: the full card would bloat every key for no benefit.
  let h = 0x811c9dc5;
  const t = style.text;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `style:${t.length}:${h.toString(36)}@${STYLE_VERSION}`;
}
