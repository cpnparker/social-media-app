/**
 * Anchoring an LLM's quoted span to a position in the writer's document.
 *
 * The judge returns findings that quote the text they are about. To highlight
 * one — and, more dangerously, to APPLY its suggested rewrite — that quote has
 * to be located in a document the writer is still editing.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: never guess. A wrong anchor does not
 * fail loudly, it silently highlights the wrong sentence and then silently
 * REWRITES it. An unmatched finding becomes an orphan — still shown in the
 * panel, still true, just without a highlight and without an Apply button.
 * That is a visibly degraded state, which is the point: a writer can see an
 * orphan and judge it, and cannot see a mis-anchor at all.
 *
 * WHY QUOTES AND NOT OFFSETS: character offsets rot the instant anything above
 * the span changes, and a rotted offset still points somewhere. Quote plus a
 * little surrounding context re-derives the position from the current document
 * every time, and fails honestly when the text is gone. This mirrors the W3C
 * TextQuoteSelector model that annotation tools converged on for the same
 * reason.
 */

export interface Anchor {
  /** Verbatim text the judge quoted. Matched first, exactly. */
  quote: string;
  /** Up to ~32 chars immediately before the quote — disambiguates repeats. */
  prefix?: string;
  /** Up to ~32 chars immediately after. */
  suffix?: string;
}

export type AnchorMatch =
  | { ok: true; start: number; end: number; confidence: "exact" | "context" | "normalised" }
  | { ok: false; reason: "not_found" | "ambiguous" | "empty" };

/** Longest quote we will try to anchor. Keeps fuzzy work bounded and keeps
 *  suggested rewrites small enough for a writer to review at a glance. */
export const MAX_QUOTE_LENGTH = 200;
export const CONTEXT_LENGTH = 32;

/**
 * Characters that routinely differ between what a model emits and what an
 * editor stores, without any human having changed the text: smart quotes,
 * dash width, non-breaking spaces. Normalising these is safe. Normalising
 * anything that changes WORDS is not, and is deliberately absent.
 */
function normalise(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Build a plain-text-offset → source-offset map for a normalised string.
 *
 * Normalisation collapses whitespace runs, so an offset in the normalised text
 * does not correspond to the same offset in the original. Without this map the
 * normalised fallback would return positions that are subtly wrong — which is
 * exactly the silent mis-anchor this module exists to prevent, arriving
 * through the door marked "fallback".
 */
function normaliseWithMap(s: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (ch === "‘" || ch === "’" || ch === "‛") ch = "'";
    else if (ch === "“" || ch === "”" || ch === "‟") ch = '"';
    else if (ch === "–" || ch === "—") ch = "-";
    else if (ch === " ") ch = " ";

    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out.push(" ");
      map.push(i);
      lastWasSpace = true;
    } else {
      out.push(ch);
      map.push(i);
      lastWasSpace = false;
    }
  }
  return { text: out.join(""), map };
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + 1;
  }
  return out;
}

/**
 * Score a candidate position by how well the surrounding text matches the
 * prefix/suffix the judge recorded. Used only to choose BETWEEN candidates,
 * never to accept one — a lone candidate with no context agreement is still
 * accepted, and several candidates with no agreement are still ambiguous.
 */
function contextScore(text: string, start: number, end: number, a: Anchor): number {
  let score = 0;
  if (a.prefix) {
    const before = text.slice(Math.max(0, start - a.prefix.length), start);
    if (normalise(before).endsWith(normalise(a.prefix))) score += 2;
    else if (normalise(before).indexOf(normalise(a.prefix).slice(-8)) >= 0) score += 1;
  }
  if (a.suffix) {
    const after = text.slice(end, end + a.suffix.length);
    if (normalise(after).startsWith(normalise(a.suffix))) score += 2;
    else if (normalise(after).indexOf(normalise(a.suffix).slice(0, 8)) >= 0) score += 1;
  }
  return score;
}

/**
 * Locate an anchor in `text`.
 *
 * Three passes, each strictly weaker than the last, and no pass below them:
 *   1. exact match, unique                     → confidence "exact"
 *   2. exact match, several — context decides  → confidence "context"
 *   3. normalised match (quotes/dashes/spaces) → confidence "normalised"
 * Anything else is an orphan. There is deliberately no edit-distance or
 * similarity-threshold pass: "close enough" is how you rewrite the wrong
 * sentence, and the cost of an orphan is a missing highlight.
 */
export function findAnchor(text: string, anchor: Anchor): AnchorMatch {
  const quote = (anchor.quote || "").trim();
  if (!quote || !text) return { ok: false, reason: "empty" };

  // 1 & 2 — exact.
  const hits = allIndexesOf(text, quote);
  if (hits.length === 1) {
    return { ok: true, start: hits[0], end: hits[0] + quote.length, confidence: "exact" };
  }
  if (hits.length > 1) {
    let best = -1;
    let bestScore = -1;
    let tie = false;
    for (let i = 0; i < hits.length; i++) {
      const s = contextScore(text, hits[i], hits[i] + quote.length, anchor);
      if (s > bestScore) { bestScore = s; best = hits[i]; tie = false; }
      else if (s === bestScore) tie = true;
    }
    // A tie with no context to break it means we genuinely cannot tell which
    // occurrence the judge meant. Picking the first would be a coin flip
    // dressed up as a result.
    if (best >= 0 && bestScore > 0 && !tie) {
      return { ok: true, start: best, end: best + quote.length, confidence: "context" };
    }
    return { ok: false, reason: "ambiguous" };
  }

  // 3 — normalised.
  const { text: normText, map } = normaliseWithMap(text);
  const normQuote = normalise(quote);
  const normHits = allIndexesOf(normText, normQuote);
  if (normHits.length === 1) {
    const start = map[normHits[0]];
    const endIdx = normHits[0] + normQuote.length - 1;
    const end = endIdx < map.length ? map[endIdx] + 1 : text.length;
    return { ok: true, start, end, confidence: "normalised" };
  }
  if (normHits.length > 1) return { ok: false, reason: "ambiguous" };

  return { ok: false, reason: "not_found" };
}

/**
 * The contract the judge's output must satisfy for anchoring to work.
 *
 * Checked on the way IN, not at highlight time, so a malformed finding is
 * rejected while we still know which prompt produced it — rather than becoming
 * a mysterious orphan three screens later.
 */
export function validateAnchor(anchor: Anchor): { ok: true } | { ok: false; problem: string } {
  const quote = (anchor.quote || "").trim();
  if (!quote) return { ok: false, problem: "quote is empty" };
  if (quote.length > MAX_QUOTE_LENGTH) {
    return { ok: false, problem: `quote is ${quote.length} chars, over the ${MAX_QUOTE_LENGTH} limit` };
  }
  if (quote.indexOf("…") >= 0 || quote.indexOf("...") >= 0) {
    // An elided quote cannot be matched verbatim and cannot be safely replaced.
    return { ok: false, problem: "quote contains an ellipsis — it must be verbatim and unabridged" };
  }
  if (/\n\s*\n/.test(quote)) {
    return { ok: false, problem: "quote spans a paragraph boundary" };
  }
  return { ok: true };
}

/**
 * Re-anchor a set of findings against the current document.
 *
 * Called on load and after every re-assessment. Findings that cannot be placed
 * come back marked orphaned rather than dropped: the finding is still true,
 * only its location is lost, and a writer who fixed the sentence themselves
 * should see that the tool noticed rather than see the note vanish.
 */
export interface AnchoredFinding<T> {
  finding: T;
  match: AnchorMatch;
  orphaned: boolean;
}

export function anchorAll<T extends { quote: string; prefix?: string; suffix?: string }>(
  text: string,
  findings: T[]
): AnchoredFinding<T>[] {
  const out: AnchoredFinding<T>[] = [];
  const claimed: { start: number; end: number }[] = [];

  // Longest first: a short quote nested inside a longer one should not claim
  // the region the longer finding is about.
  const order = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (b.f.quote || "").length - (a.f.quote || "").length);

  const results: (AnchoredFinding<T> | null)[] = new Array(findings.length).fill(null);

  for (let k = 0; k < order.length; k++) {
    const { f, i } = order[k];
    const match = findAnchor(text, { quote: f.quote, prefix: f.prefix, suffix: f.suffix });
    if (match.ok) {
      let overlaps = false;
      for (let c = 0; c < claimed.length; c++) {
        if (match.start < claimed[c].end && claimed[c].start < match.end) { overlaps = true; break; }
      }
      if (overlaps) {
        // Two findings resolving to the same span means at least one is
        // anchored wrong. Orphaning the shorter one is the conservative
        // choice — it loses a highlight, not a sentence.
        results[i] = { finding: f, match: { ok: false, reason: "ambiguous" }, orphaned: true };
      } else {
        claimed.push({ start: match.start, end: match.end });
        results[i] = { finding: f, match, orphaned: false };
      }
    } else {
      results[i] = { finding: f, match, orphaned: true };
    }
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r) out.push(r);
  }
  return out;
}
