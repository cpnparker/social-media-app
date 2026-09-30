/**
 * What a failed generate_slides call shows the USER and tells the MODEL.
 *
 * THE INCIDENT, 2026-09-15. A new chat asked for a deck, the first call was
 * refused for its shape, and the user watched a red toast saying "Fix and send
 * again — do NOT tell the user the slide is done" while the model retried in
 * the background and the deck built. Every one of the four provider chains
 * forwarded `err.message` to the browser as `slides_error`, whoever the message
 * was written for. `slides_error` was built for Google connection failures
 * (7c37697), and the model-directed refusals arrived nine days later and fell
 * into the same toast by accident.
 *
 * So there are two kinds of failure, decided by the CLASS of the error:
 *
 *   - a SlideCallRefusal is about the call's shape, and the model can fix it
 *     in the same turn. The user sees nothing — only a `slides_refused` event
 *     that clears the progress indicator — because a later call may still
 *     succeed. If the turn ENDS refused, unresolvedSlidesNotice (providers.ts)
 *     says so in the reply, in words for a person. Silence is safe only while
 *     that notice exists: ccf6fd5 was an incident where a transient signal was
 *     the only one and the model covered the failure with a success story.
 *   - anything else is a real fault. The user gets a fixed, person-worded
 *     `slides_error`; the raw message goes to the log and the model, never to
 *     the screen, because a raw message is whatever the code that threw
 *     happened to say (a SyntaxError from a cut-off call reached the toast).
 *
 * ONE helper for all four chains, so they cannot drift. The duplicate-signature
 * release stays in each chain: the chains key the loop guard differently (the
 * input object, a whitespace-stripped string, the raw string) and a release
 * with another chain's key silently releases nothing.
 *
 * Pure apart from writing the turn's last outcome, so a check can drive it.
 * Guarded by check 38 of scripts/verify-slide-layouts.ts.
 */
import { SlideCallRefusal, isSlideCallRefusal, type SlideFault, type RefusalScope } from "@/lib/slides/edit";

/** How the turn's LAST generate_slides call ended. The last one, not "any":
 *  the incident's refusal was followed by a success, and a notice then would
 *  tell the user a deck they can see was never built. */
export type SlidesOutcome =
  | { kind: "ok" }
  | { kind: "failed" }
  | { kind: "refused"; faults: SlideFault[]; scope?: RefusalScope; userReason?: string };

/** Per-turn state the chains carry on their config object. */
export interface SlidesTurnState {
  lastOutcome?: SlidesOutcome;
  /** A draft or a published deck came out of an EARLIER call in this turn, so
   *  a deck is on screen whatever happens next. A refused rebuild after it is
   *  "the deck was not changed", never "the deck was not built". Recorded here,
   *  from the outcome being replaced, because lastOutcome alone forgets it. */
  builtEarlier?: boolean;
}

/** Shown to the user for a fault that is not a refusal. Fixed text: the raw
 *  message is for the log. */
export const SLIDES_FAILED_FOR_USER =
  "The deck couldn't be finished because of an internal error. Ask again, and if it keeps happening, let the team know.";

/**
 * The events to send and the tool result to return for a generate_slides call
 * that threw, and the turn's outcome recorded on `turn`.
 */
export function slidesFailure(
  err: unknown,
  turn?: SlidesTurnState | null
): { refused: boolean; events: Record<string, unknown>[]; toolText: string } {
  const raw = String((err && (err as any).message) || err || "unknown error");
  // Carried forward before the outcome is overwritten: the success being
  // replaced is the only record that a deck is already on screen.
  if (turn && turn.lastOutcome && turn.lastOutcome.kind === "ok") turn.builtEarlier = true;
  if (isSlideCallRefusal(err)) {
    if (turn) {
      // Read defensively: this runs INSIDE a chain's catch block, where a throw
      // escapes the turn. A refusal recognised by its marker from another copy
      // of the module need not carry a faults array.
      turn.lastOutcome = {
        kind: "refused",
        faults: Array.isArray(err.faults) ? err.faults.slice() : [],
        scope: err.scope,
        userReason: err.userReason,
      };
    }
    return {
      refused: true,
      // Not a toast and not text: only enough for the client to stop showing
      // "Writing the deck… slide 14" for a call that has ended.
      events: [{ slides_refused: true }],
      toolText:
        `REFUSED — nothing was built or changed, and the user has not been shown this. ${raw} ` +
        `Call generate_slides again with the fix; do not narrate the fix to the user.`,
    };
  }
  if (turn) turn.lastOutcome = { kind: "failed" };
  return {
    refused: false,
    events: [{ slides_error: SLIDES_FAILED_FOR_USER }],
    toolText:
      `Google Slides creation failed: ${raw}. The user has been shown that the deck could not be finished. ` +
      `Do NOT tell them the deck is done or changed.`,
  };
}

/**
 * generate_slides arguments from an OpenAI-compatible chain, parsed.
 *
 * The parse used to be the first line inside the call's `try`, so a call cut
 * off mid-stream — the usual fate of a long deck sent in one go — put a raw
 * "Unexpected end of JSON input" in the user's toast. It is the model's call
 * that is malformed, so it is a refusal, with the one fix that works.
 */
export function parseSlidesArguments(rawArgs: string | null | undefined): any {
  let input: any;
  try {
    input = JSON.parse(rawArgs == null ? "" : rawArgs);
  } catch {
    input = undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SlideCallRefusal(
      "The generate_slides arguments were not valid JSON — the call was probably cut off before it finished, so nothing was built or changed. " +
      "Send it again in a smaller batch: about ten slides in `slides`, then add the rest with editSlide: { insertAfter, insertSlides }.",
      { userReason: "it was cut off before it finished, which happens when a long deck is asked for in one go" }
    );
  }
  return input;
}
