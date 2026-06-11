import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { checkConversationAccess } from "@/lib/ai/access";
import {
  buildVoiceInstructions,
  getVoiceTools,
  VOICE_MODEL,
  VOICE_NAME,
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

    const isTeamThread = conversation.type_visibility === "team";

    // Mint the ephemeral token (5 min TTL — covers connection setup; the
    // WebSocket session itself stays alive past token expiry).
    const mintRes = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      // Bake the voice into the session at creation so the very first
      // response can never race the client's session.update and speak in a
      // different voice ("two voices" bug). Verified 2026-06-11: xAI applies
      // `voice` from the mint body (session.created echoes it); instructions
      // are still delivered via session.update from the browser.
      body: JSON.stringify({
        expires_after: { seconds: 300 },
        session: { type: "realtime", model: VOICE_MODEL, voice: VOICE_NAME },
      }),
    });
    if (!mintRes.ok) {
      const errText = await mintRes.text().catch(() => "");
      console.error(`[Voice] Ephemeral token mint failed (${mintRes.status}): ${errText.slice(0, 300)}`);
      return NextResponse.json({ error: "Could not start voice session" }, { status: 502 });
    }
    const mintJson = await mintRes.json();
    // xAI returns the secret in `value` (OpenAI-spec compatible: client_secret.value)
    const token: string | undefined =
      mintJson?.value || mintJson?.client_secret?.value || mintJson?.token;
    if (!token) {
      console.error("[Voice] Unexpected mint response shape:", JSON.stringify(mintJson).slice(0, 300));
      return NextResponse.json({ error: "Could not start voice session" }, { status: 502 });
    }

    const instructions = buildVoiceInstructions({
      userName: session.user?.name || null,
      workspaceName: null,
      clientName,
      clientId,
      clientRoster,
      isTeamThread,
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
      wsUrl: `wss://api.x.ai/v1/realtime?model=${VOICE_MODEL}`,
      model: VOICE_MODEL,
      voice: VOICE_NAME,
      sampleRate: VOICE_SAMPLE_RATE,
      instructions,
      tools: getVoiceTools(),
      isTeamThread,
      clientId,
    });
  } catch (err: any) {
    console.error("[Voice] Session create failed:", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
