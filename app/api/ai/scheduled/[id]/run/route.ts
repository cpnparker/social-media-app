import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { runScheduledPrompt } from "@/lib/scheduled/runner";
import { hasEngineAiAccess } from "@/lib/permissions";

export const maxDuration = 120;

// POST /api/ai/scheduled/[id]/run — "Run now": manual test/preview run.
// Does NOT advance the schedule; logs a run row like a scheduled one.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  const { data: task } = await intelligenceDb
    .from("ai_scheduled_prompts")
    .select("*")
    .eq("id_prompt", params.id)
    .maybeSingle();
  if (!task || task.user_created !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // "Run now" executes a full assistant turn with the same tool belt as the
  // chat routes, so it needs the same front-door check. Owning an existing
  // scheduled prompt is not entitlement: without this, a user whose EngineAI
  // access was revoked could keep running the pipeline through prompts they
  // had created earlier, for as long as their cookie lived.
  if (!(await hasEngineAiAccess(userId, task.id_workspace))) {
    return NextResponse.json(
      { error: "You do not have access to EngineAI" },
      { status: 403 }
    );
  }

  const { data: runRow } = await intelligenceDb
    .from("ai_scheduled_runs")
    .insert({ id_prompt: task.id_prompt, type_status: "running" })
    .select("id_run")
    .single();

  const result = await runScheduledPrompt(task);

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
    return NextResponse.json({ error: result.error || "Run failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: result.status, conversationId: task.id_conversation, messageId: result.messageId });
}
