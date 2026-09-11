/**
 * The one definition of the marker that tells a model it has seen part of a
 * document.
 *
 * It used to live in `lib/gdrive/docs.ts`, which is fine for the Drive reader
 * and impossible for anyone else: importing it drags in the Google auth client
 * and a module-scope file id. The attachment extractor needs the same string
 * and would otherwise have copied it, which is the failure the original comment
 * on it warned about — a hand-copied marker goes stale in silence and truncated
 * documents start arriving unlabelled with nothing going red.
 *
 * `lib/gdrive/docs.ts` re-exports this, so its existing importers are untouched.
 */

/**
 * The opening of the marker appended to a document that did not fit.
 *
 * Callers have to be able to TELL, not just to append: the chat wants the
 * marker left in the text (it is addressed to the model), while the content
 * optimiser must refuse the import outright, because scoring the first two
 * thirds of an article produces a confident number for a piece nobody has read.
 */
export const TRUNCATION_MARKER = "[⚠ TRUNCATED";
