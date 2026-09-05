/**
 * One place naming the model behind every optimizer slot.
 *
 * WHY THIS FILE EXISTS. The six slots were four aliases of one constant plus a
 * second literal typed out separately, spread across three files — so "which
 * model judges the draft" and "which model wrote it" could not be compared
 * without reading all three, and nothing could assert a relationship between
 * them. They are listed together here because the important property is not
 * any one value, it is how they RELATE:
 *
 *   generate  !=  judge      — or the scorer is marking its own homework
 *   parametric != novelty    — or the novelty baseline grades itself
 *
 * Those are correctness constraints on a product whose output is a SCORE, and
 * they are worth roughly zero dollars: a judge that agrees with the writer is
 * not cheaper, it is wrong. `scripts/verify-optimizer-coverage.ts` asserts both
 * by PROVIDER, because the pairing that shipped — claude-sonnet-5 grading
 * claude-sonnet-5, and claude-sonnet-5 vs claude-haiku-4-5 — passed an
 * id-comparison check while satisfying neither constraint.
 *
 * A NOTE ON CHANGING THESE. Two of the six are not cost levers:
 *
 *   PARAMETRIC is a measurement instrument. It answers the target query with no
 *   access to the draft, to establish what an AI already says about the topic —
 *   so a weaker model here knows less, finds more of the draft novel, and
 *   flatters the writer. Moving it changes what every score MEANS, and old and
 *   new sessions stop being comparable. If it ever moves, bump
 *   COVERAGE_PROMPT_VERSION so the memo and the record both know.
 *
 *   JUDGE decides the number the customer sees. A cheaper judge that scores
 *   differently is not a saving, it is a silent product change — measure it
 *   against drafts with known-good verdicts before switching.
 *
 * The other four are ordinary cost decisions.
 */
import { JUDGE_MODEL } from "./judge";

export { JUDGE_MODEL };

/**
 * Drafting. Output-dominated (max_tokens 8000), and the only slot whose output
 * a client reads as prose — so it is chosen on writing quality, which no
 * public benchmark measures, not on $/MTok alone.
 *
 * Was a bare literal inside the route, which is how it came to be the same
 * string as JUDGE_MODEL without anyone deciding that it should be.
 */
export const GENERATE_MODEL = "claude-sonnet-5";

/**
 * Rewrites. Capped at 350 output tokens and structurally constrained — the
 * cheapest slot to move and the highest volume.
 */
export const SUGGEST_MODEL = JUDGE_MODEL;

/**
 * Talking to the writer about their draft, in the Writer's Discuss panel.
 *
 * Pinned to GENERATE_MODEL, and that is a correctness choice rather than a
 * convenience one. This slot hands the writer text that goes straight into the
 * piece at one click, so it is doing the same job as the drafting slot and is
 * chosen on the same grounds — writing quality. Splitting them would give a
 * piece two voices: one for the paragraphs that were generated and another for
 * every paragraph that came out of a conversation about them, with nothing on
 * screen explaining why the seams read oddly.
 *
 * Note what this deliberately is NOT: the judge. The discussion happily says a
 * paragraph is weak, but the SCORE comes from the Optimiser, on a different
 * model, precisely so nothing marks its own homework — the constraint at the
 * top of this file. A writer wanting a verdict sends the piece to the
 * Optimiser; that is the whole shape of the two tools.
 */
export const DISCUSS_MODEL = GENERATE_MODEL;
