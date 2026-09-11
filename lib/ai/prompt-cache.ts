/**
 * The boundary between the cacheable part of a system prompt and the part that
 * changes too fast to cache.
 *
 * Its own module because both sides need it and system-prompts.ts already
 * imports from providers.ts — importing back would close a cycle around a
 * module-level constant, which works in dev and is undefined at import time in
 * a production bundle.
 *
 * WHY IT EXISTS. The whole system string was wrapped in one cache_control block
 * with a minute-resolution clock interpolated about six thousand characters in.
 * A cached prefix is matched byte for byte, so a prefix that changes every
 * minute is never reused — and because the breakpoint covers everything BEFORE
 * it, the loss was not the timestamp but the ~52,000 characters behind it, on
 * every turn of every conversation.
 *
 * WHY IT IS A WRAPPED REGION RATHER THAN A TRAILING MARKER. The first version
 * put a single marker at the end of buildSystemPrompt's output and split on it.
 * That was correct in isolation and wrong in practice: the messages route
 * appends five more blocks AFTER calling buildSystemPrompt — the deck spec, the
 * required-tools hint, the LiveSearch rules, the scheduled-task context — so
 * everything the route added landed behind the marker and went uncached. The
 * deck spec is the expensive one: a 23-slide specification that does not change
 * between turns of a deck conversation, re-read at full price on each.
 *
 * A trailing marker makes correctness depend on nobody ever appending again,
 * which is not a property code has. Wrapping the volatile region instead means
 * it can sit anywhere: splitVolatile lifts it out and the caller puts it last,
 * so any append — before it, after it, by a caller that has never heard of this
 * module — is stable content and stays cached.
 */

export const VOLATILE_OPEN = "<<<ENGINEAI_VOLATILE_OPEN>>>";
export const VOLATILE_CLOSE = "<<<ENGINEAI_VOLATILE_CLOSE>>>";

/** Wrap text as the volatile region. Only ONE region per prompt is meaningful;
 *  a second call would strand the first, so this is used in exactly one place. */
export function markVolatile(text: string): string {
  return `${VOLATILE_OPEN}${text}${VOLATILE_CLOSE}`;
}

/**
 * Append text INTO the volatile region, wherever it sits.
 *
 * The messages route adds blocks AFTER buildSystemPrompt has returned, and a
 * plain `+=` puts them after VOLATILE_CLOSE — which is to say, into the CACHED
 * prefix. For the deck spec that is right and deliberate: a 23-slide
 * specification does not change between turns of a deck conversation, and
 * caching it is the whole reason this region is wrapped rather than trailing.
 *
 * For a PER-TURN block it is the opposite of right. The required-tools hint is
 * built from the current message and the LiveSearch rules flip with searchMode,
 * so filing them as stable changes the cached block on almost every turn.
 * Measured: swapping one tool hint moved the first differing byte to char
 * 53,084 of 53,090 — 100% of the way through — discarding the entire prefix.
 *
 * So the rule is a question about the CONTENT, not about where the code lives:
 * does this text change between turns of the same conversation? If yes, it
 * belongs in here. `stable` is the default and per-turn content is the
 * exception, which is why it has to be asked deliberately each time.
 *
 * If no region exists yet the text becomes one, so a caller can never
 * accidentally create a second region and strand the first.
 */
export function appendVolatile(systemText: string, extra: string): string {
  if (!extra) return systemText;
  const at = systemText.lastIndexOf(VOLATILE_CLOSE);
  if (at === -1) return systemText + markVolatile(extra);
  return systemText.slice(0, at) + extra + systemText.slice(at);
}

/**
 * Lift the volatile region out, wherever it sits.
 *
 * Returns the prompt with the region removed (`stable`) and the region's
 * contents (`volatile`). Both come back with the markers stripped — they are an
 * internal boundary and must never reach the model.
 *
 * A prompt with no region, or with a malformed one, comes back whole as
 * `stable` with an empty `volatile`. That degrades to "cache the lot", which is
 * wrong only in that it caches something it should not; it never drops content,
 * and dropping content is the failure that would actually hurt.
 */
export function splitVolatile(systemText: string): { stable: string; volatile: string } {
  const start = systemText.indexOf(VOLATILE_OPEN);
  const end = systemText.indexOf(VOLATILE_CLOSE, start + VOLATILE_OPEN.length);
  if (start === -1 || end === -1) {
    return { stable: stripMarkers(systemText), volatile: "" };
  }
  const volatile = systemText.slice(start + VOLATILE_OPEN.length, end);
  const stable = systemText.slice(0, start) + systemText.slice(end + VOLATILE_CLOSE.length);
  // Collapse the seam the extraction leaves behind, so removing the region does
  // not leave four consecutive newlines in the middle of the prompt.
  return { stable: stripMarkers(stable).replace(/\n{3,}/g, "\n\n"), volatile: stripMarkers(volatile) };
}

function stripMarkers(s: string): string {
  return s.split(VOLATILE_OPEN).join("").split(VOLATILE_CLOSE).join("");
}
