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
export const RATES_VERIFIED_ON = "2026-09-23";

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
  // $2/$10 is PERMANENT. Anthropic cancelled the 1 Sep rise to $3/$15 on
  // 2026-08-10 (verified against platform.claude.com 2026-08-24). Do not add
  // an expiry for this row on the strength of an older pricing table.
  "claude-sonnet-5": { inputPer1M: 200, outputPer1M: 1000, cachedInputPer1M: 20, cacheWriteMultiplier: 1.25 },     // $2/$10, cache $0.20
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },       // $3/$15
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 },
  "claude-haiku-4-5": { inputPer1M: 100, outputPer1M: 500, cachedInputPer1M: 10, cacheWriteMultiplier: 1.25 },    // $1/$5, cache $0.10
  // Keyed by the REGISTRY id, which is what route.ts prices by — not by
  // apiModel. Added dotted-only, these fell through to the Sonnet fallback at
  // the bottom of this file and billed $3/$15 instead of $2/$12. Both spellings
  // are kept: the registry id is what the ledger looks up, the apiModel is what
  // shows in provider-side reporting.
  "gpt-6-astra": { inputPer1M: 1000, outputPer1M: 5000, cachedInputPer1M: 100 },  // $10/$50, cache $1
  "gpt-5-6-terra": { inputPer1M: 200, outputPer1M: 1200 },           // $2/$12
  "gpt-5.6-terra": { inputPer1M: 200, outputPer1M: 1200 },           // $2/$12
  "gpt-5.6-luna": { inputPer1M: 20, outputPer1M: 120 },              // $0.20/$1.20
  // Both spellings, deliberately. The dashed key is the registry id and the
  // dotted one is the wire slug; whichever a caller happens to log, it must
  // price the same. A dotted-only key falls through to the Sonnet-4.6 fallback
  // at $3/$15 — 15x over — which is exactly how Terra was once mispriced.
  // No cachedInputPer1M: no verified cached rate for this model, and an
  // absent one bills reads at full input price, which overstates on purpose.
  "gpt-5-6-luna": { inputPer1M: 20, outputPer1M: 120 },              // $0.20/$1.20
  // $4/$20, and PROMOTIONAL: OpenAI's pricing page says "promotional pricing
  // through November 21, 2026". Was recorded at $5/$30. See RATE_EXPIRIES.
  "gpt-5.6-sol": { inputPer1M: 400, outputPer1M: 2000, cachedInputPer1M: 40 },
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
  // Wire slugs, priced as their dashed twins. Same model, same bill — only the
  // spelling differs, and call sites do not agree on which one they log.
  // Several send grok-4.3 today; without these rows those calls bill at the
  // $3/$15 fallback, which is the grok-4-1-fast mispricing with the sign
  // flipped. Kept beside the twin so the two move together.
  "grok-4.3": { inputPer1M: 125, outputPer1M: 250, cachedInputPer1M: 20 },        // $1.25/$2.50, cache $0.20
  "grok-4.6": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50
  "claude-haiku-4-5-20251001": { inputPer1M: 100, outputPer1M: 500, cachedInputPer1M: 10, cacheWriteMultiplier: 1.25 }, // $1/$5
  "grok-4-6": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50
  "grok-4-5": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 30 },        // $2/$6, cache $0.30
  // grok-3 and grok-4 are ALIASES: xAI redirects both to grok-4.3 and bills
  // them at its rate. Priced at $3/$15 and $2/$10 they overstated every row
  // logged under either id.
  "grok-3": { inputPer1M: 125, outputPer1M: 250, cachedInputPer1M: 20 },          // serves grok-4.3
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },                // $0.30/$0.50
  "grok-4": { inputPer1M: 125, outputPer1M: 250, cachedInputPer1M: 20 },          // serves grok-4.3
  "mistral-large-latest": { inputPer1M: 200, outputPer1M: 600 },     // $2/$6
  // ── Added 2026-09-23. Priced BEFORE any routing constant names them, which
  // is the order that matters: getModelInfo answers an unknown id with
  // claude-sonnet-5 and calculateCostTenths prices one at the sonnet-4-6
  // fallback, both silently, so a half-added model routes somewhere else at
  // the wrong price and reports nothing.
  "claude-opus-5-5": { inputPer1M: 400, outputPer1M: 2000, cachedInputPer1M: 20, cacheWriteMultiplier: 1.25 }, // $4/$20, cache $0.20
  // Cache read $0.25 — a quarter of Fable 5's $1.00, at the same $10/$50 base.
  // Verified on platform.claude.com/docs/en/about-claude/pricing 2026-09-23.
  "claude-fable-5-1": { inputPer1M: 1000, outputPer1M: 5000, cachedInputPer1M: 25, cacheWriteMultiplier: 1.25 }, // $10/$50, cache $0.25
  "grok-4.7": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50 — same as 4.6
  // The registry id, as its dashed twin: route.ts prices by registry id.
  "grok-4-7": { inputPer1M: 200, outputPer1M: 600, cachedInputPer1M: 50 },        // $2/$6, cache $0.50
  "gpt-6-luna": { inputPer1M: 10, outputPer1M: 50, cachedInputPer1M: 1 },         // $0.10/$0.50, cache $0.01
  "gpt-6-sol": { inputPer1M: 200, outputPer1M: 1000, cachedInputPer1M: 20 },      // $2/$10, cache $0.20
  // $0.30/$2.50 on ai.google.dev. Was recorded at $0.15/$0.60 — understated
  // 2x on input and 4.2x on output, in the direction this file calls unsafe,
  // because the ledger it feeds backs a hard spend cap.
  // RETIRING: Google limits 2.5 access to existing callers and retires the
  // series no earlier than 2026-10-16.
  "gemini-2.5-flash": { inputPer1M: 30, outputPer1M: 250 },          // $0.30/$2.50
  "gemini-2.5-pro": { inputPer1M: 125, outputPer1M: 1000 },          // $1.25/$10
  // $0.50/$3.00, cache $0.05 — verified on ai.google.dev 2026-09-23, where it
  // is listed as "Gemini 3 Flash Preview".
  //
  // THIS ROW WAS "CORRECTED" TO THE WRONG VALUE. It read $0.50/$3, was changed
  // to $0.75/$3.75 as an understatement, and $0.50/$3 was right all along: the
  // edit conflated this id with gemini-3.8-flash, which genuinely is $0.75/$3.75
  // promotional. Google publishes NO promotional end date for gemini-3-flash, so
  // its RATE_EXPIRIES entry was an alarm set for a day nothing happens on, and
  // has been removed.
  "gemini-3-flash": { inputPer1M: 50, outputPer1M: 300, cachedInputPer1M: 5 },
  "gemini-3.8-flash": { inputPer1M: 75, outputPer1M: 375, cachedInputPer1M: 7.5 }, // $0.75/$3.75 intro, DOUBLES 2027-01-01
  // The WIRE slug as well as the registry id. calculateCostTenths is called
  // with whichever string the caller holds, and an unknown one prices at the
  // claude-sonnet-4-6 fallback without a word — so a row keyed only by the
  // dashed id leaves every actual Gemini call mispriced.
  "gemini-3-flash-preview": { inputPer1M: 50, outputPer1M: 300, cachedInputPer1M: 5 },
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

/**
 * Rates that are known to expire, with the date and what replaces them.
 *
 * A promotional rate is a correct rate that becomes a wrong one on a schedule.
 * Nothing in the code notices the day it turns, so the ledger simply starts
 * understating — and understating is the direction this file calls dangerous
 * everywhere else, because the ledger feeds a hard provider cap and a figure
 * that is too low lets spend run past it instead of tripping it.
 *
 * A comment would not have helped. The failure is a DATE passing, so the check
 * is a date comparison: scripts/verify-model-ids.ts fails once one of these is
 * in the past and prints the rate to put in its place. The reminder is the
 * build, not somebody's memory.
 */
export const RATE_EXPIRIES: {
  model: string;
  /** Last day the current rate is correct, inclusive. ISO date. */
  until: string;
  /** The rate that replaces it, where the provider has published one.
   *
   *  NULL when the provider says a rate ENDS but not what succeeds it. That
   *  is a real and common case — OpenAI dates the end of GPT-5.6 Sol's
   *  promotion and names no successor rate — and the table could not express
   *  it before, which left two bad options: invent a number, or record no
   *  expiry and rely on somebody's memory. This file exists because the
   *  second one does not work, and the first is how a check starts crying
   *  wolf. Null says "on this date, go and read the provider's page", and the
   *  verifier prints exactly that. */
  then: { inputPer1M: number; outputPer1M: number } | null;
  why: string;
}[] = [
  {
    model: "gemini-3.8-flash",
    until: "2026-12-31",
    then: { inputPer1M: 150, outputPer1M: 750 },
    why: "Google's introductory rate for Gemini 3.8 Flash runs to 2026-12-31; from 2027-01-01 it doubles to $1.50/$7.50. Verified on ai.google.dev 2026-09-05.",
  },
  {
    model: "gpt-5.6-sol",
    until: "2026-11-21",
    then: null,
    why:
      "OpenAI's pricing page says GPT-5.6 Sol's $4/$20 'promotional pricing is " +
      "available at least through November 21, 2026' — a floor, not an end date — " +
      "and does NOT publish what replaces it (developers.openai.com/api/docs/pricing, " +
      "re-read 2026-09-23). There is no number to pre-apply, so this entry carries " +
      "none — on that date, read the page.",
  },
  // REMOVED 2026-09-23: gemini-3-flash. It recorded a doubling on 2027-01-01
  // that Google does not publish for that id — the entry was written against
  // gemini-3.8-flash's promotion and attached to the wrong model, and the rate
  // row was edited to match the wrong entry. Both are now the provider's own
  // figures ($0.50/$3.00, no promotional end date).
  //
  // This is the same near-miss as the claude-sonnet-5 note below, and it got
  // further: the alarm was set AND the rate was changed to fit it. An expiry
  // is a claim about the provider's schedule, so it needs the provider's page,
  // not a sibling row that looks similar.
  // NOT claude-sonnet-5. Its $2/$10 reads like an introductory rate and was
  // one, but Anthropic made it permanent on 2026-08-10 and the 1 Sep rise to
  // $3/$15 will not occur. An expiry was added here on the strength of a
  // pricing table cached in June and removed the same day on the strength of
  // the provider's own page — which is the rule this file already states:
  // verify against the PROVIDER's docs, never a secondhand table.
  //
  // Worth keeping the near-miss written down. A check that fires on a date
  // nothing happens on is not a harmless spare alarm; it is the thing that
  // teaches people to skip the output, and it would have gone off in a week.
];

/**
 * Models a provider has DATED for shutdown.
 *
 * The failure a rate table cannot see: a model keeps its correct price right
 * up to the day every call to it 404s. scripts/verify-model-ids.ts fails the
 * build from `from` onward while anything the app sends still names the
 * model — a registry apiModel, a routing constant, the cheap tier, the
 * fallback, an image model — and prints a warning in the 30 days before.
 *
 * Same rule as RATE_EXPIRIES: a date goes in only from the provider's own
 * page, never a secondhand table. An alarm on a day nothing happens teaches
 * people to skip the output.
 */
export const MODEL_SHUTDOWNS: { model: string; from: string; replacedBy: string; source: string }[] = [
  {
    model: "gpt-image-1",
    from: "2026-10-23",
    replacedBy: "gpt-image-2",
    source: "developers.openai.com/api/docs/deprecations, checked 2026-09-23",
  },
  {
    model: "dall-e-3",
    from: "2026-05-12",
    replacedBy: "gpt-image-2",
    source: "developers.openai.com/api/docs/deprecations, checked 2026-09-23",
  },
  {
    model: "sonar",
    from: "2026-09-27",
    replacedBy: "the Perplexity Agent API",
    source: "docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview, checked 2026-09-23",
  },
  {
    model: "sonar-pro",
    from: "2026-09-27",
    replacedBy: "the Perplexity Agent API",
    source: "docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview, checked 2026-09-23",
  },
  {
    // "No earlier than" — Google's own wording. Access is already limited to
    // callers who used 2.5 before 2026-09-18.
    model: "gemini-2.5-pro",
    from: "2026-10-16",
    replacedBy: "gemini-3.8-flash",
    source: "ai.google.dev/gemini-api/docs/deprecations and release notes 2026-09-18, checked 2026-09-23",
  },
  {
    model: "gemini-2.5-flash",
    from: "2026-10-16",
    replacedBy: "gemini-3.8-flash",
    source: "ai.google.dev/gemini-api/docs/deprecations and release notes 2026-09-18, checked 2026-09-23",
  },
];
