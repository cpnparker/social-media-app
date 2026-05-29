/**
 * Client-safe AI model constants.
 * Used by both UI components and API routes.
 * Keep in sync with MODEL_REGISTRY in lib/ai/providers.ts.
 */

export const AI_MODELS = [
  { id: "auto", label: "EngineAI Auto", provider: "auto", description: "Best model for each query" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", description: "Top-tier reasoning, code & long-form" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", description: "Complex reasoning & analysis" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", description: "Fast, cheap Claude" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", description: "OpenAI's versatile flagship" },
  { id: "grok-4-1-fast", label: "Grok 4 Fast", provider: "xai", description: "Fast, affordable, web search" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "gemini", description: "Fast, large context window" },
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "deepseek", description: "Fast & cost-effective open model" },
] as const;

/**
 * Video generation models — separate from AI_MODELS because they don't route
 * through the chat streamers. Surfaced in Design mode's video tool picker.
 */
export const VIDEO_MODELS = [
  { id: "runway-gen-4-turbo", label: "Runway Gen-4 Turbo", provider: "runway", description: "Best image/text-to-video (5-10s clips)" },
  { id: "runway-gen-3-alpha", label: "Runway Gen-3 Alpha", provider: "runway", description: "Higher fidelity, slower" },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
export const DEFAULT_VIDEO_MODEL: VideoModelId = "runway-gen-4-turbo";

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
