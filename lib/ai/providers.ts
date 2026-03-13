import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { put } from "@vercel/blob";
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
  imageGeneration?: boolean;
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
  "gemini-3-flash": {
    provider: "gemini",
    apiModel: "gemini-3-flash",
    label: "Gemini 3 Flash",
  },
  "gemini-3.1-flash-lite": {
    provider: "gemini",
    apiModel: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
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
    apiModel: "grok-4-1-fast-non-reasoning",
    label: "Grok 4 Fast",
  },
  "grok-3-mini": {
    provider: "xai",
    apiModel: "grok-3-mini",
    label: "Grok 3 Mini",
  },
  // Legacy mappings for old conversations
  "gemini-2.5-pro": {
    provider: "gemini",
    apiModel: "gemini-3-flash",
    label: "Gemini 3 Flash",
    legacy: true,
  },
  "gemini-2.5-flash": {
    provider: "gemini",
    apiModel: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    legacy: true,
  },
  "claude-sonnet-4-20250514": {
    provider: "anthropic",
    apiModel: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    legacy: true,
  },
  "grok-3": {
    provider: "xai",
    apiModel: "grok-4-1-fast-non-reasoning",
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

/** Build xAI-compatible message content from a message with optional attachments.
 *  xAI's Chat Completions API doesn't fully support OpenAI's multi-part content
 *  array format for documents — inline document text into the message string and
 *  only use content arrays when there are actual images. */
async function buildXAIContent(
  msg: AIMessage
): Promise<string | OpenAI.Chat.ChatCompletionContentPart[]> {
  if (!msg.attachments?.length) return msg.content;

  // Separate images from documents
  const imageParts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  const docTexts: string[] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      try {
        const { buffer, contentType } = await fetchBlobContent(att.url);
        const dataUrl = `data:${contentType || att.type};base64,${buffer.toString("base64")}`;
        imageParts.push({
          type: "image_url",
          image_url: { url: dataUrl },
        });
      } catch (err) {
        console.error(`[xAI] Failed to fetch image ${att.name}:`, err);
      }
    } else if (att.extractedText) {
      docTexts.push(`[Document: ${att.name}]\n${att.extractedText}`);
    }
  }

  // Build the text part: inline document text + user message
  const textParts = [...docTexts];
  if (msg.content.trim()) textParts.push(msg.content);
  const combinedText = textParts.join("\n\n");

  // If there are images, use content array format (xAI supports vision)
  if (imageParts.length > 0) {
    return [
      ...imageParts,
      { type: "text" as const, text: combinedText },
    ];
  }

  // No images — return plain string (avoids xAI ModelInput deserialization issues)
  return combinedText;
}

/* ─────────────── Image Generation (Multi-Provider) ─────────────── */

/** Anthropic tool definition for generate_image */
const IMAGE_GEN_TOOL: Anthropic.Tool = {
  name: "generate_image",
  description:
    "Generate an image using AI. Use this when the user asks you to create, design, produce, or mockup any visual content — including social media graphics, illustrations, diagrams, mockups, carousels, infographics, or any image. Always use this tool instead of describing what an image would look like in text.",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed image generation prompt. Include style, composition, colors, text content, and all visual details. Be specific and descriptive.",
      },
      size: {
        type: "string",
        enum: ["1024x1024", "1792x1024", "1024x1792"],
        description:
          "1024x1024 for square (social posts, profile images), 1792x1024 for landscape (headers, banners, presentations), 1024x1792 for portrait (stories, pins, posters). Default: 1024x1024",
      },
    },
    required: ["prompt"],
  },
};

/** OpenAI-compatible function calling tool definition for generate_image */
const IMAGE_GEN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate an image using AI. Use this when the user asks you to create, design, produce, or mockup any visual content — including social media graphics, illustrations, diagrams, mockups, carousels, infographics, or any image. Always use this tool instead of describing what an image would look like in text.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed image generation prompt. Include style, composition, colors, text content, and all visual details. Be specific and descriptive.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1792x1024", "1024x1792"],
          description:
            "1024x1024 for square (social posts, profile images), 1792x1024 for landscape (headers, banners, presentations), 1024x1792 for portrait (stories, pins, posters). Default: 1024x1024",
        },
      },
      required: ["prompt"],
    },
  },
};

type ImageProvider = "openai" | "xai" | "anthropic" | "gemini";

/**
 * Generate an image and store in Vercel Blob.
 * Routes to the appropriate image API based on provider:
 *   - openai: DALL-E 3 (returns URL)
 *   - xai: grok-2-image (returns base64 via xAI API)
 *   - anthropic: delegates to openai (DALL-E 3)
 *   - gemini: delegates to openai (DALL-E 3)
 */
async function generateImage(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024",
  provider: ImageProvider = "openai"
): Promise<string> {
  let imageBuffer: Buffer;

  if (provider === "xai") {
    // xAI: use grok-2-image via the xAI OpenAI-compatible client
    const xai = getXAIClient();
    const response = await xai.images.generate({
      model: "grok-2-image",
      prompt,
      n: 1,
    } as any);

    const imageData = response.data?.[0];
    if (!imageData) throw new Error("Grok image generation returned no data");

    if ((imageData as any).b64_json) {
      // base64 response
      imageBuffer = Buffer.from((imageData as any).b64_json, "base64");
    } else if (imageData.url) {
      // URL response — download it
      const imageRes = await fetch(imageData.url);
      if (!imageRes.ok) throw new Error("Failed to download generated image from xAI");
      imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    } else {
      throw new Error("Grok image generation returned no image data");
    }
  } else {
    // OpenAI (DALL-E 3) — used by openai, anthropic, and gemini providers
    const openai = getOpenAIClient();
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size,
      quality: "standard",
    });

    const tempUrl = response.data?.[0]?.url;
    if (!tempUrl) throw new Error("DALL-E returned no image URL");

    const imageRes = await fetch(tempUrl);
    if (!imageRes.ok) throw new Error("Failed to download generated image");
    imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  }

  // Upload to Vercel Blob for permanent storage
  const filename = `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const blob = await put(filename, imageBuffer, {
    access: "public",
    contentType: "image/png",
  });

  return blob.url;
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
  const anthropicMessages: Anthropic.MessageParam[] = await Promise.all(
    conversationMessages.map(async (m) => ({
      role: m.role as "user" | "assistant",
      content: m.role === "user" ? await buildAnthropicContent(m) : m.content,
    }))
  );

  // Build optional tools array
  const tools: any[] = [];
  if (config.webSearch) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  }
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: Claude may request tool calls, which we execute and feed back.
  // Loop continues until the model's stop_reason is "end_turn" (no more tool calls).
  const MAX_TOOL_ROUNDS = 8; // Safety limit to prevent infinite loops
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: apiModel,
      max_tokens: config.maxTokens || 4096,
      system: systemText,
      messages: anthropicMessages,
      ...(tools.length > 0 ? { tools } : {}),
    });

    // Collect tool_use blocks from this round
    const toolUseBlocks: { id: string; name: string; input: any }[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    for await (const event of stream) {
      // Detect server tool use (web search — handled by Anthropic internally)
      if (event.type === "content_block_start") {
        const block = (event as any).content_block;
        if (block?.type === "server_tool_use" && block?.name === "web_search") {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
          );
        }
        // Detect our custom tool_use blocks (e.g. generate_image)
        if (block?.type === "tool_use") {
          currentToolId = block.id;
          currentToolName = block.name;
          currentToolInput = "";
          if (block.name === "generate_image") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
        }
      }

      // Accumulate tool input JSON
      if (
        event.type === "content_block_delta" &&
        (event.delta as any).type === "input_json_delta"
      ) {
        currentToolInput += (event.delta as any).partial_json || "";
      }

      // Tool use block completed — save it
      if (event.type === "content_block_stop" && currentToolId) {
        try {
          const input = currentToolInput ? JSON.parse(currentToolInput) : {};
          toolUseBlocks.push({ id: currentToolId, name: currentToolName, input });
        } catch {
          toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: {} });
        }
        currentToolId = "";
        currentToolName = "";
        currentToolInput = "";
      }

      // Stream text tokens to the client
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

    // Get usage from this round
    const finalMessage = await stream.finalMessage();
    totalInputTokens += finalMessage.usage?.input_tokens || 0;
    totalOutputTokens += finalMessage.usage?.output_tokens || 0;

    // If no tool calls were made, we're done
    if (finalMessage.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      break;
    }

    // Execute tool calls and build tool results
    // First, add the assistant's response (with tool_use blocks) to messages
    anthropicMessages.push({
      role: "assistant",
      content: finalMessage.content,
    });

    // Then add tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      if (tool.name === "generate_image") {
        try {
          const prompt = tool.input.prompt || "Generate an image";
          const size = tool.input.size || "1024x1024";
          const imageUrl = await generateImage(prompt, size, "anthropic");

          // Notify client with the generated image URL
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_ready: { url: imageUrl, prompt } })}\n\n`
            )
          );

          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Image generated successfully. URL: ${imageUrl}`,
          });
        } catch (err: any) {
          console.error("[ImageGen] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_error: err.message })}\n\n`
            )
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Image generation failed: ${err.message}`,
            is_error: true,
          });
        }
      } else {
        // Unknown tool — return error
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: "Tool not implemented",
          is_error: true,
        });
      }
    }

    // Add tool results as the next user message
    anthropicMessages.push({
      role: "user",
      content: toolResults,
    });
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
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

  // Add conversation messages — use xAI-specific content builder to avoid
  // multi-part array format issues with document attachments
  for (const m of messages) {
    openaiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildXAIContent(m) : m.content,
    } as any);
  }

  // Grok 4 models require max_completion_tokens instead of max_tokens
  const isGrok4 = apiModel.startsWith("grok-4");
  const tokenParam = isGrok4
    ? { max_completion_tokens: config.maxTokens || 4096 }
    : { max_tokens: config.maxTokens || 4096 };

  // Build tools array if image generation is enabled
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_OPENAI_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = (await xai.chat.completions.create({
      model: apiModel,
      ...tokenParam,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools } : {}),
    } as any)) as unknown as AsyncIterable<any>;

    // Collect tool calls from the streamed response
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason = "";

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) {
        // Usage-only chunk
        if ((chunk as any).usage) {
          totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
          totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
        }
        continue;
      }

      // Stream text content
      const token = choice.delta?.content;
      if (token) {
        fullText += token;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
        );
      }

      // Accumulate tool calls
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
          }
          const existing = toolCalls.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;

          // Emit generating_image indicator when we first detect the tool
          if (existing.name === "generate_image" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;

      // Capture usage
      if ((chunk as any).usage) {
        totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
        totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
      }
    }

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      break;
    }

    // Build the assistant message with tool_calls for the conversation
    const toolCallsArray = Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    openaiMessages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCallsArray,
    } as any);

    // Execute each tool call and add results
    for (const tc of toolCallsArray) {
      if (tc.function.name === "generate_image") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const prompt = input.prompt || "Generate an image";
          const size = input.size || "1024x1024";
          const imageUrl = await generateImage(prompt, size, "xai");

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_ready: { url: imageUrl, prompt } })}\n\n`
            )
          );

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl}`,
          } as any);
        } catch (err: any) {
          console.error("[ImageGen/xAI] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_error: err.message })}\n\n`
            )
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generation failed: ${err.message}`,
          } as any);
        }
      } else {
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Tool not implemented",
        } as any);
      }
    }

    // Reset fullText for the continuation (text from tool_calls round was partial)
    // Don't reset — we want to accumulate all text across rounds
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
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
  // Build input array for Responses API — use xAI-compatible content builder
  const input: any[] = [];
  for (const m of messages) {
    input.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildXAIContent(m) : m.content,
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

  // Build tools array if image generation is enabled
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_OPENAI_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = (await client.chat.completions.create({
      model: apiModel,
      max_tokens: config.maxTokens || 4096,
      messages: geminiMessages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    } as any)) as unknown as AsyncIterable<any>;

    // Collect tool calls from the streamed response
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason = "";

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) {
        if ((chunk as any).usage) {
          totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
          totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
        }
        continue;
      }

      // Stream text content
      const token = choice.delta?.content;
      if (token) {
        fullText += token;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
        );
      }

      // Accumulate tool calls
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
          }
          const existing = toolCalls.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;

          if (existing.name === "generate_image" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;

      if ((chunk as any).usage) {
        totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
        totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
      }
    }

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      break;
    }

    // Build the assistant message with tool_calls
    const toolCallsArray = Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    geminiMessages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCallsArray,
    } as any);

    // Execute each tool call
    for (const tc of toolCallsArray) {
      if (tc.function.name === "generate_image") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const prompt = input.prompt || "Generate an image";
          const size = input.size || "1024x1024";
          // Gemini delegates to OpenAI/DALL-E for image generation
          const imageUrl = await generateImage(prompt, size, "gemini");

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_ready: { url: imageUrl, prompt } })}\n\n`
            )
          );

          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl}`,
          } as any);
        } catch (err: any) {
          console.error("[ImageGen/Gemini] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_error: err.message })}\n\n`
            )
          );
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generation failed: ${err.message}`,
          } as any);
        }
      } else {
        geminiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Tool not implemented",
        } as any);
      }
    }
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
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

  // Build tools array if image generation is enabled
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_OPENAI_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = (await client.chat.completions.create({
      model: apiModel,
      max_tokens: config.maxTokens || 4096,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools } : {}),
    } as any)) as unknown as AsyncIterable<any>;

    // Collect tool calls from the streamed response
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason = "";

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) {
        if ((chunk as any).usage) {
          totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
          totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
        }
        continue;
      }

      // Stream text content
      const token = choice.delta?.content;
      if (token) {
        fullText += token;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
        );
      }

      // Accumulate tool calls
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
          }
          const existing = toolCalls.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;

          // Emit generating_image indicator when we first detect the tool
          if (existing.name === "generate_image" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;

      if ((chunk as any).usage) {
        totalInputTokens += (chunk as any).usage.prompt_tokens || 0;
        totalOutputTokens += (chunk as any).usage.completion_tokens || 0;
      }
    }

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      break;
    }

    // Build the assistant message with tool_calls for the conversation
    const toolCallsArray = Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    openaiMessages.push({
      role: "assistant",
      content: fullText || null,
      tool_calls: toolCallsArray,
    } as any);

    // Execute each tool call and add results
    for (const tc of toolCallsArray) {
      if (tc.function.name === "generate_image") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const prompt = input.prompt || "Generate an image";
          const size = input.size || "1024x1024";
          const imageUrl = await generateImage(prompt, size, "openai");

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_ready: { url: imageUrl, prompt } })}\n\n`
            )
          );

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl}`,
          } as any);
        } catch (err: any) {
          console.error("[ImageGen/OpenAI] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_error: err.message })}\n\n`
            )
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generation failed: ${err.message}`,
          } as any);
        }
      } else {
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Tool not implemented",
        } as any);
      }
    }
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
