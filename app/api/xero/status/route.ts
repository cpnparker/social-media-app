import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { getXeroConnection, xeroConfigured } from "@/lib/xero/client";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// GET /api/xero/status?workspaceId=... — connection status (any member).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  if (!(await verifyWorkspaceMembership(userId, workspaceId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const conn = await getXeroConnection(workspaceId);
  return NextResponse.json({
    configured: xeroConfigured(),
    connected: !!conn,
    tenantName: conn?.name_tenant || null,
    connectedAt: conn?.date_created || null,
  });
}

// DELETE /api/xero/status?workspaceId=... — disconnect (admin only).
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  const role = await verifyWorkspaceMembership(userId, workspaceId);
  if (!role || !["owner", "admin"].includes(role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  await intelligenceDb.from("xero_connections").delete().eq("id_workspace", workspaceId);
  return NextResponse.json({ ok: true });
}
