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

/** What to tell the writer to DO. The criterion name says what is wrong; this
 *  says what the fix is, because a highlight with no remedy is just criticism. */
const REMEDY: { [key: string]: string } = {
  "stat-source-adjacency":
    "Name the source in the same sentence as the figure. Engines quote a sentence, not a paragraph, so a citation one sentence away is not attached to the number.",
  "ai-tell-guard":
    "Rewrite in your own register. These constructions are the ones models over-produce, and readers — and increasingly engines — discount them.",
  "question-headings":
    "Phrase the heading as the question a reader would actually ask. Question-shaped headings match how people prompt, and the answer beneath becomes the extractable unit.",
  "sentence-length-norm":
    "Split this into two. Long sentences dilute the chunk an engine would lift, and the answer inside gets averaged away.",
  "attributed-quotes":
    "Name who said it. A quotation with no speaker is decoration; a named, credentialed speaker is what makes the passage citable as evidence.",
  "current-year-stats":
    "Date the figure — \"in 2026\" or \"as of August 2026\". Engines discount statistics they cannot date, and freshness is scored directly.",
  "answer-first-position":
    "Put a one-or-two-sentence direct answer here, before the scene-setting. Engines lift openings; an opening that defers the answer is an opening that never gets quoted.",
  "keyword-stuffing-guard":
    "Vary the phrasing or cut repetitions. Past a threshold, repetition reads as manipulation and is penalised rather than rewarded.",
  "pronoun-opening-chunks":
    "Name the subject in the first sentence. Sections are extracted alone — a reader landing here from a citation cannot resolve \"this\" or \"it\".",
  "heading-answer-adjacency":
    "Answer the heading's question in the first sentence or two beneath it. The heading + immediate answer is the unit engines extract.",
};

/**
 * Turn the engine's spans into findings the highlight plugin can anchor.
 *
 * `text` must be the SAME string the spans index into — ParsedDraft.text. A
 * different derivation silently produces quotes that never match, and the
 * failure looks like "anchoring is broken" rather than "the wrong string was
 * passed".
 */
export function buildLiveFindings(scores: DraftScores, text: string): HighlightFinding[] {
  const out: HighlightFinding[] = [];
  if (!text) return out;

  for (let pi = 0; pi < scores.pillars.length; pi++) {
    const criteria = scores.pillars[pi].criteria;
    for (let ci = 0; ci < criteria.length; ci++) {
      const c = criteria[ci];
      if (!c.spans || !c.spans.length) continue;

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
          explanation: sp.note
            ? `${c.name.split(" — ")[0]}: ${sp.note}. ${REMEDY[c.key] || ""}`.trim()
            : `${c.name.split(" — ")[0]}. ${REMEDY[c.key] || ""}`.trim(),
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
