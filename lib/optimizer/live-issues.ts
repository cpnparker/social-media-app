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
    "Name the source in the same sentence as the figure.",
  "ai-tell-guard":
    "Rewrite in your own register.",
  "question-headings":
    "Phrase the heading as the question a reader would ask.",
  "sentence-length-norm":
    "Split this into two.",
  "attributed-quotes":
    "Name who said it.",
  "promotional-claims":
    "Say what you did, not what you offer — with a figure you already hold.",
  "placeholder-guard":
    "Replace this with the real asset, or cut the line.",
  "person-name-consistency":
    "One spelling is a typo. Pick one and use it everywhere.",
  "current-year-stats":
    "Give the figure a date, or find a fresher one.",
  "answer-first-position":
    "Put a one-or-two-sentence answer here, before the scene-setting.",
  "keyword-stuffing-guard":
    "Vary the phrasing or cut repetitions.",
  "pronoun-opening-chunks":
    "Name the subject in the first sentence.",
  "heading-answer-adjacency":
    "Answer the heading in the first sentence beneath it.",
  "anonymous-first-person-facts":
    "Name the brand in this sentence instead of \"we\".",
  "unverifiable-superlatives":
    "Cut it, or substantiate it.",
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
  // REMEDY had 17 keys and this table had 16. placeholder-guard was the odd one
  // out, so an engine-lens card carried an action and no "Why?" while every
  // card beside it had one. Found by asserting the two tables agree.
  "placeholder-guard":
    "Whatever ships is read back as the finished text, placeholder and all.",
};

/**
 * The same thing for the JUDGE's criteria.
 *
 * Judge findings reached the rail with no `why` at all — not a dead control,
 * an absent one — so a model-found mark and a deterministic mark sitting in one
 * list answered different questions, and nothing on screen said why.
 *
 * A SEPARATE TABLE, not extra entries in RATIONALE, for one reason: the check
 * drives this one off JUDGE_CRITERION_KEYS. An eighth judge criterion then
 * fails the build instead of shipping a card with no reasoning behind it, and
 * that is the only assertion that can catch the partial-table failure — a table
 * covering one key of seven passes every existence-style check there is.
 *
 * NOT `whyJudge` FROM judge-rubric.ts, which is the tempting shortcut and is
 * the wrong text. That field explains why a MODEL scores the criterion rather
 * than the engine — "canonical-name-consistency counts KNOWN aliases only; its
 * own comment says unknown variants need NER". It is methodology written for
 * whoever maintains the rubric, it has no consumer anywhere in the app today,
 * and putting it on a writer's screen would answer a question they did not ask
 * with vocabulary from our own internals.
 */
const JUDGE_RATIONALE: { [key: string]: string } = {
  "semantic-query-coverage":
    "Engines retrieve on the query's words and cite on the answer; a page with only the words is read and passed over.",
  "quote-attribution-quality":
    "A quote a paraphrase could carry gets paraphrased, and the speaker's name disappears into it.",
  "opening-quotability":
    "A lifted opening arrives in the answer without the name or qualifier it leans on further down the page.",
  "chunk-self-containment":
    "\u201cAs mentioned above\u201d and \u201cthe second option\u201d point at a page the person reading the answer never sees.",
  "entity-variant-drift":
    "Mentions accrue to the exact string, so each stray spelling siphons evidence off the name you want cited.",
  "experience-substantiation":
    "A model repeats the figure or the named client; \u201cin our experience\u201d with neither behind it is dropped.",
  "unsourced-absolute-claims":
    "A model repeats an unsourced absolute with a hedge attached, and \u201cthe only platform that\u201d hedged is not a claim.",
};

/**
 * The sentence a writer reads on a mark.
 *
 * Under the plain lens it stops at the action. Under the engine lens the
 * rationale follows it, because there the reader HAS asked how a machine reads
 * their page — that is what the surface is for.
 */
function explain(key: string, name: string, note: string | undefined, lens: Lens): string {
  // THE CRITERION NAME IS DROPPED ON THE PLAIN LENS.
  //
  // Not tidying: the names are written for the rubric, and several of them are
  // answer-engine sentences in their own right. "Mean sentence length near the
  // CITED norm" reached a cover letter with its remedy correctly stripped and
  // leaked the vocabulary anyway, through the half nobody thought of as copy.
  // The card already carries a plain title ("Sentence runs long"), so the name
  // was duplicating it — and duplicating it in the wrong register.
  //
  // The engine lens keeps it: there the rubric's own language is the point.
  // SHORT. What was found, then what to do — nothing else. Engine-lens copy ran
  // to 446 characters, four or five lines in a 320px rail, and a writer scanning
  // fifteen of those reads none of them. The rationale moved to its own field
  // and sits behind a disclosure: the reader can ask, and mostly will not.
  const parts: string[] = [];
  if (note) parts.push(`${note.charAt(0).toUpperCase()}${note.slice(1)}.`);
  else parts.push(`${name.split(" — ")[0]}.`);
  parts.push(REMEDY[key] || "");
  return parts.filter(Boolean).join(" ").trim();
}

/** WHY it matters, for the reader who asks. Engine lens only — under the plain
 *  lens the answer-engine reasoning is not the reader's question.
 *
 *  Both tables, because a finding read back from the database carries only a
 *  criterion key and nothing downstream knows which layer produced it.
 *  Exported so the check can RUN it rather than grep for the table. */
export function whyFor(key: string, lens: Lens): string | undefined {
  if (lens !== "engine") return undefined;
  return RATIONALE[key] || JUDGE_RATIONALE[key];
}

/**
 * Attach `why` to findings this module did not build — the judge's.
 *
 * Derived HERE, at render, from (criterion, lens), rather than stored on the
 * row or baked in by the two client mappers. Three reasons, each of which was
 * a way this could ship looking done:
 *
 *   A COLUMN would freeze whichever lens happened to be in force when the
 *   assessment ran, and would have to be added to two independently maintained
 *   SELECT lists — add it to one and the reasoning vanishes on reload.
 *
 *   THE TWO MAPPERS (fresh assess, and hydrate on reopen) would each need the
 *   same line, which is two places to drift.
 *
 *   criterionInLens IS NOT THE GATE, though the symmetry is tempting. It reads
 *   the engine's CRITERIA table, none of the seven judge keys are in it, and it
 *   fails CLOSED — so routing this through it returns false for every judge
 *   finding and the whole feature silently does nothing. Verified before
 *   writing this, and asserted in the check.
 */
export function withWhy<T extends { criterion: string; why?: string }>(
  findings: T[],
  lens: Lens
): T[] {
  const out: T[] = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const why = whyFor(f.criterion, lens);
    out.push(why ? { ...f, why } : f);
  }
  return out;
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

  /**
   * Two passages can open the same way, so a key is not a guarantee of
   * uniqueness. The second one to appear takes a suffix, which is deterministic
   * within a build and keeps the two marks separately dismissible. Without it
   * one dismissal would silently hide the other, and a mark that is hidden for
   * a reason nothing on screen explains is worse than a duplicate.
   */
  const used: { [k: string]: number } = {};
  const keyFor = (quote: string): string => {
    const base = liveFindingKey(quote);
    used[base] = (used[base] || 0) + 1;
    return used[base] === 1 ? base : `${base}~${used[base]}`;
  };

  for (let pi = 0; pi < scores.pillars.length; pi++) {
    const criteria = scores.pillars[pi].criteria;
    for (let ci = 0; ci < criteria.length; ci++) {
      const c = criteria[ci];
      if (!c.spans || !c.spans.length) continue;
      // A criterion that PASSED contributes no marks.
      //
      // The score panel already filters its list on `passed`; this loop did
      // not, so the two surfaces disagreed about the same criterion. On a live
      // page, attributed-quotes scored 10/10 and simultaneously painted "no
      // speaker named" on a quote whose speaker was named in the next
      // sentence, and sentence-length-norm scored 5/5 while marking four
      // sentences. That is the "are these done or not done?" ambiguity in its
      // purest form: a fault-worded mark on something the score calls finished.
      //
      // The panel is the authority on what is done; marks are the fix list. A
      // mark that is not a fix does not belong in it. This does drop the
      // occasional advisory (the longest sentences on a piece whose lengths
      // are fine overall) — a deliberate trade for the list meaning one thing.
      if (c.passed) continue;
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
          // Identified by WHAT IT IS ABOUT, not by where it sits. See
          // liveFindingKey: an id built from character offsets changes whenever
          // anything earlier in the document changes, so every dismissal below
          // an edit came back on the next keystroke.
          id: `live:${c.key}:${keyFor(quote)}`,
          criterion: c.key,
          severity: SEVERITY[c.key] || "low",
          quote,
          prefix: text.slice(Math.max(0, sp.start - CONTEXT_CHARS), sp.start),
          suffix: text.slice(sp.end, Math.min(text.length, sp.end + CONTEXT_CHARS)),
          explanation: explain(c.key, c.name, sp.note, lens),
          why: whyFor(c.key, lens),
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

/**
 * How much of a passage decides which passage it IS.
 *
 * Long enough that two different sentences rarely share it, short enough that
 * working on the end of a sentence does not keep re-minting the mark you just
 * waved away.
 */
export const LIVE_KEY_CHARS = 48;

/**
 * A stable identity for a marked passage.
 *
 * ── WHY NOT THE OFFSETS ─────────────────────────────────────────────────────
 *
 * The id used to be `live:<criterion>:<start>-<end>`, with a comment promising
 * that a dismissed issue "stays dismissed while the writer edits elsewhere".
 * It did the opposite. Character offsets are relative to the whole document, so
 * typing a single word in the first paragraph shifts every offset after it, and
 * every dismissal below the cursor came back on the next keystroke. Reported
 * from real use as a "sentence runs too long" mark that would not stay
 * dismissed.
 *
 * ── WHY A PREFIX AND NOT THE WHOLE QUOTE ────────────────────────────────────
 *
 * Because the reported case is a writer EDITING the sentence they dismissed.
 * Hashing the whole quote fixes the document-wide bug and leaves that one:
 * every keystroke inside the sentence mints a new id and the mark returns while
 * they are still working on it. Keying on the opening means the mark stays
 * dismissed while the sentence is being worked on, and returns only when its
 * opening changes, which is the honest boundary for "this became a different
 * sentence".
 *
 * Normalised so that punctuation and spacing changes, which are most of what
 * editing a long sentence involves, do not count as a different passage.
 */
export function liveFindingKey(quote: string): string {
  const norm = String(quote || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIVE_KEY_CHARS);
  // djb2, so an id stays short and printable whatever the passage contains.
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** True for findings this module produced, so the two layers can be told apart
 *  without a second field on HighlightFinding. */
export function isLiveFinding(f: { id: string }): boolean {
  return f.id.indexOf("live:") === 0;
}
