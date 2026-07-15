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
 * Resolve a client from an utterance. Returns the single best roster match, or
 * null when there is no match OR the best match is ambiguous (tied score).
 */
export function resolveClientFromText(
  text: string,
  roster: { id: string; name: string }[]
): { id: string; name: string } | null {
  const utt = toks(text);
  if (utt.length === 0 || roster.length === 0) return null;
  let best: { id: string; name: string; score: number } | null = null;
  let tie = false;
  for (const c of roster) {
    const nameToks = toks(c.name).filter((t) => t.length >= 4); // distinctive tokens only
    if (nameToks.length === 0) continue;
    let hits = 0;
    for (const nt of nameToks) if (utt.some((u) => tokenMatch(nt, u))) hits++;
    if (hits === 0) continue;
    const score = hits / nameToks.length + hits * 0.01; // fraction of the name matched, nudged by absolute hits
    if (!best || score > best.score) {
      best = { id: c.id, name: c.name, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  if (!best || tie) return null; // require an unambiguous winner
  return { id: best.id, name: best.name };
}
