import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { queryEngine, queryMeetingBrain, searchMemory } from "@/lib/ai/providers";
import { logAiUsage } from "@/lib/ai/usage-logger";

export const maxDuration = 30;

// POST /api/ai/meeting/lookup — the natural-insight engine for EngineAI Live.
//
// Two modes:
//   ENRICH  { sessionId, enrich: { kind, data, utterance } }
//     → one grok-4-1-fast call writes a natural, conversation-aware insight
//       sentence grounded in the card's real numbers. Returns { insight }.
//       Used to upgrade an auto-fired card so it reads like an observation,
//       not a data dump.
//
//   LOOKUP  { sessionId, utterances: string[] }
//     → the manual safety net ("Look up last point"): parallel-fetches the
//       client's real data (contracts, pipeline, recent meetings, content),
//       then one grok call picks the relevant category and writes the insight.
//       Returns { card } (or { card: null }).
const MODEL = "grok-4-1-fast";
const API_MODEL = "grok-4-1-fast-non-reasoning";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set");
  return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
}

const ENRICH_SYSTEM = `You are a silent meeting copilot for a content agency. A data card is about to be shown to the user (NOT spoken aloud) during a live meeting. Using the recent conversation and the client's background, write ONE short, natural sentence (max ~22 words) that frames the card's REAL figures AND why they matter right now — like a sharp colleague leaning over and pointing. If the card shows a gap (e.g. no contract on file), say what's worth checking. No greeting, no preamble, no "here's". Return ONLY the sentence.`;

const LOOKUP_SYSTEM = `You are a silent meeting copilot for a content agency. Below is the tail of a live meeting transcript and real workspace data (scoped to one client, or workspace-wide across all clients — the scope is stated). Decide which ONE data category best answers what was just asked/discussed, and write a natural one-sentence insight grounded in the REAL numbers.

Categories: "units" (how many content units commissioned/produced this month/period), "contract" (contracts/commercials/CU budgets/renewals), "pipeline" (content in production/published), "meetings" (what was agreed / last discussion / commitments), "content" (examples of past work), "tasks" (the user's open action items / things they committed to — useful in 1:1s and team catch-ups), "memory" (saved workspace knowledge: notes about people, development ideas, past decisions, company facts), "client_snapshot" (a specific client was just mentioned by name — their own contract/pipeline/units snapshot; only when mentioned_client data is present), "none" (nothing relevant). The meeting may be an INTERNAL one (a 1:1, team catch-up) — tasks/memory are often the useful pick there. Only choose a category whose data is actually present below.

IMPORTANT: in a normal conversation MOST moments do not need a card — "none" is the correct answer unless the participants are clearly asking about, or would clearly benefit from, this specific data RIGHT NOW. Never force a category just because data exists; a card that restates numbers nobody asked about is noise. Discussion of strategy, people, roles, pricing IDEAS, or tools usually warrants "none".

Return STRICT JSON: {"category": "...", "confidence": 0-1, "insight": "one natural sentence using the real figures, max ~25 words"}. confidence = how clearly the transcript calls for THIS data. If category is "none", insight is "". Return ONLY the JSON.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { sessionId, enrich, utterances, auto, context, clientHint } = body || {};
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

  const { data: ms } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_workspace, id_client, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!ms) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (ms.consent_attested_by !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const xai = getXAIClient();

  try {
    // ── ENRICH mode ──────────────────────────────────────────────
    if (enrich && enrich.kind) {
      const who = enrich.clientName ? `Client: ${String(enrich.clientName).slice(0, 80)}\n` : "";
      const bg = enrich.linkedContext ? `Background: ${String(enrich.linkedContext).slice(0, 1200)}\n\n` : "";
      const tail = Array.isArray(enrich.tail) && enrich.tail.length
        ? `Recent conversation:\n${enrich.tail.map((t: string) => String(t).slice(0, 300)).join("\n").slice(0, 1500)}\n\n`
        : (enrich.utterance ? `Someone said: "${String(enrich.utterance).slice(0, 400)}"\n\n` : "");
      const res = await xai.chat.completions.create({
        model: API_MODEL,
        temperature: 0.3,
        max_tokens: 70,
        messages: [
          { role: "system", content: ENRICH_SYSTEM },
          { role: "user", content: `${who}${bg}${tail}Card (${enrich.kind}) data:\n${JSON.stringify(enrich.data).slice(0, 2000)}` },
        ],
      });
      logAiUsage({ workspaceId: ms.id_workspace, userId, model: MODEL, source: "engineai-meeting", inputTokens: res.usage?.prompt_tokens || 0, outputTokens: res.usage?.completion_tokens || 0 });
      const insight = (res.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "").slice(0, 240);
      return NextResponse.json({ insight });
    }

    // ── LOOKUP mode (manual safety net) ─────────────────────────
    if (!Array.isArray(utterances) || utterances.length === 0) {
      return NextResponse.json({ error: "utterances[] required for lookup" }, { status: 400 });
    }
    const clientId = ms.id_client;
    const monthStart = new Date().toISOString().slice(0, 8) + "01";

    // Client-scoped when the meeting is linked; WORKSPACE-WIDE otherwise —
    // analytical asks like "how many CU have we commissioned this month?"
    // must get an answer either way (this used to dead-end with a
    // "no client linked" note).
    let clientName = "all clients";
    let recentMeetings: any[] = [];
    let recentContent: any[] = [];
    let contracts: any, pipeline: any, unitsRes: any;

    if (clientId) {
      const [c, p, u, meetings, content, client] = await Promise.all([
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "contracts_summary", undefined, undefined, clientId),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "pipeline_summary", undefined, undefined, clientId),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "commissioned_units", monthStart, undefined, clientId),
        intelligenceDb.from("ai_client_meetings").select("meeting_title, meeting_date, meeting_summary, next_steps").eq("id_workspace", ms.id_workspace).eq("id_client", clientId).order("meeting_date", { ascending: false }).limit(3),
        supabase.from("app_content").select("name_content, type_content, date_created").eq("id_client", clientId).eq("flag_completed", 1).order("date_created", { ascending: false }).limit(15),
        supabase.from("app_clients").select("name_client").eq("id_client", clientId).maybeSingle(),
      ]);
      contracts = c; pipeline = p; unitsRes = u;
      clientName = (client as any)?.data?.name_client || "the client";
      recentMeetings = ((meetings as any)?.data || []).map((m: any) => ({ title: m.meeting_title, date: m.meeting_date?.slice(0, 10), next_steps: (m.next_steps || "").slice(0, 300) }));
      recentContent = ((content as any)?.data || []).slice(0, 8).map((c2: any) => ({ name: c2.name_content, type: c2.type_content }));
    } else {
      const [c, p, u] = await Promise.all([
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "contracts_summary", undefined, undefined, undefined),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "pipeline_summary", undefined, undefined, undefined),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "commissioned_units", monthStart, undefined, undefined),
      ]);
      contracts = c; pipeline = p; unitsRes = u;
    }

    const unitsThisMonth = {
      period_start: monthStart,
      total_cu_commissioned: unitsRes?.total ?? 0,
      by_client: Array.isArray(unitsRes?.data) ? unitsRes.data.slice(0, 15) : [],
    };

    // General context — makes Live useful in INTERNAL meetings (1:1s, team
    // catch-ups), not just client calls: the user's open action items
    // (MeetingBrain, email-scoped) + workspace memory notes matching what's
    // being discussed (people notes, development ideas, decisions).
    const userEmail = session.user?.email || "";
    const memQuery = utterances.slice(-2).map((u: string) => String(u)).join(" ").slice(0, 300);
    const [mbTasks, memoryHits] = await Promise.all([
      userEmail
        ? queryMeetingBrain("my_tasks", userEmail, {}).catch(() => ({ data: [], count: 0 }))
        : Promise.resolve({ data: [], count: 0 } as any),
      memQuery
        ? searchMemory(memQuery, "memories", ms.id_workspace, userId).catch(() => ({ memories: [] } as any))
        : Promise.resolve({ memories: [] } as any),
    ]);
    const openTasks = (Array.isArray((mbTasks as any).data) ? (mbTasks as any).data : [])
      .slice(0, 8)
      .map((t: any) => ({ title: t.title, deadline: t.deadline, responsible: t.responsible, from_meeting: t.from_meeting }));
    const memNotes = (((memoryHits as any).memories || []) as any[])
      .slice(0, 5)
      .map((m: any) => ({ content: String(m.content || "").slice(0, 220), category: m.category, date: m.date }));

    const dataForLlm: any = {
      units_commissioned_this_month: unitsThisMonth,
      contracts: contracts.summary || (Array.isArray(contracts.data) ? contracts.data.slice(0, 3) : null),
      pipeline: pipeline.data || null, // pipeline_summary aggregate lives on .data, not .summary
    };
    if (clientId) {
      dataForLlm.recent_meetings = recentMeetings;
      dataForLlm.recent_content = recentContent;
    }
    if (openTasks.length) dataForLlm.open_action_items = openTasks;
    if (memNotes.length) dataForLlm.workspace_memory_notes = memNotes;

    // A client mentioned by NAME in the conversation (client-side matcher) —
    // lets e.g. "UBS want 80 campaign videos" in an internal 1:1 surface a
    // UBS-scoped snapshot instead of a workspace-wide dump.
    let mentionedClient: any = null;
    const hintId = clientHint?.id ? parseInt(String(clientHint.id), 10) : NaN;
    if (Number.isFinite(hintId) && hintId !== (clientId || 0)) {
      const [hc, hp, hu] = await Promise.all([
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "contracts_summary", undefined, undefined, hintId),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "pipeline_summary", undefined, undefined, hintId),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "commissioned_units", monthStart, undefined, hintId),
      ]);
      mentionedClient = {
        name: String(clientHint.name || "client").slice(0, 80),
        contracts: Array.isArray(hc.data) ? hc.data.slice(0, 2) : [],
        contracts_summary: hc.summary || null,
        pipeline: hp.data || null,
        cu_commissioned_this_month: hu?.total ?? 0,
      };
      dataForLlm.mentioned_client = mentionedClient;
    }

    const res = await xai.chat.completions.create({
      model: API_MODEL,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        { role: "system", content: LOOKUP_SYSTEM },
        { role: "user", content: `Scope: ${clientId ? `Client — ${clientName}` : "Workspace-wide (all clients)"}\n\n${context ? `Meeting background (from setup — may describe an internal 1:1 or catch-up):\n${String(context).slice(0, 1200)}\n\n` : ""}Transcript tail:\n${utterances.map((u: string) => String(u).slice(0, 400)).join("\n").slice(0, 2500)}\n\nData:\n${JSON.stringify(dataForLlm).slice(0, 5000)}` },
      ],
    });
    logAiUsage({ workspaceId: ms.id_workspace, userId, model: MODEL, source: "engineai-meeting", inputTokens: res.usage?.prompt_tokens || 0, outputTokens: res.usage?.completion_tokens || 0 });

    const raw = res.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { category: "none", insight: "" };
    const cat = parsed.category;
    const insight = String(parsed.insight || "").slice(0, 240);
    // Relevance gate — grok tends to pick SOMETHING because workspace data is
    // always present; low-confidence picks are noise, not help.
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0.7;
    if (cat === "none" || !insight || conf < 0.6) {
      return NextResponse.json({ card: null });
    }

    // Build the card body from the chosen category's real data
    let card: any = null;
    if (cat === "units") {
      card = {
        kind: "units_summary",
        title: `Commissioned this month — ${clientName}`,
        insight,
        body: {
          summary: { total_cu: unitsThisMonth.total_cu_commissioned, period_start: monthStart },
          by_client: unitsThisMonth.by_client.slice(0, 5),
        },
        receipt: { record_type: "app_tasks_content", label: `Commissioned units since ${monthStart}` },
      };
    } else if (cat === "contract") {
      const hasC = Array.isArray(contracts.data) && contracts.data.length > 0;
      // Workspace scope renders the SUMMARY, never contracts[0] — the list is
      // sorted by date_end ascending, so [0] is the oldest contract and the
      // body used to contradict the insight ("Renews in -1,598d").
      card = clientId
        ? {
            kind: "commercial_context",
            title: `Commercials — ${clientName}`,
            insight,
            body: hasC ? { contracts: contracts.data.slice(0, 4), summary: contracts.summary || null } : { none: true, clientName },
            receipt: hasC ? { record_type: "app_contracts", label: contracts.data[0]?.name_contract || "Active contract" } : { label: `No active contracts on file for ${clientName}` },
          }
        : {
            kind: "commercial_context",
            title: "Commercials — all clients",
            insight,
            body: { workspace: true, summary: contracts.summary || null },
            receipt: { record_type: "app_contracts", label: `${contracts.summary?.contracts ?? 0} active contracts` },
          };
    } else if (cat === "client_snapshot" && mentionedClient) {
      const hasC = mentionedClient.contracts.length > 0;
      card = {
        kind: "commercial_context",
        title: `${mentionedClient.name} — snapshot`,
        insight,
        body: hasC
          ? { contracts: mentionedClient.contracts, summary: mentionedClient.contracts_summary }
          : { none: true, clientName: mentionedClient.name },
        receipt: { record_type: "app_contracts", label: `${mentionedClient.name} · mentioned in conversation` },
      };
    } else if (cat === "pipeline") {
      card = { kind: "deck_pipeline", title: `Pipeline — ${clientName}`, insight, body: { summary: pipeline.data }, receipt: { record_type: "app_content", label: "Content pipeline" } };
    } else if (cat === "meetings" && recentMeetings.length > 0) {
      card = { kind: "commitment_memory", title: `Last meetings — ${clientName}`, insight, body: { meetings: recentMeetings.map((m2: any) => ({ title: m2.title, date: m2.date, next_steps: m2.next_steps })) }, receipt: { record_type: "ai_client_meetings", meeting_title: recentMeetings[0]?.title, meeting_date: recentMeetings[0]?.date } };
    } else if (cat === "content" && recentContent.length > 0) {
      card = { kind: "content_receipts", title: `Engine work — ${clientName}`, insight, body: { examples: recentContent.slice(0, 3).map((c2: any) => ({ name: c2.name, type: c2.type, client: clientName })) }, receipt: { record_type: "app_content", label: `${recentContent.length} recent pieces` } };
    } else if (cat === "tasks" && openTasks.length > 0) {
      card = {
        kind: "open_tasks",
        title: "Your open action items",
        insight,
        body: { tasks: openTasks },
        receipt: { record_type: "meetingbrain_tasks", label: `${openTasks.length} open action item${openTasks.length === 1 ? "" : "s"}` },
      };
    } else if (cat === "memory" && memNotes.length > 0) {
      card = {
        kind: "memory_context",
        title: "From workspace memory",
        insight,
        body: { notes: memNotes },
        receipt: { record_type: "ai_memories", label: `${memNotes.length} saved note${memNotes.length === 1 ? "" : "s"}` },
      };
    }
    if (!card) return NextResponse.json({ card: null });

    // Log it (source 'manual')
    const { data: ins } = await intelligenceDb.from("ai_meeting_cards").insert({
      id_session: sessionId,
      kind_card: card.kind,
      source_card: auto ? "auto" : "manual",
      name_title: card.title,
      document_body: card.body,
      document_receipt: card.receipt,
      trigger_pattern: auto ? "auto_sweep" : "manual_lookup",
      state_card: "shown",
      date_shown: new Date().toISOString(),
    }).select("id_card").single();

    return NextResponse.json({ card: { ...card, id: ins?.id_card || null } });
  } catch (err: any) {
    console.error("[MeetingLookup] Failed:", err.message);
    return NextResponse.json({ card: null, error: "Lookup failed" }, { status: 200 });
  }
}
