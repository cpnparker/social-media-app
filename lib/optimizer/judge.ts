/**
 * The LLM judge — prompt, parse, score.
 *
 * SEAMED DELIBERATELY: buildJudgePrompt, parseJudgeResponse and
 * scoreJudgeResponse are PURE and exported. Only callJudge touches the network.
 * That split is what lets the verify script and the stability harness exercise
 * the whole post-response pipeline — parse, anchor, score — against recorded
 * fixtures, for free, offline, with nothing stubbed except the one HTTP call.
 * A judge whose parsing can only be tested by spending money is a judge whose
 * parsing does not get tested.
 *
 * ON DETERMINISM, because the spec is wrong about this and the correction
 * matters: claude-sonnet-5 accepts no `temperature`, `top_p` or `top_k` — the
 * request 400s — and the Anthropic API has no seed. "Judge at temperature 0"
 * is not implementable. Stability is therefore designed in rather than
 * sampled:
 *
 *   1. MEMOIZATION on an input hash. Identical input never re-runs, so
 *      "re-assessing unchanged text must not move the score" is literally true
 *      rather than statistically likely.
 *   2. QUANTIZATION. The judge returns ordinal verdicts, never numbers. All
 *      points come from fixed tables in judge-rubric.ts, so variance can only
 *      surface as a discrete verdict flip worth a known step.
 *   3. PINNED INPUTS — model id, prompt bytes (versioned), canon snapshot,
 *      unit enumeration in document order, thinking disabled.
 */

import { anchorAll, validateAnchor } from "./anchors";
import type { ParsedDraft } from "./parse";
import { tieredScore } from "./rubric";
import {
  JUDGE_CRITERIA, JUDGE_CRITERION_KEYS, JUDGE_PROMPT_VERSION, MAX_FINDINGS,
  QUERY_COVERAGE_POINTS, OPENING_POINTS, QUOTE_QUALITY_POINTS,
  VARIANT_DRIFT_TIERS, EMPTY_EXPERIENCE_TIERS, ABSOLUTE_CLAIM_TIERS,
} from "./judge-rubric";
import type { CriterionResult } from "./types";

export const JUDGE_MODEL = "claude-sonnet-5";

export interface JudgeFinding {
  criterion: string;
  severity: "high" | "medium" | "low";
  quote: string;
  prefix: string;
  suffix: string;
  explanation: string;
  suggestedEdit: string | null;
}

export interface JudgeResponse {
  queryCoverage: { queryId: string; verdict: string; gap: string }[];
  openingQuotability: { verdict: string; reason: string };
  chunkSelfContainment: { chunkId: string; verdict: string; dependency: string }[];
  quoteAttribution: { quoteId: string; verdict: string }[];
  findings: JudgeFinding[];
  summary: string;
}

export interface JudgeInput {
  parsed: ParsedDraft;
  title: string;
  targetQueries: string[];
  brandName?: string;
  brandAliases?: string[];
  format?: string;
}

// ── The prompt ───────────────────────────────────────────────────────────

/**
 * System block. Stable across every session, so it caches — and so a change to
 * it is a deliberate, version-bumped act rather than a silent drift in what
 * every client's content is judged against.
 */
export const JUDGE_SYSTEM = `You are the assessment judge inside a content optimisation studio. You assess ONE unpublished draft against seven criteria that require reading comprehension.

A separate deterministic engine already scores 29 other criteria — counts, densities, positions, patterns, structure. It is exact and you must not second-guess it. You are never shown its results, and you must never comment on anything it measures: word counts, statistic density, heading structure, dateline presence, keyword stuffing, AI-tell vocabulary, sentence length, or whether a term appears in a heading. If you find yourself about to say "this section has no subheadings" or "there are only two statistics", stop — that is not your job and a second opinion on it makes the score unreadable.

YOUR SEVEN CRITERIA

1. semantic-query-coverage — for each target query, does the draft ANSWER it? Not "does it contain the words" — the engine already checks that. A draft can use every word of a question and never answer it. Verdict per query: covered (a reader gets a direct answer), partial (touched but incomplete or hedged into uselessness), missing.

2. quote-attribution-quality — for each quotation the parser found, is the speaker named and plausibly real, and does the quote say something a paraphrase could not? Verdict: substantive, weak (attributed but says nothing), decorative (no real attribution, or a slogan in quote marks).

3. opening-quotability — could the opening be lifted verbatim and stand alone as the answer, with no surrounding context? Verdict: quotable_alone, needs_context (the answer is there but depends on something else), no_answer.

4. chunk-self-containment — for each section, would it make sense extracted alone? Look for semantic dependencies the engine cannot see: "as mentioned above", "the second option", comparisons to an antecedent named only earlier, a subject identifiable only from a previous section. Verdict: self_contained, dependent.

5. entity-variant-drift — names for the main entity that are NOT in the registered list you are given: misspellings, unregistered abbreviations, inconsistent capitalisation of a proper noun. Report each as a finding.

6. experience-substantiation — first-person experience claims ("in our experience", "we tested", "our data shows") that are followed by NOTHING: no number, no named context, no outcome. An empty authority costume. Report each as a finding.

7. unsourced-absolute-claims — NON-NUMERIC absolute statements carrying no source: "the only platform that", "always", "never", "every merchant". Numeric claims are the engine's job — do not report those. Report each as a finding.

FINDINGS — THE ANCHORING CONTRACT

Every finding carries a quote that will be located in the draft by exact string match. If the match fails, the finding is discarded and your work is wasted.

- Copy the quote CHARACTER FOR CHARACTER from the draft. Include its punctuation, its capitalisation and its typography exactly as written. Do not tidy it, do not fix its typos, do not normalise its quotation marks or dashes.
- Never abbreviate with "…" or "...". A quote with an ellipsis cannot be matched and is thrown away.
- Maximum 200 characters. If the passage is longer, quote the most specific 200-character span inside it.
- A quote must not cross a blank line (a paragraph boundary).
- Give prefix and suffix: up to 40 characters immediately before and after the quote, copied equally exactly. These disambiguate when the same sentence appears twice.
- If you cannot quote something verbatim, do not invent a paraphrase to quote — leave it out and describe it in the relevant verdict field instead.

suggestedEdit is the replacement text itself, ready to substitute for the quote. Not advice about what to change — the actual words. Null if no clean single-span replacement exists.

WHEN UNCERTAIN, choose the better verdict. A false accusation costs a writer's trust in the whole tool; a missed issue costs one suggestion. Report at most ${MAX_FINDINGS} findings, most important first.

Return ONLY a JSON object. No preamble, no markdown fence, no commentary.`;

/** Per-session block: what this specific draft is being judged against. */
export function buildSessionBlock(input: JudgeInput): string {
  const parts: string[] = [];
  parts.push(`Working title: ${input.title}`);
  if (input.format) parts.push(`Format: ${input.format}`);
  if (input.targetQueries.length > 0) {
    parts.push(
      "Target queries:\n" +
        input.targetQueries.map((q, i) => `  q${i + 1}: ${q}`).join("\n")
    );
  } else {
    parts.push("Target queries: none set — return an empty queryCoverage array and do not guess at one.");
  }
  const names = [input.brandName || ""].concat(input.brandAliases || []).filter(Boolean);
  if (names.length > 0) {
    parts.push(
      `Registered names for the main entity (any OTHER form is drift): ${names.join(", ")}`
    );
  } else {
    parts.push("No brand registered — skip entity-variant-drift entirely and report no findings for it.");
  }
  return parts.join("\n\n");
}

/**
 * User block: the draft, with stable ids for every unit the judge must return
 * a verdict on. Ids are assigned in document order so they are identical for
 * identical text — a unit list that reshuffles between runs would make verdict
 * comparison across runs meaningless, which is what the stability harness
 * measures.
 */
export function buildDraftBlock(input: JudgeInput): string {
  const p = input.parsed;
  const parts: string[] = [];

  const chunkLines: string[] = [];
  for (let i = 0; i < p.chunks.length; i++) {
    const c = p.chunks[i];
    if (c.isEmpty) continue;
    const heading = c.heading ? c.heading.text : "(opening)";
    chunkLines.push(`  c${i}: ${heading}`);
  }
  if (chunkLines.length > 0) parts.push("Sections to judge for self-containment:\n" + chunkLines.join("\n"));

  const quoteLines: string[] = [];
  for (let i = 0; i < p.quotes.length; i++) {
    quoteLines.push(`  qt${i}: "${p.quotes[i].text.slice(0, 120)}"`);
  }
  parts.push(
    quoteLines.length > 0
      ? "Quotations found:\n" + quoteLines.join("\n")
      : "Quotations found: none — return an empty quoteAttribution array."
  );

  parts.push("---- DRAFT ----\n" + p.text + "\n---- END DRAFT ----");
  return parts.join("\n\n");
}

export function buildJudgePrompt(input: JudgeInput): { system: string; sessionBlock: string; user: string } {
  return {
    system: JUDGE_SYSTEM,
    sessionBlock: buildSessionBlock(input),
    user: buildDraftBlock(input),
  };
}

// ── Parsing ──────────────────────────────────────────────────────────────

export interface ParseOutcome {
  ok: boolean;
  response: JudgeResponse | null;
  /** Findings dropped on the way in, and why. Surfaced, not swallowed: a rising
   *  drop rate is the earliest signal that the judge prompt has drifted. */
  dropped: { reason: string; detail: string }[];
  error?: string;
}

function str(v: any, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Parse and sanitise a judge response.
 *
 * Pure — takes the raw string and the draft text, returns what survived. Every
 * rejection is recorded rather than silently dropped, because "the judge found
 * nothing" and "the judge found eight things and all eight quotes were
 * unmatchable" look identical in the UI and mean opposite things.
 */
export function parseJudgeResponse(raw: string, draftText: string): ParseOutcome {
  const dropped: { reason: string; detail: string }[] = [];

  let text = (raw || "").trim();
  // Models fence JSON despite being told not to. Cheap to tolerate, and the
  // alternative is discarding a good response over a markdown habit.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) {
    return { ok: false, response: null, dropped, error: "no JSON object in response" };
  }

  let obj: any;
  try {
    obj = JSON.parse(text.slice(first, last + 1));
  } catch (e: any) {
    return { ok: false, response: null, dropped, error: "malformed JSON: " + (e?.message || "parse failed") };
  }

  const findings: JudgeFinding[] = [];
  const rawFindings: any[] = Array.isArray(obj.findings) ? obj.findings : [];
  for (let i = 0; i < rawFindings.length && findings.length < MAX_FINDINGS; i++) {
    const f = rawFindings[i] || {};
    const criterion = str(f.criterion, 80);

    // A finding naming an ENGINE criterion is the failure mode the disjointness
    // design exists to prevent — two numbers for one construct. Dropped, and
    // counted, so the prompt can be fixed rather than the symptom tolerated.
    if (JUDGE_CRITERION_KEYS.indexOf(criterion) < 0) {
      dropped.push({ reason: "unknown_criterion", detail: criterion || "(missing)" });
      continue;
    }

    const anchor = {
      quote: str(f.quote, 400),
      prefix: str(f.prefix, 40),
      suffix: str(f.suffix, 40),
    };
    const valid = validateAnchor(anchor);
    if (!valid.ok) {
      dropped.push({ reason: "malformed_anchor", detail: `${criterion}: ${valid.problem}` });
      continue;
    }
    if (draftText.indexOf(anchor.quote) < 0) {
      // Caught here rather than at highlight time so the cause is attributable
      // to this response while we still know which prompt produced it.
      dropped.push({ reason: "quote_not_in_draft", detail: `${criterion}: ${anchor.quote.slice(0, 60)}` });
      continue;
    }

    const explanation = str(f.explanation, 400);
    if (explanation.length < 10) {
      dropped.push({ reason: "no_explanation", detail: criterion });
      continue;
    }

    const severity = ["high", "medium", "low"].indexOf(str(f.severity, 10)) >= 0
      ? (f.severity as "high" | "medium" | "low")
      : "medium";

    findings.push({
      criterion, severity,
      quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix,
      explanation,
      suggestedEdit: typeof f.suggestedEdit === "string" && f.suggestedEdit.trim() ? f.suggestedEdit.slice(0, 400) : null,
    });
  }

  const response: JudgeResponse = {
    queryCoverage: normaliseVerdicts(obj.queryCoverage, "queryId", ["covered", "partial", "missing"], "gap"),
    openingQuotability: {
      verdict: ["quotable_alone", "needs_context", "no_answer"].indexOf(str(obj.openingQuotability?.verdict, 40)) >= 0
        ? obj.openingQuotability.verdict : "needs_context",
      reason: str(obj.openingQuotability?.reason, 300),
    },
    chunkSelfContainment: normaliseVerdicts(obj.chunkSelfContainment, "chunkId", ["self_contained", "dependent"], "dependency"),
    quoteAttribution: normaliseVerdicts(obj.quoteAttribution, "quoteId", ["substantive", "weak", "decorative"], ""),
    findings,
    summary: str(obj.summary, 400),
  };

  return { ok: true, response, dropped };
}

function normaliseVerdicts(arr: any, idKey: string, allowed: string[], detailKey: string): any[] {
  if (!Array.isArray(arr)) return [];
  const out: any[] = [];
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i] || {};
    const verdict = str(row.verdict, 40);
    if (allowed.indexOf(verdict) < 0) continue;
    const entry: any = { verdict };
    entry[idKey] = str(row[idKey], 40);
    if (detailKey) entry[detailKey] = str(row[detailKey], 300);
    out.push(entry);
  }
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────

const JUDGE_META: { [k: string]: typeof JUDGE_CRITERIA[0] } = {};
for (let i = 0; i < JUDGE_CRITERIA.length; i++) JUDGE_META[JUDGE_CRITERIA[i].key] = JUDGE_CRITERIA[i];

function jScore(key: string, earned: number, passed: boolean, note: string): CriterionResult {
  const m = JUDGE_META[key];
  return {
    key: m.key, name: m.name + " — " + note,
    earned: Math.round(earned * 100) / 100, maxPoints: m.maxPoints, passed,
    evidence: m.evidence, rollUp: m.rollUp,
    penalty: m.kind === "guard" ? true : undefined,
  };
}

function jSkip(key: string, reason: string): CriterionResult {
  const m = JUDGE_META[key];
  return {
    key: m.key, name: m.name, earned: 0, maxPoints: 0, passed: false,
    evidence: m.evidence, rollUp: m.rollUp, skipped: true, skipReason: reason,
    penalty: m.kind === "guard" ? true : undefined,
  };
}

/**
 * Turn verdicts and anchored findings into criterion results.
 *
 * ANTI-DRIFT, clause 2: a guard's violation count is the number of findings
 * that ANCHORED. A violation the judge asserts but cannot point at does not
 * exist — otherwise the judge could cost a writer points for something they
 * cannot see, find or fix.
 */
export function scoreJudgeResponse(
  response: JudgeResponse,
  input: JudgeInput,
  anchoredFindings: JudgeFinding[]
): CriterionResult[] {
  const out: CriterionResult[] = [];
  const queries = input.targetQueries || [];

  // 1. semantic-query-coverage
  if (queries.length === 0) {
    out.push(jSkip("semantic-query-coverage", "No target query set"));
  } else {
    let total = 0;
    let counted = 0;
    for (let i = 0; i < queries.length; i++) {
      const row = response.queryCoverage.filter((r) => r.queryId === "q" + (i + 1))[0];
      // A query the judge did not report on is NOT scored zero — that would
      // punish the draft for the judge's omission. It drops out of the
      // denominator, the same rule the engine uses for missing context.
      if (!row) continue;
      total += QUERY_COVERAGE_POINTS[row.verdict] || 0;
      counted++;
    }
    if (counted === 0) {
      out.push(jSkip("semantic-query-coverage", "The judge returned no coverage verdicts"));
    } else {
      const meta = JUDGE_META["semantic-query-coverage"];
      const earned = (total / counted) * meta.maxPoints;
      const covered = response.queryCoverage.filter((r) => r.verdict === "covered").length;
      out.push(jScore("semantic-query-coverage", earned, earned >= meta.maxPoints * 0.9,
        `${covered} of ${counted} queries answered`));
    }
  }

  // 2. quote-attribution-quality
  if (input.parsed.quotes.length === 0 || response.quoteAttribution.length === 0) {
    out.push(jSkip("quote-attribution-quality", "No quotations to assess"));
  } else {
    let total = 0;
    for (let i = 0; i < response.quoteAttribution.length; i++) {
      total += QUOTE_QUALITY_POINTS[response.quoteAttribution[i].verdict] || 0;
    }
    const meta = JUDGE_META["quote-attribution-quality"];
    const earned = (total / response.quoteAttribution.length) * meta.maxPoints;
    const strong = response.quoteAttribution.filter((q) => q.verdict === "substantive").length;
    out.push(jScore("quote-attribution-quality", earned, earned >= meta.maxPoints * 0.9,
      `${strong} of ${response.quoteAttribution.length} substantive`));
  }

  // 3. opening-quotability
  {
    const v = response.openingQuotability.verdict;
    const earned = OPENING_POINTS[v] != null ? OPENING_POINTS[v] : 5;
    out.push(jScore("opening-quotability", earned, v === "quotable_alone", v.replace(/_/g, " ")));
  }

  // 4. chunk-self-containment
  {
    const rows = response.chunkSelfContainment;
    if (rows.length === 0) {
      out.push(jSkip("chunk-self-containment", "The judge returned no section verdicts"));
    } else {
      const contained = rows.filter((r) => r.verdict === "self_contained").length;
      const meta = JUDGE_META["chunk-self-containment"];
      const earned = (contained / rows.length) * meta.maxPoints;
      out.push(jScore("chunk-self-containment", earned, contained === rows.length,
        `${contained} of ${rows.length} sections stand alone`));
    }
  }

  // 5-7. The guards, counted from ANCHORED findings only.
  const countFor = (key: string) => anchoredFindings.filter((f) => f.criterion === key).length;

  const names = [input.brandName || ""].concat(input.brandAliases || []).filter(Boolean);
  if (names.length === 0) {
    out.push(jSkip("entity-variant-drift", "No brand registered to drift from"));
  } else {
    const n = countFor("entity-variant-drift");
    out.push(jScore("entity-variant-drift", tieredScore(n, VARIANT_DRIFT_TIERS), n === 0,
      n === 0 ? "no unregistered variants" : `${n} unregistered variant${n === 1 ? "" : "s"}`));
  }

  const emptyExp = countFor("experience-substantiation");
  out.push(jScore("experience-substantiation", tieredScore(emptyExp, EMPTY_EXPERIENCE_TIERS), emptyExp === 0,
    emptyExp === 0 ? "first-hand claims carry substance" : `${emptyExp} unsupported claim${emptyExp === 1 ? "" : "s"}`));

  const absolutes = countFor("unsourced-absolute-claims");
  out.push(jScore("unsourced-absolute-claims", tieredScore(absolutes, ABSOLUTE_CLAIM_TIERS), absolutes === 0,
    absolutes === 0 ? "no unsourced absolutes" : `${absolutes} unsourced absolute claim${absolutes === 1 ? "" : "s"}`));

  return out;
}

/** Anchor the judge's findings against the draft. Orphans are excluded from
 *  guard counts (anti-drift clause 2) but still returned for display. */
export function anchorJudgeFindings(draftText: string, findings: JudgeFinding[]) {
  return anchorAll(draftText, findings);
}

/**
 * The memo key. Identical input must never re-run — this is the mechanism that
 * makes "re-assessing unchanged text does not move the score" true by
 * construction rather than by hoping the model is consistent.
 */
export function assessmentKey(input: JudgeInput, rubricVersion: string): string {
  const parts = [
    input.parsed.text,
    (input.targetQueries || []).join("|"),
    input.brandName || "",
    (input.brandAliases || []).join("|"),
    input.format || "",
    rubricVersion,
    JUDGE_PROMPT_VERSION,
    JUDGE_MODEL,
  ].join(" ");
  // Small, dependency-free FNV-1a. Collision risk is irrelevant here: the cost
  // of one is a stale assessment on a different draft of the same length, and
  // the alternative is importing crypto into a module that runs client-side.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + Math.imul(c, i + 1)) >>> 0;
  }
  return h1.toString(16) + "-" + h2.toString(16) + "-" + parts.length.toString(16);
}
