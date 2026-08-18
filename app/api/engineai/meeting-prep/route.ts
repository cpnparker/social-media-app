import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";
import { buildSystemPrompt, normalizeContextConfig } from "@/lib/ai/system-prompts";

/**
 * POST /api/engineai/meeting-prep — MeetingBrain's "Prepare me" button, answered
 * by EngineAI.
 *
 * WHY THIS EXISTS. MeetingBrain has the meetings, the transcripts and the
 * tasks, and its own prep still produced almost nothing — for a 1:1 catch-up on
 * 18 Aug 2026 it returned two attendee bios and no agenda. EngineAI, asked the
 * same question, produced a working agenda: a colleague's absence 19-30 August,
 * a promotion starting 1 September, a project handover, a payment thread, four
 * named accounts.
 *
 * Most of that came out of MeetingBrain's OWN database. The difference was not
 * access, it was reach: MB's prep looks for prior meetings matching this
 * meeting's attendees, while EngineAI searches the whole recent record and
 * cross-references Slack, absences and the commercial position. Rebuilding that
 * reach inside MB would mean duplicating the tool layer and then keeping two
 * copies in step — so MB asks EngineAI instead, and keeps its own generator as
 * the fallback for when this is unreachable.
 *
 * AUDIENCE. This runs AS the requesting user, in a private single-reader
 * context, and the result is written to that user's own meeting record. The
 * personal-scope tools are therefore legitimately available — same person, same
 * data, one reader. It is NOT a shared surface, and must never become one: if
 * prep is ever shown to a whole team, this endpoint has to be re-gated first.
 */
export const maxDuration = 300;

/** Shared secret with MeetingBrain. No key, no prep. */
const PREP_KEY = () => (process.env.MEETINGBRAIN_PREP_KEY || "").trim();

interface PrepRequest {
  userEmail: string;
  meetingTitle?: string;
  meetingDate?: string;
  attendees?: { name?: string; email?: string }[];
  meetingId?: string;
}

export async function POST(req: NextRequest) {
  const key = PREP_KEY();
  if (!key) {
    return NextResponse.json({ error: "Meeting prep is not configured on this deployment." }, { status: 503 });
  }
  if ((req.headers.get("x-api-key") || "").trim() !== key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PrepRequest;
  try {
    body = (await req.json()) as PrepRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userEmail = (body.userEmail || "").trim().toLowerCase();
  if (!userEmail) return NextResponse.json({ error: "userEmail is required" }, { status: 400 });

  // Resolve the requesting user. An unknown address gets nothing: this unlocks
  // personal-scope tools, so it must never run for someone we cannot identify.
  const { data: user, error: userErr } = await supabase
    .from("app_users")
    .select("id_user, name_user")
    .ilike("email", userEmail)
    .maybeSingle();
  if (userErr) return NextResponse.json({ error: "User lookup failed" }, { status: 502 });
  if (!user) return NextResponse.json({ error: "No such user in Engine" }, { status: 404 });

  const { data: ws } = await intelligenceDb
    .from("workspaces").select("id_workspace").limit(1).maybeSingle();
  const workspaceId = (ws as any)?.id_workspace;
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 500 });

  // Per-user access flags, read exactly as the chat route does. Explicit `=== 1`
  // — an absent row has historically been treated as "allowed" elsewhere in
  // this codebase, which for a mailbox would mean everyone.
  let gmailAccess = false, financeAccess = false, resourcingAccess = false;
  try {
    const { data: fa } = await intelligenceDb
      .from("users_access")
      .select("flag_access_gmail, flag_access_finance, flag_access_resourcing")
      .eq("id_workspace", workspaceId)
      .eq("user_target", user.id_user)
      .maybeSingle();
    gmailAccess = (fa as any)?.flag_access_gmail === 1;
    financeAccess = (fa as any)?.flag_access_finance === 1;
    resourcingAccess = (fa as any)?.flag_access_resourcing === 1;
  } catch { /* fail closed on all three */ }

  const { data: clientRows } = await supabase.from("app_clients").select("id_client");
  const workspaceClientIds = (clientRows || []).map((c: any) => c.id_client);

  const contextConfig = normalizeContextConfig({});
  let systemPrompt = buildSystemPrompt({
    workspaceConfig: { contentTypes: [], formatDescriptions: null, typeInstructions: null, companyContext: null },
    clientContext: null,
    contentDetail: null,
    contextConfig,
    resourcingAccess,
  } as any);

  // Absences, so a brief can say "they are away from Wednesday" rather than
  // proposing a follow-up into someone's annual leave.
  try {
    const { fetchAbsences, formatAbsenceBlock, workspaceToday } = await import("@/lib/hr/absences");
    systemPrompt += formatAbsenceBlock(await fetchAbsences(), workspaceToday());
  } catch { /* a missing calendar must not cost the brief */ }

  const attendeeLines = (body.attendees || [])
    .map((a) => `- ${a.name || a.email || "(unknown)"}${a.email ? ` <${a.email}>` : ""}`)
    .join("\n");

  const prompt = [
    `Prepare ${user.name_user || userEmail} for this meeting. Write the brief they would want ten minutes beforehand.`,
    ``,
    `MEETING: ${body.meetingTitle || "(untitled)"}`,
    body.meetingDate ? `WHEN: ${body.meetingDate}` : "",
    attendeeLines ? `ATTENDEES:\n${attendeeLines}` : "",
    ``,
    `FIRST, WORK OUT WHAT KIND OF MEETING THIS IS from the attendees and the title, and say which in one line at the top. Getting this wrong is the main way a prep brief becomes useless — a prospect briefed as a client reads as though we already have a contract with them.`,
    ``,
    `  EXISTING CLIENT — an attendee at a registered client domain, and we have a contract.`,
    `    What matters: the commercial position (contracted vs delivered, end date, renewal due),`,
    `    what was promised last time and whether it landed, anything overdue, who owns the account.`,
    ``,
    `  PROSPECT OR NEW BUSINESS — an external attendee who is NOT an existing client, or a`,
    `    named opportunity. What matters: what they asked for, what we proposed, price and scope`,
    `    discussed, objections raised, who else is in their decision. There is NO delivery history`,
    `    and probably NO contract — do not imply one, do not quote CU figures, and do not talk as`,
    `    though work is under way.`,
    ``,
    `  INTERNAL 1:1 — one colleague. What matters: what they own, what is moving, what they are`,
    `    blocked on, anything you agreed last time that is still open, and whether either of you`,
    `    is away soon.`,
    ``,
    `  TEAM OR ALL-HANDS — several internal attendees. What matters is ACROSS accounts and people,`,
    `    not one relationship: what changed since the last one, what needs a decision in the room,`,
    `    which accounts are at risk or awaiting something, who is away. Do not turn this into a`,
    `    brief about a single client.`,
    ``,
    `  RECURRING SERIES — a standup, a weekly, a fortnightly. What matters is the DELTA: what has`,
    `    moved since the previous session, what was carried over and still has not happened.`,
    ``,
    `  SUPPLIER, PARTNER OR RECRUITMENT — external but not a customer. Treat commercially but`,
    `    never as a client account; we may be the buyer here.`,
    ``,
    `A meeting can be more than one of these. If it is genuinely unclear, say so and cover both`,
    `readings briefly rather than guessing at one.`,
    ``,
    `THEN GATHER, before writing. Use your tools to find:`,
    `- what was said in RECENT meetings involving these people or this account, not only meetings with this exact title`,
    `- open commitments and next steps that are still outstanding`,
    `- whatever the meeting shape above says matters`,
    `- anything time-critical: absences, deadlines, decisions waiting on someone`,
    ``,
    `Search broadly. A prep brief that only repeats the last meeting with the same title is worth nothing — the useful material is usually in adjacent meetings, a Slack thread, or a contract date nobody has looked at.`,
    ``,
    `THEN WRITE, in plain text with UPPERCASE section headings and "• " bullets:`,
    `- a short PURPOSE line, opening with the meeting kind you decided`,
    `- WHAT'S CHANGED SINCE LAST TIME`,
    `- SUGGESTED AGENDA, as specific items rather than themes`,
    `- OPEN ITEMS / DECISIONS NEEDED`,
    `- WATCH OUT FOR — anything that could go wrong or embarrass, including dates that have passed`,
    ``,
    `Section names may be adapted to the meeting kind where that reads better — a prospect brief`,
    `wants WHAT THEY ASKED FOR and OBJECTIONS TO EXPECT, a team meeting wants ACCOUNTS NEEDING`,
    `ATTENTION. Keep the shape; do not force a client vocabulary onto a meeting that is not one.`,
    ``,
    `Include a section ONLY if you have real content for it. Every specific claim must come from something you retrieved: name the source and the date inline, e.g. "(morning meeting, 18 Aug)". If you could not find anything for a section, leave it out rather than padding it.`,
    ``,
    `Do NOT invent attendees, dates, figures or commitments. If a fact you would rely on is a relative date from an older message ("next week", "back on the 17th"), convert it against today's date and say which message it came from.`,
  ].filter(Boolean).join("\n");

  const messages: AIMessage[] = [{ role: "user", content: prompt }];

  let completion: { fullText: string } | null = null;
  const done = new Promise<void>((resolve) => {
    const stream = createStreamingResponse(
      messages,
      {
        model: "claude-sonnet-5",
        systemPrompt,
        maxTokens: 8192,
        webSearch: false,
        imageGeneration: false,
        workspaceClientIds,
        workspaceId,
        userId: user.id_user,
        userEmail,
        // Single reader — the requesting user, into their own meeting record.
        conversationVisibility: "private",
        allowPersonalData: true,
        gmailAccess,
        financeAccess,
        resourcingAccess,
        source: "meeting-prep",
      } as any,
      async (result) => { completion = result as any; resolve(); }
    );
    // Drain server-side; nothing is attached to a browser here.
    const reader = stream.getReader();
    (async () => {
      try { for (;;) { const { done: d } = await reader.read(); if (d) break; } }
      finally { resolve(); }
    })();
  });

  await done;
  const brief = (completion as any)?.fullText?.trim() || "";
  if (!brief) {
    return NextResponse.json({ error: "Prep produced no text" }, { status: 502 });
  }
  return NextResponse.json({
    brief,
    generatedAt: new Date().toISOString(),
    generatedBy: "engineai",
  });
}
