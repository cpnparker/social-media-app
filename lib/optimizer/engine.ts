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
  SUPERLATIVE_TERMS, SUPERLATIVE_TIERS, ANON_FACT_TIERS,
  CRITERIA, PILLARS, RUBRIC_VERSION, scoreToGrade, tieredScore,
  TITLE_ALIGNMENT_TIERS, HEADING_QUERY_TIERS, BODY_QUERY_TIERS,
  STAT_DENSITY_TIERS, NAKED_STAT_TIERS, EXTERNAL_LINK_TIERS,
  HEADING_ANSWER_TIERS, PRONOUN_OPEN_TIERS, NAME_DRIFT_TIERS,
  CHUNK_NAMING_TIERS, DEFINITION_DRIFT_TIERS, STALE_YEAR_TIERS, AI_TELL_TIERS,
  SUMMARY_MARKERS, CREDENTIAL_KEYWORDS, ROLE_TITLE_PATTERN, YEARS_EXPERIENCE_PATTERN,
  EXPERIENCE_MARKERS, WORKED_EXAMPLE_STRONG, WORKED_EXAMPLE_WEAK,
  BENEFIT_VERBS, GENERIC_BENEFICIARIES, TRANSFORMATION_NOUNS, PROMO_CLAIM_TIERS,
  PLACEHOLDER_RE, RECORD_CLAIM_RE, PRODUCTION_NOTE_WORDS,
  CURRENCY_PHRASES, AI_TELL_TERMS, NOT_JUST_PATTERN,
  AUTHOR_LINE_PATTERN, COMPARATIVE_QUERY_PATTERN, STOPWORDS,
} from "./rubric";
import { parseDraft, sliceByWords, countTerm, containsAny, sectionLevels, sentenceIsSourced } from "./parse";
import type { ParsedDraft, Chunk } from "./parse";
import { validateHeadingHierarchy } from "./heading-hierarchy";
import type { CriterionSpan, CriterionResult, DraftScores, PillarScore } from "./types";

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

function score(
  key: string,
  earned: number,
  passed: boolean,
  nameSuffix?: string,
  spans?: CriterionSpan[]
): CriterionResult {
  const m = META[key];
  if (!m) throw new Error("Unknown criterion key: " + key);
  return {
    key: m.key,
    name: nameSuffix ? m.name + " — " + nameSuffix : m.name,
    earned: earned, maxPoints: m.maxPoints, passed: passed,
    evidence: m.evidence, rollUp: m.rollUp,
    penalty: m.kind === "guard" ? true : undefined,
    // Spans are kept even when the criterion PASSES, and that is deliberate.
    // Several of these score an aggregate — sentence-length scores the mean —
    // and a draft can sit comfortably inside the band while containing one
    // fifty-word sentence. Suppressing the highlight because the average is
    // fine would hide the only thing on the page worth editing.
    //
    // The rule that keeps this from becoming wallpaper is upstream instead:
    // each criterion computes spans ONLY for individually bad items, so an
    // empty array means there is genuinely nothing to point at.
    spans: spans && spans.length ? spans.slice(0, MAX_SPANS_PER_CRITERION) : undefined,
  };
}

/**
 * Nobody edits fifty highlighted sentences. Past a handful the layer stops
 * being a to-do list and becomes wallpaper, so each criterion points at its
 * worst few and the panel keeps reporting the true count.
 */
const MAX_SPANS_PER_CRITERION = 8;

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
  // The sourcing demand applies to EVIDENTIAL statistics — percentages,
  // multipliers, currency, ratios, large counts — the figures that support an
  // answer. It does not apply to:
  //
  //  - countWithUnit measurements. "Each letter over 4 feet tall", "a 103-word
  //    excerpt", "14,000 pounds": dimensions of the subject being reported,
  //    where the article IS the primary source. On the founder's own draft the
  //    old rule flagged eight of these and zero of them needed a citation —
  //    while "10 times the compressive strength", the one claim that did, was
  //    not detected at all. They still count toward statistic DENSITY, because
  //    specificity is real; what they never carry is a sourcing debt.
  //  - stats inside quotations: the parser marks those sourced when the quote
  //    is attributed (the named speaker is the source), and an UNattributed
  //    quote's figure is the quote's problem, not the figure's — flagged once
  //    by attributed-quotes, not twice.
  const sourceable = p.stats.filter(function (st) { return st.kind !== "countWithUnit" && !st.inQuote; });
  if (sourceable.length === 0) {
    out.push(skip("stat-source-adjacency", "No evidential statistics to source"));
  } else {
    let naked = 0;
    // Highlight the STATISTIC, but describe the sentence — the fix is adding a
    // source beside the number, so pointing at the number is pointing at the
    // thing to change. This is the single most valuable free annotation the
    // tool has: an unsourced figure is what an engine refuses to cite.
    const nakedSpans: CriterionSpan[] = [];
    for (let i = 0; i < sourceable.length; i++) {
      if (sourceable[i].sourced) continue;
      naked++;
      nakedSpans.push({ start: sourceable[i].start, end: sourceable[i].end, note: "no source in this sentence" });
    }
    const nakedPct = (naked / sourceable.length) * 100;
    const pts = tieredScore(nakedPct, NAKED_STAT_TIERS);
    out.push(score("stat-source-adjacency", pts, naked === 0,
      naked === 0 ? "all " + sourceable.length + " sourced" : naked + " of " + sourceable.length + " evidential statistics have no source in the sentence",
      nakedSpans));
  }

  let attributed = 0;
  const unattributedQuotes: CriterionSpan[] = [];
  for (let i = 0; i < p.quotes.length; i++) {
    if (p.quotes[i].attributed) { attributed++; continue; }
    // Short quotes embedded mid-sentence — "with their refusal to stop at
    // 'Let's see if we can solve it,' and push to…" — are rhetorical
    // fragments, not evidence quotations. "Name who said it" is the wrong
    // advice there: the sentence around them already carries the actor, and
    // bolting a speaker onto a seven-word flourish makes the prose worse.
    // They still EARN credit when attributed; they are never flagged.
    if (p.quotes[i].wordCount < 10) continue;
    unattributedQuotes.push({ start: p.quotes[i].start, end: p.quotes[i].end, note: "no speaker named" });
  }
  const qPts = attributed >= 2 ? 10 : attributed === 1 ? 6 : 0;
  out.push(score("attributed-quotes", qPts, attributed > 0,
    attributed + " attributed quotation" + (attributed === 1 ? "" : "s"), unattributedQuotes));

  // Unverifiable superlatives. Every span is the exact term, so the writer
  // sees which word to cut; the fix is deletion or substantiation, never both.
  {
    const supSpans: CriterionSpan[] = [];
    let sup = 0;
    for (let i = 0; i < SUPERLATIVE_TERMS.length; i++) {
      const term = SUPERLATIVE_TERMS[i];
      const re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p.text)) !== null) {
        sup++;
        if (supSpans.length < 8) supSpans.push({ start: m.index, end: m.index + m[0].length, note: "unverifiable superlative" });
      }
    }
    // Record claims: a superlative with a verifiable scope, unsourced. "The
    // tallest and longest span of UHPC in North America" was the founder's
    // draft's strongest marketing sentence and the one claim no detector could
    // see — an engine will not repeat a record without a source. Sourced
    // record sentences are exempt: a verified record is what the rubric WANTS.
    for (let si = 0; si < p.sentences.length; si++) {
      const sent = p.sentences[si];
      if (sent.kind === "heading") continue;
      const rm = RECORD_CLAIM_RE.exec(sent.text);
      if (!rm) continue;
      if (sentenceIsSourced(sent.text)) continue;
      sup++;
      if (supSpans.length < 8) {
        supSpans.push({ start: sent.start + rm.index, end: sent.start + rm.index + rm[0].length, note: "a record claim with no one behind it — name who verified it" });
      }
    }
    out.push(score("unverifiable-superlatives", tieredScore(sup, SUPERLATIVE_TIERS), sup === 0,
      sup === 0 ? "no unverifiable superlatives" : sup + " superlative" + (sup === 1 ? "" : "s") + " with nothing behind " + (sup === 1 ? "it" : "them"),
      supSpans));
  }

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
  // When the answer is late or absent, point at the opening prose — the place
  // the writer must edit. Marking "where the answer is not" sounds odd until
  // you try to act on the alternative, which is a score and a hunt.
  const afSpans: CriterionSpan[] = [];
  if (afPts < 20) {
    for (let i = 0; i < p.sentences.length; i++) {
      const sen = p.sentences[i];
      if (sen.kind !== "prose") continue;
      afSpans.push({
        start: sen.start, end: sen.end,
        note: afPts > 0 ? "the answer lands later — it should be here" : "the opening should carry the answer, quotably",
      });
      break;
    }
  }
  out.push(score("answer-first-position", afPts, afPts >= 20,
    afPts === 20 ? "answer lands in the first 10%" : afPts > 0 ? "answer lands late" : "no answer-bearing sentence found early",
    afSpans));

  // TL;DR. AuthorityOn matched its summary keywords ANYWHERE in site text,
  // which at article scale would award this to "in conclusion" in the closing
  // paragraph — precisely the shape answer-first exists to discourage. Hence
  // the position requirement, and hence those two markers are not in the list.
  const earlyBlocks = Math.max(1, Math.ceil(p.blocks.length * 0.30));
  let tldr = 0;
  const tldrSpans: CriterionSpan[] = [];
  for (let i = 0; i < Math.min(earlyBlocks, p.blocks.length); i++) {
    const bLower = p.blocks[i].text.toLowerCase();
    if (containsAny(bLower, SUMMARY_MARKERS) > 0) {
      let followed = false;
      // Bullet QUALITY, not just presence: the TL;DR is the block a model
      // quotes when summarising the page, so each bullet must be a complete,
      // self-contained sentence — a row of three-word fragments is a table of
      // contents wearing a summary's clothes. SENTENCE-SHAPED is the whole
      // test, deliberately: the first version also demanded a figure or the
      // brand name in every bullet, which flagged a perfectly liftable
      // definitional bullet on the clean fixture — that is the number-
      // sprinkling nudge the anti-checklist bans, and substance already has
      // its own criteria. Weak bullets cap the criterion at 7 and are pointed
      // at individually.
      let bullets = 0, strong = 0;
      for (let j = i + 1; j <= Math.min(i + 8, p.blocks.length - 1); j++) {
        const blk = p.blocks[j];
        if (blk.kind !== "listItem") { if (bullets > 0) break; else continue; }
        bullets++;
        followed = true;
        if (bulletStandsAlone(blk.text)) strong++;
        else if (tldrSpans.length < 6) tldrSpans.push({ start: blk.start, end: blk.end, note: "not a self-contained sentence — a bullet a model can quote reads alone" });
      }
      if (!followed) {
        for (let j = i + 1; j <= Math.min(i + 3, p.blocks.length - 1); j++) {
          if (p.blocks[j].kind === "prose" && (p.blocks[j].text.match(/\S+/g) || []).length <= 80) { followed = true; break; }
        }
      }
      tldr = !followed ? 5 : bullets > 0 && strong < bullets ? 7 : 10;
      break;
    }
  }
  // ── RECOGNISED BY SHAPE, NOT BY ITS LABEL ─────────────────────────────
  //
  // The loop above requires a heading from SUMMARY_MARKERS — "tl;dr", "key
  // takeaways", "at a glance". A real article opening with a five-bullet
  // summary under the heading "Bullets:" therefore scored ZERO, "none found",
  // while the block sat at the top of the page carrying two figures and the
  // client name. Reported by the owner, who read it against a judge finding
  // about the same paragraph and quite reasonably called it contradictory
  // advice. It was not contradictory: one layer was right and this one was
  // blind.
  //
  // A takeaways block is a STRUCTURE — a short run of self-contained bullets
  // near the top — and the words above it are a label, not the thing. The
  // marker list stays as a supporting signal, because it is what recognises a
  // summary written as PROSE, which has no shape to detect.
  //
  // The discriminator against a table of contents is the one already used
  // above: TOC entries are three-word fragments, and a bullet a model can
  // quote is a complete sentence. A run that is mostly fragments does not
  // qualify here at all rather than scoring badly — a TOC is not a weak
  // summary, it is a different thing.
  if (tldr === 0) {
    const lines = bulletLinesNear(p.blocks as any, earlyBlocks);
    if (lines.length >= 3) {
      let strong = 0;
      const runSpans: CriterionSpan[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (bulletStandsAlone(lines[i].text)) strong++;
        else if (runSpans.length < 6) runSpans.push({ start: lines[i].start, end: lines[i].end, note: "not a self-contained sentence — a bullet a model can quote reads alone" });
      }
      // Three bullets and a clear majority carrying a sentence. Two is as often
      // a pair of links as a summary, and a bare majority is not a block anyone
      // would call a takeaway.
      if (strong / lines.length >= 0.6) {
        tldr = strong === lines.length ? 10 : 7;
        for (let k = 0; k < runSpans.length; k++) tldrSpans.push(runSpans[k]);
      }
    }
  }

  if (tldr === 0) {
    const anyMarker = containsAny(p.text.toLowerCase(), SUMMARY_MARKERS) > 0;
    if (anyMarker) tldr = 5;
  }
  out.push(score("tldr-block", tldr, tldr === 10,
    tldr === 10 ? "present near the top" : tldr === 7 ? "present, but some bullets cannot stand alone" : tldr === 5 ? "present but not positioned early" : "none found",
    tldrSpans));

  // Question headings. AuthorityOn wanted 25 raw question marks for full marks
  // across concatenated SITE text — the poster child for recalibration. Here it
  // counts question-shaped HEADINGS, the structural unit extraction matches.
  const secLv = sectionLevels(p.headings);
  const sectionHeads = p.headings.filter(function (h) { return h.level === secLv[0] || h.level === secLv[1]; });
  const qHeads = sectionHeads.filter(function (h) { return h.isInterrogativeShaped; });
  const ratio = sectionHeads.length > 0 ? qHeads.length / sectionHeads.length : 0;
  const qhPts = (qHeads.length >= 3 || (qHeads.length >= 2 && ratio >= 0.3)) ? 10 : qHeads.length === 2 ? 7 : qHeads.length === 1 ? 4 : 0;
  // Advisory spans only when the criterion is short of full marks. At 10/10
  // the remaining label headings are FINE — "Meet the experts" should stay a
  // label, and flagging it anyway put three pieces of noise on a draft that
  // had already earned the points. Under full marks, the spans show the
  // writer which headings could convert.
  const flatHeads = (qhPts >= 10 ? [] : sectionHeads
    .filter(function (h) { return !h.isInterrogativeShaped; }))
    .map(function (h): CriterionSpan {
      return { start: h.start, end: h.end, note: "not question-shaped" };
    });
  out.push(score("question-headings", qhPts, qhPts >= 10,
    qHeads.length + " of " + sectionHeads.length + " headings are question-shaped", flatHeads));

  if (qHeads.length === 0) {
    out.push(skip("heading-answer-adjacency", "No question headings to answer"));
  } else {
    let answered = 0;
    const unansweredHeads: CriterionSpan[] = [];
    for (let i = 0; i < qHeads.length; i++) {
      const h = qHeads[i];
      const chunk = p.chunks.filter(function (c) { return c.heading && c.heading.blockIndex === h.blockIndex; })[0];
      if (!chunk) continue;
      const headWords = contentWords(h.text);
      const firstTwo = chunk.firstTwoSentences;
      let thisAnswered = false;
      for (let s = 0; s < firstTwo.length; s++) {
        const sent = firstTwo[s];
        if (sent.wordCount > 35) continue;
        if (/\?\s*$/.test(sent.text)) continue;
        let shares = false;
        const sLower = sent.text.toLowerCase();
        for (let w = 0; w < headWords.length; w++) {
          if (headWords[w].length >= 4 && termPresent(sLower, headWords[w])) { shares = true; break; }
        }
        if (shares) { thisAnswered = true; break; }
      }
      if (thisAnswered) answered++;
      else unansweredHeads.push({ start: h.start, end: h.end, note: "the two sentences after this heading do not answer it" });
    }
    const pct = (answered / qHeads.length) * 100;
    out.push(score("heading-answer-adjacency", tieredScore(pct, HEADING_ANSWER_TIERS), answered === qHeads.length,
      answered + " of " + qHeads.length + " answered within two sentences", unansweredHeads));
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
const HERES_OPEN = /^\s*here['\u2019]s\s+(how|why|what|where|when)\b/i;
const DEMONSTRATIVE_OPEN = /^\s*(this|that|these|those)\s*(?:[,.;:]|(?:is|are|was|were|means|makes|gives|shows|can|will|would|should|has|have|had|do|does|did)\b)/i;

function opensWithPronoun(c: Chunk): boolean {
  if (!c.firstSentence) return false;
  const t = c.firstSentence.text;
  return PRONOUN_OPEN.test(t) || BARE_DEFINITE.test(t) || DEMONSTRATIVE_OPEN.test(t) || HERES_OPEN.test(t);
}

function pillar4(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const out: CriterionResult[] = [];
  const candidates = entityCandidates(input);
  const bodyLower = p.text.toLowerCase();

  const scored = p.chunks.filter(function (c) { return !c.isEmpty; });
  let offending = 0;
  const pronounOpeners: CriterionSpan[] = [];
  for (let i = 0; i < scored.length; i++) {
    if (!opensWithPronoun(scored[i])) continue;
    offending++;
    const fs = scored[i].firstSentence;
    if (fs) pronounOpeners.push({ start: fs.start, end: fs.end, note: "an extracted section starts here with no named subject" });
  }
  out.push(score("pronoun-opening-chunks", tieredScore(offending, PRONOUN_OPEN_TIERS), offending === 0,
    offending === 0 ? "every section names its subject" : offending + " section" + (offending === 1 ? "" : "s") + " open on a pronoun",
    pronounOpeners));

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


  // The same person spelled two ways. OUTSIDE the canonical-brand branch,
  // deliberately: the first version sat inside its double-else and silently
  // vanished for every draft with no brand configured — people have names
  // whether or not a brand does. Caught by a brandless fixture returning
  // null for the criterion, not by the set-equality check, whose own fixture
  // happens to carry a brand.
  // The same person spelled two ways. Capitalised bigrams sharing a first
  // name whose surnames sit ONE edit apart (and run five letters or longer,
  // so Bird and Bond remain two people) are one person with a typo — the
  // founder's own draft carried "Alexander Kitchin" in the body and
  // "Alexander Kitchn" in the man's own credits heading. The RARER spelling
  // is the flagged one: the majority is presumed correct.
  {
    const nameRe = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
    const byFirst: { [first: string]: { [last: string]: { count: number; spans: { start: number; end: number }[] } } } = {};
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(p.text)) !== null) {
      const fam = byFirst[nm[1]] || (byFirst[nm[1]] = {});
      const entry = fam[nm[2]] || (fam[nm[2]] = { count: 0, spans: [] });
      entry.count++;
      if (entry.spans.length < 4) entry.spans.push({ start: nm.index, end: nm.index + nm[0].length });
    }
    const editDistanceOne = function (a: string, b: string): boolean {
      if (a === b) return false;
      const la = a.length, lb = b.length;
      if (Math.abs(la - lb) > 1) return false;
      let i = 0, j = 0, edits = 0;
      while (i < la && j < lb) {
        if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la > lb) i++;
        else if (lb > la) j++;
        else { i++; j++; }
      }
      return edits + (la - i) + (lb - j) === 1;
    };
    const nameSpans: CriterionSpan[] = [];
    let variants = 0;
    for (const first in byFirst) {
      const lasts = Object.keys(byFirst[first]);
      for (let a = 0; a < lasts.length; a++) {
        for (let b = a + 1; b < lasts.length; b++) {
          if (lasts[a].length < 5 || lasts[b].length < 5) continue;
          if (!editDistanceOne(lasts[a], lasts[b])) continue;
          variants++;
          const ea = byFirst[first][lasts[a]], eb = byFirst[first][lasts[b]];
          const rare = ea.count <= eb.count ? ea : eb;
          const common = ea.count <= eb.count ? lasts[b] : lasts[a];
          for (let si = 0; si < rare.spans.length && nameSpans.length < 8; si++) {
            nameSpans.push({ start: rare.spans[si].start, end: rare.spans[si].end, note: 'spelled "' + first + " " + common + '" everywhere else' });
          }
        }
      }
    }
    out.push(score("person-name-consistency", variants === 0 ? 5 : 0, variants === 0,
      variants === 0 ? "every name spelled one way" : variants + " name" + (variants === 1 ? "" : "s") + " spelled two ways",
      nameSpans));
  }

  if (candidates.length === 0) {
    out.push(skip("chunk-entity-naming", "No brand or target query to name"));
  } else {
    let named = 0;
    // The failing sections carry SPANS on their openers. This criterion sat at
    // 0/10 on the founder's draft — "2 of 7 sections name their subject" —
    // while pointing at nothing, so the writer knew a number and not one place
    // to act on it. The span is the first sentence: naming the subject there
    // is the fix.
    const unnamedSpans: CriterionSpan[] = [];
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
      if (hit) { named++; continue; }
      const fs = scored[i].firstSentence;
      if (fs && unnamedSpans.length < 8) {
        unnamedSpans.push({ start: fs.start, end: fs.end, note: "this section opens without naming its subject — a lifted passage starts here with no anchor" });
      }
    }
    const pct = scored.length > 0 ? (named / scored.length) * 100 : 0;
    out.push(score("chunk-entity-naming", tieredScore(pct, CHUNK_NAMING_TIERS), pct >= 80,
      named + " of " + scored.length + " sections name their subject",
      pct >= 80 ? [] : unnamedSpans));
  }

  // Anonymous first-person facts: a statistic whose sentence says "we/our/us"
  // and never names the entity. The fact travels when a model lifts the
  // sentence; the brand does not. Experience-voice sentences are exempt —
  // pillar 5 rewards them, and a rubric must not argue with itself.
  if (candidates.length === 0) {
    out.push(skip("anonymous-first-person-facts", "No brand to check against"));
  } else if (p.stats.length === 0) {
    out.push(skip("anonymous-first-person-facts", "No statistics to attribute"));
  } else {
    const FIRST_PERSON = /\b(we|our|us)\b/i;
    let anon = 0;
    const anonSpans: CriterionSpan[] = [];
    const seenSent: { [k: number]: boolean } = {};
    for (let i = 0; i < p.stats.length; i++) {
      const si = p.stats[i].sentenceIndex;
      if (seenSent[si]) continue;
      seenSent[si] = true;
      const sent = p.sentences[si];
      if (!sent) continue;
      if (!FIRST_PERSON.test(sent.text)) continue;
      const sLower = sent.text.toLowerCase();
      let named = false;
      for (let c = 0; c < candidates.length; c++) {
        const cw = contentWords(candidates[c]);
        for (let w = 0; w < cw.length; w++) {
          if (cw[w].length >= 4 && termPresent(sLower, cw[w])) { named = true; break; }
        }
        if (named) break;
      }
      if (named) continue;
      if (containsAny(sLower, EXPERIENCE_MARKERS) > 0) continue;
      anon++;
      if (anonSpans.length < 8) {
        anonSpans.push({ start: sent.start, end: sent.end, note: "the fact is \"ours\" — a model lifting this sentence never learns whose" });
      }
    }
    out.push(score("anonymous-first-person-facts", tieredScore(anon, ANON_FACT_TIERS), anon === 0,
      anon === 0 ? "every fact-bearing sentence names its owner" : anon + " fact sentence" + (anon === 1 ? "" : "s") + " say \"we\" and never name the brand",
      anonSpans));
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


/**
 * Sentences that claim a benefit for the reader and offer nothing to back it.
 *
 * A CONJUNCTION of three tests, and the conjunction is the design. A brand
 * writing about itself says "we" in almost every paragraph, so self-reference
 * alone must never fire; and a sentence carrying a figure, a named source, a
 * first-hand marker or a named third party is making a claim it can support,
 * whatever verb it uses. Only the sentence that does the first two and none of
 * the third is promotional in the sense the research measured.
 */
function promotionalClaims(p: ParsedDraft, input: DraftInput): CriterionSpan[] {
  const brandTokens: string[] = [];
  if (input.brandName) brandTokens.push(input.brandName.toLowerCase());
  for (let i = 0; i < (input.brandAliases || []).length; i++) {
    brandTokens.push(String((input.brandAliases as string[])[i]).toLowerCase());
  }
  const spans: CriterionSpan[] = [];

  for (let i = 0; i < p.sentences.length; i++) {
    const sent = p.sentences[i];
    // Headings, pull quotes and table cells are not prose claims. Nor is
    // anything inside a quotation: rewording a named interviewee misquotes them.
    if (sent.kind !== "prose" && sent.kind !== "listItem") continue;
    const lower = sent.text.toLowerCase();

    // GATE A — the sentence talks about itself.
    let selfRef = /\b(we|our|ours)\b/i.test(sent.text);
    for (let b = 0; !selfRef && b < brandTokens.length; b++) {
      if (brandTokens[b] && countTerm(lower, brandTokens[b]) > 0) selfRef = true;
    }
    if (!selfRef) continue;

    // GATE B — it promises a benefit, either to a generic class of people or
    // as an abstract transformation.
    let verb = "";
    for (let v = 0; v < BENEFIT_VERBS.length; v++) {
      if (countTerm(lower, BENEFIT_VERBS[v]) > 0) { verb = BENEFIT_VERBS[v]; break; }
    }
    if (!verb) continue;
    const object =
      containsAny(lower, GENERIC_BENEFICIARIES) > 0 ? "a generic audience" :
      containsAny(lower, TRANSFORMATION_NOUNS) > 0 ? "an abstract outcome" : "";
    if (!object) continue;

    // GATE C — anything that substantiates it exempts the sentence.
    if (/[0-9]/.test(sent.text)) continue;
    if (sentenceIsSourced(sent.text)) continue;
    if (containsAny(lower, EXPERIENCE_MARKERS) > 0) continue;
    // A named third party, ignoring the sentence's first word and the brand's
    // own names — "Fine Concrete" substantiates, "Amrize" does not.
    const words = sent.text.split(/\s+/).slice(1);
    let namedThirdParty = false;
    for (let w = 0; w < words.length; w++) {
      const bare = words[w].replace(/[^A-Za-z-]/g, "");
      if (bare.length < 3 || !/^[A-Z]/.test(bare)) continue;
      if (brandTokens.indexOf(bare.toLowerCase()) >= 0) continue;
      namedThirdParty = true; break;
    }
    if (namedThirdParty) continue;

    spans.push({ start: sent.start, end: sent.end, note: `"${verb}" + ${object}, with nothing in the sentence behind it` });
    if (spans.length >= 8) break;
  }
  return spans;
}

function pillar5(p: ParsedDraft, input: DraftInput): CriterionResult[] {
  const out: CriterionResult[] = [];

  // Promotional load is scored FIRST and unconditionally. An unattributed
  // piece has no byline, which says nothing whatever about how promotional it
  // is — and ghost-written brand content is precisely what this check exists
  // for, so putting it after the early return would disable it on its main
  // audience.
  const promoSpans = promotionalClaims(p, input);
  const promoPer1k = promoSpans.length * (1000 / Math.max(1, p.wordCount));
  const promoResult = score("promotional-claims", tieredScore(promoPer1k, PROMO_CLAIM_TIERS), promoSpans.length === 0,
    promoSpans.length === 0
      ? "no evidence-free first-person claims"
      : `${promoSpans.length} first-person claim${promoSpans.length === 1 ? "" : "s"} with nothing behind ${promoSpans.length === 1 ? "it" : "them"}`,
    promoSpans);

  if (input.unattributed) {
    return [
      promoResult,
      skip("byline-present", "Piece is declared unattributed"),
      skip("credential-line", "Piece is declared unattributed"),
      skip("experience-markers", "Piece is declared unattributed"),
      skip("worked-example", "Piece is declared unattributed"),
    ];
  }
  out.push(promoResult);

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
    const DATE_RE = /\b(\d{1,2}\s+[A-Z][a-z]+\s+(?:19|20)\d{2}|[A-Z][a-z]+\s+\d{1,2},?\s+(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/g;
    // An "Updated" date beats the first date found. A page carrying both
    // "Published March 2025" and "Updated 19 August 2026" was being scored on
    // March — first-date-wins actively under-scored exactly the freshness
    // behaviour the rubric's one grade-A signal is supposed to reward.
    let first: Date | null = null;
    let updated: Date | null = null;
    let m: RegExpExecArray | null;
    while ((m = DATE_RE.exec(zone)) !== null) {
      const d = new Date(m[1]);
      if (isNaN(d.getTime())) continue;
      if (!first) first = d;
      const before = zone.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
      if (/(updated|modified|revised|reviewed)\b[^.]{0,20}$/.test(before) && (!updated || d > updated)) updated = d;
    }
    resolved = updated || first;
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

  // Dating applies to figures with a VINTAGE — percentages, multipliers,
  // currency, counts presented as evidence. A dimension does not decay: the
  // old rule's spans told the founder to date "4 feet" ("as of August 2026"),
  // which is advice nobody should ever see. Quoted figures are also out —
  // dating someone's spoken words is rewriting them.
  const datable = p.stats.filter(function (st) { return st.kind !== "countWithUnit" && !st.inQuote; });
  if (datable.length === 0) {
    out.push(skip("current-year-stats", "No datable statistics"));
  } else {
    let dated = false;
    for (let i = 0; i < datable.length; i++) {
      const sent = p.sentences[datable[i].sentenceIndex];
      if (!sent) continue;
      if (sent.text.indexOf(String(currentYear)) >= 0 || sent.text.indexOf(String(currentYear - 1)) >= 0) { dated = true; break; }
    }
    const undatedStats: CriterionSpan[] = [];
    if (!dated) {
      for (let i = 0; i < datable.length && undatedStats.length < 8; i++) {
        undatedStats.push({ start: datable[i].start, end: datable[i].end, note: "no year anywhere near it — engines discount undatable figures" });
      }
    }
    out.push(score("current-year-stats", dated ? 5 : 0, dated,
      dated ? "statistics anchored to a current year" : "no statistic carries a current year", undatedStats));
  }

  const prose = p.sentences.filter(function (s) { return s.kind === "prose" && s.wordCount >= 3; });
  let totalWords = 0;
  for (let i = 0; i < prose.length; i++) totalWords += prose[i].wordCount;
  const mean = prose.length > 0 ? totalWords / prose.length : 0;
  const sPts = (mean >= 14 && mean <= 22) ? 5 : ((mean >= 11 && mean < 14) || (mean > 22 && mean <= 28)) ? 3 : 0;
  // The criterion scores the MEAN, but a writer cannot edit a mean. Point at
  // the individual sentences pulling it up — sorted longest first, so the ones
  // worth splitting come before the ones that are merely long.
  // A sentence inside a quotation is someone's spoken words: "split this into
  // two" is an instruction to misquote a named interviewee, and three of the
  // six spans on the founder's draft pointed at exactly that. Quoted sentences
  // still count toward the mean — the score describes the text as an engine
  // chunks it — but the ACTIONABLE spans are the writer's own prose only.
  const inAnyQuote = function (x: { start: number; end: number }): boolean {
    for (let qi = 0; qi < p.quotes.length; qi++) {
      const q = p.quotes[qi];
      if (x.start < q.end && q.start < x.end) return true;
    }
    return false;
  };
  const longSentences = prose
    .filter(function (x) { return x.wordCount > 28 && !inAnyQuote(x); })
    .sort(function (a, b) { return b.wordCount - a.wordCount; })
    .map(function (x): CriterionSpan {
      return { start: x.start, end: x.end, note: x.wordCount + " words" };
    });
  out.push(score("sentence-length-norm", sPts, sPts === 5, "mean " + mean.toFixed(1) + " words", longSentences));

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
  const secLv = sectionLevels(p.headings);
  const sectionHeads = p.headings.filter(function (h) { return h.level === secLv[0] || h.level === secLv[1]; });
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

  // Production placeholders. Five "[Professional headshot image]" notes rode
  // the founder's own draft into the scorer, scored as ordinary prose, and
  // would have been published verbatim. The regex is keyword-gated: "[sic]",
  // "[1]" and markdown's bracket-paren link shape never fire.
  {
    const phSpans: CriterionSpan[] = [];
    const phRe = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags);
    let ph: RegExpExecArray | null;
    while ((ph = phRe.exec(p.text)) !== null && phSpans.length < 8) {
      phSpans.push({ start: ph.index, end: ph.index + ph[0].length, note: "a production note, not prose — this publishes verbatim" });
    }
    // The unbracketed form: a tiny prose block that is a designer instruction
    // — "Web photo slideshow" stood as its own paragraph mid-article. Gated
    // three ways (own block, four words or fewer, no terminal punctuation) so
    // a legitimate kicker like "A new era." never fires.
    for (let bi = 0; bi < p.blocks.length && phSpans.length < 8; bi++) {
      const b = p.blocks[bi];
      if (b.kind !== "prose") continue;
      const bw = (b.text.match(/\S+/g) || []).length;
      if (bw === 0 || bw > 4) continue;
      if (/[.!?…]\s*$/.test(b.text.trim())) continue;
      if (containsAny(b.text.toLowerCase(), PRODUCTION_NOTE_WORDS) === 0) continue;
      phSpans.push({ start: b.start, end: b.end, note: "a production note standing as its own paragraph — this publishes verbatim" });
    }
    out.push(score("placeholder-guard", phSpans.length === 0 ? 5 : 0, phSpans.length === 0,
      phSpans.length === 0 ? "none found" : phSpans.length + " placeholder" + (phSpans.length === 1 ? "" : "s") + " left in the copy",
      phSpans));
  }

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
  const stuffedSpans: CriterionSpan[] = [];
  if (stuffPts < 10 && maxTerm) {
    // Mark the term's occurrences from the same word index the count came from,
    // so the marks and the percentage cannot disagree.
    for (let i = 0; i < p.words.length && stuffedSpans.length < 8; i++) {
      if (p.words[i].lower.replace(/[^a-z0-9'-]/g, "") === maxTerm) {
        stuffedSpans.push({ start: p.words[i].start, end: p.words[i].end, note: "'" + maxTerm + "' — " + share.toFixed(1) + "% of all words" });
      }
    }
  }
  out.push(score("keyword-stuffing-guard", stuffPts, stuffPts === 10,
    stuffPts === 10 ? "natural term distribution" : "'" + maxTerm + "' is " + share.toFixed(1) + "% of all words",
    stuffedSpans));

  let tells = 0;
  for (let i = 0; i < AI_TELL_TERMS.length; i++) tells += countTerm(lower, AI_TELL_TERMS[i]);
  const notJust = p.text.match(new RegExp(NOT_JUST_PATTERN.source, NOT_JUST_PATTERN.flags));
  if (notJust) tells += notJust.length;
  // Em-dash OVERAGE, not presence: em-dashes are legitimate typography. One per
  // 1,000 words passes clean; AI drafts routinely run 4-6.
  const emDashes = (p.text.match(/—/g) || []).length;
  const emOverage = Math.max(0, emDashes * per1k - 1);
  const tellDensity = tells * per1k + emOverage;
  // Locate each tell so the writer can see the actual word rather than a count.
  // Matched on the same word boundaries countTerm uses, or the highlight would
  // land on a substring the score never counted.
  const tellSpans: CriterionSpan[] = [];
  for (let i = 0; i < AI_TELL_TERMS.length; i++) {
    const term = AI_TELL_TERMS[i];
    const re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.text)) !== null) {
      tellSpans.push({ start: m.index, end: m.index + m[0].length, note: "AI tell" });
      if (tellSpans.length >= 40) break;
    }
    if (tellSpans.length >= 40) break;
  }
  if (notJust) {
    const njRe = new RegExp(NOT_JUST_PATTERN.source, NOT_JUST_PATTERN.flags.indexOf("g") >= 0 ? NOT_JUST_PATTERN.flags : NOT_JUST_PATTERN.flags + "g");
    let nm: RegExpExecArray | null;
    while ((nm = njRe.exec(p.text)) !== null && tellSpans.length < 48) {
      tellSpans.push({ start: nm.index, end: nm.index + nm[0].length, note: "\"not just\" construction" });
    }
  }
  tellSpans.sort(function (a, b) { return a.start - b.start; });
  out.push(score("ai-tell-guard", tieredScore(tellDensity, AI_TELL_TIERS), tellDensity === 0,
    tells === 0 && emOverage === 0 ? "clean" : tells + " tell" + (tells === 1 ? "" : "s") + (emOverage > 0 ? ", em-dashes over norm" : ""),
    tellSpans));

  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────

/**
 * Renormalises per pillar as earned/applicableMax*100 — NOT Math.min(100, sum).
 * AuthorityOn used the cap with inconsistent category maxima (85-125 points),
 * so a perfect draft in its Clarity category could only ever reach 85. That is
 * fix (c) in the spec's porting note, and the verify script asserts it directly.
 */
/**
 * Is this bullet one a model could lift and quote on its own?
 *
 * Length was the whole test, at eight words. That marked "Meta has open-sourced
 * the model on GitHub." — seven words, a complete sentence naming the entity —
 * as a "fragment", which is what the note actually claims about it and is
 * plainly untrue. The proxy was measuring length while the note promised
 * self-containment.
 *
 * A shorter run of words that is punctuated as a sentence qualifies. A table-of-
 * contents entry does not: "Introduction" has no terminal punctuation and four
 * words is the floor, so the discriminator that keeps a TOC out still holds.
 */
/**
 * The bullet lines near the top of a draft, wherever they came from.
 *
 * A real <li> is one source. The other — far more common in pasted work — is a
 * paragraph that simply BEGINS WITH A BULLET CHARACTER, which is what Word,
 * Google Docs and email produce when list markup does not survive the paste.
 * The reported document was exactly this: five `<p><strong>• …</strong></p>`
 * blocks and not one <li> on the page, so a detector keyed to list items saw
 * no bullets at all.
 *
 * A retrieval system reads the text, not the markup. If it looks like a bullet
 * to a reader it counts as one here — and the quality test that follows is what
 * decides whether the block is a takeaway or a table of contents.
 *
 * Lines, not blocks: a paste often puts the label and the first bullet in ONE
 * paragraph separated by a line break, so splitting on blocks alone loses the
 * first item.
 */
/**
 * True bullet glyphs, matched ANYWHERE in a block. A `<br>` between the label
 * and the first bullet parses to a SPACE, not a newline, so "Bullets: • Amrize
 * supplied…" arrives as one line and a line-start match loses the first item —
 * which on the reported document was the one naming the client.
 *
 * Deliberately excludes the hyphen and the dashes here: an em dash inside a
 * sentence ("standard, locally available materials — no exotic inputs") would
 * split a bullet in half. Hyphen bullets are still recognised, but only at the
 * START of a line, where they are unambiguous.
 */
const BULLET_GLYPH_ANY = /[•·▪‣◦]\s+/g;
const BULLET_LINE_START = /^\s*[-–—*]\s+/;

function bulletLinesNear(blocks: { kind: string; text: string; start: number; end: number }[], limit: number):
  { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < Math.min(limit, blocks.length); i++) {
    const blk = blocks[i];
    if (blk.kind === "listItem") {
      out.push({ text: blk.text, start: blk.start, end: blk.end });
      continue;
    }
    if (blk.kind !== "prose") continue;

    let matched = 0;
    // Glyph-delimited segments anywhere in the block. Everything before the
    // first glyph is a label, not a bullet, and is dropped.
    const parts = blk.text.split(BULLET_GLYPH_ANY);
    if (parts.length > 1) {
      for (let j = 1; j < parts.length; j++) {
        const t = parts[j].trim();
        if (!t) continue;
        matched++;
        // The span is the BLOCK's: a segment inside a paragraph has no separate
        // offset, and pointing at the block is honest where inventing a range
        // would not be.
        out.push({ text: t, start: blk.start, end: blk.end });
      }
    } else {
      const lines = blk.text.split(/\n+/);
      for (let j = 0; j < lines.length; j++) {
        if (!BULLET_LINE_START.test(lines[j])) continue;
        matched++;
        out.push({ text: lines[j].replace(BULLET_LINE_START, "").trim(), start: blk.start, end: blk.end });
      }
    }
    // A run ends at the first block contributing no bullet, once one has begun.
    if (matched === 0 && out.length > 0) break;
  }
  return out;
}

function bulletStandsAlone(text: string): boolean {
  const words = (text.match(/\S+/g) || []).length;
  if (words >= 8) return true;
  return words >= 4 && /[.!?]["')\]]?$/.test(text.trim());
}

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
