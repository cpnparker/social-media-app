import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { exchangeXeroCode, listXeroTenants, XERO_SCOPES } from "@/lib/xero/client";

// GET /api/xero/callback — Xero redirects here after consent.
// Verifies the HMAC-signed state, exchanges the code, stores the connection.
export async function GET(req: NextRequest) {
  const base = (process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com").replace(/\/$/, "");
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/engineai?xero=error&reason=${encodeURIComponent(reason)}`);

  try {
    const code = req.nextUrl.searchParams.get("code");
    const stateRaw = req.nextUrl.searchParams.get("state");
    if (!code || !stateRaw) return fail("missing_code_or_state");

    let payload: string, sig: string;
    try {
      const st = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      payload = st.p; sig = st.s;
    } catch { return fail("bad_state"); }
    const expected = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "").update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return fail("state_signature");
    const { w: workspaceId, u: userId, t } = JSON.parse(payload);
    if (!workspaceId || Date.now() - t > 15 * 60_000) return fail("state_expired");

    const tok = await exchangeXeroCode(code);
    const tenants = await listXeroTenants(tok.access_token);
    if (!tenants.length) return fail("no_organisation");
    const tenant = tenants[0]; // single-org accounts; first = most recently authorised

    await intelligenceDb.from("xero_connections").upsert(
      {
        id_workspace: workspaceId,
        tenant_id: tenant.tenantId,
        name_tenant: tenant.tenantName,
        token_access: tok.access_token,
        token_refresh: tok.refresh_token,
        date_expires: new Date(Date.now() + (tok.expires_in || 1800) * 1000).toISOString(),
        scopes: tok.scope || XERO_SCOPES,
        user_connected: userId,
        date_updated: new Date().toISOString(),
      },
      { onConflict: "id_workspace" }
    );

    return NextResponse.redirect(`${base}/engineai?xero=connected`);
  } catch (err: any) {
    console.error("[Xero] Callback failed:", err?.message);
    return fail("exchange_failed");
  }
}
