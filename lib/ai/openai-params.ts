/**
 * OpenAI request-parameter rules — the single source shared by the chat
 * streamer (streamOpenAI in lib/ai/providers.ts, both of its create sites)
 * and every background caller of the cheap tier (lib/ai/cheap-model.ts).
 *
 * GPT-5 and later are reasoning models, and they reject two parameters this
 * app used to send on every call:
 *
 *   - `max_tokens`            → 400 "Use 'max_completion_tokens' instead."
 *   - `temperature` ≠ default → 400 "Only the default (1) value is supported."
 *     — but ONLY while reasoning is on. At reasoning_effort "none" the same
 *     models take any temperature, 0 included (probed 2026-09-23 on gpt-6-luna
 *     and gpt-6-sol, with and without tools). Without an explicit effort they
 *     reason by default, which is why a bare `temperature: 0.2` failed.
 *
 * Both were live, and both were silent. streamOpenAI sent `max_tokens` and
 * `temperature: 0.4` to every model, so every GPT-6 Astra and GPT-5.6 Terra
 * turn since the 2026-08-14 move off GPT-4o 400'd on its first request and
 * withGrokFallback answered it with Grok instead — including the auto-router's
 * cheap leg, which never answered a single greeting. The ledger showed no
 * OpenAI rows at all and nothing else looked wrong. And the four background
 * jobs moved to GPT-5.6 Luna on 2026-09-21 sent `temperature: 0.1–0.3`, so
 * memory extraction, conversation summaries, client-context extraction and
 * memory consolidation all failed on every call from that deploy, into a
 * console.error nobody reads. Verified against the live API 2026-09-23.
 *
 * AuthorityOn carries the same rule (packages/core/src/llm/openai-params.ts)
 * for the same reason: its batch builder had the identical `max_tokens` bug.
 */

/** A reasoning model: takes `max_completion_tokens` and `reasoning_effort`,
 *  and refuses any `temperature` but the default unless effort is "none".
 *  GPT-5 and later. */
export function isOpenAIReasoningModel(model: string): boolean {
  const major = /^gpt-(\d+)/.exec(model);
  return major ? Number(major[1]) >= 5 : false;
}

export type OpenAIReasoningEffort = "none" | "low" | "medium" | "high";

/** Floor for a REASONING call's `max_completion_tokens`.
 *
 *  The cap covers reasoning AND the visible answer together, so the 4096 chat
 *  default would let a model at "medium" spend the budget thinking and return
 *  a truncated or empty reply — the same trap anthropicMaxTokens() floors for
 *  Claude. A ceiling, not a spend: it costs nothing until tokens are generated.
 *  Not applied at effort "none", where there is no reasoning to make room for
 *  and the caller's cap is the budget it meant. */
export const OPENAI_REASONING_MAX_TOKENS_FLOOR = 16000;

/**
 * Token-cap, sampling and effort fields to spread into a Chat Completions
 * request for `model`.
 *
 * `temperature` is sent where the model will take it — a non-reasoning model,
 * or a reasoning model at effort "none" — and dropped elsewhere rather than
 * sent to 400. `reasoningEffort` is sent only to a reasoning model; leave it
 * unset and the API's own default applies (it reasons), which is why every
 * OpenAI entry in MODEL_REGISTRY sets one explicitly.
 *
 * Returns only known request fields, so a call site can spread the result into
 * a typed create() call without widening it to an index signature.
 */
export interface OpenAIRequestParams {
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  reasoning_effort?: OpenAIReasoningEffort;
}

export function openAIRequestParams(
  model: string,
  opts: { maxTokens: number; temperature?: number; reasoningEffort?: OpenAIReasoningEffort }
): OpenAIRequestParams {
  if (!isOpenAIReasoningModel(model)) {
    return {
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };
  }
  const reasons = opts.reasoningEffort !== "none";
  return {
    max_completion_tokens: reasons ? Math.max(opts.maxTokens, OPENAI_REASONING_MAX_TOKENS_FLOOR) : opts.maxTokens,
    ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    ...(!reasons && opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
}
