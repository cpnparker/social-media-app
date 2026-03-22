import { intelligenceDb } from "@/lib/supabase-intelligence";

// Cost per million tokens in cents (matching messages route)
const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 },
  "gpt-4o": { inputPer1M: 250, outputPer1M: 1000 },
  "gpt-4o-mini": { inputPer1M: 15, outputPer1M: 60 },
  "gpt-4.1": { inputPer1M: 200, outputPer1M: 800 },
  "grok-4-1-fast": { inputPer1M: 20, outputPer1M: 50 },
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },
  "grok-3": { inputPer1M: 300, outputPer1M: 1500 },
  "grok-4": { inputPer1M: 200, outputPer1M: 1000 },
  "mistral-large-latest": { inputPer1M: 200, outputPer1M: 600 },
  "gemini-2.5-flash": { inputPer1M: 15, outputPer1M: 60 },
  "gemini-3-flash": { inputPer1M: 50, outputPer1M: 300 },
  "gemini-3.1-flash-lite": { inputPer1M: 25, outputPer1M: 150 },
};

function calculateCostTenths(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M * 10;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M * 10;
  return Math.round(inputCost + outputCost);
}

/**
 * Log AI usage to intelligence.ai_usage. Fire-and-forget.
 * Use for non-conversation AI calls (RFP, client context, etc.)
 */
export function logAiUsage(opts: {
  workspaceId?: string;
  userId?: number;
  model: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
}): void {
  const costTenths = calculateCostTenths(opts.model, opts.inputTokens, opts.outputTokens);

  Promise.resolve(
    intelligenceDb.from("ai_usage").insert({
      type_app: "engine",
      id_workspace: opts.workspaceId || null,
      user_usage: opts.userId || 0,
      name_model: opts.model,
      type_source: opts.source,
      units_input: opts.inputTokens,
      units_output: opts.outputTokens,
      units_cost_tenths: costTenths,
      id_conversation: null,
    })
  ).then(({ error }) => {
    if (error) console.error("[AI Usage] Log failed:", error.message);
  }).catch(() => {});
}
