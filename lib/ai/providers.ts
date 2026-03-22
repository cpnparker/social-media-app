import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { put } from "@vercel/blob";
import { fetchBlobContent } from "./blob-utils";
import { supabase } from "@/lib/supabase";

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
  temperature?: number;
  preserveLinks?: boolean;
  workspaceClientIds?: number[];
  workspaceId?: string;
  userId?: number;
  userEmail?: string;
  selectedClientId?: number;
}

/** Default temperature for user-facing chat. Lower than model defaults (~0.7-1.0)
 *  to reduce hallucination while preserving creativity for content writing. */
const DEFAULT_CHAT_TEMPERATURE = 0.4;

/* ─────────────── Tool Result Formatting ─────────────── */

const MAX_TOOL_RESULT_ROWS = 20;
const MAX_WEB_SEARCH_CHARS = 6000;

/** Format query_engine results with optional truncation to reduce token usage */
function formatToolResult(result: { data: any; count: number; total?: number; summary?: any; error?: string }): string {
  if (result.error) return `Query failed: ${result.error}`;
  let content = `Query returned ${result.count} rows.`;
  if (result.summary) {
    content += `\n\nSUMMARY (use these pre-calculated numbers):\n${JSON.stringify(result.summary, null, 2)}`;
  }
  if (result.total !== undefined) {
    content += `\nTotal: ${result.total}`;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const sample = rows.slice(0, MAX_TOOL_RESULT_ROWS);
  content += `\n\nData${rows.length > MAX_TOOL_RESULT_ROWS ? ` (first ${MAX_TOOL_RESULT_ROWS} of ${rows.length})` : ""}:\n${JSON.stringify(sample, null, 2)}`;
  content += `\nIf the user asked for a chart or graph, you MUST call generate_chart next with this data.`;
  return content;
}

/** Format MeetingBrain results with truncation */
function formatMeetingBrainResult(report: string, result: { data: any; count: number; error?: string }): string {
  if (result.error) return `MeetingBrain query failed: ${result.error}`;
  const rows = Array.isArray(result.data) ? result.data : [];
  const sample = rows.slice(0, MAX_TOOL_RESULT_ROWS);
  return `MeetingBrain ${report}: ${result.count} results\n${JSON.stringify(sample, null, 2)}${rows.length > MAX_TOOL_RESULT_ROWS ? `\n(showing first ${MAX_TOOL_RESULT_ROWS} of ${rows.length})` : ""}`;
}

/* ─────────────── Model Registry ─────────────── */

interface ModelInfo {
  provider: "anthropic" | "xai" | "openai" | "gemini";
  apiModel: string;
  label: string;
  legacy?: boolean;
}

const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "auto": {
    provider: "xai",
    apiModel: "grok-4-1-fast-non-reasoning",
    label: "EngineAI Auto",
  },
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

/* ─────────────── Image Compression ─────────────── */

/** Max image size for API calls (Anthropic limit is 5MB, use 4.5MB for safety) */
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

/**
 * Compress an image buffer if it exceeds the API size limit.
 * Returns the (possibly compressed) buffer and its content type.
 */
async function compressImageForAPI(
  buffer: Buffer,
  contentType: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (buffer.length <= MAX_IMAGE_BYTES) {
    return { buffer, contentType };
  }

  try {
    const sharp = (await import("sharp")).default;

    // Resize to max 1024px on longest side and convert to JPEG
    const compressed = await sharp(buffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    console.log(
      `[Image Compress] ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${(compressed.length / 1024 / 1024).toFixed(1)}MB`
    );

    return { buffer: compressed, contentType: "image/jpeg" };
  } catch (err) {
    console.error("[Image Compress] Failed, skipping image:", err);
    // If compression fails, return a tiny placeholder — better than crashing
    return { buffer: Buffer.from(""), contentType };
  }
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
  msg: AIMessage,
  isLatestUserMessage: boolean = true
): Promise<string | Anthropic.MessageCreateParams["messages"][number]["content"]> {
  if (!msg.attachments?.length) return msg.content;

  const blocks: Anthropic.MessageCreateParams["messages"][number]["content"] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      // Only include actual image data for the latest user message
      // Older images are described as text to avoid bloating the request
      if (!isLatestUserMessage) {
        blocks.push({ type: "text", text: `[Previously uploaded image: ${att.name}]` });
        continue;
      }
      try {
        const raw = await fetchBlobContent(att.url);
        const { buffer, contentType } = await compressImageForAPI(
          raw.buffer,
          raw.contentType || att.type
        );
        if (buffer.length === 0) continue;
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
  msg: AIMessage,
  isLatestUserMessage: boolean = true
): Promise<string | OpenAI.Chat.ChatCompletionContentPart[]> {
  if (!msg.attachments?.length) return msg.content;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      if (!isLatestUserMessage) {
        parts.push({ type: "text", text: `[Previously uploaded image: ${att.name}]` });
        continue;
      }
      try {
        const raw = await fetchBlobContent(att.url);
        const { buffer, contentType } = await compressImageForAPI(
          raw.buffer,
          raw.contentType || att.type
        );
        if (buffer.length === 0) continue;
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
  msg: AIMessage,
  isLatestUserMessage: boolean = true
): Promise<string | OpenAI.Chat.ChatCompletionContentPart[]> {
  if (!msg.attachments?.length) return msg.content;

  // Separate images from documents
  const imageParts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  const docTexts: string[] = [];

  for (const att of msg.attachments) {
    if (att.type.startsWith("image/")) {
      if (!isLatestUserMessage) {
        docTexts.push(`[Previously uploaded image: ${att.name}]`);
        continue;
      }
      try {
        const raw = await fetchBlobContent(att.url);
        const { buffer, contentType } = await compressImageForAPI(
          raw.buffer,
          raw.contentType || att.type
        );
        if (buffer.length === 0) continue;
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
    "Generate an image when the user asks for one. Use this tool for requests like 'create an image', 'generate a graphic', 'make an infographic', 'generate an image of these', etc. Do not use unsolicited — only when the user requests visual content.",
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
      "Generate an image when the user asks for one. Use this tool for requests like 'create an image', 'generate a graphic', 'make an infographic', 'generate an image of these', etc. Do not use unsolicited — only when the user requests visual content.",
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

/** OpenAI-compatible function calling tool definition for generate_document */
const DOCUMENT_GEN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_document",
    description:
      "Generate a PowerPoint presentation (.pptx) file when the user asks for a presentation, deck, slides, or pptx. Create structured slide content with appropriate layouts.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Presentation title (used on title slide and filename)",
        },
        slides: {
          type: "array",
          description: "Array of slides to generate",
          items: {
            type: "object",
            properties: {
              layout: {
                type: "string",
                enum: ["title", "content", "two-column", "section", "blank"],
                description:
                  "title = title slide with subtitle, content = heading + bullet points, two-column = side-by-side content, section = section divider, blank = empty slide",
              },
              title: {
                type: "string",
                description: "Slide heading text",
              },
              subtitle: {
                type: "string",
                description: "Subtitle text (primarily for title and section slides)",
              },
              body: {
                type: "string",
                description:
                  "Main text content. Use newlines for bullet points. Each line becomes a bullet.",
              },
              bodyRight: {
                type: "string",
                description: "Right column text (only for two-column layout). Each line becomes a bullet.",
              },
              notes: {
                type: "string",
                description: "Speaker notes for this slide",
              },
            },
            required: ["title"],
          },
        },
        theme: {
          type: "string",
          enum: ["professional", "modern", "bold", "minimal"],
          description:
            "Visual theme for the presentation. professional = navy/white corporate, modern = gradient/rounded, bold = dark background/high contrast, minimal = clean white/grey. Default: professional",
        },
      },
      required: ["title", "slides"],
    },
  },
};

/** Anthropic tool definition for generate_document */
const DOCUMENT_GEN_TOOL: Anthropic.Tool = {
  name: "generate_document",
  description:
    "Generate a PowerPoint presentation (.pptx) file when the user asks for a presentation, deck, slides, or pptx. Create structured slide content with appropriate layouts.",
  input_schema: {
    ...(DOCUMENT_GEN_OPENAI_TOOL.function.parameters as any),
  },
};

/* ─────────────── Chart Generation Tool ─────────────── */

/** OpenAI-compatible tool definition for generate_chart */
const CHART_GEN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_chart",
    description:
      "Generate a data-accurate chart (bar, line, pie, doughnut) from real data. Use this when the user asks for a chart, graph, or visualization of data. ALWAYS use real data from query_engine results — never approximate.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "pie", "doughnut", "horizontalBar"],
          description: "Chart type. bar = vertical bars, horizontalBar = horizontal bars, line = line graph, pie/doughnut = circular",
        },
        title: {
          type: "string",
          description: "Chart title displayed at the top",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "X-axis labels (categories). e.g. ['Jan', 'Feb', 'Mar'] or ['Client A', 'Client B']",
        },
        datasets: {
          type: "array",
          description: "Data series to plot",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Dataset name (shown in legend)" },
              data: { type: "array", items: { type: "number" }, description: "Numeric values matching the labels" },
              backgroundColor: { type: "string", description: "Color. Use hex like '#3498DB' or rgba" },
            },
            required: ["label", "data"],
          },
        },
        xAxisLabel: { type: "string", description: "X-axis label" },
        yAxisLabel: { type: "string", description: "Y-axis label" },
      },
      required: ["type", "title", "labels", "datasets"],
    },
  },
};

/** Anthropic tool definition for generate_chart */
const CHART_GEN_TOOL: Anthropic.Tool = {
  name: "generate_chart",
  description: CHART_GEN_OPENAI_TOOL.function.description!,
  input_schema: {
    ...(CHART_GEN_OPENAI_TOOL.function.parameters as any),
  },
};

/**
 * Generate a chart image using QuickChart.io API and store in Vercel Blob.
 */
async function generateChart(
  type: string,
  title: string,
  labels: string[],
  datasets: { label: string; data: number[]; backgroundColor?: string }[],
  xAxisLabel?: string,
  yAxisLabel?: string
): Promise<string> {
  const defaultColors = ["#3498DB", "#2ECC71", "#E74C3C", "#F39C12", "#9B59B6", "#1ABC9C", "#E67E22", "#34495E"];
  const isPie = type === "pie" || type === "doughnut";

  const chartConfig = {
    type: type === "horizontalBar" ? "horizontalBar" : type,
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: isPie
          ? labels.map((_, j) => defaultColors[j % defaultColors.length])
          : ds.backgroundColor || defaultColors[i % defaultColors.length],
        borderColor: isPie ? "#ffffff" : undefined,
        borderWidth: isPie ? 2 : undefined,
      })),
    },
    options: {
      title: { display: true, text: title, fontSize: 16, fontColor: "#333" },
      legend: { display: datasets.length > 1 || isPie },
      scales: isPie ? undefined : {
        xAxes: [{ scaleLabel: xAxisLabel ? { display: true, labelString: xAxisLabel } : undefined }],
        yAxes: [{ scaleLabel: yAxisLabel ? { display: true, labelString: yAxisLabel } : undefined, ticks: { beginAtZero: true } }],
      },
      plugins: {
        datalabels: isPie ? { display: true, color: "#fff", font: { weight: "bold" } } : { display: false },
      },
    },
  };

  // Use QuickChart GET URL (more reliable than POST for serverless)
  const chartJson = encodeURIComponent(JSON.stringify(chartConfig));
  const quickChartUrl = `https://quickchart.io/chart?c=${chartJson}&w=800&h=450&bkg=%23ffffff&f=png`;

  console.log(`[Chart] QuickChart URL length: ${quickChartUrl.length}`);

  // If URL is too long (>8000 chars), fall back to POST
  let response: Response;
  if (quickChartUrl.length > 8000) {
    response = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chart: chartConfig,
        width: 800,
        height: 450,
        backgroundColor: "#ffffff",
        format: "png",
      }),
    });
  } else {
    response = await fetch(quickChartUrl);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[Chart] QuickChart error: ${response.status}`, errorText.slice(0, 200));
    throw new Error(`Chart generation failed: ${response.status} ${response.statusText}`);
  }

  // Verify we got an actual image, not an error page
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("image")) {
    const body = await response.text().catch(() => "");
    console.error("[Chart] QuickChart returned non-image:", contentType, body.slice(0, 200));
    throw new Error("Chart API returned invalid response");
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());

  if (imageBuffer.length < 100) {
    throw new Error("Chart generation returned empty image");
  }

  // Upload to Vercel Blob
  const filename = `charts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const blob = await put(filename, imageBuffer, {
    access: "private",
    contentType: "image/png",
  });

  console.log(`[Chart] Generated: ${(imageBuffer.length / 1024).toFixed(0)}KB → ${blob.pathname}`);
  return `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
}

/* ─────────────── Engine Database Query Tool ─────────────── */

// IMPORTANT: social_posts_overview and app_posting_posts are NOT in the allowed tables list.
// The AI MUST use report="social_performance" for any social publishing/metrics questions.
// Direct queries on posting tables give wrong counts (no dedup by promo, missing data).
const ALLOWED_TABLES = ["app_content", "app_contracts", "app_clients", "app_tasks_content", "app_ideas", "app_social", "app_tasks_social"] as const;

const ALLOWED_COLUMNS: Record<string, string[]> = {
  app_content: [
    "id_content", "name_content", "type_content", "id_client", "name_client",
    "id_contract", "name_contract", "date_created", "date_completed", "date_spiked",
    "flag_completed", "flag_spiked", "units_content", "document_type",
    "information_brief", "information_audience", "information_platform",
    "name_topic_array", "name_campaign_array",
    "name_user_commissioned", "name_user_content_lead", "name_user_completed",
    "date_deadline_production", "date_deadline_publication",
  ],
  app_contracts: [
    "id_contract", "name_contract", "id_client", "name_client",
    "date_start", "date_end", "flag_active",
    "units_contract", "units_total_completed",
    "units_content_completed", "units_social_completed",
    "information_notes",
  ],
  app_clients: [
    "id_client", "name_client", "information_industry", "information_description",
    "information_guidelines", "link_website",
  ],
  app_tasks_content: [
    "id_task", "id_content", "name_content", "id_client", "name_client",
    "id_contract", "name_contract", "type_task", "type_content",
    "date_created", "date_completed", "date_deadline",
    "name_user_assignee", "name_user_assigner",
    "order_sort", "flag_task_current", "information_notes", "units_content",
  ],
  app_ideas: [
    "id_idea", "name_idea", "status", "id_client", "name_client",
    "date_created", "date_deadline",
    "flag_favourite", "flag_commissioned", "flag_pending", "flag_spiked",
    "information_brief",
  ],
  app_social: [
    "id_social", "name_social", "id_content", "id_client", "name_client",
    "id_contract", "name_contract", "network", "type_post",
    "date_created", "date_completed", "date_spiked",
    "flag_evergreen", "flag_replay", "units_content",
    "name_idea", "name_content",
  ],
  app_tasks_social: [
    "id_task", "id_social", "name_social", "id_client", "name_client",
    "id_contract", "name_contract", "network", "type_post", "type_task",
    "date_created", "date_completed", "date_deadline",
    "name_user_assignee", "name_user_assigner",
    "units_content", "information_notes", "flag_spiked",
  ],
  // NOTE: app_posting_posts and social_posts_overview are NOT queryable directly.
  // Use report="social_performance" for all social publishing/metrics questions.
};

const DEFAULT_COLUMNS: Record<string, string[]> = {
  app_content: ["id_content", "name_content", "type_content", "units_content", "flag_completed", "flag_spiked", "date_completed", "name_contract"],
  app_contracts: ["id_contract", "name_contract", "flag_active", "units_contract", "units_total_completed", "date_start", "date_end"],
  app_clients: ["id_client", "name_client", "information_industry"],
  app_tasks_content: ["id_task", "name_content", "type_task", "name_user_assignee", "date_deadline", "flag_task_current"],
  app_ideas: ["id_idea", "name_idea", "status", "name_client", "date_created"],
  app_social: ["id_social", "name_social", "network", "type_post", "date_completed", "units_content"],
  app_tasks_social: ["id_task", "name_social", "type_task", "name_user_assignee", "date_deadline", "network"],
  // app_posting_posts and social_posts_overview: use report="social_performance" instead
};

/** OpenAI-compatible function calling tool definition for query_engine */
const QUERY_ENGINE_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_engine",
    description:
      "Query The Content Engine database. Two modes: (1) 'table' mode for direct table queries, (2) 'report' mode for pre-built aggregate reports with joins. Use report mode for questions about CUs commissioned, production totals, or cross-table summaries.",
    parameters: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["commissioned_units", "completed_units", "pipeline_summary", "assigned_tasks", "social_performance"],
          description:
            "Run a pre-built report. commissioned_units = CUs from tasks created in period, completed_units = CUs completed in period, pipeline_summary = overview by status, assigned_tasks = current tasks assigned to a user, social_performance = social publishing data with engagement metrics (deduplicates by promo to give accurate post counts). MANDATORY: use social_performance for ANY question about how many posts were published, post performance, best posts, or engagement. Use the 'network' parameter to filter by platform.",
        },
        group_by: {
          type: "string",
          enum: ["client", "day", "week"],
          description: "How to group report results. 'client' = totals per client (default), 'day' = daily totals, 'week' = weekly totals",
        },
        date_from: {
          type: "string",
          description: "Start date for reports (ISO format, e.g. '2026-03-01')",
        },
        date_to: {
          type: "string",
          description: "End date for reports (ISO format, e.g. '2026-03-31'). Defaults to today.",
        },
        client_id: {
          type: "number",
          description: "Optional client ID to scope report to a single client",
        },
        assignee_name: {
          type: "string",
          description: "For assigned_tasks report: the person's name (e.g. 'Chris', 'Ceri', 'Katie'). Searches name_user_assignee with partial match.",
        },
        network: {
          type: "string",
          enum: ["linkedin", "facebook", "twitter", "instagram"],
          description: "For social_performance report: filter by social network. Values are lowercase.",
        },
        table: {
          type: "string",
          enum: [...ALLOWED_TABLES],
          description:
            "Table to query (for direct table mode). app_content = content pipeline, app_contracts = contracts, app_clients = clients, app_tasks_content = content workflow tasks, app_ideas = ideas, app_social = social promos (created/produced per network — NOT publishing data), app_tasks_social = social workflow tasks. IMPORTANT: For social publishing counts, metrics, or performance, you MUST use report='social_performance' — do NOT query any table directly for publishing data.",
        },
        columns: {
          type: "array",
          items: { type: "string" },
          description:
            "Columns to return. If omitted, returns default key columns.",
        },
        filters: {
          type: "array",
          description: "Filter conditions. Each has column, operator, and value.",
          items: {
            type: "object",
            properties: {
              column: { type: "string", description: "Column name" },
              operator: {
                type: "string",
                enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"],
                description: "eq = equals, neq = not equals, gt/gte/lt/lte = comparisons, ilike = case-insensitive text search, is = null check, in = one of array",
              },
              value: { description: "Value to compare. Use null for 'is null'. Use array for 'in'." },
            },
            required: ["column", "operator", "value"],
          },
        },
        order: {
          type: "object",
          properties: {
            column: { type: "string" },
            ascending: { type: "boolean" },
          },
          description: "Sort order. Default: date_created descending",
        },
        limit: {
          type: "number",
          description: "Max rows (default 25, max 100)",
        },
      },
      required: [],
    },
  },
};

/** Anthropic tool definition for query_engine */
const QUERY_ENGINE_TOOL: Anthropic.Tool = {
  name: "query_engine",
  description: QUERY_ENGINE_OPENAI_TOOL.function.description!,
  input_schema: {
    ...(QUERY_ENGINE_OPENAI_TOOL.function.parameters as any),
  },
};

/* ─────────────── Pre-built Reports ─────────────── */

/**
 * Commissioned CUs report — matches the Engine's commissioning metric.
 * Sums content_units from tasks created in the date range, joining through
 * content/social to get client info, excluding deleted/spiked items.
 */
async function reportCommissionedUnits(
  dateFrom: string,
  dateTo?: string,
  clientId?: number,
  groupBy: "client" | "day" | "week" = "client"
): Promise<{ data: any[]; total: number; error?: string; summary?: any }> {
  const endDate = dateTo || new Date().toISOString().slice(0, 10);

  // Query content tasks created in period
  let contentTasksQ = supabase
    .from("app_tasks_content")
    .select("name_client, id_client, units_content, name_content, type_content, type_task, date_created, flag_spiked, date_completed")
    .gte("date_created", dateFrom)
    .lte("date_created", endDate + "T23:59:59")
    .or("flag_spiked.eq.0,flag_spiked.is.null,date_completed.not.is.null");

  if (clientId) {
    contentTasksQ = contentTasksQ.eq("id_client", clientId);
  }

  // Query social tasks created in period
  let socialTasksQ = supabase
    .from("app_tasks_social")
    .select("name_client, id_client, units_content, name_social, network, type_task, date_created")
    .gte("date_created", dateFrom)
    .lte("date_created", endDate + "T23:59:59");

  if (clientId) {
    socialTasksQ = socialTasksQ.eq("id_client", clientId);
  }

  const [contentRes, socialRes] = await Promise.all([
    contentTasksQ.order("date_created", { ascending: true }).limit(1000),
    socialTasksQ.order("date_created", { ascending: true }).limit(1000),
  ]);

  if (contentRes.error) {
    console.error("[Report] Content tasks error:", contentRes.error.message);
    return { data: [], total: 0, error: contentRes.error.message };
  }

  const allTasks = [...(contentRes.data || []), ...(socialRes.data || [])];

  if (groupBy === "day") {
    // Aggregate by day — always daily granularity
    const dayTotals: Record<string, { date: string; content_units: number; task_count: number }> = {};
    for (const task of allTasks) {
      const key = task.date_created?.slice(0, 10) || "unknown";
      if (!dayTotals[key]) {
        dayTotals[key] = { date: key, content_units: 0, task_count: 0 };
      }
      dayTotals[key].content_units += task.units_content || 0;
      dayTotals[key].task_count++;
    }
    const timeTotals = dayTotals;
    const data = Object.values(timeTotals).sort((a, b) => a.date.localeCompare(b.date));
    const total = data.reduce((sum, d) => sum + d.content_units, 0);
    console.log(`[Report] Commissioned units daily ${dateFrom} to ${endDate}: ${total} CU across ${data.length} days`);
    return { data, total };
  }

  if (groupBy === "week") {
    // Aggregate by week (Monday start)
    const weekTotals: Record<string, { date: string; content_units: number; task_count: number }> = {};
    for (const task of allTasks) {
      const d = new Date(task.date_created || "2000-01-01");
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff));
      const key = `W/C ${weekStart.toISOString().slice(0, 10)}`;
      if (!weekTotals[key]) {
        weekTotals[key] = { date: key, content_units: 0, task_count: 0 };
      }
      weekTotals[key].content_units += task.units_content || 0;
      weekTotals[key].task_count++;
    }
    const data = Object.values(weekTotals).sort((a, b) => a.date.localeCompare(b.date));
    const total = data.reduce((sum, d) => sum + d.content_units, 0);
    console.log(`[Report] Commissioned units weekly ${dateFrom} to ${endDate}: ${total} CU across ${data.length} weeks`);
    return { data, total };
  }

  // Default: aggregate by client
  const clientTotals: Record<string, { client_name: string; client_id: number; content_units: number; task_count: number }> = {};
  for (const task of allTasks) {
    const key = task.name_client || "Unknown";
    if (!clientTotals[key]) {
      clientTotals[key] = { client_name: key, client_id: task.id_client, content_units: 0, task_count: 0 };
    }
    clientTotals[key].content_units += task.units_content || 0;
    clientTotals[key].task_count++;
  }

  const data = Object.values(clientTotals).sort((a, b) => b.content_units - a.content_units);
  const total = data.reduce((sum, c) => sum + c.content_units, 0);

  console.log(`[Report] Commissioned units ${dateFrom} to ${endDate}: ${total} CU across ${data.length} clients`);
  return { data, total };
}

/**
 * Completed CUs report — sums content_units from content completed in the date range.
 */
async function reportCompletedUnits(
  dateFrom: string,
  dateTo?: string,
  clientId?: number
): Promise<{ data: any[]; total: number; error?: string; summary?: any }> {
  const endDate = dateTo || new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("app_content")
    .select("name_client, id_client, units_content, name_content, type_content, date_completed")
    .eq("flag_completed", 1)
    .gte("date_completed", dateFrom)
    .lte("date_completed", endDate + "T23:59:59");

  if (clientId) {
    query = query.eq("id_client", clientId);
  }

  const { data: rows, error } = await query.order("date_completed", { ascending: false }).limit(500);

  if (error) {
    return { data: [], total: 0, error: error.message };
  }

  const clientTotals: Record<string, { client_name: string; client_id: number; content_units: number; item_count: number }> = {};
  for (const item of (rows || [])) {
    const key = item.name_client || "Unknown";
    if (!clientTotals[key]) {
      clientTotals[key] = { client_name: key, client_id: item.id_client, content_units: 0, item_count: 0 };
    }
    clientTotals[key].content_units += item.units_content || 0;
    clientTotals[key].item_count++;
  }

  const data = Object.values(clientTotals).sort((a, b) => b.content_units - a.content_units);
  const total = data.reduce((sum, c) => sum + c.content_units, 0);

  console.log(`[Report] Completed units ${dateFrom} to ${endDate}: ${total} CU across ${data.length} clients`);
  return { data, total };
}

/**
 * Pipeline summary — overview of all content by status.
 */
async function reportPipelineSummary(
  clientId?: number
): Promise<{ data: any; error?: string }> {
  let query = supabase
    .from("app_content")
    .select("name_client, type_content, units_content, flag_completed, flag_spiked");

  if (clientId) {
    query = query.eq("id_client", clientId);
  }

  const { data: rows, error } = await query.limit(1000);
  if (error) return { data: null, error: error.message };

  const items = rows || [];
  const commissioned = items.filter((c: any) => !c.flag_completed && !c.flag_spiked);
  const completed = items.filter((c: any) => c.flag_completed === 1);
  const spiked = items.filter((c: any) => c.flag_spiked === 1);

  const byType: Record<string, { count: number; cu: number }> = {};
  for (const item of items) {
    const t = item.type_content || "other";
    if (!byType[t]) byType[t] = { count: 0, cu: 0 };
    byType[t].count++;
    byType[t].cu += item.units_content || 0;
  }

  return {
    data: {
      total_items: items.length,
      commissioned: { count: commissioned.length, cu: commissioned.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      completed: { count: completed.length, cu: completed.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      spiked: { count: spiked.length, cu: spiked.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      by_type: byType,
    },
  };
}

/**
 * Assigned tasks report — current incomplete tasks for a user.
 * Queries content tasks (the current/first incomplete task per content item)
 * and social tasks, excluding deleted/spiked content.
 */
async function reportAssignedTasks(
  assigneeName?: string,
  clientId?: number
): Promise<{ data: any[]; total: number; error?: string; summary?: any }> {
  // Query incomplete content tasks
  let contentQ = supabase
    .from("app_tasks_content")
    .select("name_client, id_client, name_content, id_content, type_content, type_task, units_content, date_created, date_deadline, name_user_assignee, flag_task_current, order_sort")
    .is("date_completed", null)
    .or("flag_spiked.eq.0,flag_spiked.is.null");

  if (assigneeName) {
    contentQ = contentQ.ilike("name_user_assignee", `%${assigneeName}%`);
  }
  if (clientId) {
    contentQ = contentQ.eq("id_client", clientId);
  }

  // Query incomplete social tasks
  let socialQ = supabase
    .from("app_tasks_social")
    .select("name_client, id_client, name_social, id_social, network, type_task, units_content, date_created, date_deadline, name_user_assignee")
    .is("date_completed", null);

  if (assigneeName) {
    socialQ = socialQ.ilike("name_user_assignee", `%${assigneeName}%`);
  }
  if (clientId) {
    socialQ = socialQ.eq("id_client", clientId);
  }

  const [contentRes, socialRes] = await Promise.all([
    contentQ.order("date_created", { ascending: false }).limit(100),
    socialQ.order("date_created", { ascending: false }).limit(50),
  ]);

  if (contentRes.error) {
    console.error("[Report] Assigned tasks error:", contentRes.error.message);
    return { data: [], total: 0, error: contentRes.error.message };
  }

  // For content tasks: keep only the current/first task per content item
  // (each content piece can have multiple workflow tasks — writing, editing, review)
  const seenContent = new Set<number>();
  const contentTasks = (contentRes.data || []).filter((t: any) => {
    if (!t.id_content || seenContent.has(t.id_content)) return false;
    seenContent.add(t.id_content);
    return true;
  });

  const tasks = [
    ...contentTasks.map((t: any) => ({
      type: "content" as const,
      client: t.name_client,
      client_id: t.id_client,
      content: t.name_content,
      content_id: t.id_content,
      content_type: t.type_content,
      task: t.type_task,
      cu: t.units_content || 0,
      assignee: t.name_user_assignee,
      created: t.date_created?.slice(0, 10),
      deadline: t.date_deadline?.slice(0, 10),
    })),
    ...(socialRes.data || []).map((t: any) => ({
      type: "social" as const,
      client: t.name_client,
      client_id: t.id_client,
      content: t.name_social,
      content_id: t.id_social,
      content_type: t.network,
      task: t.type_task,
      cu: t.units_content || 0,
      assignee: t.name_user_assignee,
      created: t.date_created?.slice(0, 10),
      deadline: t.date_deadline?.slice(0, 10),
    })),
  ];

  const totalCU = tasks.reduce((s, t) => s + t.cu, 0);
  console.log(`[Report] Assigned tasks for ${assigneeName || "all"}: ${tasks.length} tasks, ${totalCU} CU`);

  return { data: tasks, total: tasks.length };
}

/**
 * Social Performance Report
 *
 * Data model:
 *   app_social           — promos (creative content per network). Has name_social.
 *   app_posting_posts     — published posts but INCOMPLETE (some posts missing).
 *   social_posts_overview — view with ALL publishing events + metrics. Most complete source.
 *                           But name_post is often empty and one promo (id_social) can have
 *                           multiple rows (retries, edits). Must deduplicate by id_social.
 *
 * Strategy:
 *   1. Query social_posts_overview for posts published in date range (no error).
 *   2. Deduplicate by id_social — pick the best row per promo (highest metrics, has link).
 *   3. Enrich with post names from app_social (since social_posts_overview.name_post is empty).
 *   4. Count = unique promos with at least one successful publish.
 */
async function reportSocialPerformance(
  dateFrom?: string,
  dateTo?: string,
  clientId?: number,
  network?: string
): Promise<{ data: any[]; total: number; error?: string; summary?: any }> {
  const endDate = dateTo || new Date().toISOString().slice(0, 10);
  // Default to start of current year if no date_from provided
  const currentYearStart = `${new Date().getFullYear()}-01-01`;
  const startDate = dateFrom || currentYearStart;

  console.log(`[Report:Social] Query: startDate=${startDate}, endDate=${endDate}, clientId=${clientId}, network=${network}`);

  // Step 1: Query social_posts_overview — the most complete source of publishing data
  let postsQ = supabase
    .from("social_posts_overview")
    .select("id_post, id_social, id_content, id_client, id_contract, network, type_post, date_published, date_post, date_scheduled, metrics_score, error_post_key, link_post, name_post")
    .not("date_published", "is", null)
    .gte("date_published", startDate)
    .lte("date_published", endDate + "T23:59:59")
    .neq("id_client", 2); // Exclude test client

  if (clientId) {
    postsQ = postsQ.eq("id_client", clientId);
  }
  if (network) {
    postsQ = postsQ.eq("network", network.toLowerCase());
  }

  const { data: rawPosts, error: postsErr } = await postsQ
    .order("metrics_score", { ascending: false, nullsFirst: false })
    .limit(1000);

  if (postsErr) {
    console.error("[Report:Social] social_posts_overview error:", postsErr.message);
    return { data: [], total: 0, error: postsErr.message };
  }

  console.log(`[Report:Social] social_posts_overview returned: ${(rawPosts || []).length} raw rows`);

  if (!rawPosts || rawPosts.length === 0) {
    return { data: [], total: 0, summary: {} };
  }

  // Step 2: Deduplicate by id_social — pick the best row per promo
  // Priority: no error > has link_post > highest metrics_score > latest date_published
  const promoMap: Record<number, typeof rawPosts[0]> = {};
  for (const post of rawPosts) {
    const existing = promoMap[post.id_social];
    if (!existing) {
      promoMap[post.id_social] = post;
      continue;
    }
    // Prefer row without error
    const existHasError = !!existing.error_post_key;
    const newHasError = !!post.error_post_key;
    if (existHasError && !newHasError) {
      promoMap[post.id_social] = post;
      continue;
    }
    if (!existHasError && newHasError) continue;
    // Prefer row with link_post
    if (!existing.link_post && post.link_post) {
      promoMap[post.id_social] = post;
      continue;
    }
    if (existing.link_post && !post.link_post) continue;
    // Prefer higher metrics
    if ((post.metrics_score || 0) > (existing.metrics_score || 0)) {
      promoMap[post.id_social] = post;
    }
  }

  const dedupedPosts = Object.values(promoMap);
  // Filter out promos where the best attempt had an error
  const successfulPosts = dedupedPosts.filter(p => !p.error_post_key);

  console.log(`[Report:Social] Deduplicated: ${dedupedPosts.length} unique promos, ${successfulPosts.length} published (no error)`);

  // Step 3: Enrich with names from app_social (social_posts_overview.name_post is often empty)
  const socialIds = successfulPosts.map(p => p.id_social);
  const nameMap: Record<number, string> = {};

  for (let i = 0; i < socialIds.length; i += 100) {
    const chunk = socialIds.slice(i, i + 100);
    const { data: promos } = await supabase
      .from("app_social")
      .select("id_social, name_social")
      .in("id_social", chunk);
    if (promos) {
      for (const p of promos) {
        nameMap[p.id_social] = p.name_social || "";
      }
    }
  }

  // Step 4: Build final results
  const results = successfulPosts.map((post) => ({
    id_social: post.id_social,
    id_content: post.id_content,
    name: (nameMap[post.id_social] || post.name_post || "").slice(0, 120),
    network: post.network,
    type_post: post.type_post,
    date_published: post.date_published?.slice(0, 19),
    metrics_score: post.metrics_score || 0,
    link_post: post.link_post,
  }));

  // Sort by metrics_score descending (best performing first)
  results.sort((a, b) => (b.metrics_score || 0) - (a.metrics_score || 0));

  // Build per-network summary
  const networkSummary: Record<string, { published: number; totalScore: number; avgScore: number; topPost?: any }> = {};
  for (const r of results) {
    const net = r.network || "unknown";
    if (!networkSummary[net]) networkSummary[net] = { published: 0, totalScore: 0, avgScore: 0 };
    networkSummary[net].published++;
    networkSummary[net].totalScore += r.metrics_score || 0;
    if (!networkSummary[net].topPost || (r.metrics_score || 0) > (networkSummary[net].topPost.metrics_score || 0)) {
      networkSummary[net].topPost = { id_social: r.id_social, name: r.name, metrics_score: r.metrics_score, link_post: r.link_post };
    }
  }
  // Calculate averages
  for (const net of Object.keys(networkSummary)) {
    networkSummary[net].avgScore = Math.round((networkSummary[net].totalScore / networkSummary[net].published) * 10) / 10;
  }

  console.log(`[Report:Social] ${results.length} published promos, summary: ${JSON.stringify(networkSummary)}`);
  return { data: results.slice(0, 100), total: results.length, summary: networkSummary };
}

interface QueryFilter {
  column: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in";
  value: any;
}

/**
 * Execute a safe, read-only database query against the Content Engine.
 * All inputs are validated against allowlists. Queries are workspace-scoped.
 */
async function queryEngine(
  table: string | undefined,
  columns?: string[],
  filters?: QueryFilter[],
  order?: { column: string; ascending: boolean },
  limit?: number,
  workspaceClientIds?: number[],
  report?: string,
  dateFrom?: string,
  dateTo?: string,
  clientId?: number,
  groupBy?: "client" | "day" | "week",
  assigneeName?: string,
  args?: Record<string, any>
): Promise<{ data: any; count: number; total?: number; error?: string; summary?: any }> {
  // Report mode — run pre-built aggregate queries
  if (report) {
    switch (report) {
      case "commissioned_units": {
        if (!dateFrom) return { data: [], count: 0, error: "date_from is required for commissioned_units report" };
        const result = await reportCommissionedUnits(dateFrom, dateTo, clientId, groupBy || "client");
        return { data: result.data, count: result.data.length, total: result.total, error: result.error };
      }
      case "completed_units": {
        if (!dateFrom) return { data: [], count: 0, error: "date_from is required for completed_units report" };
        const result = await reportCompletedUnits(dateFrom, dateTo, clientId);
        return { data: result.data, count: result.data.length, total: result.total, error: result.error };
      }
      case "pipeline_summary": {
        const result = await reportPipelineSummary(clientId);
        return { data: result.data, count: 1, error: result.error };
      }
      case "assigned_tasks": {
        const result = await reportAssignedTasks(assigneeName, clientId);
        return { data: result.data, count: result.data.length, total: result.total, error: result.error };
      }
      case "social_performance": {
        const result = await reportSocialPerformance(dateFrom, dateTo, clientId, args?.network);
        return { data: result.data, count: result.data.length, total: result.total, error: result.error, summary: result.summary };
      }
      default:
        return { data: [], count: 0, error: `Unknown report: ${report}` };
    }
  }

  // Table query mode
  if (!table) return { data: [], count: 0, error: "Either 'table' or 'report' is required" };

  // Validate table
  if (!ALLOWED_TABLES.includes(table as any)) {
    return { data: [], count: 0, error: `Invalid table: ${table}` };
  }

  const allowedCols = ALLOWED_COLUMNS[table];

  // Validate & filter columns
  const selectedCols = columns?.length
    ? columns.filter((c) => allowedCols.includes(c))
    : DEFAULT_COLUMNS[table] || allowedCols.slice(0, 8);

  if (selectedCols.length === 0) {
    return { data: [], count: 0, error: "No valid columns selected" };
  }

  // Build query
  let query = supabase.from(table).select(selectedCols.join(","));

  // Workspace scoping — auto-filter by client IDs if the table has id_client
  if (workspaceClientIds?.length && allowedCols.includes("id_client")) {
    query = query.in("id_client", workspaceClientIds);
  }

  // Apply filters
  if (filters?.length) {
    for (const f of filters) {
      if (!allowedCols.includes(f.column)) continue; // skip invalid columns
      switch (f.operator) {
        case "eq": query = query.eq(f.column, f.value); break;
        case "neq": query = query.neq(f.column, f.value); break;
        case "gt": query = query.gt(f.column, f.value); break;
        case "gte": query = query.gte(f.column, f.value); break;
        case "lt": query = query.lt(f.column, f.value); break;
        case "lte": query = query.lte(f.column, f.value); break;
        case "like": query = query.like(f.column, f.value); break;
        case "ilike": query = query.ilike(f.column, f.value); break;
        case "is": query = query.is(f.column, f.value); break;
        case "in":
          if (Array.isArray(f.value)) query = query.in(f.column, f.value);
          break;
      }
    }
  }

  // Order
  if (order?.column && allowedCols.includes(order.column)) {
    query = query.order(order.column, { ascending: order.ascending ?? false });
  } else {
    // Default sort by date_created if available
    if (allowedCols.includes("date_created")) {
      query = query.order("date_created", { ascending: false });
    }
  }

  // Limit
  const maxRows = Math.min(Math.max(limit || 25, 1), 100);
  query = query.limit(maxRows);

  const { data, error } = await query;

  if (error) {
    console.error("[QueryEngine] Supabase error:", error.message);
    return { data: [], count: 0, error: error.message };
  }

  console.log(`[QueryEngine] ${table}: ${data?.length || 0} rows returned (limit ${maxRows})`);
  return { data: data || [], count: data?.length || 0 };
}

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
    // xAI: use grok-imagine-image via the xAI OpenAI-compatible client
    const xai = getXAIClient();
    const response = await xai.images.generate({
      model: "grok-imagine-image",
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
  let blob;
  try {
    blob = await put(filename, imageBuffer, {
      access: "private",
      contentType: "image/png",
    });
  } catch (err: any) {
    console.error("[Image Gen] Blob upload failed:", err?.message);
    throw err;
  }

  // Serve through auth proxy for access control
  return `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
}

/* ─────────────── Document Generation (PPTX) ─────────────── */

interface SlideInput {
  layout?: "title" | "content" | "two-column" | "section" | "blank";
  title: string;
  subtitle?: string;
  body?: string;
  bodyRight?: string;
  notes?: string;
}

interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textLight: string;
  background: string;
  titleFont: string;
  bodyFont: string;
}

const THEMES: Record<string, ThemeColors> = {
  professional: {
    primary: "1B2A4A",
    secondary: "2C5F8A",
    accent: "3498DB",
    text: "1B2A4A",
    textLight: "FFFFFF",
    background: "FFFFFF",
    titleFont: "Georgia",
    bodyFont: "Calibri",
  },
  modern: {
    primary: "6366F1",
    secondary: "8B5CF6",
    accent: "06B6D4",
    text: "1E293B",
    textLight: "FFFFFF",
    background: "F8FAFC",
    titleFont: "Helvetica",
    bodyFont: "Helvetica",
  },
  bold: {
    primary: "18181B",
    secondary: "DC2626",
    accent: "F59E0B",
    text: "FFFFFF",
    textLight: "FFFFFF",
    background: "18181B",
    titleFont: "Arial Black",
    bodyFont: "Arial",
  },
  minimal: {
    primary: "374151",
    secondary: "6B7280",
    accent: "10B981",
    text: "111827",
    textLight: "FFFFFF",
    background: "FFFFFF",
    titleFont: "Helvetica",
    bodyFont: "Helvetica",
  },
};

async function generateDocument(
  title: string,
  slides: SlideInput[],
  theme: string = "professional"
): Promise<{ url: string; filename: string }> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pres = new PptxGenJS();

  const colors = THEMES[theme] || THEMES.professional;
  const isDark = theme === "bold";

  pres.title = title;
  pres.author = "EngineAI";
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

  // Define slide master for consistent styling
  pres.defineSlideMaster({
    title: "MAIN",
    background: { color: isDark ? colors.primary : colors.background },
  });

  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];
    const layout = slideData.layout || (i === 0 ? "title" : "content");
    const s = pres.addSlide({ masterName: "MAIN" });

    // Add speaker notes if provided
    if (slideData.notes) {
      s.addNotes(slideData.notes);
    }

    switch (layout) {
      case "title": {
        // Full-slide title with accent bar
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: "100%",
          fill: { color: colors.primary },
        });
        // Accent stripe
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 4.8, w: "100%", h: 0.08,
          fill: { color: colors.accent },
        });
        s.addText(slideData.title, {
          x: 0.8, y: 1.5, w: 11.7, h: 2.5,
          fontSize: 36, fontFace: colors.titleFont,
          color: colors.textLight, bold: true,
          align: "left", valign: "bottom",
        });
        if (slideData.subtitle) {
          s.addText(slideData.subtitle, {
            x: 0.8, y: 5.1, w: 11.7, h: 1.2,
            fontSize: 18, fontFace: colors.bodyFont,
            color: colors.accent, align: "left", valign: "top",
          });
        }
        break;
      }

      case "section": {
        // Section divider slide
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: "100%",
          fill: { color: colors.secondary },
        });
        s.addShape(pres.ShapeType.rect, {
          x: 0.8, y: 3.2, w: 3, h: 0.06,
          fill: { color: colors.accent },
        });
        s.addText(slideData.title, {
          x: 0.8, y: 1.5, w: 11.7, h: 1.5,
          fontSize: 32, fontFace: colors.titleFont,
          color: colors.textLight, bold: true,
          align: "left", valign: "bottom",
        });
        if (slideData.subtitle || slideData.body) {
          s.addText(slideData.subtitle || slideData.body || "", {
            x: 0.8, y: 3.5, w: 11.7, h: 2,
            fontSize: 16, fontFace: colors.bodyFont,
            color: colors.textLight, align: "left", valign: "top",
          });
        }
        break;
      }

      case "two-column": {
        // Header bar
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: 1.4,
          fill: { color: colors.primary },
        });
        s.addText(slideData.title, {
          x: 0.8, y: 0.2, w: 11.7, h: 1,
          fontSize: 24, fontFace: colors.titleFont,
          color: colors.textLight, bold: true,
          align: "left", valign: "middle",
        });

        // Left column
        const leftBullets = parseBullets(slideData.body || "");
        if (leftBullets.length > 0) {
          s.addText(leftBullets, {
            x: 0.8, y: 1.8, w: 5.5, h: 5,
            fontSize: 14, fontFace: colors.bodyFont,
            color: isDark ? colors.textLight : colors.text,
            lineSpacingMultiple: 1.3,
            valign: "top",
          });
        }

        // Vertical divider
        s.addShape(pres.ShapeType.rect, {
          x: 6.55, y: 1.8, w: 0.03, h: 4.5,
          fill: { color: colors.accent },
        });

        // Right column
        const rightBullets = parseBullets(slideData.bodyRight || "");
        if (rightBullets.length > 0) {
          s.addText(rightBullets, {
            x: 7, y: 1.8, w: 5.5, h: 5,
            fontSize: 14, fontFace: colors.bodyFont,
            color: isDark ? colors.textLight : colors.text,
            lineSpacingMultiple: 1.3,
            valign: "top",
          });
        }
        break;
      }

      case "blank": {
        // Just the title if provided
        if (slideData.title) {
          s.addText(slideData.title, {
            x: 0.8, y: 0.4, w: 11.7, h: 0.8,
            fontSize: 20, fontFace: colors.titleFont,
            color: isDark ? colors.textLight : colors.text,
            bold: true, align: "left",
          });
        }
        if (slideData.body) {
          s.addText(slideData.body, {
            x: 0.8, y: 1.5, w: 11.7, h: 5.5,
            fontSize: 14, fontFace: colors.bodyFont,
            color: isDark ? colors.textLight : colors.text,
            valign: "top",
          });
        }
        break;
      }

      case "content":
      default: {
        // Standard content slide with header bar
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: 1.4,
          fill: { color: colors.primary },
        });
        // Accent bar under header
        s.addShape(pres.ShapeType.rect, {
          x: 0, y: 1.4, w: "100%", h: 0.05,
          fill: { color: colors.accent },
        });
        s.addText(slideData.title, {
          x: 0.8, y: 0.2, w: 11.7, h: 1,
          fontSize: 24, fontFace: colors.titleFont,
          color: colors.textLight, bold: true,
          align: "left", valign: "middle",
        });

        if (slideData.body) {
          const bullets = parseBullets(slideData.body);
          s.addText(bullets, {
            x: 0.8, y: 1.8, w: 11.7, h: 5,
            fontSize: 15, fontFace: colors.bodyFont,
            color: isDark ? colors.textLight : colors.text,
            lineSpacingMultiple: 1.4,
            valign: "top",
          });
        }
        break;
      }
    }

    // Slide number (skip title slide)
    if (layout !== "title") {
      s.addText(`${i + 1}`, {
        x: 12, y: 6.9, w: 0.8, h: 0.4,
        fontSize: 10, fontFace: colors.bodyFont,
        color: isDark ? "666666" : "AAAAAA",
        align: "right",
      });
    }
  }

  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  const filename = `presentations/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pptx`;

  const blob = await put(filename, buffer, {
    access: "private",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });

  const url = `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
  const displayName = `${title.replace(/[^a-zA-Z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60)}.pptx`;
  return { url, filename: displayName };
}

/** Parse text lines into pptxgenjs bullet point format */
function parseBullets(text: string): Array<{ text: string; options?: any }> {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [{ text: "" }];

  return lines.map((line) => {
    // Remove common bullet prefixes
    const cleaned = line.replace(/^[\s]*[-•*]\s*/, "").replace(/^\d+\.\s*/, "").trim();
    return {
      text: cleaned,
      options: { bullet: { type: "bullet" }, paraSpaceBefore: 4, paraSpaceAfter: 4 },
    };
  });
}

/* ─────────────── Web Search Tool (for xAI) ─────────────── */

/** OpenAI-compatible tool definition for web_search (xAI only — Anthropic/Gemini have native web search) */
const WEB_SEARCH_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information, news, facts, or research. Use when the user asks about external topics like news headlines, industry trends, company information, regulations, current events, or anything that requires up-to-date information from the internet. Do NOT use for internal Engine data (use query_engine instead).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. Be specific and include key terms.",
        },
      },
      required: ["query"],
    },
  },
};

/**
 * Execute a web search via xAI's Responses API and return text results.
 * Always uses grok-3-mini for speed and cost efficiency.
 */
async function executeWebSearch(
  query: string,
  _systemPrompt?: string,
  _model?: string
): Promise<string> {
  const xai = getXAIClient();
  const WEB_SEARCH_TIMEOUT = 30_000; // 30 second timeout

  try {
    const searchPromise = (xai.responses.create as any)({
      model: "grok-4-1-fast", // Only grok-4 family supports web_search tool — fast and cheap ($0.20/$0.50)
      temperature: 0.3,
      instructions: "You are a web research assistant. Search the web and return factual, well-sourced information. Include source URLs where possible. Be concise.",
      input: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }],
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Web search timed out after 30s")), WEB_SEARCH_TIMEOUT)
    );

    const response = await Promise.race([searchPromise, timeoutPromise]);

    let searchResults = "";
    if (response?.output) {
      for (const item of response.output) {
        if (item.type === "message" && item.content) {
          for (const block of item.content) {
            if (block.type === "output_text") {
              searchResults += block.text || "";
            }
          }
        }
      }
    }

    console.log(`[WebSearch] Query: "${query.slice(0, 60)}" → ${searchResults.length} chars`);
    const trimmed = (searchResults || "No results found.").slice(0, MAX_WEB_SEARCH_CHARS);
    return trimmed;
  } catch (err: any) {
    console.error("[WebSearch] Failed:", err?.message);
    return `Web search failed: ${err?.message}`;
  }
}

/* ─────────────── MeetingBrain Query Tool ─────────────── */

const MEETINGBRAIN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_meetingbrain",
    description:
      "Query the MeetingBrain database for personal tasks, meetings, and meeting notes. Use when the user asks about their to-do list, action items, meeting summaries, or searches for something discussed in a meeting.",
    parameters: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["my_tasks", "meetings", "search_meetings"],
          description: "my_tasks = open tasks/action items, meetings = recent/upcoming with summaries, search_meetings = search by keyword",
        },
        query: { type: "string", description: "Search keyword for search_meetings" },
        status: { type: "string", enum: ["open", "completed", "all"], description: "Task status filter. Default: open" },
        days: { type: "number", description: "Meetings lookback/forward window in days. Default: 14" },
        person_name: { type: "string", description: "Query for another person by first name. Default: current user" },
      },
      required: ["report"],
    },
  },
};

const MEETINGBRAIN_TOOL: Anthropic.Tool = {
  name: "query_meetingbrain",
  description: MEETINGBRAIN_OPENAI_TOOL.function.description!,
  input_schema: { ...(MEETINGBRAIN_OPENAI_TOOL.function.parameters as any) },
};

let _neonPool: any = null;
function getNeonPool() {
  if (!_neonPool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require("pg");
    _neonPool = new pg.Pool({
      connectionString: process.env.NEON_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    // Handle stale connections gracefully
    _neonPool.on("error", (err: any) => {
      console.error("[MeetingBrain] Pool error:", err.message);
      _neonPool = null; // Force pool recreation on next call
    });
  }
  return _neonPool;
}

async function queryMeetingBrain(
  report: string,
  userEmail: string,
  options: { query?: string; status?: string; days?: number; personName?: string } = {}
): Promise<{ data: any; count: number; error?: string }> {
  if (!process.env.NEON_DATABASE_URL) {
    return { data: [], count: 0, error: "MeetingBrain database not configured" };
  }
  const pool = getNeonPool();
  try {
    // Find user by email or name
    let mbUserId: string | null = null;
    if (options.personName) {
      const { rows } = await pool.query('SELECT id FROM "User" WHERE name ILIKE $1 LIMIT 1', [`%${options.personName}%`]);
      mbUserId = rows[0]?.id || null;
    } else {
      const { rows } = await pool.query('SELECT id FROM "User" WHERE email = $1 LIMIT 1', [userEmail]);
      mbUserId = rows[0]?.id || null;
    }
    if (!mbUserId) return { data: [], count: 0, error: `User not found: ${options.personName || userEmail}` };

    switch (report) {
      case "my_tasks": {
        const sf = options.status === "completed" ? "AND t.status = 'DONE'" : options.status === "all" ? "" : "AND t.status != 'DONE'";
        const { rows } = await pool.query(`
          SELECT t.title, t.description, t.status, t.responsible, t.deadline,
                 t."createdAt", pm."meetingTitle" as source_meeting, pm."meetingDate" as meeting_date
          FROM "Task" t LEFT JOIN "ProcessedMeeting" pm ON t."meetingId" = pm.id
          WHERE t."userId" = $1 ${sf}
          ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'TODO' THEN 1 ELSE 2 END, t."createdAt" DESC
          LIMIT 50
        `, [mbUserId]);
        const data = rows.map((r: any) => ({
          title: r.title, description: r.description?.slice(0, 200) || null,
          status: r.status, responsible: r.responsible,
          deadline: r.deadline?.toISOString()?.slice(0, 10) || null,
          created: r.createdAt?.toISOString()?.slice(0, 10),
          from_meeting: r.source_meeting || null,
        }));
        console.log(`[MeetingBrain] Tasks: ${data.length} for ${options.personName || userEmail}`);
        return { data, count: data.length };
      }
      case "meetings": {
        const d = options.days || 14;
        const since = new Date(); since.setDate(since.getDate() - d);
        const until = new Date(); until.setDate(until.getDate() + d);
        const { rows } = await pool.query(`
          SELECT "meetingTitle", "meetingDate", "meetingEndDate", attendees, location,
                 summary, "keyTopics", "nextSteps", "tasksExtracted"
          FROM "ProcessedMeeting" WHERE "userId" = $1 AND "meetingDate" BETWEEN $2 AND $3 AND summary IS NOT NULL
          ORDER BY "meetingDate" DESC LIMIT 20
        `, [mbUserId, since.toISOString(), until.toISOString()]);
        const data = rows.map((r: any) => ({
          title: r.meetingTitle, date: r.meetingDate?.toISOString()?.slice(0, 16),
          attendees: r.attendees, summary: r.summary?.slice(0, 500),
          key_topics: r.keyTopics?.slice(0, 300) || null, next_steps: r.nextSteps?.slice(0, 300) || null,
        }));
        console.log(`[MeetingBrain] Meetings: ${data.length} (${d}d window)`);
        return { data, count: data.length };
      }
      case "search_meetings": {
        if (!options.query) return { data: [], count: 0, error: "query required" };
        const p = `%${options.query}%`;
        const { rows } = await pool.query(`
          SELECT "meetingTitle", "meetingDate", summary, "keyTopics", "nextSteps", attendees
          FROM "ProcessedMeeting" WHERE "userId" = $1
          AND ("meetingTitle" ILIKE $2 OR summary ILIKE $2 OR "keyTopics" ILIKE $2 OR "nextSteps" ILIKE $2)
          ORDER BY "meetingDate" DESC LIMIT 10
        `, [mbUserId, p]);
        const data = rows.map((r: any) => ({
          title: r.meetingTitle, date: r.meetingDate?.toISOString()?.slice(0, 10),
          summary: r.summary?.slice(0, 400), key_topics: r.keyTopics?.slice(0, 200),
          next_steps: r.nextSteps?.slice(0, 200), attendees: r.attendees,
        }));
        console.log(`[MeetingBrain] Search "${options.query}": ${data.length} matches`);
        return { data, count: data.length };
      }
      default: return { data: [], count: 0, error: `Unknown report: ${report}` };
    }
  } catch (err: any) {
    console.error("[MeetingBrain] Error:", err.message);
    return { data: [], count: 0, error: err.message };
  }
}

/* ─────────────── Memory Search Tool ─────────────── */

/** OpenAI-compatible tool definition for search_memory */
const SEARCH_MEMORY_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_memory",
    description:
      "Search the user's previous conversations and stored memories for specific information. Use when the user asks about something they mentioned before, personal plans, past decisions, travel, meetings, or anything from their conversation history that isn't in the current context.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords. Be specific — e.g. 'kuala lumpur flight', 'Q2 budget', 'client meeting notes'",
        },
        scope: {
          type: "string",
          enum: ["memories", "conversations", "both"],
          description: "Where to search. 'memories' = stored facts/preferences, 'conversations' = message history, 'both' = search everywhere (default)",
        },
      },
      required: ["query"],
    },
  },
};

/** Anthropic tool definition for search_memory */
const SEARCH_MEMORY_TOOL: Anthropic.Tool = {
  name: "search_memory",
  description: SEARCH_MEMORY_OPENAI_TOOL.function.description!,
  input_schema: {
    ...(SEARCH_MEMORY_OPENAI_TOOL.function.parameters as any),
  },
};

/**
 * Search user's memories and conversation history for relevant information.
 */
async function searchMemory(
  query: string,
  scope: "memories" | "conversations" | "both" = "both",
  workspaceId: string,
  userId: number
): Promise<{ memories: any[]; messages: any[]; summaries: any[]; summary: string }> {
  const { intelligenceDb } = await import("@/lib/supabase-intelligence");

  // Build multiple search patterns — split query into individual terms
  // and also create a combined pattern for multi-word phrases
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const combinedPattern = `%${query.replace(/\s+/g, "%")}%`;
  // Build OR filter for individual terms: matches ANY term
  const termPatterns = terms.map(t => `%${t}%`);

  const memories: any[] = [];
  const messages: any[] = [];
  const summaries: any[] = [];

  // Search memories — try combined pattern first, then individual terms
  if (scope === "memories" || scope === "both") {
    const { data } = await intelligenceDb
      .from("ai_memories")
      .select("information_content, type_category, score_strength, date_created, type_source")
      .eq("id_workspace", workspaceId)
      .eq("flag_active", 1)
      .or(`user_memory.eq.${userId},type_scope.eq.team`)
      .or(termPatterns.map(p => `information_content.ilike.${p}`).join(","))
      .order("score_strength", { ascending: false })
      .limit(10);

    if (data) {
      for (const m of data) {
        memories.push({
          content: m.information_content,
          category: m.type_category,
          strength: m.score_strength,
          source: m.type_source,
          date: m.date_created?.slice(0, 10),
        });
      }
    }
  }

  // Search conversation messages AND conversation summaries
  if (scope === "conversations" || scope === "both") {
    // First, find all conversation IDs this user can access:
    // 1. Conversations they created
    // 2. Team conversations in their workspace
    // 3. Conversations shared with them via ai_shares
    const [ownConvs, sharedConvs] = await Promise.all([
      intelligenceDb
        .from("ai_conversations")
        .select("id_conversation")
        .eq("id_workspace", workspaceId)
        .or(`user_created.eq.${userId},type_visibility.eq.team`),
      intelligenceDb
        .from("ai_shares")
        .select("id_conversation")
        .eq("user_recipient", userId),
    ]);

    const accessibleConvIds = [
      ...(ownConvs.data || []).map((c: any) => c.id_conversation),
      ...(sharedConvs.data || []).map((c: any) => c.id_conversation),
    ];
    const uniqueConvIds = Array.from(new Set(accessibleConvIds));

    if (uniqueConvIds.length > 0) {
      // Search messages across all accessible conversations
      const orFilter = termPatterns.map(p => `document_message.ilike.${p}`).join(",");
      const { data } = await intelligenceDb
        .from("ai_messages")
        .select("document_message, role_message, date_created, id_conversation")
        .in("id_conversation", uniqueConvIds)
        .or(orFilter)
        .order("date_created", { ascending: false })
        .limit(10);

      // Get conversation names for matched messages
      const matchedConvIds = Array.from(new Set((data || []).map((m: any) => m.id_conversation)));
      const convNames: Record<string, string> = {};
      if (matchedConvIds.length > 0) {
        const { data: convs } = await intelligenceDb
          .from("ai_conversations")
          .select("id_conversation, name_conversation")
          .in("id_conversation", matchedConvIds);
        for (const c of (convs || [])) {
          convNames[c.id_conversation] = c.name_conversation;
        }
      }

      if (data) {
        for (const m of data) {
          messages.push({
            content: m.document_message?.slice(0, 500) + (m.document_message && m.document_message.length > 500 ? "..." : ""),
            role: m.role_message,
            date: m.date_created?.slice(0, 10),
            thread: convNames[m.id_conversation] || "Untitled",
          });
        }
      }

      // Also search conversation summaries AND titles
      const summaryOrFilter = termPatterns.map(p => `document_summary.ilike.${p},name_conversation.ilike.${p}`).join(",");
      const { data: convData } = await intelligenceDb
        .from("ai_conversations")
        .select("id_conversation, name_conversation, document_summary, date_updated")
        .in("id_conversation", uniqueConvIds)
        .or(summaryOrFilter)
        .order("date_updated", { ascending: false })
        .limit(3);

    if (convData) {
      for (const c of convData) {
        // For matching threads: load the actual messages to get detailed content
        // This is the key insight — summaries point to the right thread,
        // then we pull the real content (including parsed attachment text)
        const { data: threadMsgs } = await intelligenceDb
          .from("ai_messages")
          .select("document_message, role_message, date_created")
          .eq("id_conversation", c.id_conversation)
          .order("date_created", { ascending: true })
          .limit(20);

        const threadContent = (threadMsgs || [])
          .filter((m: any) => m.document_message?.length > 20) // skip trivial messages
          .map((m: any) => {
            const text = m.document_message
              .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // strip image markdown
              .slice(0, 800);
            return `[${m.role_message}]: ${text}`;
          })
          .join("\n\n");

        summaries.push({
          thread: c.name_conversation,
          summary: c.document_summary?.slice(0, 400) || "",
          date: c.date_updated?.slice(0, 10),
          content: threadContent.slice(0, 3000), // actual conversation content
        });
      }
    }
    } // end uniqueConvIds check
  }

  const totalFound = memories.length + messages.length + summaries.length;
  const summary = `Found ${memories.length} memories, ${messages.length} messages, and ${summaries.length} thread summaries matching "${query}"`;
  console.log(`[SearchMemory] ${summary}`);

  return { memories, messages, summaries, summary };
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
          try {
            result = await streamAnthropic(messages, config, modelInfo.apiModel, controller, encoder);
          } catch (anthropicErr: any) {
            // Fallback to Grok if Anthropic hits rate/spending limits
            const errMsg = anthropicErr?.message || String(anthropicErr);
            if (errMsg.includes("usage limits") || errMsg.includes("rate_limit") || anthropicErr?.status === 429 || anthropicErr?.status === 400) {
              console.warn(`[AI] Anthropic failed (${errMsg.slice(0, 100)}), falling back to Grok`);
              result = await streamXAI(messages, config, "grok-4-1-fast", controller, encoder);
              console.log(`[AI] Grok fallback result: ${result.fullText.length} chars, ${result.inputTokens} in, ${result.outputTokens} out`);
            } else {
              throw anthropicErr;
            }
          }
        } else if (modelInfo.provider === "gemini") {
          result = await streamGemini(messages, config, modelInfo.apiModel, controller, encoder);
        } else if (modelInfo.provider === "openai") {
          result = await streamOpenAI(messages, config, modelInfo.apiModel, controller, encoder);
        } else {
          result = await streamXAI(messages, config, modelInfo.apiModel, controller, encoder);
        }

        // Strip fabricated image markdown AND deduplicate legitimate ones
        // Models sometimes write their own ![alt](url) repeating a tool-generated URL
        const seenImageUrls = new Set<string>();
        result.fullText = result.fullText.replace(
          /!\[([^\]]*)\]\(([^)]+)\)/g,
          (match, _alt, url) => {
            if (url.startsWith("/api/media/")) {
              // Legitimate URL — but only keep first occurrence
              if (seenImageUrls.has(url)) {
                console.warn("[Stream] Stripped duplicate image:", url.slice(0, 80));
                return "";
              }
              seenImageUrls.add(url);
              return match;
            }
            console.warn("[Stream] Stripped fabricated image markdown:", match.slice(0, 100));
            return "";
          }
        );
        // Strip fabricated markdown links — keep our own URLs and anchors.
        if (!config.preserveLinks) {
          result.fullText = result.fullText.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (match, text, url) => {
              if (url.startsWith("/api/media/")) return match;
              if (url.startsWith("#")) return match;
              if (url.startsWith("https://app.thecontentengine.com/")) return match;
              console.warn("[Stream] Stripped fabricated link:", url.slice(0, 100));
              return text;
            }
          );
        }

        // Clean up leftover blank lines from stripped content
        result.fullText = result.fullText.replace(/\n{3,}/g, "\n\n").trim();

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
  // Include full image/PDF data for the last 3 user messages to keep context manageable
  const userMsgIndices = conversationMessages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
  const recentUserIndices = new Set(userMsgIndices.slice(-3));
  const anthropicMessages: Anthropic.MessageParam[] = await Promise.all(
    conversationMessages.map(async (m, i) => ({
      role: m.role as "user" | "assistant",
      content: m.role === "user" ? await buildAnthropicContent(m, recentUserIndices.has(i)) : m.content,
    }))
  );

  // Build optional tools array
  const tools: any[] = [];
  if (config.webSearch) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  }
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_TOOL);
    tools.push(DOCUMENT_GEN_TOOL);
    tools.push(CHART_GEN_TOOL);
  }
  if (config.workspaceClientIds?.length) {
    tools.push(QUERY_ENGINE_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_TOOL);
  }

  console.log(`[Anthropic] Streaming with tools: [${tools.map(t => (t as any).name || (t as any).type).join(', ') || 'none'}], imageGeneration=${config.imageGeneration}`);

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
      temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
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
          if (block.name === "generate_document") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_document: true })}\n\n`)
            );
          }
          if (block.name === "generate_chart") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
          if (block.name === "query_engine") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`)
            );
          }
          if (block.name === "search_memory") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
            );
          }
          if (block.name === "query_meetingbrain") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
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

    console.log(`[Anthropic] Round ${round}: stop_reason=${finalMessage.stop_reason}, toolUseBlocks=${toolUseBlocks.length}, textLength=${fullText.length}`);

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

          // Persist image in fullText so it's saved to document_message in the DB.
          // Without this, subsequent messages can't see what images were generated.
          // Add to server fullText for DB persistence (NOT streamed as token —
          // client handles display via image_ready event to avoid duplication)
          fullText += `\n\n![Generated image](${imageUrl})\n\n`;

          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Image generated successfully. URL: ${imageUrl} — Do NOT write this URL again in your response. The image is already displayed to the user.`,
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
      } else if (tool.name === "generate_document") {
        try {
          const { url, filename } = await generateDocument(
            tool.input.title || "Presentation",
            tool.input.slides || [],
            tool.input.theme
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_ready: { url, filename } })}\n\n`
            )
          );

          fullText += `\n\n📄 [Download ${filename}](${url})\n\n`;

          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Presentation generated: ${filename}. Download: ${url} — The download link is already shown to the user. Do NOT write another link.`,
          });
        } catch (err: any) {
          console.error("[DocGen] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_error: err.message })}\n\n`
            )
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Document generation failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (tool.name === "generate_chart") {
        try {
          const chartUrl = await generateChart(
            tool.input.type, tool.input.title, tool.input.labels,
            tool.input.datasets, tool.input.xAxisLabel, tool.input.yAxisLabel
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ image_ready: { url: chartUrl, prompt: tool.input.title } })}\n\n`)
          );
          fullText += `\n\n![${tool.input.title}](${chartUrl})\n\n`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Chart generated successfully and displayed to user. Do NOT write the URL, image markdown, chart config, labels, or any chart parameters in your response. Just provide text insights about the data.`,
          });
        } catch (err: any) {
          console.error("[ChartGen] Failed:", err.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Chart generation failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (tool.name === "query_engine") {
        try {
          const effectiveClientId = tool.input.client_id || config.selectedClientId;
          const result = await queryEngine(
            tool.input.table,
            tool.input.columns,
            tool.input.filters,
            tool.input.order,
            tool.input.limit,
            config.workspaceClientIds,
            tool.input.report,
            tool.input.date_from,
            tool.input.date_to,
            effectiveClientId,
            tool.input.group_by,
            tool.input.assignee_name,
            tool.input
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ query_result: { table: tool.input.report || tool.input.table, count: result.count } })}\n\n`)
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: formatToolResult(result),
          });
        } catch (err: any) {
          console.error("[QueryEngine] Failed:", err.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Query failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (tool.name === "search_memory") {
        try {
          const result = await searchMemory(
            tool.input.query,
            tool.input.scope || "both",
            config.workspaceId!,
            config.userId!
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `${result.summary}\n\nMemories:\n${result.memories.map(m => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}\n\nConversation excerpts:\n${result.messages.map(m => `- [${m.role} in "${m.thread}" on ${m.date}]: ${m.content}`).join("\n") || "None found"}\n\nRelevant threads:\n${(result.summaries || []).map((s: any) => `--- Thread: "${s.thread}" (${s.date}) ---\nSummary: ${s.summary}\n${s.content ? `Full conversation:\n${s.content}` : ""}`).join("\n\n") || "None found"}`,
          });
        } catch (err: any) {
          console.error("[SearchMemory] Failed:", err.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Memory search failed: ${err.message}`,
            is_error: true,
          });
        }
      } else if (tool.name === "query_meetingbrain") {
        try {
          const result = await queryMeetingBrain(
            tool.input.report, config.userEmail!,
            { query: tool.input.query, status: tool.input.status, days: tool.input.days, personName: tool.input.person_name }
          );
          toolResults.push({
            type: "tool_result", tool_use_id: tool.id,
            content: formatMeetingBrainResult(tool.input.report, result),
          });
        } catch (err: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `MeetingBrain error: ${err.message}`, is_error: true });
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

  // xAI's Responses API supports web search but NOT function calling (tools).
  // The Chat Completions API supports function calling but NOT web search.
  // Solution: always use Chat Completions with ALL tools (including web_search
  // as a callable tool). The AI decides when to web search vs query the Engine.
  // This replaces the old two-step approach and gives the model full control.
  return streamXAIChatCompletions(messages, config, apiModel, controller, encoder, xai);
}

/** xAI Chat Completions API streaming — supports function calling (tools) */
async function streamXAIChatCompletions(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  xai: OpenAI
): Promise<StreamResult> {
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Add system prompt
  const systemText = config.systemPrompt;
  if (systemText) {
    openaiMessages.push({ role: "system", content: systemText });
  }

  // Add conversation messages — use xAI-specific content builder to avoid
  // multi-part array format issues with document attachments
  // Include full image data for last 3 user messages only
  const xaiUserIndices = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
  const xaiRecentUsers = new Set(xaiUserIndices.slice(-3));
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    openaiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildXAIContent(m, xaiRecentUsers.has(mi)) : m.content,
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
    tools.push(DOCUMENT_GEN_OPENAI_TOOL);
    tools.push(CHART_GEN_OPENAI_TOOL);
  }
  if (config.workspaceClientIds?.length) {
    tools.push(QUERY_ENGINE_OPENAI_TOOL);
  }
  // Web search: use xAI's native search_mode instead of a tool call.
  // This is faster and more reliable than the Responses API approach.
  // (WEB_SEARCH_OPENAI_TOOL is kept for reference but no longer added to tools)
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
  }

  console.log(`[xAI] Streaming model=${apiModel}, webSearch=${config.webSearch}, imageGen=${config.imageGeneration}, tools=[${tools.map(t => (t as any).function?.name || t.type).join(', ') || 'none'}]`);

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = (await xai.chat.completions.create({
      model: apiModel,
      ...tokenParam,
      temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools } : {}),
      ...(config.webSearch ? { search_mode: "on" } : {}),
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
          if (existing.name === "generate_document" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_document: true })}\n\n`)
            );
          }
          if (existing.name === "generate_chart" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
          if (existing.name === "query_engine" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`)
            );
          }
          if (existing.name === "web_search" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
            );
          }
          if (existing.name === "search_memory" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
            );
          }
          if (existing.name === "query_meetingbrain" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
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

    // Add web_search indicator detection (xAI specific)
    // Already handled inline above with the other tool indicators

    console.log(`[xAI] Round ${round}: finishReason=${finishReason}, toolCalls=${toolCalls.size}, textLen=${fullText.length}`);

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

          // Persist image in fullText so it's saved to document_message
          // Add to server fullText for DB persistence (NOT streamed as token —
          // client handles display via image_ready event to avoid duplication)
          fullText += `\n\n![Generated image](${imageUrl})\n\n`;

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl} — Do NOT write this URL again in your response. The image is already displayed to the user.`,
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
      } else if (tc.function.name === "generate_document") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { url, filename } = await generateDocument(
            input.title || "Presentation",
            input.slides || [],
            input.theme
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_ready: { url, filename } })}\n\n`
            )
          );

          fullText += `\n\n📄 [Download ${filename}](${url})\n\n`;

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Presentation generated: ${filename}. Download: ${url} — The download link is already shown to the user. Do NOT write another link.`,
          } as any);
        } catch (err: any) {
          console.error("[DocGen/xAI] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_error: err.message })}\n\n`
            )
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Document generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "generate_chart") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const chartUrl = await generateChart(
            input.type, input.title, input.labels,
            input.datasets, input.xAxisLabel, input.yAxisLabel
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ image_ready: { url: chartUrl, prompt: input.title } })}\n\n`)
          );
          fullText += `\n\n![${input.title}](${chartUrl})\n\n`;
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generated successfully and displayed to user. Do NOT write the URL, image markdown, chart config, labels, or any chart parameters in your response. Just provide text insights about the data.`,
          } as any);
        } catch (err: any) {
          console.error("[ChartGen/xAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_engine") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const effectiveClientId = input.client_id || config.selectedClientId;
          const result = await queryEngine(
            input.table,
            input.columns,
            input.filters,
            input.order,
            input.limit,
            config.workspaceClientIds,
            input.report,
            input.date_from,
            input.date_to,
            effectiveClientId,
            input.group_by,
            input.assignee_name,
            input
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ query_result: { table: input.report || input.table, count: result.count } })}\n\n`)
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: formatToolResult(result),
          } as any);
        } catch (err: any) {
          console.error("[QueryEngine/xAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Query failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "web_search") {
        try {
          const input = JSON.parse(tc.function.arguments);
          console.log(`[WebSearch/xAI] Starting search: "${input.query?.slice(0, 80)}"`);
          const searchStart = Date.now();
          const searchResults = await executeWebSearch(input.query, config.systemPrompt, apiModel);
          console.log(`[WebSearch/xAI] Completed in ${Date.now() - searchStart}ms, ${searchResults.length} chars, starts: "${searchResults.slice(0, 80)}"`);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search results for "${input.query}":\n\n${searchResults}\n\nIMPORTANT: Only cite facts and URLs that appear in these search results. Do NOT fabricate sources.`,
          } as any);
        } catch (err: any) {
          console.error("[WebSearch/xAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search failed: ${err.message}. Answer based on your existing knowledge instead.`,
          } as any);
        }
      } else if (tc.function.name === "search_memory") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await searchMemory(
            input.query,
            input.scope || "both",
            config.workspaceId!,
            config.userId!
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `${result.summary}\n\nMemories:\n${result.memories.map((m: any) => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}\n\nConversation excerpts:\n${result.messages.map((m: any) => `- [${m.role} in "${m.thread}" on ${m.date}]: ${m.content}`).join("\n") || "None found"}\n\nRelevant threads:\n${(result.summaries || []).map((s: any) => `--- Thread: "${s.thread}" (${s.date}) ---\nSummary: ${s.summary}\n${s.content ? `Full conversation:\n${s.content}` : ""}`).join("\n\n") || "None found"}`,
          } as any);
        } catch (err: any) {
          console.error("[SearchMemory/xAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Memory search failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, personName: input.person_name }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
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
  const respUserIndices = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
  const respRecentUsers = new Set(respUserIndices.slice(-3));
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    input.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildXAIContent(m, respRecentUsers.has(mi)) : m.content,
    });
  }

  const stream = (await xai.responses.create({
    model: apiModel,
    temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
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

  // Add conversation messages — include images from last 3 user messages only
  const gemUserIndices = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
  const gemRecentUsers = new Set(gemUserIndices.slice(-3));
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    geminiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildOpenAIContent(m, gemRecentUsers.has(mi)) : m.content,
    } as any);
  }

  // Build tools array if image generation is enabled
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_OPENAI_TOOL);
    tools.push(DOCUMENT_GEN_OPENAI_TOOL);
    tools.push(CHART_GEN_OPENAI_TOOL);
  }
  if (config.workspaceClientIds?.length) {
    tools.push(QUERY_ENGINE_OPENAI_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
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
      temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
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
          if (existing.name === "generate_document" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_document: true })}\n\n`)
            );
          }
          if (existing.name === "generate_chart" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
          if (existing.name === "query_engine" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`)
            );
          }
          if (existing.name === "web_search" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
            );
          }
          if (existing.name === "search_memory" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
            );
          }
          if (existing.name === "query_meetingbrain" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
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

          // Persist image in fullText so it's saved to document_message
          // Add to server fullText for DB persistence (NOT streamed as token —
          // client handles display via image_ready event to avoid duplication)
          fullText += `\n\n![Generated image](${imageUrl})\n\n`;

          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl} — Do NOT write this URL again in your response. The image is already displayed to the user.`,
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
      } else if (tc.function.name === "generate_document") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { url, filename } = await generateDocument(
            input.title || "Presentation",
            input.slides || [],
            input.theme
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_ready: { url, filename } })}\n\n`
            )
          );

          fullText += `\n\n📄 [Download ${filename}](${url})\n\n`;

          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Presentation generated: ${filename}. Download: ${url} — The download link is already shown to the user. Do NOT write another link.`,
          } as any);
        } catch (err: any) {
          console.error("[DocGen/Gemini] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_error: err.message })}\n\n`
            )
          );
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Document generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "generate_chart") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const chartUrl = await generateChart(
            input.type, input.title, input.labels,
            input.datasets, input.xAxisLabel, input.yAxisLabel
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ image_ready: { url: chartUrl, prompt: input.title } })}\n\n`)
          );
          fullText += `\n\n![${input.title}](${chartUrl})\n\n`;
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generated successfully and displayed to user. Do NOT write the URL, image markdown, chart config, labels, or any chart parameters in your response. Just provide text insights about the data.`,
          } as any);
        } catch (err: any) {
          console.error("[ChartGen/Gemini] Failed:", err.message);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_engine") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const effectiveClientId = input.client_id || config.selectedClientId;
          const result = await queryEngine(
            input.table,
            input.columns,
            input.filters,
            input.order,
            input.limit,
            config.workspaceClientIds,
            input.report,
            input.date_from,
            input.date_to,
            effectiveClientId,
            input.group_by,
            input.assignee_name,
            input
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ query_result: { table: input.report || input.table, count: result.count } })}\n\n`)
          );
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: formatToolResult(result),
          } as any);
        } catch (err: any) {
          console.error("[QueryEngine/Gemini] Failed:", err.message);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Query failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "search_memory") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await searchMemory(
            input.query,
            input.scope || "both",
            config.workspaceId!,
            config.userId!
          );
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `${result.summary}\n\nMemories:\n${result.memories.map((m: any) => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}\n\nConversation excerpts:\n${result.messages.map((m: any) => `- [${m.role} in "${m.thread}" on ${m.date}]: ${m.content}`).join("\n") || "None found"}\n\nRelevant threads:\n${(result.summaries || []).map((s: any) => `--- Thread: "${s.thread}" (${s.date}) ---\nSummary: ${s.summary}\n${s.content ? `Full conversation:\n${s.content}` : ""}`).join("\n\n") || "None found"}`,
          } as any);
        } catch (err: any) {
          console.error("[SearchMemory/Gemini] Failed:", err.message);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Memory search failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, personName: input.person_name }
          );
          geminiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
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

  // Add conversation messages — include images from last 3 user messages only
  const oaiUserIndices = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
  const oaiRecentUsers = new Set(oaiUserIndices.slice(-3));
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    openaiMessages.push({
      role: m.role as "user" | "assistant" | "system",
      content: m.role === "user" ? await buildOpenAIContent(m, oaiRecentUsers.has(mi)) : m.content,
    } as any);
  }

  // Build tools array if image generation is enabled
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  if (config.imageGeneration) {
    tools.push(IMAGE_GEN_OPENAI_TOOL);
    tools.push(DOCUMENT_GEN_OPENAI_TOOL);
    tools.push(CHART_GEN_OPENAI_TOOL);
  }
  if (config.workspaceClientIds?.length) {
    tools.push(QUERY_ENGINE_OPENAI_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
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
      temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
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
          if (existing.name === "generate_document" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_document: true })}\n\n`)
            );
          }
          if (existing.name === "generate_chart" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ generating_image: true })}\n\n`)
            );
          }
          if (existing.name === "query_engine" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`)
            );
          }
          if (existing.name === "web_search" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching: true })}\n\n`)
            );
          }
          if (existing.name === "search_memory" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
            );
          }
          if (existing.name === "query_meetingbrain" && tc.function?.name) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ searching_memory: true })}\n\n`)
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

          // Persist image in fullText so it's saved to document_message
          // Add to server fullText for DB persistence (NOT streamed as token —
          // client handles display via image_ready event to avoid duplication)
          fullText += `\n\n![Generated image](${imageUrl})\n\n`;

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Image generated successfully. URL: ${imageUrl} — Do NOT write this URL again in your response. The image is already displayed to the user.`,
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
      } else if (tc.function.name === "generate_document") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { url, filename } = await generateDocument(
            input.title || "Presentation",
            input.slides || [],
            input.theme
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_ready: { url, filename } })}\n\n`
            )
          );

          fullText += `\n\n📄 [Download ${filename}](${url})\n\n`;

          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Presentation generated: ${filename}. Download: ${url} — The download link is already shown to the user. Do NOT write another link.`,
          } as any);
        } catch (err: any) {
          console.error("[DocGen/OpenAI] Failed:", err.message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ document_error: err.message })}\n\n`
            )
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Document generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "generate_chart") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const chartUrl = await generateChart(
            input.type, input.title, input.labels,
            input.datasets, input.xAxisLabel, input.yAxisLabel
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ image_ready: { url: chartUrl, prompt: input.title } })}\n\n`)
          );
          fullText += `\n\n![${input.title}](${chartUrl})\n\n`;
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generated successfully and displayed to user. Do NOT write the URL, image markdown, chart config, labels, or any chart parameters in your response. Just provide text insights about the data.`,
          } as any);
        } catch (err: any) {
          console.error("[ChartGen/OpenAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Chart generation failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_engine") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const effectiveClientId = input.client_id || config.selectedClientId;
          const result = await queryEngine(
            input.table,
            input.columns,
            input.filters,
            input.order,
            input.limit,
            config.workspaceClientIds,
            input.report,
            input.date_from,
            input.date_to,
            effectiveClientId,
            input.group_by,
            input.assignee_name,
            input
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ query_result: { table: input.report || input.table, count: result.count } })}\n\n`)
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: formatToolResult(result),
          } as any);
        } catch (err: any) {
          console.error("[QueryEngine/OpenAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Query failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "search_memory") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await searchMemory(
            input.query,
            input.scope || "both",
            config.workspaceId!,
            config.userId!
          );
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `${result.summary}\n\nMemories:\n${result.memories.map((m: any) => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}\n\nConversation excerpts:\n${result.messages.map((m: any) => `- [${m.role} in "${m.thread}" on ${m.date}]: ${m.content}`).join("\n") || "None found"}\n\nRelevant threads:\n${(result.summaries || []).map((s: any) => `--- Thread: "${s.thread}" (${s.date}) ---\nSummary: ${s.summary}\n${s.content ? `Full conversation:\n${s.content}` : ""}`).join("\n\n") || "None found"}`,
          } as any);
        } catch (err: any) {
          console.error("[SearchMemory/OpenAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Memory search failed: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, personName: input.person_name }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
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
