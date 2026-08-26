/**
 * The free annotation layer — highlights that appear as you type.
 *
 * WHY THIS EXISTS. The optimiser had inline highlights, but only the LLM judge
 * produced them, and the judge only runs when you press Assess. So a writer
 * opened an article, saw a score and a list of criteria, and no marks on the
 * text at all — the panel said "Sentence length: 6/10" and left them to go and
 * find the sentences themselves. Of 38 criteria, 8 could point at text and 30
 * could not, and the 30 were the free instant ones.
 *
 * The parser already knew. It tracks offsets for every sentence, statistic,
 * heading, quote and link; the engine was computing which of them were wrong
 * and then returning only a number. This turns that knowledge back into marks
 * on the page.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE JUDGE LAYER, and why both exist:
 *   - this one is deterministic, instant, free, and runs on every keystroke;
 *     it can only point at things that are mechanically true (this sentence is
 *     40 words, this figure has no source in its sentence)
 *   - the judge reads for meaning — whether an opening is quotable, whether an
 *     attribution is real — costs money, and runs on demand
 * Neither replaces the other. What was wrong was shipping only the second one.
 *
 * ANCHORING GOES THROUGH THE SAME PATH AS THE JUDGE'S, deliberately. It would
 * be more direct to convert offsets to editor positions, since we HAVE exact
 * offsets — but the quote/prefix/suffix anchoring in anchors.ts is the part
 * that has been mutation-proven against edits landing above a span, and having
 * two anchoring paths means the untested one rots. The offsets are used to cut
 * an exact quote and its context, which is strictly better input than the judge
 * gives it.
 */

import type { DraftScores } from "./types";
import type { HighlightFinding } from "./highlight-plugin";
import { criterionInLens, type Lens } from "./mark-policy";

/** Context either side of a quote, matching the anchors.ts convention. */
const CONTEXT_CHARS = 24;

/**
 * How loud each criterion's marks are.
 *
 * An unsourced statistic is HIGH because it is the one defect that reliably
 * stops an engine citing a passage — the whole point of the product. A long
 * sentence is low: real, worth fixing, not urgent, and there are usually
 * several.
 */
const SEVERITY: { [key: string]: "high" | "medium" | "low" } = {
  "stat-source-adjacency": "high",
  "anonymous-first-person-facts": "high",
  "unverifiable-superlatives": "medium",
  "promotional-claims": "medium",
  "placeholder-guard": "high",
  "person-name-consistency": "high",
  "attributed-quotes": "high",
  "current-year-stats": "medium",
  "answer-first-position": "high",
  "keyword-stuffing-guard": "medium",
  "ai-tell-guard": "medium",
  "pronoun-opening-chunks": "medium",
  "heading-answer-adjacency": "medium",
  "question-headings": "low",
  "sentence-length-norm": "low",
};

/**
 * What to tell the writer to DO.
 *
 * The ACTION only. Every one of these must make sense to a person who has never
 * heard of an answer engine, because under the plain lens that is exactly who
 * is reading it — a cover letter's forty-five-word sentence is worth splitting
 * on its own merits, and telling its author that "long sentences dilute the
 * chunk an engine would lift" is answering a question they did not ask.
 *
 * The engine-facing half of each of these strings moved to RATIONALE below and
 * is appended only under the engine lens. The check asserts that no string here
 * mentions engines, models, citation, retrieval or chunks — so the split cannot
 * quietly erode back.
 */
const REMEDY: { [key: string]: string } = {
  "stat-source-adjacency":
    "Name the source in the same sentence as the figure, not the one after it.",
  "ai-tell-guard":
    "Rewrite in your own register. These are the constructions that read as machine-written.",
  "question-headings":
    "Phrase the heading as the question a reader would actually ask.",
  "sentence-length-norm":
    "Split this into two.",
  "attributed-quotes":
    "Name who said it. A quotation with no speaker is decoration.",
  // Bound by the research's recommendation guardrails: never ask for a figure
  // without a source, and never propose a rewrite that strips the terms which
  // get the page retrieved — body-only optimisation measurably REDUCED
  // citation in the one end-to-end test that exists.
  "promotional-claims":
    "Say what you did, not what you offer. Replace the claim with the engagement behind it — who, what changed, over what period — using a figure you already hold; if you do not hold one, find and cite a source rather than asserting it.",
  "placeholder-guard":
    "Replace this with the real asset or cut the line. It is a production note, and it will be published exactly as written.",
  "person-name-consistency":
    "One of these spellings is a typo. Pick the correct one and use it everywhere.",
  "current-year-stats":
    "Date the figure — \"in 2026\" or \"as of August 2026\".",
  "answer-first-position":
    "Put a one-or-two-sentence direct answer here, before the scene-setting.",
  "keyword-stuffing-guard":
    "Vary the phrasing or cut repetitions. Past a threshold it reads as manipulation.",
  "pronoun-opening-chunks":
    "Name the subject in the first sentence.",
  "heading-answer-adjacency":
    "Answer the heading's question in the first sentence or two beneath it.",
  "anonymous-first-person-facts":
    "Name the brand in this sentence instead of \"we\".",
  "unverifiable-superlatives":
    "Cut it or substantiate it. Every unsupported superlative weakens the sentences around it.",
  "tldr-block":
    "Make each bullet a complete sentence carrying a figure or the brand name.",
  "dateline-recency":
    "Add a visible \"Updated\" date.",
};

/**
 * WHY it matters to an answer engine. Appended only under the engine lens.
 *
 * This is the half that was wrong on a cover letter. The finding "this sentence
 * is forty-five words" was correct there; "long sentences dilute the chunk an
 * engine would lift" was not, and a mark that is right for a reason the reader
 * cannot accept is a mark they learn to ignore.
 */
const RATIONALE: { [key: string]: string } = {
  "stat-source-adjacency":
    "Engines quote a sentence, not a paragraph, so a citation one sentence away is not attached to the number.",
  "ai-tell-guard":
    "They are the constructions models over-produce, and readers — and increasingly engines — discount them.",
  "question-headings":
    "Question-shaped headings match how people prompt, and the answer beneath becomes the extractable unit.",
  "sentence-length-norm":
    "Long sentences dilute the chunk an engine would lift, and the answer inside gets averaged away.",
  "attributed-quotes":
    "A named, credentialed speaker is what makes the passage citable as evidence.",
  "promotional-claims":
    "Keep the sentence and its terms: cutting it costs you the query words that get the page retrieved at all.",
  "person-name-consistency":
    "A model treats each spelling as a different person.",
  "current-year-stats":
    "Engines discount statistics they cannot date, and freshness is scored directly.",
  "answer-first-position":
    "Engines lift openings; an opening that defers the answer is an opening that never gets quoted.",
  "keyword-stuffing-guard":
    "Past a threshold, repetition is penalised rather than rewarded.",
  "pronoun-opening-chunks":
    "Sections are extracted alone — a reader landing here from a citation cannot resolve \"this\" or \"it\".",
  "heading-answer-adjacency":
    "The heading plus its immediate answer is the unit engines extract.",
  "anonymous-first-person-facts":
    "A model lifts the sentence, not the page — the fact travels, and whoever \"we\" is does not.",
  "unverifiable-superlatives":
    "Models decline to repeat unsourced superlatives.",
  "tldr-block":
    "A bullet a model can lift and quote alone is worth more than a teaser.",
  "dateline-recency":
    "Freshness is the strongest single signal in the rubric, and an engine cannot reward a date it cannot find.",
};

/**
 * The sentence a writer reads on a mark.
 *
 * Under the plain lens it stops at the action. Under the engine lens the
 * rationale follows it, because there the reader HAS asked how a machine reads
 * their page — that is what the surface is for.
 */
function explain(key: string, name: string, note: string | undefined, lens: Lens): string {
  const head = note ? `${name.split(" — ")[0]}: ${note}.` : `${name.split(" — ")[0]}.`;
  const parts = [head, REMEDY[key] || ""];
  if (lens === "engine" && RATIONALE[key]) parts.push(RATIONALE[key]);
  return parts.filter(Boolean).join(" ").trim();
}

/**
 * Turn the engine's spans into findings the highlight plugin can anchor.
 *
 * `text` must be the SAME string the spans index into — ParsedDraft.text. A
 * different derivation silently produces quotes that never match, and the
 * failure looks like "anchoring is broken" rather than "the wrong string was
 * passed".
 */
export function buildLiveFindings(
  scores: DraftScores,
  text: string,
  lens: Lens
): HighlightFinding[] {
  const out: HighlightFinding[] = [];
  if (!text) return out;

  for (let pi = 0; pi < scores.pillars.length; pi++) {
    const criteria = scores.pillars[pi].criteria;
    for (let ci = 0; ci < criteria.length; ci++) {
      const c = criteria[ci];
      if (!c.spans || !c.spans.length) continue;
      // The lens gate. criterionInLens fails CLOSED on an unregistered key —
      // an unclassified criterion is one nobody has decided about, and showing
      // it on the plain lens is how an engine mark finds its way back onto a
      // cover letter. The check asserts every span-emitting key is registered,
      // so failing closed can never quietly hide a real mark.
      if (!criterionInLens(c.key, lens)) continue;

      for (let si = 0; si < c.spans.length; si++) {
        const sp = c.spans[si];
        // Defend against an offset that does not describe this text. It means
        // the caller passed a string the spans were not computed from, and a
        // silently empty quote would anchor to nothing forever.
        if (sp.start < 0 || sp.end > text.length || sp.end <= sp.start) continue;
        const quote = text.slice(sp.start, sp.end);
        if (!quote.trim()) continue;

        out.push({
          // Stable across recomputes: same criterion, same offsets, same id, so
          // a dismissed issue stays dismissed while the writer edits elsewhere.
          id: `live:${c.key}:${sp.start}-${sp.end}`,
          criterion: c.key,
          severity: SEVERITY[c.key] || "low",
          quote,
          prefix: text.slice(Math.max(0, sp.start - CONTEXT_CHARS), sp.start),
          suffix: text.slice(sp.end, Math.min(text.length, sp.end + CONTEXT_CHARS)),
          explanation: explain(c.key, c.name, sp.note, lens),
          // Deterministic checks NEVER propose replacement prose. They know a
          // sentence is 40 words; they do not know what it should say. Offering
          // a one-click rewrite here would mean generating it, which is exactly
          // the model call this layer exists to avoid — and an invented
          // statistic in a client's copy is the worst failure this product has.
          suggestedEdit: null,
        });
      }
    }
  }
  return out;
}

/** True for findings this module produced, so the two layers can be told apart
 *  without a second field on HighlightFinding. */
export function isLiveFinding(f: { id: string }): boolean {
  return f.id.indexOf("live:") === 0;
}
