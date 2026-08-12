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
  QUERY_XERO_OPENAI_TOOL,
  QUERY_RESOURCING_OPENAI_TOOL,
} from "./providers";

/**
 * The voice model, overridable without a deploy.
 *
 * `grok-voice-latest` is an alias, which is convenient until it is not: it
 * moves under you, and there is no way to tell from here which concrete model
 * it currently resolves to. xAI publishes `grok-voice-think-fast-1.0` and
 * `grok-voice-think-fast-2.0`, so the default now names a version explicitly —
 * and XAI_VOICE_MODEL overrides it, so a bad release can be rolled back by
 * changing an env var rather than shipping code.
 *
 * If this model id is ever wrong the mint fails with a clear 4xx from xAI
 * rather than degrading, so a mistake here is loud.
 */
export const VOICE_MODEL = (process.env.XAI_VOICE_MODEL || "grok-voice-think-fast-2.0").trim();
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

/** end_conversation — handled CLIENT-side: the model signals closing intent,
 *  the browser says goodbye and tears the session down (then rearms wake mode). */
const END_CONVERSATION_TOOL = {
  type: "function" as const,
  function: {
    name: "end_conversation",
    description:
      "Call this when the user signals the conversation is over — 'OK thanks', 'that's all', 'perfect, goodbye', 'we're done'. Do NOT call it for a pause or a topic change. After calling it, you'll be asked to say a very short sign-off.",
    parameters: { type: "object", properties: {}, required: [] },
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
  END_CONVERSATION_TOOL,
] as any[];

/**
 * Tools voice offers only to users holding the matching flag.
 *
 * This list exists because of a real failure. Asked what the forecast profit
 * and loss looked like, voice answered with content-unit counts and then said
 * the data did not exist. It does — the revenue forecast workbook is a report
 * inside query_xero — but voice's tool list was a fixed array query_xero was
 * never added to. The model gave the only answer its tools allowed, and
 * reported a gap in its own capability as a gap in the company's data.
 */
const VOICE_GATED_TOOL_DEFS: { type: string; function: { name: string; description?: string; parameters?: unknown } }[] = [
  QUERY_XERO_OPENAI_TOOL,
  QUERY_RESOURCING_OPENAI_TOOL,
] as any[];

/**
 * Names the tools route will ACCEPT. Membership is not entitlement — it only
 * means the name is spellable. The route re-checks each gated tool's flag
 * server-side, because this list travels to the browser and whatever comes
 * back from there is a request, not a permission.
 */
export const VOICE_TOOL_NAMES = [...VOICE_TOOL_DEFS, ...VOICE_GATED_TOOL_DEFS].map(
  (t) => t.function!.name as string
);

/** Which per-user flag each gated tool needs. */
export const VOICE_GATED_TOOLS: Record<string, "finance" | "resourcing"> = {
  query_xero: "finance",
  query_resourcing: "resourcing",
};

/**
 * Realtime-API tool format: flattened {type, name, description, parameters}
 * (chat-completions nests these under `function`).
 */
export function getVoiceTools(access: { finance?: boolean; resourcing?: boolean } = {}) {
  const defs = [
    ...VOICE_TOOL_DEFS,
    ...VOICE_GATED_TOOL_DEFS.filter((t) => {
      const flag = VOICE_GATED_TOOLS[t.function!.name];
      return flag === "finance" ? !!access.finance : flag === "resourcing" ? !!access.resourcing : false;
    }),
  ];
  return defs.map((t) => ({
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
  /** Mirrors the gated tools actually offered, so the guidance for a tool
   *  never appears without the tool — or the tool without its guidance. */
  financeAccess?: boolean;
  resourcingAccess?: boolean;
}): string {
  const lines: string[] = [];

  lines.push(
    `You are EngineAI, the AI assistant built into The Content Engine — a social media and content production platform. You are in a LIVE VOICE conversation${ctx.userName ? ` with ${ctx.userName}` : ""}.`
  );

  lines.push(`
# Language — CRITICAL
ALWAYS speak English. Never switch languages, even if the audio is briefly unclear, accented, or contains a foreign word — stay in English. Only switch if the user explicitly asks you to speak another language.

# Voice consistency — CRITICAL
Speak in your natural default voice and accent and keep it EXACTLY the same for the entire conversation — same voice, same pitch, same pace, from the first word to the last. Never imitate, drift into, or switch accents, and never change how you sound between turns OR within a turn — sounding like two different people is jarring. Never role-play characters, do impressions, or give quoted text, examples, lists or headings a different "performance" voice — read everything exactly like your normal speech. When you continue speaking after checking data with a tool, you are the SAME person finishing the SAME reply: do not restart with new energy or a different delivery. Use British spelling and vocabulary in any text you produce, but do NOT attempt a British accent.`);

  lines.push(`
# Your wake name
Hands-free users summon you by saying "Orac" — treat it as your name in voice conversations. If the user addresses you as Orac mid-conversation, respond naturally; no need to explain the name.`);

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
Before any tool call, say a SHORT acknowledgment first ("let me check", "one sec, pulling that up") so the silence never feels dead. After results: give the headline first, offer detail ("want me to break that down?").

# Ending the conversation
When the user clearly signals they're done ("OK thanks", "that's all", "perfect, goodbye"), call end_conversation, then give ONE short warm sign-off ("Anytime — talk soon."). Don't call it for pauses, thinking out loud, or topic changes; if unsure, keep listening.`);

  // Money and capacity questions, named explicitly. Without this the model
  // reaches for query_engine — which knows content units and nothing about
  // revenue — and then reports that the company has no financial data, because
  // from inside its tool list that is what it looks like.
  if (ctx.financeAccess) {
    lines.push(`
# Money questions
query_xero is the ONLY source for anything financial, and it covers more than invoices:
- report:"forecast" — the LIVE revenue forecast workbook: projected revenue by month and client, weighted scenarios, and COSTS. This is what answers "how is the forecast looking", "what does profit and loss look like for the year", "are we going to hit the number". Use the sheet parameter for a specific sheet, and the match parameter for specific row labels like "net profit" or "gross margin".
- report:"profit_and_loss" — actual P&L for a period, as booked in Xero.
- report:"unpaid_invoices", "aged_receivables", "revenue_by_client" — who owes what, and what has been invoiced.
NEVER answer a money question from query_engine. It knows content units and contracts, not revenue or cost, so answering from it silently swaps "what are we earning" for "how much work is in the pipeline" — a different question with a plausible-sounding number. If the forecast call fails, say the forecast could not be reached; do NOT tell the user the company has no financial data.`);
  }

  if (ctx.resourcingAccess) {
    lines.push(`
# Capacity questions
query_resourcing covers team capacity, contracts and delivery against plan: report:"capacity" for who has room, "horizon" for when we run short over the coming months, "monthly_outlook" for one month company-wide, "contract_health" for renewals and contracts ending. These are PLAN figures. Never present a null as zero — it means not recorded, and reporting an unrecorded plan as zero describes a fully booked person as free.`);
  }

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
