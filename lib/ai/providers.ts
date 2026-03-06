import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/* ─────────────── Types ─────────────── */

export interface AIAttachment {
  url: string;
  name: string;
  type: string; // MIME type
  extractedText?: string; // Pre-extracted text for documents
}

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: AIAttachment[];
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

/** Build Anthropic content blocks from a message with optional attachments */
function buildAnthropicContent(
  msg: AIMessage
): string | Anthropic.MessageCreateParams["messages"][number]["content"] {
  if (!msg.attachments?.length) return msg.content;

  const blocks: Anthropic.MessageCreateParams["messages"][number]["content"] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      // Native image vision block
      blocks.push({
        type: "image",
        source: { type: "url", url: att.url },
      } as any);
    } else if (att.type === "application/pdf") {
      // Native PDF document block for Claude
      blocks.push({
        type: "document",
        source: { type: "url", url: att.url },
      } as any);
    } else if (att.extractedText) {
      // Other docs: include extracted text
      blocks.push({
        type: "text",
        text: `[Document: ${att.name}]\n${att.extractedText}`,
      });
    }
  }

  // Add the user's text message
  if (msg.content.trim()) {
    blocks.push({ type: "text", text: msg.content });
  }

  return blocks;
}

/** Build OpenAI-format content blocks from a message with optional attachments */
function buildOpenAIContent(
  msg: AIMessage
): string | OpenAI.Chat.ChatCompletionContentPart[] {
  if (!msg.attachments?.length) return msg.content;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      // Image vision block
      parts.push({
        type: "image_url",
        image_url: { url: att.url },
      });
    } else if (att.extractedText) {
      // Documents: include extracted text
      parts.push({
        type: "text",
        text: `[Document: ${att.name}]\n${att.extractedText}`,
      });
    }
  }

  // Add the user's text message
  if (msg.content.trim()) {
    parts.push({ type: "text", text: msg.content });
  }

  return parts;
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
      content: m.role === "user" ? buildAnthropicContent(m) : m.content,
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
      content: m.role === "user" ? buildOpenAIContent(m) : m.content,
    } as any);
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
