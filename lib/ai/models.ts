/**
 * Client-safe AI model constants.
 * Used by both UI components and API routes.
 * Keep in sync with MODEL_REGISTRY in lib/ai/providers.ts.
 */

export const AI_MODELS = [
  { id: "auto", label: "EngineAI Auto", provider: "auto", description: "Best model for each query" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", description: "Complex reasoning & analysis" },
  { id: "grok-4-1-fast", label: "Grok 4 Fast", provider: "xai", description: "Fast, affordable, web search" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", description: "OpenAI's versatile flagship" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "gemini", description: "Fast, large context window" },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_MODEL: AIModelId = "auto";

/** Get display label for a model ID */
export function getModelLabel(modelId: string): string {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return model?.label ?? modelId;
}

/** Get provider for a model ID */
export function getModelProvider(modelId: string): string {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return model?.provider ?? "anthropic";
}
