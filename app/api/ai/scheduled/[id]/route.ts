import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { computeNextRun, promptFingerprint, type ScheduleType } from "@/lib/scheduled/schedule";

async function loadOwnedTask(id: string, userId: number) {
  const { data: task } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .select("*")
    .eq("id_prompt", id)
    .maybeSingle();
  if (!task || task.user_created !== userId) return null;
  return task;
}

// GET /api/ai/scheduled/[id] — the task + its run history (last 20)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const task = await loadOwnedTask(params.id, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: runs, error } = await intelligenceDb
    .from("ai_scheduled_runs")
    .select("id_run, type_status, date_run, units_duration_ms, units_input, units_output, document_error, id_message")
    .eq("id_prompt", params.id)
    .order("date_run", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task, runs: runs || [] });
}

// PATCH /api/ai/scheduled/[id] — pause/resume, edit title/prompt/schedule/email
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = params.id;
  const task = await loadOwnedTask(id, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  // Update-confirmation cards pin the version of the standing prompt they were
  // built against. Reject stale cards so confirming an old one can't silently
  // revert newer edits.
  if (body.baseFp && promptFingerprint(task.document_prompt) !== body.baseFp) {
    return NextResponse.json(
      { error: "This task has changed since that card was created — ask again in the thread for a fresh update card." },
      { status: 409 }
    );
  }

  const update: Record<string, any> = { date_updated: new Date().toISOString() };
  if (body.title !== undefined) update.name_title = String(body.title).slice(0, 120);
  if (body.prompt !== undefined) update.document_prompt = String(body.prompt).slice(0, 4000);
  if (body.emailEnabled !== undefined) update.flag_email = body.emailEnabled ? 1 : 0;
  if (body.enabled !== undefined) {
    update.flag_enabled = body.enabled ? 1 : 0;
    if (body.enabled) {
      // Resume clears both strike counts (failures AND unopened-run pause)
      update.units_consecutive_failures = 0;
      update.units_consecutive_ignored = 0;
    }
  }
  if (body.typeTask !== undefined) {
    update.type_task = body.typeTask === "monitor" ? "monitor" : "digest";
    if (update.type_task === "digest") update.document_last_snapshot = null; // stale monitor state must not linger
  }
  const scheduleChanged = body.typeSchedule !== undefined || body.configSchedule !== undefined;
  if (scheduleChanged) {
    const type = (body.typeSchedule ?? task.type_schedule) as ScheduleType;
    const cfg = body.configSchedule ?? task.config_schedule;
    update.type_schedule = type;
    update.config_schedule = cfg;
    update.date_next_run = computeNextRun(type, cfg).toISOString();
  } else if (body.enabled === true && !task.date_next_run) {
    update.date_next_run = computeNextRun(task.type_schedule as ScheduleType, task.config_schedule).toISOString();
  }

  const { data, error } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .update(update)
    .eq("id_prompt", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

// DELETE /api/ai/scheduled/[id] — delete the task (its thread survives)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const id = params.id;
  const task = await loadOwnedTask(id, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await intelligenceDb.from("ai_scheduled_prompts").delete().eq("id_prompt", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
