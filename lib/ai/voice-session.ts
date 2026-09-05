/**
 * The decisions a live voice session makes about itself, as pure functions.
 *
 * Lifted out of VoiceDock so they can be tested against the real thing. The
 * component is a 1,000-line client module that opens a WebSocket and a
 * microphone at mount; a check cannot import it, so a check written against it
 * would have to re-implement these rules and would then be testing its own
 * copy. This repo has already shipped that mistake twice.
 *
 * Everything here is deliberately free of React, browser APIs and network
 * calls, so scripts/verify-voice-session.ts imports exactly what runs.
 */

/**
 * Spoken hard-stop phrases — an immediate end, with no model round-trip.
 *
 * WHOLE UTTERANCE, not "anywhere in the sentence". The original pattern was
 * unanchored, so "how should I end the conversation with Galderma" tore the
 * session down mid-question: a user asking ABOUT ending something was
 * indistinguishable from a user ending this. Leading politeness is allowed,
 * because people really do say "ok, that's all thanks" — but the phrase has to
 * BE the utterance rather than sit inside one.
 *
 * "that's all" takes its trailing thanks as OPTIONAL. Requiring it meant
 * "thanks, that's all" — leading politeness, which the pattern explicitly
 * allows — matched nothing and the sign-off was unreachable. Found by the
 * check, not by using it.
 */
export const HARD_END_RE =
  /^\s*(ok(ay)?[,.\s]*)?(thanks?[,.\s]*)?(orac[,.\s]*)?(stop listening|end (the )?(conversation|chat|session)|that('|’)?s all(,? thanks?)?)[.!\s]*$/i;

/**
 * Bare voice commands that end the session — Alexa-style, whole utterance.
 *
 * "stop" and "cancel" are deliberately NOT here. Both are ordinary answers to
 * an ordinary question — "shall I cancel it?" "cancel" — and ending the whole
 * session on one is a far worse outcome than not offering the shortcut.
 * Interrupting is already handled by barge-in, which is what a bare "stop"
 * almost always means anyway.
 */
export const BARE_STOP_RE =
  /^\s*(orac[,!.]?\s*)?(never ?mind|go to sleep|shut up|that('|’)?s (all|enough))[.!?]?\s*$/i;

/** Does this utterance end the session outright? */
export function isHardStop(utterance: string): boolean {
  const t = String(utterance || "");
  return HARD_END_RE.test(t) || BARE_STOP_RE.test(t);
}

/**
 * Idle handling for ORDINARY (non-wake) sessions, which had none at all.
 *
 * The close check returned false immediately unless the session was a wake
 * session, and wake is now off — so every session that can currently run had
 * no timeout whatever. A forgotten tab streamed the microphone to xAI
 * indefinitely at $0.05 a minute. The warning is visible before anything
 * closes, because a session that ends on its own with no warning is its own
 * bug.
 */
export const IDLE_WARN_MS = 60_000;
export const IDLE_END_MS = 90_000;

export type IdleVerdict = { state: "active" | "warning" | "expired"; secondsLeft: number | null };

/** What an ordinary session should do after this much silence. */
export function idleVerdict(idleForMs: number): IdleVerdict {
  if (idleForMs > IDLE_END_MS) return { state: "expired", secondsLeft: 0 };
  if (idleForMs > IDLE_WARN_MS) {
    return { state: "warning", secondsLeft: Math.ceil((IDLE_END_MS - idleForMs) / 1000) };
  }
  return { state: "active", secondsLeft: null };
}

/**
 * Labels for the tools the model can call.
 *
 * TEXT ONLY — the icons stay in the component, because this module must not
 * import React. The map had six entries against eight offered tools, and the
 * two missing ones (query_xero, query_resourcing) are the slowest on this
 * surface: the chip failed to render at exactly the moments a user most needed
 * to know something was happening.
 */
export const TOOL_LABEL_TEXT: Record<string, string> = {
  query_engine: "Checking the Engine",
  lookup_client_context: "Pulling client profile",
  search_memory: "Searching memories",
  query_meetingbrain: "Checking meetings",
  query_slack: "Checking Slack",
  consult_analyst: "Consulting the analyst",
  query_xero: "Checking the finances",
  query_resourcing: "Checking capacity",
};

/**
 * A readable label for ANY tool, including one nobody wrote a label for.
 *
 * The fallback is the point. A hand-kept list of names is the wrong shape for
 * something that must never be blank: it makes a label-less tool unlikely,
 * where this makes it impossible.
 */
export function toolLabel(name: string): string {
  const known = TOOL_LABEL_TEXT[name];
  if (known) return known;
  const words = String(name || "").replace(/^(query|lookup|search|get)_/, "").replace(/_/g, " ").trim();
  return words ? `Checking ${words}` : "Working";
}

/**
 * The tool's arguments as a readable phrase — "contracts · Galderma · 90".
 *
 * The model already sends these and the client already forwards them; they
 * were simply never shown. Rendering them turns a dead pause into visible
 * work, and lets the user catch a mis-heard client name BEFORE the answer is
 * built on it.
 *
 * VALUES ONLY, and capped. The keys are internal field names and read as noise;
 * a long free-text argument would push the bar wider than the composer it sits
 * in. Anything unparseable yields "" rather than throwing — a malformed
 * argument must never be able to take the dock down with it.
 */
export function toolArgsPhrase(raw: unknown): string {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return ""; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  const out: string[] = [];
  for (let i = 0; i < keys.length && out.length < 3; i++) {
    const v = obj[keys[i]];
    if (typeof v === "string" && v.trim()) out.push(v.trim().slice(0, 28));
    else if (typeof v === "number" && Number.isFinite(v)) out.push(String(v));
  }
  return out.join(" · ");
}
