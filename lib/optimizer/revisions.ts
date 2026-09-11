/**
 * Two versions of a piece, aligned section by section, with the words that moved.
 *
 * This is the model behind the delivery view — the thing you put in front of a
 * client to say "here is what we changed and why". It is deliberately PURE and
 * exported in pieces, for the reason every other seam in this directory is:
 * alignment and diffing are where the quiet wrongness lives, and a check has to
 * be able to RUN them rather than grep for them.
 *
 * THE HARD PART IS NOT THE DIFF, IT IS THE ALIGNMENT.
 *
 * Diffing two strings is a solved problem. Deciding which section of the new
 * draft corresponds to which section of the old one is not, and getting it
 * wrong produces the most confident kind of nonsense: a renamed heading looks
 * like one section deleted and another invented, so a delivery view would tell
 * a client their "What it costs" section was removed when it was retitled
 * "Price". That is worse than showing nothing, because it reads as fact.
 *
 * So alignment runs in three passes of decreasing confidence, and the result
 * records WHICH pass matched each pair. A view can then present a heading match
 * as certain and a body-similarity match as "we think this is the same section",
 * rather than flattening both into an arrow.
 */

import type { ParsedDraft, Chunk } from "./parse";

/** How confident the pairing of an old section with a new one is. */
export type MatchBasis =
  /** Both carry the same heading text. Certain. */
  | "heading"
  /** No headings involved, and they sit at the same position. Reliable while
   *  nothing was inserted above; the body check below is what catches that. */
  | "position"
  /** Headings differ but the prose is substantially the same — a retitle.
   *  Stated as an inference in the UI, never as a fact. */
  | "body"
  /** Only one side exists. */
  | "none";

export type RevisionStatus = "unchanged" | "edited" | "added" | "removed";

export interface RevisionSection {
  /** Order in the AFTER document; removed sections take the position they held. */
  order: number;
  headingBefore: string | null;
  headingAfter: string | null;
  before: string | null;
  after: string | null;
  status: RevisionStatus;
  basis: MatchBasis;
  wordsBefore: number;
  wordsAfter: number;
  /** True when the heading changed but the section is the same one. */
  retitled: boolean;
}

export interface DiffPart {
  kind: "same" | "add" | "del";
  text: string;
}

/** A whole-piece summary, so a header can say what happened without counting. */
export interface RevisionSummary {
  edited: number;
  added: number;
  removed: number;
  unchanged: number;
  wordsBefore: number;
  wordsAfter: number;
  /** Sections whose pairing was inferred rather than certain. Surfaced, not hidden. */
  inferred: number;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => (s || "").match(/\S+/g) || [];

/**
 * How much two bodies overlap, 0–1, by shared distinct words.
 *
 * Crude on purpose. This decides only whether two sections are PLAUSIBLY the
 * same one after a retitle, and the answer is shown to the reader as an
 * inference — so a cleverer measure would buy precision the UI then throws away
 * by saying "we think" either way.
 */
export function bodyOverlap(a: string, b: string): number {
  const A = new Set(words(norm(a)));
  const B = new Set(words(norm(b)));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  A.forEach((w) => { if (B.has(w)) shared++; });
  return shared / Math.max(A.size, B.size);
}

/** Above this, two differently-titled sections are treated as one retitled section. */
export const RETITLE_OVERLAP = 0.5;

/**
 * Pair the sections of two drafts.
 *
 * Pass 1 matches on heading text, which is exact and handles the common case.
 * Pass 2 matches whatever is left by body similarity, which catches a retitle.
 * Pass 3 pairs remaining unheaded sections by position. Anything still unpaired
 * is an addition or a removal, which is the honest reading once the other two
 * have failed.
 */
export function alignRevisions(before: ParsedDraft, after: ParsedDraft): RevisionSection[] {
  const b = before.chunks.slice();
  const a = after.chunks.slice();
  const usedB = new Set<number>();
  const usedA = new Set<number>();
  const pairs: { b: Chunk | null; a: Chunk | null; basis: MatchBasis }[] = [];

  // ── 1. Same heading ──────────────────────────────────────────────────────
  for (let i = 0; i < a.length; i++) {
    const ah = norm(a[i].heading?.text || "");
    if (!ah) continue;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      if (norm(b[j].heading?.text || "") !== ah) continue;
      pairs.push({ b: b[j], a: a[i], basis: "heading" });
      usedB.add(j); usedA.add(i);
      break;
    }
  }

  // ── 2. Retitled: different heading, substantially the same prose ─────────
  for (let i = 0; i < a.length; i++) {
    if (usedA.has(i)) continue;
    let best = -1, bestScore = 0;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      const score = bodyOverlap(b[j].bodyText, a[i].bodyText);
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (best >= 0 && bestScore >= RETITLE_OVERLAP) {
      pairs.push({ b: b[best], a: a[i], basis: "body" });
      usedB.add(best); usedA.add(i);
    }
  }

  // ── 3. Whatever is left, in order ────────────────────────────────────────
  // Only for sections with NO heading on either side: pairing two headed
  // sections by position alone is how "Introduction" gets compared to
  // "Conclusion" because something was inserted above them.
  for (let i = 0; i < a.length; i++) {
    if (usedA.has(i) || a[i].heading) continue;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j) || b[j].heading) continue;
      pairs.push({ b: b[j], a: a[i], basis: "position" });
      usedB.add(j); usedA.add(i);
      break;
    }
  }

  for (let i = 0; i < a.length; i++) if (!usedA.has(i)) pairs.push({ b: null, a: a[i], basis: "none" });
  for (let j = 0; j < b.length; j++) if (!usedB.has(j)) pairs.push({ b: b[j], a: null, basis: "none" });

  const out: RevisionSection[] = pairs.map((p) => {
    const beforeText = p.b ? p.b.text : null;
    const afterText = p.a ? p.a.text : null;
    const hb = p.b?.heading?.text || null;
    const ha = p.a?.heading?.text || null;
    const status: RevisionStatus =
      !p.b ? "added" :
      !p.a ? "removed" :
      norm(p.b.text) === norm(p.a.text) ? "unchanged" : "edited";
    return {
      order: p.a ? p.a.index : (p.b ? p.b.index : 0),
      headingBefore: hb,
      headingAfter: ha,
      before: beforeText,
      after: afterText,
      status,
      basis: p.basis,
      wordsBefore: p.b ? p.b.wordCount : 0,
      wordsAfter: p.a ? p.a.wordCount : 0,
      retitled: !!(hb && ha && norm(hb) !== norm(ha)),
    };
  });

  out.sort((x, y) => x.order - y.order);
  return out;
}

export function summariseRevisions(sections: RevisionSection[]): RevisionSummary {
  const s: RevisionSummary = { edited: 0, added: 0, removed: 0, unchanged: 0, wordsBefore: 0, wordsAfter: 0, inferred: 0 };
  for (const sec of sections) {
    s[sec.status]++;
    s.wordsBefore += sec.wordsBefore;
    s.wordsAfter += sec.wordsAfter;
    if (sec.basis === "body" || sec.basis === "position") s.inferred++;
  }
  return s;
}

/**
 * The most words either side of a diff may carry before word-level marking is
 * abandoned. An LCS table is O(n·m); two 900-word sections is 810,000 cells,
 * which is the point where a browser tab starts to notice on every repaint.
 */
export const MAX_DIFF_WORDS = 900;

/**
 * Word-level diff, with the common head and tail trimmed first.
 *
 * The trim is not an optimisation for its own sake — it is what makes the
 * common case (a sentence rewritten inside an otherwise untouched section)
 * cheap, and it also produces a better-looking diff: without it the LCS finds
 * incidental matches on "the" and "and" scattered through the changed region
 * and shreds the output into confetti.
 *
 * Returns null rather than a partial answer when the input is past the cap.
 * A caller can then say the section changed without pretending to know where —
 * which is the same rule the deck builder follows when it drops data.
 */
export function wordDiff(before: string, after: string): DiffPart[] | null {
  const A = words(before);
  const B = words(after);
  if (A.length > MAX_DIFF_WORDS || B.length > MAX_DIFF_WORDS) return null;

  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (
    tail < A.length - head &&
    tail < B.length - head &&
    A[A.length - 1 - tail] === B[B.length - 1 - tail]
  ) tail++;

  const midA = A.slice(head, A.length - tail);
  const midB = B.slice(head, B.length - tail);

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], toks: string[]) => {
    if (toks.length === 0) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += " " + toks.join(" ");
    else parts.push({ kind, text: toks.join(" ") });
  };

  push("same", A.slice(0, head));

  // LCS over the changed middle only.
  const n = midA.length, m = midB.length;
  if (n === 0) push("add", midB);
  else if (m === 0) push("del", midA);
  else {
    const dp: number[][] = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    let runSame: string[] = [], runDel: string[] = [], runAdd: string[] = [];
    const flush = () => {
      push("del", runDel); runDel = [];
      push("add", runAdd); runAdd = [];
      push("same", runSame); runSame = [];
    };
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push("del", runDel); runDel = [];
        push("add", runAdd); runAdd = [];
        runSame.push(midA[i]); i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        push("same", runSame); runSame = [];
        runDel.push(midA[i]); i++;
      } else {
        push("same", runSame); runSame = [];
        runAdd.push(midB[j]); j++;
      }
    }
    flush();
    push("del", midA.slice(i));
    push("add", midB.slice(j));
  }

  push("same", A.slice(A.length - tail));
  return parts;
}
