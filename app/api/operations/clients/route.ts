import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { getBaseSchema, listRecords, cellNumber, airtableConfigured, AMBIGUOUS } from "@/lib/airtable/client";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/airtable/reports";
import { requireTceStaff, hasFinanceAccess } from "./_lib/access";

/**
 * GET /api/operations/clients?workspaceId=…
 *
 * One row per CLIENT — not per contract. A client with three live contracts is
 * one relationship with three contracts, which is how the Tuesday run-through
 * walks it.
 *
 * Three sources, each authoritative for a different thing:
 *   Engine    — what was actually DELIVERED, and which clients are live.
 *   Airtable  — the account manager and the commercial position.
 *   (Money is gated per viewer; the forecast sheet is not read here.)
 *
 * The rules this section inherits, each learned the hard way in this repo:
 *  - "Active" in Airtable is THREE values, not one.
 *  - Link fields hold record IDs, so they must be resolved or the page prints "rec…".
 *  - null is never rendered as 0. Not recorded and none are different answers.
 *  - No client is dropped for failing to join. Unmatched rows are LABELLED.
 *  - A partial read is never presented as complete.
 */
export const maxDuration = 60;

/** Internal client ids — TCE's own work, not a customer. */
const INTERNAL_CLIENT_IDS = new Set([1, 2]);

type JoinState = "matched" | "engine_only" | "airtable_only" | "duplicate_engine_id";

export async function GET(req: Request) {
  const gate = await requireTceStaff();
  if (gate instanceof NextResponse) return gate;

  const workspaceId = new URL(req.url).searchParams.get("workspaceId") || "";
  const showMoney = workspaceId ? await hasFinanceAccess(gate.userId, workspaceId) : false;

  const warnings: string[] = [];

  // ── Engine: live clients and their contracts ──
  const [clientsRes, contractsRes] = await Promise.all([
    supabase.from("app_clients").select("id_client, name_client, information_industry, link_website, name_account_manager"),
    fetchAllRows((from, to) =>
      supabase
        .from("app_contracts")
        .select("id_contract, name_contract, id_client, flag_active, units_contract, units_total_completed, date_start, date_end")
        .order("id_contract", { ascending: true })
        .range(from, to)
    ).then((data) => ({ data, error: null as any })).catch((e) => ({ data: [] as any[], error: e })),
  ]);

  if (clientsRes.error) {
    return NextResponse.json({ error: `Engine clients unavailable: ${clientsRes.error.message}` }, { status: 502 });
  }
  if (contractsRes.error) {
    warnings.push("Engine contracts could not be read — contract columns are unavailable, not empty.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const engineContracts = (contractsRes.data || []) as any[];

  // "Live" means flag_active AND not past its end date. flag_active alone
  // leaves contracts that ended months ago looking current; date_end alone
  // includes ones deactivated early. A contract with NO end date is treated as
  // live, because an open-ended retainer is the common case for that.
  const isLive = (c: any) =>
    c.flag_active === 1 && (!c.date_end || String(c.date_end).slice(0, 10) >= today);

  const liveByClient = new Map<number, any[]>();
  for (const c of engineContracts) {
    if (!isLive(c)) continue;
    if (!c.id_client || INTERNAL_CLIENT_IDS.has(c.id_client)) continue;
    const list = liveByClient.get(c.id_client) || [];
    list.push(c);
    liveByClient.set(c.id_client, list);
  }

  // ── Airtable: account manager and commercial position ──
  let airtableOk = false;
  const amByEngineId = new Map<number, { manager: string | null; contracts: any[] }>();
  const duplicateEngineIds = new Set<number>();
  const airtableOnly: { customer: string; reason: string }[] = [];

  if (!airtableConfigured()) {
    warnings.push("Airtable is not connected on this server, so account manager and renewal columns are unavailable.");
  } else {
    try {
      const { tables } = await getBaseSchema();
      const teamTable = tables.find((t) => t.name === "Team");
      const customerTable = tables.find((t) => t.name === "Customer");
      if (!teamTable || !customerTable) throw new Error("Customer or Team table missing from the base");

      const [customers, team, contracts] = await Promise.all([
        listRecords("Customer", { fields: ["Customer", "Engine ID"] }),
        listRecords("Team", { fields: ["Name"] }),
        listRecords("Contracts", {
          // The ACTIVE SET, not the string "Active" — extended and
          // late-delivery contracts are exactly the ones needing attention.
          filterByFormula: `OR(${ACTIVE_BOOKING_STATUSES.map((s) => `{Booking status} = "${s}"`).join(", ")})`,
          fields: [
            "Contract name", "Customer", "Account Manager", "Booking status",
            "End date", "Contract ending days", "Contract delivered %",
            "Contracted CUs", "Remaining CUs", "Total contracted value (CHF)",
          ],
        }),
      ]);

      for (const [label, res] of [["Customer", customers], ["Team", team], ["Contracts", contracts]] as const) {
        if (res.truncated) {
          warnings.push(`Airtable "${label}" was TRUNCATED — this is a partial list, not the whole one.`);
        }
      }

      const teamNames = new Map(team.records.map((r) => [r.id, String(r.fields["Name"] ?? "")]));
      const customerById = new Map(customers.records.map((r) => [r.id, r]));

      // Customer.'Engine ID' is the join. Built as a map so a duplicate is
      // detected rather than silently resolved to whichever came first.
      const engineIdByCustomerRec = new Map<string, number>();
      const seenEngineIds = new Map<number, string>();
      for (const c of customers.records) {
        const id = cellNumber(c.fields["Engine ID"]);
        if (typeof id !== "number") {
          airtableOnly.push({
            customer: String(c.fields["Customer"] ?? "(unnamed)"),
            reason: id === AMBIGUOUS ? "Engine ID is not a single value" : "no Engine ID set",
          });
          continue;
        }
        if (seenEngineIds.has(id)) duplicateEngineIds.add(id);
        seenEngineIds.set(id, c.id);
        engineIdByCustomerRec.set(c.id, id);
      }

      for (const rec of contracts.records) {
        const custRec = Array.isArray(rec.fields["Customer"]) ? String((rec.fields["Customer"] as any[])[0]) : "";
        const engineId = engineIdByCustomerRec.get(custRec);
        if (engineId === undefined) continue;

        const managers = (Array.isArray(rec.fields["Account Manager"]) ? (rec.fields["Account Manager"] as any[]) : [])
          .map((id) => teamNames.get(String(id)))
          .filter((n): n is string => !!n);

        const entry = amByEngineId.get(engineId) || { manager: null, contracts: [] };
        if (!entry.manager && managers.length) entry.manager = managers.join(", ");
        const num = (f: string) => {
          const v = cellNumber(rec.fields[f]);
          return typeof v === "number" ? v : null;
        };
        entry.contracts.push({
          name: String(rec.fields["Contract name"] ?? "(unnamed)"),
          bookingStatus: (rec.fields["Booking status"] as string) ?? null,
          endDate: (rec.fields["End date"] as string) ?? null,
          endingInDays: num("Contract ending days"),
          deliveredPct: num("Contract delivered %"),
          contractedCu: num("Contracted CUs"),
          remainingCu: num("Remaining CUs"),
          // Money is omitted from the payload entirely for non-finance
          // viewers, rather than hidden in the UI — a value that reaches the
          // browser has left the building.
          ...(showMoney ? { valueChf: num("Total contracted value (CHF)") } : {}),
        });
        amByEngineId.set(engineId, entry);
      }
      airtableOk = true;
      if (duplicateEngineIds.size) {
        warnings.push(
          `${duplicateEngineIds.size} Engine ID(s) are claimed by more than one Airtable Customer row — those clients ` +
            `show no account manager rather than an arbitrary one.`
        );
      }
    } catch (e: any) {
      warnings.push(`Airtable unavailable (${String(e?.message || e).slice(0, 160)}) — account manager and renewal columns are unavailable, not empty.`);
    }
  }

  // ── One row per client ──
  const rows = (clientsRes.data || [])
    .filter((c: any) => !INTERNAL_CLIENT_IDS.has(c.id_client))
    .map((c: any) => {
      const live = liveByClient.get(c.id_client) || [];
      const at = amByEngineId.get(c.id_client);
      const ambiguous = duplicateEngineIds.has(c.id_client);

      const joinState: JoinState = ambiguous
        ? "duplicate_engine_id"
        : at
          ? "matched"
          : "engine_only";

      const contractedCu = live.reduce((s, x) => s + (Number(x.units_contract) || 0), 0);
      const deliveredCu = live.reduce((s, x) => s + (Number(x.units_total_completed) || 0), 0);
      const soonest = at?.contracts
        .map((x: any) => x.endingInDays)
        .filter((d: number | null): d is number => d != null && d >= 0)
        .sort((a: number, b: number) => a - b)[0];

      return {
        idClient: c.id_client,
        name: c.name_client,
        industry: c.information_industry || null,
        website: c.link_website || null,
        joinState,
        // Chris's column 1 — Airtable is the source. Engine's own AM field is
        // returned alongside so a disagreement is visible rather than resolved
        // silently in favour of whichever was asked for.
        accountManager: ambiguous ? null : at?.manager ?? null,
        accountManagerEngine: c.name_account_manager || null,
        accountManagerDisagrees:
          !!at?.manager && !!c.name_account_manager && at.manager !== c.name_account_manager,
        // Column 2 — the contract summary, from Engine, which knows delivery.
        engine: contractsRes.error
          ? null
          : {
              liveContracts: live.length,
              contractedCu: live.length ? contractedCu : null,
              deliveredCu: live.length ? deliveredCu : null,
              remainingCu: live.length ? contractedCu - deliveredCu : null,
              nextEndDate: live.map((x) => x.date_end).filter(Boolean).sort()[0] || null,
            },
        // Column 3 — renewal, from Airtable. Null when Airtable could not be
        // read, so the UI can say "unavailable" rather than "none".
        renewal: airtableOk && at
          ? { soonestEndingInDays: soonest ?? null, contracts: at.contracts }
          : null,
      };
    })
    // A client with no live contract in either system is not part of the
    // Tuesday walk. Kept out of the table, counted below so the number is
    // never a mystery.
    .filter((r: any) => (r.engine?.liveContracts ?? 0) > 0 || (r.renewal?.contracts?.length ?? 0) > 0);

  return NextResponse.json({
    rows,
    counts: {
      clients: rows.length,
      matched: rows.filter((r: any) => r.joinState === "matched").length,
      engineOnly: rows.filter((r: any) => r.joinState === "engine_only").length,
      duplicateEngineId: rows.filter((r: any) => r.joinState === "duplicate_engine_id").length,
      airtableOnly: airtableOnly.length,
    },
    // Airtable customers that never reach the table above, listed rather than
    // dropped — a client visible in one system and not the other is a data
    // question someone has to answer, not a row to quietly lose.
    airtableOnly,
    showMoney,
    warnings,
    sources: {
      engine: clientsRes.error ? "unavailable" : "live",
      engineContracts: contractsRes.error ? "unavailable" : "live",
      airtable: airtableConfigured() ? (airtableOk ? "live" : "unavailable") : "not configured",
    },
    fetchedAt: new Date().toISOString(),
  });
}
