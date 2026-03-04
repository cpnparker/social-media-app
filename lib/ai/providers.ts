import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/* ─────────────── Types ─────────────── */

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIProviderConfig {
  model: string;
  maxTokens?: number;
  systemPrompt?: string;
}

/* ─────────────── Model Registry ─────────────── */

interface ModelInfo {
  provider: "anthropic" | "xai";
  apiModel: string;
  label: string;
}

const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "claude-sonnet-4-20250514": {
    provider: "anthropic",
    apiModel: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
  },
  "grok-3": {
    provider: "xai",
    apiModel: "grok-3",
    label: "Grok 3",
  },
  "grok-3-mini": {
    provider: "xai",
    apiModel: "grok-3-mini",
    label: "Grok 3 Mini",
  },
};

export function getAvailableModels() {
  return Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
    id,
    label: info.label,
    provider: info.provider,
  }));
}

export function getModelInfo(modelId: string): ModelInfo {
  return MODEL_REGISTRY[modelId] || MODEL_REGISTRY["claude-sonnet-4-20250514"];
}

/* ─────────────── Provider Clients ─────────────── */

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY environment variable is not set. Add it to use Grok models.");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

/* ─────────────── Helpers ─────────────── */

function splitSystemMessages(messages: AIMessage[]) {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");
  return { systemMessages, conversationMessages };
}

/* ─────────────── Streaming Response (SSE) ─────────────── */

/**
 * Returns a ReadableStream that emits Server-Sent Events:
 *   data: {"token": "..."}
 *   data: [DONE]
 *
 * The caller can also pass `onComplete` to get the accumulated text
 * for saving to the database after streaming finishes.
 */
export function createStreamingResponse(
  messages: AIMessage[],
  config: AIProviderConfig,
  onComplete?: (fullText: string) => Promise<void>
): ReadableStream {
  const modelInfo = getModelInfo(config.model);

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullText = "";

      try {
        if (modelInfo.provider === "anthropic") {
          fullText = await streamAnthropic(messages, config, modelInfo.apiModel, controller, encoder);
        } else {
          fullText = await streamXAI(messages, config, modelInfo.apiModel, controller, encoder);
        }

        // Notify caller with accumulated text
        if (onComplete) {
          await onComplete(fullText);
        }
      } catch (error: any) {
        const errMsg = error?.message || "Unknown error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

/* ─────────────── Anthropic Streaming ─────────────── */

async function streamAnthropic(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<string> {
  const anthropic = getAnthropicClient();
  const { systemMessages, conversationMessages } = splitSystemMessages(messages);

  const systemText =
    config.systemPrompt ||
    systemMessages.map((m) => m.content).join("\n") ||
    undefined;

  const stream = anthropic.messages.stream({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    system: systemText,
    messages: conversationMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  let fullText = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const token = event.delta.text;
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
  }

  return fullText;
}

/* ─────────────── xAI (Grok) Streaming ─────────────── */

async function streamXAI(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<string> {
  const xai = getXAIClient();

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Add system prompt
  const systemText = config.systemPrompt;
  if (systemText) {
    openaiMessages.push({ role: "system", content: systemText });
  }

  // Add conversation messages (including any system messages from history)
  for (const m of messages) {
    openaiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    });
  }

  const stream = await xai.chat.completions.create({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    messages: openaiMessages,
    stream: true,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
  }

  return fullText;
}
