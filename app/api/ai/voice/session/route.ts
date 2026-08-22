import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership, hasEngineAiAccess } from "@/lib/permissions";
import { checkConversationAccess } from "@/lib/ai/access";
import {
  buildVoiceInstructions,
  getVoiceTools,
  VOICE_MODEL,
  VOICE_NAME,
  VOICE_MODEL_FALLBACK,
  VOICE_NAME_FALLBACK,
  VOICE_SAMPLE_RATE,
} from "@/lib/ai/voice";

// POST /api/ai/voice/session
// Body: { workspaceId, conversationId, customerId? }
// Mints a short-lived xAI ephemeral token and returns the full session config
// the browser needs to open the realtime WebSocket itself.
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
  const { workspaceId, conversationId, customerId } = body || {};
  if (!workspaceId || !conversationId) {
    return NextResponse.json({ error: "workspaceId and conversationId are required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.XAI_API_KEY) {
    return NextResponse.json({ error: "Voice is not configured (missing XAI_API_KEY)" }, { status: 503 });
  }

  try {
    // Conversation must exist and be accessible — voice binds to it.
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace, id_client")
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Reaching a conversation is not entitlement to run a turn against it —
    // the voice surface reaches Engine, client context, MeetingBrain and Slack
    // with the same reach as chat, so it needs the same front door.
    if (!(await hasEngineAiAccess(userId, conversation.id_workspace))) {
      return NextResponse.json(
        { error: "You do not have access to EngineAI" },
        { status: 403 }
      );
    }

    // Resolve client name for the instructions (optional) + the full roster
    // (lets the model normalize phonetic transcriptions before searching)
    const clientId = customerId ? parseInt(String(customerId), 10) : conversation.id_client || null;
    const { data: allClients } = await supabase
      .from("app_clients")
      .select("id_client, name_client")
      .limit(300);
    const clientRoster = (allClients || [])
      .map((c: any) => c.name_client)
      .filter(Boolean) as string[];
    const clientName = clientId
      ? (allClients || []).find((c: any) => c.id_client === clientId)?.name_client || null
      : null;

    // Audience must match the text pipeline and the sibling voice/tools route:
    // a "private" thread that has been SHARED, or one owned by someone else,
    // has more than one reader. Reading raw type_visibility here treated those
    // as solo and unlocked personal-scope data for a voice turn that is then
    // persisted into a thread other people read.
    const { count: shareCount, error: shareErr } = await intelligenceDb
      .from("ai_shares")
      .select("id_conversation", { count: "exact", head: true })
      .eq("id_conversation", conversation.id_conversation);
    const isTeamThread =
      conversation.type_visibility === "team" ||
      // FAIL CLOSED. supabase-js resolves a failed query as {count:null,error},
      // and `(null || 0) > 0` is false — so discarding the error turned "we
      // could not tell how many readers this thread has" into "it has one",
      // unlocking finance, personal MeetingBrain, Slack DMs and private
      // memories inside a thread other people read. Not knowing must mean
      // treating it as shared.
      shareErr != null ||
      (shareCount || 0) > 0 ||
      conversation.user_created !== userId;

    // Mint the ephemeral token (5 min TTL — covers connection setup; the
    // WebSocket session itself stays alive past token expiry).
    // Bake the voice into the session at creation so the very first response
    // can never race the client's session.update and speak in a different
    // voice ("two voices" bug). Verified 2026-06-11: xAI applies `voice` from
    // the mint body (session.created echoes it); instructions are still
    // delivered via session.update from the browser.
    const mint = (model: string, voice: string) =>
      fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { seconds: 300 },
          session: { type: "realtime", model, voice },
        }),
      });

    let activeModel = VOICE_MODEL;
    let activeVoice = VOICE_NAME;
    let mintRes = await mint(activeModel, activeVoice);

    // A model or voice name is CONFIGURATION, and configuration can be wrong —
    // both are env-overridable so they can be changed without a deploy, which
    // is exactly what makes a typo reachable. xAI rejects an unknown value with
    // a 4xx, so rather than leaving voice dead until someone notices, fall back
    // once to the known-good pair and say loudly in the logs what was rejected.
    // Not retried on 429 (credits) or 5xx (their outage) — neither is fixed by
    // a different model name.
    if (!mintRes.ok && mintRes.status >= 400 && mintRes.status < 500 && mintRes.status !== 429) {
      const why = await mintRes.text().catch(() => "");
      if (activeModel !== VOICE_MODEL_FALLBACK || activeVoice !== VOICE_NAME_FALLBACK) {
        console.error(
          `[Voice] xAI rejected model="${activeModel}" voice="${activeVoice}" (${mintRes.status}): ` +
            `${why.slice(0, 300)} — falling back to ${VOICE_MODEL_FALLBACK}/${VOICE_NAME_FALLBACK}. ` +
            `Check XAI_VOICE_MODEL / XAI_VOICE_NAME.`
        );
        activeModel = VOICE_MODEL_FALLBACK;
        activeVoice = VOICE_NAME_FALLBACK;
        mintRes = await mint(activeModel, activeVoice);
      }
    }

    if (!mintRes.ok) {
      const errText = await mintRes.text().catch(() => "");
      console.error(`[Voice] Ephemeral token mint failed (${mintRes.status}): ${errText.slice(0, 300)}`);
      // 429 from xAI = credits exhausted / monthly limit hit — say so plainly
      // instead of a generic "connection issue" (the wake word still fires
      // locally, so without this the failure looks like the app is deaf).
      const friendly =
        mintRes.status === 429
          ? "Voice unavailable: the xAI account is out of credits or hit its monthly limit — top up at console.x.ai"
          : `Could not start voice session (xAI ${mintRes.status})`;
      return NextResponse.json({ error: friendly }, { status: 503 });
    }
    const mintJson = await mintRes.json();
    // xAI returns the secret in `value` (OpenAI-spec compatible: client_secret.value)
    const token: string | undefined =
      mintJson?.value || mintJson?.client_secret?.value || mintJson?.token;
    if (!token) {
      console.error("[Voice] Unexpected mint response shape:", JSON.stringify(mintJson).slice(0, 300));
      return NextResponse.json({ error: "Could not start voice session" }, { status: 502 });
    }

    // Per-user flags, each in its OWN select. An unknown column fails the whole
    // PostgREST select, and supabase-js resolves that as {data:null} rather
    // than throwing — so a combined query would let a missing migration revoke
    // finance access silently rather than just deny the newer flag.
    let financeAccess = false;
    let resourcingAccess = false;
    try {
      const { data } = await intelligenceDb
        .from("users_access")
        .select("flag_access_finance")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      financeAccess = (data as any)?.flag_access_finance === 1;
    } catch { /* no row / pre-migration = denied */ }
    try {
      const { data } = await intelligenceDb
        .from("users_access")
        .select("flag_access_resourcing")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      resourcingAccess = (data as any)?.flag_access_resourcing === 1;
    } catch { /* no row / pre-migration = denied */ }

    // Finance mirrors the text pipeline: a multi-reader thread is read by
    // everyone, so receivables and forecasts do not belong in one. Resourcing
    // is deliberately NOT visibility-gated — capacity is a team conversation.
    const voiceFinance = financeAccess && !isTeamThread;

    const instructions = buildVoiceInstructions({
      userName: session.user?.name || null,
      workspaceName: null,
      clientName,
      clientId,
      clientRoster,
      isTeamThread,
      financeAccess: voiceFinance,
      resourcingAccess,
      now: new Date().toLocaleString("en-GB", {
        timeZone: "Europe/Zurich",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });

    return NextResponse.json({
      token,
      // activeModel, not VOICE_MODEL: after a fallback the socket must connect
      // to the model the token was actually minted for, or the session is
      // rejected at connect time and the fallback buys nothing.
      wsUrl: `wss://api.x.ai/v1/realtime?model=${activeModel}`,
      // What was ACTUALLY minted, which is not always what was configured —
      // the client renders with these, so a fallback must be reflected here or
      // session.update would immediately overwrite the working voice with the
      // rejected one.
      model: activeModel,
      voice: activeVoice,
      sampleRate: VOICE_SAMPLE_RATE,
      instructions,
      tools: getVoiceTools({ finance: voiceFinance, resourcing: resourcingAccess }),
      isTeamThread,
      clientId,
    });
  } catch (err: any) {
    console.error("[Voice] Session create failed:", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
