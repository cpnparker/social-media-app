/**
 * Single source of truth for per-model token cost, in **cents per 1M tokens**.
 *
 * Imported by both the chat route (app/api/ai/conversations/[id]/messages) and
 * the logAiUsage helper (lib/ai/usage-logger) so the two never drift — an
 * earlier copy-paste split had let the usage-logger map fall behind, silently
 * billing newer models (grok-4-3, claude-opus-4-8, …) at the Sonnet fallback
 * rate. Keep this map aligned with MODEL_REGISTRY in lib/ai/providers.ts.
 */
/**
 * Rates VERIFIED against each vendor's own pricing page on this date. Not a
 * reseller table, and not recalled — both have been wrong here this month.
 * Re-verify and move this date when you touch a number.
 */
export const RATES_VERIFIED_ON = "2026-08-17";

export const MODEL_COSTS: Record<
  string,
  {
    inputPer1M: number;
    outputPer1M: number;
    /**
     * Cache READS, transcribed from published figures — never derived from a
     * multiplier. Absent means "not verified for this model", and the cost
     * function then bills cache reads at FULL input rate: an overstatement,
     * which is the safe direction, since understating lets spend run past the
     * provider cap in lib/admin/service-control.ts instead of tripping it.
     */
    cachedInputPer1M?: number;
    /**
     * Cache WRITES, as a multiplier on base input. Anthropic charges a premium
     * (1.25x for the 5-minute cache, 2x for the 1-hour). Providers that cache
     * implicitly do not bill writes separately and leave this undefined,
     * which the cost function treats as zero write cost.
     */
    cacheWriteMultiplier?: number;
  }
> = {
  // Fable 5 note: classifier-flagged queries are served (and billed) as
  // Opus 4.8 by Anthropic — our per-model rate slightly overestimates those.
  "claude-fable-5": { inputPer1M: 1000, outputPer1M: 5000, cachedInputPer1M: 100, cacheWriteMultiplier: 1.25 },   // $10/$50, cache $1
  "claude-opus-5": { inputPer1M: 500, outputPer1M: 2500, cachedInputPer1M: 50, cacheWriteMultiplier: 1.25 },      // $5/$25, cache $0.50
  "claude-opus-4-8": { inputPer1M: 500, outputPer1M: 2500, cachedInputPer1M: 50, cacheWriteMultiplier: 1.25 },    // $5/$25, cache $0.50
  "claude-opus-4-7": { inputPer1M: 500, outputPer1M: 2500, cachedInputPer1M: 50, cacheWriteMultiplier: 1.25 },    // $5/$25 (legacy → opus-4-8)
  // $2/$10 is now the STANDARD price. Anthropic's pricing page states the
  // September 2026 increase to $3/$15 "will not occur" — so this table was
  // overstating Sonnet 5 by 50%, on the model the auto-router forces for web
  // search and personal-data turns.
  "claude-sonnet-5": { inputPer1M: 200, outputPer1M: 1000, cachedInputPer1M: 20, cacheWriteMultiplier: 1.25 },     // $2/$10, cache $0.20
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },       // $3/$15
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 },
  "claude-haiku-4-5": { inputPer1M: 100, outputPer1M: 500, cachedInputPer1M: 10, cacheWriteMultiplier: 1.25 },    // $1/$5, cache $0.10
  // Keyed by the REGISTRY id, which is what route.ts prices by — not by
  // apiModel. Added dotted-only, these fell through to the Sonnet fallback at
  // the bottom of this file and billed $3/$15 instead of $2/$12. Both spellings
  // are kept: the registry id is what the ledger looks up, the apiModel is what
  // shows in provider-side reporting.
  "gpt-5-6-terra": { inputPer1M: 200, outputPer1M: 1200 },           // $2/$12
  "gpt-5.6-terra": { inputPer1M: 200, outputPer1M: 1200 },           // $2/$12
  "gpt-5.6-luna": { inputPer1M: 20, outputPer1M: 120 },              // $0.20/$1.20
  "gpt-5.6-sol": { inputPer1M: 500, outputPer1M: 3000 },             // $5/$30
  "gpt-4o": { inputPer1M: 250, outputPer1M: 1000 },                  // $2.50/$10 (retired; historic rows only)
  "gpt-4o-mini": { inputPer1M: 15, outputPer1M: 60 },                // $0.15/$0.60
  "gpt-4.1": { inputPer1M: 200, outputPer1M: 800 },                  // $2/$8
  // RETIRED SLUG, STILL BILLED. xAI retired grok-4-1-fast-reasoning and
  // -non-reasoning on 15 May 2026. The slugs still resolve — requests are
  // redirected to grok-4.3 and billed AT GROK-4.3 RATES — so nothing broke and
  // nothing surfaced, while this table went on recording $0.20/$0.50 for calls
  // that cost $1.25/$2.50. Every ai_usage row for the fast model since then
  // understated input by 6.25x and output by 5x, and the fast model is the
  // workhorse: memory extraction, summaries, client context, meeting triggers,
  // digests. Corrected to what is actually charged; the historic rows remain
  // wrong and would need a backfill to fix.
  "grok-4-1-fast": { inputPer1M: 125, outputPer1M: 250 },            // redirected to grok-4.3
  "grok-4-1-fast-non-reasoning": { inputPer1M: 125, outputPer1M: 250 }, // redirected to grok-4.3
  "grok-4-3": { inputPer1M: 125, outputPer1M: 250, cachedInputPer1M: 20 },        // $1.25/$2.50, cache $0.20
  "grok-4-6": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50
  "grok-4-5": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50
  "grok-3": { inputPer1M: 300, outputPer1M: 1500 },                  // $3/$15
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },                // $0.30/$0.50
  "grok-4": { inputPer1M: 200, outputPer1M: 1000 },                  // $2/$10
  "mistral-large-latest": { inputPer1M: 200, outputPer1M: 600 },     // $2/$6
  "gemini-2.5-flash": { inputPer1M: 15, outputPer1M: 60 },           // $0.15/$0.60
  "gemini-2.5-pro": { inputPer1M: 125, outputPer1M: 1000 },          // $1.25/$10
  // $0.75/$3.75 promotional through 2026-12-31, DOUBLING to $1.50/$7.50 on
  // 2027-01-01. Was recorded at $0.50/$3, understating it.
  "gemini-3-flash": { inputPer1M: 75, outputPer1M: 375, cachedInputPer1M: 7.5 },   // cache $0.075
  "gemini-3.1-flash-lite": { inputPer1M: 25, outputPer1M: 150, cachedInputPer1M: 2.5 }, // $0.25/$1.50, cache $0.025
  "deepseek-chat": { inputPer1M: 27, outputPer1M: 110 },             // $0.27/$1.10
  "sonar": { inputPer1M: 100, outputPer1M: 100 },                    // $1/$1
  "sonar-pro": { inputPer1M: 300, outputPer1M: 1500 },               // $3/$15
};

/**
 * Cost of a call in tenths of a cent. Unknown models fall back to Sonnet rates.
 *
 * `inputTokens` must be BILLABLE UNCACHED input. The two provider families
 * report it differently — Anthropic excludes cached tokens, OpenAI-shaped APIs
 * include them — so the normalisation happens at extraction in providers.ts,
 * and this function assumes it has already happened. Passing gross input here
 * double-counts every cached token.
 */
export function calculateCostTenths(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M * 10;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M * 10;

  // No verified cached rate means bill reads at FULL input price. That
  // OVERSTATES, deliberately: the ledger feeds a hard provider cap, and
  // understating would let spend run past it instead of tripping it. An
  // unverified rate should cost too much on paper, never too little.
  const cachedRate = rates.cachedInputPer1M ?? rates.inputPer1M;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * cachedRate * 10;

  // Writes are a premium on Anthropic and free elsewhere; an absent multiplier
  // means the provider does not bill them separately.
  const writeMultiplier = rates.cacheWriteMultiplier ?? 0;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * rates.inputPer1M * writeMultiplier * 10;

  return Math.round(inputCost + outputCost + cacheReadCost + cacheWriteCost);
}
