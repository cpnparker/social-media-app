import { intelligenceDb } from "@/lib/supabase-intelligence";
import { calculateCostTenths } from "@/lib/ai/model-costs";

/**
 * Log AI usage to intelligence.ai_usage. Fire-and-forget.
 * Use for non-conversation AI calls (RFP, client context, etc.)
 */
export function logAiUsage(opts: {
  workspaceId?: string;
  userId?: number;
  model: string;
  source: string;
  /** BILLABLE UNCACHED input — normalised in providers.ts, not gross prompt tokens. */
  inputTokens: number;
  outputTokens: number;
  /** Optional so the ~40 background callers need no change; they do not cache. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): void {
  const costTenths = calculateCostTenths(
    opts.model,
    opts.inputTokens,
    opts.outputTokens,
    opts.cacheReadTokens || 0,
    opts.cacheWriteTokens || 0
  );

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
