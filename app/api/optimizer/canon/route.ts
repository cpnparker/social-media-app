/**
 * GET /api/optimizer/canon?workspaceId=&clientId= — the client canon.
 *
 * Cached for a day and rebuilt on miss. Cheap enough to call whenever the
 * client selector changes, which is what the brief form does.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOptimizer } from "../_lib/access";
import { getClientCanon } from "@/lib/optimizer/client-canon";
import { canAccessClient, requireAuth } from "@/lib/permissions";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const clientId = Number(req.nextUrl.searchParams.get("clientId"));
  if (!clientId || Number.isNaN(clientId)) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  // The canon aggregates client meetings and uploaded client material, so it is
  // more sensitive than the client record it is keyed on. Same gate as
  // everywhere else rather than a bespoke one.
  const authed = await requireAuth();
  if ("userId" in authed) {
    const ok = await canAccessClient(authed.userId, authed.role, clientId);
    if (!ok) return NextResponse.json({ error: "No access to that client" }, { status: 403 });
  }

  try {
    const canon = await getClientCanon(guard.caller.workspaceId, clientId, guard.caller.email);
    return NextResponse.json({ canon });
  } catch (e: any) {
    console.error("[optimizer] canon failed:", e?.message);
    return NextResponse.json({ error: "Could not build the client canon" }, { status: 500 });
  }
}
