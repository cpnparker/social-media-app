/**
 * Shared vocabulary for the Content Optimizer's scoring layer.
 *
 * Spec: docs/content-optimizer-spec.md §4.
 *
 * Two rules here are load-bearing and easy to erode:
 *
 * 1. Every criterion carries an `evidence` grade. The GEO research this rubric
 *    rests on is partly causal, partly observational and partly house doctrine,
 *    and some of it WILL expire — engines drift, and a 2026 finding may not hold
 *    in 2027. Grading each check is what makes re-weighting a cheap, honest edit
 *    rather than an argument. A criterion with no grade is a criterion nobody
 *    can defend to a client, so the verify script fails on one.
 *
 * 2. Every criterion declares a `rollUp`. Optimising prose for citation can make
 *    a page LESS retrievable (SAGEO Arena measured -9% top-20 presence for
 *    body-only rewrites), so a single headline number would hide the trade-off
 *    that matters most. Retrievability and Citability are reported separately
 *    and a criterion has to say which it serves.
 */

/** How strong the evidence for a check is. Shown to the writer, and to clients. */
export type EvidenceGrade =
  | "A" // causal — controlled experiment
  | "A-" // causal, replicated in direction but contested in magnitude
  | "B" // large-N observational
  | "B/C" // observational plus a mechanistic account
  | "C" // mechanistic — retrieval mechanics imply it, no measured effect size
  | "D"; // house doctrine — TCE's own practice, no external study

/**
 * Which half of the funnel a check serves.
 * retrievability = will an engine fetch this at all (query alignment, headings,
 * topical completeness). citability = once fetched, will it be quoted
 * (answer-first position, self-contained chunks, evidence density, freshness).
 */
export type RollUp = "retrievability" | "citability" | "both";

/** A scoring band. Tiers must be sorted ascending by `min`. */
export interface Tier {
  min: number;
  points: number;
}

/**
 * One check's result.
 *
 * `key` MUST be a static slug — never interpolate live values into it. The key
 * is how a criterion is diffed across assessments to build the Phase 3 waterfall
 * ("what moved the score"), and a key that changes with the content breaks that
 * attribution silently. Put the live detail in `name`, which is display-only.
 *
 * `skipped` is not the same as scoring zero. A check that needs context the
 * writer has not supplied (no target query, no author on an anonymous piece) is
 * excluded from its pillar's denominator rather than counted as a failure —
 * otherwise the tool penalises a draft for the tool's own missing inputs, and
 * the score stops meaning what it says.
 */
export interface CriterionSpan {
  /** Offsets into ParsedDraft.text — NOT ProseMirror positions. The editor
   *  converts them with lib/optimizer/doc-index.ts, which is the only thing
   *  that knows how the two coordinate systems line up. */
  start: number;
  end: number;
  /** What is wrong with THIS span, if it differs from the criterion's own
   *  message ("47 words", "no source in this sentence"). */
  note?: string;
}

export interface CriterionResult {
  key: string;
  name: string;
  earned: number;
  maxPoints: number;
  passed: boolean;
  evidence: EvidenceGrade;
  rollUp: RollUp;
  /** Excluded from the pillar denominator; `earned` and `maxPoints` are 0. */
  skipped?: boolean;
  /** Why it was skipped — shown to the writer so the gap is visible, not silent. */
  skipReason?: string;
  /**
   * Where in the text this criterion is failing, as offsets into
   * ParsedDraft.text.
   *
   * This is what makes the free layer of the product feel like a product. The
   * parser already knows WHICH sentence runs long, WHICH statistic has no
   * source beside it, WHICH heading breaks the hierarchy — it tracks offsets
   * for all of them — and the engine was throwing that away and returning a
   * number. So a writer saw "Sentence length: 6/10" and had to go and find the
   * sentences themselves.
   *
   * Populated only by criteria that can point at something specific. A score
   * about the document as a whole (word count, list presence) has no span and
   * correctly has none — inventing one would highlight an arbitrary sentence
   * and blame it for a whole-document property.
   */
  spans?: CriterionSpan[];
  /**
   * True when this check can only lose points, never gain them (keyword
   * stuffing, naked statistics, stale years, AI-tell vocabulary). Penalties are
   * surfaced as failed criteria with their evidence grade, never as an
   * unexplained deduction — the spec's honesty-by-design rule.
   */
  penalty?: boolean;
}

export interface PillarScore {
  name: string;
  /** 0-100, renormalised as earned/maxPoints*100 over non-skipped criteria. */
  score: number;
  grade: string;
  weight: number;
  criteria: CriterionResult[];
}

export interface DraftScores {
  /** 0-100, the weighted sum of pillar scores. */
  overall: number;
  grade: string;
  /** 0-100 roll-ups over criteria tagged retrievability / citability. */
  retrievability: number;
  citability: number;
  pillars: PillarScore[];
  /** The rubric version these scores were produced under. */
  rubricVersion: string;
}
