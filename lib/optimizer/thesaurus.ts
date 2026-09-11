/**
 * Alternatives for one word, in the sentence it actually sits in.
 *
 * Selecting a single word and pressing Rewrite used to send "rewrite this
 * passage so it is stronger" with one word attached, which is not a question
 * anyone means to ask. What a writer wants there is a thesaurus: several
 * options, with the difference between them, applicable in place.
 *
 * ── WHY THE ANCHOR IS THE SENTENCE AND NOT THE WORD ─────────────────────────
 *
 * The apply path resolves an anchor with `findAnchor(text, { quote })` and no
 * prefix or suffix, so it lands on the FIRST occurrence of the quote in the
 * document. Anchoring on "clear" or "strong" would therefore replace some other
 * paragraph's word, silently, several screens away from where the writer is
 * looking. The sentence is long enough to be unique in practice and it makes
 * each option a single click.
 *
 * That also decides the shape of the reply: one draft block per option, each
 * the WHOLE sentence with the word swapped, so the existing "Replace that
 * passage" button already works on every one of them without a new apply path.
 *
 * Pure and exported, so the check can run the sentence-finding and the
 * occurrence counting rather than trusting a regex written once.
 */

/** Terminators that end a sentence, plus the abbreviation trap. */
const SENTENCE_END = /[.!?]/;

/**
 * Is this selection a single word?
 *
 * A hyphenated compound and a possessive count as one: "well-known" and
 * "client's" are one word to a writer, and offering to look up "s" would be
 * absurd. Anything with whitespace in it is a passage, and takes the ordinary
 * rewrite.
 */
export function isSingleWord(selection: string): boolean {
  const s = String(selection || "").trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  // At least two letters, or it is punctuation, a numeral or an initial, none
  // of which have synonyms.
  return /[a-z]{2,}/i.test(s);
}

/**
 * The sentence containing `offset` within `text`.
 *
 * Deliberately simple, and bounded by the paragraph it is given: the caller
 * passes one block's text, so there is no crossing into a neighbouring
 * paragraph. Dotted initialisms are the one trap worth handling, because "the
 * U.S. market" would otherwise cut the sentence in half and hand the model a
 * fragment to rewrite.
 */
export function sentenceAround(text: string, offset: number): string {
  const s = String(text || "");
  if (!s) return "";
  const at = Math.max(0, Math.min(offset, s.length));

  const isBoundary = (i: number): boolean => {
    if (!SENTENCE_END.test(s[i])) return false;
    // A full stop inside an initialism is followed by a capital with no space,
    // or by a single letter and another stop. The next character being
    // lowercase means the sentence did not end.
    const next = s.slice(i + 1, i + 3);
    if (/^\s+[a-z]/.test(next)) return false;
    if (/^[A-Za-z]\./.test(next)) return false;
    return true;
  };

  let start = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (isBoundary(i)) { start = i + 1; break; }
  }
  let end = s.length;
  for (let i = at; i < s.length; i++) {
    if (isBoundary(i)) { end = i + 1; break; }
  }
  return s.slice(start, end).trim();
}

/**
 * Which occurrence of `word` in `sentence` the writer selected, 1-based.
 *
 * Returns 1 when the word appears once, which is the common case and needs no
 * mention. When it appears more than once the instruction has to say which one,
 * or the model swaps whichever it notices first and the writer's actual
 * selection is left untouched.
 */
export function occurrenceIndex(sentence: string, word: string, offsetInSentence: number): number {
  const s = String(sentence || "");
  const w = String(word || "");
  if (!w) return 1;
  let n = 0;
  let i = s.indexOf(w);
  while (i >= 0 && i <= offsetInSentence) {
    n++;
    i = s.indexOf(w, i + 1);
  }
  return Math.max(1, n);
}

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth"];

/**
 * How many options to ask for.
 *
 * Enough to choose from, few enough to read. Each one arrives as its own
 * applicable block, so a list of twelve would be twelve buttons.
 */
export const THESAURUS_OPTIONS = 5;

export function buildThesaurusAsk(opts: {
  word: string;
  sentence: string;
  /** 1-based, from occurrenceIndex. */
  occurrence?: number;
}): string {
  const occ = opts.occurrence && opts.occurrence > 1
    ? ` I mean the ${ORDINALS[Math.min(opts.occurrence, ORDINALS.length - 1)] || `${opts.occurrence}th`} time it appears.`
    : "";

  return (
    `Give me alternatives for the single word "${opts.word}" in this sentence.${occ}\n\n` +
    `"${opts.sentence}"\n\n` +
    `Offer ${THESAURUS_OPTIONS} options. For each, say in a few words what it changes: the register, the ` +
    `precision, the connotation. I want the difference between them, not a list of synonyms.\n` +
    `Say plainly if the original is already the best word here, and if the sentence would be better with ` +
    `the word simply cut, say that too.\n` +
    `Put the whole sentence in an anchor block, and each option as its own draft block containing the ` +
    `WHOLE sentence with only that one word changed. Change nothing else in it.`
  );
}
