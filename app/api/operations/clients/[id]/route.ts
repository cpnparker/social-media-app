import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { getBaseSchema, listRecords, cellNumber, airtableConfigured } from "@/lib/airtable/client";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/airtable/reports";
import { requireTceStaff, hasFinanceAccess } from "../_lib/access";

/**
 * GET /api/operations/clients/[id]?workspaceId=…
 *
 * One client, read top to bottom by someone who has never touched the account.
 * docs/client-summary-spec.md §6.
 *
 * BUILT: header identity + account manager, contracts (Airtable, bucketed),
 * delivery (Engine, 12-month buckets), client meetings (90 days).
 *
 * NOT BUILT, deliberately, and the page says so rather than showing an empty
 * panel: the Tuesday walk-through (§6.7) needs a new table and a nightly
 * extraction job, and the full signal engine (§7) needs pace thresholds this
 * data cannot yet support. An absent section that explains itself is honest;
 * one that renders empty reads as "nothing to report".
 *
 * The rules this inherits from the landing route and the spec:
 *  - null is never 0. "not recorded" and "none" are different answers.
 *  - a source that failed says so; it never degrades into an empty list.
 *  - ATTENDEES ARE STRIPPED OF EMAIL ADDRESSES. Google sets a calendar
 *    attendee's `name` to their email when there is no display name, so the
 *    "names only" RPC does return live client addresses. ~60 staff can open
 *    this page. See stripAddresses().
 */
export const maxDuration = 60;

const MEETING_WINDOW_DAYS = 90;
const DELIVERY_MONTHS = 12;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Remove anything that looks like an email address from attendee text.
 *
 * The RPC's own comment says it returns names, not addresses. That is true of
 * what it INTENDS: it reads `a->>'name'`. But Google Calendar populates `name`
 * with the address when an invitee has no display name set, so real client
 * addresses come through this field — the spec names four live examples.
 *
 * Dropping the whole field on a match would lose the genuine names alongside
 * the addresses, so each address is removed individually and the remainder
 * kept. If nothing survives, the field is omitted rather than rendered blank.
 */
function stripAddresses(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : "";
  if (!text) return null;
  const cleaned = text
    .replace(EMAIL_RE, "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .join(", ");
  return cleaned || null;
}

/** A number, or null. Never a zero standing in for "not recorded". */
function n(v: unknown): number | null {
  const x = cellNumber(v as any);
  return typeof x === "number" ? x : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTceStaff();
  if (gate instanceof NextResponse) return gate;

  const { id } = await ctx.params;
  const idClient = Number(id);
  if (!Number.isFinite(idClient)) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  const workspaceId = new URL(req.url).searchParams.get("workspaceId") || "";
  const showMoney = workspaceId ? await hasFinanceAccess(gate.userId, workspaceId) : false;

  const warnings: string[] = [];
  const notBuilt: string[] = [
    "Tuesday walk-through — needs the nightly extraction job and its table (spec §6.7)",
    "Automated attention signals — pace thresholds need a verified percent scale (spec §7)",
  ];

  // ── Identity ──
  const { data: client, error: clientErr } = await supabase
    .from("app_clients")
    .select("id_client, name_client, information_industry, information_description, link_website, name_account_manager")
    .eq("id_client", idClient)
    .maybeSingle();

  if (clientErr) return NextResponse.json({ error: `Engine unavailable: ${clientErr.message}` }, { status: 502 });
  if (!client) return NextResponse.json({ error: "No such client" }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);

  // ── Delivery (Engine) ──
  // Contracts first, then completed tasks bucketed by month.
  const contractsRes = await fetchAllRows((from, to) =>
    supabase
      .from("app_contracts")
      .select("id_contract, name_contract, flag_active, units_contract, units_total_completed, date_start, date_end")
      .eq("id_client", idClient)
      .order("id_contract", { ascending: true })
      .range(from, to)
  ).then((data) => ({ data, error: null as any })).catch((e) => ({ data: [] as any[], error: e }));

  if (contractsRes.error) {
    warnings.push("Engine contracts could not be read — contract figures are unavailable, not zero.");
  }

  const since = new Date();
  since.setMonth(since.getMonth() - DELIVERY_MONTHS);
  const sinceStr = since.toISOString().slice(0, 10);

  // Both task tables, exactly as engine-actuals unions them. Spiked work is
  // SHOWN, not hidden — cancelled work is signal for a stand-in AM.
  let delivery: {
    totalCu: number | null;
    byMonth: { month: string; cu: number }[];
    inFlight: number;
    spiked: number;
    missingUnits: number;
    lastCompleted: string | null;
  } | null = null;

  try {
    const rows: any[] = [];
    for (const table of ["app_tasks_content", "app_tasks_social"]) {
      const part = await fetchAllRows((from, to) =>
        supabase
          .from(table)
          .select("id_task, units_content, date_completed, flag_spiked")
          .eq("id_client", idClient)
          .order("id_task", { ascending: true })
          .range(from, to)
      );
      rows.push(...part);
    }
    const byMonth = new Map<string, number>();
    let totalCu = 0, inFlight = 0, spiked = 0, missingUnits = 0, sawAnyUnit = false;
    let lastCompleted: string | null = null;

    for (const r of rows) {
      if (String(r.flag_spiked) === "1") { spiked++; continue; }
      if (!r.date_completed) { inFlight++; continue; }
      const d = String(r.date_completed).slice(0, 10);
      if (!lastCompleted || d > lastCompleted) lastCompleted = d;
      if (d < sinceStr) continue;
      const u = Number(r.units_content);
      if (!Number.isFinite(u)) { missingUnits++; continue; }
      sawAnyUnit = true;
      totalCu += u;
      const m = d.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) || 0) + u);
    }
    delivery = {
      // Null when nothing carried a unit figure at all — that is "not
      // recorded", which is not the same as a genuine zero.
      totalCu: sawAnyUnit ? totalCu : null,
      byMonth: Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, cu]) => ({ month, cu })),
      inFlight, spiked, missingUnits, lastCompleted,
    };
  } catch (e: any) {
    // Never a zero. The spec is explicit: a failed query must not read as "this
    // client has delivered nothing".
    warnings.push(`Delivery could not be read (${String(e?.message || e).slice(0, 120)}) — figures are unavailable, not zero.`);
  }

  // ── Contracts (Airtable) ──
  let airtable: {
    ok: boolean;
    live: any[];
    upcoming: any[];
    pipeline: any[];
    history: any[];
    accountManager: string | null;
  } = { ok: false, live: [], upcoming: [], pipeline: [], history: [], accountManager: null };

  if (!airtableConfigured()) {
    warnings.push("Airtable is not connected on this server — contract and account-manager panels are unavailable, not empty.");
  } else {
    try {
      const { tables } = await getBaseSchema();
      if (!tables.find((t) => t.name === "Customer")) throw new Error("Customer table missing");

      const [customers, team, contracts] = await Promise.all([
        listRecords("Customer", { fields: ["Customer", "Engine ID"] }),
        listRecords("Team", { fields: ["Name"] }),
        listRecords("Contracts", {
          fields: [
            "Contract name", "Customer", "Account Manager", "Booking status",
            "Start date", "End date", "Contracted CUs", "Remaining CUs",
            "Contract ending days", "Total contracted value (CHF)",
          ],
        }),
      ]);
      for (const [label, res] of [["Customer", customers], ["Team", team], ["Contracts", contracts]] as const) {
        if (res.truncated) warnings.push(`Airtable "${label}" was TRUNCATED — this is a partial list, not the whole one.`);
      }

      const teamNames = new Map(team.records.map((r) => [r.id, String(r.fields["Name"] ?? "")]));
      const custRecIds = new Set(
        customers.records.filter((c) => cellNumber(c.fields["Engine ID"]) === idClient).map((c) => c.id)
      );

      const mine = contracts.records.filter((r) => {
        const cust = Array.isArray(r.fields["Customer"]) ? (r.fields["Customer"] as any[]).map(String) : [];
        return cust.some((c) => custRecIds.has(c));
      });

      const shape = (r: any) => ({
        name: String(r.fields["Contract name"] ?? "(unnamed)"),
        bookingStatus: (r.fields["Booking status"] as string) ?? null,
        startDate: (r.fields["Start date"] as string) ?? null,
        endDate: (r.fields["End date"] as string) ?? null,
        endingInDays: n(r.fields["Contract ending days"]),
        contractedCu: n(r.fields["Contracted CUs"]),
        // Never recomputed from contracted − commissioned. If Airtable's own
        // figure disagrees with that arithmetic, that disagreement is a fact
        // about the base, not something to paper over here (spec §6.3).
        remainingCu: n(r.fields["Remaining CUs"]),
        managers: (Array.isArray(r.fields["Account Manager"]) ? (r.fields["Account Manager"] as any[]) : [])
          .map((x) => teamNames.get(String(x)))
          .filter((x): x is string => !!x),
        ...(showMoney ? { valueChf: n(r.fields["Total contracted value (CHF)"]) } : {}),
      });

      const all = mine.map(shape);
      const LIVE = new Set<string>(ACTIVE_BOOKING_STATUSES as readonly string[]);
      airtable = {
        ok: true,
        live: all.filter((c) => c.bookingStatus && LIVE.has(c.bookingStatus)),
        upcoming: all.filter((c) => c.bookingStatus === "Booked"),
        pipeline: all.filter((c) => c.bookingStatus === "Opportunity"),
        history: all.filter((c) => c.bookingStatus === "Ended" || c.bookingStatus === "Lost"),
        accountManager: null,
      };
      const managers = Array.from(new Set(airtable.live.flatMap((c) => c.managers)));
      airtable.accountManager = managers.length ? managers.join(", ") : null;
    } catch (e: any) {
      warnings.push(`Airtable unavailable (${String(e?.message || e).slice(0, 140)}) — contract panels are unavailable, not empty.`);
    }
  }

  // ── Client meetings ──
  // Two empty states that must never be conflated: "we looked and found
  // nothing" versus "this client has no registered domain, so we cannot look".
  let meetings: {
    state: "ok" | "no_domain" | "unavailable";
    windowDays: number;
    rows: any[];
    detail?: string;
  } = { state: "unavailable", windowDays: MEETING_WINDOW_DAYS, rows: [] };

  try {
    const { loadClientDomainMap, queryMeetingBrain } = await import("@/lib/ai/providers");
    const internalDomain = gate.email.split("@")[1] || "";
    const domainMap = await loadClientDomainMap(internalDomain);
    const myDomains = new Set(
      Array.from(domainMap.entries()).filter(([, v]) => v.id === idClient).map(([d]) => d)
    );

    if (myDomains.size === 0) {
      meetings = {
        state: "no_domain",
        windowDays: MEETING_WINDOW_DAYS,
        rows: [],
        detail: "No website is registered for this client, so client meetings cannot be matched to it at all. This is different from having no meetings.",
      };
    } else {
      const res = await queryMeetingBrain("client_meetings", gate.email, {
        days: MEETING_WINDOW_DAYS,
        visibility: "team",
        workspaceId: workspaceId || undefined,
      });
      if (res.error) {
        meetings = { state: "unavailable", windowDays: MEETING_WINDOW_DAYS, rows: [], detail: res.error };
      } else {
        const rows = ((res.data as any[]) || [])
          .filter((m) => m.client_id === idClient)
          .map((m) => ({
            meetingId: m.meeting_id,
            title: m.title,
            date: m.date,
            summary: m.summary ?? null,
            keyTopics: m.key_topics ?? null,
            nextSteps: m.next_steps ?? null,
            // The privacy rule. See stripAddresses().
            attendees: stripAddresses(m.attendees),
            meetingKind: m.meeting_kind ?? null,
          }));
        meetings = { state: "ok", windowDays: MEETING_WINDOW_DAYS, rows };
      }
    }
  } catch (e: any) {
    meetings = {
      state: "unavailable",
      windowDays: MEETING_WINDOW_DAYS,
      rows: [],
      detail: String(e?.message || e).slice(0, 160),
    };
  }

  const engineContracts = (contractsRes.data || []) as any[];
  const isLive = (c: any) => c.flag_active === 1 && (!c.date_end || String(c.date_end).slice(0, 10) >= today);

  return NextResponse.json({
    client: {
      idClient: client.id_client,
      name: client.name_client,
      industry: client.information_industry || null,
      description: client.information_description || null,
      website: client.link_website || null,
      accountManagerEngine: client.name_account_manager || null,
      accountManagerAirtable: airtable.accountManager,
      // Shown, not resolved. A handover that landed in one system only is a
      // real thing that a stand-in AM needs to know about.
      accountManagerDisagrees:
        !!airtable.accountManager &&
        !!client.name_account_manager &&
        airtable.accountManager !== client.name_account_manager,
    },
    engine: contractsRes.error
      ? null
      : {
          contracts: engineContracts.map((c) => ({
            idContract: c.id_contract,
            name: c.name_contract,
            live: isLive(c),
            contractedCu: Number.isFinite(Number(c.units_contract)) ? Number(c.units_contract) : null,
            deliveredCu: Number.isFinite(Number(c.units_total_completed)) ? Number(c.units_total_completed) : null,
            startDate: c.date_start || null,
            endDate: c.date_end || null,
          })),
          liveCount: engineContracts.filter(isLive).length,
        },
    delivery,
    airtable: airtable.ok ? airtable : null,
    meetings,
    showMoney,
    warnings,
    notBuilt,
    sources: {
      engine: clientErr ? "unavailable" : "live",
      engineContracts: contractsRes.error ? "unavailable" : "live",
      airtable: airtableConfigured() ? (airtable.ok ? "live" : "unavailable") : "not configured",
      meetings: meetings.state,
    },
    fetchedAt: new Date().toISOString(),
  });
}
