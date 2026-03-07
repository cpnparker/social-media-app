import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { fetchBlobContent } from "./blob-utils";

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
  webSearch?: boolean;
}

/* ─────────────── Model Registry ─────────────── */

interface ModelInfo {
  provider: "anthropic" | "xai" | "openai" | "gemini";
  apiModel: string;
  label: string;
  legacy?: boolean;
}

const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "claude-sonnet-4-6": {
    provider: "anthropic",
    apiModel: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
  },
  "gemini-2.5-pro": {
    provider: "gemini",
    apiModel: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
  },
  "gemini-2.5-flash": {
    provider: "gemini",
    apiModel: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
  },
  "gpt-4o": {
    provider: "openai",
    apiModel: "gpt-4o",
    label: "GPT-4o",
  },
  "gpt-4o-mini": {
    provider: "openai",
    apiModel: "gpt-4o-mini",
    label: "GPT-4o Mini",
  },
  "grok-4-1-fast": {
    provider: "xai",
    apiModel: "grok-4-1-fast",
    label: "Grok 4 Fast",
  },
  "grok-3-mini": {
    provider: "xai",
    apiModel: "grok-3-mini",
    label: "Grok 3 Mini",
  },
  // Legacy mappings for old conversations
  "claude-sonnet-4-20250514": {
    provider: "anthropic",
    apiModel: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    legacy: true,
  },
  "grok-3": {
    provider: "xai",
    apiModel: "grok-4-1-fast",
    label: "Grok 4 Fast",
    legacy: true,
  },
};

export function getAvailableModels() {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, info]) => !info.legacy)
    .map(([id, info]) => ({
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

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set. Add it to use GPT models.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not set. Add it to use Gemini models.");
  }
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

/* ─────────────── Helpers ─────────────── */

function splitSystemMessages(messages: AIMessage[]) {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");
  return { systemMessages, conversationMessages };
}

/** Build Anthropic content blocks from a message with optional attachments.
 *  Images and PDFs are fetched server-side and sent as base64 so
 *  Anthropic doesn't need to access our auth-gated proxy. */
async function buildAnthropicContent(
  msg: AIMessage
): Promise<string | Anthropic.MessageCreateParams["messages"][number]["content"]> {
  if (!msg.attachments?.length) return msg.content;

  const blocks: Anthropic.MessageCreateParams["messages"][number]["content"] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      try {
        const { buffer, contentType } = await fetchBlobContent(att.url);
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: contentType || att.type,
            data: buffer.toString("base64"),
          },
        } as any);
      } catch (err) {
        console.error(`[Anthropic] Failed to fetch image ${att.name}:`, err);
      }
    } else if (att.type === "application/pdf") {
      try {
        const { buffer } = await fetchBlobContent(att.url);
        blocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: buffer.toString("base64"),
          },
        } as any);
      } catch (err) {
        console.error(`[Anthropic] Failed to fetch PDF ${att.name}:`, err);
      }
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

/** Build OpenAI-format content blocks from a message with optional attachments.
 *  Images are base64-encoded as data URLs so xAI doesn't need our auth proxy. */
async function buildOpenAIContent(
  msg: AIMessage
): Promise<string | OpenAI.Chat.ChatCompletionContentPart[]> {
  if (!msg.attachments?.length) return msg.content;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      try {
        const { buffer, contentType } = await fetchBlobContent(att.url);
        const dataUrl = `data:${contentType || att.type};base64,${buffer.toString("base64")}`;
        parts.push({
          type: "image_url",
          image_url: { url: dataUrl },
        });
      } catch (err) {
        console.error(`[OpenAI] Failed to fetch image ${att.name}:`, err);
      }
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

/* ─────────────── Streaming Result ─────────────── */

export interface StreamResult {
  fullText: string;
  inputTokens: number;
  outputTokens: number;
}

/* ─────────────── Streaming Response (SSE) ─────────────── */

/**
 * Returns a ReadableStream that emits Server-Sent Events:
 *   data: {"token": "..."}
 *   data: [DONE]
 *
 * The caller can also pass `onComplete` to get the accumulated text
 * and token usage for saving to the database after streaming finishes.
 */
export function createStreamingResponse(
  messages: AIMessage[],
  config: AIProviderConfig,
  onComplete?: (result: StreamResult) => Promise<void>
): ReadableStream {
  const modelInfo = getModelInfo(config.model);

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let result: StreamResult = { fullText: "", inputTokens: 0, outputTokens: 0 };

      try {
        if (modelInfo.provider === "anthropic") {
          result = await streamAnthropic(messages, config, modelInfo.apiModel, controller, encoder);
        } else if (modelInfo.provider === "gemini") {
          result = await streamGemini(messages, config, modelInfo.apiModel, controller, encoder);
        } else if (modelInfo.provider === "openai") {
          result = await streamOpenAI(messages, config, modelInfo.apiModel, controller, encoder);
        } else {
          result = await streamXAI(messages, config, modelInfo.apiModel, controller, encoder);
        }

        // Notify caller with accumulated text + usage
        if (onComplete) {
          await onComplete(result);
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
): Promise<StreamResult> {
  const anthropic = getAnthropicClient();
  const { systemMessages, conversationMessages } = splitSystemMessages(messages);

  const systemText =
    config.systemPrompt ||
    systemMessages.map((m) => m.content).join("\n") ||
    undefined;

  // Build content blocks (async for base64 attachment conversion)
  const anthropicMessages = await Promise.all(
    conversationMessages.map(async (m) => ({
      role: m.role as "user" | "assistant",
      content: m.role === "user" ? await buildAnthropicContent(m) : m.content,
    }))
  );

  // Build optional tools array (web search for Claude)
  const tools: any[] | undefined = config.webSearch
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
    : undefined;

  const stream = anthropic.messages.stream({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    system: systemText,
    messages: anthropicMessages,
    ...(tools ? { tools } : {}),
  });

  let fullText = "";
  for await (const event of stream) {
    // Detect when Claude initiates a web search and notify the client
    if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      if (block?.type === "server_tool_use" && block?.name === "web_search") {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
        );
      }
    }
    if (
      event.type === "content_block_delta" &&
      (event.delta as any).type === "text_delta"
    ) {
      const token = (event.delta as any).text;
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
  }

  // Get token usage from the final message
  const finalMessage = await stream.finalMessage();
  const inputTokens = finalMessage.usage?.input_tokens || 0;
  const outputTokens = finalMessage.usage?.output_tokens || 0;

  return { fullText, inputTokens, outputTokens };
}

/* ─────────────── xAI (Grok) Streaming ─────────────── */

async function streamXAI(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<StreamResult> {
  const xai = getXAIClient();

  // When web search is enabled, use the Responses API
  if (config.webSearch) {
    return streamXAIResponses(messages, config, apiModel, controller, encoder, xai);
  }

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
      content: m.role === "user" ? await buildOpenAIContent(m) : m.content,
    } as any);
  }

  const stream = (await xai.chat.completions.create({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
  } as any)) as unknown as AsyncIterable<any>;

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) {
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
    // Capture usage from the final chunk
    if ((chunk as any).usage) {
      inputTokens = (chunk as any).usage.prompt_tokens || 0;
      outputTokens = (chunk as any).usage.completion_tokens || 0;
    }
  }

  return { fullText, inputTokens, outputTokens };
}

/** xAI Responses API streaming — used when web search is enabled */
async function streamXAIResponses(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  xai: OpenAI
): Promise<StreamResult> {
  // Build input array for Responses API
  const input: any[] = [];
  for (const m of messages) {
    input.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildOpenAIContent(m) : m.content,
    });
  }

  const stream = (await xai.responses.create({
    model: apiModel,
    instructions: config.systemPrompt || undefined,
    input,
    tools: [{ type: "web_search" as any }],
    stream: true,
  } as any)) as unknown as AsyncIterable<any>;

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let searchEmitted = false;

  for await (const event of stream) {
    // Detect web search starting
    if (!searchEmitted && event.type === "response.output_item.added") {
      const item = (event as any).item;
      if (item?.type === "web_search_call") {
        searchEmitted = true;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
        );
      }
    }
    // Stream text deltas
    if (event.type === "response.output_text.delta") {
      const token = (event as any).delta;
      if (token) {
        fullText += token;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
        );
      }
    }
    // Capture usage from completed event
    if (event.type === "response.completed") {
      const usage = (event as any).response?.usage;
      if (usage) {
        inputTokens = usage.input_tokens || 0;
        outputTokens = usage.output_tokens || 0;
      }
    }
  }

  return { fullText, inputTokens, outputTokens };
}

/* ─────────────── Gemini Streaming ─────────────── */

async function streamGemini(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<StreamResult> {
  const client = getGeminiClient();

  const geminiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Add system prompt
  const systemText = config.systemPrompt;
  if (systemText) {
    geminiMessages.push({ role: "system", content: systemText });
  }

  // Add conversation messages
  for (const m of messages) {
    geminiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildOpenAIContent(m) : m.content,
    } as any);
  }

  const stream = (await client.chat.completions.create({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    messages: geminiMessages,
    stream: true,
  } as any)) as unknown as AsyncIterable<any>;

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) {
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
    if ((chunk as any).usage) {
      inputTokens = (chunk as any).usage.prompt_tokens || 0;
      outputTokens = (chunk as any).usage.completion_tokens || 0;
    }
  }

  return { fullText, inputTokens, outputTokens };
}

/* ─────────────── OpenAI (GPT) Streaming ─────────────── */

async function streamOpenAI(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<StreamResult> {
  const client = getOpenAIClient();

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Add system prompt
  const systemText = config.systemPrompt;
  if (systemText) {
    openaiMessages.push({ role: "system", content: systemText });
  }

  // Add conversation messages
  for (const m of messages) {
    openaiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildOpenAIContent(m) : m.content,
    } as any);
  }

  const stream = (await client.chat.completions.create({
    model: apiModel,
    max_tokens: config.maxTokens || 4096,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
  } as any)) as unknown as AsyncIterable<any>;

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) {
      fullText += token;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
      );
    }
    if ((chunk as any).usage) {
      inputTokens = (chunk as any).usage.prompt_tokens || 0;
      outputTokens = (chunk as any).usage.completion_tokens || 0;
    }
  }

  return { fullText, inputTokens, outputTokens };
}
