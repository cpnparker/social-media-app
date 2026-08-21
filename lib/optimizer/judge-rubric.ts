/**
 * The judge's criteria — deliberately DISJOINT from the deterministic engine's.
 *
 * THE DESIGN DECISION THIS FILE ENCODES, because it is the one most likely to
 * be "simplified" back out later:
 *
 * The judge does not re-score anything the engine measures. It has its own
 * seven criteria covering only what requires reading comprehension, and they
 * are scored ADDITIVELY into the existing pillars rather than blended against
 * a parallel set of numbers.
 *
 * AuthorityOn blends 40% deterministic with 60% LLM because its LLM re-scores
 * the same six categories its keyword counter does, so the two have to be
 * reconciled. We have nothing to reconcile: with disjoint key spaces there are
 * no parallel numbers, and a weighted average would have nothing legitimate to
 * average — it would only launder judge variance into deterministic scores
 * that are currently exact and reproducible.
 *
 * The effective judge share falls out of the point values below (~23% overall,
 * weighted by pillar). That is a CONSEQUENCE, not a dial. Raising the judge's
 * influence means adding a judge criterion with points — a rubric change under
 * RUBRIC_VERSION — never tweaking a coefficient.
 *
 * The escape hatch is per-criterion, not global: a judge criterion that cannot
 * hold still under the stability harness is demoted to maxPoints 0, where its
 * findings still render and highlight but move no number. That keeps the
 * stable six instead of diluting all seven.
 */

import type { EvidenceGrade, RollUp, Tier } from "./types";

/** Bump on any change to the prompt bytes or this file. Part of the assessment
 *  memo key, so a prompt edit correctly invalidates cached assessments. */
// 1.1.0: every imperfect verdict must carry an anchored finding. Under 1.0.0
// only criteria 5-7 produced findings, so a draft with no brand registered, no
// queries set and no first-person claims could score 37/100 with ZERO marks on
// the text — the judge was finding real problems and reporting them as
// invisible score adjustments. Observed live on a real 1,014-word draft.
// 1.2.0: substantive quotes require name + role/organisation (never invented
// in a suggestedEdit — expose the gap instead); a concrete scope qualifier is
// not hedging; the author joins the registered-entity list for drift.
export const JUDGE_PROMPT_VERSION = "1.2.0";

export interface JudgeCriterionMeta {
  key: string;
  name: string;
  pillar: 1 | 2 | 3 | 4 | 5 | 6;
  maxPoints: number;
  kind: "reward" | "guard";
  rollUp: RollUp;
  evidence: EvidenceGrade;
  /** Why the engine cannot do this. Shown on the methodology page; also the
   *  argument anyone must beat to move a criterion back to the engine. */
  whyJudge: string;
}

export const JUDGE_CRITERIA: JudgeCriterionMeta[] = [
  {
    key: "semantic-query-coverage",
    name: "The draft actually answers each target query",
    pillar: 1, maxPoints: 20, kind: "reward", rollUp: "both", evidence: "A",
    whyJudge:
      "The engine counts query TERMS. A draft can contain every word of a question and never answer it. Relevance is the highest-weighted pillar on grade-A evidence, so scoring it lexically alone would let the headline number measure vocabulary while the question goes unanswered.",
  },
  {
    key: "quote-attribution-quality",
    name: "Quotations are substantive and properly attributed",
    pillar: 2, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "A-",
    whyJudge:
      "The engine detects that an attribution signal sits near a quotation. Whether the speaker is named and credible, and whether the quote says something a paraphrase could not, is comprehension.",
  },
  {
    key: "opening-quotability",
    name: "The opening could be quoted alone as the answer",
    pillar: 3, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "B",
    whyJudge:
      "The engine scores WHERE answer-bearing material sits. An opening can contain the answer and still be unquotable — unnamed subject, buried qualifier, a reference to something further down.",
  },
  {
    key: "chunk-self-containment",
    name: "Each section stands alone when extracted",
    pillar: 3, maxPoints: 15, kind: "reward", rollUp: "citability", evidence: "B/C",
    whyJudge:
      "The engine covers the mechanical proxies (pronoun openings, subject naming). The semantic remainder — 'as mentioned above', 'the second option', comparisons to unnamed antecedents — needs reading.",
  },
  {
    key: "entity-variant-drift",
    name: "No unregistered name variants",
    pillar: 4, maxPoints: 10, kind: "guard", rollUp: "both", evidence: "C",
    whyJudge:
      "canonical-name-consistency counts KNOWN aliases only; its own comment says unknown variants need NER. A misspelling or an unregistered nickname is invisible to it by construction.",
  },
  {
    key: "experience-substantiation",
    name: "First-hand claims carry substance",
    pillar: 5, maxPoints: 10, kind: "guard", rollUp: "citability", evidence: "D",
    whyJudge:
      "The engine counts experience PHRASES. Whether 'in our experience' is followed by anything — a number, a named context, an outcome — or is an empty authority costume, is judgement.",
  },
  {
    key: "unsourced-absolute-claims",
    name: "No hedge-free absolute claims without a source",
    pillar: 5, maxPoints: 10, kind: "guard", rollUp: "citability", evidence: "B",
    whyJudge:
      "stat-source-adjacency handles NUMERIC claims. The non-numeric universals — 'the only platform that', 'this always works' — are the other half of the anti-checklist's rule against confident unsupported assertion, and they have no regex.",
  },
];

export const JUDGE_CRITERION_KEYS = JUDGE_CRITERIA.map((c) => c.key);

// ── Verdict scales ───────────────────────────────────────────────────────
// Ordinal verdicts, not free numbers. The judge picks a band and the points
// come from a fixed table here, so run-to-run variance can only ever appear as
// a discrete verdict flip worth a known step — auditable in the waterfall as a
// named cause, never as unexplained decimal wobble.

export const QUERY_COVERAGE_POINTS: { [k: string]: number } = {
  covered: 1, partial: 0.5, missing: 0,
};
export const OPENING_POINTS: { [k: string]: number } = {
  quotable_alone: 10, needs_context: 5, no_answer: 0,
};
export const QUOTE_QUALITY_POINTS: { [k: string]: number } = {
  substantive: 1, weak: 0.5, decorative: 0,
};

/** GUARD, descending: unregistered name variants found. */
export const VARIANT_DRIFT_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 1, points: 5 }, { min: 3, points: 0 },
];
/** GUARD, descending: experience claims with nothing behind them. */
export const EMPTY_EXPERIENCE_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 1, points: 6 }, { min: 2, points: 2 }, { min: 4, points: 0 },
];
/** GUARD, descending: hedge-free absolute claims carrying no source. */
export const ABSOLUTE_CLAIM_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 1, points: 6 }, { min: 3, points: 2 }, { min: 5, points: 0 },
];

// 20, up from 12: under prompt 1.1.0 every imperfect verdict carries a finding,
// so a six-section draft with partial coverage and weak quotes legitimately
// produces more than twelve. The cap guards against a model reciting the whole
// draft as findings, not against thoroughness.
export const MAX_FINDINGS = 20;
