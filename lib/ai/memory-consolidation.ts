/**
 * Memory Consolidation Engine (V2)
 *
 * When new candidate memories are extracted, this module compares them
 * against existing memories and classifies the relationship:
 *
 *  REINFORCE — new info confirms an existing memory → boost strength
 *  UPDATE    — new info refines/adds detail to existing → merge content + boost
 *  CONTRADICT — new info conflicts with existing → replace + reset
 *  ADD       — genuinely new information → insert as new row
 *  NOOP      — too trivial or redundant → skip
 *
 * Also provides lazy decay scoring for retrieval-time importance ranking.
 */

import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// ── Types ──

export interface ExistingMemory {
  id: string;
  content: string;
  category: string;
  strength: number;
  reinforcedCount: number;
  dateCreated: string;
  dateLastAccessed: string;
  source: string;
}

export type ConsolidationAction =
  | { action: "ADD" }
  | { action: "REINFORCE"; targetId: string }
  | { action: "UPDATE"; targetId: string; newContent: string }
  | { action: "CONTRADICT"; targetId: string; newContent: string }
  | { action: "NOOP" };

// ── Similarity search (no API calls — pure string ops) ──

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "been", "some", "them",
  "than", "this", "that", "with", "will", "each", "make", "like", "from",
  "they", "been", "said", "does", "into", "when", "what", "your", "also",
  "about", "which", "their", "there", "would", "should", "could", "these",
  "other", "being", "using", "prefer", "prefers", "wants", "likes",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  Array.from(a).forEach((word) => {
    if (b.has(word)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find existing memories semantically similar to the candidate.
 * Returns top matches above the threshold, sorted by similarity desc.
 */
export function findSimilarMemories(
  candidateContent: string,
  existingMemories: ExistingMemory[],
  threshold: number = 0.35
): { memory: ExistingMemory; similarity: number }[] {
  const candidateTokens = tokenize(candidateContent);
  if (candidateTokens.size === 0) return [];

  const scored: { memory: ExistingMemory; similarity: number }[] = [];

  for (const mem of existingMemories) {
    const memTokens = tokenize(mem.content);
    const sim = jaccardSimilarity(candidateTokens, memTokens);
    if (sim >= threshold) {
      scored.push({ memory: mem, similarity: sim });
    }
  }

  // Sort by similarity desc, cap at top 5
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, 5);
}

// ── LLM-based consolidation classification ──

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

const CONSOLIDATION_PROMPT = `You are a memory consolidation engine. Given a NEW candidate memory and EXISTING memories, classify the action.

Actions:
- REINFORCE: New info restates or confirms an existing memory. Return its ID.
- UPDATE: New info adds meaningful detail to an existing memory. Return its ID and merged content (combine old + new into one concise statement, max 2 sentences).
- CONTRADICT: New info conflicts with an existing memory (changed preference, outdated fact). Return its ID and the corrected content.
- ADD: New info is genuinely distinct from all existing memories.
- NOOP: New info is too trivial, vague, or redundant to store.

EXISTING MEMORIES:
{EXISTING}

NEW CANDIDATE:
Category: {CATEGORY}
Content: {CONTENT}

Return JSON only, no markdown:
{"action": "REINFORCE|UPDATE|CONTRADICT|ADD|NOOP", "targetId": "id or null", "newContent": "merged/corrected text or null"}`;

/**
 * Ask the LLM to classify how a candidate memory relates to similar existing ones.
 * Only called when findSimilarMemories returns matches — novel memories skip this.
 */
export async function classifyMemoryAction(
  candidate: { content: string; category: string; confidence: number },
  similarMemories: { memory: ExistingMemory; similarity: number }[]
): Promise<ConsolidationAction> {
  try {
    const xai = getXAIClient();

    const existingBlock = similarMemories
      .map(
        ({ memory: m }) =>
          `[${m.id}] ${m.category}: ${m.content} (strength: ${m.strength.toFixed(2)}, reinforced: ${m.reinforcedCount}x)`
      )
      .join("\n");

    const prompt = CONSOLIDATION_PROMPT.replace("{EXISTING}", existingBlock)
      .replace("{CATEGORY}", candidate.category)
      .replace("{CONTENT}", candidate.content);

    const response = await xai.chat.completions.create({
      model: "grok-3-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Classify this memory." },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });

    logAiUsage({ model: "grok-3-mini", source: "memory-consolidate", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return { action: "NOOP" };

    const jsonStr = raw.replace(/^```json?\s*/, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr);

    const action = parsed.action?.toUpperCase();
    const targetId = parsed.targetId || null;
    const newContent = parsed.newContent?.slice(0, 500) || null;

    // Validate the targetId exists in our similar memories
    const validIds = new Set(similarMemories.map((s) => s.memory.id));

    switch (action) {
      case "REINFORCE":
        if (targetId && validIds.has(targetId)) {
          return { action: "REINFORCE", targetId };
        }
        // If target invalid, treat as NOOP (memory was probably just similar enough)
        return { action: "NOOP" };

      case "UPDATE":
        if (targetId && validIds.has(targetId) && newContent) {
          return { action: "UPDATE", targetId, newContent };
        }
        return { action: "NOOP" };

      case "CONTRADICT":
        if (targetId && validIds.has(targetId) && newContent) {
          return { action: "CONTRADICT", targetId, newContent };
        }
        return { action: "ADD" }; // If we can't find what to contradict, add as new

      case "ADD":
        return { action: "ADD" };

      case "NOOP":
      default:
        return { action: "NOOP" };
    }
  } catch (err) {
    console.error("[Memory Consolidation] Classification failed:", err);
    // On failure, default to ADD so we don't lose the candidate
    return { action: "ADD" };
  }
}

// ── Apply consolidation actions to the database ──

export async function applyConsolidationAction(
  action: ConsolidationAction,
  candidate: { content: string; category: string },
  workspaceId: string,
  userId: number | null,
  scope: string,
  conversationId: string,
  typeSource: "explicit" | "inferred" | "meeting" = "inferred"
): Promise<{ id: string; content: string; action: string } | null> {
  const now = new Date().toISOString();

  switch (action.action) {
    case "ADD": {
      // Tiered initial strength: inferred memories start lower and need
      // reinforcement to reach full strength. Explicit and meeting memories
      // have stronger provenance so start higher.
      const initialStrength = typeSource === "explicit" ? 1.0
                            : typeSource === "meeting" ? 0.85
                            : 0.7;

      const { data: inserted } = await intelligenceDb
        .from("ai_memories")
        .insert({
          id_workspace: workspaceId,
          user_memory: userId,
          type_scope: scope,
          type_category: candidate.category,
          information_content: candidate.content.slice(0, 500),
          id_conversation_source: conversationId,
          type_source: typeSource,
          score_strength: initialStrength,
          count_reinforced: 0,
        })
        .select("id_memory")
        .single();
      if (!inserted) return null;
      console.log(`[Memory] ADD (${typeSource}, strength=${initialStrength}): "${candidate.content.slice(0, 60)}..."`);
      return { id: inserted.id_memory, content: candidate.content, action: "ADD" };
    }

    case "REINFORCE": {
      // Fetch current values, then compute new strength
      const { data: existing } = await intelligenceDb
        .from("ai_memories")
        .select("score_strength, count_reinforced")
        .eq("id_memory", action.targetId)
        .single();

      if (existing) {
        // Diminishing boost: bigger when weak, smaller when already strong.
        // A memory at 0.7 gets +0.045, at 0.9 gets +0.03 (floor).
        // This means 100% actually requires many confirmations.
        const boost = Math.max(0.03, 0.15 * (1.0 - existing.score_strength));
        await intelligenceDb
          .from("ai_memories")
          .update({
            score_strength: Math.min(1.0, existing.score_strength + boost),
            count_reinforced: existing.count_reinforced + 1,
            date_last_accessed: now,
            date_updated: now,
          })
          .eq("id_memory", action.targetId);
      }
      console.log(`[Memory] REINFORCE: target ${action.targetId}`);
      return { id: action.targetId, content: candidate.content, action: "REINFORCE" };
    }

    case "UPDATE": {
      const { data: existing } = await intelligenceDb
        .from("ai_memories")
        .select("score_strength, count_reinforced")
        .eq("id_memory", action.targetId)
        .single();

      if (existing) {
        // Diminishing boost for updates too (slightly stronger than reinforce)
        const boost = Math.max(0.04, 0.2 * (1.0 - existing.score_strength));
        await intelligenceDb
          .from("ai_memories")
          .update({
            information_content: action.newContent.slice(0, 500),
            score_strength: Math.min(1.0, existing.score_strength + boost),
            count_reinforced: existing.count_reinforced + 1,
            date_last_accessed: now,
            date_updated: now,
          })
          .eq("id_memory", action.targetId);
      }
      console.log(`[Memory] UPDATE: target ${action.targetId} → "${action.newContent.slice(0, 60)}..."`);
      return { id: action.targetId, content: action.newContent, action: "UPDATE" };
    }

    case "CONTRADICT": {
      await intelligenceDb
        .from("ai_memories")
        .update({
          information_content: action.newContent.slice(0, 500),
          score_strength: 1.0, // Fresh start — this is new info
          count_reinforced: 0, // Reset — previous reinforcements are invalidated
          date_last_accessed: now,
          date_updated: now,
        })
        .eq("id_memory", action.targetId);
      console.log(`[Memory] CONTRADICT: target ${action.targetId} → "${action.newContent.slice(0, 60)}..."`);
      return { id: action.targetId, content: action.newContent, action: "CONTRADICT" };
    }

    case "NOOP":
    default:
      console.log(`[Memory] NOOP: skipped "${candidate.content.slice(0, 60)}..."`);
      return null;
  }
}

// ── Decay & Importance Scoring (computed at retrieval time) ──

/**
 * Compute the decayed strength of a memory based on time since last access.
 * Uses exponential decay with category-specific half-lives.
 * Reinforcements extend the effective half-life.
 *
 * No DB writes — pure computation at read time.
 */
export function computeDecayedStrength(memory: {
  score_strength: number;
  date_last_accessed: string;
  type_category: string;
  type_source: string;
  count_reinforced: number;
}): number {
  const now = Date.now();
  const lastAccessed = new Date(memory.date_last_accessed).getTime();
  const daysSinceAccess = (now - lastAccessed) / 86_400_000;

  // Half-life varies by category and source
  let halfLifeDays: number;

  if (memory.type_source === "explicit") {
    halfLifeDays = 60; // User-created memories decay very slowly
  } else if (memory.type_source === "meeting") {
    halfLifeDays = 45; // Meeting-sourced: grounded in real events
  } else if (["instruction", "style"].includes(memory.type_category)) {
    halfLifeDays = 45; // Standing instructions are long-lived
  } else if (memory.type_category === "fact") {
    halfLifeDays = 30; // Facts are moderately stable
  } else {
    halfLifeDays = 14; // Preferences and client insights evolve faster
  }

  // Each reinforcement adds ~3 days to effective half-life
  const adjustedHalfLife = halfLifeDays + memory.count_reinforced * 3;

  // Exponential decay: strength * 2^(-t/halfLife)
  const decayFactor = Math.pow(2, -daysSinceAccess / adjustedHalfLife);
  const decayed = memory.score_strength * decayFactor;

  // Floor at 0.05 — memories never fully vanish
  return Math.max(0.05, decayed);
}

/**
 * Compute the overall importance score for retrieval ranking.
 * Combines decayed strength, reinforcement history, recency, and source trust.
 */
export function computeImportance(memory: {
  score_strength: number;
  count_reinforced: number;
  date_last_accessed: string;
  type_category: string;
  type_source: string;
}): { decayedStrength: number; importance: number } {
  const decayedStrength = computeDecayedStrength(memory);

  // Reinforcement bonus (saturating logarithmic — diminishing returns after ~10)
  const reinforcementBonus =
    Math.log(1 + memory.count_reinforced) / Math.log(11);

  // Recency score (exponential decay with ~21 day half-life)
  const daysSinceAccess =
    (Date.now() - new Date(memory.date_last_accessed).getTime()) / 86_400_000;
  const recencyScore = Math.exp(-daysSinceAccess / 30);

  // Source trust bonus
  const sourceBonus = memory.type_source === "explicit" ? 0.15
                    : memory.type_source === "meeting" ? 0.10
                    : 0;

  // Weighted importance score
  const importance =
    0.4 * decayedStrength +
    0.25 * reinforcementBonus +
    0.25 * recencyScore +
    0.1 +
    sourceBonus;

  return { decayedStrength, importance };
}

// ── Shared Consolidation Pipeline ──

export interface ConsolidationResult {
  added: number;
  reinforced: number;
  updated: number;
  contradicted: number;
  skipped: number;
  memories: { id: string; content: string; action: string }[];
}

/**
 * Run the full consolidation pipeline for a set of memory candidates.
 * Shared by conversation extraction and meeting ingest.
 *
 * 1. Fetch all existing memories for the workspace
 * 2. Count slots (50 max per user per workspace)
 * 3. For each candidate: findSimilar → classify → apply
 */
export async function runConsolidationPipeline(
  candidates: { content: string; category: string; confidence: number }[],
  workspaceId: string,
  userId: number | null,
  scope: string,
  sourceId: string,
  typeSource: "inferred" | "meeting" | "explicit" = "inferred"
): Promise<ConsolidationResult> {
  const result: ConsolidationResult = {
    added: 0,
    reinforced: 0,
    updated: 0,
    contradicted: 0,
    skipped: 0,
    memories: [],
  };

  if (candidates.length === 0) return result;

  // Fetch all existing memories with V2 fields
  const { data: allExistingRaw } = await intelligenceDb
    .from("ai_memories")
    .select("id_memory, information_content, type_category, score_strength, count_reinforced, date_created, date_last_accessed, type_source")
    .eq("id_workspace", workspaceId)
    .eq("flag_active", 1);

  const allExisting: ExistingMemory[] = (allExistingRaw || []).map((m: any) => ({
    id: m.id_memory,
    content: m.information_content,
    category: m.type_category,
    strength: m.score_strength ?? 1.0,
    reinforcedCount: m.count_reinforced ?? 0,
    dateCreated: m.date_created,
    dateLastAccessed: m.date_last_accessed ?? m.date_created,
    source: m.type_source ?? "inferred",
  }));

  // Count current memories for slot enforcement
  let activeCount = allExisting.length;
  if (userId !== null) {
    const countQuery = intelligenceDb
      .from("ai_memories")
      .select("*", { count: "exact", head: true })
      .eq("id_workspace", workspaceId)
      .eq("flag_active", 1)
      .eq("type_scope", "private")
      .eq("user_memory", userId);
    const { count } = await countQuery;
    activeCount = count || 0;
  }
  let slotsAvailable = Math.max(0, 50 - activeCount);

  for (const candidate of candidates) {
    const similar = findSimilarMemories(candidate.content, allExisting);

    let action: ConsolidationAction;
    if (similar.length === 0) {
      if (slotsAvailable > 0) {
        action = { action: "ADD" as const };
      } else {
        console.log(`[Memory] Skipped (no slots): "${candidate.content.slice(0, 60)}..."`);
        result.skipped++;
        continue;
      }
    } else {
      action = await classifyMemoryAction(candidate, similar);
    }

    if (action.action === "ADD" && slotsAvailable <= 0) {
      console.log(`[Memory] Skipped ADD (no slots): "${candidate.content.slice(0, 60)}..."`);
      result.skipped++;
      continue;
    }

    const applied = await applyConsolidationAction(
      action,
      candidate,
      workspaceId,
      userId,
      scope,
      sourceId,
      typeSource
    );

    if (applied) {
      result.memories.push(applied);
      switch (applied.action) {
        case "ADD": result.added++; slotsAvailable--; break;
        case "REINFORCE": result.reinforced++; break;
        case "UPDATE": result.updated++; break;
        case "CONTRADICT": result.contradicted++; break;
      }
    } else {
      result.skipped++;
    }
  }

  const total = result.added + result.reinforced + result.updated + result.contradicted;
  if (total > 0) {
    console.log(`[Memory] Pipeline: ${candidates.length} candidate(s) → ${total} action(s) [+${result.added} ↑${result.reinforced} ✎${result.updated} ✗${result.contradicted} ○${result.skipped}]`);
  }

  // ── Auto-archive stale memories ──
  // Memories whose decayed strength has dropped below 0.10 are no longer
  // useful and should be archived to free up slots for new, relevant ones.
  // This runs after every consolidation pass as a lightweight cleanup.
  try {
    const staleIds: string[] = [];
    for (const mem of allExisting) {
      const decayed = computeDecayedStrength({
        score_strength: mem.strength,
        date_last_accessed: mem.dateLastAccessed,
        type_category: mem.category,
        type_source: mem.source,
        count_reinforced: mem.reinforcedCount,
      });
      if (decayed < 0.10) {
        staleIds.push(mem.id);
      }
    }

    if (staleIds.length > 0) {
      await intelligenceDb
        .from("ai_memories")
        .update({ flag_active: 0 })
        .in("id_memory", staleIds);
      console.log(`[Memory] Auto-archived ${staleIds.length} stale memories (decayed strength < 10%)`);
    }
  } catch (err) {
    // Non-critical — don't let cleanup errors break the pipeline
    console.error("[Memory] Auto-archive failed:", err);
  }

  return result;
}
