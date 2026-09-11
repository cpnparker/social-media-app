/**
 * Content types — what KIND of thing is being written, and what the studio may
 * therefore claim about it.
 *
 * The studio began as a GEO optimiser: every draft was an article, scored
 * against a rubric about being cited by answer engines. That is the wrong lens
 * for a quarterly report and an actively dishonest one for a personal
 * professional document — a graded "Optimisation Score" over a document nobody
 * is trying to rank is a number pretending to mean something.
 *
 * So a type decides three things:
 *
 *   1. WEIGHTS — the same rubric, re-weighted. Not a second rubric: the
 *      criteria universe is shared, and a type filters and re-weights it. A new
 *      rubric per type would fork the scoring engine and the version history
 *      with it.
 *   2. ANALYSES — which of judge / coverage / audit may run at all. An analysis
 *      a type turns off is refused with 400 BEFORE assertServiceAllowed, so a
 *      disabled analysis cannot spend.
 *   3. CHROME — what the cockpit may render. This is the half that was missed
 *      the first time: gating the backend while the UI still offers an Assess
 *      button produces a button that 400s, and a score panel that says "Not
 *      reviewed" forever. The chrome contract is derived from `analyses` so the
 *      two cannot drift.
 *
 * ── THE UNNAMED TYPE ─────────────────────────────────────────────────────────
 *
 * One type has `label: null`. It is recognised and handled, and the product
 * never says so: not on the start screen, not as a chip, not in an empty state,
 * not in a tooltip. `labelOf()` returns null for it and every caller must treat
 * null as "render nothing", not as "render the id".
 *
 * That makes it the single exception to the rule that detection PROPOSES and a
 * person CONFIRMS. Everywhere else a detected type appears as a dismissible
 * chip; here the studio simply adapts — the score disappears, a checklist takes
 * its place — and no copy explains why. This is a deliberate product decision
 * by the owner (2026-08-25), recorded here because it will otherwise read as an
 * oversight to whoever finds it next, and because `verify-optimizer-types`
 * asserts the ABSENCE: no rendered string in the studio may contain the id.
 */
import { CRITERIA, PILLARS, TOTAL_WEIGHT_BP } from "./rubric";

/** Bumped on any change to weights, criteria filters, analyses or doctrine. */
export const CONTENT_TYPE_VERSION = "1.0.0";

export type ContentTypeId = "article" | "report" | "cv";

export const CONTENT_TYPE_IDS: ContentTypeId[] = ["article", "report", "cv"];

/** The default for anything not recognised, and for every pre-existing session. */
export const DEFAULT_CONTENT_TYPE: ContentTypeId = "article";

export interface ContentType {
  id: ContentTypeId;
  /**
   * What the product calls it. NULL means the product never names it — see the
   * header. A null label is not a missing label; do not "fix" it by adding one.
   */
  label: string | null;
  /** Offered on the start screen as something to create. */
  offered: boolean;
  /**
   * Shown as a chip once detected, and proposed as a switch. False means the
   * type is applied SILENTLY: no chip, no announcement, no confirm step.
   */
  announced: boolean;
  /** Which analyses may run. A false one is refused before it can spend. */
  analyses: { judge: boolean; coverage: boolean; audit: boolean };
  /**
   * Pillar weights in basis points, keyed by pillar id. MUST sum to 10000.
   * Absent pillars inherit the rubric default.
   */
  weightsBp: Record<number, number>;
  /** Criteria excluded for this type. Keys must exist in the shared universe. */
  excludeCriteria: string[];
  /**
   * One paragraph of doctrine, appended to the hint prompt (Stage 3) and to
   * generation prompts. Byte-stable: it sits in the cached prefix.
   */
  doctrine: string;
  /** Word band used for length guidance and the type-aware 413 copy. */
  band: { min: number; max: number };
}

/**
 * Article — the original lens, unchanged. Its weights ARE the rubric's, written
 * out rather than inherited so a rubric re-weighting is visible here as a
 * failing assertion instead of a silent shift in what "article" means.
 */
const ARTICLE: ContentType = {
  id: "article",
  label: "Article",
  offered: true,
  announced: true,
  analyses: { judge: true, coverage: true, audit: true },
  weightsBp: { 1: 2200, 2: 2000, 3: 1800, 4: 1400, 5: 1300, 6: 1300 },
  excludeCriteria: [],
  doctrine:
    "This is a published-facing article. It should answer its target query early, " +
    "carry evidence a reader can verify, and stay quotable out of context.",
  band: { min: 800, max: 2500 },
};

/**
 * Report — written to be READ by a named audience, not retrieved by an engine.
 *
 * Query coverage drops hard (a report is not chasing a search), evidence and
 * structure rise (a claim in a client report must carry its source, and a
 * reader navigates by section). Coverage analysis is off: "what would an AI
 * already say about this topic" is not a question about a document written for
 * one audience about their own quarter.
 */
const REPORT: ContentType = {
  id: "report",
  label: "Report",
  offered: true,
  announced: true,
  analyses: { judge: true, coverage: false, audit: false },
  weightsBp: { 1: 800, 2: 2800, 3: 2400, 4: 1500, 5: 1500, 6: 1000 },
  excludeCriteria: [
    // All three are about being FOUND. A report is delivered, not discovered.
    "title-query-alignment",
    "query-terms-in-headings",
    "query-terms-in-body",
  ],
  doctrine:
    "This is a report written for a named audience who asked for it. Lead each " +
    "section with its finding. Every figure carries its source in the same " +
    "sentence. Prefer plain statements of what happened over persuasion.",
  band: { min: 1000, max: 8000 },
};

/**
 * The unnamed type. Recognised, never announced.
 *
 * Judge off: there is no meaningful score, and rendering one would be the
 * dishonesty the studio's own doctrine warns about. What remains is the free
 * deterministic engine — placeholders, name consistency, stale years, heading
 * structure — presented as a checklist rather than a grade.
 */
const QUIET: ContentType = {
  id: "cv",
  label: null,
  offered: false,
  announced: false,
  analyses: { judge: false, coverage: false, audit: false },
  // Unused while judge is off, but present and valid so that turning the judge
  // on is a one-line change rather than a schema question, and so the
  // sums-to-10000 assertion covers every registered type.
  weightsBp: { 1: 500, 2: 2000, 3: 2500, 4: 2500, 5: 2000, 6: 500 },
  excludeCriteria: ["title-query-alignment", "query-terms-in-headings", "query-terms-in-body"],
  doctrine:
    "Entries are fragments, not sentences: lead with the verb, drop the subject. " +
    "No first-person prose. Every claim of impact carries a figure or a named " +
    "outcome. Keep tense consistent within a role.",
  band: { min: 200, max: 1200 },
};

const REGISTRY: Record<ContentTypeId, ContentType> = {
  article: ARTICLE,
  report: REPORT,
  cv: QUIET,
};

/** Resolve a type, falling back to the default for anything unknown. */
export function contentType(id: string | null | undefined): ContentType {
  const key = String(id || "").trim() as ContentTypeId;
  return REGISTRY[key] || REGISTRY[DEFAULT_CONTENT_TYPE];
}

/**
 * The product name for a type, or null when the product does not name it.
 *
 * Callers MUST render nothing on null. Returning the id would defeat the whole
 * point, which is why this never falls back to `id`.
 */
export function labelOf(id: string | null | undefined): string | null {
  return contentType(id).label;
}

/** Types offered on the start screen, in display order. */
export function offeredTypes(): ContentType[] {
  return CONTENT_TYPE_IDS.map((i) => REGISTRY[i]).filter((t) => t.offered);
}

/** May this analysis run for this type at all? Checked BEFORE any spend gate. */
export function analysisAllowed(id: string | null | undefined, which: "judge" | "coverage" | "audit"): boolean {
  return contentType(id).analyses[which];
}

/**
 * What the cockpit may render, derived from `analyses` so chrome cannot drift
 * from behaviour. Anything the UI hides is something the backend refuses.
 */
export interface ChromeContract {
  /** The "Article · Explainer" style chip. False for the unnamed type. */
  showTypeChip: boolean;
  /** The assessment status chip ("Not reviewed" / "Reviewed just now"). */
  showAssessmentChip: boolean;
  /** The Assess button and the IssueList's "Assess this draft" empty state. */
  showAssessAction: boolean;
  /** The Coverage tab. */
  showCoverageTab: boolean;
  /** The graded score circle. When false, the Checks list replaces it. */
  showScore: boolean;
  /** The page-audit entry point. */
  showAudit: boolean;
  /**
   * The target-query editor in the brief and header.
   *
   * Derived from whether the type still carries any query-coverage criterion —
   * asking a writer for the queries a piece should rank for, and then scoring
   * it against criteria that no longer include them, is a form asking for
   * something nothing reads.
   */
  showTargetQueries: boolean;
  /**
   * The "Optimise for" platform lens (ChatGPT / Perplexity / AI Overviews).
   *
   * Tied to coverage rather than to the judge: the lens shifts pillar weights
   * for RETRIEVAL by an answer engine, which is the same question coverage
   * asks. A document nobody is trying to get retrieved has no use for it.
   */
  showPlatform: boolean;
}

export function chromeFor(id: string | null | undefined): ChromeContract {
  const t = contentType(id);
  return {
    showTypeChip: t.label !== null,
    showAssessmentChip: t.analyses.judge,
    showAssessAction: t.analyses.judge,
    showCoverageTab: t.analyses.coverage,
    showScore: t.analyses.judge,
    showAudit: t.analyses.audit,
    // Derived, never declared. A hand-set flag is a second place for the truth
    // to live, and the pair drift the first time a type is re-weighted.
    showTargetQueries: criteriaFor(t.id).some((c) => c.pillar === 1),
    showPlatform: t.analyses.coverage,
  };
}

/** Criteria that apply to a type, in rubric order. */
export function criteriaFor(id: string | null | undefined) {
  const t = contentType(id);
  return CRITERIA.filter((c) => t.excludeCriteria.indexOf(c.key) < 0);
}

/** Pillar weight in basis points for a type. */
export function weightBpFor(id: string | null | undefined, pillarId: number): number {
  const t = contentType(id);
  const w = t.weightsBp[pillarId];
  if (typeof w === "number") return w;
  const p = PILLARS.filter((x) => x.id === pillarId)[0];
  return p ? p.weightBp : 0;
}

/**
 * The bytes a type contributes to a memo key.
 *
 * Every parameter that changes the OUTPUT must reach the key or a cached result
 * outlives the change that should have invalidated it — the failure the judge's
 * own version constant exists to prevent. Includes the version so re-weighting
 * a type invalidates its cached assessments.
 */
export function contentTypeKeyPart(id: string | null | undefined): string {
  const t = contentType(id);
  return `${t.id}@${CONTENT_TYPE_VERSION}`;
}

/**
 * Length guidance, so the 413 copy can be honest per type.
 *
 * The assess route told every writer their document should be 800–2,500 words.
 * A report writer being told that about a 6,000-word quarterly is the tool
 * being confidently wrong about its own subject.
 */
export function bandCopy(id: string | null | undefined): string {
  const t = contentType(id);
  return `${t.band.min.toLocaleString()}–${t.band.max.toLocaleString()} words`;
}

// ── Detection ────────────────────────────────────────────────────────────────

export interface Detection {
  type: ContentTypeId;
  /** 0–1. Below CONFIRM_THRESHOLD the chip opens pre-expanded (named types). */
  confidence: number;
  /** Why, for the trace and for the confirm chip's tooltip. Never user-facing
   *  for the unnamed type. */
  reason: string;
}

export const CONFIRM_THRESHOLD = 0.75;

const RE_CONTACT = /\b(curriculum vitae|r[ée]sum[ée])\b/i;
const RE_SECTIONS = /^\s*(work experience|employment(\s+history)?|education|qualifications|skills|references|professional experience|career history)\s*:?\s*$/im;
const RE_DATE_RANGE = /\b(19|20)\d{2}\s*(–|-|—|to)\s*((19|20)\d{2}|present|current|date)\b/i;
const RE_REPORT_WORDS = /^\s*(executive summary|methodology|findings|recommendations|conclusions?|appendix|scope|background)\s*:?\s*$/im;
const RE_FIRST_PERSON = /\b(I|my|me)\b/g;

/**
 * Recognise the shape of a document from its text alone.
 *
 * Deterministic and free — no model call. Runs on paste, on import, and on
 * first open of a session that has never been typed. Structural signals only:
 * heading vocabulary, date-range density, bullet-to-prose ratio. Deliberately
 * NOT keyed on personal names or contact details, which would make the
 * detector a personal-data heuristic rather than a document-shape one.
 *
 * A model fallback for genuine ties is Stage 1's `detectContentTypeModel`
 * (memoised, one closed-label call) — not implemented here because the
 * heuristics resolve the overwhelming majority and an unnecessary model call on
 * every paste is exactly the automatic spend Stage 1 promises not to add.
 */
export function detectContentType(text: string, title?: string | null): Detection {
  const body = String(text || "");
  const words = (body.match(/\S+/g) || []).length;
  if (words < 40) {
    return { type: DEFAULT_CONTENT_TYPE, confidence: 0.2, reason: "too short to tell" };
  }

  const lines = body.split(/\n+/).filter((l) => l.trim());
  const bulletish = lines.filter((l) => /^\s*([-•*–]|\d+[.)])\s+/.test(l)).length;
  const bulletRatio = lines.length ? bulletish / lines.length : 0;

  const dateRanges = (body.match(new RegExp(RE_DATE_RANGE.source, "gi")) || []).length;
  const quietSections = RE_SECTIONS.test(body);
  const explicit = RE_CONTACT.test(body) || RE_CONTACT.test(String(title || ""));
  const reportSections = RE_REPORT_WORDS.test(body);

  // Density per 1,000 words, so a long document is not flagged merely for
  // containing dates somewhere.
  const rangeDensity = (dateRanges / Math.max(words, 1)) * 1000;

  // The unnamed type: dated role ranges plus section headings plus a bullet-led
  // body. Two independent structural signals are required — a single one is a
  // timeline in an article.
  let quietScore = 0;
  if (explicit) quietScore += 0.5;
  if (quietSections) quietScore += 0.3;
  if (rangeDensity >= 3) quietScore += 0.3;
  if (bulletRatio >= 0.35) quietScore += 0.2;
  if (words <= 1200) quietScore += 0.1;
  if (quietScore >= 0.6) {
    return { type: "cv", confidence: Math.min(quietScore, 0.98), reason: "structural" };
  }

  let reportScore = 0;
  if (reportSections) reportScore += 0.5;
  if (words >= 2000) reportScore += 0.2;
  // A report cites more than it addresses the reader.
  const firstPerson = (body.match(RE_FIRST_PERSON) || []).length;
  if (firstPerson / Math.max(words, 1) < 0.002) reportScore += 0.1;
  if (reportScore >= 0.6) {
    return { type: "report", confidence: Math.min(reportScore, 0.95), reason: "report sections present" };
  }

  return { type: DEFAULT_CONTENT_TYPE, confidence: 0.6, reason: "default" };
}

/**
 * Should this detection be shown to the writer?
 *
 * False for the unnamed type ALWAYS, regardless of confidence. This is the one
 * function standing between the product and advertising a feature the owner
 * asked to keep quiet, which is why it reads the registry rather than testing
 * the id — adding a second unannounced type must not require finding this line.
 */
export function shouldAnnounce(d: Detection): boolean {
  return contentType(d.type).announced;
}

/** The sanity check the verify script drives: weights sum, keys exist. */
export function auditRegistry(): string[] {
  const problems: string[] = [];
  for (let i = 0; i < CONTENT_TYPE_IDS.length; i++) {
    const t = REGISTRY[CONTENT_TYPE_IDS[i]];
    let sum = 0;
    for (let p = 0; p < PILLARS.length; p++) sum += weightBpFor(t.id, PILLARS[p].id);
    if (sum !== TOTAL_WEIGHT_BP) problems.push(`${t.id}: weights sum to ${sum}, not ${TOTAL_WEIGHT_BP}`);
    for (let e = 0; e < t.excludeCriteria.length; e++) {
      const key = t.excludeCriteria[e];
      if (!CRITERIA.some((c) => c.key === key)) problems.push(`${t.id}: excludes unknown criterion "${key}"`);
    }
    if (criteriaFor(t.id).length === 0) problems.push(`${t.id}: excludes every criterion`);
    if (t.band.min >= t.band.max) problems.push(`${t.id}: band is inverted`);
    if (!t.doctrine.trim()) problems.push(`${t.id}: empty doctrine`);
  }
  return problems;
}
