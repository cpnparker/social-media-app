/**
 * The Optimiser's verdict, small enough to read in a chat reply.
 *
 * PURE AND EXPORTED, for the reason every seam in this directory is: four
 * provider chains each dispatch tools in their own loop, so a handler written
 * inline would be written four times and drift in three of them. Everything
 * interesting happens here and the handlers are four thin calls.
 *
 * WHAT "SMALL ENOUGH" MEANS. The rail lists every criterion because that is
 * what a rail is for. A reply cannot: fifteen rows in a chat bubble is a worse
 * version of the panel that already exists two clicks away. So this returns a
 * number, one sentence saying what the number means, and the THREE moves worth
 * the most — and says how many it left out, because a list that silently stops
 * at three reads as a complete list of three problems.
 */

import { computeDraftScores } from "./engine";
import { parseDraft } from "./parse";
import type { DraftScores, CriterionResult } from "./types";

/**
 * Below this a score describes the FORMAT rather than the writing.
 *
 * The rubric is calibrated for 800–2,500 words of article-shaped prose. Point it
 * at a four-line chat message and it reports a low number that means "this is a
 * chat message", which is true and useless — the same mistake the PDF import
 * refuses to make when it declines to score a file with no headings.
 */
export const INLINE_SCORE_MIN_WORDS = 120;

/** Short enough that the number is worth caveating, long enough to score. */
export const INLINE_SCORE_SHORT_WORDS = 400;

export interface InlineMove {
  key: string;
  name: string;
  detail: string;
  points: number;
}

export interface InlineScoreCard {
  ok: true;
  overall: number;
  retrievability: number;
  citability: number;
  verdict: string;
  pillarsScored: number;
  pillarsTotal: number;
  /** True when a pillar was skipped — usually Relevance, for want of a target query. */
  partial: boolean;
  moves: InlineMove[];
  /** How many scoreable problems were NOT shown. */
  moreCount: number;
  morePoints: number;
  wordCount: number;
  /** Scoreable, but short enough that the number deserves a caveat. */
  short: boolean;
}

export interface InlineScoreRefusal {
  ok: false;
  reason: string;
  wordCount: number;
}

/**
 * One sentence saying what the two roll-ups mean together.
 *
 * Composed in code from the numbers rather than asked of a model: it appears
 * beside the score it describes, and a sentence that could disagree with the
 * number next to it is the self-contradiction this product keeps having to fix.
 */
export function verdictLine(retrievability: number, citability: number): string {
  const HIGH = 65;
  const r = retrievability >= HIGH;
  const c = citability >= HIGH;
  if (r && c) return "Findable and quotable";
  if (r && !c) return "Retrievable, not yet citable";
  if (!r && c) return "Quotable, but hard to find";
  return "Hard to find and hard to quote";
}

/** Every criterion that could still earn points, worst first. */
export function openCriteria(scores: DraftScores): CriterionResult[] {
  const out: CriterionResult[] = [];
  for (const p of scores.pillars) {
    for (const c of p.criteria) {
      if (c.skipped || c.passed) continue;
      if (c.maxPoints - c.earned <= 0) continue;
      out.push(c);
    }
  }
  out.sort((a, b) => (b.maxPoints - b.earned) - (a.maxPoints - a.earned));
  return out;
}

/** The bit after the em dash on a criterion name — the live evidence. */
function detailOf(c: CriterionResult): string {
  const parts = c.name.split(" — ");
  return parts.length > 1 ? parts.slice(1).join(" — ") : "";
}

function nameOf(c: CriterionResult): string {
  return c.name.split(" — ")[0];
}

export function buildInlineScore(
  text: string,
  title?: string,
  opts?: { brandName?: string; moves?: number }
): InlineScoreCard | InlineScoreRefusal {
  const shown = Math.max(1, opts?.moves ?? 3);
  const parsed = parseDraft({ body: text || "", title: title || "" });
  const wordCount = parsed.wordCount;

  if (wordCount < INLINE_SCORE_MIN_WORDS) {
    return {
      ok: false,
      wordCount,
      reason:
        `That is ${wordCount} words. The rubric is calibrated for articles of 800 words and up, so a score here would describe the length rather than the writing.`,
    };
  }

  const scores = computeDraftScores({
    body: text,
    title: title || "",
    targetQueries: [],
    format: "article",
    brandName: opts?.brandName,
  } as any);

  const open = openCriteria(scores);
  const moves = open.slice(0, shown).map((c) => ({
    key: c.key,
    name: nameOf(c),
    detail: detailOf(c),
    points: Math.round((c.maxPoints - c.earned) * 10) / 10,
  }));
  const rest = open.slice(shown);

  const scored = scores.pillars.filter((p) => p.criteria.some((c) => !c.skipped)).length;

  return {
    ok: true,
    overall: Math.round(scores.overall),
    retrievability: Math.round(scores.retrievability),
    citability: Math.round(scores.citability),
    verdict: verdictLine(scores.retrievability, scores.citability),
    pillarsScored: scored,
    pillarsTotal: scores.pillars.length,
    partial: scored < scores.pillars.length,
    moves,
    moreCount: rest.length,
    morePoints: Math.round(rest.reduce((n, c) => n + (c.maxPoints - c.earned), 0) * 10) / 10,
    wordCount,
    short: wordCount < INLINE_SCORE_SHORT_WORDS,
  };
}

/**
 * What the MODEL is told after the card has been drawn.
 *
 * Two jobs, and the second is the one that is easy to forget: it carries the
 * numbers so the model can reason about them, and it says the card is ALREADY
 * ON SCREEN so the reply does not repeat them. The slides tool learned this the
 * same way — its result ends "a link and a slide preview are already shown to
 * the user, so do NOT write another link" — and without it every reply here
 * would restate a table the reader is looking at.
 */
export function inlineScoreForModel(card: InlineScoreCard | InlineScoreRefusal): string {
  if (!card.ok) return `Not scored. ${card.reason} Tell the user that plainly; do not guess a number.`;

  const moves = card.moves
    .map((m, i) => `${i + 1}. ${m.name}${m.detail ? ` (${m.detail})` : ""} — worth ${m.points} points`)
    .join("\n");

  return [
    `Scored ${card.overall}/100 — ${card.verdict}. Retrievability ${card.retrievability}, citability ${card.citability}.`,
    card.partial
      ? `Only ${card.pillarsScored} of ${card.pillarsTotal} pillars were scored — no target query is set, so Relevance was skipped. Say so if you mention the number.`
      : "",
    card.short ? `The piece is ${card.wordCount} words, short for this rubric; the number is rougher than usual.` : "",
    "",
    "The highest-value fixes:",
    moves,
    card.moreCount > 0
      ? `\nA further ${card.moreCount} ${card.moreCount === 1 ? "item is" : "items are"} open, worth ${card.morePoints} points together.`
      : "",
    "",
    "A CARD SHOWING ALL OF THIS IS ALREADY ON THE USER'S SCREEN, with the score, the verdict and these fixes. Do NOT repeat the numbers or list the fixes again. Say the one thing the card cannot: which fix to do first and why, in a sentence or two.",
  ]
    .filter(Boolean)
    .join("\n");
}
