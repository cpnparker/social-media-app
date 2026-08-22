import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

/**
 * POST /api/connections/enable — a user switching THEIR OWN personal
 * integration on or off.
 *
 * This is a deliberate change of posture and worth being explicit about.
 * flag_access_gmail / _calendar / _microsoft were admin-only: an admin ticked a
 * column in Settings → Users and nobody could enable anything for themselves.
 * That made sense while the flags were read as "the company permits this",
 * but it meant a user could not turn on their own mailbox without finding an
 * admin — and most users cannot even open Settings → Users to see the state.
 *
 * The flags now mean "this person has opted in", which they set themselves.
 * What they do NOT control, and what still makes this safe, is unchanged:
 *   - it is only ever their OWN account — the email comes from the session,
 *     never the request body, so this cannot be pointed at a colleague;
 *   - the data is only readable in a private, unshared conversation;
 *   - mailbox-grade content only goes to an approved processor (the Claude
 *     chains), enforced at tool-registration time;
 *   - MeetingBrain re-refuses all of the above at the bridge.
 *
 * Admins keep the Settings → Users grid, so they can still see and override
 * anyone's state. What they lose is the ability to gate it in advance.
 */
export const maxDuration = 15;

const FLAGS = {
  gmail: "flag_access_gmail",
  calendar: "flag_access_calendar",
  microsoft: "flag_access_microsoft",
} as const;

type Service = keyof typeof FLAGS;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  let body: { service?: string; enabled?: boolean; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const service = String(body.service || "") as Service;
  if (!(service in FLAGS)) {
    return NextResponse.json(
      { error: `Unknown service. Valid: ${Object.keys(FLAGS).join(", ")}` },
      { status: 400 }
    );
  }
  const enabled = body.enabled === true;
  const workspaceId = String(body.workspaceId || "").trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Membership check. Without it, a signed-in user could flip a flag in any
  // workspace by passing its id — the flags are keyed (id_workspace,
  // user_target) and nothing else here constrains the workspace.
  const { data: member, error: memberErr } = await intelligenceDb
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (memberErr) {
    console.error("[Connections/enable] membership check failed:", memberErr.message);
    return NextResponse.json({ error: "Could not verify membership" }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
  }

  const column = FLAGS[service];
  const value = enabled ? 1 : 0;

  const { data: existing, error: readErr } = await intelligenceDb
    .from("users_access")
    .select("id_access")
    .eq("id_workspace", workspaceId)
    .eq("user_target", userId)
    .maybeSingle();
  if (readErr) {
    console.error("[Connections/enable] read failed:", readErr.message);
    return NextResponse.json({ error: "Could not read current access" }, { status: 500 });
  }

  if (existing) {
    const { error } = await intelligenceDb
      .from("users_access")
      .update({ [column]: value })
      .eq("id_access", (existing as any).id_access);
    if (error) {
      console.error("[Connections/enable] update failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  } else {
    // Create with NO other access, matching sign-in's "viewer with no access".
    // Only the flag being set is named — every other access column is left to
    // its column default, so this can never widen anything by accident, and a
    // column that has not been migrated yet cannot fail the whole insert.
    const { error } = await intelligenceDb.from("users_access").insert({
      id_workspace: workspaceId,
      user_target: userId,
      [column]: value,
    });
    if (error) {
      console.error("[Connections/enable] insert failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  }

  console.log(`[Connections/enable] user=${userId} ${service}=${value}`);
  return NextResponse.json({ ok: true, service, enabled });
}
