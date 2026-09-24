import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { XERO_SCOPES, xeroConfigured, xeroRedirectUri } from "@/lib/xero/client";

// GET /api/xero/connect?workspaceId=... — start the Xero OAuth flow (admin only).
// State is HMAC-signed with NEXTAUTH_SECRET so the callback can trust it.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  const role = await verifyWorkspaceMembership(userId, workspaceId);
  if (!role || !["owner", "admin"].includes(role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!xeroConfigured()) {
    return NextResponse.json({ error: "XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set on the server" }, { status: 500 });
  }

  const payload = JSON.stringify({ w: workspaceId, u: userId, n: crypto.randomBytes(8).toString("hex"), t: Date.now() });
  const sig = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "").update(payload).digest("hex");
  const state = Buffer.from(JSON.stringify({ p: payload, s: sig })).toString("base64url");

  const authorize = new URL("https://login.xero.com/identity/connect/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", (process.env.XERO_CLIENT_ID || "").trim());
  authorize.searchParams.set("redirect_uri", xeroRedirectUri());
  authorize.searchParams.set("scope", XERO_SCOPES);
  authorize.searchParams.set("state", state);

  return NextResponse.redirect(authorize.toString());
}
