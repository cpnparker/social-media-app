/**
 * EngineAI Voice — session configuration for the xAI Grok Voice Agent API.
 *
 * The browser connects directly to wss://api.x.ai/v1/realtime with an
 * ephemeral token (minted by /api/ai/voice/session). Tool EXECUTION never
 * happens in the browser: the voice model emits function calls, the client
 * POSTs them to /api/ai/voice/tools, and the result is returned to the model.
 */

import {
  QUERY_ENGINE_OPENAI_TOOL,
  LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL,
  SEARCH_MEMORY_OPENAI_TOOL,
  MEETINGBRAIN_OPENAI_TOOL,
  SLACK_OPENAI_TOOL,
} from "./providers";

export const VOICE_MODEL = "grok-voice-latest";
export const VOICE_NAME = "ara"; // warm, conversational — chosen 2026-06-10
export const VOICE_SAMPLE_RATE = 24000;
/** $0.05/min → tenths-of-cents per minute for ai_usage logging */
export const VOICE_COST_TENTHS_PER_MIN = 50;

/** consult_analyst — escalation hatch to Claude for heavy reasoning. */
const CONSULT_ANALYST_TOOL = {
  type: "function" as const,
  function: {
    name: "consult_analyst",
    description:
      "Hand a complex question to EngineAI's senior analyst (a deeper reasoning model) and get back a concise written analysis to relay to the user. Use for multi-step analysis, strategy, tricky comparisons, or anything where you'd want to think hard before answering. Tell the user you're 'digging into that' first — the analyst takes a few seconds.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The full question to analyse, with all relevant specifics the user gave.",
        },
        context: {
          type: "string",
          description: "Optional: relevant data you've already fetched this conversation (query results, meeting notes) the analyst should use.",
        },
      },
      required: ["question"],
    },
  },
};

/** Chat-completions-format tools shared with the text pipeline.
 *  (Typed loosely: the OpenAI SDK's ChatCompletionTool union includes custom
 *  tools without `.function`, but everything here is a function tool.) */
const VOICE_TOOL_DEFS: { type: string; function: { name: string; description?: string; parameters?: unknown } }[] = [
  QUERY_ENGINE_OPENAI_TOOL,
  LOOKUP_CLIENT_CONTEXT_OPENAI_TOOL,
  SEARCH_MEMORY_OPENAI_TOOL,
  MEETINGBRAIN_OPENAI_TOOL,
  SLACK_OPENAI_TOOL,
  CONSULT_ANALYST_TOOL,
] as any[];

/** Names the tools route will execute. Anything else is rejected. */
export const VOICE_TOOL_NAMES = VOICE_TOOL_DEFS.map((t) => t.function!.name as string);

/**
 * Realtime-API tool format: flattened {type, name, description, parameters}
 * (chat-completions nests these under `function`).
 */
export function getVoiceTools() {
  return VOICE_TOOL_DEFS.map((t) => ({
    type: "function",
    name: t.function!.name,
    description: t.function!.description,
    parameters: t.function!.parameters,
  }));
}

/**
 * Voice system prompt. Deliberately NOT the full text-chat system prompt:
 * voice needs brevity rules and spoken-style formatting, and a long prompt
 * slows the first response. Workspace specifics are interpolated.
 */
export function buildVoiceInstructions(ctx: {
  userName?: string | null;
  workspaceName?: string | null;
  clientName?: string | null;
  clientId?: number | null;
  isTeamThread: boolean;
  /** Human-readable current date/time, e.g. "Wednesday, 10 June 2026, 14:32" */
  now: string;
  /** All registered client names — lets the model normalize phonetic
   *  transcriptions ("Gelderma" → "Galderma") before searching. */
  clientRoster?: string[];
}): string {
  const lines: string[] = [];

  lines.push(
    `You are EngineAI, the AI assistant built into The Content Engine — a social media and content production platform. You are in a LIVE VOICE conversation${ctx.userName ? ` with ${ctx.userName}` : ""}.`
  );

  lines.push(`
# Language — CRITICAL
ALWAYS speak English (British English). Never switch languages, even if the audio is briefly unclear, accented, or contains a foreign word — stay in English. Only switch if the user explicitly asks you to speak another language.`);

  lines.push(`
# Current date & time — CRITICAL
Right now it is ${ctx.now} (Europe/Zurich). Use THIS for every date calculation: "today", "yesterday", "this week", "this month" all derive from it — e.g. query_engine date_from/date_to. Never guess or assume the date.`);

  lines.push(`
# Voice style — this defines you
- Talk like a sharp, warm colleague, not a search engine. Contractions, natural rhythm, occasional brief acknowledgments ("sure", "mm, let me look").
- SHORT turns. One to three sentences for most replies, then stop and let them react. Never monologue unless they ask you to walk through something.
- Never read out markdown, bullet symbols, URLs, or IDs. Say numbers naturally ("about forty-two hundred", "three point five percent"). Round unless precision matters.
- If interrupted, stop instantly and listen — don't resume your old sentence, respond to what they just said.
- If you didn't catch something, ask casually ("sorry, which client was that?").
- It's a conversation: it's good to ask one clarifying question before running a query if the request is ambiguous.`);

  lines.push(`
# Data tools
You have live access to the workspace's data. USE IT — never guess numbers.
- query_engine: content pipeline, contracts (report: contracts_summary), tasks, social performance, clients, ideas.
- lookup_client_context: a client's profile, brand context, contracts, recent meetings.
- query_meetingbrain: the user's meetings/tasks and workspace client meetings (report: client_meetings).
- query_slack: the user's Slack.
- search_memory: things the user told you before.
- consult_analyst: hand hard analytical questions to a deeper reasoning model; relay its answer conversationally.
Before any tool call, say a SHORT acknowledgment first ("let me check", "one sec, pulling that up") so the silence never feels dead. After results: give the headline first, offer detail ("want me to break that down?").`);

  if (ctx.clientRoster && ctx.clientRoster.length > 0) {
    lines.push(`
# Client roster — names you will hear
Registered clients: ${ctx.clientRoster.join(", ")}.
You are hearing the user through speech-to-text, so company and people names often arrive misspelled ("Gelderma" when they mean "Galderma"). Before ANY search or query involving a client name, match what you heard against this roster and use the REGISTERED spelling. If a search still returns nothing for a name, assume misspelling: retry with the closest roster name or a distinctive fragment before telling the user nothing was found.`);
  }

  if (ctx.clientName) {
    lines.push(`\n# Active client\nThe user currently has ${ctx.clientName} selected (client_id ${ctx.clientId}). Assume questions are about this client unless they say otherwise, and pass client_id ${ctx.clientId} to query_engine.`);
  }
  if (ctx.workspaceName) {
    lines.push(`\nWorkspace: ${ctx.workspaceName}.`);
  }

  lines.push(`
# Accuracy
- Numbers, dates, statuses: only from tool results. If a tool fails, say you couldn't reach that system — never improvise data.
- If you're not sure, say so plainly. Honest uncertainty beats confident guessing.`);

  if (ctx.isTeamThread) {
    lines.push(`
# Team conversation privacy
This conversation is visible to all workspace members. Personal meetings, personal tasks and Slack lookups are blocked here — if asked, briefly explain they need a private chat for that. Client meetings (report: client_meetings) ARE available.`);
  }

  return lines.join("\n");
}
