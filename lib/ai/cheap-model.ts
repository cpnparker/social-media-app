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
 * GPT-5.6 Luna has no such redirect to fall back on, so CHEAP_MODEL must
 * always be Luna's real, current wire slug.
 */
import OpenAI from "openai";

/**
 * Wire slug sent to OpenAI AND the id logged to ai_usage — deliberately the
 * same string. lib/ai/model-costs.ts prices "gpt-5.6-luna" (dotted) and
 * "gpt-5-6-luna" (dashed, the registry id used by the picker/auto-router)
 * identically for exactly this reason: whichever spelling a caller logs must
 * resolve to the real rate, not the Sonnet-4.6 fallback.
 */
export const CHEAP_MODEL = "gpt-5.6-luna";

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
