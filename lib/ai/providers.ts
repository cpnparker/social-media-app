import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { put } from "@vercel/blob";
import { fetchBlobContent } from "./blob-utils";
import { anthropicCallParams } from "./anthropic-params";
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
  /** type_source string used for ai_usage logging + Control Centre lookups.
   *  Defaults to "enginegpt" (the user-facing chat). Set to a different
   *  value when calling from RFP / memory / summary code paths. */
  source?: string;
  /** Conversation id — needed for persisting design-mode assets to ai_design_assets. */
  conversationId?: string;
  /** Content id (public.content) — when set, design assets auto-attach to that content piece. */
  contentId?: number;
  /** When true, enables Design mode tools (generate_video, search_artlist, license_artlist_asset)
   *  and auto-injects client brand context into image/video prompts. */
  designMode?: boolean;
  /** Studio mode: the v2 Design Mode session this conversation is anchored to. When set,
   *  generated assets also auto-attach to design_shots + create design_shot_versions. */
  designSessionId?: string;
  /** The shot currently focused in the v2 canvas. New generations from chat attach here.
   *  If unset and designSessionId is set, the streamer will create a new shot per generation. */
  designFocusedShotId?: string;
  /** When true, skip writing any persistence row (ai_design_assets, etc). Mirrors the
   *  ai_messages incognito behaviour. The Blob upload still happens so the asset is
   *  displayed inline this turn — it just never gets indexed/listed afterwards. */
  incognito?: boolean;
  /** Conversation visibility. In "team" conversations, personal-scope tool reports
   *  (personal MeetingBrain meetings/tasks, all Slack reports) are blocked so one
   *  user's private data can't land in a thread every workspace member can read.
   *  client_meetings stays available — that report is workspace-shared by design. */
  conversationVisibility?: "private" | "team";
  /** Expose the create_scheduled_task tool (NL scheduling of recurring prompts).
   *  Set ONLY by the interactive chat route — never by the headless scheduled
   *  runner (a scheduled prompt must not be able to schedule more prompts). */
  enableScheduling?: boolean;
  /** Per-user finance access (users_access.flag_access_finance — the
   *  "Finance" column in Settings → Users). Gates the query_xero tool:
   *  without it, finance questions get no Xero access at all. */
  financeAccess?: boolean;
  /** Set when this conversation IS a scheduled task's thread — enables the
   *  update_scheduled_task tool (reply-to-refine the standing prompt). */
  scheduledTask?: {
    id: string;
    title: string;
    prompt: string;
    typeTask: string;
    typeSchedule: string;
    configSchedule: any;
    scheduleLabel: string;
  };
}

/** Default temperature for user-facing chat. Lower than model defaults (~0.7-1.0)
 *  to reduce hallucination while preserving creativity for content writing. */
const DEFAULT_CHAT_TEMPERATURE = 0.4;

/* ─────────────── Stream stall watchdog ─────────────── */

/** A model stream that emits nothing for this long is treated as hung. Without
 *  this, a stalled SDK stream silently burns the route's maxDuration and the
 *  user is left with a dangling "let me look that up…" and no answer
 *  (the WBCSD meeting-search bug, 2026-07-17). */
const STREAM_STALL_MS = 90_000;

class StreamStallError extends Error {
  constructor() {
    super(`Model stream stalled — no events for ${STREAM_STALL_MS / 1000}s`);
    this.name = "StreamStallError";
  }
}

/** Wraps an async iterable so every next() races an inactivity timer. */
async function* withStallGuard<T>(iterable: AsyncIterable<T>): AsyncGenerator<T> {
  const it = iterable[Symbol.asyncIterator]();
  let finished = false;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const res = await Promise.race([
        it.next(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new StreamStallError()), STREAM_STALL_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      if (res.done) { finished = true; return; }
      yield res.value; // a consumer break/throw resumes in the finally below
    }
  } finally {
    // Close the source on EVERY early exit — stall, source error, or the
    // consumer leaving (client disconnect → enqueue throws → for-await calls
    // our return(), which does NOT run catch blocks, only finally). Without
    // this the SDK keeps generating — and billing — after the user is gone;
    // SDK return()/abort() cancels the upstream HTTP request.
    if (!finished) {
      try { void Promise.resolve(it.return?.() as any).catch(() => {}); } catch { /* already closed */ }
    }
  }
}

/** Injected before the forced final round when a tool loop ends abnormally
 *  (round cap, no-progress break, or stall) — the model must answer from the
 *  tool results it already has instead of announcing more lookups. */
const FORCED_FINAL_NUDGE =
  "SYSTEM NOTE (not from the user — never acknowledge or mention it): tools are no longer available this turn. Using ONLY the information already gathered above, answer the user's question fully and directly RIGHT NOW. If something could not be retrieved, say what you found and what remains unverified. Do not say you will look anything up, do not promise follow-ups, and do not repeat text you already wrote.";

/** Model-appropriate sampling/thinking params for an Anthropic chat request.
 *  Rules live in lib/ai/anthropic-params.ts (shared with the direct RFP/voice callers). */
function anthropicModelParams(apiModel: string, config: AIProviderConfig): Record<string, unknown> {
  return anthropicCallParams(apiModel, config.temperature ?? DEFAULT_CHAT_TEMPERATURE);
}

/* ─────────────── Tool Result Formatting ─────────────── */

const MAX_TOOL_RESULT_ROWS = 100;
const MAX_WEB_SEARCH_CHARS = 6000;

/** Format query_engine results with optional truncation to reduce token usage */
export function formatToolResult(result: { data: any; count: number; total?: number; summary?: any; error?: string }): string {
  if (result.error) return `Query failed: ${result.error}`;
  let content = `Query returned ${result.count} rows.`;
  if (result.summary) {
    content += `\n\nSUMMARY (use these pre-calculated numbers):\n${JSON.stringify(result.summary, null, 2)}`;
  }
  if (result.total !== undefined) {
    content += `\nTotal: ${result.total}`;
  }
  // Reports like pipeline_summary return a single aggregate OBJECT, not an
  // array. The old Array-or-empty coercion serialized it as "Data: []", so the
  // model read "no data" and improvised raw table queries instead. (Same bug
  // class as the formatMeetingBrainResult meeting_details fix below.)
  const isArray = Array.isArray(result.data);
  const rows = isArray ? result.data : [];
  const sample = rows.slice(0, MAX_TOOL_RESULT_ROWS);
  const payload = isArray ? sample : (result.data ?? []);
  content += `\n\nData${isArray && rows.length > MAX_TOOL_RESULT_ROWS ? ` (first ${MAX_TOOL_RESULT_ROWS} of ${rows.length})` : ""}:\n${JSON.stringify(payload, null, 2)}`;
  content += `\nIf the user asked for a chart or graph, you MUST call generate_chart next with this data.`;
  return content;
}

/** Format MeetingBrain results with truncation */
export function formatMeetingBrainResult(report: string, result: { data: any; count: number; error?: string; errorKind?: "invalid_call" | "infra"; notice?: string; hint?: string }): string {
  if (result.notice) return result.notice;
  if (result.error) {
    // Two distinct failure classes — conflating them made the model announce a
    // fake outage ("MeetingBrain is temporarily unreachable") when its OWN tool
    // call was malformed (fabricated meeting_id, missing query arg).
    if (result.errorKind === "invalid_call") {
      return [
        `MeetingBrain rejected this call (report=${report}): ${result.error}`,
        ``,
        `MeetingBrain itself is working — YOUR tool call had a bad or missing argument. Do NOT tell the user MeetingBrain is down or unreachable.`,
        `- Fix the call and try again now: use report "search_meetings" with a query keyword (attendee name or topic) to find the meeting, then "meeting_details" with the id from those results.`,
        `- Only pass meeting_id values returned by a MeetingBrain result this turn — never invent or reuse one from injected context.`,
        `- If a corrected retry still finds nothing, tell the user you couldn't find that meeting — not that MeetingBrain is offline.`,
      ].join("\n");
    }
    // Genuine backend failure: don't let it read like "you have no meetings".
    // Tell the model exactly how to phrase the failure.
    return [
      `MeetingBrain query failed (report=${report}): ${result.error}`,
      ``,
      `INSTRUCTIONS FOR YOUR RESPONSE:`,
      `- Tell the user MeetingBrain is temporarily unreachable, so you can't check their meetings/tasks right now.`,
      `- Do NOT say they have no meetings or no tasks — you don't know that; the lookup failed.`,
      `- Suggest they try again in a few minutes, and offer to help with anything that doesn't need MeetingBrain in the meantime.`,
    ].join("\n");
  }
  // meeting_details returns a single OBJECT, not an array. The old
  // Array-or-empty coercion silently serialized it as "[]", so the model
  // never saw the meeting content at all and told users "no transcript".
  const isArray = Array.isArray(result.data);
  const rows = isArray ? result.data : [];
  const sample = rows.slice(0, MAX_TOOL_RESULT_ROWS);
  const payload = isArray ? sample : result.data;
  const truncNote = isArray && rows.length > MAX_TOOL_RESULT_ROWS ? `\n(showing first ${MAX_TOOL_RESULT_ROWS} of ${rows.length})` : "";
  const hintNote = result.hint ? `\n\n${result.hint}` : "";
  return `MeetingBrain ${report}: ${result.count} results\n${JSON.stringify(payload, null, 2)}${truncNote}${hintNote}\n(Internal fields like client_id / meeting ids are for YOUR follow-up tool calls only — never write raw ids in your reply to the user; use names and dates.)`;
}

/* ─────────────── Fuzzy matching (voice transcription drift) ─────────────── */

/** Classic Levenshtein distance — small inputs only (word vs word). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

/** Distance budget by word length: "Gelderma"→"Galderma" (len 8, dist 1) passes. */
function fuzzyTolerance(len: number): number {
  return len >= 9 ? 3 : len >= 6 ? 2 : len >= 4 ? 1 : 0;
}

const tokenize = (s: string): string[] =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);

/** Consonant skeleton — vowels carry most of the transcription error in
 *  misheard names ("Amorite" for "Amrize"), consonant shape survives. */
const skeleton = (w: string): string => w[0] + w.slice(1).replace(/[aeiouy]/g, "");

/**
 * Does any meaningful word of `query` approximately match any token of `target`?
 * Built for voice: spoken proper nouns arrive phonetically misspelled
 * ("Gelderma" for "Galderma", "Amorite" for "Amrize"), so exact/ilike search
 * misses them. Two layers: edit distance on the full word, then edit distance
 * on the consonant skeleton (same first letter required).
 */
export function fuzzyMatches(query: string, target: string): boolean {
  const qWords = tokenize(query).filter((w) => w.length >= 4);
  if (qWords.length === 0) return false;
  const tTokens = tokenize(target);
  return qWords.some((q) =>
    tTokens.some(
      (t) =>
        t.includes(q) ||
        q.includes(t) ||
        levenshtein(q, t) <= Math.min(fuzzyTolerance(q.length), fuzzyTolerance(t.length)) ||
        (q.length >= 5 &&
          t.length >= 5 &&
          q[0] === t[0] &&
          levenshtein(skeleton(q), skeleton(t)) <= 1)
    )
  );
}

/* ─────────────── Model Registry ─────────────── */

interface ModelInfo {
  provider: "anthropic" | "xai" | "openai" | "gemini" | "perplexity" | "deepseek";
  apiModel: string;
  label: string;
  description?: string;
  legacy?: boolean;
  hidden?: boolean; // Hide from user selector (used for background processing only)
}

const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "auto": {
    provider: "xai",
    apiModel: "grok-4-1-fast-non-reasoning",
    label: "EngineAI Auto",
    description: "Best model for each query",
  },
  "claude-fable-5": {
    provider: "anthropic",
    apiModel: "claude-fable-5",
    label: "Claude Fable 5",
    description: "Anthropic's most powerful model",
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    apiModel: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Top-tier reasoning, code & long-form",
  },
  "claude-sonnet-5": {
    provider: "anthropic",
    apiModel: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Complex reasoning & analysis",
  },
  "claude-haiku-4-5": {
    provider: "anthropic",
    apiModel: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    description: "Fast, cheap Claude",
  },
  "gemini-3-flash": {
    provider: "gemini",
    apiModel: "gemini-3-flash",
    label: "Gemini 3 Flash",
    description: "Fast, large context window",
  },
  "gemini-3.1-flash-lite": {
    provider: "gemini",
    apiModel: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    hidden: true,
  },
  "gpt-4o": {
    provider: "openai",
    apiModel: "gpt-4o",
    label: "GPT-4o",
    description: "OpenAI's versatile flagship",
  },
  "gpt-4o-mini": {
    provider: "openai",
    apiModel: "gpt-4o-mini",
    label: "GPT-4o Mini",
    hidden: true,
  },
  "grok-4-1-fast": {
    provider: "xai",
    apiModel: "grok-4-1-fast-non-reasoning",
    label: "Grok 4 Fast",
    description: "Fast, affordable, web search",
  },
  "grok-4-3": {
    provider: "xai",
    apiModel: "grok-4.3",
    label: "Grok 4.3",
    description: "xAI's flagship — strong & affordable",
  },
  "deepseek-chat": {
    provider: "deepseek",
    apiModel: "deepseek-chat",
    label: "DeepSeek Chat",
    description: "Fast & cost-effective open model",
  },
  "sonar": {
    provider: "perplexity",
    apiModel: "sonar",
    label: "Perplexity Sonar",
    description: "Every reply searches the web",
    hidden: true,
  },
  "sonar-pro": {
    provider: "perplexity",
    apiModel: "sonar-pro",
    label: "Perplexity Sonar Pro",
    description: "Deep web research & analysis",
    hidden: true,
  },
  // Legacy mappings for old conversations
  "claude-opus-4-7": {
    provider: "anthropic",
    apiModel: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    legacy: true,
  },
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
  "claude-sonnet-4-6": {
    provider: "anthropic",
    apiModel: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    legacy: true,
  },
  "claude-sonnet-4-20250514": {
    provider: "anthropic",
    apiModel: "claude-sonnet-5",
    label: "Claude Sonnet 5",
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
    .filter(([, info]) => !info.legacy && !info.hidden)
    .map(([id, info]) => ({
      id,
      label: info.label,
      provider: info.provider,
      description: info.description,
    }));
}

export function getModelInfo(modelId: string): ModelInfo {
  return MODEL_REGISTRY[modelId] || MODEL_REGISTRY["claude-sonnet-5"];
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

function getPerplexityClient() {
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY environment variable is not set. Add it to use Perplexity models.");
  }
  return new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: "https://api.perplexity.ai",
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

function getDeepSeekClient() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY environment variable is not set. Add it to use DeepSeek models.");
  }
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
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

/* ─────────────── Video Generation Tool (Design Mode) ─────────────── */

/** OpenAI-compatible tool definition for generate_video (Runway). */
const VIDEO_GEN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_video",
    description:
      "Generate a short video clip (5 or 10 seconds) when the user asks for video, animation, motion, or a moving image. Powered by Runway Gen-4 Turbo. Supports text-to-video (just a prompt) and image-to-video (an existing image URL + motion prompt). Only use when the user explicitly asks for video.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed prompt describing the scene, motion, camera movement, and aesthetic. Be specific about what should move and how. For image_to_video, focus on the motion/camera direction rather than re-describing the scene.",
        },
        duration: {
          type: "number",
          enum: [5, 10],
          description: "Clip duration in seconds. 5 is faster + cheaper, 10 for richer scenes. Default 5.",
        },
        format: {
          type: "string",
          enum: ["landscape", "portrait", "square"],
          description: "Output aspect ratio. landscape = 1280x720, portrait = 720x1280 (TikTok/Reels), square = 1024x1024.",
        },
        image_url: {
          type: "string",
          description:
            "Optional source image URL — if provided, runs image-to-video (animates the image). Pass a URL from a prior generate_image result or an uploaded asset.",
        },
        model: {
          type: "string",
          enum: ["gen4.5", "gen3a_turbo", "veo3", "veo3.1", "veo3.1_fast", "kling2.5_turbo_pro", "kling3.0_pro", "kling3.0_standard", "seedance2"],
          description: "Video model — Runway's unified API hosts Gen-4.5, Veo, Kling, and Seedance. gen4.5 is the default best quality/cost; veo3.1 for long cinematic takes; kling3.0_pro for physics-heavy scenes; seedance2 for reference-controlled composition.",
        },
      },
      required: ["prompt"],
    },
  },
};

const VIDEO_GEN_TOOL: Anthropic.Tool = {
  name: "generate_video",
  description: VIDEO_GEN_OPENAI_TOOL.function.description!,
  input_schema: { ...(VIDEO_GEN_OPENAI_TOOL.function.parameters as any) },
};

/* ─────────────── Artlist Tools (Design Mode) ─────────────── */

/** OpenAI-compatible tool definition for search_artlist (Artgrid stock footage). */
const ARTLIST_SEARCH_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_artlist",
    description:
      "Search Artlist's Artgrid catalogue for licensed stock video footage. Use when the user wants to find existing footage (drone shots, b-roll, lifestyle, abstract, etc.) rather than generate something from scratch. Returns thumbnails and previews; user must explicitly select an asset before licensing.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords — be descriptive. e.g. 'cinematic drone shot of snowy mountains', 'busy city street at night'." },
        duration_min: { type: "number", description: "Minimum clip duration in seconds." },
        duration_max: { type: "number", description: "Maximum clip duration in seconds." },
        orientation: { type: "string", enum: ["landscape", "portrait", "square"], description: "Aspect ratio filter." },
        mood: { type: "string", description: "Mood/vibe filter — e.g. 'cinematic', 'uplifting', 'tense', 'corporate'." },
        page: { type: "number", description: "Page number for pagination (default 1)." },
      },
      required: ["query"],
    },
  },
};

const ARTLIST_SEARCH_TOOL: Anthropic.Tool = {
  name: "search_artlist",
  description: ARTLIST_SEARCH_OPENAI_TOOL.function.description!,
  input_schema: { ...(ARTLIST_SEARCH_OPENAI_TOOL.function.parameters as any) },
};

/** OpenAI-compatible tool definition for license_artlist_asset. */
const ARTLIST_LICENSE_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "license_artlist_asset",
    description:
      "License an Artlist asset (use after the user picks one from search_artlist results). Triggers the licensed download, mirrors the clip to our storage, and adds it to the design canvas. Always confirm with the user before calling — licensing may consume credits.",
    parameters: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Artlist asset id from a prior search_artlist result." },
        title: { type: "string", description: "Asset title (for the canvas tile label)." },
      },
      required: ["asset_id"],
    },
  },
};

/* ─────────────── Design Studio shot CRUD tools (v2) ─────────────── */

const DESIGN_CREATE_SHOT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_create_shot",
    description:
      "Create a new shot in the current Design Mode session. Use when the user wants to add to their storyboard — e.g. 'add a shot of the chairman in his library' or 'we need a closing wordmark shot'. The shot is created empty (no version yet); follow up with design_generate_shot to produce its v1.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short shot title (max ~60 chars). e.g. 'Chairman portrait' or 'Wordmark close'." },
        beat: { type: "string", description: "Optional narrative beat label — e.g. 'Foundation', 'Conviction', 'Horizon', 'Return'." },
        duration: { type: "number", description: "Duration in seconds. Default 5." },
        modelId: { type: "string", description: "Model id from the registry. Default 'runway-g4-5' for video; use 'dalle-3' or 'gpt-img-1' for stills." },
        prompt: { type: "string", description: "Initial prompt to seed the shot. Optional." },
      },
      required: ["title"],
    },
  },
};
const DESIGN_CREATE_SHOT_TOOL: Anthropic.Tool = {
  name: "design_create_shot",
  description: DESIGN_CREATE_SHOT_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_CREATE_SHOT_OPENAI_TOOL.function.parameters as any) },
};

const DESIGN_UPDATE_SHOT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_update_shot",
    description:
      "Update an existing shot's metadata: title, beat, duration, model, or prompt. Doesn't trigger generation — call design_generate_shot if you want a new version after the update.",
    parameters: {
      type: "object",
      properties: {
        shot_id: { type: "string", description: "The shot id to update. Use the focused shot id from the context block if the user said 'this shot'." },
        title: { type: "string" },
        beat: { type: "string" },
        duration: { type: "number" },
        modelId: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["shot_id"],
    },
  },
};
const DESIGN_UPDATE_SHOT_TOOL: Anthropic.Tool = {
  name: "design_update_shot",
  description: DESIGN_UPDATE_SHOT_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_UPDATE_SHOT_OPENAI_TOOL.function.parameters as any) },
};

const DESIGN_GENERATE_SHOT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_generate_shot",
    description:
      "Generate (or regenerate) a new version of an existing shot using its current model + prompt — or override either inline. Equivalent to clicking the Regenerate button in the canvas inspector. Use after design_create_shot or design_update_shot, or to iterate.",
    parameters: {
      type: "object",
      properties: {
        shot_id: { type: "string", description: "The shot id to generate. The focused shot from the context block is a safe default." },
        modelId: { type: "string", description: "Override the model just for this generation (e.g. switch from gen4.5 to veo3.1)." },
        prompt: { type: "string", description: "Override the prompt just for this generation." },
        format: { type: "string", enum: ["landscape", "portrait", "square"], description: "Output aspect ratio." },
        duration: { type: "number", enum: [5, 10], description: "Video clip duration in seconds (videos only)." },
      },
      required: ["shot_id"],
    },
  },
};
const DESIGN_GENERATE_SHOT_TOOL: Anthropic.Tool = {
  name: "design_generate_shot",
  description: DESIGN_GENERATE_SHOT_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_GENERATE_SHOT_OPENAI_TOOL.function.parameters as any) },
};

const DESIGN_COMMIT_SHOT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_commit_shot",
    description:
      "Mark a shot as approved + add it to the timeline's V1 video track. Equivalent to clicking 'Commit to timeline' in the canvas. Idempotent.",
    parameters: {
      type: "object",
      properties: {
        shot_id: { type: "string", description: "The shot id to commit." },
      },
      required: ["shot_id"],
    },
  },
};
const DESIGN_COMMIT_SHOT_TOOL: Anthropic.Tool = {
  name: "design_commit_shot",
  description: DESIGN_COMMIT_SHOT_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_COMMIT_SHOT_OPENAI_TOOL.function.parameters as any) },
};

const DESIGN_SAVE_PROMPT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_save_prompt",
    description:
      "Save a prompt to the workspace prompt library so the user can reuse it on future shots. Use when a prompt produced a great result and the user asks to keep / bookmark / remember it, or when you proactively want to capture a reusable pattern. The prompt is then available via the bookmark icon next to the prompt block in the canvas inspector.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label, e.g. 'Editorial landscape · golden hour' or 'Chairman portrait — line one'." },
        prompt: { type: "string", description: "The full prompt to save. If omitted, the current focused shot's prompt is used." },
        model_hint: { type: "string", description: "Optional model id this prompt was tuned for (e.g. 'runway-g4-5')." },
        team: { type: "boolean", description: "Share with the whole workspace. Default false (keeps it personal)." },
      },
      required: ["name"],
    },
  },
};
const DESIGN_SAVE_PROMPT_TOOL: Anthropic.Tool = {
  name: "design_save_prompt",
  description: DESIGN_SAVE_PROMPT_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_SAVE_PROMPT_OPENAI_TOOL.function.parameters as any) },
};

const DESIGN_RECALL_PROMPTS_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_recall_prompts",
    description:
      "Search the workspace's saved prompt library. Use when the user says 'use my editorial landscape prompt' / 'find my chairman portrait prompt' / 'what prompts have I saved' so you can match a name and then apply that prompt to a shot via design_update_shot.",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query, matched against prompt names and prompt body. Leave empty to list the most recently used." },
        limit: { type: "number", description: "Max prompts to return. Default 8." },
      },
      required: [],
    },
  },
};
const DESIGN_RECALL_PROMPTS_TOOL: Anthropic.Tool = {
  name: "design_recall_prompts",
  description: DESIGN_RECALL_PROMPTS_OPENAI_TOOL.function.description!,
  input_schema: { ...(DESIGN_RECALL_PROMPTS_OPENAI_TOOL.function.parameters as any) },
};

const ARTLIST_LICENSE_TOOL: Anthropic.Tool = {
  name: "license_artlist_asset",
  description: ARTLIST_LICENSE_OPENAI_TOOL.function.description!,
  input_schema: { ...(ARTLIST_LICENSE_OPENAI_TOOL.function.parameters as any) },
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
export const QUERY_ENGINE_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
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
          enum: ["commissioned_units", "completed_units", "pipeline_summary", "contracts_summary", "assigned_tasks", "social_performance"],
          description:
            "Run a pre-built report. commissioned_units = CUs from tasks created in period, completed_units = CUs completed in period, pipeline_summary = overview by status, contracts_summary = contracts with CU utilization/remaining/days-left (use for ANY question about contracts AND for 'active clients' — an active client is a client with >=1 flag-active contract, the app's own definition; contract end dates are often stale after informal extensions, so never drop clients on a past date_end; dedupe to one row per client when the user asked about clients; pass client_id to scope to one client, include_inactive=true to include ended contracts), assigned_tasks = current tasks assigned to a user, social_performance = social publishing data with engagement metrics (deduplicates by promo to give accurate post counts). MANDATORY: use social_performance for ANY question about how many posts were published, post performance, best posts, or engagement. Use the 'network' parameter to filter by platform.",
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
        include_inactive: {
          type: "boolean",
          description: "For contracts_summary report: include ended/inactive contracts. Default false (active only).",
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
          description: "Max rows (default 100). Always use 100 for listing queries.",
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

/* ─────────────── Client Context Lookup Tool ─────────────── */

export const LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "lookup_client_context",
    description:
      "Look up a client's full context including brand guidelines, AI-processed asset summaries, recent client meetings, and active contracts. Use this when the user asks about a specific client in the General channel or needs client-specific context that isn't already in the conversation.",
    parameters: {
      type: "object",
      properties: {
        client_name: {
          type: "string",
          description: "The client name to look up (e.g. 'IEEE', 'Zurich Insurance', 'WBCSD'). Fuzzy matching is supported.",
        },
      },
      required: ["client_name"],
    },
  },
};

const LOOKUP_CLIENT_CONTEXT_TOOL = {
  name: "lookup_client_context",
  description: LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL.function.description,
  input_schema: {
    ...(LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL.function.parameters as any),
  },
};

/**
 * Look up a client's full context by name — brand guidelines, meetings, contracts.
 */
export async function lookupClientContext(
  clientName: string,
  workspaceId: string
): Promise<string> {
  // 1. Match client name — ilike first, then fuzzy (voice transcription
  // misspells names: "Gelderma" → "Galderma", so substring match can miss).
  let { data: clients } = await supabase
    .from("app_clients")
    .select("id_client, name_client, link_website, information_industry, information_description")
    .ilike("name_client", `%${clientName}%`)
    .limit(3);

  let fuzzyMatched = false;
  if (!clients || clients.length === 0) {
    const { data: allClients } = await supabase
      .from("app_clients")
      .select("id_client, name_client, link_website, information_industry, information_description")
      .limit(500);
    const near = (allClients || []).filter((c: any) => fuzzyMatches(clientName, c.name_client || ""));
    if (near.length > 0) {
      clients = near;
      fuzzyMatched = true;
    }
  }

  if (!clients || clients.length === 0) {
    return `No client found matching "${clientName}" (including approximate spellings). Available clients can be queried with query_engine on the app_clients table.`;
  }

  const client = clients[0]; // Best match
  const parts: string[] = [];
  parts.push(`# Client: ${client.name_client}`);
  if (fuzzyMatched) {
    parts.push(`(Matched "${clientName}" approximately to registered client "${client.name_client}" — the name was probably transcribed with a different spelling. Use "${client.name_client}" from now on.)`);
  }
  if (client.link_website) parts.push(`Website: ${client.link_website}`);
  if (client.information_industry) parts.push(`Industry: ${client.information_industry}`);
  if (client.information_description) parts.push(`Description: ${client.information_description}`);

  // 2. Fetch AI-processed context (brand guidelines, asset summaries)
  const { intelligenceDb } = await import("@/lib/supabase-intelligence");
  const { data: ctx } = await intelligenceDb
    .from("ai_client_context")
    .select("document_context, units_asset_count, date_last_processed")
    .eq("id_workspace", workspaceId)
    .eq("id_client", client.id_client)
    .maybeSingle();

  if (ctx?.document_context) {
    parts.push(`\n## Brand & Asset Context (from ${ctx.units_asset_count} files, updated ${ctx.date_last_processed?.slice(0, 10)})`);
    parts.push(ctx.document_context);
  }

  // 3. Fetch client meetings
  const { data: meetings } = await intelligenceDb
    .from("ai_client_meetings")
    .select("meeting_title, meeting_date, meeting_summary, key_topics, next_steps, attendees_external")
    .eq("id_workspace", workspaceId)
    .eq("id_client", client.id_client)
    .order("meeting_date", { ascending: false })
    .limit(5);

  if (meetings && meetings.length > 0) {
    parts.push(`\n## Recent Client Meetings (${meetings.length})`);
    for (const m of meetings) {
      parts.push(`\n### ${m.meeting_title} (${m.meeting_date?.slice(0, 10)})`);
      if (m.attendees_external) parts.push(`External attendees: ${m.attendees_external}`);
      if (m.meeting_summary) parts.push(m.meeting_summary.slice(0, 500));
      if (m.key_topics) parts.push(`Key topics: ${m.key_topics}`);
      if (m.next_steps) parts.push(`Next steps: ${m.next_steps}`);
    }
  }

  // 4. Fetch active contracts summary
  const { data: contracts } = await supabase
    .from("app_contracts")
    .select("name_contract, units_contract, units_total_completed, date_start, date_end, type_status")
    .eq("id_client", client.id_client)
    .in("type_status", ["active", "Active"])
    .limit(5);

  if (contracts && contracts.length > 0) {
    parts.push(`\n## Active Contracts (${contracts.length})`);
    for (const c of contracts) {
      const used = c.units_total_completed || 0;
      const total = c.units_contract || 0;
      parts.push(`- ${c.name_contract}: ${used}/${total} CUs used (${c.date_start?.slice(0, 10)} → ${c.date_end?.slice(0, 10)})`);
    }
  }

  return parts.join("\n");
}

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
  clientId?: number,
  workspaceClientIds?: number[]
): Promise<{ data: any; error?: string }> {
  let query = supabase
    .from("app_content")
    .select("name_client, name_content, type_content, units_content, flag_completed, flag_spiked");

  if (workspaceClientIds?.length) query = query.in("id_client", workspaceClientIds);
  if (clientId) query = query.eq("id_client", clientId);

  // Order by recency so the 1000-row cap keeps the CURRENT pipeline (an
  // unordered limit returned an arbitrary subset once the table outgrew it).
  const { data: rows, error } = await query.order("date_created", { ascending: false }).limit(1000);
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

  // Per-client breakdown (with item names for in-progress work) — the
  // canonical "what's in the pipeline, by client?" answer, keyed by client
  // NAME so responses never say "Client 39".
  const byClient: Record<string, { in_progress: number; in_progress_cu: number; completed: number; items_in_progress: string[] }> = {};
  for (const item of items) {
    if (item.flag_spiked === 1) continue;
    const key = item.name_client || "Unassigned";
    if (!byClient[key]) byClient[key] = { in_progress: 0, in_progress_cu: 0, completed: 0, items_in_progress: [] };
    if (item.flag_completed === 1) {
      byClient[key].completed++;
    } else {
      byClient[key].in_progress++;
      byClient[key].in_progress_cu += item.units_content || 0;
      if (byClient[key].items_in_progress.length < 10 && item.name_content) {
        byClient[key].items_in_progress.push(item.name_content);
      }
    }
  }

  return {
    data: {
      total_items: items.length,
      commissioned: { count: commissioned.length, cu: commissioned.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      completed: { count: completed.length, cu: completed.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      spiked: { count: spiked.length, cu: spiked.reduce((s: number, c: any) => s + (c.units_content || 0), 0) },
      by_type: byType,
      by_client: byClient,
    },
  };
}

/**
 * Contracts summary report — all contracts (optionally one client) with CU
 * utilization. Pre-built so "what contracts do we have with X?" doesn't rely
 * on the model composing a raw app_contracts table query.
 */
async function reportContractsSummary(
  clientId?: number,
  workspaceClientIds?: number[],
  activeOnly: boolean = true
): Promise<{ data: any[]; total: number; error?: string; summary?: any }> {
  let query = supabase
    .from("app_contracts")
    .select("id_contract, name_contract, id_client, name_client, flag_active, units_contract, units_total_completed, units_content_completed, units_social_completed, date_start, date_end");

  if (workspaceClientIds?.length) query = query.in("id_client", workspaceClientIds);
  if (clientId) query = query.eq("id_client", clientId);
  if (activeOnly) query = query.eq("flag_active", 1);

  const { data: rows, error } = await query.order("date_end", { ascending: true }).limit(200);
  if (error) return { data: [], total: 0, error: error.message };

  const today = new Date();
  const data = (rows || []).map((c: any) => {
    const total = c.units_contract || 0;
    const used = c.units_total_completed || 0;
    const end = c.date_end ? new Date(c.date_end) : null;
    return {
      id_contract: c.id_contract,
      contract: c.name_contract,
      client: c.name_client,
      id_client: c.id_client,
      active: c.flag_active === 1,
      cu_total: total,
      cu_used: used,
      cu_remaining: Math.max(0, total - used),
      utilization_pct: total > 0 ? Math.round((used / total) * 100) : null,
      cu_content_completed: c.units_content_completed || 0,
      cu_social_completed: c.units_social_completed || 0,
      starts: c.date_start?.slice(0, 10) || null,
      ends: c.date_end?.slice(0, 10) || null,
      days_remaining: end ? Math.ceil((end.getTime() - today.getTime()) / 86_400_000) : null,
    };
  });

  const summary = {
    contracts: data.length,
    total_cu: data.reduce((s, c) => s + c.cu_total, 0),
    used_cu: data.reduce((s, c) => s + c.cu_used, 0),
    remaining_cu: data.reduce((s, c) => s + c.cu_remaining, 0),
    ending_within_30_days: data.filter((c) => c.days_remaining !== null && c.days_remaining >= 0 && c.days_remaining <= 30).length,
  };

  return { data, total: data.length, summary };
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
export async function queryEngine(
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
        const result = await reportPipelineSummary(clientId, workspaceClientIds);
        return { data: result.data, count: 1, error: result.error };
      }
      case "contracts_summary": {
        const result = await reportContractsSummary(clientId, workspaceClientIds, args?.include_inactive !== true);
        return { data: result.data, count: result.data.length, total: result.total, error: result.error, summary: result.summary };
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
  const maxRows = Math.min(Math.max(limit || 100, 1), 100);
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
export async function generateImage(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024",
  provider: ImageProvider = "openai",
  brand?: import("./branded-prompt").BrandContext | null
): Promise<string> {
  // Apply client brand context when one is loaded (auto-on in Design mode).
  if (brand) {
    const { buildBrandedImagePrompt, brandPromptApplied } = await import("./branded-prompt");
    const augmented = buildBrandedImagePrompt(prompt, brand, { includeDocumentContext: true });
    if (brandPromptApplied(prompt, augmented)) {
      console.log(`[BrandPrompt] augmented image prompt for client=${brand.clientName || "?"} (+${augmented.length - prompt.length} chars)`);
      prompt = augmented;
    }
  }

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
    // OpenAI — used by openai, anthropic, and gemini providers.
    // Prefer gpt-image-1 (current flagship, returns base64) and fall back to
    // dall-e-3 (URL) if the account hasn't been verified for gpt-image-1 yet.
    const openai = getOpenAIClient();

    // gpt-image-1 sizes: 1024x1024 | 1536x1024 | 1024x1536 | auto
    // dall-e-3   sizes: 1024x1024 | 1792x1024 | 1024x1792
    const gptImageSize: "1024x1024" | "1536x1024" | "1024x1536" =
      size === "1792x1024" ? "1536x1024" :
      size === "1024x1792" ? "1024x1536" :
      "1024x1024";

    const generateWithGptImage1 = async (): Promise<Buffer> => {
      const res = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: gptImageSize,
        quality: "high",
      } as any);
      const data = res.data?.[0];
      if (data && (data as any).b64_json) {
        return Buffer.from((data as any).b64_json, "base64");
      }
      if (data?.url) {
        const r = await fetch(data.url);
        if (!r.ok) throw new Error("Failed to download gpt-image-1 result");
        return Buffer.from(await r.arrayBuffer());
      }
      throw new Error("gpt-image-1 returned no image data");
    };

    const generateWithDallE3 = async (): Promise<Buffer> => {
      const res = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        quality: "standard",
      });
      const tempUrl = res.data?.[0]?.url;
      if (!tempUrl) throw new Error("DALL-E returned no image URL");
      const imageRes = await fetch(tempUrl);
      if (!imageRes.ok) throw new Error("Failed to download generated image");
      return Buffer.from(await imageRes.arrayBuffer());
    };

    try {
      imageBuffer = await generateWithGptImage1();
      console.log(`[Image Gen] gpt-image-1 (${gptImageSize})`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const status = err?.status || err?.response?.status;
      // Fall back to DALL-E 3 only on "model not available" type errors —
      // not on content-policy violations or bad-input errors.
      const isModelUnavailable =
        status === 404 ||
        /does not exist|model.*not.*found|verify your organization|access.*denied/i.test(msg);
      if (!isModelUnavailable) throw err;
      console.warn(`[Image Gen] gpt-image-1 unavailable (${msg}); falling back to dall-e-3`);
      try {
        imageBuffer = await generateWithDallE3();
        console.log(`[Image Gen] dall-e-3 (${size})`);
      } catch (fallbackErr: any) {
        const fmsg = fallbackErr?.message || String(fallbackErr);
        throw new Error(
          `Image generation failed on both gpt-image-1 (${msg}) and dall-e-3 (${fmsg}). ` +
            `Verify your OpenAI organization at https://platform.openai.com/settings/organization/general and enable image generation.`
        );
      }
    }
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

/* ─────────────── Video Generation (Runway) ─────────────── */

/**
 * Run a Runway video generation, mirror the result to Vercel Blob, return the
 * proxy URL. Mirrors generateImage's contract.
 */
export async function generateVideo(
  prompt: string,
  options: {
    duration?: 5 | 10;
    format?: "landscape" | "portrait" | "square";
    imageUrl?: string;
    model?: import("@/lib/integrations/runway").RunwayModel;
    brand?: import("./branded-prompt").BrandContext | null;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<{ videoUrl: string; durationSec: number; model: string; thumbnailUrl?: string }> {
  const { generateRunwayVideo, ratioForFormat } = await import("@/lib/integrations/runway");

  // Brand-aware prompt augmentation (same path as images).
  let finalPrompt = prompt;
  if (options.brand) {
    const { buildBrandedImagePrompt, brandPromptApplied } = await import("./branded-prompt");
    const augmented = buildBrandedImagePrompt(prompt, options.brand);
    if (brandPromptApplied(prompt, augmented)) {
      console.log(`[BrandPrompt] augmented video prompt for client=${options.brand.clientName || "?"} (+${augmented.length - prompt.length} chars)`);
      finalPrompt = augmented;
    }
  }

  // Resolve image URL: if it's our auth-proxy URL, fetch via blob-utils and re-host
  // publicly so Runway can read it. (Runway can't see /api/media/file.)
  let publicImageUrl: string | undefined;
  if (options.imageUrl) {
    if (/^https?:\/\//i.test(options.imageUrl) && !options.imageUrl.includes("/api/media/file")) {
      publicImageUrl = options.imageUrl;
    } else {
      // Internal proxy URL — fetch buffer and put it on Blob with public access so Runway can grab it.
      const { fetchBlobContent } = await import("./blob-utils");
      const { buffer, contentType } = await fetchBlobContent(options.imageUrl);
      const tempName = `runway-src/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const tempBlob = await put(tempName, buffer, { access: "public", contentType: contentType || "image/png" });
      publicImageUrl = tempBlob.url;
    }
  }

  // Generate via Runway
  const { videoUrl, durationSec, model } = await generateRunwayVideo({
    prompt: finalPrompt,
    imageUrl: publicImageUrl,
    duration: options.duration ?? 5,
    ratio: ratioForFormat(options.format),
    model: options.model ?? "gen4.5",
    onProgress: options.onProgress ? (p) => options.onProgress!(p) : undefined,
  });

  // Download mp4 and mirror to private Blob
  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error(`Failed to download Runway video (${dlRes.status})`);
  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());

  const filename = `design/video/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const blob = await put(filename, videoBuffer, { access: "private", contentType: "video/mp4" });

  return {
    videoUrl: `/api/media/file?path=${encodeURIComponent(blob.pathname)}`,
    durationSec,
    model,
  };
}

/* ─────────────── Artlist Helpers (Design Mode) ─────────────── */

/** Search Artlist and surface results to the AI as a structured tool_result. */
async function searchArtlistCatalogue(input: {
  query: string;
  duration_min?: number;
  duration_max?: number;
  orientation?: "landscape" | "portrait" | "square";
  mood?: string;
  page?: number;
}): Promise<{ items: Array<{ id: string; title: string; previewUrl: string; thumbnailUrl: string; durationSec: number; orientation: string; tags: string[] }>; totalCount: number; hasMore: boolean }> {
  const { searchArtlist } = await import("@/lib/integrations/artlist");
  const res = await searchArtlist({
    query: input.query,
    durationMin: input.duration_min,
    durationMax: input.duration_max,
    orientation: input.orientation,
    mood: input.mood,
    page: input.page,
  });
  return {
    items: res.items.map((a) => ({
      id: a.id, title: a.title, previewUrl: a.previewUrl, thumbnailUrl: a.thumbnailUrl,
      durationSec: a.durationSec, orientation: a.orientation, tags: a.tags || [],
    })),
    totalCount: res.totalCount,
    hasMore: res.hasMore,
  };
}

/** License an Artlist asset and mirror it to private Blob. */
async function licenseArtlistAndMirror(assetId: string): Promise<{ videoUrl: string; licenseTerms: string; durationSec?: number }> {
  const { licenseArtlistAsset, downloadArtlistAsset } = await import("@/lib/integrations/artlist");
  const { downloadUrl, licenseTerms } = await licenseArtlistAsset(assetId);
  const buffer = await downloadArtlistAsset(downloadUrl);
  const filename = `design/artlist/${assetId}-${Date.now()}.mp4`;
  const blob = await put(filename, buffer, { access: "private", contentType: "video/mp4" });
  return {
    videoUrl: `/api/media/file?path=${encodeURIComponent(blob.pathname)}`,
    licenseTerms,
  };
}

/* ─────────────── Design Mode: Brand Context Loader ─────────────── */

/**
 * Load the client's brand context for a Design mode generation. Returns null if
 * no client is loaded or no context exists yet (so we cleanly fall back to a raw
 * prompt). Lightweight: one DB read.
 */
export async function loadBrandContext(
  workspaceId: string | undefined,
  clientId: number | undefined
): Promise<import("./branded-prompt").BrandContext | null> {
  if (!workspaceId || !clientId) return null;
  try {
    const { intelligenceDb } = await import("@/lib/supabase-intelligence");
    const [{ data: ctx }, { data: client }] = await Promise.all([
      intelligenceDb
        .from("ai_client_context")
        .select("document_context, visual_identity")
        .eq("id_workspace", workspaceId)
        .eq("id_client", clientId)
        .maybeSingle(),
      supabase
        .from("app_clients")
        .select("name_client")
        .eq("id_client", clientId)
        .maybeSingle(),
    ]);
    if (!ctx && !client) return null;
    return {
      clientName: (client as any)?.name_client || undefined,
      documentContext: (ctx as any)?.document_context || null,
      visualIdentity: (ctx as any)?.visual_identity || null,
    };
  } catch (err: any) {
    console.warn("[BrandContext] load failed:", err?.message);
    return null;
  }
}

/* ─────────────── Design Mode: Asset Persistence ─────────────── */

export interface PersistAssetInput {
  conversationId?: string | null;
  workspaceId: string;
  clientId?: number | null;
  contentId?: number | null;
  userId: number;
  type: "image" | "video" | "document" | "artlist_video";
  source: "dalle" | "grok_imagine" | "runway" | "artlist" | "upload" | "chart";
  blobUrl: string;          // /api/media/file?path=...
  prompt?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Insert a row into ai_design_assets. Fire-and-forget; failures only log. */
/**
 * Studio mode: link a freshly generated asset to a design_shot.
 *
 * If `focusedShotId` is set, the asset becomes a new version of that shot.
 * Otherwise a new shot is created in the session and the asset becomes v1.
 *
 * Returns the shot id + version id so the caller can surface them to the
 * client (e.g. so a refresh of the session picks them up).
 *
 * Best-effort: errors are logged and the function returns null shotId/versionId
 * so the asset still exists in the canvas via id_workspace + id_content.
 */
export async function linkAssetToShot(opts: {
  sessionId: string;
  focusedShotId?: string;
  assetId: string;
  prompt: string;
  modelId: string;
  metadata: Record<string, unknown>;
}): Promise<{ shotId: string | null; versionId: string | null }> {
  try {
    const { intelligenceDb } = await import("@/lib/supabase-intelligence");
    let shotId = opts.focusedShotId || null;

    if (!shotId) {
      // Create a new shot at the end of the session
      const { count } = await intelligenceDb
        .from("design_shots")
        .select("id_shot", { count: "exact", head: true })
        .eq("id_session", opts.sessionId);
      const nextIdx = (count || 0) + 1;
      const { data: created } = await intelligenceDb
        .from("design_shots")
        .insert({
          id_session: opts.sessionId,
          idx: nextIdx,
          name_shot: opts.prompt.slice(0, 60) || `Shot ${nextIdx}`,
          duration_sec: 5,
          model_id: opts.modelId,
          status: "review",
          flag_on_brand: 1,
          prompt: opts.prompt,
        })
        .select("id_shot")
        .single();
      shotId = (created as any)?.id_shot || null;
    }

    if (!shotId) return { shotId: null, versionId: null };

    // Append a new version
    const { data: maxRow } = await intelligenceDb
      .from("design_shot_versions")
      .select("idx")
      .eq("id_shot", shotId)
      .order("idx", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVerIdx = ((maxRow as any)?.idx || 0) + 1;

    const { data: ver } = await intelligenceDb
      .from("design_shot_versions")
      .insert({
        id_shot: shotId,
        idx: nextVerIdx,
        id_asset: opts.assetId,
        prompt_used: opts.prompt,
        model_id: opts.modelId,
        metadata: opts.metadata,
      })
      .select("id_version")
      .single();
    const versionId = (ver as any)?.id_version || null;

    if (versionId) {
      // Update the shot's current_version + bump the timestamp
      await intelligenceDb
        .from("design_shots")
        .update({ current_version_id: versionId, date_updated: new Date().toISOString() })
        .eq("id_shot", shotId);

      // Stamp the version + shot links on the asset row
      await intelligenceDb
        .from("ai_design_assets")
        .update({ id_shot: shotId, id_version: versionId })
        .eq("id_asset", opts.assetId);
    }

    return { shotId, versionId };
  } catch (err: any) {
    console.warn("[StudioMode] linkAssetToShot failed:", err?.message);
    return { shotId: null, versionId: null };
  }
}

export async function persistDesignAsset(input: PersistAssetInput): Promise<string | null> {
  try {
    const { intelligenceDb } = await import("@/lib/supabase-intelligence");
    // Extract blob_path from the proxy URL.
    const m = input.blobUrl.match(/\/api\/media\/file\?path=([^&]+)/);
    const blobPath = m ? decodeURIComponent(m[1]) : input.blobUrl;
    const insertPayload: Record<string, unknown> = {
      id_conversation: input.conversationId || null,
      id_workspace: input.workspaceId,
      id_client: input.clientId ?? null,
      id_content: input.contentId ?? null,
      user_created: input.userId,
      type_asset: input.type,
      source: input.source,
      blob_path: blobPath,
      blob_url: input.blobUrl,
      prompt: input.prompt ?? null,
      parent_id: input.parentId || null,
      metadata: input.metadata || {},
    };
    let { data, error } = await intelligenceDb
      .from("ai_design_assets")
      .insert(insertPayload)
      .select("id_asset")
      .single();
    // Backwards-compat fallback if the id_content column hasn't been migrated yet.
    if (error?.code === "42703") {
      const { id_content, ...legacy } = insertPayload;
      const retry = await intelligenceDb
        .from("ai_design_assets")
        .insert(legacy)
        .select("id_asset")
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.warn("[DesignAssets] persist failed:", error.message);
      return null;
    }
    return (data as any)?.id_asset || null;
  } catch (err: any) {
    console.warn("[DesignAssets] persist exception:", err?.message);
    return null;
  }
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

/** OpenAI-compatible tool definition for web_search. Executed via executeWebSearch()
 *  (xAI LiveSearch under the hood) for GPT and Gemini, which have no native search here.
 *  Anthropic uses its native web_search_20250305 tool; xAI uses native search_mode. */
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

export const MEETINGBRAIN_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_meetingbrain",
    description:
      "Query MeetingBrain for tasks, meetings, meeting details (including full transcripts), and client meetings. Privacy: personal meetings are only visible to attendees; client meetings (where external domain attendees are present) are shared with the workspace.",
    parameters: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["my_tasks", "meetings", "upcoming_meetings", "search_meetings", "meeting_details", "client_meetings"],
          description: "my_tasks = open tasks/action items, meetings = recent past meetings with summaries, upcoming_meetings = scheduled future meetings, search_meetings = search by keyword, meeting_details = full meeting details including transcript (requires meeting_id), client_meetings = summaries of meetings with external client attendees across the workspace",
        },
        query: { type: "string", description: "Search keyword for search_meetings" },
        meeting_id: { type: "string", description: "Meeting ID for meeting_details (from search_meetings results)" },
        status: { type: "string", enum: ["open", "completed", "all"], description: "Task status filter. Default: open" },
        days: { type: "number", description: "Lookback window in days. Default: 90 for meetings, 14 for upcoming" },
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

// MeetingBrain Supabase client (meetingbrain schema)
import { createClient as createMBClient } from "@supabase/supabase-js";

let _mbDb: any = null;
function getMeetingBrainDb() {
  if (!_mbDb) {
    _mbDb = createMBClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: "meetingbrain" } }
    );
  }
  return _mbDb;
}

export async function queryMeetingBrain(
  report: string,
  userEmail: string,
  options: { query?: string; status?: string; days?: number; workspaceId?: string; meetingId?: string; visibility?: "private" | "team" } = {}
): Promise<{ data: any; count: number; error?: string; errorKind?: "invalid_call" | "infra"; notice?: string; hint?: string }> {
  // Every error return must go through this: the error paths used to be
  // silent, which made "why did the tool fail" undiagnosable from logs.
  // errorKind drives formatMeetingBrainResult — "invalid_call" (bad args from
  // the model) nudges a corrected retry; "infra" reports a real outage.
  const fail = (error: string, errorKind: "invalid_call" | "infra" = "infra") => {
    console.warn(`[MeetingBrain] ${report} failed (${errorKind}): ${error}`);
    return { data: [], count: 0, error, errorKind };
  };
  // PRIVACY GATE: personal reports return the caller's own meetings/tasks
  // (enforced by attendee email in the RPCs). In a TEAM conversation the tool
  // result becomes visible to every workspace member, so blocking here is the
  // only thing stopping one user's personal transcript landing in a shared
  // thread. client_meetings is exempt — that report is workspace-shared by
  // design and gated on registered client domains.
  if (options.visibility === "team" && report !== "client_meetings") {
    console.log(`[MeetingBrain] Blocked personal report "${report}" in team conversation`);
    return {
      data: [], count: 0,
      notice: [
        `This report ("${report}") returns the user's PERSONAL meeting/task data, but this is a TEAM conversation visible to all workspace members — so it was not run, to protect their privacy.`,
        ``,
        `Tell the user (briefly, friendly):`,
        `- Personal meetings and tasks can only be discussed in a private conversation — ask them to switch to or start a private chat for that.`,
        `- If they're after a CLIENT meeting, you can use report: "client_meetings" right here — client meetings are shared with the whole workspace.`,
      ].join("\n"),
    };
  }
  const mbDb = getMeetingBrainDb();
  try {
    switch (report) {
      case "my_tasks": {
        const { data: tasks, error } = await mbDb.rpc("get_active_tasks", {
          p_user_email: userEmail,
          p_limit: 50,
        });
        if (error) return fail(error.message);

        const filtered = options.status === "completed"
          ? (tasks || []).filter((t: any) => t.status === "DONE")
          : options.status === "all"
            ? (tasks || [])
            : (tasks || []).filter((t: any) => t.status !== "DONE");

        const data = filtered.map((r: any) => ({
          id: r.id,
          title: r.title,
          description: r.description?.slice(0, 200) || null,
          status: r.status,
          responsible: r.responsible,
          deadline: r.deadline?.slice(0, 10) || null,
          created: r.created_at?.slice(0, 10),
          from_meeting: r.meeting_source || null,
          project: r.project_name || null,
        }));
        console.log(`[MeetingBrain] Tasks: ${data.length} for ${userEmail}`);
        return { data, count: data.length };
      }
      case "meetings": {
        const d = options.days || 90;
        const since = new Date(); since.setDate(since.getDate() - d);

        // p_until: now is ESSENTIAL — the RPC sorts newest-first and includes
        // scheduled future meetings, so without an upper bound the limit-40
        // window fills with future calendar entries (recurring pickups,
        // weekly syncs…) and past meetings never make it into the result;
        // the past-only filter below then leaves nothing.
        const { data: meetings, error } = await mbDb.rpc("search_meetings", {
          p_user_email: userEmail,
          p_since: since.toISOString(),
          p_until: new Date().toISOString(),
          p_limit: 40,
        });
        if (error) return fail(error.message);

        // Filter to past meetings only
        const now = new Date();
        const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const past = (meetings || []).filter((r: any) => new Date(r.meeting_date) <= now);

        const data = past.map((r: any) => {
          const isRecent = new Date(r.meeting_date) >= twoWeeksAgo;
          return {
            id: r.id,
            title: r.meeting_title,
            date: r.meeting_date?.slice(0, 16),
            attendees: isRecent ? r.attendees : undefined,
            summary: isRecent ? r.summary?.slice(0, 500) : r.summary?.slice(0, 150),
            has_transcript: r.has_transcript,
          };
        });
        console.log(`[MeetingBrain] Meetings: ${data.length} (${d}d window)`);
        return { data, count: data.length };
      }
      case "upcoming_meetings": {
        const d = options.days || 14;
        const now = new Date();
        const until = new Date(); until.setDate(until.getDate() + d);

        const { data: meetings, error } = await mbDb.rpc("search_meetings", {
          p_user_email: userEmail,
          p_since: now.toISOString(),
          p_until: until.toISOString(),
          p_limit: 30,
        });
        if (error) return fail(error.message);

        const data = (meetings || []).map((r: any) => ({
          id: r.id,
          title: r.meeting_title,
          date: r.meeting_date?.slice(0, 16),
          end_date: r.meeting_end_date?.slice(0, 16) || null,
          attendees: r.attendees,
          location: r.location?.slice(0, 200) || null,
        }));
        console.log(`[MeetingBrain] Upcoming: ${data.length} (${d}d window)`);
        return { data, count: data.length };
      }
      case "search_meetings": {
        if (!options.query) return fail(`the "query" argument is required for search_meetings — pass a keyword like an attendee name or topic`, "invalid_call");
        const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const { data: exact, error } = await mbDb.rpc("search_meetings", {
          p_user_email: userEmail,
          p_query: options.query,
          p_limit: 20,
        });
        if (error) return fail(error.message);

        // Fuzzy enrichment: voice transcription misspells proper nouns
        // ("Gelderma" for "Galderma", "Amorite" for "Amrize") and the RPC's
        // literal match misses them — or worse, full-text matches the word
        // inside unrelated meeting TRANSCRIPTS (daily standups that mention
        // a client) and drowns the actual meeting. So we ALWAYS also fuzzy-
        // match the query against recent meeting titles + attendees and
        // surface those matches first.
        const sixMonthsAgo = new Date(); sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);
        // p_until bounds the window to past meetings — without it the
        // newest-first sort fills the limit with future calendar entries.
        const { data: recent } = await mbDb.rpc("search_meetings", {
          p_user_email: userEmail,
          p_since: sixMonthsAgo.toISOString(),
          p_until: new Date().toISOString(),
          p_limit: 100,
        });
        const near = (recent || []).filter((r: any) =>
          fuzzyMatches(options.query!, `${r.meeting_title || ""} ${r.attendees || ""}`)
        );
        // Merge: fuzzy title/attendee matches first (most likely what the
        // user named), then exact full-text results, deduped by id.
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const r of [...near, ...(exact || [])]) {
          const id = String(r.id);
          if (seen.has(id)) continue;
          seen.add(id);
          merged.push(r);
        }
        const meetings = merged.slice(0, 20);
        let fuzzyNote: string | undefined;
        if (near.length > 0) {
          const nearIds = new Set(near.map((r: any) => String(r.id)));
          const topIsFuzzy = meetings.length > 0 && nearIds.has(String(meetings[0].id));
          if ((exact || []).length === 0) {
            fuzzyNote = `No exact matches for "${options.query}" — these are CLOSE matches by title/attendees (the name was probably transcribed with a different spelling). Confirm naturally with the user, e.g. "I found your meeting with <actual title> — that's the one, right?"`;
          } else if (topIsFuzzy) {
            fuzzyNote = `The first ${near.length} result(s) matched the meeting TITLE or attendees approximately — these are most likely what the user named (possibly transcribed with a different spelling). Later results only mention the search words somewhere in their content.`;
          }
          console.log(`[MeetingBrain] Search "${options.query}": ${near.length} fuzzy title matches merged with ${(exact || []).length} exact`);
        }

        // search_meetings has no time bounds — it matches FUTURE (scheduled)
        // meetings too. Label each row so the model never mistakes an
        // upcoming meeting for one that already happened (and tried to read
        // its nonexistent notes).
        const now = new Date();
        const data = (meetings || []).map((r: any) => {
          const meetingDate = new Date(r.meeting_date);
          const isRecent = meetingDate >= twoWeeksAgo;
          const isUpcoming = meetingDate > now;
          return {
            id: r.id,
            title: r.meeting_title,
            date: r.meeting_date?.slice(0, 10),
            status: isUpcoming ? "UPCOMING — scheduled, has not happened yet, no notes exist" : "past",
            attendees: r.attendees,
            summary: isUpcoming ? undefined : isRecent ? r.summary?.slice(0, 500) : r.summary?.slice(0, 200),
            has_transcript: isUpcoming ? false : r.has_transcript,
          };
        });
        const upcomingNote = data.some((d: any) => d.status !== "past")
          ? `NOTE: Some results are UPCOMING meetings that have not happened yet — they have no transcript or notes. When the user asks about a meeting they HAD (past tense), only consider results with status "past".`
          : undefined;
        const hint = [fuzzyNote, upcomingNote].filter(Boolean).join("\n") || undefined;
        console.log(`[MeetingBrain] Search "${options.query}": ${data.length} matches (${data.filter((d: any) => d.status !== "past").length} upcoming)`);
        return { data, count: data.length, hint };
      }
      case "meeting_details": {
        if (!options.meetingId) return fail("meeting_id required — get it from search_meetings first", "invalid_call");

        const { data: details, error } = await mbDb.rpc("get_meeting_details", {
          p_user_email: userEmail,
          p_meeting_id: options.meetingId,
        });
        if (error) return fail(error.message);
        if (!details || (Array.isArray(details) && details.length === 0)) {
          return fail(`no meeting exists with meeting_id "${options.meetingId}" (or the user is not an attendee) — that id is wrong or stale`, "invalid_call");
        }

        const d = Array.isArray(details) ? details[0] : details;
        // Transcripts can be 25k+ chars for an hour-long recording. Claude
        // has plenty of context budget — give it the whole thing up to a
        // generous cap (~25k tokens). Truncating at 8k cut off mid-sentence
        // and made the AI miss most of the meeting.
        const transcript = d.transcript?.slice(0, 100000) || null;
        // Many meetings have only a stub transcript (or none) while the real
        // record lives in summary/insights/coaching_notes. Surface everything
        // and label the transcript state so the model answers from the notes
        // instead of telling the user "no transcript available".
        const hasNotes = !!(d.summary || d.insights || d.coaching_notes || d.external_summary || d.next_steps);
        const transcriptStatus = !transcript ? "none" : transcript.length < 1000 ? "stub_only" : "full";
        const data = {
          title: d.meeting_title,
          date: d.meeting_date?.slice(0, 16),
          attendees: d.attendees,
          summary: d.summary,
          transcript,
          transcript_status: transcriptStatus,
          key_topics: d.key_topics,
          next_steps: d.next_steps,
          insights: d.insights,
          coaching_notes: d.coaching_notes,
          external_summary: d.external_summary,
          tasks: d.tasks,
        };
        const hint =
          transcriptStatus !== "full" && hasNotes
            ? `IMPORTANT: This meeting has ${transcriptStatus === "none" ? "no transcript" : "only a stub transcript"}, but the summary/insights/coaching_notes/external_summary fields above ARE the meeting notes — they are the full record for this meeting. Answer the user's question from them. Do NOT tell the user the meeting has no notes or no record.`
            : undefined;
        console.log(`[MeetingBrain] Details for ${options.meetingId}: ${d.meeting_title} (transcript=${transcriptStatus})`);
        return { data, count: 1, hint };
      }
      case "client_meetings": {
        // Live query against the meetingbrain schema (same direct-connector
        // pattern as every other report) — no dependency on a synced copy
        // that can go stale.
        //
        // Privacy: a "client meeting" is gated on a REGISTERED client domain
        // (from app_clients.link_website), exactly like the old synced table —
        // so personal/vendor/non-client external meetings stay out of this
        // workspace-shared report. We fetch the client-domain allowlist here
        // (EngineAI owns app_clients) and pass it into the RPC.
        const internalDomain = userEmail.split("@")[1] || "";
        if (!internalDomain) return fail("Could not derive workspace domain from user email");

        // Build the registered-client domain allowlist from app_clients.
        const { supabase: publicDb } = await import("@/lib/supabase");
        const { data: clientRows } = await publicDb
          .from("app_clients")
          .select("link_website");
        const normalizeDomain = (url: string | null): string | null => {
          if (!url) return null;
          let d = url.trim().toLowerCase();
          d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
          d = d.split("/")[0].split("?")[0].split("#")[0].trim();
          return d.length > 3 && d.includes(".") ? d : null;
        };
        // Known client email domains that differ from their registered
        // app_clients.link_website (or where the website is unset), so the
        // privacy gate doesn't drop these real clients. Keep this list to
        // CONFIRMED clients only — adding a non-client domain here would leak
        // that org's meetings into the workspace-shared report.
        const CLIENT_DOMAIN_ALIASES = [
          "beonemed.com", // BeOne Medicines (registered as beonemedicines.com)
          "hiscox.com",   // Hiscox Insurance (registered with no website)
        ];
        const clientDomains = Array.from(new Set([
          ...(clientRows || [])
            .map((c: any) => normalizeDomain(c.link_website))
            .filter((d: string | null): d is string => !!d && d !== internalDomain),
          ...CLIENT_DOMAIN_ALIASES,
        ]));

        const since = new Date(); since.setDate(since.getDate() - 90);
        const twoWeeksBack = new Date(); twoWeeksBack.setDate(twoWeeksBack.getDate() - 14);

        const { data: meetings, error: mtgErr } = await mbDb.rpc("get_client_meetings", {
          p_internal_domain: internalDomain,
          p_client_domains: clientDomains.length > 0 ? clientDomains : null,
          p_since: since.toISOString(),
          p_limit: 100,
        });

        if (!mtgErr) {
          const data = (meetings || []).map((r: any) => {
            const isRecent = new Date(r.meeting_date) >= twoWeeksBack;
            return {
              meeting_id: r.meeting_id,
              title: r.meeting_title,
              date: r.meeting_date?.slice(0, 10),
              summary: isRecent ? r.summary?.slice(0, 400) : r.summary?.slice(0, 150),
              key_topics: isRecent ? r.key_topics?.slice(0, 200) : r.key_topics?.slice(0, 100),
              next_steps: isRecent ? (r.next_steps?.slice(0, 200) || null) : undefined,
              attendees: isRecent ? r.external_attendees : undefined,
            };
          });
          console.log(`[MeetingBrain] Client meetings: ${data.length} (live, domain=${internalDomain})`);
          return { data, count: data.length };
        }

        // Fallback: RPC not present yet (deploy ordering) — read the synced
        // table. The hourly sync-context cron keeps it reasonably fresh.
        console.warn(`[MeetingBrain] get_client_meetings RPC failed (${mtgErr.message}), falling back to ai_client_meetings`);
        if (!options.workspaceId) return fail(mtgErr.message);
        const { intelligenceDb } = await import("@/lib/supabase-intelligence");
        const { data: synced, error: syncErr } = await intelligenceDb
          .from("ai_client_meetings")
          .select("id_client, meeting_id, meeting_title, meeting_date, meeting_summary, key_topics, next_steps, attendees_external")
          .eq("id_workspace", options.workspaceId)
          .order("meeting_date", { ascending: false })
          .limit(100);
        if (syncErr) return fail(syncErr.message);
        const data = (synced || []).map((r: any) => {
          const isRecent = new Date(r.meeting_date) >= twoWeeksBack;
          return {
            client_id: r.id_client,
            meeting_id: r.meeting_id,
            title: r.meeting_title,
            date: r.meeting_date?.slice(0, 10),
            summary: isRecent ? r.meeting_summary?.slice(0, 400) : r.meeting_summary?.slice(0, 150),
            key_topics: isRecent ? r.key_topics?.slice(0, 200) : r.key_topics?.slice(0, 100),
            next_steps: isRecent ? (r.next_steps?.slice(0, 200) || null) : undefined,
            attendees: isRecent ? r.attendees_external : undefined,
          };
        });
        console.log(`[MeetingBrain] Client meetings: ${data.length} (synced fallback)`);
        return { data, count: data.length };
      }
      default: return fail(`Unknown report: "${report}" — valid reports are my_tasks, meetings, upcoming_meetings, search_meetings, meeting_details, client_meetings`, "invalid_call");
    }
  } catch (err: any) {
    console.error("[MeetingBrain] Error:", err.message);
    return { data: [], count: 0, error: err.message, errorKind: "infra" as const };
  }
}

/* ─────────────── Slack Query Tool ─────────────── */

/**
 * query_slack — reads the user's Slack via MeetingBrain's stored OAuth token.
 *
 * Privacy: server-to-server request to MeetingBrain; MeetingBrain uses the
 * requesting user's own user-scope Slack token so Slack itself enforces the
 * access boundary (user only sees messages they could see in Slack).
 */
export const SLACK_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_slack",
    description:
      "Query the user's own Slack (read-only) for DMs, mentions, messages, and threads. All access is scoped to the user's own Slack account via their OAuth token — you can only see what the user could see in Slack themselves. Never use this to answer questions about another user's Slack activity.",
    parameters: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: [
            "recent_dms",
            "search_messages",
            "channel_messages",
            "my_mentions",
            "thread",
            "list_channels",
          ],
          description:
            "recent_dms = user's most recent DMs/group DMs with previews, search_messages = full-text search across everything the user can read (requires query), channel_messages = recent messages in a named channel (requires channel name or id), my_mentions = messages that @-mention the user, thread = full thread replies (requires channel_id + thread_ts), list_channels = channels the user is a member of",
        },
        query: {
          type: "string",
          description: "Search keyword(s) for search_messages. Slack operators are allowed (e.g. `from:@alice after:2026-04-01`).",
        },
        channel: {
          type: "string",
          description: "Channel name (e.g. '#general') or channel ID for channel_messages. Must be a channel the user is a member of.",
        },
        channel_id: {
          type: "string",
          description: "Channel ID (starts with C, D, or G) for the thread report.",
        },
        thread_ts: {
          type: "string",
          description: "Parent message timestamp for the thread report (from a previous search_messages or channel_messages result).",
        },
        days: {
          type: "number",
          description: "Lookback window in days. Default: 7 for messages, 30 for search.",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 20, max 50.",
        },
      },
      required: ["report"],
    },
  },
};

const SLACK_TOOL: Anthropic.Tool = {
  name: "query_slack",
  description: SLACK_OPENAI_TOOL.function.description!,
  input_schema: { ...(SLACK_OPENAI_TOOL.function.parameters as any) },
};

/**
 * Server-to-server call from EngineAI to MeetingBrain's Slack query endpoint.
 * MeetingBrain holds the user's Slack OAuth token; EngineAI never touches it.
 */
export async function querySlack(
  report: string,
  userEmail: string,
  options: {
    query?: string;
    channel?: string;
    channel_id?: string;
    thread_ts?: string;
    days?: number;
    limit?: number;
    visibility?: "private" | "team";
  } = {}
): Promise<{ data: any; count: number; error?: string; needsReauth?: boolean; notice?: string }> {
  // PRIVACY GATE: Slack results are scoped to the requesting user's own OAuth
  // token (their DMs, their channels). In a TEAM conversation the tool result
  // is visible to every workspace member — block all Slack reports there.
  if (options.visibility === "team") {
    console.log(`[Slack] Blocked report "${report}" in team conversation`);
    return {
      data: [], count: 0,
      notice: [
        `Slack queries return the user's PERSONAL Slack data (their DMs, mentions, channels), but this is a TEAM conversation visible to all workspace members — so the query was not run, to protect their privacy.`,
        ``,
        `Tell the user (briefly, friendly) that Slack lookups only work in private conversations — ask them to switch to or start a private chat to search their Slack.`,
      ].join("\n"),
    };
  }
  const baseUrl = (
    process.env.MEETINGBRAIN_BASE_URL ||
    "https://www.meetingbrain.ai"
  ).trim();
  // Trim to defend against trailing whitespace/newlines in the env value.
  const key = (
    process.env.MEETINGBRAIN_API_KEY ||
    process.env.ENGINEGPT_INGEST_KEY ||
    ""
  ).trim();

  if (!key) {
    return { data: [], count: 0, error: "MEETINGBRAIN_API_KEY not configured on EngineAI" };
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/engineai/slack/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({ userEmail, report, ...options }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error || `HTTP ${res.status}`;
      const needsReauth = json?.needs_reauth === true;
      console.warn(`[Slack] ${report} for ${userEmail} failed (${res.status}): ${msg}${needsReauth ? " [needs_reauth]" : ""}`);
      return { data: [], count: 0, error: msg, needsReauth };
    }
    const results = Array.isArray(json?.results) ? json.results : [];
    console.log(`[Slack] ${report} for ${userEmail}: ${results.length} results`);
    return { data: results, count: Number(json?.count ?? results.length) };
  } catch (err: any) {
    console.error(`[Slack] ${report} error:`, err?.message || err);
    return { data: [], count: 0, error: err?.message || String(err) };
  }
}

/** Format Slack results for AI tool_result (with truncation) */
export function formatSlackResult(
  report: string,
  result: { data: any; count: number; error?: string; needsReauth?: boolean; notice?: string }
): string {
  if (result.notice) return result.notice;
  if (result.error) {
    // Special-case re-auth: wrap in an explicit directive so the AI surfaces
    // the actionable re-connect link to the user instead of paraphrasing it
    // as a generic "I don't have access to Slack". MeetingBrain's own error
    // text already contains the URL; we just make sure the model doesn't
    // swallow it.
    if (result.needsReauth) {
      return [
        `Slack query failed — USER ACTION REQUIRED (needs_reauth=true, report=${report}).`,
        ``,
        `MeetingBrain returned: ${result.error}`,
        ``,
        `INSTRUCTIONS FOR YOUR RESPONSE — follow exactly:`,
        `1. Briefly apologise that Slack isn't fully connected.`,
        `2. Tell the user their Slack needs re-authorising in MeetingBrain.`,
        `3. Include this EXACT markdown link so they can click it: [Re-connect Slack in MeetingBrain](https://www.meetingbrain.ai/settings)`,
        `4. Mention that 'search_messages' and 'my_mentions' still work today with the current scopes — the other reports (recent_dms, channel_messages, list_channels, thread) need the re-auth to enable channel/DM read scopes.`,
        `5. Do NOT say "I don't have access to Slack" — that's misleading. Say the connection needs re-authorising.`,
        `6. Keep it short and friendly, not alarming.`,
      ].join("\n");
    }
    return `Slack query failed: ${result.error}`;
  }
  const rows = Array.isArray(result.data) ? result.data : [];

  // MeetingBrain returns raw Slack IDs (sender="U01J5...", channel_name=channel_id)
  // with names embedded only inside <@ID|Name> mention tags. Harvest those tags
  // across every row to build an ID→Name map, then enrich each row with a
  // resolved `sender_name` field. The map is also surfaced to the AI as an
  // explicit hints table so it has one unambiguous place to resolve names,
  // instead of inventing "a colleague" / "team member" when the sender field
  // is an opaque ID.
  const userIdToName = new Map<string, string>();
  for (const row of rows) {
    const text: string = typeof (row as any)?.text === "string" ? (row as any).text : "";
    const re = /<@([UW][A-Z0-9]+)\|([^>]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && m[2]) userIdToName.set(m[1], m[2].trim());
    }
  }

  const enriched = rows.map((row: any) => {
    if (row && typeof row.sender === "string" && userIdToName.has(row.sender)) {
      return { ...row, sender_name: userIdToName.get(row.sender) };
    }
    return row;
  });

  const sample = enriched.slice(0, MAX_TOOL_RESULT_ROWS);

  const nameHints = userIdToName.size
    ? `\n\nKnown user IDs (harvested from <@ID|Name> mention tags in the messages themselves — use these to resolve the "sender" field and bare <@ID> mentions):\n${Array.from(userIdToName.entries()).map(([id, n]) => `  ${id} → ${n}`).join("\n")}`
    : "";

  const namingRule = `\n\nNAMING RULES — follow strictly when summarising these results:
- If a row has "sender_name" populated, use that name.
- Else if "sender" matches an entry in the Known user IDs map above, use that name.
- Else if the message text contains <@ID|Name>, use the Name.
- Otherwise refer to the person as "a Slack user" (or quote the raw @ID) and link to the message via its "permalink". NEVER invent a descriptor like "a colleague", "a team member", "someone on the team", "a coworker" — those are fabrications when no name is available.
- Same rule for channels: if "channel_name" equals "channel_id" (starts with C/D), MeetingBrain didn't resolve it — say "a Slack channel" or "a Slack thread" and link the permalink; do not guess the channel name.
- When presenting items to the user, always include the permalink as a markdown link so they can jump to the thread.`;

  return `Slack ${report}: ${result.count} results${nameHints}${namingRule}\n\n${JSON.stringify(sample, null, 2)}${rows.length > MAX_TOOL_RESULT_ROWS ? `\n(showing first ${MAX_TOOL_RESULT_ROWS} of ${rows.length})` : ""}`;
}

/* ─────────────── Memory Search Tool ─────────────── */

/** OpenAI-compatible tool definition for search_memory */
export const SEARCH_MEMORY_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
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

/* ─────────────── Xero Finance Tool (read-only) ─────────────── */

export const QUERY_XERO_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_xero",
    description:
      "Query the company's Xero accounting data (READ-ONLY): unpaid/overdue invoices, aged receivables, profit & loss, revenue by client. Use for ANY question about invoices, payments, receivables, revenue, or financial performance. Figures come straight from Xero — never estimate, convert, or invent amounts.",
    parameters: {
      type: "object",
      properties: {
        report: {
          type: "string",
          enum: ["unpaid_invoices", "aged_receivables", "profit_and_loss", "revenue_by_client"],
          description:
            "unpaid_invoices = approved sales invoices awaiting payment (optionally filter by client_name); aged_receivables = overdue amounts bucketed 0-30/31-60/61-90/90+ with worst offenders; profit_and_loss = P&L lines for a period; revenue_by_client = invoiced + paid totals per client for a period.",
        },
        date_from: { type: "string", description: "ISO date for profit_and_loss / revenue_by_client (default: start of this year)" },
        date_to: { type: "string", description: "ISO date (default: today)" },
        client_name: { type: "string", description: "For unpaid_invoices: filter by contact name (partial match)" },
      },
      required: ["report"],
    },
  },
};

const QUERY_XERO_TOOL: Anthropic.Tool = {
  name: "query_xero",
  description: QUERY_XERO_OPENAI_TOOL.function.description!,
  input_schema: { ...(QUERY_XERO_OPENAI_TOOL.function.parameters as any) },
};

export function formatXeroResult(report: string, result: { data: any; count: number; error?: string; notice?: string }): string {
  if (result.notice) return result.notice;
  if (result.error) {
    return `Xero query failed (report=${report}): ${result.error}\nTell the user briefly — do NOT invent or estimate figures instead.`;
  }
  return `Xero ${report}: ${JSON.stringify(result.data).slice(0, 6000)}\n(Amounts are in the currency shown — never convert or invent figures. Present money with its currency code.)`;
}

/* ─────────────── Scheduled Prompt Proposal Tool ─────────────── */

export const CREATE_SCHEDULED_TASK_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_scheduled_task",
    description:
      "Propose a recurring scheduled prompt that runs automatically on a cadence and delivers results to a dedicated thread (+ optional email). Use when the user asks for something on a schedule: 'every morning', 'weekly summary', 'send me X on Mondays', 'daily digest'. This only PROPOSES — a confirmation card is shown in chat and the user must confirm it, so never claim the task is already scheduled. Do NOT compute dates or times yourself — the server does all time math (Europe/Zurich). The prompt must be self-contained: it runs later with no conversation context.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short task name, e.g. 'Monday Morning Operations Brief'",
        },
        prompt: {
          type: "string",
          description: "The full prompt to run on each tick. Self-contained — include everything needed (clients, metrics, framing); it runs with no conversation context.",
        },
        type_schedule: {
          type: "string",
          enum: ["daily", "weekdays", "weekly", "monthly"],
          description: "Cadence. 'weekdays' = Monday-Friday.",
        },
        hour: { type: "number", description: "Hour of day 0-23 in Europe/Zurich. Default 8." },
        minute: { type: "number", description: "Minute 0-59. Default 0." },
        day_of_week: { type: "number", description: "For weekly: ISO day, 1=Monday … 7=Sunday. Default 1." },
        day_of_month: { type: "number", description: "For monthly: day of month 1-28. Default 1." },
        email: { type: "boolean", description: "Also email the results to the user. Default true." },
        type_task: {
          type: "string",
          enum: ["digest", "monitor"],
          description: "digest (default) = delivers a brief every run. monitor = watches the values the prompt describes and only notifies when something changes or a stated threshold is crossed — use when the user says 'alert me when/if', 'watch', 'let me know if'.",
        },
      },
      required: ["title", "prompt", "type_schedule"],
    },
  },
};

const CREATE_SCHEDULED_TASK_TOOL: Anthropic.Tool = {
  name: "create_scheduled_task",
  description: CREATE_SCHEDULED_TASK_OPENAI_TOOL.function.description!,
  input_schema: {
    ...(CREATE_SCHEDULED_TASK_OPENAI_TOOL.function.parameters as any),
  },
};

/** Build a scheduled-prompt proposal — NO DB write. The user confirms via a card
 *  rendered from the [SCHEDULED_PROPOSAL] marker this appends to the assistant
 *  message (design rule: the confirmation card echoes SERVER-computed run times,
 *  the model never does time math). Throws with a model-readable message on
 *  invalid input or when the user is at the active-task cap. */
async function buildScheduledProposal(
  input: any,
  config: AIProviderConfig
): Promise<{ marker: string; toolMsg: string }> {
  const { computeNextRun, describeSchedule } = await import("@/lib/scheduled/schedule");
  const type = String(input?.type_schedule || "").toLowerCase();
  if (!["daily", "weekdays", "weekly", "monthly"].includes(type)) {
    throw new Error("type_schedule must be one of daily, weekdays, weekly, monthly");
  }
  // Strip the marker sentinels from user-controlled text — a literal
  // "[/SCHEDULED_PROPOSAL]" inside the JSON would terminate extraction early.
  const desentinel = (s: string) => s.replace(/\[\/?SCHEDULED_PROPOSAL\]/g, "");
  const title = desentinel(String(input?.title || "")).trim().slice(0, 120);
  const prompt = desentinel(String(input?.prompt || "")).trim().slice(0, 4000);
  if (!title || !prompt) throw new Error("title and prompt are both required");

  // Cap check up-front so the model can tell the user instead of a dead-end card.
  if (config.workspaceId && config.userId) {
    const { intelligenceDb } = await import("@/lib/supabase-intelligence");
    const { count } = await intelligenceDb
      .from("ai_scheduled_prompts")
      .select("id_prompt", { count: "exact", head: true })
      .eq("id_workspace", config.workspaceId)
      .eq("user_created", config.userId)
      .eq("flag_enabled", 1);
    if ((count || 0) >= 10) {
      throw new Error(
        "The user already has 10 active scheduled prompts (the limit). Ask them to pause or delete one in the Scheduled prompts hub (profile menu) first."
      );
    }
  }

  // Only accept real numbers / numeric strings — models emit explicit nulls for
  // optional params they don't fill, and +null coerces to 0 (midnight, not 08:00).
  const num = (v: any, def: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? +v : NaN;
    return Number.isFinite(n) ? Math.trunc(n) : def;
  };
  const cfg = {
    hour: Math.min(23, Math.max(0, num(input?.hour, 8))),
    minute: Math.min(59, Math.max(0, num(input?.minute, 0))),
    ...(type === "weekly" ? { dayOfWeek: Math.min(7, Math.max(1, num(input?.day_of_week, 1))) } : {}),
    ...(type === "monthly" ? { dayOfMonth: Math.min(28, Math.max(1, num(input?.day_of_month, 1))) } : {}),
    tz: "Europe/Zurich",
  };
  const next1 = computeNextRun(type as any, cfg);
  const next2 = computeNextRun(type as any, cfg, next1);
  const typeTask = input?.type_task === "monitor" ? "monitor" : "digest";
  const proposal = {
    proposalId: crypto.randomUUID(),
    title,
    prompt,
    typeTask,
    typeSchedule: type,
    configSchedule: cfg,
    clientId: config.selectedClientId ?? null,
    emailEnabled: input?.email !== false,
    scheduleLabel: describeSchedule(type as any, cfg),
    nextRuns: [next1.toISOString(), next2.toISOString()],
  };
  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return {
    marker: `\n\n[SCHEDULED_PROPOSAL]${JSON.stringify(proposal)}[/SCHEDULED_PROPOSAL]\n\n`,
    toolMsg: `Proposal card shown to the user: "${title}" (${typeTask}) — ${proposal.scheduleLabel}; next two runs ${fmt(next1)} and ${fmt(next2)} (Europe/Zurich).${typeTask === "monitor" ? " As a monitor it will check on that schedule but only notify when something changes or the stated condition is crossed." : ""} It is NOT saved yet — the user must press Confirm on the card. Briefly say what the task will deliver and point them to the card below. Do NOT restate the schedule or run times (the card shows them) and do NOT claim it is already scheduled.`,
  };
}

/* ─────────────── Scheduled Prompt Update Tool (reply-to-refine) ─────────────── */

export const UPDATE_SCHEDULED_TASK_OPENAI_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "update_scheduled_task",
    description:
      "Propose an update to THIS thread's standing scheduled prompt. Use when the user asks future runs to change — different content ('also include…', 'drop the…', 'make it shorter'), different timing, or turning email on/off. Only pass the fields that change. This only PROPOSES — the user confirms via a card; never claim the change is applied. Do NOT compute dates/times yourself.",
    parameters: {
      type: "object",
      properties: {
        new_prompt: {
          type: "string",
          description: "The COMPLETE revised standing prompt (not a diff) — rewrite the current prompt with the user's requested changes folded in. Omit if the prompt isn't changing.",
        },
        new_title: { type: "string", description: "New task title. Omit if unchanged." },
        type_schedule: { type: "string", enum: ["daily", "weekdays", "weekly", "monthly"], description: "Only when the user asks to change the cadence." },
        hour: { type: "number", description: "Hour 0-23 (Europe/Zurich). Only when changing the time." },
        minute: { type: "number", description: "Minute 0-59. Only when changing the time." },
        day_of_week: { type: "number", description: "For weekly: ISO day 1=Monday … 7=Sunday." },
        day_of_month: { type: "number", description: "For monthly: day 1-28." },
        email: { type: "boolean", description: "Only when the user asks to turn result emails on/off." },
      },
      required: [],
    },
  },
};

const UPDATE_SCHEDULED_TASK_TOOL: Anthropic.Tool = {
  name: "update_scheduled_task",
  description: UPDATE_SCHEDULED_TASK_OPENAI_TOOL.function.description!,
  input_schema: {
    ...(UPDATE_SCHEDULED_TASK_OPENAI_TOOL.function.parameters as any),
  },
};

/** Build an update proposal for the thread's standing task — NO DB write.
 *  Same marker/card mechanics as creation, with mode:"update" + targetId;
 *  Confirm PATCHes /api/ai/scheduled/[id] with only the changed fields. */
async function buildScheduledUpdateProposal(
  input: any,
  config: AIProviderConfig
): Promise<{ marker: string; toolMsg: string }> {
  const task = config.scheduledTask;
  if (!task) throw new Error("This conversation is not a scheduled task's thread");
  const { computeNextRun, describeSchedule, promptFingerprint } = await import("@/lib/scheduled/schedule");

  const desentinel = (s: string) => s.replace(/\[\/?SCHEDULED_PROPOSAL\]/g, "");
  const newPromptRaw = input?.new_prompt ? desentinel(String(input.new_prompt)).trim().slice(0, 4000) : "";
  const newTitleRaw = input?.new_title ? desentinel(String(input.new_title)).trim().slice(0, 120) : "";
  const promptChanged = !!newPromptRaw && newPromptRaw !== task.prompt;
  const titleChanged = !!newTitleRaw && newTitleRaw !== task.title;

  const num = (v: any, def: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? +v : NaN;
    return Number.isFinite(n) ? Math.trunc(n) : def;
  };
  // Explicit nulls (models emit them for params they don't fill) must NOT count
  // as "the user asked to change the schedule".
  const has = (v: any) => v !== undefined && v !== null;
  const scheduleChanged =
    has(input?.type_schedule) || has(input?.hour) || has(input?.minute) ||
    has(input?.day_of_week) || has(input?.day_of_month);
  const curCfg = task.configSchedule || {};
  const type = scheduleChanged
    ? (["daily", "weekdays", "weekly", "monthly"].includes(String(input?.type_schedule || "").toLowerCase())
        ? String(input.type_schedule).toLowerCase()
        : task.typeSchedule)
    : task.typeSchedule;
  const cfg = scheduleChanged
    ? {
        hour: Math.min(23, Math.max(0, num(input?.hour, num(curCfg.hour, 8)))),
        minute: Math.min(59, Math.max(0, num(input?.minute, num(curCfg.minute, 0)))),
        ...(type === "weekly" ? { dayOfWeek: Math.min(7, Math.max(1, num(input?.day_of_week, num(curCfg.dayOfWeek, 1)))) } : {}),
        ...(type === "monthly" ? { dayOfMonth: Math.min(28, Math.max(1, num(input?.day_of_month, num(curCfg.dayOfMonth, 1)))) } : {}),
        tz: curCfg.tz || "Europe/Zurich",
      }
    : curCfg;
  const emailChanged = typeof input?.email === "boolean";

  if (!promptChanged && !titleChanged && !scheduleChanged && !emailChanged) {
    throw new Error("Nothing would change — tell the user the task already matches what they asked for.");
  }

  const next1 = computeNextRun(type as any, cfg);
  const next2 = computeNextRun(type as any, cfg, next1);
  const proposal = {
    mode: "update",
    proposalId: crypto.randomUUID(),
    targetId: task.id,
    // baseFp pins the card to THIS version of the standing prompt — the PATCH
    // rejects it if the prompt changed after the card was created.
    baseFp: promptFingerprint(task.prompt),
    title: titleChanged ? newTitleRaw : desentinel(task.title),
    ...(titleChanged ? { oldTitle: desentinel(task.title) } : {}),
    prompt: promptChanged ? newPromptRaw : desentinel(task.prompt),
    ...(promptChanged ? { oldPrompt: desentinel(task.prompt).slice(0, 600) } : {}),
    promptChanged,
    typeTask: task.typeTask,
    typeSchedule: type,
    configSchedule: cfg,
    scheduleChanged,
    ...(emailChanged ? { emailEnabled: input.email } : {}),
    scheduleLabel: describeSchedule(type as any, cfg),
    nextRuns: [next1.toISOString(), next2.toISOString()],
  };
  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const changes = [
    promptChanged ? "prompt" : null,
    titleChanged ? "title" : null,
    scheduleChanged ? `schedule → ${proposal.scheduleLabel}` : null,
    emailChanged ? `email ${input.email ? "on" : "off"}` : null,
  ].filter(Boolean).join(", ");
  return {
    marker: `\n\n[SCHEDULED_PROPOSAL]${JSON.stringify(proposal)}[/SCHEDULED_PROPOSAL]\n\n`,
    toolMsg: `Update card shown to the user for "${task.title}" (changes: ${changes}; next runs ${fmt(next1)} and ${fmt(next2)}). NOT applied yet — the user must press Confirm on the card. Briefly summarise what future runs will now cover; do NOT restate schedule times and do NOT claim the change is applied.`,
  };
}

/**
 * Search user's memories and conversation history for relevant information.
 */
export async function searchMemory(
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
  const source = config.source ?? "enginegpt";

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let result: StreamResult = { fullText: "", inputTokens: 0, outputTokens: 0 };

      // Control Centre model override + global provider cap.
      // - Override > registry-resolved model.
      // - Provider cap is checked AFTER override, against whatever provider
      //   the final model maps to (an override could change it).
      let finalProviderKey =
        modelInfo.provider === "anthropic" ? "claude" :
        modelInfo.provider === "xai" ? "grok-4" :
        modelInfo.provider; // gemini / openai / perplexity / deepseek already match
      try {
        const { resolveModelOverride, isOverProviderCap, ServiceControlError } = await import(
          "@/lib/admin/service-control"
        );
        const override = await resolveModelOverride("engine", source, finalProviderKey);
        if (override) {
          modelInfo.apiModel = override;
          // Re-derive provider from the override model name in case it switched providers.
          if (override.startsWith("claude-")) finalProviderKey = "claude";
          else if (override.startsWith("gpt-") || override.startsWith("o4-")) finalProviderKey = "openai";
          else if (override.startsWith("gemini-") && override.includes("pro")) finalProviderKey = "gemini-pro";
          else if (override.startsWith("gemini-")) finalProviderKey = "gemini";
          else if (override.startsWith("grok-4")) finalProviderKey = "grok-4";
          else if (override.startsWith("grok-")) finalProviderKey = "grok";
          else if (override.startsWith("sonar")) finalProviderKey = "perplexity";
        }
        if (await isOverProviderCap(finalProviderKey)) {
          throw new ServiceControlError(
            "budget_exceeded",
            "engine",
            source,
            `Provider ${finalProviderKey} blocked: global spend cap reached`,
          );
        }
      } catch (e: any) {
        if (e?.name === "ServiceControlError") {
          // Surface to client as an SSE error event — the streamer hasn't started yet.
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: e.message, reason: e.reason })}\n\n`),
          );
          controller.close();
          return;
        }
        console.warn("[AI] control-centre lookup failed; using default", e);
      }

      try {
        if (modelInfo.provider === "anthropic") {
          try {
            result = await streamAnthropic(messages, config, modelInfo.apiModel, controller, encoder);
          } catch (anthropicErr: any) {
            // Fallback to Grok if Anthropic fails for any reason (rate limits, overloaded, timeouts, etc.)
            const errMsg = anthropicErr?.message || String(anthropicErr);
            const status = anthropicErr?.status || 0;
            console.warn(`[AI] Anthropic failed (status=${status}, ${errMsg.slice(0, 150)}), falling back to Grok`);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fallback: true, reason: "Claude unavailable — using Grok" })}\n\n`));
            result = await streamXAI(messages, config, "grok-4-1-fast-non-reasoning", controller, encoder);
            console.log(`[AI] Grok fallback result: ${result.fullText.length} chars, ${result.inputTokens} in, ${result.outputTokens} out`);
          }
        } else if (modelInfo.provider === "gemini") {
          result = await streamGemini(messages, config, modelInfo.apiModel, controller, encoder);
        } else if (modelInfo.provider === "openai") {
          result = await streamOpenAI(messages, config, modelInfo.apiModel, controller, encoder);
        } else if (modelInfo.provider === "deepseek") {
          // DeepSeek is OpenAI-compatible — reuse streamOpenAI with a different client.
          // Image generation isn't supported, so force it off regardless of UI toggle.
          result = await streamOpenAI(
            messages,
            { ...config, imageGeneration: false },
            modelInfo.apiModel,
            controller,
            encoder,
            { clientOverride: getDeepSeekClient(), providerLabel: "DeepSeek" },
          );
        } else if (modelInfo.provider === "perplexity") {
          result = await streamPerplexity(messages, config, modelInfo.apiModel, controller, encoder);
        } else {
          // xAI (Grok) — with fallback to Anthropic on failure or empty response
          try {
            result = await streamXAI(messages, config, modelInfo.apiModel, controller, encoder);
            if (!result.fullText.trim()) {
              console.warn(`[AI] xAI returned empty response, falling back to Claude`);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fallback: true, reason: "Grok returned empty — using Claude" })}\n\n`));
              result = await streamAnthropic(messages, config, "claude-sonnet-5", controller, encoder);
            }
          } catch (xaiErr: any) {
            const errMsg = xaiErr?.message || String(xaiErr);
            console.warn(`[AI] xAI failed (${errMsg.slice(0, 150)}), falling back to Claude`);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fallback: true, reason: "Grok unavailable — using Claude" })}\n\n`));
            result = await streamAnthropic(messages, config, "claude-sonnet-5", controller, encoder);
          }
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
        // Strip fabricated markdown links — keep our own URLs, anchors, and web search citations.
        // IMPORTANT: when webSearch is active (xAI LiveSearch or Claude web_search), all http/https
        // URLs are real citations returned by the search — do NOT strip them.
        if (!config.preserveLinks) {
          result.fullText = result.fullText.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (match, text, url) => {
              if (url.startsWith("/api/media/")) return match;
              if (url.startsWith("#")) return match;
              if (url.startsWith("https://app.thecontentengine.com/")) return match;
              // Preserve all http/https URLs when web search is active — these are real citations
              if (config.webSearch && (url.startsWith("https://") || url.startsWith("http://"))) return match;
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
  if (config.designMode) {
    // Design mode also gets image gen (force-enable even if toggle is off) + video + artlist.
    if (!config.imageGeneration) tools.push(IMAGE_GEN_TOOL);
    tools.push(VIDEO_GEN_TOOL);
    tools.push(ARTLIST_SEARCH_TOOL);
    tools.push(ARTLIST_LICENSE_TOOL);
    // Studio mode shot CRUD — only when the conversation is anchored to a session
    if (config.designSessionId) {
      tools.push(DESIGN_CREATE_SHOT_TOOL);
      tools.push(DESIGN_UPDATE_SHOT_TOOL);
      tools.push(DESIGN_GENERATE_SHOT_TOOL);
      tools.push(DESIGN_COMMIT_SHOT_TOOL);
    }
    // Saved-prompt library — workspace-scoped, available whenever we know the workspace.
    if (config.workspaceId) {
      tools.push(DESIGN_SAVE_PROMPT_TOOL);
      tools.push(DESIGN_RECALL_PROMPTS_TOOL);
    }
  }
  if (config.workspaceClientIds?.length) {
    tools.push(QUERY_ENGINE_TOOL);
    tools.push(LOOKUP_CLIENT_CONTEXT_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_TOOL);
    tools.push(SLACK_TOOL);
  }
  if (config.workspaceId && config.financeAccess) {
    tools.push(QUERY_XERO_TOOL); // executor answers "not connected" gracefully
  }
  if (config.enableScheduling && config.workspaceId && config.userId) {
    tools.push(CREATE_SCHEDULED_TASK_TOOL);
    if (config.scheduledTask) tools.push(UPDATE_SCHEDULED_TASK_TOOL);
  }

  console.log(`[Anthropic] Streaming with tools: [${tools.map(t => (t as any).name || (t as any).type).join(', ') || 'none'}], imageGeneration=${config.imageGeneration}, designMode=${!!config.designMode}`);

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: Claude may request tool calls, which we execute and feed back.
  // Loop continues until the model's stop_reason is "end_turn" (no more tool calls).
  const MAX_TOOL_ROUNDS = 8; // Safety limit to prevent infinite loops
  // True only when the model finished with a natural stop (no pending tool
  // desire). Any other exit — round cap, no-progress break, stall — must go
  // through the forced final answer so the user never gets a dangling
  // "let me pull the details…" with no answer.
  let loopEndedCleanly = false;
  // A stall that leaves NOTHING salvageable (empty text even after the forced
  // final) must rethrow so the provider fallback fires instead of persisting a
  // blank reply as a successful completion.
  let stalledOut = false;
  // No-progress guard (mirrors the xAI loop): stop the model re-calling the
  // same tool with no progress, which produces a wall of repeated text.
  const executedToolSigs = new Set<string>();
  const toolCallCounts = new Map<string, number>();
  const MAX_CALLS_PER_TOOL = 3;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: apiModel,
      max_tokens: config.maxTokens || 4096,
      ...anthropicModelParams(apiModel, config),
      system: systemText,
      messages: anthropicMessages,
      ...(tools.length > 0 ? { tools } : {}),
    });

    // Collect tool_use blocks from this round
    const toolUseBlocks: { id: string; name: string; input: any }[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    let stalled = false;
    try {
    for await (const event of withStallGuard(stream)) {
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
          if (block.name === "query_slack") {
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

    } catch (e) {
      if (e instanceof StreamStallError) {
        console.warn(`[Anthropic] Round ${round} stalled mid-stream — aborting tool loop, forcing final answer from gathered context`);
        stalled = true;
        stalledOut = true;
      } else {
        throw e;
      }
    }
    if (stalled) break;

    // Get usage from this round
    const finalMessage = await stream.finalMessage();
    totalInputTokens += finalMessage.usage?.input_tokens || 0;
    totalOutputTokens += finalMessage.usage?.output_tokens || 0;

    console.log(`[Anthropic] Round ${round}: stop_reason=${finalMessage.stop_reason}, toolUseBlocks=${toolUseBlocks.length}, textLength=${fullText.length}`);

    // If no tool calls were made, we're done
    if (finalMessage.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      loopEndedCleanly = true;
      break;
    }

    // Round separator: the next round's narration must not jam straight into
    // this round's text ("…details directly.Found it…").
    if (fullText.trim() && !fullText.endsWith("\n")) {
      fullText += "\n\n";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
    }

    // Execute tool calls and build tool results
    // First, add the assistant's response (with tool_use blocks) to messages
    anthropicMessages.push({
      role: "assistant",
      content: finalMessage.content,
    });

    // Then add tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let executedAnyTool = false;
    for (const tool of toolUseBlocks) {
      // No-progress guard: skip a repeat/over-cap tool call and nudge the model
      // to answer (still push a tool_result so the API conversation stays valid).
      const toolSig = `${tool.name}:${JSON.stringify(tool.input ?? {})}`;
      const toolCount = (toolCallCounts.get(tool.name) || 0) + 1;
      toolCallCounts.set(tool.name, toolCount);
      if (executedToolSigs.has(toolSig) || toolCount > MAX_CALLS_PER_TOOL) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: executedToolSigs.has(toolSig)
            ? `You already called ${tool.name} with these exact arguments this turn — the result is above. Do NOT call it again. Answer the user now with what you have; if the data isn't available, say so plainly. Never promise to run a search or tool you cannot actually run.`
            : `You have called ${tool.name} too many times this turn. Stop calling tools and answer the user now with what you have.`,
        });
        continue;
      }
      executedToolSigs.add(toolSig);
      executedAnyTool = true;
      if (tool.name === "generate_image") {
        try {
          const prompt = tool.input.prompt || "Generate an image";
          const size = tool.input.size || "1024x1024";
          const brand = config.designMode ? await loadBrandContext(config.workspaceId, config.selectedClientId) : null;
          const imageUrl = await generateImage(prompt, size, "anthropic", brand);

          // Persist to ai_design_assets in design mode.
          let designAssetId: string | null = null;
          let studioShotId: string | null = null;
          if (config.designMode && !config.incognito && config.workspaceId && config.userId) {
            designAssetId = await persistDesignAsset({
              conversationId: config.conversationId || null,
              workspaceId: config.workspaceId,
              clientId: config.selectedClientId || null,
              contentId: config.contentId || null,
              userId: config.userId,
              type: "image",
              source: "dalle",
              blobUrl: imageUrl,
              prompt,
              metadata: { size, model: "dall-e-3", brand_applied: !!brand },
            });
            // Studio mode: link to a shot
            if (designAssetId && config.designSessionId) {
              const linked = await linkAssetToShot({
                sessionId: config.designSessionId,
                focusedShotId: config.designFocusedShotId,
                assetId: designAssetId,
                prompt,
                modelId: "dalle-3",
                metadata: { size, brand_applied: !!brand },
              });
              studioShotId = linked.shotId;
            }
          }

          // Notify client with the generated image URL
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ image_ready: { url: imageUrl, prompt, asset_id: designAssetId, shot_id: studioShotId } })}\n\n`
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
      } else if (tool.name === "generate_video") {
        try {
          const prompt: string = tool.input.prompt || "Generate a video";
          const duration: 5 | 10 = tool.input.duration === 10 ? 10 : 5;
          const format = tool.input.format as "landscape" | "portrait" | "square" | undefined;
          const imageUrlInput: string | undefined = tool.input.image_url;
          const model = tool.input.model as import("@/lib/integrations/runway").RunwayModel | undefined;
          const brand = config.designMode ? await loadBrandContext(config.workspaceId, config.selectedClientId) : null;

          // Heartbeat so the UI can show a progress indicator.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ generating_video: true })}\n\n`));

          const { videoUrl, durationSec, model: usedModel } = await generateVideo(prompt, {
            duration,
            format,
            imageUrl: imageUrlInput,
            model,
            brand,
            onProgress: (p) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ video_progress: { percent: Math.round(p * 100) } })}\n\n`));
            },
          });

          // Optionally link to parent asset (image_to_video)
          let parentId: string | null = null;
          if (imageUrlInput && config.designMode && config.workspaceId) {
            try {
              const { intelligenceDb } = await import("@/lib/supabase-intelligence");
              const m = imageUrlInput.match(/\/api\/media\/file\?path=([^&]+)/);
              if (m) {
                const path = decodeURIComponent(m[1]);
                const { data } = await intelligenceDb
                  .from("ai_design_assets")
                  .select("id_asset").eq("blob_path", path).maybeSingle();
                parentId = (data as any)?.id_asset || null;
              }
            } catch { /* non-fatal */ }
          }

          let designAssetId: string | null = null;
          let studioShotIdVideo: string | null = null;
          if (config.designMode && !config.incognito && config.workspaceId && config.userId) {
            designAssetId = await persistDesignAsset({
              conversationId: config.conversationId || null,
              workspaceId: config.workspaceId,
              clientId: config.selectedClientId || null,
              contentId: config.contentId || null,
              userId: config.userId,
              type: "video",
              source: "runway",
              blobUrl: videoUrl,
              prompt,
              parentId,
              metadata: { duration_sec: durationSec, model: usedModel, format: format || "landscape", brand_applied: !!brand },
            });
            if (designAssetId && config.designSessionId) {
              const linked = await linkAssetToShot({
                sessionId: config.designSessionId,
                focusedShotId: config.designFocusedShotId,
                assetId: designAssetId,
                prompt,
                modelId: usedModel,
                metadata: { duration_sec: durationSec, format: format || "landscape", brand_applied: !!brand },
              });
              studioShotIdVideo = linked.shotId;
            }
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ video_ready: { url: videoUrl, prompt, duration: durationSec, source: "runway", asset_id: designAssetId, shot_id: studioShotIdVideo } })}\n\n`)
          );

          fullText += `\n\n🎬 [Generated video](${videoUrl})\n\n`;

          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Video generated successfully (${durationSec}s, ${usedModel}). URL: ${videoUrl} — Do NOT write this URL again in your response. The video is already displayed to the user.`,
          });
        } catch (err: any) {
          console.error("[VideoGen] Failed:", err.message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ video_error: err.message })}\n\n`));
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Video generation failed: ${err.message}`, is_error: true });
        }
      } else if (tool.name === "search_artlist") {
        try {
          const result = await searchArtlistCatalogue(tool.input as any);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ artlist_results: { query: tool.input.query, items: result.items } })}\n\n`));
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Found ${result.items.length} Artlist clips. Present the titles and durations to the user as numbered options; instruct them to pick one for licensing. Do NOT auto-license. Clip IDs: ${result.items.map((i: any) => i.id).join(", ")}.\n\n${JSON.stringify(result.items.slice(0, 8), null, 2)}`,
          });
        } catch (err: any) {
          console.error("[Artlist] Search failed:", err.message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ artlist_error: err.message })}\n\n`));
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Artlist search failed: ${err.message}`, is_error: true });
        }
      } else if (tool.name === "license_artlist_asset") {
        try {
          const assetId: string = tool.input.asset_id;
          const title: string = tool.input.title || `Artlist clip ${assetId}`;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ artlist_licensing: { asset_id: assetId } })}\n\n`));
          const { videoUrl, licenseTerms } = await licenseArtlistAndMirror(assetId);

          let designAssetId: string | null = null;
          let studioShotIdArtlist: string | null = null;
          if (config.designMode && !config.incognito && config.workspaceId && config.userId) {
            designAssetId = await persistDesignAsset({
              conversationId: config.conversationId || null,
              workspaceId: config.workspaceId,
              clientId: config.selectedClientId || null,
              contentId: config.contentId || null,
              userId: config.userId,
              type: "artlist_video",
              source: "artlist",
              blobUrl: videoUrl,
              prompt: title,
              metadata: { artlist_asset_id: assetId, license_terms: licenseTerms, title },
            });
            if (designAssetId && config.designSessionId) {
              const linked = await linkAssetToShot({
                sessionId: config.designSessionId,
                focusedShotId: config.designFocusedShotId,
                assetId: designAssetId,
                prompt: title,
                modelId: "artlist",
                metadata: { artlist_asset_id: assetId, license_terms: licenseTerms },
              });
              studioShotIdArtlist = linked.shotId;
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ video_ready: { url: videoUrl, prompt: title, source: "artlist", asset_id: designAssetId, shot_id: studioShotIdArtlist, license_terms: licenseTerms } })}\n\n`));
          fullText += `\n\n🎬 [${title} (Artlist)](${videoUrl})\n\n`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Artlist clip licensed and added to canvas. URL: ${videoUrl}. License terms: ${licenseTerms} — surface this to the user.`,
          });
        } catch (err: any) {
          console.error("[Artlist] License failed:", err.message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ artlist_error: err.message })}\n\n`));
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Artlist licensing failed: ${err.message}`, is_error: true });
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
      } else if (tool.name === "design_create_shot") {
        try {
          if (!config.designSessionId) throw new Error("No design session");
          const { intelligenceDb } = await import("@/lib/supabase-intelligence");
          const { count } = await intelligenceDb
            .from("design_shots")
            .select("id_shot", { count: "exact", head: true })
            .eq("id_session", config.designSessionId);
          const nextIdx = (count || 0) + 1;
          const { data: created, error } = await intelligenceDb
            .from("design_shots")
            .insert({
              id_session: config.designSessionId,
              idx: nextIdx,
              name_shot: tool.input.title || `Shot ${nextIdx}`,
              name_beat: tool.input.beat || null,
              duration_sec: typeof tool.input.duration === "number" ? tool.input.duration : 5,
              model_id: tool.input.modelId || "runway-g4-5",
              status: "queued",
              flag_on_brand: 1,
              prompt: tool.input.prompt || null,
            })
            .select("id_shot, idx, name_shot")
            .single();
          if (error) throw error;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_created: { id: (created as any).id_shot, idx: (created as any).idx, title: (created as any).name_shot } })}\n\n`));
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Created shot S${String((created as any).idx).padStart(2, "0")} "${(created as any).name_shot}" (id ${(created as any).id_shot}). Call design_generate_shot with this id to produce v1.`,
          });
        } catch (err: any) {
          console.error("[design_create_shot]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Create shot failed: ${err?.message}`, is_error: true });
        }
      } else if (tool.name === "design_update_shot") {
        try {
          if (!config.designSessionId) throw new Error("No design session");
          const shotId = tool.input.shot_id;
          if (!shotId) throw new Error("shot_id required");
          const patch: Record<string, unknown> = { date_updated: new Date().toISOString() };
          if (typeof tool.input.title === "string") patch.name_shot = tool.input.title;
          if (typeof tool.input.beat === "string") patch.name_beat = tool.input.beat;
          if (typeof tool.input.duration === "number") patch.duration_sec = tool.input.duration;
          if (typeof tool.input.modelId === "string") patch.model_id = tool.input.modelId;
          if (typeof tool.input.prompt === "string") patch.prompt = tool.input.prompt;
          const { intelligenceDb } = await import("@/lib/supabase-intelligence");
          const { error } = await intelligenceDb
            .from("design_shots")
            .update(patch)
            .eq("id_shot", shotId)
            .eq("id_session", config.designSessionId);
          if (error) throw error;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_updated: { id: shotId } })}\n\n`));
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Updated shot ${shotId}.`,
          });
        } catch (err: any) {
          console.error("[design_update_shot]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Update shot failed: ${err?.message}`, is_error: true });
        }
      } else if (tool.name === "design_generate_shot") {
        try {
          if (!config.designSessionId) throw new Error("No design session");
          if (!config.userId) throw new Error("No user");
          const shotId = tool.input.shot_id;
          if (!shotId) throw new Error("shot_id required");

          // Heartbeat — UI marks the shot as generating
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_generating: { id: shotId } })}\n\n`));

          const { generateShotVersion } = await import("@/lib/design/generate-shot");
          const result = await generateShotVersion(
            config.designSessionId,
            shotId,
            config.userId,
            {
              modelId: tool.input.modelId,
              prompt: tool.input.prompt,
              format: tool.input.format,
              duration: tool.input.duration === 10 ? 10 : 5,
            },
          );

          if (!result.ok) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_error: { id: shotId, message: result.message } })}\n\n`));
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: `Generate failed: ${result.message}`,
              is_error: true,
            });
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_generated: { id: shotId, versionId: result.version.id, blobUrl: result.version.blobUrl, status: result.shot.status, onBrand: result.shot.onBrand } })}\n\n`));
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: `Generated v${result.version.idx} for shot ${shotId} using ${result.version.modelId}. Status: ${result.shot.status}${result.shot.onBrand ? " (on brand)" : " (drift detected)"}.`,
            });
          }
        } catch (err: any) {
          console.error("[design_generate_shot]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Generate shot failed: ${err?.message}`, is_error: true });
        }
      } else if (tool.name === "design_commit_shot") {
        try {
          if (!config.designSessionId) throw new Error("No design session");
          const shotId = tool.input.shot_id;
          if (!shotId) throw new Error("shot_id required");
          const { intelligenceDb } = await import("@/lib/supabase-intelligence");

          // Find the V1 video track
          const { data: track } = await intelligenceDb
            .from("design_tracks")
            .select("id_track")
            .eq("id_session", config.designSessionId)
            .eq("kind", "video")
            .order("idx", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!track) throw new Error("No video track on this session");
          const trackId = (track as any).id_track;

          // Idempotent insert
          const { data: existing } = await intelligenceDb
            .from("design_track_clips")
            .select("id_clip")
            .eq("id_track", trackId)
            .eq("id_shot", shotId)
            .maybeSingle();
          if (!existing) {
            const { data: shot } = await intelligenceDb
              .from("design_shots")
              .select("duration_sec")
              .eq("id_shot", shotId)
              .maybeSingle();
            const { data: lastClip } = await intelligenceDb
              .from("design_track_clips")
              .select("start_sec, duration_sec")
              .eq("id_track", trackId)
              .order("start_sec", { ascending: false })
              .limit(1)
              .maybeSingle();
            const startSec = lastClip
              ? Number((lastClip as any).start_sec) + Number((lastClip as any).duration_sec)
              : 0;
            await intelligenceDb.from("design_track_clips").insert({
              id_track: trackId,
              id_shot: shotId,
              start_sec: startSec,
              duration_sec: Number((shot as any)?.duration_sec || 5),
              in_offset_sec: 0,
              out_offset_sec: 0,
              metadata: {},
            });
          }
          await intelligenceDb
            .from("design_shots")
            .update({ status: "approved", date_updated: new Date().toISOString() })
            .eq("id_shot", shotId);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_shot_committed: { id: shotId } })}\n\n`));
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Shot ${shotId} committed to timeline (status='approved'). Storyboard card now shows the green check.`,
          });
        } catch (err: any) {
          console.error("[design_commit_shot]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Commit failed: ${err?.message}`, is_error: true });
        }
      } else if (tool.name === "design_save_prompt") {
        try {
          if (!config.workspaceId || !config.userId) throw new Error("Workspace + user required");
          const name = String(tool.input.name || "").trim();
          if (!name) throw new Error("name required");
          let prompt = String(tool.input.prompt || "").trim();
          // Fall back to the focused shot's prompt if the model didn't include one inline.
          if (!prompt && config.designFocusedShotId) {
            const { intelligenceDb } = await import("@/lib/supabase-intelligence");
            const { data: focused } = await intelligenceDb
              .from("design_shots")
              .select("prompt")
              .eq("id_shot", config.designFocusedShotId)
              .maybeSingle();
            prompt = String((focused as any)?.prompt || "").trim();
          }
          if (!prompt) throw new Error("Nothing to save — no prompt on the focused shot.");
          const modelHint = tool.input.model_hint ? String(tool.input.model_hint) : null;
          const team = tool.input.team === true;
          const { intelligenceDb } = await import("@/lib/supabase-intelligence");
          const { data: created, error } = await intelligenceDb
            .from("design_saved_prompts")
            .insert({
              id_workspace: config.workspaceId,
              user_created: config.userId,
              name_prompt: name.slice(0, 120),
              prompt_text: prompt,
              model_hint: modelHint,
              flag_team: team ? 1 : 0,
            })
            .select("id_prompt")
            .single();
          if (error) throw new Error(error.message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ design_prompt_saved: { id: (created as any).id_prompt, name, team } })}\n\n`));
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Saved as "${name}"${team ? " (shared with team)" : ""}. Available under the bookmark icon next to the prompt block.`,
          });
        } catch (err: any) {
          console.error("[design_save_prompt]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Save failed: ${err?.message}`, is_error: true });
        }
      } else if (tool.name === "design_recall_prompts") {
        try {
          if (!config.workspaceId || !config.userId) throw new Error("Workspace + user required");
          const q = String(tool.input.q || "").trim();
          const limit = Math.max(1, Math.min(Number(tool.input.limit) || 8, 25));
          const { intelligenceDb } = await import("@/lib/supabase-intelligence");
          let query = intelligenceDb
            .from("design_saved_prompts")
            .select("id_prompt,name_prompt,prompt_text,model_hint,use_count,flag_team,last_used_at")
            .eq("id_workspace", config.workspaceId)
            .or(`user_created.eq.${config.userId},flag_team.eq.1`)
            .order("last_used_at", { ascending: false, nullsFirst: false })
            .limit(limit);
          if (q) query = query.or(`name_prompt.ilike.%${q}%,prompt_text.ilike.%${q}%`);
          const { data, error } = await query;
          if (error) throw new Error(error.message);
          const rows = data || [];
          if (rows.length === 0) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: q ? `No saved prompts match "${q}".` : `No saved prompts in this workspace yet.`,
            });
          } else {
            const summary = rows.map((r: any) => {
              const trimmed = r.prompt_text.length > 220 ? r.prompt_text.slice(0, 220) + "…" : r.prompt_text;
              return `• "${r.name_prompt}"${r.flag_team ? " (team)" : ""}${r.model_hint ? ` · ${r.model_hint}` : ""}${r.use_count ? ` · used ${r.use_count}×` : ""}\n  ${trimmed}`;
            }).join("\n\n");
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: `${rows.length} saved prompt${rows.length === 1 ? "" : "s"}${q ? ` for "${q}"` : ""}:\n\n${summary}\n\nTo apply one, call design_update_shot with the chosen prompt text.`,
            });
          }
        } catch (err: any) {
          console.error("[design_recall_prompts]", err?.message);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Recall failed: ${err?.message}`, is_error: true });
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
      } else if (tool.name === "lookup_client_context") {
        try {
          const result = await lookupClientContext(tool.input.client_name, config.workspaceId!);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: result,
          });
        } catch (err: any) {
          console.error("[LookupClientContext] Failed:", err.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Client context lookup failed: ${err.message}`,
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
      } else if (tool.name === "create_scheduled_task" || tool.name === "update_scheduled_task") {
        try {
          const { marker, toolMsg } = tool.name === "update_scheduled_task"
            ? await buildScheduledUpdateProposal(tool.input, config)
            : await buildScheduledProposal(tool.input, config);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ scheduled_proposal: { marker } })}\n\n`)
          );
          fullText += marker;
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: toolMsg });
        } catch (err: any) {
          console.error("[ScheduledTask] Proposal failed:", err.message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Could not build the schedule proposal: ${err.message}`,
            is_error: true,
          });
        }
      } else if (tool.name === "query_meetingbrain") {
        try {
          const result = await queryMeetingBrain(
            tool.input.report, config.userEmail!,
            { query: tool.input.query, status: tool.input.status, days: tool.input.days, workspaceId: config.workspaceId, meetingId: tool.input.meeting_id, visibility: config.conversationVisibility }
          );
          toolResults.push({
            type: "tool_result", tool_use_id: tool.id,
            content: formatMeetingBrainResult(tool.input.report, result),
          });
        } catch (err: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `MeetingBrain error: ${err.message}`, is_error: true });
        }
      } else if (tool.name === "query_slack") {
        try {
          const result = await querySlack(
            tool.input.report, config.userEmail!,
            {
              query: tool.input.query,
              channel: tool.input.channel,
              channel_id: tool.input.channel_id,
              thread_ts: tool.input.thread_ts,
              days: tool.input.days,
              limit: tool.input.limit,
              visibility: config.conversationVisibility,
            }
          );
          toolResults.push({
            type: "tool_result", tool_use_id: tool.id,
            content: formatSlackResult(tool.input.report, result),
          });
        } catch (err: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Slack error: ${err.message}`, is_error: true });
        }
      } else if (tool.name === "query_xero") {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`));
          const { queryXero } = await import("@/lib/xero/client");
          const result = await queryXero(tool.input.report, config.workspaceId!, {
            date_from: tool.input.date_from, date_to: tool.input.date_to, client_name: tool.input.client_name,
          });
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: formatXeroResult(tool.input.report, result) });
        } catch (err: any) {
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: `Xero error: ${err.message}`, is_error: true });
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
    // If the round made no real progress (every tool call was a repeat or over
    // the per-tool cap), stop now rather than churning to the round cap.
    if (!executedAnyTool) break;
  }

  // Forced final answer: fires when the loop ended ANY way other than a natural
  // stop (round cap, no-progress break, stall) or produced no text at all. One
  // tools-disabled round turns the gathered tool context into an actual answer
  // instead of leaving a dangling "let me pull the details…".
  if ((!loopEndedCleanly || !fullText.trim()) && anthropicMessages.length > 1) {
    console.log(`[Anthropic] Tool loop ended without a natural stop (text=${fullText.trim().length} chars) — forcing final answer`);
    try {
      // Keep roles alternating: append the nudge to the trailing user message
      // (tool results) if there is one, else push a fresh user message.
      const nudgeBlock = { type: "text" as const, text: FORCED_FINAL_NUDGE };
      const lastMsg: any = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) lastMsg.content.push(nudgeBlock);
      else anthropicMessages.push({ role: "user", content: [nudgeBlock] } as any);
      if (fullText.trim() && !fullText.endsWith("\n")) {
        fullText += "\n\n";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
      }
      const finalStream = anthropic.messages.stream({
        model: apiModel,
        max_tokens: config.maxTokens || 4096,
        ...anthropicModelParams(apiModel, config),
        system: systemText,
        messages: anthropicMessages,
        // tools MUST be passed when the history contains tool_use/tool_result
        // blocks — the API 400s otherwise. tool_choice "none" is what actually
        // forces a text-only response.
        ...(tools.length > 0 ? { tools, tool_choice: { type: "none" as const } } : {}),
      });

      for await (const event of withStallGuard(finalStream)) {
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

      const finalMsg = await finalStream.finalMessage();
      totalInputTokens += finalMsg.usage?.input_tokens || 0;
      totalOutputTokens += finalMsg.usage?.output_tokens || 0;
      console.log(`[Anthropic] Forced final response: ${fullText.length} chars`);
    } catch (err: any) {
      console.error(`[Anthropic] Forced final response failed:`, err.message);
    }
  }

  // Stalled AND nothing to show (round-0 stall on a fresh chat, or the rescue
  // itself failed): rethrow so createStreamingResponse's provider fallback
  // takes the turn — never persist a blank reply as a successful completion.
  if (stalledOut && !fullText.trim()) {
    throw new StreamStallError();
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
    tools.push(LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL);
  }
  // Web search: use xAI's native search_mode instead of a tool call.
  // This is faster and more reliable than the Responses API approach.
  // (WEB_SEARCH_OPENAI_TOOL is kept for reference but no longer added to tools)
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
    tools.push(SLACK_OPENAI_TOOL);
  }
  if (config.workspaceId && config.financeAccess) {
    tools.push(QUERY_XERO_OPENAI_TOOL); // executor answers "not connected" gracefully
  }
  if (config.enableScheduling && config.workspaceId && config.userId) {
    tools.push(CREATE_SCHEDULED_TASK_OPENAI_TOOL);
    if (config.scheduledTask) tools.push(UPDATE_SCHEDULED_TASK_OPENAI_TOOL);
  }

  console.log(`[xAI] Streaming model=${apiModel}, webSearch=${config.webSearch}, imageGen=${config.imageGeneration}, tools=[${tools.map(t => (t as any).function?.name || t.type).join(', ') || 'none'}]`);

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  let loopEndedCleanly = false; // natural stop — anything else forces a final answer
  // No-progress guard against the "tail-chasing spiral": a model that wants a
  // capability it lacks this turn (e.g. asks to "run a web search" when no web
  // tool is available) calls its one available tool (query_engine) over and
  // over, gets the same "no results", and re-narrates each round until the round
  // cap — producing a wall of repeated text. Track executed tool signatures +
  // per-tool counts; skip repeats and stop when a round makes no real progress.
  const executedToolSigs = new Set<string>();
  const toolCallCounts = new Map<string, number>();
  const MAX_CALLS_PER_TOOL = 3;
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

    let stalled = false;
    try {
    for await (const chunk of withStallGuard(stream)) {
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
          if (existing.name === "query_slack" && tc.function?.name) {
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
    } catch (e) {
      if (e instanceof StreamStallError && round > 0) {
        // Rounds complete atomically, so round > 0 means earlier rounds already
        // executed tools — salvage that context via the forced final answer.
        // A round-0 stall has nothing to salvage: rethrow so the provider
        // fallback restarts the turn cleanly (no duplicate side effects).
        console.warn(`[xAI] Round ${round} stalled mid-stream — forcing final answer from gathered context`);
        stalled = true;
      } else {
        throw e;
      }
    }
    if (stalled) break;

    // Add web_search indicator detection (xAI specific)
    // Already handled inline above with the other tool indicators

    console.log(`[xAI] Round ${round}: finishReason=${finishReason}, toolCalls=${toolCalls.size}, textLen=${fullText.length}`);

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      loopEndedCleanly = true;
      break;
    }

    // Round separator: the next round's narration must not jam straight into
    // this round's text ("…details directly.Found it…").
    if (fullText.trim() && !fullText.endsWith("\n")) {
      fullText += "\n\n";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
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
    let executedAnyTool = false;
    for (const tc of toolCallsArray) {
      // No-progress guard (see executedToolSigs above): skip a tool call
      // identical to one already run this turn, or any tool called too many
      // times, and tell the model to answer instead of churning the same call.
      const toolSig = `${tc.function.name}:${(tc.function.arguments || "").replace(/\s+/g, "")}`;
      const toolCount = (toolCallCounts.get(tc.function.name) || 0) + 1;
      toolCallCounts.set(tc.function.name, toolCount);
      if (executedToolSigs.has(toolSig) || toolCount > MAX_CALLS_PER_TOOL) {
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: executedToolSigs.has(toolSig)
            ? `You already called ${tc.function.name} with these exact arguments this turn — the result is above. Do NOT call it again. Answer the user now with what you have; if the data isn't available, say so plainly. Never promise to run a search or tool you cannot actually run.`
            : `You have called ${tc.function.name} too many times this turn. Stop calling tools and answer the user now with the information you have; if you can't find what they asked for, tell them directly.`,
        } as any);
        continue;
      }
      executedToolSigs.add(toolSig);
      executedAnyTool = true;
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
      } else if (tc.function.name === "lookup_client_context") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await lookupClientContext(input.client_name, config.workspaceId!);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          } as any);
        } catch (err: any) {
          console.error("[LookupClientContext/xAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Client context lookup failed: ${err.message}`,
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
      } else if (tc.function.name === "create_scheduled_task" || tc.function.name === "update_scheduled_task") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { marker, toolMsg } = tc.function.name === "update_scheduled_task"
            ? await buildScheduledUpdateProposal(input, config)
            : await buildScheduledProposal(input, config);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ scheduled_proposal: { marker } })}\n\n`)
          );
          fullText += marker;
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolMsg } as any);
        } catch (err: any) {
          console.error("[ScheduledTask/xAI] Proposal failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Could not build the schedule proposal: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, workspaceId: config.workspaceId, meetingId: input.meeting_id, visibility: config.conversationVisibility }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_slack") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await querySlack(
            input.report, config.userEmail!,
            {
              query: input.query,
              channel: input.channel,
              channel_id: input.channel_id,
              thread_ts: input.thread_ts,
              days: input.days,
              limit: input.limit,
              visibility: config.conversationVisibility,
            }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatSlackResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Slack error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_xero") {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`));
          const input = JSON.parse(tc.function.arguments);
          const { queryXero } = await import("@/lib/xero/client");
          const result = await queryXero(input.report, config.workspaceId!, {
            date_from: input.date_from, date_to: input.date_to, client_name: input.client_name,
          });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: formatXeroResult(input.report, result) } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Xero error: ${err.message}` } as any);
        }
      } else {
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Tool not implemented",
        } as any);
      }
    }
    // If the round made no real progress (every tool call was a repeat or over
    // the per-tool cap), stop now rather than churning the same calls to the
    // round cap — this is what ends the "tail-chasing spiral".
    if (!executedAnyTool) break;

    // Reset fullText for the continuation (text from tool_calls round was partial)
    // Don't reset — we want to accumulate all text across rounds
  }

  // Forced final answer: fires when the loop ended ANY way other than a natural
  // stop, or produced no text — turns gathered tool context into an actual
  // answer instead of a dangling "let me pull the details…".
  if ((!loopEndedCleanly || !fullText.trim()) && openaiMessages.length > 1) {
    console.log(`[xAI] Tool loop ended without a natural stop (text=${fullText.trim().length} chars) — forcing final answer`);
    try {
      openaiMessages.push({ role: "user", content: FORCED_FINAL_NUDGE } as any);
      if (fullText.trim() && !fullText.endsWith("\n")) {
        fullText += "\n\n";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
      }
      // Use max_completion_tokens for Grok-4 (same logic as main loop)
      const finalTokenParam = apiModel.startsWith("grok-4")
        ? { max_completion_tokens: config.maxTokens || 4096 }
        : { max_tokens: config.maxTokens || 4096 };
      const finalStream = await xai.chat.completions.create({
        model: apiModel,
        temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
        ...finalTokenParam,
        messages: openaiMessages as any,
        stream: true,
        // History contains tool_calls/tool messages — keep tools declared but
        // forbid calling them so this round must produce text.
        ...(tools.length > 0 ? { tools, tool_choice: "none" } : {}),
      });
      for await (const chunk of withStallGuard(finalStream)) {
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
        }
      }
      console.log(`[xAI] Forced final response: ${fullText.length} chars`);
    } catch (err: any) {
      console.error(`[xAI] Forced final response failed:`, err.message);
    }
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

/**
 * xAI Responses API streaming — CURRENTLY UNUSED (kept for reference).
 *
 * This was the original web-search implementation using xAI's Responses API
 * with `type: "web_search"` as an explicit tool. It has a nice `searching: true`
 * signal but was replaced by `streamXAIChatCompletions` with `search_mode: "on"`
 * because Chat Completions supports custom function calling (query_engine etc.)
 * while the Responses API does not.
 *
 * Could be revived if xAI adds function-call support to the Responses API.
 */
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
    tools.push(LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
    tools.push(SLACK_OPENAI_TOOL);
  }
  if (config.workspaceId && config.financeAccess) {
    tools.push(QUERY_XERO_OPENAI_TOOL); // executor answers "not connected" gracefully
  }
  if (config.enableScheduling && config.workspaceId && config.userId) {
    tools.push(CREATE_SCHEDULED_TASK_OPENAI_TOOL);
    if (config.scheduledTask) tools.push(UPDATE_SCHEDULED_TASK_OPENAI_TOOL);
  }
  // Gemini has no native web search here — expose the callable web_search tool
  // (executed via executeWebSearch → xAI LiveSearch).
  if (config.webSearch) {
    tools.push(WEB_SEARCH_OPENAI_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  let loopEndedCleanly = false; // natural stop — anything else forces a final answer
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

    let stalled = false;
    try {
    for await (const chunk of withStallGuard(stream)) {
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
          if (existing.name === "query_slack" && tc.function?.name) {
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
    } catch (e) {
      if (e instanceof StreamStallError && round > 0) {
        // Rounds complete atomically, so round > 0 means earlier rounds already
        // executed tools — salvage that context via the forced final answer.
        // A round-0 stall has nothing to salvage: rethrow to the outer handler.
        console.warn(`[AI] Tool round ${round} stalled mid-stream — forcing final answer from gathered context`);
        stalled = true;
      } else {
        throw e;
      }
    }
    if (stalled) break;

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      loopEndedCleanly = true;
      break;
    }

    // Round separator: the next round's narration must not jam straight into
    // this round's text ("…details directly.Found it…").
    if (fullText.trim() && !fullText.endsWith("\n")) {
      fullText += "\n\n";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
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
      } else if (tc.function.name === "lookup_client_context") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await lookupClientContext(input.client_name, config.workspaceId!);
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);
        } catch (err: any) {
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Client context lookup failed: ${err.message}` } as any);
        }
      } else if (tc.function.name === "web_search") {
        try {
          const input = JSON.parse(tc.function.arguments);
          console.log(`[WebSearch/Gemini] Starting search: "${input.query?.slice(0, 80)}"`);
          const searchResults = await executeWebSearch(input.query, config.systemPrompt, apiModel);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search results for "${input.query}":\n\n${searchResults}\n\nIMPORTANT: Only cite facts and URLs that appear in these search results. Do NOT fabricate sources.`,
          } as any);
        } catch (err: any) {
          console.error("[WebSearch/Gemini] Failed:", err.message);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search failed: ${err.message}. Answer based on your existing knowledge instead, and say clearly that you could not verify with a live search.`,
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
      } else if (tc.function.name === "create_scheduled_task" || tc.function.name === "update_scheduled_task") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { marker, toolMsg } = tc.function.name === "update_scheduled_task"
            ? await buildScheduledUpdateProposal(input, config)
            : await buildScheduledProposal(input, config);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ scheduled_proposal: { marker } })}\n\n`)
          );
          fullText += marker;
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolMsg } as any);
        } catch (err: any) {
          console.error("[ScheduledTask/Gemini] Proposal failed:", err.message);
          geminiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Could not build the schedule proposal: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, workspaceId: config.workspaceId, meetingId: input.meeting_id, visibility: config.conversationVisibility }
          );
          geminiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_slack") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await querySlack(
            input.report, config.userEmail!,
            {
              query: input.query,
              channel: input.channel,
              channel_id: input.channel_id,
              thread_ts: input.thread_ts,
              days: input.days,
              limit: input.limit,
              visibility: config.conversationVisibility,
            }
          );
          geminiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatSlackResult(input.report, result),
          } as any);
        } catch (err: any) {
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Slack error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_xero") {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`));
          const input = JSON.parse(tc.function.arguments);
          const { queryXero } = await import("@/lib/xero/client");
          const result = await queryXero(input.report, config.workspaceId!, {
            date_from: input.date_from, date_to: input.date_to, client_name: input.client_name,
          });
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: formatXeroResult(input.report, result) } as any);
        } catch (err: any) {
          geminiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Xero error: ${err.message}` } as any);
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

  // Forced final answer: fires when the loop ended ANY way other than a natural
  // stop, or produced no text — turns gathered tool context into an actual
  // answer instead of a dangling "let me pull the details…".
  if ((!loopEndedCleanly || !fullText.trim()) && geminiMessages.length > 1) {
    console.log(`[Gemini] Tool loop ended without a natural stop (text=${fullText.trim().length} chars) — forcing final answer`);
    try {
      geminiMessages.push({ role: "user", content: FORCED_FINAL_NUDGE } as any);
      if (fullText.trim() && !fullText.endsWith("\n")) {
        fullText += "\n\n";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
      }
      const finalStream = await client.chat.completions.create({
        model: apiModel,
        temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
        max_tokens: config.maxTokens || 4096,
        messages: geminiMessages as any,
        stream: true,
        // History contains tool_calls/tool messages — keep tools declared but
        // forbid calling them so this round must produce text.
        ...(tools.length > 0 ? { tools, tool_choice: "none" } : {}),
      });
      for await (const chunk of withStallGuard(finalStream)) {
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
        }
      }
      console.log(`[Gemini] Forced final response: ${fullText.length} chars`);
    } catch (err: any) {
      console.error(`[Gemini] Forced final response failed:`, err.message);
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
  encoder: TextEncoder,
  options?: { clientOverride?: OpenAI; providerLabel?: string }
): Promise<StreamResult> {
  const client = options?.clientOverride ?? getOpenAIClient();

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
    tools.push(LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL);
  }
  if (config.workspaceId && config.userId) {
    tools.push(SEARCH_MEMORY_OPENAI_TOOL);
  }
  if (config.userEmail) {
    tools.push(MEETINGBRAIN_OPENAI_TOOL);
    tools.push(SLACK_OPENAI_TOOL);
  }
  if (config.workspaceId && config.financeAccess) {
    tools.push(QUERY_XERO_OPENAI_TOOL); // executor answers "not connected" gracefully
  }
  if (config.enableScheduling && config.workspaceId && config.userId) {
    tools.push(CREATE_SCHEDULED_TASK_OPENAI_TOOL);
    if (config.scheduledTask) tools.push(UPDATE_SCHEDULED_TASK_OPENAI_TOOL);
  }
  // GPT has no native web search here — expose the callable web_search tool
  // (executed via executeWebSearch → xAI LiveSearch).
  if (config.webSearch) {
    tools.push(WEB_SEARCH_OPENAI_TOOL);
  }

  let fullText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool use loop: model may request tool calls, which we execute and feed back
  const MAX_TOOL_ROUNDS = 8;
  let loopEndedCleanly = false; // natural stop — anything else forces a final answer
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

    let stalled = false;
    try {
    for await (const chunk of withStallGuard(stream)) {
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
          if (existing.name === "query_slack" && tc.function?.name) {
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
    } catch (e) {
      if (e instanceof StreamStallError && round > 0) {
        // Rounds complete atomically, so round > 0 means earlier rounds already
        // executed tools — salvage that context via the forced final answer.
        // A round-0 stall has nothing to salvage: rethrow to the outer handler.
        console.warn(`[AI] Tool round ${round} stalled mid-stream — forcing final answer from gathered context`);
        stalled = true;
      } else {
        throw e;
      }
    }
    if (stalled) break;

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.size === 0) {
      loopEndedCleanly = true;
      break;
    }

    // Round separator: the next round's narration must not jam straight into
    // this round's text ("…details directly.Found it…").
    if (fullText.trim() && !fullText.endsWith("\n")) {
      fullText += "\n\n";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
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
      } else if (tc.function.name === "lookup_client_context") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await lookupClientContext(input.client_name, config.workspaceId!);
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Client context lookup failed: ${err.message}` } as any);
        }
      } else if (tc.function.name === "web_search") {
        try {
          const input = JSON.parse(tc.function.arguments);
          console.log(`[WebSearch/OpenAI] Starting search: "${input.query?.slice(0, 80)}"`);
          const searchResults = await executeWebSearch(input.query, config.systemPrompt, apiModel);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search results for "${input.query}":\n\n${searchResults}\n\nIMPORTANT: Only cite facts and URLs that appear in these search results. Do NOT fabricate sources.`,
          } as any);
        } catch (err: any) {
          console.error("[WebSearch/OpenAI] Failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Web search failed: ${err.message}. Answer based on your existing knowledge instead, and say clearly that you could not verify with a live search.`,
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
      } else if (tc.function.name === "create_scheduled_task" || tc.function.name === "update_scheduled_task") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const { marker, toolMsg } = tc.function.name === "update_scheduled_task"
            ? await buildScheduledUpdateProposal(input, config)
            : await buildScheduledProposal(input, config);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ scheduled_proposal: { marker } })}\n\n`)
          );
          fullText += marker;
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolMsg } as any);
        } catch (err: any) {
          console.error("[ScheduledTask/OpenAI] Proposal failed:", err.message);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Could not build the schedule proposal: ${err.message}`,
          } as any);
        }
      } else if (tc.function.name === "query_meetingbrain") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await queryMeetingBrain(
            input.report, config.userEmail!,
            { query: input.query, status: input.status, days: input.days, workspaceId: config.workspaceId, meetingId: input.meeting_id, visibility: config.conversationVisibility }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatMeetingBrainResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `MeetingBrain error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_slack") {
        try {
          const input = JSON.parse(tc.function.arguments);
          const result = await querySlack(
            input.report, config.userEmail!,
            {
              query: input.query,
              channel: input.channel,
              channel_id: input.channel_id,
              thread_ts: input.thread_ts,
              days: input.days,
              limit: input.limit,
              visibility: config.conversationVisibility,
            }
          );
          openaiMessages.push({
            role: "tool", tool_call_id: tc.id,
            content: formatSlackResult(input.report, result),
          } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Slack error: ${err.message}` } as any);
        }
      } else if (tc.function.name === "query_xero") {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ querying_engine: true })}\n\n`));
          const input = JSON.parse(tc.function.arguments);
          const { queryXero } = await import("@/lib/xero/client");
          const result = await queryXero(input.report, config.workspaceId!, {
            date_from: input.date_from, date_to: input.date_to, client_name: input.client_name,
          });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: formatXeroResult(input.report, result) } as any);
        } catch (err: any) {
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Xero error: ${err.message}` } as any);
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

  // Forced final answer: fires when the loop ended ANY way other than a natural
  // stop, or produced no text — turns gathered tool context into an actual
  // answer instead of a dangling "let me pull the details…".
  if ((!loopEndedCleanly || !fullText.trim()) && openaiMessages.length > 1) {
    console.log(`[${options?.providerLabel ?? "OpenAI"}] Tool loop ended without a natural stop (text=${fullText.trim().length} chars) — forcing final answer`);
    try {
      openaiMessages.push({ role: "user", content: FORCED_FINAL_NUDGE } as any);
      if (fullText.trim() && !fullText.endsWith("\n")) {
        fullText += "\n\n";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n" })}\n\n`));
      }
      const finalStream = await client.chat.completions.create({
        model: apiModel,
        temperature: config.temperature ?? DEFAULT_CHAT_TEMPERATURE,
        max_tokens: config.maxTokens || 4096,
        messages: openaiMessages as any,
        stream: true,
        // History contains tool_calls/tool messages — keep tools declared but
        // forbid calling them so this round must produce text.
        ...(tools.length > 0 ? { tools, tool_choice: "none" } : {}),
      });
      for await (const chunk of withStallGuard(finalStream)) {
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
        }
      }
      console.log(`[${options?.providerLabel ?? "OpenAI"}] Forced final response: ${fullText.length} chars`);
    } catch (err: any) {
      console.error(`[${options?.providerLabel ?? "OpenAI"}] Forced final response failed:`, err.message);
    }
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

/* ─────────────── Perplexity Streaming ─────────────── */

async function streamPerplexity(
  messages: AIMessage[],
  config: AIProviderConfig,
  apiModel: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<StreamResult> {
  const client = getPerplexityClient();

  const pplxMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (config.systemPrompt) {
    pplxMessages.push({ role: "system", content: config.systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      pplxMessages.push({ role: msg.role, content: msg.content });
    }
  }

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = (await client.chat.completions.create({
    model: apiModel,
    messages: pplxMessages,
    stream: true,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  })) as unknown as AsyncIterable<any>;

  for await (const chunk of stream) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens || 0;
      outputTokens = chunk.usage.completion_tokens || 0;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      fullText += delta.content;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ token: delta.content })}\n\n`)
      );
    }
  }

  return { fullText, inputTokens, outputTokens };
}
