/**
 * The cheap-tier model for internal background fan-out: memory extraction,
 * conversation summaries, client-context extraction, memory consolidation.
 *
 * Centralised per PLAN-cheap-tier-model-update.md §A-2. Before this, the
 * client and model id were duplicated as four private getXAIClient() copies
 * (memory-extraction.ts, conversation-summary.ts, client-context-extract.ts,
 * memory-consolidation.ts), all hardcoding the literal string
 * "grok-4-1-fast" — a slug xAI retired 2026-05-15 and has been silently
 * redirecting to grok-4.3 ever since. That duplication is why the retirement
 * went unnoticed here for three months: there was no single place to fix.
 *
 * GPT-6 Luna since 2026-09-23 — half GPT-5.6 Luna's price on both axes and
 * stronger at effort "none" (AA v4.3.2: 18.3 vs 15.5). It has no redirect to
 * fall back on, so CHEAP_MODEL must always be a real, current wire slug.
 */
import OpenAI from "openai";
import { openAIRequestParams, type OpenAIRequestParams } from "@/lib/ai/openai-params";

/**
 * Wire slug sent to OpenAI AND the id logged to ai_usage — deliberately the
 * same string, and for gpt-6-luna also the registry id the auto-router names,
 * so there is one spelling to price. (GPT-5.6 Luna had two, "gpt-5.6-luna"
 * and "gpt-5-6-luna", and lib/ai/model-costs.ts had to carry both so neither
 * fell through to the Sonnet-4.6 fallback.)
 */
export const CHEAP_MODEL = "gpt-6-luna";

/** No reasoning. These jobs extract, summarise and classify into short JSON,
 *  and each caps its reply at 300–1500 tokens — a model reasoning inside that
 *  cap can spend it all before writing a word. "none" also keeps the path as
 *  cheap as the name says: reasoning tokens bill as output. */
export const CHEAP_MODEL_EFFORT = "none" as const;

/**
 * Token cap, sampling and effort for a cheap-tier call — spread these into the
 * request instead of writing the fields out.
 *
 * Written out, they 400'd on every call. Each job asked for a temperature
 * (0.1–0.3) and no effort, and GPT-5.6 Luna refuses a temperature while it is
 * reasoning — which it does by default. So from the 2026-09-21 switch until
 * this helper, memory extraction, summaries, client context and consolidation
 * all failed into a console.error, and the ledger simply stopped showing them.
 * At effort "none" the same temperatures are accepted, so each job keeps the
 * one it asked for; the shared rule decides when a temperature can be sent.
 */
export function cheapModelParams(maxTokens: number, temperature?: number): OpenAIRequestParams {
  return openAIRequestParams(CHEAP_MODEL, { maxTokens, temperature, reasoningEffort: CHEAP_MODEL_EFFORT });
}

let cachedClient: OpenAI | null = null;

export function getCheapModelClient(): OpenAI {
  if (!cachedClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set. Add it to use GPT models.");
    }
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}
