/**
 * Resourcing reports over the TCE operations base.
 *
 * Read-only. Every figure here is the PLAN — what was sold, booked and
 * budgeted — not what was delivered. Engine holds delivery. Keeping that
 * distinction visible in the output is most of this file's job, because the
 * two are easy to print side by side and meaningless to subtract:
 *
 *   Airtable books one contract's CUs against EVERY discipline that touches
 *   it, so a 10-CU contract consumes AM capacity and Text capacity both.
 *   Engine attributes each task's CUs to exactly ONE assignee. Company-wide,
 *   Airtable demand therefore exceeds Engine delivery structurally. Neither
 *   number is wrong; they answer different questions.
 *
 * Field names are copied verbatim from docs/airtable-base-schema.md and are
 * asserted at runtime, because the base is edited by people who have no reason
 * to know this file exists.
 */
import {
  AMBIGUOUS,
  assertFields,
  assertFieldTypes,
  cellNumber,
  getBaseSchema,
  listRecords,
  type AirtableRecord,
  type AirtableTable,
} from "./client";
import { engineActuals, monthRange } from "./engine-actuals";

/* ─────────────── Vocabulary ─────────────── */

export const DISCIPLINES = ["Account Management", "Text", "Video", "Visuals", "Strategy"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/**
 * Capacity and demand column names per discipline.
 *
 * AM is the asymmetric one: `Team resourcing` has `AM capacity` but no
 * "AM CUs booked" lookup to sit beside it. That is a gap in the base, not an
 * oversight here — AM headroom is simply not derivable at person × month
 * grain, and the report says so rather than inventing it from a subtraction
 * with a missing operand.
 */
const CAPACITY_COLUMNS: Record<Discipline, { capacity: string; hours: string; booked: string | null }> = {
  "Account Management": { capacity: "AM capacity", hours: "AM capacity time (hours)", booked: null },
  Text: { capacity: "Text production capacity", hours: "Text production capacity time (hours)", booked: "Text CUs booked" },
  Video: { capacity: "Video production capacity", hours: "Video production capacity time (hours)", booked: "Video CUs booked" },
  Visuals: { capacity: "Visuals production capacity", hours: "Visuals production capacity time (hours)", booked: "Visuals CUs booked" },
  Strategy: { capacity: "Strategy production capacity", hours: "Strategy production capacity time (hours)", booked: "Strategy CUs booked" },
};

/** Booking statuses that mean the work is live. "Active" alone is not enough. */
export const ACTIVE_BOOKING_STATUSES = ["Active", "Active - Extended", "Active - Late Delivery"] as const;

/**
 * Freelancer format → discipline.
 *
 * Ten format options, five disciplines. The `Formats` table cannot supply this
 * — it has one column and `Format` is a singleSelect that does not link to it —
 * so the map is owned here, and the five that map to nothing stay unmapped on
 * purpose. Guessing that Animation is Video would file its CUs under a
 * discipline nobody assigned them to, and the totals would still add up, which
 * is what makes that class of guess so hard to notice later.
 */
const FORMAT_TO_DISCIPLINE: Record<string, Discipline | null> = {
  Text: "Text",
  Visual: "Visuals",
  Video: "Video",
  "Account Management": "Account Management",
  Strategy: "Strategy",
  Report: null,
  Other: null,
  Animation: null,
  Editing: null,
  Voiceover: null,
};

/* ─────────────── Result envelope ─────────────── */

export interface ReportResult<T> {
  report: string;
  /** Present only when the underlying fetch completed. Never a guess. */
  data: T;
  /** Non-fatal problems the model MUST pass on rather than smooth over. */
  warnings: string[];
  /** When we called Airtable. Not when the base was last edited — no table exposes that. */
  fetchedAt: string;
}

function ok<T>(report: string, data: T, warnings: string[] = []): ReportResult<T> {
  return { report, data, warnings, fetchedAt: new Date().toISOString() };
}

/* ─────────────── Month handling ─────────────── */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The canonical month label, matching the `Contracts Monthly.Month` options
 * exactly: "September 2026". Year-qualified, so a filter on it cannot collapse
 * four years into one figure.
 */
export function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Parse "September 2026" back to the first of that month, UTC. */
export function parseMonthLabel(label: string): Date | null {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const idx = MONTH_NAMES.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return null;
  return new Date(Date.UTC(Number(m[2]), idx, 1));
}

/**
 * Resolve a caller's month expression to a canonical label.
 *
 * Accepts "September 2026", "2026-09", "this month", "next month", or nothing
 * (meaning this month). Returns null on anything else rather than falling back
 * to the current month, because silently answering about the wrong month is
 * worse than refusing.
 */
export function resolveMonth(input: string | undefined, now: Date): string | null {
  const raw = (input || "this month").trim().toLowerCase();
  const shift = (n: number) => monthLabel(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1)));

  if (raw === "this month" || raw === "current month" || raw === "") return shift(0);
  if (raw === "next month") return shift(1);
  if (raw === "last month" || raw === "previous month") return shift(-1);

  const iso = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (iso) {
    const monthIdx = Number(iso[2]) - 1;
    if (monthIdx < 0 || monthIdx > 11) return null;
    return monthLabel(new Date(Date.UTC(Number(iso[1]), monthIdx, 1)));
  }

  const parsed = parseMonthLabel(raw);
  return parsed ? monthLabel(parsed) : null;
}

/* ─────────────── Shared helpers ─────────────── */

/** Escape a value for safe use inside an Airtable filterByFormula string literal. */
export function escapeFormulaValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * A numeric cell plus why it might not be one.
 *
 * `undefined` and AMBIGUOUS are deliberately NOT collapsed to 0 anywhere in
 * this file. An absent month row means the plan is not loaded that far out; a
 * multi-value lookup means we cannot tell. Both are reported, neither is
 * arithmetic.
 */
type Num = number | undefined | typeof AMBIGUOUS;

const isNumber = (v: Num): v is number => typeof v === "number";

function readSchema(tables: AirtableTable[], name: string): AirtableTable {
  const t = tables.find((x) => x.name === name);
  if (!t) {
    throw new Error(
      `Airtable table "${name}" no longer exists in the base. It was probably renamed — ` +
        `update the report rather than reporting an empty result.`
    );
  }
  return t;
}

/** First linked record id, or null. Link cells are arrays of record ids. */
function firstLink(raw: unknown): string | null {
  return Array.isArray(raw) && raw.length ? String(raw[0]) : null;
}

/* ─────────────── Report: capacity ─────────────── */

export interface PersonCapacity {
  name: string;
  team: string | null;
  job: string | null;
  /** Engine user id where the base carries one. Absent means unlinked — which
   *  is NOT the same as having delivered nothing. */
  engineUserId: number | null;
  disciplines: {
    discipline: Discipline;
    capacityCu: number | null;
    capacityHours: number | null;
    bookedCu: number | null;
    headroomCu: number | null;
    /** Why a figure is missing, when it is. */
    note: string | null;
  }[];
}

export interface CapacityData {
  month: string;
  planLoaded: boolean;
  people: PersonCapacity[];
  /** Named, because "13 people have no row" is actionable and a silent gap is not. */
  peopleWithoutPlan: string[];
}

/**
 * Per-person capacity and headroom for a month.
 *
 * Reads the live roster only — `Team` mixes live staff with leavers and
 * scenario placeholders, and counting a scenario row as a real person inflates
 * every capacity total.
 */
export async function capacityReport(opts: { month?: string; person?: string; now?: Date } = {}): Promise<ReportResult<CapacityData>> {
  const now = opts.now || new Date();
  const month = resolveMonth(opts.month, now);
  if (!month) {
    throw new Error(
      `"${opts.month}" is not a month I can resolve. Use a form like "September 2026", "2026-09", ` +
        `"this month" or "next month".`
    );
  }

  const { tables } = await getBaseSchema();
  const teamSchema = readSchema(tables, "Team");
  const resourcingSchema = readSchema(tables, "Team resourcing");

  assertFields(teamSchema, ["Name", "Team", "Job", "Engine_IDs"]);
  assertFields(resourcingSchema, [
    "Team member",
    "Months",
    ...DISCIPLINES.flatMap((d) => [CAPACITY_COLUMNS[d].capacity, CAPACITY_COLUMNS[d].hours]),
    ...DISCIPLINES.map((d) => CAPACITY_COLUMNS[d].booked).filter((x): x is string => !!x),
  ]);
  // The pairing that makes headroom wrong if it ever changes: scalar capacity
  // against lookup demand. Catch a swap here rather than in the arithmetic.
  assertFieldTypes(resourcingSchema, {
    "Text CUs booked": "multipleLookupValues",
    "Text production capacity": "currency",
  });

  const warnings: string[] = [];

  // Live roster only. "Live team" is the base's own definition of who counts.
  const liveView = teamSchema.views?.some((v) => v.name === "Live team") ? "Live team" : undefined;
  if (!liveView) {
    warnings.push(
      `The "Live team" view no longer exists in the base, so this covers every Team row including ` +
        `leavers and scenario placeholders. Capacity totals will be too high.`
    );
  }

  const team = await listRecords("Team", {
    view: liveView,
    fields: ["Name", "Team", "Job", "Engine_IDs"],
  });
  if (team.truncated) warnings.push("The Team roster was truncated — this is a partial roster, not the whole team.");

  const wanted = opts.person?.trim().toLowerCase();
  const roster = wanted
    ? team.records.filter((r) => String(r.fields["Name"] || "").toLowerCase().includes(wanted))
    : team.records;

  if (wanted && !roster.length) {
    throw new Error(
      `No one on the live team matches "${opts.person}". Names come from Airtable's Team table; ` +
        `check the spelling, or ask without a name for the whole roster.`
    );
  }

  // Month rows. `Month-Team` is a formula key, so the reliable filter is the
  // linked Months record — resolved via Monthly resourcing's real Date field
  // rather than its text Month or its text Order.
  const monthStart = parseMonthLabel(month)!;
  const monthlySchema = readSchema(tables, "Monthly resourcing");
  assertFields(monthlySchema, ["Month", "Date"]);
  const monthly = await listRecords("Monthly resourcing", { fields: ["Month", "Date"] });
  const monthRecord = monthly.records.find((r) => {
    const d = r.fields["Date"];
    if (!d) return false;
    const parsed = new Date(String(d));
    return (
      parsed.getUTCFullYear() === monthStart.getUTCFullYear() && parsed.getUTCMonth() === monthStart.getUTCMonth()
    );
  });

  if (!monthRecord) {
    // The honest answer to "how much headroom in March 2028" is that the plan
    // does not go that far, not that everyone is free.
    const horizon = monthly.records
      .map((r) => (r.fields["Date"] ? new Date(String(r.fields["Date"])) : null))
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return ok(
      "capacity",
      { month, planLoaded: false, people: [], peopleWithoutPlan: [] },
      [
        `The resourcing plan has no row for ${month}` +
          (horizon ? `; it currently runs to ${monthLabel(horizon)}.` : ".") +
          ` This means the plan is not loaded that far out — it does NOT mean there is capacity available.`,
      ]
    );
  }

  const resourcing = await listRecords("Team resourcing", {
    fields: [
      "Team member",
      "Months",
      ...DISCIPLINES.flatMap((d) => {
        const c = CAPACITY_COLUMNS[d];
        return [c.capacity, c.hours, ...(c.booked ? [c.booked] : [])];
      }),
    ],
  });
  if (resourcing.truncated) {
    warnings.push("Team resourcing was truncated — some people's capacity rows are missing from this answer.");
  }

  const byMember = new Map<string, AirtableRecord>();
  for (const row of resourcing.records) {
    const months = row.fields["Months"];
    if (!Array.isArray(months) || !months.includes(monthRecord.id)) continue;
    const member = firstLink(row.fields["Team member"]);
    if (member) byMember.set(member, row);
  }

  const people: PersonCapacity[] = [];
  const peopleWithoutPlan: string[] = [];

  for (const person of roster) {
    const name = String(person.fields["Name"] || "(unnamed)");
    const row = byMember.get(person.id);
    if (!row) {
      peopleWithoutPlan.push(name);
      continue;
    }

    // Single numeric Engine id. Absent means unlinked — left null, never 0.
    const rawId = String(person.fields["Engine_IDs"] || "").trim();
    const firstId = rawId.split(/[,;\s]+/).filter(Boolean)[0];
    const engineUserId = firstId && /^\d+$/.test(firstId) ? Number(firstId) : null;

    const disciplines = DISCIPLINES.map((discipline) => {
      const cols = CAPACITY_COLUMNS[discipline];
      const capacity = cellNumber(row.fields[cols.capacity]);
      const hours = cellNumber(row.fields[cols.hours]);
      const booked: Num = cols.booked ? cellNumber(row.fields[cols.booked]) : undefined;

      let note: string | null = null;
      if (!cols.booked) {
        note = "Booked CUs are not tracked per person for Account Management, so headroom cannot be calculated.";
      } else if (booked === AMBIGUOUS) {
        note = "Booked CUs came back as several values rather than one, so headroom is not calculated.";
      } else if (booked === undefined && isNumber(capacity)) {
        note = "No booked CUs recorded for this discipline this month.";
      }

      const headroom = isNumber(capacity) && isNumber(booked) ? capacity - booked : null;

      return {
        discipline,
        capacityCu: isNumber(capacity) ? capacity : null,
        capacityHours: isNumber(hours) ? hours : null,
        bookedCu: isNumber(booked) ? booked : null,
        headroomCu: headroom,
        note,
      };
    }).filter((d) => d.capacityCu !== null || d.bookedCu !== null);

    people.push({
      name,
      team: (person.fields["Team"] as string) || null,
      job: (person.fields["Job"] as string) || null,
      engineUserId,
      disciplines,
    });
  }

  if (peopleWithoutPlan.length) {
    warnings.push(
      `${peopleWithoutPlan.length} of ${roster.length} live team members have no resourcing row for ${month}: ` +
        `${peopleWithoutPlan.join(", ")}. They are absent from the plan, not idle.`
    );
  }

  return ok("capacity", { month, planLoaded: true, people, peopleWithoutPlan }, warnings);
}

/* ─────────────── Report: client plan vs actual ─────────────── */

export interface ClientPlanRow {
  client: string;
  engineClientId: number | null;
  contract: string;
  bookingStatus: string | null;
  contractedCu: number | null;
  bookedCu: number | null;
  deliveredCuAirtable: number | null;
}

export interface PlanVsActualData {
  month: string;
  rows: ClientPlanRow[];
  /** Engine's own delivered figure, per client, for the same month. */
  engineDelivered: { engineClientId: number; cu: number; taskCount: number }[];
  /** Clients in Engine's actuals with no matching Airtable Customer row. */
  unmatchedEngineClientIds: number[];
}

/**
 * Contracted / booked / delivered per contract for one month.
 *
 * The ONLY report that reads Contracts Monthly, and it always filters by
 * month. Unfiltered that table exceeds the client's page ceiling, which is
 * where a partial answer would start looking like a complete one.
 *
 * Note that the three CU columns are owned by three different departments —
 * SALES contracted it, EDITORIAL booked it, FINANCE recognises production —
 * so they disagree by design. All three are returned, labelled, and never
 * silently reconciled into one number.
 */
export async function clientPlanVsActualReport(
  opts: { month?: string; client?: string; now?: Date } = {}
): Promise<ReportResult<PlanVsActualData>> {
  const now = opts.now || new Date();
  const month = resolveMonth(opts.month, now);
  if (!month) {
    throw new Error(`"${opts.month}" is not a month I can resolve. Use "September 2026", "2026-09", or "this month".`);
  }

  const { tables } = await getBaseSchema();
  const cmSchema = readSchema(tables, "Contracts Monthly");
  const customerSchema = readSchema(tables, "Customer");
  assertFields(cmSchema, [
    "Month",
    "Contract",
    "Customer",
    "Booking status",
    "Contracted CU (SALES)",
    "Booked CU (EDITORIAL)",
    "Delivered CU",
  ]);
  assertFields(customerSchema, ["Customer", "Engine ID"]);

  // The month options are year-qualified, so this cannot collapse years.
  const monthOption = cmSchema.fields.find((f) => f.name === "Month");
  const choices = ((monthOption?.options as any)?.choices as { name: string }[] | undefined)?.map((c) => c.name) || [];
  if (choices.length && !choices.includes(month)) {
    throw new Error(
      `The base has no "${month}" option on Contracts Monthly — its plan runs ${choices[0]} to ${choices[choices.length - 1]}. ` +
        `No figures exist for that month.`
    );
  }

  const warnings: string[] = [];
  const rows = await listRecords("Contracts Monthly", {
    filterByFormula: `{Month} = "${escapeFormulaValue(month)}"`,
    fields: [
      "Month",
      "Contract",
      "Customer",
      "Booking status",
      "Contracted CU (SALES)",
      "Booked CU (EDITORIAL)",
      "Delivered CU",
    ],
  });
  if (rows.truncated) {
    warnings.push(
      `The ${month} plan was truncated — this is a PARTIAL set of contracts, not all of them. ` +
        `Do not present these totals as the month's complete figures.`
    );
  }

  const customers = await listRecords("Customer", { fields: ["Customer", "Engine ID"] });
  const engineIdByName = new Map<string, number>();
  for (const c of customers.records) {
    const name = String(c.fields["Customer"] || "").trim();
    const id = cellNumber(c.fields["Engine ID"]);
    if (name && isNumber(id)) engineIdByName.set(name.toLowerCase(), id);
  }

  const wanted = opts.client?.trim().toLowerCase();
  const num = (v: unknown): number | null => {
    const n = cellNumber(v);
    return isNumber(n) ? n : null;
  };

  const planRows: ClientPlanRow[] = rows.records
    .map((r) => {
      const customerCell = r.fields["Customer"];
      const client = Array.isArray(customerCell) ? String(customerCell[0] ?? "") : String(customerCell ?? "");
      const contractCell = r.fields["Contract"];
      return {
        client,
        engineClientId: engineIdByName.get(client.toLowerCase()) ?? null,
        contract: Array.isArray(contractCell) ? `${contractCell.length} linked` : String(contractCell ?? ""),
        bookingStatus: Array.isArray(r.fields["Booking status"])
          ? String((r.fields["Booking status"] as unknown[])[0] ?? "")
          : ((r.fields["Booking status"] as string) ?? null),
        contractedCu: num(r.fields["Contracted CU (SALES)"]),
        bookedCu: num(r.fields["Booked CU (EDITORIAL)"]),
        deliveredCuAirtable: num(r.fields["Delivered CU"]),
      };
    })
    .filter((r) => (wanted ? r.client.toLowerCase().includes(wanted) : true));

  if (wanted && !planRows.length) {
    throw new Error(
      `No contract matching "${opts.client}" has a ${month} plan row. The client may be spelled differently in ` +
        `Airtable, or may have no contract active that month.`
    );
  }

  // Engine's actuals for the same month, joined on the Customer table's
  // Engine ID — an id join, never a name match.
  const range = monthRange(month);
  const engineDelivered: PlanVsActualData["engineDelivered"] = [];
  const unmatchedEngineClientIds: number[] = [];
  if (range) {
    try {
      const actuals = await engineActuals(range.from, range.to);
      const known = new Set(Array.from(engineIdByName.values()));
      for (const [engineClientId, row] of Array.from(actuals.byClient.entries())) {
        if (known.has(engineClientId)) engineDelivered.push({ engineClientId, cu: row.cu, taskCount: row.taskCount });
        else unmatchedEngineClientIds.push(engineClientId);
      }
      if (unmatchedEngineClientIds.length) {
        warnings.push(
          `${unmatchedEngineClientIds.length} Engine client(s) delivered work in ${month} but have no matching ` +
            `Customer row in Airtable (Engine IDs: ${unmatchedEngineClientIds.join(", ")}). Their CUs are absent ` +
            `from the plan comparison — reported, not dropped.`
        );
      }
    } catch (e: any) {
      warnings.push(`Engine delivery figures are unavailable (${String(e?.message || e).slice(0, 120)}), so this is the plan only.`);
    }
  }

  return ok("client_plan_vs_actual", { month, rows: planRows, engineDelivered, unmatchedEngineClientIds }, warnings);
}

/* ─────────────── Report: contract health ─────────────── */

export interface ContractHealthRow {
  contract: string;
  client: string;
  bookingStatus: string | null;
  contractStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  endingInDays: number | null;
  contractedCu: number | null;
  commissionedCu: number | null;
  remainingCu: number | null;
  deliveredPct: number | null;
  accountManager: string | null;
}

/**
 * Contracts by health: ending soon, over/under delivered, unrenewed.
 *
 * "Active" is three separate option values in this base, so the filter matches
 * the set. Anything that filters on the single string "Active" quietly drops
 * every extended and late-delivery contract.
 */
export async function contractHealthReport(
  opts: { endingWithinDays?: number; client?: string; includeEnded?: boolean } = {}
): Promise<ReportResult<{ rows: ContractHealthRow[]; activeStatusesMatched: string[] }>> {
  const { tables } = await getBaseSchema();
  const schema = readSchema(tables, "Contracts");
  assertFields(schema, [
    "Contract name",
    "Customer",
    "Booking status",
    "Contract status",
    "Start date",
    "End date",
    "Contracted CUs",
    "Commissioned CUs",
    "Remaining CUs",
    "Contract delivered %",
    "Contract ending days",
    "Account Manager",
  ]);

  const warnings: string[] = [];
  const statusFilter = ACTIVE_BOOKING_STATUSES.map((s) => `{Booking status} = "${escapeFormulaValue(s)}"`).join(", ");

  const rows = await listRecords("Contracts", {
    filterByFormula: opts.includeEnded ? undefined : `OR(${statusFilter})`,
    fields: [
      "Contract name",
      "Customer",
      "Booking status",
      "Contract status",
      "Start date",
      "End date",
      "Contracted CUs",
      "Commissioned CUs",
      "Remaining CUs",
      "Contract delivered %",
      "Contract ending days",
      "Account Manager",
    ],
  });
  if (rows.truncated) warnings.push("The contract list was truncated — this is a partial set, not every contract.");

  const wanted = opts.client?.trim().toLowerCase();
  const num = (v: unknown): number | null => {
    const n = cellNumber(v);
    return isNumber(n) ? n : null;
  };
  const firstOf = (v: unknown): string | null =>
    Array.isArray(v) ? (v.length ? String(v[0]) : null) : v == null ? null : String(v);

  let out: ContractHealthRow[] = rows.records.map((r) => ({
    contract: String(r.fields["Contract name"] || "(unnamed)"),
    client: firstOf(r.fields["Customer"]) || "",
    bookingStatus: firstOf(r.fields["Booking status"]),
    contractStatus: firstOf(r.fields["Contract status"]),
    startDate: (r.fields["Start date"] as string) || null,
    endDate: (r.fields["End date"] as string) || null,
    endingInDays: num(r.fields["Contract ending days"]),
    contractedCu: num(r.fields["Contracted CUs"]),
    commissionedCu: num(r.fields["Commissioned CUs"]),
    remainingCu: num(r.fields["Remaining CUs"]),
    deliveredPct: num(r.fields["Contract delivered %"]),
    accountManager: firstOf(r.fields["Account Manager"]),
  }));

  if (wanted) out = out.filter((r) => r.client.toLowerCase().includes(wanted) || r.contract.toLowerCase().includes(wanted));

  if (opts.endingWithinDays != null) {
    const limit = opts.endingWithinDays;
    const before = out.length;
    // Re-validated in JS rather than trusted from a view: a view's filter can
    // be edited in the base with no error and no version, and the report would
    // change its answer silently.
    out = out.filter((r) => r.endingInDays != null && r.endingInDays >= 0 && r.endingInDays <= limit);
    const noDays = before - out.length;
    if (noDays > 0 && out.length === 0) {
      warnings.push(`No active contract ends within ${limit} days.`);
    }
  }

  out.sort((a, b) => (a.endingInDays ?? Number.MAX_SAFE_INTEGER) - (b.endingInDays ?? Number.MAX_SAFE_INTEGER));

  return ok(
    "contract_health",
    { rows: out, activeStatusesMatched: opts.includeEnded ? [] : [...ACTIVE_BOOKING_STATUSES] },
    warnings
  );
}

/* ─────────────── Report: monthly outlook ─────────────── */

export interface OutlookData {
  month: string;
  disciplines: {
    discipline: Discipline;
    capacityCu: number | null;
    capacityVsDemandCu: number | null;
    freelancerEstimateCu: number | null;
  }[];
  totals: {
    cuBooked: number | null;
    cuBookedPlusOpportunities: number | null;
    cuDelivered: number | null;
    cuTarget: number | null;
    cuGapBooked: number | null;
    freelancerEstimateCu: number | null;
    activeCustomers: number | null;
  };
  freelancers: {
    committedCu: number | null;
    byDiscipline: { discipline: Discipline; cu: number }[];
    /** Formats with no discipline — reported, never folded into a total. */
    unmappedCu: { format: string; cu: number }[];
  };
}

/**
 * Company-wide capacity against demand for a month.
 *
 * Reads the base's own rollups rather than re-deriving demand from Contracts
 * Monthly. Re-deriving would produce a second number that disagrees with the
 * views Chris actually looks at, and cost 2,500+ rows to do it.
 */
export async function monthlyOutlookReport(opts: { month?: string; now?: Date } = {}): Promise<ReportResult<OutlookData>> {
  const now = opts.now || new Date();
  const month = resolveMonth(opts.month, now);
  if (!month) {
    throw new Error(`"${opts.month}" is not a month I can resolve. Use "September 2026", "2026-09", or "this month".`);
  }

  const { tables } = await getBaseSchema();
  const monthlySchema = readSchema(tables, "Monthly resourcing");
  const capacityVsDemand: Record<Discipline, string> = {
    "Account Management": "AM capacity vs demand",
    Text: "Text capacity vs demand",
    Video: "Video capacity vs demand",
    Visuals: "Visuals capacity vs demand",
    Strategy: "Strategy capacity vs demand",
  };
  const capacityCol: Record<Discipline, string> = {
    "Account Management": "AM capacity",
    Text: "Text capacity",
    Video: "Video capacity",
    Visuals: "Visuals capacity",
    Strategy: "Strategy capacity",
  };
  // No "AM freelancer estimate" exists in the base. Mapping it to the TOTAL
  // would report the whole company's freelancer need as Account Management's.
  const freelancerCol: Record<Discipline, string | null> = {
    "Account Management": null,
    Text: "Text freelancer estimate",
    Video: "Video freelancer estimate",
    Visuals: "Visuals freelancer estimate",
    Strategy: "Strategy freelancer estimate",
  };

  assertFields(monthlySchema, [
    "Month",
    "Date",
    "Total CUs booked",
    "CU: booked + opps",
    "CU: delivered",
    "CU Target",
    "CU Gap: booked",
    "Total freelancer estimate",
    "Active customers",
    ...Object.values(capacityCol),
    ...Object.values(capacityVsDemand),
    ...Object.values(freelancerCol).filter((x): x is string => !!x),
  ]);

  const monthStart = parseMonthLabel(month)!;
  const rows = await listRecords("Monthly resourcing");
  const row = rows.records.find((r) => {
    const d = r.fields["Date"];
    if (!d) return false;
    const parsed = new Date(String(d));
    return parsed.getUTCFullYear() === monthStart.getUTCFullYear() && parsed.getUTCMonth() === monthStart.getUTCMonth();
  });

  if (!row) {
    const horizon = rows.records
      .map((r) => (r.fields["Date"] ? new Date(String(r.fields["Date"])) : null))
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    throw new Error(
      `The resourcing plan has no row for ${month}` +
        (horizon ? `; it runs to ${monthLabel(horizon)}.` : ".") +
        ` No figures are available for that month — this is a gap in the plan, not zero demand.`
    );
  }

  const warnings: string[] = [];
  const n = (field: string): number | null => {
    const v = cellNumber(row.fields[field]);
    if (v === AMBIGUOUS) {
      warnings.push(`"${field}" returned several values rather than one, so it is omitted rather than guessed.`);
      return null;
    }
    return isNumber(v) ? v : null;
  };

  // Freelancer commitments for the month, mapped to disciplines where we can.
  const freelanceSchema = readSchema(tables, "Freelancer assignments");
  assertFields(freelanceSchema, ["Format", "CU", "Contracting month", "Status"]);
  const assignments = await listRecords("Freelancer assignments", {
    fields: ["Format", "CU", "Contracting month", "Status"],
  });
  if (assignments.truncated) warnings.push("Freelancer assignments were truncated — freelancer figures are partial.");

  const byDiscipline = new Map<Discipline, number>();
  const unmapped = new Map<string, number>();
  let committedCu = 0;

  for (const a of assignments.records) {
    const months = a.fields["Contracting month"];
    if (!Array.isArray(months) || !months.includes(row.id)) continue;
    const cu = cellNumber(a.fields["CU"]);
    if (!isNumber(cu)) continue;
    committedCu += cu;
    const format = String(a.fields["Format"] || "").trim();
    const discipline = FORMAT_TO_DISCIPLINE[format];
    if (discipline) byDiscipline.set(discipline, (byDiscipline.get(discipline) || 0) + cu);
    else unmapped.set(format || "(no format)", (unmapped.get(format || "(no format)") || 0) + cu);
  }

  if (unmapped.size) {
    const total = Array.from(unmapped.values()).reduce((a, b) => a + b, 0);
    warnings.push(
      `${total} freelancer CUs are in formats that map to no discipline (${Array.from(unmapped.keys()).join(", ")}). ` +
        `They are counted in the total but not in any per-discipline line.`
    );
  }

  return ok(
    "monthly_outlook",
    {
      month,
      disciplines: DISCIPLINES.map((d) => ({
        discipline: d,
        capacityCu: n(capacityCol[d]),
        capacityVsDemandCu: n(capacityVsDemand[d]),
        freelancerEstimateCu: freelancerCol[d] ? n(freelancerCol[d]!) : null,
      })),
      totals: {
        cuBooked: n("Total CUs booked"),
        cuBookedPlusOpportunities: n("CU: booked + opps"),
        cuDelivered: n("CU: delivered"),
        cuTarget: n("CU Target"),
        cuGapBooked: n("CU Gap: booked"),
        freelancerEstimateCu: n("Total freelancer estimate"),
        activeCustomers: n("Active customers"),
      },
      freelancers: {
        committedCu,
        byDiscipline: Array.from(byDiscipline.entries()).map(([discipline, cu]) => ({ discipline, cu })),
        unmappedCu: Array.from(unmapped.entries()).map(([format, cu]) => ({ format, cu })),
      },
    },
    warnings
  );
}
