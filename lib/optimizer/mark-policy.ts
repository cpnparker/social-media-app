/**
 * Which marks a document gets, and why.
 *
 * ── THE FAULT THIS EXISTS TO CLOSE ──────────────────────────────────────────
 *
 * The inline-mark layer was the only analysis in this studio with no gate on it
 * at all. `assertServiceAllowed` gates spend, `analysisAllowed` gates the judge
 * and coverage by content type, `chromeFor` gates the chrome — and
 * `buildLiveFindings` took neither a surface nor a content type, so sixteen
 * criteria written to make a page quotable by an answer engine painted
 * identically on a blank page, a cover letter and a briefed article.
 *
 * What that looked like: a cover letter to a named person, marked HIGH severity
 * on the words "Dear Mr Suárez Santos," with the advice that an opening should
 * "carry the answer, quotably" because "engines lift openings"; and
 * `anonymous-first-person-facts` telling a first-person letter to "name the
 * brand in this sentence instead of 'we'" — which is advice to delete the
 * writer from their own letter.
 *
 * The type registry could not have saved it. `criteriaFor("cv")` removes three
 * of thirty-four criteria — the pillar-1 query set — and every one of the
 * absurd marks above survives it. Measured, not assumed.
 *
 * ── WHY A LENS AND NOT A LONGER EXCLUSION LIST ──────────────────────────────
 *
 * Because the split is not per content type, it is per CRITERION. "You spelled
 * this person's name two ways" is true of a letter, a report and a CV. "Put a
 * TL;DR block near the top" is true of none of them. Extending excludeCriteria
 * per type would restate that same partition once per type and let the copies
 * drift; declaring it once on the criterion cannot.
 *
 * ── A CALLABLE FUNCTION, NOT A CONDITION IN THE PAGE ────────────────────────
 *
 * Written here for the reason `rail-tabs.ts` was: a gate living inside
 * page.tsx can only be checked by grepping the file's text, and this repo has
 * already shipped a guard that passed while blind because a regex read the
 * wrong window. `markPolicyFor` can be RUN across every surface, type and
 * override, and no arrangement of the source can hide its answer.
 */
import { CRITERIA } from "./rubric";
import { analysisAllowed } from "./content-types";

export type Lens = "engine" | "plain";

/**
 * One floor for the whole live layer, shared with the score.
 *
 * It used to live in ScorePanel alone, which is how the Score tab came to read
 * "not enough to score yet" while the document underneath it was covered in
 * underlines — two panels telling different stories about one draft.
 */
export const MIN_MARKABLE_WORDS = 60;

export interface MarkPolicyInput {
  surface: "writer" | "optimiser" | "content";
  contentTypeId: string | null | undefined;
  /** Set on the piece by a person. Null means nobody has decided. */
  override: Lens | null;
  /**
   * Has the writer named target queries in the brief?
   *
   * This is a DECLARATION, not an inference. Someone typing the questions they
   * want this piece to answer in an AI assistant has said, in a field they
   * filled in themselves, that the piece is meant to be retrieved — so the
   * Writer shows retrieval marks while they draft it. That is the difference
   * between reading a form and guessing from prose, and it is why the Writer
   * defaulting to `plain` does not cost a real GEO article its marks.
   */
  hasTargetQueries: boolean;
}

export interface MarkPolicy {
  lens: Lens;
  reason: "type" | "override" | "brief" | "surface";
  /** Whether a person may raise this piece to the engine lens. */
  canRaise: boolean;
}

export function markPolicyFor(input: MarkPolicyInput): MarkPolicy {
  // A type whose judge is off is `plain` and CANNOT be raised. Offering engine
  // marks over a document the assess route refuses outright would be the
  // chrome disagreeing with the behaviour — the drift chromeFor exists to
  // stop. This is checked first so no override can reach past it.
  if (!analysisAllowed(input.contentTypeId, "judge")) {
    return { lens: "plain", reason: "type", canRaise: false };
  }
  if (input.override === "engine" || input.override === "plain") {
    return { lens: input.override, reason: "override", canRaise: true };
  }
  if (input.surface === "optimiser") {
    return { lens: "engine", reason: "surface", canRaise: true };
  }
  // The Writer. Retrieval marks only where the brief asked for retrieval.
  if (input.hasTargetQueries) {
    return { lens: "engine", reason: "brief", canRaise: true };
  }
  return { lens: "plain", reason: "surface", canRaise: true };
}

/** The lens a criterion belongs to, or null if the key is not registered. */
export function lensOf(key: string): Lens | null {
  for (let i = 0; i < CRITERIA.length; i++) {
    if (CRITERIA[i].key === key) return CRITERIA[i].lens;
  }
  return null;
}

/**
 * Does this criterion's mark show under this lens?
 *
 * FAIL CLOSED on an unregistered key. An unknown criterion is one nobody has
 * classified, and showing it under the plain lens is how an engine mark would
 * find its way back onto a cover letter — the exact bug. Silence is the safe
 * direction, and the check asserts every span-emitting key IS registered, so
 * failing closed can never quietly hide a real mark.
 */
export function criterionInLens(key: string, lens: Lens): boolean {
  const l = lensOf(key);
  if (l === null) return false;
  return lens === "engine" ? true : l === "plain";
}

/**
 * What the rail says is running.
 *
 * TAKES NO ARGUMENTS, deliberately. The reason a piece is on the plain lens can
 * be that it was silently recognised as the unnamed type, and a disclosure that
 * varied by reason would eventually say so on screen. One string, whatever the
 * cause, is the only shape that cannot leak it — and the check asserts the
 * output contains no registered content-type id.
 *
 * It still SAYS SOMETHING, because not looking and finding nothing are
 * different claims and must read differently.
 */
export function lensDisclosure(): string {
  return "Answer-engine checks are off for this piece. Only the checks that apply to any writing are running.";
}

/** The PATCH route's narrowing, exported so a script can run it over junk. */
export function normaliseLens(v: unknown): Lens | null {
  return v === "engine" || v === "plain" ? v : null;
}

/**
 * One ordered set of findings from the three producers.
 *
 * Deduped by id, first writer wins: a judge finding and a live finding can
 * describe the same span, and the judge's is the considered one.
 */
export function mergeFindingSets<T extends { id: string }>(sets: {
  judge?: T[];
  talk?: T[];
  live?: T[];
}): T[] {
  const out: T[] = [];
  const seen: { [id: string]: true } = {};
  const groups = [sets.judge || [], sets.talk || [], sets.live || []];
  for (let g = 0; g < groups.length; g++) {
    for (let i = 0; i < groups[g].length; i++) {
      const f = groups[g][i];
      if (seen[f.id]) continue;
      seen[f.id] = true;
      out.push(f);
    }
  }
  return out;
}
