import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { getBaseSchema, listRecords, cellNumber, airtableConfigured } from "@/lib/airtable/client";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/airtable/reports";
import { assertNotKilled, ServiceControlError } from "@/lib/admin/service-control";

/**
 * GET /api/cron/client-summary-refresh — nightly per-client intelligence.
 *
 * Schedule: 03:00 CET daily. Also callable manually from the Clients page.
 *
 * ONE WRITER, MANY READERS (spec §8). Airtable allows 5 req/s per base with a
 * 220 ms enforced gap and the response cache is per-lambda-instance, so ten
 * people opening the client list at 09:00 on Tuesday across three cold
 * instances would blow the limit instantly. Everything Airtable-derived is
 * fetched here, once, and written to a snapshot the pages read.
 *
 * COST IS INDEPENDENT OF CLIENT COUNT. Every fetch below is a whole-table
 * read, joined in memory — at 40 clients or 400 the request count is the same.
 * The only per-client work is the email summary, which is why that is bounded
 * hard (see EMAIL_MAX_CLIENTS).
 *
 * WHAT IT STORES: source values, never computed signal bands. "Behind pace" is
 * derived on read, so changing a threshold does not require rewriting history,
 * and a reader can always see the numbers a signal came from.
 *
 * WHAT IT NEVER STORES AS ZERO: anything it could not read. A source that
 * fails writes null and records the failure in data_sources, because a 0 in a
 * delivery column is indistinguishable from "we could not reach Engine" once
 * it is on a page in front of a meeting.
 */
export const maxDuration = 300;

/** Whose mailbox the correspondence summaries come from. */
const MAILBOX_OWNER = process.env.CLIENT_SUMMARY_MAILBOX || "chris@thecontentengine.com";
/**
 * Hard cap on per-client email work.
 *
 * Everything else in this job is a whole-table read. Email is the one
 * per-client cost — a mailbox search plus an LLM summary each — so it is
 * bounded to the clients most likely to be discussed, ordered by recent
 * activity. Without a cap this job's cost grows with the client list while
 * every other part of it stays flat.
 */
const EMAIL_MAX_CLIENTS = 25;
const EMAIL_WINDOW_DAYS = 90;
const MEETING_WINDOW_DAYS = 90;
const INTERNAL_CLIENT_IDS = new Set([1, 2]);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Strip addresses from any text destined for a workspace-readable column. */
function stripAddresses(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : "";
  if (!text) return null;
  const out = text.replace(EMAIL_RE, "").replace(/\s{2,}/g, " ").trim();
  return out || null;
}

const num = (v: unknown): number | null => {
  const x = cellNumber(v as any);
  return typeof x === "number" ? x : null;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await assertNotKilled("engine", "client-summary-refresh");
  } catch (e) {
    if (e instanceof ServiceControlError) return NextResponse.json({ skipped: e.message });
    throw e;
  }

  const startedAt = new Date().toISOString();
  const sources: Record<string, { ok: boolean; at: string; note?: string }> = {};
  const mark = (k: string, ok: boolean, note?: string) => {
    sources[k] = { ok, at: new Date().toISOString(), ...(note ? { note } : {}) };
  };

  const { data: runRow } = await intelligenceDb
    .from("ai_client_summary_run")
    .insert({ date_started: startedAt })
    .select("id_run")
    .maybeSingle();
  const idRun = (runRow as any)?.id_run;

  const today = new Date().toISOString().slice(0, 10);
  let errors = 0;

  // ── 1. Engine: clients and contracts ──
  const { data: clientRows, error: clientErr } = await supabase
    .from("app_clients")
    .select("id_client, name_client, information_industry, link_website, name_account_manager, flag_active");
  mark("engine_clients", !clientErr, clientErr?.message);
  if (clientErr || !clientRows) {
    await intelligenceDb.from("ai_client_summary_run").update({
      date_finished: new Date().toISOString(), count_errors: 1,
      information_error: `clients unreadable: ${clientErr?.message}`, data_sources: sources,
    }).eq("id_run", idRun);
    return NextResponse.json({ error: "Engine clients unreadable" }, { status: 502 });
  }
  const clients = (clientRows as any[]).filter((c) => !INTERNAL_CLIENT_IDS.has(c.id_client));

  let engineContracts: any[] = [];
  try {
    engineContracts = await fetchAllRows((f, t) =>
      supabase.from("app_contracts")
        .select("id_contract, id_client, name_contract, flag_active, units_contract, units_total_completed, date_start, date_end")
        .order("id_contract", { ascending: true }).range(f, t));
    mark("engine_contracts", true);
  } catch (e: any) { mark("engine_contracts", false, String(e?.message || e)); errors++; }

  // ── 2. Engine: task union, for delivery ──
  const deliveryByClient = new Map<number, {
    total: number; sawUnit: boolean; byMonth: Map<string, number>;
    inFlight: number; spiked: number; last: string | null; ever: boolean;
  }>();
  const since12m = new Date(); since12m.setMonth(since12m.getMonth() - 12);
  const since12mStr = since12m.toISOString().slice(0, 10);
  try {
    for (const table of ["app_tasks_content", "app_tasks_social"]) {
      const rows = await fetchAllRows((f, t) =>
        supabase.from(table).select("id_task, id_client, units_content, date_completed, flag_spiked")
          .order("id_task", { ascending: true }).range(f, t));
      for (const r of rows as any[]) {
        if (r.id_client == null || INTERNAL_CLIENT_IDS.has(r.id_client)) continue;
        const e = deliveryByClient.get(r.id_client) || {
          total: 0, sawUnit: false, byMonth: new Map(), inFlight: 0, spiked: 0, last: null, ever: false,
        };
        e.ever = true;
        if (String(r.flag_spiked) === "1") { e.spiked++; deliveryByClient.set(r.id_client, e); continue; }
        if (!r.date_completed) { e.inFlight++; deliveryByClient.set(r.id_client, e); continue; }
        const d = String(r.date_completed).slice(0, 10);
        if (!e.last || d > e.last) e.last = d;
        if (d >= since12mStr) {
          const u = Number(r.units_content);
          if (Number.isFinite(u)) {
            e.sawUnit = true; e.total += u;
            const m = d.slice(0, 7);
            e.byMonth.set(m, (e.byMonth.get(m) || 0) + u);
          }
        }
        deliveryByClient.set(r.id_client, e);
      }
    }
    mark("engine_tasks", true);
  } catch (e: any) { mark("engine_tasks", false, String(e?.message || e)); errors++; }

  // ── 3. Airtable: the plan ──
  const airtableByClient = new Map<number, any>();
  if (!airtableConfigured()) {
    mark("airtable", false, "not configured on this server");
  } else {
    try {
      const { tables } = await getBaseSchema();
      if (!tables.find((t) => t.name === "Customer")) throw new Error("Customer table missing");
      const [customers, team, contracts] = await Promise.all([
        listRecords("Customer", { fields: ["Customer", "Engine ID"] }),
        listRecords("Team", { fields: ["Name"] }),
        listRecords("Contracts", {
          fields: ["Contract name", "Customer", "Account Manager", "Booking status",
            "Start date", "End date", "Contracted CUs", "Remaining CUs",
            "Contract ending days", "Total contracted value (CHF)"],
        }),
      ]);
      const truncated = [customers, team, contracts].filter((r) => r.truncated).length;
      const teamNames = new Map(team.records.map((r) => [r.id, String(r.fields["Name"] ?? "")]));
      const engineIdByRec = new Map<string, number>();
      for (const c of customers.records) {
        const id = cellNumber(c.fields["Engine ID"]);
        if (typeof id === "number") engineIdByRec.set(c.id, id);
      }
      const LIVE = new Set<string>(ACTIVE_BOOKING_STATUSES as readonly string[]);
      for (const rec of contracts.records) {
        const custRec = Array.isArray(rec.fields["Customer"]) ? String((rec.fields["Customer"] as any[])[0]) : "";
        const idClient = engineIdByRec.get(custRec);
        if (idClient === undefined) continue;
        const managers = (Array.isArray(rec.fields["Account Manager"]) ? (rec.fields["Account Manager"] as any[]) : [])
          .map((x) => teamNames.get(String(x))).filter((x): x is string => !!x);
        const e = airtableByClient.get(idClient) || { live: [], all: [], managers: new Set<string>() };
        const shaped = {
          name: String(rec.fields["Contract name"] ?? "(unnamed)"),
          bookingStatus: (rec.fields["Booking status"] as string) ?? null,
          startDate: (rec.fields["Start date"] as string) ?? null,
          endDate: (rec.fields["End date"] as string) ?? null,
          endingInDays: num(rec.fields["Contract ending days"]),
          contractedCu: num(rec.fields["Contracted CUs"]),
          remainingCu: num(rec.fields["Remaining CUs"]),
          valueChf: num(rec.fields["Total contracted value (CHF)"]),
        };
        e.all.push(shaped);
        if (shaped.bookingStatus && LIVE.has(shaped.bookingStatus)) {
          e.live.push(shaped);
          for (const m of managers) e.managers.add(m);
        }
        airtableByClient.set(idClient, e);
      }
      mark("airtable", true, truncated ? `${truncated} table(s) TRUNCATED — partial` : undefined);
      if (truncated) errors++;
    } catch (e: any) { mark("airtable", false, String(e?.message || e)); errors++; }
  }

  // ── 4. Meetings ──
  const meetingsByClient = new Map<number, { count: number; last: string | null; recent: any[] }>();
  const clientsWithDomain = new Set<number>();
  try {
    const { loadClientDomainMap, queryMeetingBrain } = await import("@/lib/ai/providers");
    const internalDomain = MAILBOX_OWNER.split("@")[1] || "";
    const domainMap = await loadClientDomainMap(internalDomain);
    for (const [, v] of Array.from(domainMap.entries())) if (v.id > 0) clientsWithDomain.add(v.id);

    const res = await queryMeetingBrain("client_meetings", MAILBOX_OWNER, {
      days: MEETING_WINDOW_DAYS, visibility: "team",
    });
    if (res.error) throw new Error(res.error);
    for (const m of ((res.data as any[]) || [])) {
      if (m.client_id == null) continue;
      const e = meetingsByClient.get(m.client_id) || { count: 0, last: null, recent: [] };
      e.count++;
      const d = String(m.date || "").slice(0, 10);
      if (d && (!e.last || d > e.last)) e.last = d;
      if (e.recent.length < 5) {
        e.recent.push({ date: d, title: m.title, summary: stripAddresses(m.summary)?.slice(0, 400) ?? null });
      }
      meetingsByClient.set(m.client_id, e);
    }
    mark("meetings", true);
  } catch (e: any) { mark("meetings", false, String(e?.message || e)); errors++; }

  // ── 5. Write ──
  let written = 0;
  for (const c of clients) {
    const at = airtableByClient.get(c.id_client);
    const del = deliveryByClient.get(c.id_client);
    const mtg = meetingsByClient.get(c.id_client);

    const live = (engineContracts as any[]).filter(
      (x) => x.id_client === c.id_client && x.flag_active === 1 &&
        (!x.date_end || String(x.date_end).slice(0, 10) >= today));
    const notStarted = live.filter((x) => x.date_start && String(x.date_start).slice(0, 10) > today);

    const amAirtable = at && at.managers.size ? Array.from(at.managers).join(", ") : null;
    const soonest = at?.live.map((x: any) => x.endingInDays)
      .filter((d: number | null): d is number => d != null && d >= 0).sort((a: number, b: number) => a - b)[0] ?? null;

    const row: Record<string, any> = {
      id_client: c.id_client,
      name_client: c.name_client,
      information_industry: c.information_industry || null,
      link_website: c.link_website || null,
      name_account_manager_engine: c.name_account_manager || null,
      name_account_manager_airtable: amAirtable,
      flag_am_disagrees: amAirtable && c.name_account_manager && amAirtable !== c.name_account_manager ? 1 : 0,

      // Airtable columns stay NULL when Airtable failed — never 0, which on a
      // page reads as "nothing is expiring".
      count_contracts_live: sources.airtable?.ok ? (at?.live.length ?? 0) : null,
      units_contracted: sources.airtable?.ok
        ? (at?.live.reduce((s: number, x: any) => s + (x.contractedCu ?? 0), 0) ?? null) : null,
      units_remaining: sources.airtable?.ok
        ? (at?.live.reduce((s: number, x: any) => s + (x.remainingCu ?? 0), 0) ?? null) : null,
      days_soonest_end: soonest,
      date_soonest_end: at?.live.map((x: any) => x.endDate).filter(Boolean).sort()[0] ?? null,
      value_contracted_chf: sources.airtable?.ok
        ? (at?.live.reduce((s: number, x: any) => s + (x.valueChf ?? 0), 0) ?? null) : null,
      data_contracts: at ? { live: at.live, all: at.all } : null,

      units_delivered_12m: sources.engine_tasks?.ok ? (del?.sawUnit ? del.total : null) : null,
      data_delivery_by_month: del
        ? Array.from(del.byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, cu]) => ({ month, cu }))
        : null,
      count_in_flight: sources.engine_tasks?.ok ? (del?.inFlight ?? 0) : null,
      count_spiked: sources.engine_tasks?.ok ? (del?.spiked ?? 0) : null,
      date_last_delivered: del?.last ?? null,
      flag_ever_had_tasks: del?.ever ? 1 : 0,
      count_not_started: sources.engine_contracts?.ok ? notStarted.length : null,
      date_starts_on: notStarted.map((x) => String(x.date_start).slice(0, 10)).sort()[0] ?? null,

      count_meetings_90d: sources.meetings?.ok ? (mtg?.count ?? 0) : null,
      date_last_meeting: mtg?.last ?? null,
      data_recent_meetings: mtg?.recent ?? null,
      // "cannot look" is not "looked and found nothing", and a page that
      // conflates them tells someone a relationship has gone quiet when the
      // truth is that nobody registered a domain.
      flag_no_domain: clientsWithDomain.has(c.id_client) ? 0 : 1,

      data_sources: sources,
      date_refreshed: new Date().toISOString(),
    };

    const { error } = await intelligenceDb
      .from("ai_client_summary_snapshot")
      .upsert(row, { onConflict: "id_client" });
    if (error) { errors++; console.error(`[ClientSummary] write failed for ${c.id_client}: ${error.message}`); }
    else written++;
  }

  await intelligenceDb.from("ai_client_summary_run").update({
    date_finished: new Date().toISOString(),
    count_clients: written,
    count_errors: errors,
    data_sources: sources,
  }).eq("id_run", idRun);

  console.log(`[ClientSummary] ${written} client(s) written, ${errors} error(s), sources: ${Object.entries(sources).map(([k, v]) => `${k}=${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  return NextResponse.json({ written, errors, sources, emailPass: "separate — see client-summary-email" });
}
