/**
 * Content Optimizer — the deterministic scoring engine.
 *
 * Pure and synchronous: same draft in, same numbers out, every time. That is
 * the whole point of splitting deterministic scoring from the LLM judge —
 * a writer editing toward a target needs feedback that does not wobble when
 * nothing changed. Anything requiring judgement (semantic coverage, "could
 * this opening be quoted alone", attribution quality) belongs to the judge and
 * is deliberately absent here.
 *
 * `now` is INJECTED, never read from the clock. Freshness criteria otherwise
 * make the test suite rot silently — fixtures pass today and start failing next
 * spring as their "recent" dateline drifts a tier, and whoever sees that will
 * loosen the fixture instead of finding the clock.
 */

import {
  CRITERIA, PILLARS, RUBRIC_VERSION, scoreToGrade, tieredScore,
  TITLE_ALIGNMENT_TIERS, HEADING_QUERY_TIERS, BODY_QUERY_TIERS,
  STAT_DENSITY_TIERS, NAKED_STAT_TIERS, EXTERNAL_LINK_TIERS,
  HEADING_ANSWER_TIERS, PRONOUN_OPEN_TIERS, NAME_DRIFT_TIERS,
  CHUNK_NAMING_TIERS, DEFINITION_DRIFT_TIERS, STALE_YEAR_TIERS, AI_TELL_TIERS,
  SUMMARY_MARKERS, CREDENTIAL_KEYWORDS, ROLE_TITLE_PATTERN, YEARS_EXPERIENCE_PATTERN,
  EXPERIENCE_MARKERS, WORKED_EXAMPLE_STRONG, WORKED_EXAMPLE_WEAK,
  CURRENCY_PHRASES, AI_TELL_TERMS, NOT_JUST_PATTERN,
  AUTHOR_LINE_PATTERN, COMPARATIVE_QUERY_PATTERN, STOPWORDS,
} from "./rubric";
import { parseDraft, sliceByWords, countTerm, containsAny } from "./parse";
import type { ParsedDraft, Chunk } from "./parse";
import { validateHeadingHierarchy } from "./heading-hierarchy";
import type { CriterionResult, DraftScores, PillarScore } from "./types";

export interface DraftInput {
  body: string;
  title?: string;
  targetQueries?: string[];
  /** "explainer" | "ranked-list" | "faq" | "data-brief" | "op-ed" | "comparison" */
  format?: string;
  brandName?: string;
  brandAliases?: string[];
  authorName?: string;
  /** ISO date. Supplied on URL import; a fresh draft normally has none. */
  publishedDate?: string;
  /** Set when the piece is deliberately unattributed, so the author criteria skip rather than fail. */
  unattributed?: boolean;
  /** Injected clock. Defaults to real time only at the top-level entry point. */
  now?: Date;
}

const STOP: { [k: string]: boolean } = {};
for (let i = 0; i < STOPWORDS.length; i++) STOP[STOPWORDS[i]] = true;

function contentWords(s: string): string[] {
  const raw = s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (w.length < 3 || STOP[w]) continue;
    out.push(w);
  }
  return out;
}

/** Match a query term allowing a trailing s/es, so "CRMs" satisfies the term "crm". */
function termPresent(hayLower: string, term: string): boolean {
  if (countTerm(hayLower, term) > 0) return true;
  if (countTerm(hayLower, term + "s") > 0) return true;
  if (countTerm(hayLower, term + "es") > 0) return true;
  if (term.length > 3 && term.charAt(term.length - 1) === "s" && countTerm(hayLower, term.slice(0, -1)) > 0) return true;
  return false;
}

function coverage(queryTerms: string[], hayLower: string): number {
  if (queryTerms.length === 0) return 0;
  let hit = 0;
  for (let i = 0; i < queryTerms.length; i++) if (termPresent(hayLower, queryTerms[i])) hit++;
  return (hit / queryTerms.length) * 100;
}

// ── Result builders ──────────────────────────────────────────────────────

const META: { [k: string]: typeof CRITERIA[0] } = {};
for (let i = 0; i < CRITERIA.length; i++) META[CRITERIA[i].key] = CRITERIA[i];

function score(key: string, earned: number, passed: boolean, nameSuffix?: string): CriterionResult {
  const m = META[key];
  if (!m) throw new Error("Unknown criterion key: " + key);
  return {
    key: m.key,
    name: nameSuffix ? m.name + " — " + nameSuffix : m.name,
    earned: earned, maxPoints: m.maxPoints, passed: passed,
    evidence: m.evidence, rollUp: m.rollUp,
    penalty: m.kind === "guard" ? true : undefined,
  };
}

/**
 * A criterion whose input the writer cannot supply from the draft body.
 * Excluded from the pillar denominator entirely — scoring it zero would
 * penalise a blameless draft for the tool's own missing inputs, which is the
 * fastest way to make a score nobody believes.
 */
function skip(key: string, reason: string): CriterionResult {
  const m = META[key];
  if (!m) throw new Error("Unknown criterion key: " + key);
  return {
    key: m.key, name: m.name, earned: 0, maxPoints: 0, passed: false,
    evidence: m.evidence, rollUp: m.rollUp, skipped: true, skipReason: reason,
    penalty: m.kind === "guard" ? true : undefined,
  };
}

// ── The criteria ─────────────────────────────────────────────────────────

function pillar1(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const queries = input.targetQueries || [];
  if (queries.length === 0) {
    return [
      skip("title-query-alignment", "No target query set"),
      skip("query-terms-in-headings", "No target query set"),
      skip("query-terms-in-body", "No target query set"),
    ];
  }

  const titleLower = (p.title || "").toLowerCase();
  const h1 = p.headings.filter(function (h) { return h.level === 1; })[0];
  const headingText = p.headings.map(function (h) { return h.textLower; }).join(" ");
  const bodyLower = p.text.toLowerCase();

  // Only queries that actually yielded content words are averaged over.
  //
  // Dividing by queries.length counted a query the engine had DISCARDED — one
  // made entirely of stopwords, say — as scoring zero, dragging the pillar down
  // for a reason the writer cannot see in the panel and cannot act on in the
  // draft. If every query is discarded the criteria skip, exactly as they do
  // when no query was set at all: same information available, same treatment.
  let bestTitle = 0, headingSum = 0, bodySum = 0, scored = 0;
  for (let i = 0; i < queries.length; i++) {
    const terms = contentWords(queries[i]);
    if (terms.length === 0) continue;
    const t = Math.max(coverage(terms, titleLower), h1 ? coverage(terms, h1.textLower) : 0);
    if (t > bestTitle) bestTitle = t;
    headingSum += coverage(terms, headingText);
    bodySum += coverage(terms, bodyLower);
    scored++;
  }

  if (scored === 0) {
    return [
      skip("title-query-alignment", "No usable terms in the target queries"),
      skip("query-terms-in-headings", "No usable terms in the target queries"),
      skip("query-terms-in-body", "No usable terms in the target queries"),
    ];
  }

  const bestHeadings = headingSum / scored;
  const bestBody = bodySum / scored;

  const titlePts = tieredScore(bestTitle, TITLE_ALIGNMENT_TIERS);
  return [
    score("title-query-alignment", titlePts, titlePts > 0, Math.round(bestTitle) + "% of query terms in the title"),
    score("query-terms-in-headings", tieredScore(bestHeadings, HEADING_QUERY_TIERS), bestHeadings >= 50, Math.round(bestHeadings) + "% coverage"),
    score("query-terms-in-body", tieredScore(bestBody, BODY_QUERY_TIERS), bestBody >= 80, Math.round(bestBody) + "% coverage"),
  ];
}

function pillar2(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const per1k = p.wordCount > 0 ? 1000 / p.wordCount : 0;
  const statDensity = p.stats.length * per1k;
  const out: CriterionResult[] = [];

  const dPts = tieredScore(statDensity, STAT_DENSITY_TIERS);
  out.push(score("statistic-density", dPts, dPts > 0, p.stats.length + " statistics (" + statDensity.toFixed(1) + " per 1,000 words)"));

  // The naked-stat penalty lives HERE, as the sourcing guard — not as a second
  // criterion counting the same thing from the other end. Scoring "sourced
  // ratio" as a reward AND "naked count" as a penalty would be AuthorityOn's
  // FAQ double-count wearing a different hat.
  if (p.stats.length === 0) {
    out.push(skip("stat-source-adjacency", "No statistics to source"));
  } else {
    let naked = 0;
    for (let i = 0; i < p.stats.length; i++) if (!p.stats[i].sourced) naked++;
    const nakedPct = (naked / p.stats.length) * 100;
    const pts = tieredScore(nakedPct, NAKED_STAT_TIERS);
    out.push(score("stat-source-adjacency", pts, naked === 0,
      naked === 0 ? "all " + p.stats.length + " sourced" : naked + " of " + p.stats.length + " statistics have no source in the sentence"));
  }

  let attributed = 0;
  for (let i = 0; i < p.quotes.length; i++) if (p.quotes[i].attributed) attributed++;
  const qPts = attributed >= 2 ? 10 : attributed === 1 ? 6 : 0;
  out.push(score("attributed-quotes", qPts, attributed > 0, attributed + " attributed quotation" + (attributed === 1 ? "" : "s")));

  const brand = (input.brandName || "").toLowerCase();
  const hosts: string[] = [];
  for (let i = 0; i < p.links.length; i++) {
    const l = p.links[i];
    if (!l.external) continue;
    if (brand && l.host.indexOf(brand.replace(/\s+/g, "")) >= 0) continue;
    if (/(?:twitter|x|facebook|linkedin|instagram)\.com$/.test(l.host)) continue;
    if (hosts.indexOf(l.host) < 0) hosts.push(l.host);
  }
  const linkDensity = hosts.length * per1k;
  const lPts = tieredScore(linkDensity, EXTERNAL_LINK_TIERS);
  out.push(score("external-reference-links", lPts, lPts > 0, hosts.length + " unique source domain" + (hosts.length === 1 ? "" : "s")));

  return out;
}

function definitionSentences(p: ParsedDraft, candidates: string[]): { text: string; start: number; head: string }[] {
  const found: { text: string; start: number; head: string }[] = [];
  for (let s = 0; s < p.sentences.length; s++) {
    const sent = p.sentences[s];
    if (sent.kind === "heading") continue;
    if (sent.wordCount < 8) continue;
    for (let c = 0; c < candidates.length; c++) {
      const cand = candidates[c].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!cand) continue;
      const re = new RegExp("\\b" + cand + "\\b\\s+(?:is|are)\\s+(?:a|an|the)\\s+([a-z-]+(?:\\s+[a-z-]+)?)", "i");
      const m = sent.text.match(re);
      if (m) { found.push({ text: sent.text, start: sent.start, head: m[1].toLowerCase() }); break; }
    }
  }
  return found;
}

function entityCandidates(input: DraftInput): string[] {
  const out: string[] = [];
  if (input.brandName) out.push(input.brandName);
  const aliases = input.brandAliases || [];
  for (let i = 0; i < aliases.length; i++) out.push(aliases[i]);
  const queries = input.targetQueries || [];
  for (let i = 0; i < queries.length; i++) {
    const cw = contentWords(queries[i]);
    if (cw.length > 0) out.push(cw.join(" "));
  }
  return out;
}

function pillar3(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const out: CriterionResult[] = [];
  const queries = input.targetQueries || [];
  const candidates = entityCandidates(input);
  const defs = definitionSentences(p, candidates);

  // Answer-first. The tier cliff sits at 30% because that is where the
  // observational evidence sits: 44.2% of ~400M citations were extracted from
  // the first 30% of a page.
  const qualifies = function (fraction: number): boolean {
    const slice = sliceByWords(p, fraction);
    for (let i = 0; i < slice.length; i++) {
      const s = slice[i];
      if (s.kind !== "prose") continue;
      if (/\?\s*$/.test(s.text)) continue;
      for (let q = 0; q < queries.length; q++) {
        const terms = contentWords(queries[q]);
        if (terms.length > 0 && coverage(terms, s.text.toLowerCase()) >= 50) return true;
      }
      for (let d = 0; d < defs.length; d++) if (defs[d].start >= s.start && defs[d].start <= s.end) return true;
      for (let st = 0; st < p.stats.length; st++) if (p.stats[st].start >= s.start && p.stats[st].start < s.end) return true;
    }
    return false;
  };
  const afPts = qualifies(0.10) ? 20 : qualifies(0.20) ? 10 : qualifies(0.30) ? 5 : 0;
  out.push(score("answer-first-position", afPts, afPts >= 20,
    afPts === 20 ? "answer lands in the first 10%" : afPts > 0 ? "answer lands late" : "no answer-bearing sentence found early"));

  // TL;DR. AuthorityOn matched its summary keywords ANYWHERE in site text,
  // which at article scale would award this to "in conclusion" in the closing
  // paragraph — precisely the shape answer-first exists to discourage. Hence
  // the position requirement, and hence those two markers are not in the list.
  const earlyBlocks = Math.max(1, Math.ceil(p.blocks.length * 0.30));
  let tldr = 0;
  for (let i = 0; i < Math.min(earlyBlocks, p.blocks.length); i++) {
    const bLower = p.blocks[i].text.toLowerCase();
    if (containsAny(bLower, SUMMARY_MARKERS) > 0) {
      let followed = false;
      for (let j = i + 1; j <= Math.min(i + 3, p.blocks.length - 1); j++) {
        if (p.blocks[j].kind === "listItem") { followed = true; break; }
        if (p.blocks[j].kind === "prose" && (p.blocks[j].text.match(/\S+/g) || []).length <= 80) { followed = true; break; }
      }
      tldr = followed ? 10 : 5;
      break;
    }
  }
  if (tldr === 0) {
    const anyMarker = containsAny(p.text.toLowerCase(), SUMMARY_MARKERS) > 0;
    if (anyMarker) tldr = 5;
  }
  out.push(score("tldr-block", tldr, tldr === 10, tldr === 10 ? "present near the top" : tldr === 5 ? "present but not positioned early" : "none found"));

  // Question headings. AuthorityOn wanted 25 raw question marks for full marks
  // across concatenated SITE text — the poster child for recalibration. Here it
  // counts question-shaped HEADINGS, the structural unit extraction matches.
  const sectionHeads = p.headings.filter(function (h) { return h.level === 2 || h.level === 3; });
  const qHeads = sectionHeads.filter(function (h) { return h.isInterrogativeShaped; });
  const ratio = sectionHeads.length > 0 ? qHeads.length / sectionHeads.length : 0;
  const qhPts = (qHeads.length >= 3 || (qHeads.length >= 2 && ratio >= 0.3)) ? 10 : qHeads.length === 2 ? 7 : qHeads.length === 1 ? 4 : 0;
  out.push(score("question-headings", qhPts, qhPts >= 10, qHeads.length + " of " + sectionHeads.length + " headings are question-shaped"));

  if (qHeads.length === 0) {
    out.push(skip("heading-answer-adjacency", "No question headings to answer"));
  } else {
    let answered = 0;
    for (let i = 0; i < qHeads.length; i++) {
      const h = qHeads[i];
      const chunk = p.chunks.filter(function (c) { return c.heading && c.heading.blockIndex === h.blockIndex; })[0];
      if (!chunk) continue;
      const headWords = contentWords(h.text);
      const firstTwo = chunk.firstTwoSentences;
      for (let s = 0; s < firstTwo.length; s++) {
        const sent = firstTwo[s];
        if (sent.wordCount > 35) continue;
        if (/\?\s*$/.test(sent.text)) continue;
        let shares = false;
        const sLower = sent.text.toLowerCase();
        for (let w = 0; w < headWords.length; w++) {
          if (headWords[w].length >= 4 && termPresent(sLower, headWords[w])) { shares = true; break; }
        }
        if (shares) { answered++; break; }
      }
    }
    const pct = (answered / qHeads.length) * 100;
    out.push(score("heading-answer-adjacency", tieredScore(pct, HEADING_ANSWER_TIERS), answered === qHeads.length,
      answered + " of " + qHeads.length + " answered within two sentences"));
  }

  if (candidates.length === 0) {
    out.push(skip("extractable-definition", "No brand or target query to define"));
  } else {
    let earlyDef = false;
    const cut = p.words.length > 0 ? p.words[Math.max(0, Math.ceil(p.words.length * 0.40) - 1)].end : 0;
    for (let i = 0; i < defs.length; i++) if (defs[i].start <= cut) earlyDef = true;
    const dPts = earlyDef ? 10 : defs.length > 0 ? 6 : 0;
    out.push(score("extractable-definition", dPts, dPts === 10,
      dPts === 10 ? "defined in the first 40%" : dPts === 6 ? "defined, but late" : "no definition found"));
  }

  return out;
}

const PRONOUN_OPEN = /^\s*(?:and|but|so|yet|however,?|that said,?|of course,?)?\s*(it|they|them|their|its|he|she|his|her|we|our|us|there)\b/i;
const BARE_DEFINITE = /^\s*the\s+(company|tool|platform|product|service|team|brand|app|solution|software|firm|agency|organisation|organization|business|vendor|provider)\b/i;
/**
 * Demonstratives count only with no nominal head after them. "This is why
 * retainers fail" is the defect; "This framework replaced the old one" is a
 * determiner doing its job. A flat /^(this|that)\b/ flags both and teaches
 * writers to write worse to satisfy the tool.
 */
const DEMONSTRATIVE_OPEN = /^\s*(this|that|these|those)\s*(?:[,.;:]|(?:is|are|was|were|means|makes|gives|shows|can|will|would|should|has|have|had|do|does|did)\b)/i;

function opensWithPronoun(c: Chunk): boolean {
  if (!c.firstSentence) return false;
  const t = c.firstSentence.text;
  return PRONOUN_OPEN.test(t) || BARE_DEFINITE.test(t) || DEMONSTRATIVE_OPEN.test(t);
}

function pillar4(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const out: CriterionResult[] = [];
  const candidates = entityCandidates(input);
  const bodyLower = p.text.toLowerCase();

  const scored = p.chunks.filter(function (c) { return !c.isEmpty; });
  let offending = 0;
  for (let i = 0; i < scored.length; i++) if (opensWithPronoun(scored[i])) offending++;
  out.push(score("pronoun-opening-chunks", tieredScore(offending, PRONOUN_OPEN_TIERS), offending === 0,
    offending === 0 ? "every section names its subject" : offending + " section" + (offending === 1 ? "" : "s") + " open on a pronoun"));

  // Known aliases only. Detecting UNKNOWN variants (misspellings, unregistered
  // nicknames) needs NER and belongs to the judge — the methodology page must
  // say so rather than implying this catches every drift.
  const forms: string[] = [];
  if (input.brandName) forms.push(input.brandName);
  const aliases = input.brandAliases || [];
  for (let i = 0; i < aliases.length; i++) forms.push(aliases[i]);
  if (forms.length === 0) {
    out.push(skip("canonical-name-consistency", "No brand name supplied"));
  } else {
    let present = 0;
    for (let i = 0; i < forms.length; i++) if (countTerm(bodyLower, forms[i].toLowerCase()) > 0) present++;
    if (present === 0) {
      out.push(skip("canonical-name-consistency", "Brand is not mentioned in the draft"));
    } else {
      out.push(score("canonical-name-consistency", tieredScore(present, NAME_DRIFT_TIERS), present <= 2,
        present + " distinct name form" + (present === 1 ? "" : "s") + " in use"));
    }
  }

  if (candidates.length === 0) {
    out.push(skip("chunk-entity-naming", "No brand or target query to name"));
  } else {
    let named = 0;
    for (let i = 0; i < scored.length; i++) {
      const first2 = scored[i].firstTwoSentences.map(function (s) { return s.text; }).join(" ").toLowerCase();
      let hit = false;
      for (let c = 0; c < candidates.length; c++) {
        const cw = contentWords(candidates[c]);
        for (let w = 0; w < cw.length; w++) {
          if (cw[w].length >= 4 && termPresent(first2, cw[w])) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) named++;
    }
    const pct = scored.length > 0 ? (named / scored.length) * 100 : 0;
    out.push(score("chunk-entity-naming", tieredScore(pct, CHUNK_NAMING_TIERS), pct >= 80,
      named + " of " + scored.length + " sections name their subject"));
  }

  const defs = definitionSentences(p, candidates);
  if (defs.length === 0) {
    out.push(skip("entity-defined-once", "No definition to check"));
  } else {
    const heads: string[] = [];
    for (let i = 0; i < defs.length; i++) if (heads.indexOf(defs[i].head) < 0) heads.push(defs[i].head);
    out.push(score("entity-defined-once", tieredScore(heads.length, DEFINITION_DRIFT_TIERS), heads.length <= 2,
      heads.length === 1 ? "one consistent definition" : heads.length + " competing definitions"));
  }

  return out;
}

function pillar5(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const out: CriterionResult[] = [];

  if (input.unattributed) {
    return [
      skip("byline-present", "Piece is declared unattributed"),
      skip("credential-line", "Piece is declared unattributed"),
      skip("experience-markers", "Piece is declared unattributed"),
      skip("worked-example", "Piece is declared unattributed"),
    ];
  }

  // Zone-restricted, unlike AuthorityOn's bare /by [A-Z][a-z]+ [A-Z]/ over all
  // site text — which matched "by Google Analytics" mid-sentence.
  const earlyBlocks = Math.max(1, Math.ceil(p.blocks.length * 0.15));
  const lateFrom = Math.floor(p.blocks.length * 0.85);
  let bylineBlock = -1;
  for (let i = 0; i < p.blocks.length; i++) {
    const inZone = i < earlyBlocks || i >= lateFrom;
    if (!inZone) continue;
    if (AUTHOR_LINE_PATTERN.test(p.blocks[i].text)) { bylineBlock = i; break; }
    if (input.authorName && countTerm(p.blocks[i].text.toLowerCase(), input.authorName.toLowerCase()) > 0) { bylineBlock = i; break; }
  }
  const metadataOnly = bylineBlock < 0 && !!input.authorName;
  const bPts = bylineBlock >= 0 ? 10 : metadataOnly ? 5 : 0;
  out.push(score("byline-present", bPts, bPts === 10,
    bPts === 10 ? "byline in the article body" : bPts === 5 ? "author known to the CMS but not in the text" : "no byline"));

  if (bPts === 0) {
    out.push(skip("credential-line", "No byline to attach credentials to"));
  } else {
    // The byline BLOCK ITSELF is excluded from the search. "By Dr. Ilse
    // Brandt" contains "Dr." which the role-title pattern matches, so
    // including it awarded full credential marks to every honorific byline —
    // deleting the whole credential line changed nothing. A credential LINE is
    // by definition a line other than the byline.
    let near = "";
    if (bylineBlock >= 0) {
      for (let i = bylineBlock + 1; i <= Math.min(p.blocks.length - 1, bylineBlock + 2); i++) near += " " + p.blocks[i].text;
      for (let i = lateFrom; i < p.blocks.length; i++) if (i !== bylineBlock) near += " " + p.blocks[i].text;
    }
    const nearLower = near.toLowerCase();
    const hasNear = containsAny(nearLower, CREDENTIAL_KEYWORDS) > 0 || ROLE_TITLE_PATTERN.test(near) || YEARS_EXPERIENCE_PATTERN.test(near);
    const anywhere = containsAny(p.text.toLowerCase(), CREDENTIAL_KEYWORDS) >= 2;
    const cPts = hasNear ? 10 : anywhere ? 5 : 0;
    out.push(score("credential-line", cPts, cPts === 10,
      cPts === 10 ? "credentials shown with the byline" : cPts === 5 ? "credential words present but not with the byline" : "no credentials"));
  }

  const per1k = p.wordCount > 0 ? 1000 / p.wordCount : 0;
  let markerHits = 0;
  const lower = p.text.toLowerCase();
  for (let i = 0; i < EXPERIENCE_MARKERS.length; i++) markerHits += countTerm(lower, EXPERIENCE_MARKERS[i]);
  const mDensity = markerHits * per1k;
  const ePts = mDensity >= 2 ? 10 : mDensity >= 1 ? 6 : markerHits >= 1 ? 3 : 0;
  out.push(score("experience-markers", ePts, ePts >= 6, markerHits + " first-hand marker" + (markerHits === 1 ? "" : "s")));

  let strong = 0, weak = 0;
  for (let i = 0; i < WORKED_EXAMPLE_STRONG.length; i++) if (countTerm(lower, WORKED_EXAMPLE_STRONG[i]) > 0) strong++;
  for (let i = 0; i < WORKED_EXAMPLE_WEAK.length; i++) if (countTerm(lower, WORKED_EXAMPLE_WEAK[i]) > 0) weak++;
  const wPts = (strong >= 1 && strong + weak >= 2) ? 10 : strong === 1 ? 6 : weak >= 2 ? 3 : 0;
  out.push(score("worked-example", wPts, wPts >= 6, strong + " strong / " + weak + " weak example markers"));

  return out;
}

function pillar6(p: ParsedDraft, input: DraftInput, now: Date): CriterionResult[] {
  const out: CriterionResult[] = [];
  const currentYear = now.getFullYear();
  const per1k = p.wordCount > 0 ? 1000 / p.wordCount : 0;
  const lower = p.text.toLowerCase();

  // Dateline. AuthorityOn scored the VOLUME of year strings; on one article
  // that is history, not freshness. One accurate dateline is what an engine
  // actually reads.
  let resolved: Date | null = null;
  if (input.publishedDate) {
    const d = new Date(input.publishedDate);
    if (!isNaN(d.getTime())) resolved = d;
  }
  if (!resolved) {
    const zone = p.blocks.slice(0, Math.max(1, Math.ceil(p.blocks.length * 0.15))).map(function (b) { return b.text; }).join(" ");
    const m = zone.match(/\b(\d{1,2}\s+[A-Z][a-z]+\s+(?:19|20)\d{2}|[A-Z][a-z]+\s+\d{1,2},?\s+(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/);
    if (m) {
      const d = new Date(m[1]);
      if (!isNaN(d.getTime())) resolved = d;
    }
  }
  let dPts = 0, dNote = "no dateline";
  if (resolved) {
    const days = Math.floor((now.getTime() - resolved.getTime()) / 86400000);
    dPts = days <= 90 ? 10 : days <= 365 ? 6 : 2;
    dNote = days <= 90 ? "updated within 90 days" : days + " days old";
  }
  out.push(score("dateline-recency", dPts, dPts === 10, dNote));

  // A stale CLAIM, not a stale mention. "founded in 2019" is history and must
  // not be flagged; "as of 2023" in a 2026 draft is a self-declared expiry date.
  let staleClaims = 0;
  for (let s = 0; s < p.sentences.length; s++) {
    const sent = p.sentences[s];
    const years = sent.text.match(/\b(?:19|20)\d{2}\b/g);
    if (!years) continue;
    let hasOld = false;
    for (let y = 0; y < years.length; y++) if (parseInt(years[y], 10) <= currentYear - 2) hasOld = true;
    if (!hasOld) continue;
    if (containsAny(sent.text.toLowerCase(), CURRENCY_PHRASES) > 0) staleClaims++;
  }
  out.push(score("stale-year-guard", tieredScore(staleClaims, STALE_YEAR_TIERS), staleClaims === 0,
    staleClaims === 0 ? "no stale currency claims" : staleClaims + " stale 'as of' claim" + (staleClaims === 1 ? "" : "s")));

  if (p.stats.length === 0) {
    out.push(skip("current-year-stats", "No statistics to date"));
  } else {
    let dated = false;
    for (let i = 0; i < p.stats.length; i++) {
      const sent = p.sentences[p.stats[i].sentenceIndex];
      if (!sent) continue;
      if (sent.text.indexOf(String(currentYear)) >= 0 || sent.text.indexOf(String(currentYear - 1)) >= 0) { dated = true; break; }
    }
    out.push(score("current-year-stats", dated ? 5 : 0, dated, dated ? "statistics anchored to a current year" : "no statistic carries a current year"));
  }

  const prose = p.sentences.filter(function (s) { return s.kind === "prose" && s.wordCount >= 3; });
  let totalWords = 0;
  for (let i = 0; i < prose.length; i++) totalWords += prose[i].wordCount;
  const mean = prose.length > 0 ? totalWords / prose.length : 0;
  const sPts = (mean >= 14 && mean <= 22) ? 5 : ((mean >= 11 && mean < 14) || (mean > 22 && mean <= 28)) ? 3 : 0;
  out.push(score("sentence-length-norm", sPts, sPts === 5, "mean " + mean.toFixed(1) + " words"));

  // Comparative format. Skipped, not failed, outside comparative intent — the
  // 63%-of-citations finding is intent-confounded, and nudging every explainer
  // toward listicle formatting is the formatting-without-substance failure the
  // anti-checklist names.
  let comparative = /(?:ranked|comparison|list)/i.test(input.format || "");
  const queries = input.targetQueries || [];
  for (let i = 0; i < queries.length; i++) if (COMPARATIVE_QUERY_PATTERN.test(queries[i])) comparative = true;
  if (!comparative) {
    out.push(skip("comparative-format-match", "Target intent is not comparative"));
  } else {
    const full = p.hasTable || (p.hasOrderedList && p.listItemCount >= 3);
    const partial = p.hasUnorderedList && p.listItemCount >= 3;
    const cPts = full ? 10 : partial ? 6 : 0;
    out.push(score("comparative-format-match", cPts, cPts === 10,
      full ? "ranked list or table present" : partial ? "unordered list only" : "no list or table"));
  }

  const hier = validateHeadingHierarchy(p.headings, !!input.title);
  const sectionHeads = p.headings.filter(function (h) { return h.level === 2 || h.level === 3; });
  let hierScore = hier.score;
  let hierNote = hier.issues.length === 0 ? "clean" : hier.issues.map(function (i) { return i.detail; }).slice(0, 2).join("; ");
  // Article-scale addition: under the original, a structureless 2,000-word wall
  // scored 12/15 on hierarchy alone. Indefensible for an article.
  if (p.wordCount >= 600 && sectionHeads.length === 0) {
    hierScore = Math.max(0, hierScore - 3);
    hierNote = "no subheadings in a long draft" + (hier.issues.length ? "; " + hierNote : "");
  }
  out.push(score("heading-hierarchy", hierScore, hierScore === 15, hierNote));

  const density = sectionHeads.length * per1k;
  const hdPts = (density >= 2 && density <= 8) ? 5 : ((density >= 1 && density < 2) || (density > 8 && density <= 12)) ? 3 : 0;
  out.push(score("heading-density", hdPts, hdPts === 5, density.toFixed(1) + " headings per 1,000 words"));

  // Stuffing. Brand tokens are excluded: entity naming is REWARDED in pillar 4,
  // and a rubric that rewards a signal in one place and punishes it in another
  // gives the writer no way to win.
  const brandTokens: { [k: string]: boolean } = {};
  const brandAll = [input.brandName || ""].concat(input.brandAliases || []);
  for (let i = 0; i < brandAll.length; i++) {
    const cw = contentWords(brandAll[i]);
    for (let w = 0; w < cw.length; w++) brandTokens[cw[w]] = true;
  }
  const freq: { [k: string]: number } = {};
  let maxTerm = "", maxCount = 0;
  for (let i = 0; i < p.words.length; i++) {
    const w = p.words[i].lower.replace(/[^a-z0-9'-]/g, "");
    if (w.length < 3 || STOP[w] || brandTokens[w]) continue;
    freq[w] = (freq[w] || 0) + 1;
    if (freq[w] > maxCount) { maxCount = freq[w]; maxTerm = w; }
  }
  const share = p.alphaWordCount > 0 ? (maxCount / p.alphaWordCount) * 100 : 0;
  let phrasePer100 = 0;
  for (let i = 0; i < queries.length; i++) {
    const occurrences = countTerm(lower, queries[i].toLowerCase());
    const rate = p.wordCount > 0 ? (occurrences / p.wordCount) * 100 : 0;
    if (rate > phrasePer100) phrasePer100 = rate;
  }
  const stuffPts = (share <= 2.5 && phrasePer100 <= 0.8) ? 10 : (share <= 4 && phrasePer100 <= 1.2) ? 5 : 0;
  out.push(score("keyword-stuffing-guard", stuffPts, stuffPts === 10,
    stuffPts === 10 ? "natural term distribution" : "'" + maxTerm + "' is " + share.toFixed(1) + "% of all words"));

  let tells = 0;
  for (let i = 0; i < AI_TELL_TERMS.length; i++) tells += countTerm(lower, AI_TELL_TERMS[i]);
  const notJust = p.text.match(new RegExp(NOT_JUST_PATTERN.source, NOT_JUST_PATTERN.flags));
  if (notJust) tells += notJust.length;
  // Em-dash OVERAGE, not presence: em-dashes are legitimate typography. One per
  // 1,000 words passes clean; AI drafts routinely run 4-6.
  const emDashes = (p.text.match(/—/g) || []).length;
  const emOverage = Math.max(0, emDashes * per1k - 1);
  const tellDensity = tells * per1k + emOverage;
  out.push(score("ai-tell-guard", tieredScore(tellDensity, AI_TELL_TIERS), tellDensity === 0,
    tells === 0 && emOverage === 0 ? "clean" : tells + " tell" + (tells === 1 ? "" : "s") + (emOverage > 0 ? ", em-dashes over norm" : "")));

  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────

/**
 * Renormalises per pillar as earned/applicableMax*100 — NOT Math.min(100, sum).
 * AuthorityOn used the cap with inconsistent category maxima (85-125 points),
 * so a perfect draft in its Clarity category could only ever reach 85. That is
 * fix (c) in the spec's porting note, and the verify script asserts it directly.
 */
export function computeDraftScores(input: DraftInput): DraftScores {
  const now = input.now || new Date();
  const p = parseDraft({ body: input.body, title: input.title });

  const byPillar: CriterionResult[][] = [
    pillar1(p, input), pillar2(p, input), pillar3(p, input),
    pillar4(p, input), pillar5(p, input), pillar6(p, input, now),
  ];

  const pillars: PillarScore[] = [];
  let weightedTotal = 0;
  let applicableWeightBp = 0;

  for (let i = 0; i < PILLARS.length; i++) {
    const meta = PILLARS[i];
    const criteria = byPillar[i];
    let earned = 0, max = 0;
    for (let c = 0; c < criteria.length; c++) {
      if (criteria[c].skipped) continue;
      earned += criteria[c].earned;
      max += criteria[c].maxPoints;
    }
    const s = max > 0 ? (earned / max) * 100 : 0;
    pillars.push({
      name: meta.name, score: Math.round(s * 100) / 100, grade: scoreToGrade(s),
      weight: meta.weightBp / TOTAL_BP, criteria: criteria,
    });
    // A pillar with every criterion skipped drops out of the weighting entirely
    // rather than scoring zero — a draft with no target query set has not
    // failed Relevance, it simply has not been asked the question yet.
    if (max > 0) {
      weightedTotal += s * meta.weightBp;
      applicableWeightBp += meta.weightBp;
    }
  }

  const overall = applicableWeightBp > 0 ? weightedTotal / applicableWeightBp : 0;

  let rEarned = 0, rMax = 0, cEarned = 0, cMax = 0;
  for (let i = 0; i < byPillar.length; i++) {
    for (let c = 0; c < byPillar[i].length; c++) {
      const cr = byPillar[i][c];
      if (cr.skipped) continue;
      if (cr.rollUp === "retrievability" || cr.rollUp === "both") { rEarned += cr.earned; rMax += cr.maxPoints; }
      if (cr.rollUp === "citability" || cr.rollUp === "both") { cEarned += cr.earned; cMax += cr.maxPoints; }
    }
  }

  return {
    overall: Math.round(overall * 100) / 100,
    grade: scoreToGrade(overall),
    retrievability: rMax > 0 ? Math.round((rEarned / rMax) * 10000) / 100 : 0,
    citability: cMax > 0 ? Math.round((cEarned / cMax) * 10000) / 100 : 0,
    pillars: pillars,
    rubricVersion: RUBRIC_VERSION,
  };
}

const TOTAL_BP = 10000;
