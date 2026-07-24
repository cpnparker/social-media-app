/**
 * Model-family request rules for Anthropic Messages calls — the single source of
 * truth shared by the chat streamer (lib/ai/providers.ts) and every direct
 * `anthropic.messages.create` caller (RFP, voice).
 *
 * Claude 4.7+ (Opus 4.7/4.8, Sonnet 5, Fable 5/Mythos) reject a non-default
 * `temperature`/`top_p`/`top_k` with a 400 — adaptive thinking replaces sampling
 * control. Sonnet 5 also runs adaptive thinking when `thinking` is omitted, which
 * would eat into a tight `max_tokens` budget and add latency; we pin it off so a
 * migrated call keeps the prior thinking-off latency/length profile (a straight
 * base-model upgrade over Sonnet 4.6). Fable 5 / Mythos are always-on and 400 on
 * an explicit disable, so we omit `thinking` for them. Older Claudes (Sonnet 4.6,
 * Opus 4.6, Haiku 4.5) keep their `temperature`.
 */
export const ANTHROPIC_ADAPTIVE_ONLY = /^claude-(sonnet-5|opus-4-[78]|fable-5|mythos-5)/;
const ANTHROPIC_THINKING_DISABLEABLE = /^claude-(sonnet-5|opus-4-[78])/;

/** Fields to spread into an anthropic.messages.create/stream call for `model`. */
export function anthropicCallParams(model: string, temperature?: number): Record<string, unknown> {
  if (!ANTHROPIC_ADAPTIVE_ONLY.test(model)) {
    return temperature !== undefined ? { temperature } : {};
  }
  if (ANTHROPIC_THINKING_DISABLEABLE.test(model)) {
    return { thinking: { type: "disabled" } };
  }
  return {}; // Fable 5 / Mythos — thinking always on, no sampling params
}
