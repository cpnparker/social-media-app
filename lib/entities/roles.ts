/**
 * The pure half of the reflection pass: what a derived role is allowed to say,
 * and which claims survive validation.
 *
 * Separated from the script so it can be tested without a database, a model or
 * a credential — the parts most likely to be wrong are the ones that decide
 * whether a claim about a named person gets written down.
 */

export const SENIORITY = ["head_of","director","lead","manager","specialist","founder","board","advisor","unspecified"] as const;
export const FUNCTION  = ["procurement","finance","marketing","communications","programmes","legal","operations","technology","executive","unspecified"] as const;
export type Seniority = typeof SENIORITY[number];
export type Fn = typeof FUNCTION[number];

/**
 * Compose the role sentence from enums — never from model text.
 *
 * This is the whole injection defence. The extraction schema has no
 * string-typed property, so a model reading meeting notes written by whoever
 * was in the room cannot emit an arbitrary string; it returns two enum members
 * and an index. The words below are the only words that can ever appear, and
 * they live in this file.
 */
export function composeRole(seniority: string, fn: string): string | null {
  const S: Record<string, string> = {
    head_of: "head of", director: "director of", lead: "lead for",
    manager: "manager of", specialist: "specialist in",
    founder: "founder", board: "board member", advisor: "advisor",
  };
  const F: Record<string, string> = {
    procurement: "procurement", finance: "finance", marketing: "marketing",
    communications: "communications", programmes: "programmes", legal: "legal",
    operations: "operations", technology: "technology", executive: "the executive",
  };
  const hasS = Object.prototype.hasOwnProperty.call(S, seniority);
  const hasF = Object.prototype.hasOwnProperty.call(F, fn);
  // Nothing said: the honest output is nothing. "unspecified/unspecified" is
  // the most common real answer and must not become a role.
  if (!hasS && !hasF) return null;

  // STANDALONE TITLES TAKE NO FUNCTION. "founder" is a complete description of
  // what someone is; "head of" is not. The first version appended the function
  // regardless and produced "founder the executive" in a live run — real
  // output, on a real person, from the first pass. A title that reads as
  // gibberish is worse than no title: it makes every other fact in the block
  // look untrustworthy.
  const STANDALONE = ["founder", "board", "advisor"];
  if (STANDALONE.indexOf(seniority) >= 0) return S[seniority];
  if (!hasF) return null;   // "head of" with nothing to head is not a role

  // "executive" is not a department you work IN. It reads correctly after
  // "head of" and nowhere else, so the bare case gets its own wording — the
  // same run produced "works in the executive".
  if (fn === "executive") return hasS ? `${S[seniority]} the executive team` : "is an executive";
  if (!hasS) return `works in ${F[fn]}`;
  return `${S[seniority]} ${F[fn]}`;
}

/** A recurring Gemini doc is copied onto every instance row, and each instance
 *  has its own calendar_event_id — so counting EVENTS lets one sentence spoken
 *  once clear a two-event threshold. Count series. */
export function seriesKey(eventId: string): string {
  const id = eventId || "";
  const cut = id.indexOf("_");
  return cut > 0 ? id.slice(0, cut) : id;
}

export interface RawClaim { person_index?: unknown; seniority?: unknown; function?: unknown; tense?: unknown }
export type DropReason = "unbound" | "not_current" | "no_role";

/**
 * Validate one model claim against a roster.
 *
 * The roster IS the attendee set for that one event, so binding to an index
 * inside it enforces reachability by construction: someone in the room may
 * contribute a fact about the room, and cannot author the org chart of a
 * company they have never emailed.
 */
export function validateClaim(
  c: RawClaim,
  rosterSize: number
): { ok: true; index: number; role: string } | { ok: false; reason: DropReason } {
  const i = c.person_index;
  if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= rosterSize) return { ok: false, reason: "unbound" };
  if (typeof c.seniority !== "string" || SENIORITY.indexOf(c.seniority as Seniority) < 0) return { ok: false, reason: "unbound" };
  if (typeof c.function !== "string" || FUNCTION.indexOf(c.function as Fn) < 0) return { ok: false, reason: "unbound" };
  // Anything but a role held NOW is dropped. A past role rendered as present is
  // the most embarrassing possible output of this system.
  if (c.tense !== "current") return { ok: false, reason: "not_current" };
  const role = composeRole(c.seniority as string, c.function as string);
  if (!role) return { ok: false, reason: "no_role" };
  return { ok: true, index: i, role };
}

/** Distinct SERIES supporting a claim, and whether that clears the bar. */
export function surfaces(eventIds: string[], minSeries = 2): { series: number; surfaced: boolean } {
  const s: string[] = [];
  for (const id of eventIds) {
    const k = seriesKey(id);
    if (s.indexOf(k) < 0) s.push(k);
  }
  return { series: s.length, surfaced: s.length >= minSeries };
}
