/**
 * Fan-out coverage and the novelty gap — the two checks the AI-search research
 * argues hardest for, and the two the deterministic engine cannot do.
 *
 * WHY THESE TWO, in the research's own words. Fan-out coverage is "the single
 * most actionable output the tool can produce", because "you cover 5 of 11
 * likely sub-queries, here are the 6 you are missing" is a content brief
 * rather than a score. The novelty gap is "the one I would push hardest on":
 * it operationalises Google's own stated top priority — unique, non-commodity
 * content — and an engine has no reason to cite a page for something it
 * already knows.
 *
 * SEAMED LIKE judge.ts, deliberately and for the same reason: every prompt
 * builder and every parser here is PURE and exported, and only the route
 * touches the network. That is what lets the verify script exercise parsing,
 * quote verification and scoring against recorded fixtures, offline and free.
 * A check whose parsing can only be tested by spending money is a check whose
 * parsing does not get tested.
 *
 * THREE CALLS, TWO ROUND TRIPS. Fan-out and the parametric answer are
 * independent and run in parallel; the novelty comparison needs the parametric
 * answer and follows. The research budgets four to six model calls per
 * document and says explicitly not to run one call per check.
 *
 * MODEL SEPARATION (research §7.2: "the risk is greatest when the same model
 * generates the rewrite, the response and the score"). The novelty comparison
 * uses a DIFFERENT model from the one that produced the parametric answer, so
 * nothing grades its own output. The parametric answer deliberately comes from
 * the STRONGER model: a weaker one knows less, would find more of the draft
 * novel, and would flatter the writer — the wrong direction for a tool whose
 * whole argument is that it does not overclaim.
 *
 * WHAT THIS CANNOT KNOW, and says so in the result: the novelty gap is
 * measured against ONE model's knowledge on one day. Models differ from each
 * other and from themselves over time, and the research's own instability
 * findings (page overlap of 18% across two months on AI Overviews) apply here
 * as much as anywhere.
 */

import { JUDGE_MODEL } from "./judge";
import crypto from "crypto";

export const COVERAGE_PROMPT_VERSION = "1.0.0";

/** The sub-query generator and coverage judge. Judging the WRITER's draft, not
 *  its own output, so §7.2's circularity warning does not bite here. */
export const FANOUT_MODEL = JUDGE_MODEL;
/** Answers from parametric knowledge with NO document in context. */
export const PARAMETRIC_MODEL = JUDGE_MODEL;
/** Compares that answer against the draft — a different model, so the
 *  parametric answer is never marked by its own author. */
export const NOVELTY_MODEL = "claude-haiku-4-5-20251001";

export interface CoverageInput {
  title: string;
  /** ParsedDraft.text — the same string quotes are verified against. */
  draftText: string;
  targetQueries: string[];
  brandName?: string;
  format?: string;
}

export interface SubQuery {
  query: string;
  covered: boolean;
  /** Verbatim from the draft when covered. Required — an unquoted "covered"
   *  is an assertion, and the research's judge discipline is that a judge
   *  which must quote hallucinates far less. */
  evidence: string;
  /** Offset of `evidence` in draftText, or -1 when it did not verify. */
  start: number;
  end: number;
}

export interface FanoutResult {
  primaryQuery: string;
  subQueries: SubQuery[];
  coveredCount: number;
  coveragePct: number;
}

export interface NoveltyClaim {
  claim: string;
  /** Verbatim from the draft. Same rule as above. */
  quote: string;
  start: number;
  end: number;
}

export interface NoveltyResult {
  /** What the model produced with no access to the draft. Shown to the writer,
   *  because "here is what a model says without you" is the argument. */
  parametricAnswer: string;
  novel: NoveltyClaim[];
  commodity: NoveltyClaim[];
  noveltyPct: number;
  /** Whose knowledge this was measured against. Never omitted: the number is
   *  meaningless without it. */
  measuredAgainst: string;
}

export interface CoverageResult {
  fanout: FanoutResult | null;
  novelty: NoveltyResult | null;
  /** Everything the run could not assess, and why. A first-class field rather
   *  than silence — the research calls this a trust feature and it is the same
   *  rule the page audit follows. */
  notAssessable: string[];
  models: { fanout: string; parametric: string; novelty: string };
  generatedAt: string;
}

// ── Prompts ───────────────────────────────────────────────────────────────

const SHARED_RULES = `RULES THAT BIND YOU:
- Quote VERBATIM from the draft. Never paraphrase a quote, never repair typos,
  never join two sentences with an ellipsis. A quote that is not a substring of
  the draft is discarded and your finding with it.
- Never propose creating separate pages for uncovered sub-queries. Covering a
  gap means adding a passage to THIS piece. Spinning up a thin page per query
  variant is scaled content abuse and is explicitly against Google's guidance.
- Never propose a change that removes topical breadth or query vocabulary. The
  one end-to-end study in the literature found body-only optimisation REDUCED
  citation, because punchier phrasing strips the terms that get a page
  retrieved at all.
- Reply with JSON only. No prose before or after, no markdown fence.`;

export const FANOUT_SYSTEM = `You model how a generative search engine decomposes a question.

An engine does not match a page to one query. It breaks the user's question
into single-intent sub-queries, runs them concurrently, and assembles an answer
from whichever passages best answer each one. A page that answers three of ten
sub-queries competes for three slots; a page that answers eight competes for
eight.

Your job is to infer the question this draft is really answering, decompose it
the way an engine would, and then say honestly which sub-queries the draft
already answers.

${SHARED_RULES}

Return exactly:
{
  "primaryQuery": "the one question this piece answers, phrased as a user would type it",
  "subQueries": [
    { "query": "a single-intent sub-question", "covered": true, "evidence": "verbatim sentence from the draft that answers it" },
    { "query": "another", "covered": false, "evidence": "" }
  ]
}

Generate 8 to 12 sub-queries. Judge coverage strictly: a passage that mentions
the topic is not a passage that ANSWERS the question. If the draft only alludes
to it, mark it uncovered — an uncovered sub-query the writer can fix is worth
more than a generous tick.`;

export function buildFanoutPrompt(input: CoverageInput): { system: string; user: string } {
  const declared = input.targetQueries.filter(Boolean);
  const lines: string[] = [];
  lines.push(`TITLE: ${input.title || "(untitled)"}`);
  if (input.brandName) lines.push(`BRAND: ${input.brandName}`);
  if (input.format) lines.push(`FORMAT: ${input.format}`);
  if (declared.length) {
    // A declared query REPLACES inference. The writer knowing what they are
    // answering is better evidence than a model guessing at it.
    lines.push(`DECLARED TARGET QUERY: ${declared[0]}`);
    lines.push(`Use this as primaryQuery verbatim. Do not infer a different one.`);
  }
  lines.push("", "DRAFT:", input.draftText);
  return { system: FANOUT_SYSTEM, user: lines.join("\n") };
}

export const PARAMETRIC_SYSTEM = `Answer from what you already know. You have no documents and no search.

Write the answer you would give a user who asked this question cold, in 150 to
250 words. Be specific where you are confident and say plainly where you are
not. Do not hedge decoratively and do not pad.

This answer is going to be compared against a specific article to find out
which of that article's claims you did NOT already know. So the useful thing
you can do is be complete about what you DO know. Reply with prose only.`;

export function buildParametricPrompt(primaryQuery: string): { system: string; user: string } {
  return { system: PARAMETRIC_SYSTEM, user: primaryQuery };
}

export const NOVELTY_SYSTEM = `You are comparing two texts to find what one knows that the other does not.

TEXT A is an answer a language model produced from its own knowledge, with no
sources. TEXT B is a published article. Your job is to sort the article's
substantive claims into two piles:

NOVEL — a specific claim, figure, name, date, quotation or first-hand detail
that does NOT appear in Text A, even loosely. These are the reasons an engine
would have to cite the article rather than answer from its own knowledge.

COMMODITY — a claim Text A already makes, or a restatement of general knowledge
the model plainly holds. Not a criticism of the writing; a statement that this
particular sentence gives an engine no reason to cite anyone.

Judge SUBSTANCE, not wording. "Concrete panels were 14,000 pounds" and "the
panels weighed about seven tons" are the same claim. Ignore transitions, scene
setting and anything that is not a claim at all.

${SHARED_RULES}

Return exactly:
{
  "novel": [ { "claim": "what is new, in your words", "quote": "verbatim sentence from Text B" } ],
  "commodity": [ { "claim": "what Text A already covers", "quote": "verbatim sentence from Text B" } ]
}

Cap each list at 12. Prefer the most load-bearing claims over the most numerous.`;

export function buildNoveltyPrompt(
  parametricAnswer: string,
  draftText: string
): { system: string; user: string } {
  return {
    system: NOVELTY_SYSTEM,
    user: `TEXT A — what a model answers from its own knowledge:\n${parametricAnswer}\n\n---\n\nTEXT B — the article:\n${draftText}`,
  };
}

// ── Parsing ───────────────────────────────────────────────────────────────

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  /** Items dropped because their quote was not in the draft. Reported, never
   *  silently swallowed: a judge that invents quotes is a judge to distrust,
   *  and the count is the signal. */
  dropped: number;
}

function extractJson(raw: string): any | null {
  const s = String(raw || "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** Locate a quote in the draft, tolerating only whitespace differences. Any
 *  other edit means the model rewrote it, and a rewritten quote is not
 *  evidence. */
function locate(draftText: string, quote: string): { start: number; end: number } {
  const q = String(quote || "").trim();
  if (q.length < 12) return { start: -1, end: -1 };
  const direct = draftText.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length };
  const loose = q.replace(/\s+/g, "\\s+").replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "\\" ? m : "\\" + m));
  try {
    const m = new RegExp(loose).exec(draftText);
    if (m) return { start: m.index, end: m.index + m[0].length };
  } catch {
    /* an unbuildable pattern is a failed locate, not a crash */
  }
  return { start: -1, end: -1 };
}

export function parseFanoutResponse(raw: string, draftText: string): ParseResult<FanoutResult> {
  const j = extractJson(raw);
  if (!j) return { ok: false, error: "The coverage model did not return JSON.", dropped: 0 };
  const list = Array.isArray(j.subQueries) ? j.subQueries : null;
  if (!list || list.length === 0) {
    return { ok: false, error: "The coverage model returned no sub-queries.", dropped: 0 };
  }

  let dropped = 0;
  const subQueries: SubQuery[] = [];
  for (let i = 0; i < list.length; i++) {
    const q = String(list[i] && list[i].query ? list[i].query : "").trim();
    if (!q) { dropped++; continue; }
    const claimedCovered = list[i].covered === true;
    const evidence = String(list[i].evidence || "").trim();
    let start = -1, end = -1;
    let covered = false;
    if (claimedCovered) {
      const at = locate(draftText, evidence);
      // A claim of coverage with no verifiable quote is DEMOTED to uncovered,
      // not dropped. The sub-query is still a real sub-query and the writer
      // still needs to know about it; what failed is the evidence, so the
      // honest resolution is to stop asserting the part that failed.
      if (at.start >= 0) { covered = true; start = at.start; end = at.end; }
      else dropped++;
    }
    subQueries.push({ query: q, covered, evidence: covered ? evidence : "", start, end });
  }
  if (subQueries.length === 0) {
    return { ok: false, error: "No usable sub-queries survived parsing.", dropped };
  }

  let coveredCount = 0;
  for (let i = 0; i < subQueries.length; i++) if (subQueries[i].covered) coveredCount++;
  return {
    ok: true,
    dropped,
    value: {
      primaryQuery: String(j.primaryQuery || "").trim() || "(not inferred)",
      subQueries,
      coveredCount,
      coveragePct: Math.round((coveredCount / subQueries.length) * 100),
    },
  };
}

export function parseNoveltyResponse(
  raw: string,
  draftText: string,
  parametricAnswer: string
): ParseResult<NoveltyResult> {
  const j = extractJson(raw);
  if (!j) return { ok: false, error: "The novelty model did not return JSON.", dropped: 0 };

  let dropped = 0;
  const take = (arr: any): NoveltyClaim[] => {
    const out: NoveltyClaim[] = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length && out.length < 12; i++) {
      const claim = String(arr[i] && arr[i].claim ? arr[i].claim : "").trim();
      const quote = String(arr[i] && arr[i].quote ? arr[i].quote : "").trim();
      if (!claim) { dropped++; continue; }
      const at = locate(draftText, quote);
      // Unlike coverage, an unverifiable quote here is DROPPED outright. There
      // is no honest weaker claim to fall back to: "this sentence is novel"
      // means nothing without the sentence.
      if (at.start < 0) { dropped++; continue; }
      out.push({ claim, quote, start: at.start, end: at.end });
    }
    return out;
  };

  const novel = take(j.novel);
  const commodity = take(j.commodity);
  const total = novel.length + commodity.length;
  if (total === 0) {
    return { ok: false, error: "No claim survived quote verification.", dropped };
  }
  return {
    ok: true,
    dropped,
    value: {
      parametricAnswer,
      novel,
      commodity,
      noveltyPct: Math.round((novel.length / total) * 100),
      measuredAgainst: PARAMETRIC_MODEL,
    },
  };
}

// ── Memoisation ───────────────────────────────────────────────────────────

/**
 * The hash of everything the run saw. Versions and model ids are PARAMETERS,
 * not captured constants, so a check can prove they reach the digest — the
 * assess path shipped a version bump that silently never entered its own memo
 * key, and the only reason it was caught is that the key was made testable.
 */
export function coverageKey(
  input: CoverageInput,
  promptVersion: string,
  models: { fanout: string; parametric: string; novelty: string }
): string {
  const parts = [
    input.draftText,
    input.title || "",
    (input.targetQueries || []).join("|"),
    input.brandName || "",
    input.format || "",
    promptVersion,
    models.fanout,
    models.parametric,
    models.novelty,
  ];
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
