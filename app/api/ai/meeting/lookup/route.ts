import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { queryEngine } from "@/lib/ai/providers";
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

const LOOKUP_SYSTEM = `You are a silent meeting copilot for a content agency. Below is the tail of a live meeting transcript and the client's real workspace data. Decide which ONE data category best answers what was just asked/discussed, and write a natural one-sentence insight grounded in the REAL numbers.

Categories: "contract" (contracts/commercials/CUs/budget/renewal), "pipeline" (content in production/published), "meetings" (what was agreed / last discussion / commitments), "content" (examples of past work), "none" (nothing relevant).

Return STRICT JSON: {"category": "...", "insight": "one natural sentence using the real figures, max ~25 words"}. If category is "none", insight is "". Return ONLY the JSON.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { sessionId, enrich, utterances } = body || {};
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
    if (!clientId) {
      return NextResponse.json({ card: null, note: "No client linked to this meeting — pick a client to look up their data." });
    }

    // Parallel fetch — all fast, client-scoped
    const [contracts, pipeline, meetings, content, client] = await Promise.all([
      queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "contracts_summary", undefined, undefined, clientId),
      queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "pipeline_summary", undefined, undefined, clientId),
      intelligenceDb.from("ai_client_meetings").select("meeting_title, meeting_date, meeting_summary, next_steps").eq("id_workspace", ms.id_workspace).eq("id_client", clientId).order("meeting_date", { ascending: false }).limit(3),
      supabase.from("app_content").select("name_content, type_content, date_created").eq("id_client", clientId).eq("flag_completed", 1).order("date_created", { ascending: false }).limit(15),
      supabase.from("app_clients").select("name_client").eq("id_client", clientId).maybeSingle(),
    ]);
    const clientName = (client as any)?.data?.name_client || "the client";

    const dataForLlm = {
      contracts: contracts.summary || (Array.isArray(contracts.data) ? contracts.data.slice(0, 3) : null),
      pipeline: pipeline.data || null, // pipeline_summary aggregate lives on .data, not .summary
      recent_meetings: ((meetings as any)?.data || []).map((m: any) => ({ title: m.meeting_title, date: m.meeting_date?.slice(0, 10), next_steps: (m.next_steps || "").slice(0, 300) })),
      recent_content: ((content as any)?.data || []).slice(0, 8).map((c: any) => ({ name: c.name_content, type: c.type_content })),
    };

    const res = await xai.chat.completions.create({
      model: API_MODEL,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        { role: "system", content: LOOKUP_SYSTEM },
        { role: "user", content: `Client: ${clientName}\n\nTranscript tail:\n${utterances.map((u: string) => String(u).slice(0, 400)).join("\n").slice(0, 2500)}\n\nData:\n${JSON.stringify(dataForLlm).slice(0, 5000)}` },
      ],
    });
    logAiUsage({ workspaceId: ms.id_workspace, userId, model: MODEL, source: "engineai-meeting", inputTokens: res.usage?.prompt_tokens || 0, outputTokens: res.usage?.completion_tokens || 0 });

    const raw = res.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { category: "none", insight: "" };
    const cat = parsed.category;
    const insight = String(parsed.insight || "").slice(0, 240);
    if (cat === "none" || !insight) {
      return NextResponse.json({ card: null });
    }

    // Build the card body from the chosen category's real data
    let card: any = null;
    if (cat === "contract") {
      const hasC = Array.isArray(contracts.data) && contracts.data.length > 0;
      card = {
        kind: "commercial_context",
        title: `Commercials — ${clientName}`,
        insight,
        body: hasC ? { contracts: contracts.data.slice(0, 4), summary: contracts.summary || null } : { none: true, clientName },
        receipt: hasC ? { record_type: "app_contracts", label: contracts.data[0]?.name_contract || "Active contract" } : { label: `No active contracts on file for ${clientName}` },
      };
    } else if (cat === "pipeline") {
      card = { kind: "deck_pipeline", title: `Pipeline — ${clientName}`, insight, body: { summary: pipeline.data }, receipt: { record_type: "app_content", label: "Content pipeline" } };
    } else if (cat === "meetings") {
      card = { kind: "commitment_memory", title: `Last meetings — ${clientName}`, insight, body: { meetings: dataForLlm.recent_meetings.map((m2: any) => ({ title: m2.title, date: m2.date, next_steps: m2.next_steps })) }, receipt: { record_type: "ai_client_meetings", meeting_title: dataForLlm.recent_meetings[0]?.title, meeting_date: dataForLlm.recent_meetings[0]?.date } };
    } else if (cat === "content") {
      card = { kind: "content_receipts", title: `Engine work — ${clientName}`, insight, body: { examples: dataForLlm.recent_content.slice(0, 3).map((c: any) => ({ name: c.name, type: c.type, client: clientName })) }, receipt: { record_type: "app_content", label: `${dataForLlm.recent_content.length} recent pieces` } };
    }
    if (!card) return NextResponse.json({ card: null });

    // Log it (source 'manual')
    const { data: ins } = await intelligenceDb.from("ai_meeting_cards").insert({
      id_session: sessionId,
      kind_card: card.kind,
      source_card: "manual",
      name_title: card.title,
      document_body: card.body,
      document_receipt: card.receipt,
      trigger_pattern: "manual_lookup",
      state_card: "shown",
      date_shown: new Date().toISOString(),
    }).select("id_card").single();

    return NextResponse.json({ card: { ...card, id: ins?.id_card || null } });
  } catch (err: any) {
    console.error("[MeetingLookup] Failed:", err.message);
    return NextResponse.json({ card: null, error: "Lookup failed" }, { status: 200 });
  }
}
