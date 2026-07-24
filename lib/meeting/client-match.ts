/**
 * Lightweight, client-safe fuzzy matcher for EngineAI Live client resolution.
 *
 * Matches a (often mis-transcribed) spoken client name in an utterance against
 * the workspace roster, entirely client-side — no server round-trip, no heavy
 * providers.ts import into the companion window. Deliberately conservative:
 * only returns an UNAMBIGUOUS winner, and the UI treats it as a suggestion the
 * user confirms ("load their briefing?") rather than auto-binding — a wrong
 * bind surfacing the wrong client's data mid-call is worse than a missed one.
 */

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function toks(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
/** Do two tokens match, allowing for voice mishearings? */
function tokenMatch(nameTok: string, uttTok: string): boolean {
  if (nameTok === uttTok) return true;
  if (nameTok.length >= 5 && uttTok.length >= 5 && (nameTok.includes(uttTok) || uttTok.includes(nameTok))) return true;
  const tol = Math.min(nameTok.length, uttTok.length) >= 7 ? 2 : 1;
  return Math.abs(nameTok.length - uttTok.length) <= tol && lev(nameTok, uttTok) <= tol;
}

/**
 * Words that are generic in an agency context — they carry no evidence that a
 * specific client was named. "How many CONTENT units this month?" must never
 * match a client called "The Content Engine" on the word "content" alone.
 */
const GENERIC_TOKENS = new Set([
  "content", "engine", "media", "social", "digital", "group", "agency",
  "creative", "studio", "marketing", "brand", "company", "global", "partners",
  "communications", "consulting", "solutions", "international", "management",
  "team", "client", "video", "design", "production",
]);

/**
 * Initialisms that are ambient vocabulary in agency conversations — hearing
 * one is NEVER evidence a client was named. The field failure: a client called
 * "AI Media" matched every spoken "AI" in an internal meeting (via the
 * ALL-CAPS alias rule) and hijacked the bind proposal for the whole call.
 */
const ACRONYM_STOPWORDS = new Set([
  "ai", "cu", "cus", "pr", "hr", "uk", "us", "usa", "eu", "un", "roi", "kpi",
  "ceo", "cfo", "cmo", "coo", "cto", "seo", "geo", "aeo", "cop", "nyc", "b2b",
  "b2c", "faq", "usp", "ui", "ux", "qa", "it", "tv", "app", "llm", "gpt", "q1",
  "q2", "q3", "q4",
  // ALL-CAPS name fragments that are also everyday spoken words — "Marsh
  // US/CAN" must never match on the word "can". Any alias that is a common
  // English word will false-positive on normal speech.
  "can", "and", "the", "for", "you", "are", "was", "not", "but", "all", "one",
  "two", "new", "now", "who", "how", "may", "own", "off", "out", "get", "let",
  "see", "use", "say", "top", "end", "act", "art", "air", "age", "map", "net",
  "sun", "sky", "way", "day", "man", "men", "car", "van", "hub", "lab", "pro",
]);

/**
 * Corporate descriptors: real parts of a client's registered name that people
 * DROP in speech ("Hiscox" not "Hiscox Insurance"). They don't count toward
 * the hit requirement, so the distinctive word alone is enough for a match —
 * but a single-token hit is never STRONG (see below): "Zurich" the city must
 * not auto-bind "Zurich Insurance".
 */
const DESCRIPTOR_TOKENS = new Set([
  "insurance", "bank", "banking", "capital", "financial", "finance",
  "foundation", "institute", "ventures", "holdings", "labs", "health",
  "energy", "pharma", "medicines", "publication", "publications",
  "technologies", "technology", "systems", "smart", "infrastructure",
]);

/**
 * Resolve a client from an utterance. Returns the single best roster match, or
 * null when there is no match OR the best match is ambiguous (tied score).
 *
 * Evidence rules: only DISTINCTIVE name tokens count (generic agency words are
 * ignored), and multi-token names need >=2 distinctive hits. A name made
 * entirely of generic words can never match.
 */
export function resolveClientFromText(
  text: string,
  roster: { id: string; name: string }[]
): { id: string; name: string; strong: boolean } | null {
  const utt = toks(text);
  if (utt.length === 0 || roster.length === 0) return null;
  let best: { id: string; name: string; score: number; strong: boolean } | null = null;
  let tie = false;
  for (const c of roster) {
    // Acronym aliases — "(UBS)" in "Union Bank of Switzerland (UBS)" or any
    // ALL-CAPS word in the raw name. Exact-token match only (no fuzzing);
    // minimum 3 letters and never an ambient-vocabulary initialism ("AI"…).
    const aliasList: string[] = [];
    for (const p of c.name.match(/\(([A-Za-z]{2,6})\)/g) || []) aliasList.push(p.replace(/[()]/g, "").toLowerCase());
    for (const a of c.name.match(/\b[A-Z]{2,6}\b/g) || []) aliasList.push(a.toLowerCase());
    const matchedAlias = aliasList.find(
      (a) => a.length >= 3 && !GENERIC_TOKENS.has(a) && !ACRONYM_STOPWORDS.has(a) && utt.includes(a)
    ) || null;
    const aliasHit = matchedAlias !== null;

    const nameToks = toks(c.name).filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t) && !DESCRIPTOR_TOKENS.has(t));
    let hits = 0;
    for (const nt of nameToks) if (utt.some((u) => tokenMatch(nt, u))) hits++;

    // "strong" (auto-bind) requires >=2 distinctive tokens spoken — a single
    // word ("Zurich", "Hiscox") is evidence enough for a SUGGESTION chip but
    // never for silently loading a client's data mid-call.
    const nameEvidence = nameToks.length > 0 && hits >= Math.min(2, nameToks.length);
    const evidence = aliasHit || nameEvidence;
    if (!evidence) continue;
    const score = (aliasHit ? 1.5 : 0) + (nameToks.length ? hits / nameToks.length : 0) + hits * 0.01;
    if (!best || score > best.score) {
      // Auto-bind-worthy: >=2 distinctive tokens spoken, or a long (>=5 char)
      // acronym name like WBCSD/GESDA that collides with no everyday word.
      best = { id: c.id, name: c.name, score, strong: hits >= 2 || (matchedAlias !== null && matchedAlias.length >= 5) };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  if (!best || tie) return null; // require an unambiguous winner
  return { id: best.id, name: best.name, strong: best.strong };
}
