import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { airtableConfigured } from "@/lib/airtable/client";
import { probeIdentity, runPhase0 } from "@/lib/airtable/introspect";

/**
 * GET /api/airtable/status[?workspaceId=…][&schema=1]
 *
 * Connection state for the resourcing base, and — with `schema=1` — the Phase 0
 * introspection the plan calls for.
 *
 * This exists as an endpoint rather than only a CLI script for a practical
 * reason: AIRTABLE_PAT is stored Sensitive in Vercel, which by design cannot be
 * pulled to a developer machine. The server can read it; nobody else can. So
 * discovery has to run where the credential already is.
 *
 * Admin-only, unlike the Xero status route which any member may read. Xero
 * reports a tenant name; this reports the shape of a base — every table, every
 * field name — which is a map of how the business runs. It is read-only and
 * returns no cell values: schema and row counts, never content.
 *
 * workspaceId is optional here, unlike Xero. Xero's credential is stored per
 * workspace, so the id names WHICH connection to read. Airtable's lives in one
 * process-wide env var, so the id can only ever be an authorisation scope —
 * and "owner/admin of any workspace" is exactly as strong a claim as
 * "owner/admin of the one you happened to name". Requiring it would only make
 * an admin hunt for a UUID to prove something they already are.
 */
export const maxDuration = 60;

/** Owner/admin of the named workspace, or of any workspace when none is named. */
async function isWorkspaceAdmin(userId: number, workspaceId: string): Promise<boolean> {
  if (workspaceId) {
    const role = await verifyWorkspaceMembership(userId, workspaceId);
    return !!role && ["owner", "admin"].includes(role);
  }
  const { data, error } = await intelligenceDb
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin"])
    .limit(1);
  // supabase-js resolves with {data, error} rather than throwing — an unbound
  // error would read as "no rows", i.e. fail *open* on the count but closed
  // here. Closed is right either way, but say why.
  if (error) return false;
  return !!data?.length;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";

  if (!(await isWorkspaceAdmin(userId, workspaceId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!airtableConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      hint: "Set AIRTABLE_PAT and AIRTABLE_RESOURCING_BASE in the Engine project, then redeploy — Vercel bakes env vars at build time.",
    });
  }

  const wantSchema = req.nextUrl.searchParams.get("schema") === "1";
  const wantProbe = req.nextUrl.searchParams.get("probe") === "1";

  // Without ?schema=1 or ?probe=1 this is a cheap liveness check for the card.
  if (!wantSchema && !wantProbe) {
    try {
      const findings = await runPhase0();
      return NextResponse.json({
        configured: true,
        connected: true,
        tableCount: findings.tables.length,
        warnings: findings.warnings.length,
      });
    } catch (e: any) {
      return NextResponse.json({
        configured: true,
        connected: false,
        error: String(e?.message || e).slice(0, 300),
      });
    }
  }

  try {
    if (wantProbe) {
      const view = req.nextUrl.searchParams.get("view") || undefined;
      return NextResponse.json({ configured: true, connected: true, identity: await probeIdentity({ view }) });
    }
    const findings = await runPhase0({ withCounts: true });
    return NextResponse.json({ configured: true, connected: true, ...findings });
  } catch (e: any) {
    return NextResponse.json(
      { configured: true, connected: false, error: String(e?.message || e).slice(0, 300) },
      { status: 502 }
    );
  }
}
