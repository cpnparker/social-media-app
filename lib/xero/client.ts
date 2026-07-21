/**
 * Xero client (Phase 1: READ-ONLY finance queries for EngineAI).
 *
 * One connection per workspace (intelligence.xero_connections). Access tokens
 * live ~30 minutes; refresh tokens are single-use and rolling (60 days), so
 * every refresh MUST persist BOTH new tokens — losing a rotated refresh token
 * means the user has to reconnect.
 *
 * All entry points return { data, count, error?, notice? } shaped like the
 * other EngineAI tools so formatters/models handle them uniformly.
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const CONNECTIONS_URL = "https://api.xero.com/connections";

export const XERO_SCOPES =
  "openid profile email offline_access accounting.settings.read accounting.transactions.read accounting.contacts.read accounting.reports.read";

export function xeroRedirectUri(): string {
  return (
    process.env.XERO_REDIRECT_URI ||
    `${(process.env.NEXTAUTH_URL || "https://engine.thecontentengine.com").replace(/\/$/, "")}/api/xero/callback`
  );
}

function basicAuthHeader(): string {
  const id = (process.env.XERO_CLIENT_ID || "").trim();
  const secret = (process.env.XERO_CLIENT_SECRET || "").trim();
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function xeroConfigured(): boolean {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

export async function getXeroConnection(workspaceId: string) {
  const { data } = await intelligenceDb
    .from("xero_connections")
    .select("*")
    .eq("id_workspace", workspaceId)
    .maybeSingle();
  return data || null;
}

/** Exchange the OAuth authorization code (callback route). */
export async function exchangeXeroCode(code: string): Promise<{
  access_token: string; refresh_token: string; expires_in: number; scope?: string;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: xeroRedirectUri() }),
  });
  if (!res.ok) throw new Error(`Xero token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** List organisations the token can access (callback route picks one). */
export async function listXeroTenants(accessToken: string): Promise<{ tenantId: string; tenantName: string }[]> {
  const res = await fetch(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Xero connections lookup failed (${res.status})`);
  const rows = await res.json();
  return (rows || []).map((r: any) => ({ tenantId: r.tenantId, tenantName: r.tenantName || "Organisation" }));
}

/** Valid access token for the workspace, refreshing (and persisting the
 *  rotated refresh token) when within 2 minutes of expiry. */
async function getAccessToken(workspaceId: string): Promise<{ token: string; tenantId: string } | { error: string }> {
  const conn = await getXeroConnection(workspaceId);
  if (!conn) return { error: "not_connected" };
  const expiresAt = new Date(conn.date_expires).getTime();
  if (expiresAt - Date.now() > 2 * 60_000) {
    return { token: conn.token_access, tenantId: conn.tenant_id };
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.token_refresh }),
  });
  if (!res.ok) {
    console.error(`[Xero] Token refresh failed (${res.status}) for workspace ${workspaceId}`);
    // A dead refresh token (revoked / >60d idle) needs a human reconnect.
    return { error: res.status === 400 ? "reauth_required" : `refresh_failed_${res.status}` };
  }
  const tok = await res.json();
  await intelligenceDb
    .from("xero_connections")
    .update({
      token_access: tok.access_token,
      token_refresh: tok.refresh_token, // ROTATED — must persist
      date_expires: new Date(Date.now() + (tok.expires_in || 1800) * 1000).toISOString(),
      date_updated: new Date().toISOString(),
    })
    .eq("id_workspace", workspaceId);
  return { token: tok.access_token, tenantId: conn.tenant_id };
}

async function xeroGet(workspaceId: string, path: string, params?: Record<string, string>): Promise<any> {
  const auth = await getAccessToken(workspaceId);
  if ("error" in auth) throw new Error(auth.error);
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${API_BASE}/${path}${qs}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Xero-Tenant-Id": auth.tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Xero ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* ─────────────── Reports ─────────────── */

const dayMs = 86_400_000;
const daysOverdue = (dueDate: string | null) =>
  dueDate ? Math.floor((Date.now() - new Date(dueDate).getTime()) / dayMs) : null;

/** Xero serialises dates as "/Date(1618531200000+0000)/" in some payloads. */
function xd(v: any): string | null {
  if (!v) return null;
  const m = String(v).match(/\/Date\((\d+)/);
  if (m) return new Date(parseInt(m[1], 10)).toISOString().slice(0, 10);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchUnpaidInvoices(workspaceId: string): Promise<any[]> {
  // AUTHORISED ACCREC = approved sales invoices not yet fully paid.
  const j = await xeroGet(workspaceId, "Invoices", {
    where: 'Type=="ACCREC" AND Status=="AUTHORISED"',
    order: "DueDate",
  });
  return (j.Invoices || []).map((i: any) => ({
    number: i.InvoiceNumber,
    contact: i.Contact?.Name || "Unknown",
    date: xd(i.DateString || i.Date),
    due_date: xd(i.DueDateString || i.DueDate),
    days_overdue: Math.max(0, daysOverdue(xd(i.DueDateString || i.DueDate)) ?? 0),
    amount_due: i.AmountDue,
    total: i.Total,
    currency: i.CurrencyCode,
    status: i.Status,
  }));
}

export async function queryXero(
  report: string,
  workspaceId: string,
  opts: { date_from?: string; date_to?: string; client_name?: string } = {}
): Promise<{ data: any; count: number; error?: string; notice?: string }> {
  if (!xeroConfigured()) return { data: [], count: 0, error: "Xero is not configured on the server (missing XERO_CLIENT_ID/SECRET)" };
  try {
    const conn = await getXeroConnection(workspaceId);
    if (!conn) {
      return {
        data: [], count: 0,
        notice: "Xero is not connected for this workspace yet. Tell the user (briefly) that an admin can connect it in EngineAI → Administration → Integrations.",
      };
    }

    if (report === "unpaid_invoices") {
      let rows = await fetchUnpaidInvoices(workspaceId);
      if (opts.client_name) {
        const q = opts.client_name.toLowerCase();
        rows = rows.filter((r) => r.contact.toLowerCase().includes(q));
      }
      const totalDue = rows.reduce((s, r) => s + (Number(r.amount_due) || 0), 0);
      return { data: { invoices: rows.slice(0, 60), summary: { count: rows.length, total_due: Math.round(totalDue * 100) / 100, overdue: rows.filter((r) => r.days_overdue > 0).length } }, count: rows.length };
    }

    if (report === "aged_receivables") {
      const rows = await fetchUnpaidInvoices(workspaceId);
      const buckets = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 } as Record<string, number>;
      const byContact: Record<string, number> = {};
      for (const r of rows) {
        const amt = Number(r.amount_due) || 0;
        const d = r.days_overdue;
        const b = d <= 0 ? "current" : d <= 30 ? "1_30" : d <= 60 ? "31_60" : d <= 90 ? "61_90" : "over_90";
        buckets[b] += amt;
        if (d > 0) byContact[r.contact] = (byContact[r.contact] || 0) + amt;
      }
      const worst = Object.entries(byContact).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([contact, amount]) => ({ contact, overdue_amount: Math.round(amount * 100) / 100 }));
      for (const k of Object.keys(buckets)) buckets[k] = Math.round(buckets[k] * 100) / 100;
      return { data: { buckets, worst_overdue_contacts: worst, invoice_count: rows.length }, count: rows.length };
    }

    if (report === "profit_and_loss") {
      const to = opts.date_to || new Date().toISOString().slice(0, 10);
      const from = opts.date_from || `${to.slice(0, 4)}-01-01`;
      const j = await xeroGet(workspaceId, "Reports/ProfitAndLoss", { fromDate: from, toDate: to });
      const rpt = j.Reports?.[0];
      const lines: { section: string; line: string; amount: number }[] = [];
      for (const row of rpt?.Rows || []) {
        const section = row.Title || "";
        for (const sub of row.Rows || []) {
          const cells = sub.Cells || [];
          const label = cells[0]?.Value;
          const val = parseFloat(cells[cells.length - 1]?.Value);
          if (label && Number.isFinite(val)) lines.push({ section, line: label, amount: val });
        }
      }
      return { data: { period: { from, to }, report_name: rpt?.ReportName || "Profit and Loss", lines: lines.slice(0, 60) }, count: lines.length };
    }

    if (report === "revenue_by_client") {
      const to = opts.date_to || new Date().toISOString().slice(0, 10);
      const from = opts.date_from || `${to.slice(0, 4)}-01-01`;
      const j = await xeroGet(workspaceId, "Invoices", {
        where: `Type=="ACCREC" AND (Status=="AUTHORISED" OR Status=="PAID") AND Date>=DateTime(${from.replace(/-/g, ",")}) AND Date<=DateTime(${to.replace(/-/g, ",")})`,
        order: "Date DESC",
      });
      const byClient: Record<string, { invoiced: number; paid: number; invoices: number; currency: string }> = {};
      for (const i of j.Invoices || []) {
        const name = i.Contact?.Name || "Unknown";
        const e = (byClient[name] ||= { invoiced: 0, paid: 0, invoices: 0, currency: i.CurrencyCode || "" });
        e.invoiced += Number(i.Total) || 0;
        e.paid += Number(i.AmountPaid) || 0;
        e.invoices += 1;
      }
      const rows = Object.entries(byClient)
        .map(([client, v]) => ({ client, invoiced: Math.round(v.invoiced * 100) / 100, paid: Math.round(v.paid * 100) / 100, invoices: v.invoices, currency: v.currency }))
        .sort((a, b) => b.invoiced - a.invoiced);
      return { data: { period: { from, to }, by_client: rows.slice(0, 40) }, count: rows.length };
    }

    return { data: [], count: 0, error: `Unknown Xero report: ${report}` };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg === "not_connected") {
      return { data: [], count: 0, notice: "Xero is not connected for this workspace yet — an admin can connect it in EngineAI → Administration → Integrations." };
    }
    if (msg === "reauth_required") {
      return { data: [], count: 0, error: "The Xero connection has expired and needs to be reconnected (Administration → Integrations)." };
    }
    console.error("[Xero] Query failed:", msg);
    return { data: [], count: 0, error: `Xero query failed: ${msg.slice(0, 160)}` };
  }
}
