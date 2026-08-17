/**
 * Episodic memory — what the user WORKED ON, and when.
 *
 * The existing memory system (lib/ai/memory-extraction.ts, ai_memories) is
 * entirely SEMANTIC: preferences, facts, standing instructions, client
 * insights. All of it records what is TRUE. None of it records what HAPPENED,
 * and "what was I doing last Tuesday" retrieves on a DATE, which that path has
 * no predicate for. Prior conversations were reachable only if the model chose
 * to call search_memory, and then only by ILIKE over a title and a lossy
 * summary paragraph.
 *
 * Three rules this module holds to, all of them lessons from this codebase:
 *
 *  1. NEVER ASSERT A PAST STATE AS CURRENT. Every episode carries its date and
 *     is rendered as "on 13 August you were…". A memory system that says "you
 *     are waiting on Gabi" when that closed last week is confidently wrong, and
 *     the user cannot tell from the answer.
 *  2. NEVER OVERWRITE ACROSS DAYS. A superseded episode is marked, not
 *     rewritten. Overwriting is how the record of the 6th silently becomes the
 *     record of the 13th.
 *  3. PRIVATE MEANS PRIVATE. Episodes are one person's working history and are
 *     never read into a thread with more than one reader.
 */
import { intelligenceDb } from "@/lib/supabase-intelligence";

export interface Episode {
  idEpisode: string;
  dateEpisode: string;
  worked: string;
  open: string | null;
  status: "open" | "unknown" | "resolved";
  entities: string[];
  idConversationSource: string;
}

/** How many days back the proactive ledger reaches. */
const LEDGER_DAYS = 21;
/** How many entries the ledger shows. Kept small — this is billed every turn. */
const LEDGER_LIMIT = 8;

/**
 * The user's recent episodes, for injection.
 *
 * EXCLUDES the current conversation, deliberately. The user does not need
 * telling what they are doing right now — it is in the messages above — and
 * this thread rewrites its own episode after every turn, so including it would
 * change the prompt prefix on every single turn and discard the cache each
 * time.
 *
 * It does NOT make the ledger byte-stable, and an earlier version of this
 * comment claimed it did. Two things still move it mid-conversation: an
 * episode written by a DIFFERENT conversation (a second tab, a scheduled run),
 * and the LEDGER_DAYS window rolling past midnight and dropping the oldest
 * entry. Both invalidate the cached prefix when they happen. The point of the
 * exclusion is that it removes the one source of churn that would fire on
 * EVERY turn, leaving only ones that fire rarely — which is worth having, and
 * is a smaller claim than the one it replaced.
 */
export async function recentEpisodes(
  userId: number,
  workspaceId: string,
  excludeConversationId?: string
): Promise<Episode[]> {
  const since = new Date();
  since.setDate(since.getDate() - LEDGER_DAYS);

  let q = intelligenceDb
    .from("ai_episodes")
    .select("id_episode, date_episode, information_episode, information_open, type_status, data_entities, id_conversation_source")
    .eq("user_episode", userId)
    .eq("id_workspace", workspaceId)
    .is("date_invalidated", null)
    .gte("date_episode", since.toISOString().slice(0, 10))
    .order("date_episode", { ascending: false })
    .limit(LEDGER_LIMIT);

  if (excludeConversationId) q = q.neq("id_conversation_source", excludeConversationId);

  const { data, error } = await q;
  // Fail quiet, not loud: an unavailable ledger should cost the user context,
  // never their turn. The table may also not exist yet — this ships before the
  // migration is run, and a missing relation must not break chat.
  if (error) return [];

  return (data || []).map((r: any) => ({
    idEpisode: r.id_episode,
    dateEpisode: String(r.date_episode).slice(0, 10),
    worked: r.information_episode,
    open: r.information_open || null,
    status: r.type_status || "unknown",
    entities: r.data_entities || [],
    idConversationSource: r.id_conversation_source,
  }));
}

/**
 * Render the ledger for the prompt.
 *
 * Dates are absolute, never "3 days ago" — a relative phrase computed at
 * injection time is wrong the moment the model repeats it back, and this is
 * the surface where a confident wrong date does the most damage.
 */
export function formatEpisodeLedger(episodes: Episode[]): string {
  if (episodes.length === 0) return "";

  const lines = episodes.map((e) => {
    const d = new Date(e.dateEpisode + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    const openBit = e.open ? ` — left open: ${e.open}` : "";
    return `- ${d}: ${e.worked}${openBit}`;
  });

  return (
    `\n\n## What you have been working on\n` +
    `Your recent sessions, most recent first. These are a RECORD OF THE PAST, not the current state:\n\n` +
    lines.join("\n") +
    `\n\nUse this to pick up where the user left off and to avoid asking what they already told you. ` +
    `Two rules: refer to an item BY ITS DATE ("on 13 August you were…"), never as though it were still ` +
    `true today — an open item may well have been closed since. And if the user asks about something ` +
    `you cannot see here, say the record only goes back ${LEDGER_DAYS} days rather than saying it did ` +
    `not happen.`
  );
}

/* ─────────────── Capture ─────────────── */

const EPISODE_PROMPT = `You are recording what someone WORKED ON in a conversation with their AI assistant, so they can pick it up later.

This is EPISODIC, not factual. You are not recording what is true about them or their preferences — a separate system does that. You are recording what happened in this working session.

Return JSON:
{"worked": "...", "open": "...", "entities": ["..."], "status": "open|resolved|unknown"}

- worked: what they actually did or worked through, in one sentence, past tense, under 300 chars. Concrete: "drafted a reply to Siemens about module sequencing", not "discussed a client".
- open: what was left unresolved or waiting on someone, under 200 chars, or null if nothing was.
- entities: clients, companies, people or named artefacts involved. Proper nouns only, at most 6. [] if none.
- status: "open" if something is clearly still outstanding, "resolved" if the thing was finished, "unknown" if unclear.

Return {"worked": null} if the exchange was trivial, purely conversational, or has nothing worth recalling in a week's time. Most small talk and one-off lookups qualify — be willing to record nothing.

Never include anything from a document, email or transcript the user pasted or the assistant retrieved. Record what THEY did, not what the material said.`;

export interface EpisodeCapture {
  worked: string;
  open: string | null;
  entities: string[];
  status: "open" | "unknown" | "resolved";
}

/**
 * Extract one episode from a turn. Returns null when there is nothing worth
 * recording, which is the common case and is meant to be.
 */
export async function extractEpisode(
  userMessage: string,
  assistantResponse: string
): Promise<EpisodeCapture | null> {
  try {
    // Its own client rather than importing providers.ts — that module is
    // ~10k lines and pulls in every tool definition; this runs in the
    // background after a turn has already closed.
    const OpenAI = (await import("openai")).default;
    const xai = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
    const res = await xai.chat.completions.create({
      model: "grok-4.3",
      reasoning_effort: "none",
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: EPISODE_PROMPT },
        {
          role: "user",
          content: `User:\n${userMessage.slice(0, 4000)}\n\nAssistant:\n${assistantResponse.slice(0, 4000)}`,
        },
      ],
    } as any);

    const raw = res.choices?.[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed?.worked || typeof parsed.worked !== "string") return null;

    const { logAiUsage } = await import("./usage-logger");
    logAiUsage({
      model: "grok-4-3",
      source: "episode-extract",
      inputTokens: res.usage?.prompt_tokens || 0,
      outputTokens: res.usage?.completion_tokens || 0,
    });

    return {
      worked: parsed.worked.slice(0, 300),
      open: typeof parsed.open === "string" && parsed.open ? parsed.open.slice(0, 200) : null,
      entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 6).map(String) : [],
      status: ["open", "resolved", "unknown"].includes(parsed.status) ? parsed.status : "unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Write or update today's episode for this conversation.
 *
 * One row per person per conversation per day: a long session in one thread
 * updates its episode rather than producing twenty near-identical rows. The
 * update is WITHIN a day only — yesterday's record is never touched, because
 * overwriting across days is how a memory system quietly rewrites history.
 */
export async function recordEpisode(opts: {
  workspaceId: string;
  userId: number;
  conversationId: string;
  capture: EpisodeCapture;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing, error: readErr } = await intelligenceDb
    .from("ai_episodes")
    .select("id_episode, count_turns")
    .eq("user_episode", opts.userId)
    .eq("id_conversation_source", opts.conversationId)
    .eq("date_episode", today)
    .maybeSingle();

  // A failed read here almost always means the migration has not been run.
  // Say so once, and do nothing — episodic capture is additive, and chat must
  // never depend on it.
  if (readErr) {
    console.warn("[Episodes] read failed (has scripts/add-episodic-memory.sql been run?):", readErr.message);
    return;
  }

  if (existing) {
    const { error } = await intelligenceDb
      .from("ai_episodes")
      .update({
        information_episode: opts.capture.worked,
        information_open: opts.capture.open,
        type_status: opts.capture.status,
        data_entities: opts.capture.entities,
        count_turns: (existing as any).count_turns + 1,
        date_updated: new Date().toISOString(),
      })
      .eq("id_episode", (existing as any).id_episode);
    if (error) console.warn("[Episodes] update failed:", error.message);
    return;
  }

  const { error } = await intelligenceDb.from("ai_episodes").insert({
    id_workspace: opts.workspaceId,
    user_episode: opts.userId,
    id_conversation_source: opts.conversationId,
    date_episode: today,
    information_episode: opts.capture.worked,
    information_open: opts.capture.open,
    type_status: opts.capture.status,
    data_entities: opts.capture.entities,
    type_source: "inferred",
  });
  if (error) console.warn("[Episodes] insert failed:", error.message);
}
