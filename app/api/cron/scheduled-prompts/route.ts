import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { runScheduledPrompt, type ScheduledPromptRow } from "@/lib/scheduled/runner";
import { computeNextRun, type ScheduleType } from "@/lib/scheduled/schedule";
import { assertNotKilled } from "@/lib/admin/service-control";

export const maxDuration = 300;

// GET /api/cron/scheduled-prompts — Vercel Cron, every 15 minutes.
//
// Claims ALL due tasks each tick (the RFP one-row-per-tick worker drifts when
// several jobs share a slot) and runs them sequentially within maxDuration.
// The schedule ALWAYS advances — success or failure — so a broken task can
// never retry-storm (RFP pattern). Failures are LOUD: 2 consecutive failures
// pause the task and email the owner (the gap every incumbent leaves open).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await assertNotKilled("engine", "scheduled-prompt");
  } catch {
    return NextResponse.json({ message: "Killed via Control Centre", ran: 0 });
  }

  const now = new Date();
  const { data: due, error } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .select("*")
    .eq("flag_enabled", 1)
    .lte("date_next_run", now.toISOString())
    .order("date_next_run", { ascending: true })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ message: "Nothing due", ran: 0 });

  const results: { id: string; status: string }[] = [];
  for (const task of due as (ScheduledPromptRow & { type_schedule: string; config_schedule: any; units_consecutive_failures: number })[]) {
    // Advance the schedule FIRST (even a crash mid-run can't cause a re-run storm)
    const nextRun = computeNextRun(task.type_schedule as ScheduleType, task.config_schedule, now);
    await intelligenceDb
      .from("ai_scheduled_prompts")
      .update({ date_next_run: nextRun.toISOString(), date_last_run: now.toISOString(), date_updated: now.toISOString() })
      .eq("id_prompt", task.id_prompt);

    // Run log: running → final status
    const { data: runRow } = await intelligenceDb
      .from("ai_scheduled_runs")
      .insert({ id_prompt: task.id_prompt, type_status: "running" })
      .select("id_run")
      .single();

    const result = await runScheduledPrompt(task);
    results.push({ id: task.id_prompt, status: result.status });

    if (runRow?.id_run) {
      await intelligenceDb.from("ai_scheduled_runs").update({
        type_status: result.status,
        id_message: result.messageId,
        units_input: result.inputTokens,
        units_output: result.outputTokens,
        units_duration_ms: result.durationMs,
        document_error: result.error || null,
      }).eq("id_run", runRow.id_run);
    }

    if (result.status === "failed") {
      const failures = (task.units_consecutive_failures || 0) + 1;
      const pause = failures >= 2;
      await intelligenceDb.from("ai_scheduled_prompts").update({
        units_consecutive_failures: failures,
        ...(pause ? { flag_enabled: 0 } : {}),
      }).eq("id_prompt", task.id_prompt);
      // Never fail silently: after the 2nd consecutive failure, pause + tell the owner.
      if (pause && task.email_user && process.env.RESEND_API_KEY) {
        try {
          await new Resend(process.env.RESEND_API_KEY).emails.send({
            from: "EngineAI <noreply@tasks.thecontentengine.com>",
            to: task.email_user,
            subject: `⚠️ Scheduled prompt paused: ${task.name_title}`,
            html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111">
              <p style="font-size:14px;line-height:1.6">Your scheduled prompt <strong>"${task.name_title}"</strong> failed twice in a row and has been paused so it doesn't fail silently.</p>
              <p style="font-size:13px;color:#555">Last error: ${(result.error || "unknown").replace(/</g, "&lt;")}</p>
              <p style="font-size:13px">Resume it from EngineAI → Scheduled once the issue is resolved.</p>
            </div>`,
          });
        } catch { /* best-effort */ }
      }
    } else {
      if ((task.units_consecutive_failures || 0) > 0) {
        await intelligenceDb.from("ai_scheduled_prompts").update({ units_consecutive_failures: 0 }).eq("id_prompt", task.id_prompt);
      }
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
