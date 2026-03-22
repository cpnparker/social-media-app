/**
 * Smart Query Router: classifies user messages to control which
 * data sources activate for each conversation turn.
 *
 * Zero-cost pattern matching — no LLM call required.
 * Controls xAI search_mode ("on" | "off"), never "auto".
 * Generates system prompt hints to steer tool usage.
 */

import type { NormalizedContextConfig } from "./system-prompts";

/* ─────────────── Types ─────────────── */

export type QueryIntent =
  | "conversational"   // thanks, hi, rephrase, follow-up
  | "workspace_data"   // contracts, CUs, clients, content
  | "web_search"       // explicit web search or current events
  | "meeting_data"     // meetings, action items
  | "memory_recall"    // past conversations, preferences
  | "hybrid"           // needs multiple sources
  | "general";         // general knowledge

export interface QueryRoute {
  searchMode: "on" | "off";
  suggestEngine: boolean;
  suggestMemory: boolean;
  suggestMeetingBrain: boolean;
  intent: QueryIntent;
  hints: string[];
}

/* ─────────────── Pattern Constants ─────────────── */

// Step 1: Conversational — no search needed
const GRATITUDE = /^(thanks|thank you|thx|ty|cheers|great|perfect|awesome|nice|cool|got it|ok|okay|noted|understood|will do)\b/i;
const AFFIRMATIONS = /^(yes|no|yep|nope|sure|right|exactly|correct|agreed|absolutely|definitely)\b/i;
const REPHRASE = /\b(rephrase|reword|rewrite|shorter|longer|simpler|more formal|more casual|bullet points|as a list|make it|format it|tone it|polish|clean up|tidy up)\b/i;
const FOLLOW_UP_SHORT = /^(and |also |what about |how about |can you also |and the |what if )/i;
const CLARIFICATION = /^(what do you mean|i meant|i was asking|no i mean|i'm asking|sorry i meant)\b/i;
const GREETING_SHORT = /^(hi|hello|hey|good morning|good afternoon|good evening|howdy)\b/i;
// Simple emoji check — just check if message is very short and has no letters
function isEmojiOnly(text: string): boolean {
  return text.length > 0 && text.length < 20 && !/[a-zA-Z0-9]/.test(text);
}
const EDITING = /^(make |change |edit |update |modify |adjust |tweak |fix |correct |improve )(it |this |that |the )?(to be |to |so it |more |less )?/i;

// Data keywords that prevent conversational classification
const DATA_KEYWORDS = /\b(contract|client|content|pipeline|social|meeting|task|CU|budget|report|data|metrics|performance|search|find|look up|web|price|cost|news|compare)\b/i;

// Step 2: Explicit web search
const WEB_EXPLICIT = /\b(search the web|search online|google it|look up online|web search|search for me|find online|look it up online|browse the web)\b/i;
const WEB_EXPLICIT_2 = /\b(latest news|current events|trending now|breaking news|what'?s happening)\b/i;
const WEB_EXPLICIT_3 = /\b(current price|stock price|weather in|score of|released today|just announced|search for .{3,})\b/i;
const WEB_EXPLICIT_4 = /\b(what is the (current|latest|recent)|what'?s the (latest|current|recent))\b/i;

// Step 3: Meeting data
const MEETING_KEYWORDS = /\b(meeting|meetings|discussed in|action items?|to-?do from|agenda|minutes|standup|stand-?up|sync with|call with)\b/i;
const MEETING_KEYWORDS_2 = /\bwhat did (we|i|they) (discuss|talk about|decide|agree|cover)\b/i;
const MEETING_KEYWORDS_3 = /\b(meeting notes?|meeting summary|from the meeting|in the call|during the meeting)\b/i;

// Step 4: Workspace / Engine data
const ENGINE_KEYWORDS = /\b(contracts?|CUs?|content units?|deliverables?|commissioned|completed units)\b/i;
const ENGINE_KEYWORDS_2 = /\b(content pipeline|social posts?|scheduled posts?|published posts?|our ideas?|content calendar)\b/i;
const ENGINE_KEYWORDS_3 = /\b(how many|how much|total|count of|number of|remaining|overdue|outstanding)\b/i;
const ENGINE_KEYWORDS_4 = /\b(Q[1-4]|quarter|last month|this month|this week|last week|year to date|YTD|this year)\b/i;
const ENGINE_KEYWORDS_5 = /\b(performance|metrics|report on|dashboard|overview of|summary of our|our (team|company|agency|workspace))\b/i;
const ENGINE_KEYWORDS_6 = /\b(our clients?|client list|which clients?|for (client|the client))\b/i;

// Step 5: Memory recall
const MEMORY_KEYWORDS = /\b(remember when|you remember|we talked about|i told you|i mentioned|last time we|previously)\b/i;
const MEMORY_KEYWORDS_2 = /\b(my preference|i prefer|i like to|i always|my style|my usual|the way i)\b/i;
const MEMORY_KEYWORDS_3 = /\b(you said|you recommended|you suggested|your advice|you told me)\b/i;
const MEMORY_KEYWORDS_4 = /\b(in our (last|previous|earlier) (conversation|chat|discussion|session))\b/i;

// Step 7: Implicit web (soft signals — benefits from web data)
const WEB_IMPLICIT = /\b(competitors?|competitor analysis|industry (benchmark|trend|standard|average))\b/i;
const WEB_IMPLICIT_2 = /\b(best practices?|how to|tutorial|guide|documentation for)\b/i;
const WEB_IMPLICIT_3 = /\b(pricing|cost of|how much does .{3,} cost|price of|price for)\b/i;
const WEB_IMPLICIT_4 = /\b(vs\.?|versus|compared to|comparison of|compare .{3,} (with|to|and|vs))\b/i;
const WEB_IMPLICIT_5 = /\b(instagram|tiktok|linkedin|facebook|twitter|x algorithm|threads|youtube|canva|figma|hubspot|mailchimp|hootsuite)\b/i;
const WEB_IMPLICIT_6 = /\b(news about|recent developments?|what'?s new with|updates? on|latest on)\b/i;

/* ─────────────── Helper ─────────────── */

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function hasDataKeywords(text: string): boolean {
  return DATA_KEYWORDS.test(text);
}

/* ─────────────── Hint Generation ─────────────── */

function generateHints(route: Omit<QueryRoute, "hints">): string[] {
  const hints: string[] = [];
  if (route.suggestEngine) {
    hints.push("This query likely involves workspace data — consider using query_engine to look up contracts, content, clients, or performance metrics.");
  }
  if (route.suggestMemory) {
    hints.push("The user may be referencing something from a past conversation — consider using search_memory to find relevant context.");
  }
  if (route.suggestMeetingBrain) {
    hints.push("This query appears to involve meetings or tasks — consider using query_meetingbrain to find relevant meeting notes or action items.");
  }
  if (route.searchMode === "on") {
    hints.push("Web search is active for this query. Use the search results to provide current, factual information with sources.");
  }
  return hints;
}

/* ─────────────── Main Router ─────────────── */

/**
 * Classify a user message and determine which data sources to activate.
 * Zero-cost pattern matching — runs in <2ms.
 */
export function routeQuery(
  userMessage: string,
  contextConfig: NormalizedContextConfig
): QueryRoute {
  const lower = userMessage.toLowerCase().trim();
  const len = lower.length;

  // Respect config toggles
  const webAllowed = contextConfig.webSearch !== "off";
  const meetingBrainAllowed = contextConfig.meetingBrain !== "off";
  const memoryAllowed = contextConfig.memory !== "off";

  // ── Step 1: Conversational fast-path ──
  // Short gratitude/affirmations
  if (len < 40 && GRATITUDE.test(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  if (len < 30 && AFFIRMATIONS.test(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  // Rephrase / editing requests (no data keywords)
  if (REPHRASE.test(lower) && !hasDataKeywords(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  if (EDITING.test(lower) && !hasDataKeywords(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  // Short follow-ups without data keywords
  if (len < 80 && FOLLOW_UP_SHORT.test(lower) && !hasDataKeywords(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  // Clarifications
  if (CLARIFICATION.test(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  // Short greetings
  if (len < 20 && GREETING_SHORT.test(lower)) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }
  // Emoji-only
  if (isEmojiOnly(userMessage.trim())) {
    return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "conversational", hints: [] };
  }

  // ── Step 2: Explicit web search ──
  const wantsWeb = webAllowed && matchesAny(lower, [WEB_EXPLICIT, WEB_EXPLICIT_2, WEB_EXPLICIT_3, WEB_EXPLICIT_4]);

  // ── Step 3-5: Detect data source signals ──
  const wantsMeeting = meetingBrainAllowed && matchesAny(lower, [MEETING_KEYWORDS, MEETING_KEYWORDS_2, MEETING_KEYWORDS_3]);
  const wantsEngine = matchesAny(lower, [ENGINE_KEYWORDS, ENGINE_KEYWORDS_2, ENGINE_KEYWORDS_3, ENGINE_KEYWORDS_4, ENGINE_KEYWORDS_5, ENGINE_KEYWORDS_6]);
  const wantsMemory = memoryAllowed && matchesAny(lower, [MEMORY_KEYWORDS, MEMORY_KEYWORDS_2, MEMORY_KEYWORDS_3, MEMORY_KEYWORDS_4]);

  // ── Step 6: Hybrid detection ──
  // If explicit web + Engine data → hybrid
  if (wantsWeb && wantsEngine) {
    const partial = { searchMode: "on" as const, suggestEngine: true, suggestMemory: wantsMemory, suggestMeetingBrain: wantsMeeting, intent: "hybrid" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Step 7: Implicit web search ──
  const implicitWeb = webAllowed && !wantsEngine && matchesAny(lower, [WEB_IMPLICIT, WEB_IMPLICIT_2, WEB_IMPLICIT_3, WEB_IMPLICIT_4, WEB_IMPLICIT_5, WEB_IMPLICIT_6]);

  // If Engine data + implicit web → hybrid
  if (wantsEngine && implicitWeb) {
    const partial = { searchMode: "on" as const, suggestEngine: true, suggestMemory: wantsMemory, suggestMeetingBrain: wantsMeeting, intent: "hybrid" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Return explicit web search ──
  if (wantsWeb) {
    const partial = { searchMode: "on" as const, suggestEngine: false, suggestMemory: wantsMemory, suggestMeetingBrain: wantsMeeting, intent: "web_search" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Return meeting data ──
  if (wantsMeeting && !wantsEngine) {
    const partial = { searchMode: "off" as const, suggestEngine: false, suggestMemory: wantsMemory, suggestMeetingBrain: true, intent: "meeting_data" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Return Engine data ──
  if (wantsEngine) {
    const partial = { searchMode: "off" as const, suggestEngine: true, suggestMemory: wantsMemory, suggestMeetingBrain: wantsMeeting, intent: "workspace_data" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Return memory recall ──
  if (wantsMemory) {
    const partial = { searchMode: "off" as const, suggestEngine: false, suggestMemory: true, suggestMeetingBrain: false, intent: "memory_recall" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Return implicit web ──
  if (implicitWeb) {
    const partial = { searchMode: "on" as const, suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "web_search" as const };
    return { ...partial, hints: generateHints(partial) };
  }

  // ── Step 8: Default — no special routing ──
  return { searchMode: "off", suggestEngine: false, suggestMemory: false, suggestMeetingBrain: false, intent: "general", hints: [] };
}
