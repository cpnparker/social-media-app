import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai/usage-logger";

export const maxDuration = 30;

// POST /api/ai/meeting/triggers — T2 tier of the EngineAI Live trigger engine.
//
// The client sends batches of finalised utterances that primed a T1 lexicon
// requiring semantic work (currently: content-receipts — "have you done
// something like this?"). This route classifies the batch with grok-4-1-fast
// (cheapest capable model), extracts the subject, retrieves live workspace
// data, and returns fully assembled cards. Utterance batches are processed IN
// MEMORY and never persisted (ephemeral-by-design).
const T2_MODEL = "grok-4-1-fast";
const T2_API_MODEL = "grok-4-1-fast-non-reasoning";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set");
  return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
}

const CLASSIFY_PROMPT = `You classify short snippets of a live business meeting for a content-production agency, to decide if a "content examples" card should surface.

Return STRICT JSON: {"relevant": boolean, "confidence": 0-1, "keywords": ["1-3 search terms describing the kind of work being asked about"]}.

Set relevant=true ONLY when someone is asking whether similar work exists / to see examples / for a portfolio or case study of a specific KIND of content (a format, industry, platform, or campaign type). Set relevant=false for generic chatter, pricing talk, or scheduling. Keywords should be concrete nouns an agency would tag content with (e.g. "drone", "hotel", "reel", "case study", "LinkedIn"). Return ONLY the JSON.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { sessionId, utterances } = body || {};
  if (!sessionId || !Array.isArray(utterances) || utterances.length === 0) {
    return NextResponse.json({ error: "sessionId and utterances[] are required" }, { status: 400 });
  }

  const { data: meetingSession } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_workspace, id_client, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!meetingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const text = utterances
      .map((u: any) => String(u.text || "").slice(0, 500))
      .join("\n")
      .slice(0, 4000);

    const xai = getXAIClient();
    const res = await xai.chat.completions.create({
      model: T2_API_MODEL,
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        { role: "user", content: text },
      ],
    });
    logAiUsage({
      workspaceId: meetingSession.id_workspace,
      userId,
      model: T2_MODEL,
      source: "engineai-meeting",
      inputTokens: res.usage?.prompt_tokens || 0,
      outputTokens: res.usage?.completion_tokens || 0,
    });

    const raw = res.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { relevant: false };

    if (!parsed.relevant || (parsed.confidence ?? 0) < 0.5 || !Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
      return NextResponse.json({ cards: [] });
    }

    // Live retrieval: id_client-scoped content matching the extracted keywords
    const keywords: string[] = parsed.keywords.slice(0, 3).map((k: string) => String(k).slice(0, 40));
    let q = supabase
      .from("app_content")
      .select("id_content, name_content, type_content, name_client, date_created, name_topic_array, name_campaign_array, information_platform")
      .eq("flag_completed", 1)
      .order("date_created", { ascending: false })
      .limit(100);
    if (meetingSession.id_client) q = q.eq("id_client", meetingSession.id_client);

    const { data: rows } = await q;
    const ors = keywords.map((k) => k.toLowerCase());
    const scored = (rows || [])
      .map((r: any) => {
        const hay = `${r.name_content} ${r.type_content} ${r.name_topic_array} ${r.name_campaign_array} ${r.information_platform}`.toLowerCase();
        const hits = ors.filter((k) => hay.includes(k)).length;
        return { r, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3)
      .map((x) => x.r);

    if (scored.length === 0) {
      return NextResponse.json({ cards: [] });
    }

    const clientName = scored[0].name_client || "";
    const card = {
      kind: "content_receipts",
      title: `Engine receipts: ${keywords.join(", ")}`,
      body: {
        examples: scored.map((r: any) => ({
          name: r.name_content,
          type: r.type_content,
          client: r.name_client,
          date: r.date_created?.slice(0, 10),
        })),
      },
      receipt: {
        record_type: "app_content",
        record_id: String(scored[0].id_content),
        label: `${scored.length} example${scored.length > 1 ? "s" : ""}${clientName ? ` · ${clientName}` : ""}`,
      },
    };

    // Log the fired card (source t2)
    const { data: ins } = await intelligenceDb
      .from("ai_meeting_cards")
      .insert({
        id_session: sessionId,
        kind_card: card.kind,
        source_card: "t2",
        name_title: card.title,
        document_body: card.body,
        document_receipt: card.receipt,
        trigger_pattern: keywords.join(","),
        state_card: "shown",
        date_shown: new Date().toISOString(),
      })
      .select("id_card")
      .single();

    return NextResponse.json({ cards: [{ ...card, id: ins?.id_card || null }] });
  } catch (err: any) {
    console.error("[MeetingTriggers] Failed:", err.message);
    return NextResponse.json({ cards: [], error: "Trigger evaluation failed" }, { status: 200 });
  }
}
