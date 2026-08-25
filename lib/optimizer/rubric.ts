/**
 * Content Optimizer — the rubric. Pillars, weights, criterion metadata, tiers
 * and the keyword lists the deterministic engine matches against.
 *
 * Spec: docs/content-optimizer-spec.md §4.
 * Ported from authorityon-platform/packages/core/src/audit/content-scoring-rubric.ts
 * — the MECHANICS (tiered scoring, word-boundary keyword matching, the criterion
 * shape), not the category structure. AuthorityOn scores a crawled SITE; this
 * scores one unpublished DRAFT, so 13 page-existence criteria are dropped and
 * every surviving tier is recalibrated from site scale to article scale. Each
 * criterion's recalibration is justified where it is defined in engine.ts.
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. Weights are integers (basis points). A float array of 0.22/0.20/0.18/…
 *    does not sum to 1.0 in IEEE754, and the product sells "the bars sum
 *    exactly" on its Phase 3 waterfall. Integers make that literally true.
 *
 * 2. Penalties are GUARDS, not deductions. A guard starts at full marks and
 *    forfeits them as violations accumulate, so a stuffed draft shows a FAILED
 *    criterion carrying its evidence grade and a live violation count — never a
 *    mystery subtraction. `earned` is never negative anywhere in this engine.
 *
 * 3. Tiers are DATA, not code. The Pulse-signal updater (spec §7) re-tunes
 *    thresholds under a new RUBRIC_VERSION, and the verify script's self-test
 *    mutates them in memory. Both need tables it can walk, not thresholds
 *    buried in if-statements.
 */

import type { EvidenceGrade, RollUp, Tier } from "./types";

/**
 * Bump on ANY change to weights, tiers, criterion keys or point values.
 * Stored on every assessment so a re-score against a newer rubric is an
 * explicit act rather than a silent drift in a client's reported numbers.
 */
// 1.0.1: countWithUnit units broadened to industrial/corporate vocabulary
// (employees, sites, plants, tons, megawatts...). Detection change, not a
// weight change — but scores move on figure-heavy corporate content, so the
// version moves with them and every memo re-keys.
export const RUBRIC_VERSION = "1.2.0";

// ── Pillars ──────────────────────────────────────────────────────────────

export interface Pillar {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  /** Basis points. MUST sum to 10000 across all pillars. */
  weightBp: number;
}

export const PILLARS: Pillar[] = [
  { id: 1, name: "Relevance & query coverage", weightBp: 2200 },
  { id: 2, name: "Evidence & quotability", weightBp: 2000 },
  { id: 3, name: "Answer-first structure & extractability", weightBp: 1800 },
  { id: 4, name: "Entity clarity & consistency", weightBp: 1400 },
  { id: 5, name: "Authority & experience signals", weightBp: 1300 },
  { id: 6, name: "Freshness & format hygiene", weightBp: 1300 },
];

export const TOTAL_WEIGHT_BP = 10000;

// ── Criterion metadata ───────────────────────────────────────────────────

export interface CriterionMeta {
  key: string;
  name: string;
  pillar: 1 | 2 | 3 | 4 | 5 | 6;
  maxPoints: number;
  /** reward = earned by doing something. guard = full marks forfeited by violations. */
  kind: "reward" | "guard";
  rollUp: RollUp;
  evidence: EvidenceGrade;
}

/**
 * All 29 criteria. Order within a pillar is display order.
 *
 * Points per pillar are deliberately unequal (40/50/60/40/40/75) — safe only
 * because scores renormalise per pillar (earned/applicableMax*100). AuthorityOn's
 * equivalent inconsistency (85-125) WAS a bug there, because it capped with
 * Math.min(100, sum), so a perfect Clarity draft could only reach 85.
 */
export const CRITERIA: CriterionMeta[] = [
  // Pillar 1 — Relevance & query coverage (max 40)
  { key: "title-query-alignment", name: "Title matches a target query", pillar: 1, maxPoints: 20, kind: "reward", rollUp: "retrievability", evidence: "A" },
  { key: "query-terms-in-headings", name: "Target-query terms appear in headings", pillar: 1, maxPoints: 10, kind: "reward", rollUp: "retrievability", evidence: "B/C" },
  { key: "query-terms-in-body", name: "Query vocabulary present in the body", pillar: 1, maxPoints: 10, kind: "reward", rollUp: "retrievability", evidence: "C" },

  // Pillar 2 — Evidence & quotability (max 50)
  { key: "statistic-density", name: "Statistics per 1,000 words", pillar: 2, maxPoints: 15, kind: "reward", rollUp: "citability", evidence: "A-" },
  { key: "stat-source-adjacency", name: "Statistics carry a source in the same sentence", pillar: 2, maxPoints: 15, kind: "guard", rollUp: "citability", evidence: "A-" },
  { key: "attributed-quotes", name: "Contains a directly attributed quotation", pillar: 2, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "A-" },
  // The adjective form of an unsourced absolute claim. The judge guards the
  // CLAUSE form ("the only platform that...") at grade B; this guards the
  // mechanical lexicon — models decline to repeat unsourced superlatives, and
  // an SEC-reporting client cannot substantiate "best-in-class" anyway.
  { key: "unverifiable-superlatives", name: "No unverifiable superlatives", pillar: 2, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "C" },
  { key: "external-reference-links", name: "Cites external sources by link", pillar: 2, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "A-" },

  // Pillar 3 — Answer-first structure & extractability (max 60)
  { key: "answer-first-position", name: "The answer appears in the first 10%", pillar: 3, maxPoints: 20, kind: "reward", rollUp: "citability", evidence: "B" },
  { key: "tldr-block", name: "TL;DR / key-takeaways block near the top", pillar: 3, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "B" },
  { key: "question-headings", name: "Question-shaped section headings", pillar: 3, maxPoints: 10, kind: "reward", rollUp: "both", evidence: "B/C" },
  { key: "heading-answer-adjacency", name: "Question headings are answered immediately", pillar: 3, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "B/C" },
  { key: "extractable-definition", name: "Main entity gets a definition, early", pillar: 3, maxPoints: 10, kind: "reward", rollUp: "both", evidence: "B/C" },

  // Pillar 4 — Entity clarity & consistency (max 40)
  { key: "pronoun-opening-chunks", name: "No section opens on a bare pronoun", pillar: 4, maxPoints: 15, kind: "guard", rollUp: "citability", evidence: "C" },
  { key: "canonical-name-consistency", name: "Brand named consistently", pillar: 4, maxPoints: 10, kind: "guard", rollUp: "both", evidence: "C" },
  // The same PERSON spelled two ways — "Alexander Kitchin" in the body,
  // "Alexander Kitchn" in his own credits heading, one keystroke apart on the
  // founder's own draft. A model deciding whether two mentions are one entity
  // has exactly the evidence the page gives it; a misspelled expert is a
  // fractured entity AND an embarrassment. Distance one, surnames of five or
  // more letters, so Bird/Bond stay two people.
  { key: "person-name-consistency", name: "People are spelled one way", pillar: 4, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "D" },
  { key: "chunk-entity-naming", name: "Sections name their subject explicitly", pillar: 4, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "C" },
  { key: "entity-defined-once", name: "One definition of the main entity, not several", pillar: 4, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "C" },
  // Thomas Cremese's "single most expensive mistake" (Amrize audit, Aug 2026):
  // a model extracts the fact and cites the page WITHOUT the brand, because
  // the sentence carrying the fact said "we". The entity must live inside the
  // sentence a model would lift — not the byline, not the paragraph above.
  // Sentences carrying an EXPERIENCE_MARKER are exempt: pillar 5 rewards
  // first-person experience voice, and a criterion must not punish what
  // another rewards.
  { key: "anonymous-first-person-facts", name: "Fact-bearing sentences name the brand, not \"we\"", pillar: 4, maxPoints: 10, kind: "guard", rollUp: "citability", evidence: "C" },

  // Pillar 5 — Authority & experience signals (max 40)
  { key: "byline-present", name: "Byline near the top", pillar: 5, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "C" },
  { key: "credential-line", name: "Author credentials shown", pillar: 5, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "C" },
  { key: "experience-markers", name: "First-hand experience evidence", pillar: 5, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "D" },
  { key: "worked-example", name: "Named customer story or worked example", pillar: 5, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "D" },
  // Promotional load. The research reports the LARGEST measured effect in the
  // whole document behind this — promotional language cutting citation rates
  // by 26.19%, and an article on its own domain cited 7.6% of the time versus
  // 34% distributed — and grades it X, a single vendor study with no causal
  // control. Both facts have to reach the writer, so it carries the big claim
  // at the weakest grade and a small weight, reported as a flag rather than a
  // heavy penalty. That is the research's own instruction, verbatim.
  { key: "promotional-claims", name: "First-person claims carry evidence", pillar: 5, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "X" },

  // Pillar 6 — Freshness & format hygiene (max 75)
  { key: "dateline-recency", name: "Dateline present and recent", pillar: 6, maxPoints: 10, kind: "reward", rollUp: "citability", evidence: "A" },
  { key: "stale-year-guard", name: "No stale 'as of' year claims", pillar: 6, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "B" },
  { key: "current-year-stats", name: "Statistics dated to the current year", pillar: 6, maxPoints: 5, kind: "reward", rollUp: "citability", evidence: "B" },
  { key: "sentence-length-norm", name: "Mean sentence length near the cited norm", pillar: 6, maxPoints: 5, kind: "reward", rollUp: "citability", evidence: "B" },
  { key: "comparative-format-match", name: "Ranked list or table for comparative intent", pillar: 6, maxPoints: 10, kind: "reward", rollUp: "both", evidence: "B" },
  { key: "heading-hierarchy", name: "Heading hierarchy clean", pillar: 6, maxPoints: 15, kind: "reward", rollUp: "both", evidence: "C" },
  { key: "heading-density", name: "Section headings at a healthy density", pillar: 6, maxPoints: 5, kind: "reward", rollUp: "both", evidence: "C" },
  // A bracketed production note — "[Professional headshot image]", "[TK]",
  // "[insert chart]" — is a defect no reader should ever meet, and the
  // founder's own draft shipped FIVE of them into the scorer with nothing
  // noticing. Grade D: no research needed to know a placeholder in published
  // copy is wrong.
  { key: "placeholder-guard", name: "No production placeholders left in the copy", pillar: 6, maxPoints: 5, kind: "guard", rollUp: "citability", evidence: "D" },
  { key: "keyword-stuffing-guard", name: "No keyword stuffing", pillar: 6, maxPoints: 10, kind: "guard", rollUp: "retrievability", evidence: "A" },
  { key: "ai-tell-guard", name: "No AI-tell vocabulary", pillar: 6, maxPoints: 10, kind: "guard", rollUp: "citability", evidence: "D" },
];

/**
 * The AuthorityOn criteria deliberately NOT ported, by their original keys.
 * Named rather than merely absent: the verify script asserts none of these
 * reappears, because the likeliest way this rubric regresses is somebody
 * copy-pasting a "missing" check back in from the original engine.
 */
export const DROPPED_FROM_AUTHORITYON = [
  // Page-existence tests — a draft has no URLs (fix a)
  "has-case-studies", "has-testimonials-page", "has-team-page", "about-page-depth",
  "has-faq-page", "has-glossary-page", "has-blog-section", "has-newsroom",
  // Site-volume tests — a draft is one page (fix a)
  "content-pages-discovered", "long-form-pages", "average-subpage-word-count",
  "average-page-length", "homepage-content-depth", "blog-post-count",
  // Scored twice in the original (fix d)
  "has-faq-knowledge-base",
  // Length as a virtue — correlation with citation is 0.04
  "total-word-count",
  // Page furniture, not draft content
  "copyright-year-current", "recent-year-references",
  // Tone, which the research calls unstable — never scored here
  "authority-voice-keywords",
  // Top tier (20 mentions) exceeds this rubric's own stuffing ceiling at article scale
  "brand-mention-frequency",
  // Branding-page artifacts a draft rarely legitimately contains
  "trademarked-product-names", "named-framework",
  // Rewards formatting-only edits outside comparative intent
  "list-density",
];

// ── Tier mechanics ───────────────────────────────────────────────────────

/**
 * Ported verbatim from AuthorityOn's contentTieredScore. Walks ascending and
 * keeps the last tier whose `min` the value reaches.
 *
 * Guards rely on this too, with DESCENDING points against an ascending
 * violation count: {min:0,points:15},{min:1,points:10},{min:3,points:0} means
 * "clean 15, one slip 10, three or more nothing". Same function, no special case.
 */
export function tieredScore(value: number, tiers: Tier[]): number {
  let score = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i].min) score = tiers[i].points;
  }
  return score;
}

export const GRADE_THRESHOLDS: { min: number; grade: string }[] = [
  { min: 90, grade: "A+" }, { min: 85, grade: "A" }, { min: 80, grade: "A-" },
  { min: 75, grade: "B+" }, { min: 70, grade: "B" }, { min: 65, grade: "B-" },
  { min: 60, grade: "C+" }, { min: 55, grade: "C" }, { min: 50, grade: "C-" },
  { min: 40, grade: "D" }, { min: 30, grade: "E" }, { min: 0, grade: "F" },
];

export function scoreToGrade(score: number): string {
  for (let i = 0; i < GRADE_THRESHOLDS.length; i++) {
    if (score >= GRADE_THRESHOLDS[i].min) return GRADE_THRESHOLDS[i].grade;
  }
  return "F";
}

// ── Tier tables ──────────────────────────────────────────────────────────
// Every table below is recalibrated to a 800-2,500 word article. Where an
// AuthorityOn ancestor exists its original thresholds are named, because "why
// is this 3 and not 25" is the question a future reader will actually have.

/** Query-word overlap ×100. AuthorityOn had no per-query concept at all. */
export const TITLE_ALIGNMENT_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 30, points: 6 }, { min: 50, points: 12 }, { min: 80, points: 20 },
];
export const HEADING_QUERY_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 25, points: 3 }, { min: 50, points: 7 }, { min: 75, points: 10 },
];
export const BODY_QUERY_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 50, points: 3 }, { min: 80, points: 7 }, { min: 100, points: 10 },
];

/**
 * Statistics per 1,000 words. No AuthorityOn ancestor (its nearest was a
 * keyword list). 3/1k ≈ one statistic per section of a 1,200-word explainer.
 * Deliberately no tier above 5/1k: the measured tactic is presence, not
 * saturation, and stat-spam is a real failure mode.
 */
export const STAT_DENSITY_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 1, points: 6 }, { min: 3, points: 11 }, { min: 5, points: 15 },
];

/**
 * GUARD, descending: naked-statistic percentage.
 *
 * The top tier tolerates up to 15% rather than demanding literal zero. Real
 * editorial prose carries numbers that are thresholds or arithmetic rather
 * than sourced claims — "a merchant above EUR 5 million should model it
 * seriously" needs no citation — and a detector cannot reliably tell those
 * from claims. Demanding zero would push writers to delete useful specifics or
 * to attach decorative citations, both worse than the thing being prevented.
 */
export const NAKED_STAT_TIERS: Tier[] = [
  { min: 0, points: 15 }, { min: 15, points: 10 }, { min: 35, points: 5 }, { min: 60, points: 0 },
];

/** Unique external citation domains per 1,000 words. AuthorityOn: 2/5/10 links across a WHOLE CRAWL. */
export const EXTERNAL_LINK_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 1, points: 4 }, { min: 2, points: 7 }, { min: 3, points: 10 },
];

/** Question headings answered within 2 sentences, ratio ×100. */
export const HEADING_ANSWER_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 34, points: 3 }, { min: 67, points: 7 }, { min: 100, points: 10 },
];

/** GUARD, descending: count of chunks opening on a bare pronoun. */
export const PRONOUN_OPEN_TIERS: Tier[] = [
  { min: 0, points: 15 }, { min: 1, points: 10 }, { min: 2, points: 5 }, { min: 3, points: 0 },
];

/**
 * GUARD, descending: distinct brand surface forms.
 * <=2 is normal editorial practice ("The Content Engine … TCE"), 4+ fragments
 * the entity for anything doing entity linking.
 */
export const NAME_DRIFT_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 3, points: 5 }, { min: 4, points: 0 },
];

/** Fraction of chunks naming their subject, ×100. Replaces raw brand-mention counting. */
export const CHUNK_NAMING_TIERS: Tier[] = [
  { min: 0, points: 0 }, { min: 40, points: 3 }, { min: 60, points: 6 }, { min: 80, points: 10 },
];

/** GUARD, descending: competing definitions of the same entity. */
export const DEFINITION_DRIFT_TIERS: Tier[] = [
  { min: 1, points: 5 }, { min: 3, points: 0 },
];

/** GUARD, descending: stale "as of <old year>" claims. */
export const STALE_YEAR_TIERS: Tier[] = [
  { min: 0, points: 5 }, { min: 1, points: 2 }, { min: 2, points: 0 },
];

/** GUARD, descending: AI-tell vocabulary hits per 1,000 words. */
export const AI_TELL_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 0.01, points: 6 }, { min: 1, points: 3 }, { min: 2.5, points: 0 },
];

// ── Keyword lists ────────────────────────────────────────────────────────

/**
 * TL;DR markers. Curated from AuthorityOn's SUMMARY_KEYWORDS, dropping
 * "in conclusion" and "in summary" — at article scale those appear in the
 * CLOSING paragraph, so a verbatim port would award an answer-first point to
 * the exact shape answer-first exists to discourage.
 */
export const SUMMARY_MARKERS = [
  "tl;dr", "tldr", "key takeaway", "key takeaways", "key points", "main points",
  "at a glance", "in brief", "summary", "quick answer", "what you need to know",
  "bottom line",
];

/**
 * Credential keywords. Ported from AuthorityOn's CREDENTIAL_KEYWORDS minus
 * "award-winning", "recognized" and "thought leader" — those are tone, and
 * this rubric never scores tone.
 */
export const CREDENTIAL_KEYWORDS = [
  "ph.d", "phd", "mba", "certified", "accredited", "licensed",
  "peer-reviewed", "patent", "author of", "co-author", "contributor", "chartered",
  // "published" alone is NOT here: it collides with the dateline ("Published
  // 21 August 2026"), which awarded full credential marks to every dated
  // draft — deleting the entire credential line changed nothing.
  "published author", "has published", "published in",
];

export const ROLE_TITLE_PATTERN = /\b(ceo|cto|cfo|coo|founder|co-founder|director|head of|professor|analyst|editor|partner|principal|dr\.?)\b/i;
export const YEARS_EXPERIENCE_PATTERN = /\b\d{1,2}\+?\s+years?\b/i;

/**
 * Unverifiable superlatives — the puffery half of AuthorityOn's old
 * AUTHORITY_VOICE_KEYWORDS, now guarded in its own criterion. (An earlier
 * comment here claimed the AI-tell guard penalised these; it never did — none
 * of them were in AI_TELL_TERMS. The claim was checked when the audit
 * proposed this guard, which is exactly why comments about coverage need the
 * same scepticism as checks that assert code exists.)
 */
/**
 * Promotional-claim vocabulary (research B12).
 *
 * The detector is a CONJUNCTION, and that is the whole design: a brand writing
 * about itself says "we" constantly and legitimately, so self-reference alone
 * flags nothing. A sentence fires only when it refers to itself AND makes a
 * benefit claim AND carries nothing to substantiate it. Tested against a real
 * 2,000-word brand story: zero false positives.
 *
 * Deliberately absent from BENEFIT_VERBS: "work with", "ran", "tested",
 * "measured", "surveyed" — those are EXPERIENCE_MARKERS, which pillar 5
 * REWARDS. "We ran the test across 40 sites" is evidence, not marketing, and a
 * detector that cannot tell the difference would punish the exact writing the
 * rubric is trying to encourage.
 */
export const BENEFIT_VERBS = [
  "help", "helps", "helping", "empower", "empowers", "empowering",
  "enable", "enables", "enabling", "transform", "transforms", "transforming",
  "accelerate", "accelerates", "accelerating", "streamline", "streamlines", "streamlining",
  "optimise", "optimises", "optimising", "optimize", "optimizes", "optimizing",
  "maximise", "maximises", "maximising", "maximize", "maximizes", "maximizing",
  "supercharge", "supercharges", "supercharging", "future-proof", "future-proofs",
  "reimagine", "reimagines", "reimagining", "unleash", "unleashes", "unleashing",
];

export const GENERIC_BENEFICIARIES = [
  "businesses", "brands", "companies", "teams", "organisations", "organizations",
  "enterprises", "clients", "customers", "marketers", "leaders", "executives",
  "professionals", "partners", "firms", "startups", "retailers", "manufacturers",
];

export const TRANSFORMATION_NOUNS = [
  "growth", "success", "transformation", "efficiency", "productivity", "results",
  "outcomes", "value", "roi", "potential", "performance", "impact", "innovation",
  "agility", "excellence",
];

/** The top tier tolerates roughly one such sentence per 1,100 words rather than
 *  demanding zero — every brand article carries one boilerplate line, and on
 *  grade-X evidence failing a piece for it would be a confident wrong verdict.
 *  Same reasoning as NAKED_STAT_TIERS' tolerance. */
export const PROMO_CLAIM_TIERS: Tier[] = [
  { min: 0, points: 5 }, { min: 0.9, points: 3 }, { min: 2, points: 1 }, { min: 4, points: 0 },
];


/** The inner text of a bracket that marks a PRODUCTION NOTE rather than prose.
 *  Keyword-gated so "[sic]", numeric citations "[1]" and markdown links (the
 *  bracket-then-paren shape) never fire. */
export const PLACEHOLDER_RE =
  /\[(?![0-9]+\])([^\]]{0,60}?(?:image|photo|headshot|caption|insert|chart|graphic|logo|video|embed|placeholder|alt text|tk|tbd|coming soon|to come|xx)[^\]]{0,60}?)\](?!\()/gi;


/** A record claim — superlative plus verifiable scope. "The tallest and
 *  longest span of UHPC in North America" is the strongest marketing sentence
 *  a piece can carry and PRECISELY the sentence an engine will not repeat
 *  without a source; on the founder's own draft it was the one claim no
 *  detector could see. Sourced sentences are exempt: a record WITH a verifier
 *  is exactly what the rubric wants more of. */
export const RECORD_CLAIM_RE =
  /\b(?:tallest|largest|longest|biggest|highest|first|oldest|fastest|heaviest)\b[^.!?]{0,80}?\b(?:in\s+(?:the\s+)?(?:world|North America|America|Europe|Asia|the\s+country|the\s+region|the\s+industry)|on\s+record|ever\s+(?:built|made|cast|installed|attempted))\b/i;


/** A short, unpunctuated production note standing as its own block — "Web
 *  photo slideshow" sat mid-article on the founder's draft, three words that
 *  are instructions to a designer, not prose, and being unbracketed it slipped
 *  the bracket rule. Gated three ways (own block, four words or fewer, no
 *  terminal punctuation) so a legitimate kicker like "A new era." never fires. */
export const PRODUCTION_NOTE_WORDS = [
  "slideshow", "gallery", "placeholder", "headshot", "embed", "carousel",
  "lorem", "wireframe", "mockup", "hero image", "infographic here", "chart here",
];

export const SUPERLATIVE_TERMS = [
  "unparalleled", "first-of-its-kind", "world-class", "best-in-class",
  "industry-leading", "unmatched", "unrivalled", "unrivaled",
  "one-of-a-kind", "second to none", "cutting-edge", "state-of-the-art",
];

export const SUPERLATIVE_TIERS: Tier[] = [
  { min: 0, points: 5 }, { min: 1, points: 2 }, { min: 2, points: 0 },
];

export const ANON_FACT_TIERS: Tier[] = [
  { min: 0, points: 10 }, { min: 1, points: 6 }, { min: 3, points: 3 }, { min: 5, points: 0 },
];

/**
 * First-person EXPERIENCE markers. Deliberately disjoint from AuthorityOn's
 * AUTHORITY_VOICE_KEYWORDS, which mixed genuine experience ("we found") with
 * puffery ("industry-leading", "best-in-class", "cutting-edge") — the puffery
 * half now lives in SUPERLATIVE_TERMS with its own guard.
 */
export const EXPERIENCE_MARKERS = [
  "we tested", "we found", "we measured", "we analysed", "we analyzed",
  "we surveyed", "we built", "we've seen", "we have seen", "in our experience",
  "our data", "our study", "our analysis", "our own analysis", "our findings", "when we",
  "hands-on", "first-hand", "firsthand", "we work with", "we worked with",
  "our clients", "i have run", "i have watched", "we ran",
];

export const WORKED_EXAMPLE_STRONG = [
  "case study", "customer story", "client story", "success story",
  "we worked with", "one of our clients", "before and after",
];
export const WORKED_EXAMPLE_WEAK = ["for example", "for instance", "real-world", "worked example"];

export const FRESHNESS_KEYWORDS = [
  "updated", "last updated", "last modified", "published", "posted on",
  "last reviewed", "revised",
];

/** Freshness-context phrases that turn an old year into a stale CLAIM rather than history. */
export const CURRENCY_PHRASES = [
  "as of", "latest", "current", "currently", "most recent", "this year", "to date", "updated",
];

/**
 * AI-tell vocabulary. House doctrine (grade D) — the same banned list the
 * Phase 1 generator writes against, so Phase 2 must detect what Phase 1
 * forbids or the loop contradicts itself. Versioned here so the Pulse feed can
 * extend it under a new RUBRIC_VERSION.
 */
export const AI_TELL_TERMS = [
  "delve", "delves", "delved", "delving", "tapestry", "seamlessly",
  "game-changer", "game changer", "revolutionize", "revolutionise",
  "elevate your", "unlock the", "in today's fast-paced", "ever-evolving",
  "navigate the landscape", "navigate the complexities",
  // Verb forms only. Bare "leverage" is a normal English noun — "commercial
  // leverage", "negotiating leverage" — and including it flagged a legitimate
  // comparison-table row as an AI tell. A guard that fires on correct writing
  // teaches writers to distrust the guard.
  "leverages", "leveraged", "leveraging",
];

/** The "it's not just X, it's Y" construction — the most recognisable AI tell of all. */
export const NOT_JUST_PATTERN = /\b(?:it['’]s|it is|this is|that['’]s)\s+not\s+just\s+[^.!?]{1,60}?[,;—–]\s*(?:it['’]s|it is|but)\b/gi;

export const AUTHOR_LINE_PATTERN = /^\s*(?:by|written by|author:)\s+[A-Z]/i;

export const DEFINITION_TEMPLATE = "(?:is|are)\\s+(?:a|an|the)\\s+";

export const INTERROGATIVE_OPENERS = [
  "what", "how", "why", "when", "where", "which", "who", "can", "should", "does", "do", "is", "are",
];

export const COMPARATIVE_QUERY_PATTERN = /\b(best|top|vs\.?|versus|alternatives?|compare|compared|comparison)\b/i;

/** Stopwords for content-word extraction. Plain array — no Set spreading (see CLAUDE.md on scripts/). */
export const STOPWORDS = [
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "for", "on", "at", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "my", "your", "our", "their", "do", "does",
  "did", "can", "could", "should", "would", "will", "i", "we", "you", "they",
];
