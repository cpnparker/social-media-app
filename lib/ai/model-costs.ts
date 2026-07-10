/**
 * Single source of truth for per-model token cost, in **cents per 1M tokens**.
 *
 * Imported by both the chat route (app/api/ai/conversations/[id]/messages) and
 * the logAiUsage helper (lib/ai/usage-logger) so the two never drift — an
 * earlier copy-paste split had let the usage-logger map fall behind, silently
 * billing newer models (grok-4-3, claude-opus-4-8, …) at the Sonnet fallback
 * rate. Keep this map aligned with MODEL_REGISTRY in lib/ai/providers.ts.
 */
export const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // Fable 5 note: classifier-flagged queries are served (and billed) as
  // Opus 4.8 by Anthropic — our per-model rate slightly overestimates those.
  "claude-fable-5": { inputPer1M: 1000, outputPer1M: 5000 },         // $10/$50
  "claude-opus-4-8": { inputPer1M: 500, outputPer1M: 2500 },         // $5/$25
  "claude-opus-4-7": { inputPer1M: 500, outputPer1M: 2500 },         // $5/$25 (legacy → opus-4-8)
  "claude-sonnet-5": { inputPer1M: 300, outputPer1M: 1500 },         // $3/$15 (intro $2/$10 through 2026-08-31)
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },       // $3/$15
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 },
  "claude-haiku-4-5": { inputPer1M: 100, outputPer1M: 500 },         // $1/$5
  "gpt-4o": { inputPer1M: 250, outputPer1M: 1000 },                  // $2.50/$10
  "gpt-4o-mini": { inputPer1M: 15, outputPer1M: 60 },                // $0.15/$0.60
  "gpt-4.1": { inputPer1M: 200, outputPer1M: 800 },                  // $2/$8
  "grok-4-1-fast": { inputPer1M: 20, outputPer1M: 50 },              // $0.20/$0.50
  "grok-4-3": { inputPer1M: 125, outputPer1M: 250 },                 // $1.25/$2.50
  "grok-3": { inputPer1M: 300, outputPer1M: 1500 },                  // $3/$15
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },                // $0.30/$0.50
  "grok-4": { inputPer1M: 200, outputPer1M: 1000 },                  // $2/$10
  "mistral-large-latest": { inputPer1M: 200, outputPer1M: 600 },     // $2/$6
  "gemini-2.5-flash": { inputPer1M: 15, outputPer1M: 60 },           // $0.15/$0.60
  "gemini-2.5-pro": { inputPer1M: 125, outputPer1M: 1000 },          // $1.25/$10
  "gemini-3-flash": { inputPer1M: 50, outputPer1M: 300 },            // $0.50/$3
  "gemini-3.1-flash-lite": { inputPer1M: 25, outputPer1M: 150 },     // $0.25/$1.50
  "deepseek-chat": { inputPer1M: 27, outputPer1M: 110 },             // $0.27/$1.10
  "sonar": { inputPer1M: 100, outputPer1M: 100 },                    // $1/$1
  "sonar-pro": { inputPer1M: 300, outputPer1M: 1500 },               // $3/$15
};

/** Cost of a call in tenths of a cent (rounded). Unknown models fall back to Sonnet rates. */
export function calculateCostTenths(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M * 10;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M * 10;
  return Math.round(inputCost + outputCost);
}
