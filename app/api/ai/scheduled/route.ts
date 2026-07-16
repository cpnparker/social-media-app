import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { computeNextRun, describeSchedule, type ScheduleType } from "@/lib/scheduled/schedule";

const MAX_ACTIVE_PER_USER = 10; // industry-normal cap (ChatGPT 10, Gemini 10)
const SCHEDULE_TYPES = ["daily", "weekdays", "weekly", "monthly"];

// GET /api/ai/scheduled?workspaceId=... — the user's scheduled prompts + recent run status
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: tasks, error } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("user_created", userId)
    .order("date_created", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Latest 3 runs per task (small N — fine to fetch flat and group)
  const ids = (tasks || []).map((t) => t.id_prompt);
  const runsByTask: Record<string, any[]> = {};
  if (ids.length) {
    const { data: runs } = await intelligenceDb
      .from("ai_scheduled_runs")
      .select("id_prompt, type_status, document_error, date_run, units_duration_ms")
      .in("id_prompt", ids)
      .order("date_run", { ascending: false })
      .limit(ids.length * 3);
    for (const r of runs || []) {
      (runsByTask[r.id_prompt] = runsByTask[r.id_prompt] || []).push(r);
    }
  }

  return NextResponse.json({
    tasks: (tasks || []).map((t) => ({
      ...t,
      schedule_label: describeSchedule(t.type_schedule, t.config_schedule),
      recent_runs: (runsByTask[t.id_prompt] || []).slice(0, 3),
    })),
  });
}

// POST /api/ai/scheduled — create a scheduled prompt (+ its persistent thread)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { workspaceId, title, prompt, typeSchedule, configSchedule, clientId, emailEnabled, model } = body || {};
  if (!workspaceId || !title?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: "workspaceId, title and prompt are required" }, { status: 400 });
  }
  if (!SCHEDULE_TYPES.includes(typeSchedule)) {
    return NextResponse.json({ error: `typeSchedule must be one of ${SCHEDULE_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Chat confirmation cards send a proposalId — if the task was already
  // confirmed (double-click, another device, reloaded thread), return the
  // existing task instead of creating a duplicate.
  const proposalId = body.proposalId ? String(body.proposalId) : null;
  if (proposalId) {
    const { data: existing } = await intelligenceDb
      .from("ai_scheduled_prompts")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("user_created", userId)
      .eq("config_context->>proposalId", proposalId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        task: { ...existing, schedule_label: describeSchedule(existing.type_schedule, existing.config_schedule) },
        nextRun: existing.date_next_run,
        alreadyExisted: true,
      });
    }
  }

  const { count } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .select("id_prompt", { count: "exact", head: true })
    .eq("id_workspace", workspaceId)
    .eq("user_created", userId)
    .eq("flag_enabled", 1);
  if ((count || 0) >= MAX_ACTIVE_PER_USER) {
    return NextResponse.json(
      { error: `You're at the limit of ${MAX_ACTIVE_PER_USER} active scheduled prompts — pause or delete one first.` },
      { status: 400 }
    );
  }

  try {
    // The task's persistent thread — every run appends here, follow-ups work.
    const { data: conversation, error: convErr } = await intelligenceDb
      .from("ai_conversations")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        name_conversation: `⏰ ${String(title).slice(0, 110)}`,
        type_visibility: "private",
        id_client: clientId ? parseInt(String(clientId), 10) : null,
        name_model: model || "auto",
        type_conversation_mode: "scheduled",
      })
      .select("id_conversation")
      .single();
    if (convErr) throw convErr;

    const nextRun = computeNextRun(typeSchedule as ScheduleType, configSchedule || {});
    const { data: task, error: taskErr } = await intelligenceDb
      .from("ai_scheduled_prompts")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        email_user: session.user.email || null,
        name_title: String(title).slice(0, 120),
        document_prompt: String(prompt).slice(0, 4000),
        name_model: model || "auto",
        id_client: clientId ? parseInt(String(clientId), 10) : null,
        config_context: proposalId ? { ...(body.configContext || {}), proposalId } : (body.configContext || null),
        type_schedule: typeSchedule,
        config_schedule: configSchedule || {},
        date_next_run: nextRun.toISOString(),
        flag_email: emailEnabled === false ? 0 : 1,
        id_conversation: conversation.id_conversation,
      })
      .select("*")
      .single();
    if (taskErr) throw taskErr;

    return NextResponse.json({
      task: { ...task, schedule_label: describeSchedule(typeSchedule, configSchedule) },
      nextRun: nextRun.toISOString(),
    });
  } catch (err: any) {
    console.error("[Scheduled] Create failed:", err.message);
    return NextResponse.json({ error: "Could not create scheduled prompt" }, { status: 500 });
  }
}
