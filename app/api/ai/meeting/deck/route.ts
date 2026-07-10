import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { queryEngine } from "@/lib/ai/providers";

export const maxDuration = 30;

// POST /api/ai/meeting/deck — compile the pre-meeting card deck + T1 trigger
// specs for an EngineAI Live session.
//
// Everything here is LLM-free (indexed, client_id-scoped queries) so the deck
// compiles in well under a second and the resulting cards can be surfaced
// instantly (<500ms) when a T1 trigger fires — the cards are already in the
// companion window's memory.
//
// Trigger specs follow the query-router precedent (lib/ai/query-router.ts):
// compiled regex lexicons, zero cost per utterance. `target: "deck"` cards
// render from cache; `target: "t2"` escalates to /api/ai/meeting/triggers
// (LLM keyword extraction + live retrieval — content receipts only).

interface TriggerSpec {
  id: string;
  kind: string;
  patterns: string[];
  target: "deck" | "t2";
  cardKey?: string;
  title?: string; // override title when surfacing (e.g. "Scope check")
  cooldownMs: number;
  priority: number;
}

const BASE_TRIGGERS: TriggerSpec[] = [
  {
    id: "commercial",
    kind: "commercial_context",
    patterns: [
      "\\b(price|pricing|cost|costs|rate|rates|budget|invoice|invoicing|renewal|renew|retainer|commissions?|how much)\\b",
      "\\b(CUs?|content units?|remaining units|units left|utilisation|utilization)\\b",
    ],
    target: "deck",
    cardKey: "contract",
    cooldownMs: 180_000,
    priority: 2,
  },
  {
    id: "scope",
    kind: "scope_guard",
    patterns: [
      "\\b(\\d+|another|extra|additional|more|couple of|few)\\s+(more\\s+)?(videos?|reels?|posts?|articles?|shoots?|assets?|pieces?|blogs?|newsletters?)\\b",
      "\\b(on top of|beyond the (scope|contract|retainer)|out of scope|extend the (scope|contract)|increase the (scope|retainer))\\b",
    ],
    target: "deck",
    cardKey: "contract",
    title: "Scope check",
    cooldownMs: 300_000,
    priority: 4,
  },
  {
    id: "commitment",
    kind: "commitment_memory",
    patterns: [
      "\\b(last (time|meeting|call)|we (agreed|said|discussed|decided)|you (said|promised|committed)|as discussed|didn'?t we (say|agree)|what did we (agree|say|decide))\\b",
    ],
    target: "deck",
    cardKey: "last_meeting",
    cooldownMs: 120_000,
    priority: 3,
  },
  {
    id: "receipts",
    kind: "content_receipts",
    patterns: [
      "\\b(have you (done|made|created|worked on)|can you show|show (me|us) (some )?examples?|examples? of|something (like|similar)|similar (work|projects?|content|campaigns?)|case stud(y|ies)|portfolio|done (anything|something) (like|similar))\\b",
    ],
    target: "t2",
    cooldownMs: 180_000,
    priority: 2,
  },
];

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
  const { sessionId } = body || {};
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const { data: meetingSession } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_workspace, id_client, consent_attested_by, name_title")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!meetingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = meetingSession.id_client;
  const started = Date.now();

  try {
    const cards: any[] = [];

    if (clientId) {
      const [contracts, pipeline, meetings, client] = await Promise.all([
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "contracts_summary", undefined, undefined, clientId),
        queryEngine(undefined, undefined, undefined, undefined, undefined, undefined, "pipeline_summary", undefined, undefined, clientId),
        intelligenceDb
          .from("ai_client_meetings")
          .select("meeting_title, meeting_date, meeting_summary, key_topics, next_steps, attendees_external")
          .eq("id_workspace", meetingSession.id_workspace)
          .eq("id_client", clientId)
          .order("meeting_date", { ascending: false })
          .limit(3),
        // Client display name for card titles
        (await import("@/lib/supabase")).supabase
          .from("app_clients")
          .select("name_client")
          .eq("id_client", clientId)
          .maybeSingle(),
      ]);

      const clientName = (client as any)?.data?.name_client || "client";

      if (!contracts.error && Array.isArray(contracts.data) && contracts.data.length > 0) {
        cards.push({
          kind: "deck_contract",
          key: "contract",
          title: `Commercials — ${clientName}`,
          body: {
            contracts: contracts.data.slice(0, 4),
            summary: contracts.summary || null,
          },
          receipt: {
            record_type: "app_contracts",
            record_id: String(contracts.data[0]?.id_contract ?? ""),
            label: contracts.data[0]?.name_contract || "Active contract",
          },
        });
      }

      if (!pipeline.error && pipeline.summary) {
        cards.push({
          kind: "deck_pipeline",
          key: "pipeline",
          title: `Pipeline — ${clientName}`,
          body: { summary: pipeline.summary },
          receipt: { record_type: "app_content", label: "Content pipeline" },
        });
      }

      const meetingRows = (meetings as any)?.data || [];
      if (meetingRows.length > 0) {
        cards.push({
          kind: "deck_last_meeting",
          key: "last_meeting",
          title: `Last meetings — ${clientName}`,
          body: {
            meetings: meetingRows.map((m: any) => ({
              title: m.meeting_title,
              date: m.meeting_date?.slice(0, 10),
              summary: (m.meeting_summary || "").slice(0, 400),
              next_steps: (m.next_steps || "").slice(0, 600),
              attendees: m.attendees_external || null,
            })),
          },
          receipt: {
            record_type: "ai_client_meetings",
            meeting_title: meetingRows[0].meeting_title,
            meeting_date: meetingRows[0].meeting_date?.slice(0, 10),
          },
        });
      }
    }

    // Persist compiled deck rows (state 'compiled') — the trigger log starts here
    let dbCards: any[] = [];
    if (cards.length > 0) {
      const { data: inserted, error: insErr } = await intelligenceDb
        .from("ai_meeting_cards")
        .insert(
          cards.map((c) => ({
            id_session: sessionId,
            kind_card: c.kind,
            source_card: "deck",
            name_title: c.title,
            document_body: c.body,
            document_receipt: c.receipt,
            state_card: "compiled",
          }))
        )
        .select("id_card, kind_card");
      if (insErr) console.error("[MeetingDeck] Card insert failed:", insErr.message);
      dbCards = inserted || [];
    }

    // Attach DB ids back to the client payload
    const withIds = cards.map((c) => ({
      ...c,
      id: dbCards.find((d) => d.kind_card === c.kind)?.id_card || null,
    }));

    // Trigger specs: only include deck-targeted triggers whose card exists;
    // t2 triggers always ship (they retrieve live).
    const availableKeys = new Set(cards.map((c) => c.key));
    const triggerSpecs = BASE_TRIGGERS.filter(
      (t) => t.target === "t2" || (t.cardKey && availableKeys.has(t.cardKey))
    );

    return NextResponse.json({
      cards: withIds,
      triggerSpecs,
      compiledMs: Date.now() - started,
    });
  } catch (err: any) {
    console.error("[MeetingDeck] Failed:", err.message);
    return NextResponse.json({ error: "Could not compile the meeting deck" }, { status: 500 });
  }
}
