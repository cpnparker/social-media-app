import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { computeNextRun } from "@/lib/rfp/schedule";

// GET /api/rfp/saved-searches/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data, error } = await intelligenceDb
      .from("rfp_saved_searches")
      .select("*")
      .eq("id_saved_search", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, data.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ savedSearch: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/rfp/saved-searches/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: existing } = await intelligenceDb
      .from("rfp_saved_searches")
      .select("id_workspace, flag_schedule_enabled, type_schedule, config_schedule")
      .eq("id_saved_search", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, existing.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updates: any = { date_updated: new Date().toISOString() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.query !== undefined) updates.query = body.query;
    if (body.config !== undefined) updates.config_search = body.config;
    if (body.provider !== undefined) updates.type_provider = body.provider;
    if (body.type_schedule !== undefined) updates.type_schedule = body.type_schedule;
    if (body.config_schedule !== undefined) updates.config_schedule = body.config_schedule;
    if (body.flag_schedule_enabled !== undefined) updates.flag_schedule_enabled = body.flag_schedule_enabled;

    // Compute date_next_run when schedule is enabled or changed
    const scheduleEnabled = body.flag_schedule_enabled ?? existing.flag_schedule_enabled;
    const scheduleType = body.type_schedule ?? existing.type_schedule;
    const scheduleConfig = body.config_schedule ?? existing.config_schedule;

    if (scheduleEnabled === 1 && scheduleType) {
      updates.date_next_run = computeNextRun(scheduleType, scheduleConfig).toISOString();
    } else if (scheduleEnabled === 0) {
      updates.date_next_run = null;
    }

    const { data, error } = await intelligenceDb
      .from("rfp_saved_searches")
      .update(updates)
      .eq("id_saved_search", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ savedSearch: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/rfp/saved-searches/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: existing } = await intelligenceDb
      .from("rfp_saved_searches")
      .select("id_workspace")
      .eq("id_saved_search", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, existing.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await intelligenceDb
      .from("rfp_saved_searches")
      .delete()
      .eq("id_saved_search", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
