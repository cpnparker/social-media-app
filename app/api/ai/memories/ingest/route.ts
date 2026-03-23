/**
 * POST /api/ai/memories/ingest
 *
 * Accepts structured data from MeetingBrain (meetings or completed tasks),
 * extracts memory candidates via source-specific prompts, and runs them
 * through the consolidation pipeline.
 *
 * Auth: x-api-key header validated against MEETINGBRAIN_API_KEY env var.
 * Idempotent: uses id_conversation_source = "{type}:{id}" to prevent
 * double-processing on re-scans.
 *
 * sourceType: "meeting" (default) or "task"
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { extractMeetingMemories, extractTaskMemories } from "@/lib/ai/memory-extraction";
import { runConsolidationPipeline } from "@/lib/ai/memory-consolidation";
import type { MeetingMemoryInput, TaskMemoryInput } from "@/lib/ai/memory-extraction";

export async function POST(req: NextRequest) {
  // ── Auth ──
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.MEETINGBRAIN_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const sourceType = body.sourceType || "meeting";

    // ── Validate common required fields ──
    const { userId, workspaceId } = body;
    if (!userId || !workspaceId) {
      return NextResponse.json(
        { error: "Missing required fields: userId, workspaceId" },
        { status: 400 }
      );
    }

    // ── Route by source type ──
    if (sourceType === "task") {
      return handleTaskIngest(body, userId, workspaceId);
    } else {
      return handleMeetingIngest(body, userId, workspaceId);
    }
  } catch (err) {
    console.error("[Memory Ingest] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── Meeting ingest ──

async function handleMeetingIngest(
  body: any,
  userId: number,
  workspaceId: string
) {
  const { meetingId, meetingTitle, meetingDate, summary } = body;
  if (!meetingId || !summary) {
    return NextResponse.json(
      { error: "Missing required fields for meeting: meetingId, summary" },
      { status: 400 }
    );
  }

  // Idempotency check
  const sourceId = `meeting:${meetingId}`;
  const { count: existingCount } = await intelligenceDb
    .from("ai_memories")
    .select("*", { count: "exact", head: true })
    .eq("id_conversation_source", sourceId);

  if (existingCount && existingCount > 0) {
    console.log(`[Memory Ingest] Already processed meeting ${meetingId}, skipping`);
    return jsonSuccess(0, "Already processed");
  }

  // Fetch existing memories for de-duplication
  const existingContents = await getExistingMemoryContents(workspaceId);

  // Extract
  const meetingInput: MeetingMemoryInput = {
    meetingTitle: meetingTitle || "Meeting",
    meetingDate: meetingDate || new Date().toISOString(),
    attendees: body.attendees,
    clientName: body.clientName,
    summary,
    keyTopics: body.keyTopics,
    nextSteps: body.nextSteps,
    insights: body.insights,
    coachingNotes: body.coachingNotes,
  };

  const candidates = await extractMeetingMemories(meetingInput, existingContents);
  if (candidates.length === 0) {
    console.log(`[Memory Ingest] No candidates from meeting ${meetingId}`);
    return jsonSuccess(0);
  }

  // Consolidate
  const scope = body.isPrivate === false ? "team" : "private";
  const memUserId = scope === "private" ? userId : null;

  const result = await runConsolidationPipeline(
    candidates, workspaceId, memUserId, scope, sourceId, "meeting"
  );

  console.log(
    `[Memory Ingest] Meeting ${meetingId}: ${candidates.length} candidate(s) → +${result.added} ↑${result.reinforced} ✎${result.updated} ✗${result.contradicted} ○${result.skipped}`
  );

  return jsonSuccess(candidates.length, undefined, result);
}

// ── Task ingest ──

async function handleTaskIngest(
  body: any,
  userId: number,
  workspaceId: string
) {
  const { taskId, taskTitle } = body;
  if (!taskId || !taskTitle) {
    return NextResponse.json(
      { error: "Missing required fields for task: taskId, taskTitle" },
      { status: 400 }
    );
  }

  // Idempotency check
  const sourceId = `task:${taskId}`;
  const { count: existingCount } = await intelligenceDb
    .from("ai_memories")
    .select("*", { count: "exact", head: true })
    .eq("id_conversation_source", sourceId);

  if (existingCount && existingCount > 0) {
    console.log(`[Memory Ingest] Already processed task ${taskId}, skipping`);
    return jsonSuccess(0, "Already processed");
  }

  // Fetch existing memories for de-duplication
  const existingContents = await getExistingMemoryContents(workspaceId);

  // Extract
  const taskInput: TaskMemoryInput = {
    taskTitle,
    taskDescription: body.taskDescription,
    projectName: body.projectName,
    meetingSource: body.meetingSource,
    responsible: body.responsible,
  };

  const candidates = await extractTaskMemories(taskInput, existingContents);
  if (candidates.length === 0) {
    console.log(`[Memory Ingest] No candidates from task ${taskId}`);
    return jsonSuccess(0);
  }

  // Consolidate — tasks use "meeting" source type for same decay/importance treatment
  const result = await runConsolidationPipeline(
    candidates, workspaceId, userId, "private", sourceId, "meeting"
  );

  console.log(
    `[Memory Ingest] Task ${taskId}: ${candidates.length} candidate(s) → +${result.added} ↑${result.reinforced} ✎${result.updated} ✗${result.contradicted} ○${result.skipped}`
  );

  return jsonSuccess(candidates.length, undefined, result);
}

// ── Helpers ──

async function getExistingMemoryContents(workspaceId: string): Promise<string[]> {
  const { data } = await intelligenceDb
    .from("ai_memories")
    .select("information_content")
    .eq("id_workspace", workspaceId)
    .eq("flag_active", 1);

  return (data || []).map((m: any) => m.information_content as string);
}

function jsonSuccess(
  memoriesProcessed: number,
  message?: string,
  result?: { added: number; reinforced: number; updated: number; contradicted: number; skipped: number }
) {
  return NextResponse.json({
    success: true,
    memoriesProcessed,
    ...(message ? { message } : {}),
    actions: {
      added: result?.added || 0,
      reinforced: result?.reinforced || 0,
      updated: result?.updated || 0,
      contradicted: result?.contradicted || 0,
      skipped: result?.skipped || 0,
    },
  });
}
