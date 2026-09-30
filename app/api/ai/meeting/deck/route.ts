import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { queryEngine, queryMeetingBrain, localDay } from "@/lib/ai/providers";

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
      // Contracts / commercials — the most common ask ("what contracts do we
      // have", "status of the latest contract"). Bare "contract" was the gap.
      "\\b(contract|contracts|contracted|agreement|agreements|retainer|retainers|deal|deals|sow|statement of work|deliverables?|scope of work)\\b",
      // Pricing / money
      "\\b(price|pricing|cost|costs|rate|rates|budget|budgets|invoice|invoicing|renewal|renew|renews|commissions?|commercials?|fees?|spend|how much)\\b",
      // Units / delivery volume
      "\\b(CUs?|content units?|remaining units|units left|units remaining|utilisation|utilization|how many (videos?|posts?|units?|reels?|articles?))\\b",
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
    id: "pipeline",
    kind: "deck_pipeline",
    patterns: [
      "\\b(pipeline|content pipeline|in production|in progress|what have we (done|made|produced|delivered|published|created)|how much (content|work) have we|status of (the )?(content|work|production|pipeline)|what('| i)?s (in|on) (the )?(pipeline|go|schedule))\\b",
    ],
    target: "deck",
    cardKey: "pipeline",
    cooldownMs: 180_000,
    priority: 1,
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
  // MeetingBrain scopes every personal report by the caller's own email —
  // that RPC-level p_user_email check IS the access boundary for the enrich
  // below, so a user cannot pull a meeting they were not part of.
  const userEmail = session.user.email || "";

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
    .select("id_session, id_workspace, id_client, consent_attested_by, name_title, mb_meeting_id")
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

      // Always compile a contract card when a client is set — even "no active
      // contracts on file" is a useful live answer to "do we have a contract?".
      const hasContracts = !contracts.error && Array.isArray(contracts.data) && contracts.data.length > 0;
      cards.push({
        kind: "deck_contract",
        key: "contract",
        title: `Commercials — ${clientName}`,
        body: hasContracts
          ? { contracts: contracts.data.slice(0, 4), summary: contracts.summary || null }
          : { none: true, clientName },
        receipt: hasContracts
          ? {
              record_type: "app_contracts",
              record_id: String(contracts.data[0]?.id_contract ?? ""),
              label: contracts.data[0]?.name_contract || "Contract on file",
            }
          : { label: `No active contracts on file for ${clientName}` },
      });

      // pipeline_summary returns its aggregate on `.data` (not `.summary`, which
      // only contracts_summary/social_performance set) — gate on the right field
      // or the pipeline card + its T1 trigger silently never compile.
      if (!pipeline.error && pipeline.data) {
        cards.push({
          kind: "deck_pipeline",
          key: "pipeline",
          title: `Pipeline — ${clientName}`,
          body: { summary: pipeline.data },
          receipt: { record_type: "app_content", label: "Content pipeline" },
        });
      }

      // Prefer MeetingBrain when the session was launched from it. The local
      // ai_client_meetings mirror is READ-ONLY in this codebase — every
      // reference is a SELECT and nothing writes it — so on its own the
      // "last time we agreed…" card answers from a table that may never have
      // been populated. mb_meeting_id was previously written at session
      // create and never read by anything.
      let meetingRows = (meetings as any)?.data || [];
      const mbId = (meetingSession as any).mb_meeting_id;
      if (mbId && userEmail) {
        try {
          const det = await queryMeetingBrain("meeting_details", userEmail, {
            meetingId: String(mbId),
            visibility: "private",
          });
          const d: any = det?.data;
          if (d && !Array.isArray(d) && (d.summary || d.next_steps || (Array.isArray(d.tasks) && d.tasks.length))) {
            meetingRows = [{
              meeting_title: d.title,
              meeting_date: d.date,
              meeting_summary: d.summary || d.external_summary || "",
              key_topics: d.key_topics || null,
              next_steps: d.next_steps || "",
              attendees_external: null,
              // Derived lines only — never transcript passages into a card body.
              mb_tasks: Array.isArray(d.tasks)
                ? d.tasks.slice(0, 6).map((t: any) => String(t?.title || "").slice(0, 160)).filter(Boolean)
                : [],
              // Marks this row as MeetingBrain-derived so the persistence
              // step below can refuse to write it to disk.
              _mbDerived: true,
            }, ...meetingRows];
          }
        } catch (e: any) {
          console.warn("[Deck] MeetingBrain enrich failed:", e?.message);
        }
      }
      if (meetingRows.length > 0) {
        cards.push({
          kind: "deck_last_meeting",
          key: "last_meeting",
          title: `Last meetings — ${clientName}`,
          body: {
            meetings: meetingRows.map((m: any) => ({
              title: m.meeting_title,
              date: localDay(m.meeting_date),
              summary: (m.meeting_summary || "").slice(0, 400),
              next_steps: (m.next_steps || "").slice(0, 600),
              attendees: m.attendees_external || null,
              tasks: Array.isArray(m.mb_tasks) ? m.mb_tasks : undefined,
            })),
            _mbDerived: meetingRows.some((m: any) => m._mbDerived) || undefined,
          },
          receipt: {
            record_type: "ai_client_meetings",
            meeting_title: meetingRows[0].meeting_title,
            meeting_date: localDay(meetingRows[0].meeting_date),
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
            // MeetingBrain-derived bodies are NOT written to disk. The card is
            // still returned to the host in this response and shown live — but
            // persisting it put MeetingBrain's summary, next steps and task
            // titles into intelligence.ai_meeting_cards, where nothing deletes
            // them: "Discard" only flips status_session, so the user was told
            // "nothing was saved" while a copy of a meeting record stayed on
            // disk, outside MeetingBrain's own retention controls. A stub keeps
            // the trigger log honest without keeping the content.
            document_body: (c.body as any)?._mbDerived
              ? { mb: true, note: "MeetingBrain-derived — shown live, deliberately not persisted" }
              : c.body,
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
