/**
 * Model-family request rules for Anthropic Messages calls — the single source of
 * truth shared by the chat streamer (lib/ai/providers.ts) and every direct
 * `anthropic.messages.create` caller (RFP, voice).
 *
 * Claude 4.7+ (Opus 5, Opus 4.7/4.8, Sonnet 5, Fable 5/Mythos) reject a non-default
 * `temperature`/`top_p`/`top_k` with a 400 — adaptive thinking replaces sampling
 * control. Sonnet 5 also runs adaptive thinking when `thinking` is omitted, which
 * would eat into a tight `max_tokens` budget and add latency; we pin it off so a
 * migrated call keeps the prior thinking-off latency/length profile (a straight
 * base-model upgrade over Sonnet 4.6). Fable 5 / Mythos are always-on and 400 on
 * an explicit disable, so we omit `thinking` for them. Older Claudes (Sonnet 4.6,
 * Opus 4.6, Haiku 4.5) keep their `temperature`.
 *
 * Opus 5 is deliberately NOT in the disable list, even though it would be accepted
 * (a disable 400s only at effort xhigh/max, and we never set effort, so the API
 * default of `high` applies). With thinking off, Opus 5 is documented to sometimes
 * write a tool call into its visible text instead of emitting a tool_use block:
 * the turn succeeds, the call silently never runs, and in an agentic loop that
 * text then poisons later turns. This chat path is almost entirely tool-driven,
 * so that is the wrong trade for some latency. It also leaks <thinking> tags.
 * Thinking on is the documented fix; effort is the lever if the spend needs
 * pulling back later.
 */
export const ANTHROPIC_ADAPTIVE_ONLY = /^claude-(sonnet-5|opus-5|opus-4-[78]|fable-5|mythos-5)/;
const ANTHROPIC_THINKING_DISABLEABLE = /^claude-(sonnet-5|opus-4-[78])/;

/** Adaptive-only models we do NOT disable thinking on — they think on every call.
 *  Keep in step with the two regexes above: it is the set difference. */
const ANTHROPIC_THINKING_ALWAYS_ON = /^claude-(opus-5|fable-5|mythos-5)/;

/** Floor for a thinking model's max_tokens.
 *
 *  `max_tokens` caps thinking AND response text together, so the workspace's
 *  4096 default — sized when every model here was thinking-off — leaves an
 *  Opus 5 or Fable 5 answer to be truncated by its own reasoning. This is a
 *  ceiling, not a spend: raising it costs nothing until tokens are generated.
 *  A workspace that has deliberately set something HIGHER keeps it. */
const THINKING_MAX_TOKENS_FLOOR = 16000;

/** max_tokens for `model`, given whatever the caller asked for. */
export function anthropicMaxTokens(model: string, requested?: number): number {
  const base = requested || 4096;
  return ANTHROPIC_THINKING_ALWAYS_ON.test(model) ? Math.max(base, THINKING_MAX_TOKENS_FLOOR) : base;
}

/** Fields to spread into an anthropic.messages.create/stream call for `model`. */
export function anthropicCallParams(model: string, temperature?: number): Record<string, unknown> {
  if (!ANTHROPIC_ADAPTIVE_ONLY.test(model)) {
    return temperature !== undefined ? { temperature } : {};
  }
  if (ANTHROPIC_THINKING_DISABLEABLE.test(model)) {
    return { thinking: { type: "disabled" } };
  }
  return {}; // Opus 5 / Fable 5 / Mythos — thinking on, no sampling params
}
