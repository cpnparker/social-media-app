/**
 * Client-safe AI model constants.
 * Used by both UI components and API routes.
 * Keep in sync with MODEL_REGISTRY in lib/ai/providers.ts.
 */

export const AI_MODELS = [
  { id: "auto", label: "EngineAI Auto", provider: "auto", description: "Best model for each query" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", description: "Anthropic's most powerful model" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", description: "Complex agentic work, code & analysis" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", description: "Complex reasoning & analysis" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", description: "Fast, cheap Claude" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "openai", description: "OpenAI's most capable — premium" },
  { id: "gpt-5-6-terra", label: "GPT-5.6 Terra", provider: "openai", description: "OpenAI's balanced model" },
  { id: "grok-4-1-fast", label: "Grok 4.3 Fast", provider: "xai", description: "Cheapest — simple queries only" },
  { id: "grok-4-6", label: "Grok 4.6", provider: "xai", description: "xAI's flagship — most capable" },
  { id: "grok-4-3", label: "Grok 4.3", provider: "xai", description: "Strong and cheaper than 4.6" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "gemini", description: "Fast, cheap, 1M context" },
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

/**
 * Models retired from the picker that still appear on saved work.
 *
 * A conversation stores the model it ran on, and MessageBubble captions every
 * assistant reply with it — so dropping an id from AI_MODELS alone makes old
 * threads render the raw string "claude-opus-4-8" under their answers. That is
 * the same defect that had the content editor showing
 * "claude-sonnet-4-20250514" as its picker label.
 *
 * These are the TRUE labels, not the successor's. An answer written by Opus 4.8
 * should not be captioned "Claude Opus 5" — attribution on past work has to stay
 * honest even when the id is no longer selectable. (MODEL_REGISTRY takes the
 * opposite line for routing, where the point is which model answers next.)
 */
const LEGACY_MODEL_LABELS: Record<string, string> = {
  // Gemini's WIRE slug. The API's model list calls it gemini-3-flash-preview
  // while the picker offers "gemini-3-flash", and a row recording what actually
  // ran holds the wire name — without this it renders as a raw id.
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  // Both spellings for each GPT-5.6 model: getModelLabel falls back to the raw
  // id, so a row logged under the wire slug would caption a past answer
  // "gpt-5.6-luna" rather than name the model that wrote it.
  "gpt-5-6-luna": "GPT-5.6 Luna",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "grok-4.3": "Grok 4.3",
  "grok-4.6": "Grok 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
  "sonar": "Perplexity Sonar",
  "sonar-pro": "Perplexity Sonar Pro",
  "grok-4-1-fast-non-reasoning": "Grok 4 Fast",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
  "claude-haiku-3-20240307": "Claude Haiku 3",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "grok-3": "Grok 3",
  // Retired from the picker 2026-08-24: DeepSeek retired the alias on
  // 2026-07-24, so selecting it errored. Deliberately NOT repointed at
  // DeepSeek V4 — first-party DeepSeek stores data in the PRC.
  "deepseek-chat": "DeepSeek Chat",
  // Retired from the picker 2026-09-05: Google deprecated Gemini 3 Flash and
  // our slug was the PREVIEW one, which is a shutdown notice away from 404ing.
  // Superseded by gemini-3.8-flash. The label stays so historic messages and
  // saved preferences still render a name rather than a raw id.
  "gemini-3-flash": "Gemini 3 Flash",
};

/** Get display label for a model ID */
export function getModelLabel(modelId: string): string {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return model?.label ?? LEGACY_MODEL_LABELS[modelId] ?? modelId;
}

/** Get provider for a model ID */
export function getModelProvider(modelId: string): string {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return model?.provider ?? "anthropic";
}
