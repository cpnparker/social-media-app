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
 * Per-person capacity columns on `Team resourcing`.
 *
 * CAPACITY IS PER PERSON. DEMAND IS NOT — and the base's own column names hide
 * that, which produced a live wrong answer worth recording here.
 *
 * `Team resourcing` sits beside `Total CUs booked`, `Text CUs booked` and the
 * rest, which read like that person's bookings. They are not. The table has
 * exactly two link fields — `Team member` and `Months` — and an Airtable
 * lookup must traverse a link, so those columns are lookups through `Months`:
 * the COMPANY-WIDE monthly figure, copied identically onto every person's row.
 * Subtracting one from an individual's capacity produced a headroom figure
 * that was negative for almost everybody, which is the signature of an
 * aggregation-level mismatch rather than an overloaded team.
 *
 * How demand actually works, per the people who built the base: total booked
 * CUs come from Contracts via Contracts Monthly, and are split across formats
 * by the ratio fields on `Monthly resourcing` (`Text ratio`, `Video ratio`,
 * `Visuals ratio`, `Strategy ratio`, `Social publishing ratio`) using average
 * commissioning rates. That split is then compared against the SUM of team
 * capacity for the format to give the monthly +/- and the freelancer need.
 *
 * So per-format demand is a company-level quantity by construction. There is
 * no per-person production demand to compare against, and this file must not
 * manufacture one. Account Management is the exception — allocation there is
 * per person, through the `Account Manage` join — and is handled separately.
 */
const CAPACITY_COLUMNS: Record<Discipline, { capacity: string; hours: string | null }> = {
  "Account Management": { capacity: "AM capacity", hours: "AM capacity time (hours)" },
  Text: { capacity: "Text production capacity", hours: "Text production capacity time (hours)" },
  Video: { capacity: "Video production capacity", hours: "Video production capacity time (hours)" },
  Visuals: { capacity: "Visuals production capacity", hours: "Visuals production capacity time (hours)" },
  Strategy: { capacity: "Strategy production capacity", hours: "Strategy production capacity time (hours)" },
};

/**
 * Company-level demand columns, where demand actually lives.
 *
 * Note `Social publishing ratio` has no capacity line to compare against — it
 * is a fifth format in the ratio split but not a discipline anyone's capacity
 * is recorded under.
 */
const MONTHLY_DEMAND: Record<Discipline, { capacity: string; vsDemand: string; freelancer: string | null; ratio: string | null }> = {
  "Account Management": { capacity: "AM capacity", vsDemand: "AM capacity vs demand", freelancer: null, ratio: null },
  Text: { capacity: "Text capacity", vsDemand: "Text capacity vs demand", freelancer: "Text freelancer estimate", ratio: "Text ratio" },
  Video: { capacity: "Video capacity", vsDemand: "Video capacity vs demand", freelancer: "Video freelancer estimate", ratio: "Video ratio" },
  Visuals: { capacity: "Visuals capacity", vsDemand: "Visuals capacity vs demand", freelancer: "Visuals freelancer estimate", ratio: "Visuals ratio" },
  Strategy: { capacity: "Strategy capacity", vsDemand: "Strategy capacity vs demand", freelancer: "Strategy freelancer estimate", ratio: "Strategy ratio" },
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

/**
 * Find a month's row in Monthly resourcing, by its TEXT label.
 *
 * The first cut matched on the `Date` field, on the reasoning that a real date
 * beats a text column whose format was unknown. That was wrong in a way worth
 * recording: `Date` is populated on 31 of 66 rows, and every month after June
 * 2025 has it empty. So the report refused every future month — the only ones
 * anyone asks about — and explained itself by naming June 2025 as the plan's
 * horizon, which read as a data-entry problem in the base rather than a bug
 * here. A refusal is only as trustworthy as the column it is built on.
 *
 * `Month` is the table's primary field, populated on all 66 rows, and already
 * in the exact form monthLabel() produces. `Order` is a hand-maintained
 * spreadsheet-style key (A…Z, ZA…ZV, with a "ZE2" patched in) and is null on
 * 14 rows, so it is not an identifier either.
 */
function findMonthRow(records: AirtableRecord[], month: string): AirtableRecord | undefined {
  const want = month.trim().toLowerCase();
  return records.find((r) => String(r.fields["Month"] ?? "").trim().toLowerCase() === want);
}

/** The last month present in the plan, by parsed label rather than by Date. */
function planHorizon(records: AirtableRecord[]): string | null {
  const parsed = records
    .map((r) => parseMonthLabel(String(r.fields["Month"] ?? "")))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime());
  return parsed.length ? monthLabel(parsed[0]) : null;
}

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

/**
 * Resolve a LINK cell to human-readable names.
 *
 * This distinction is the difference between a report and a list of gibberish.
 * A `multipleRecordLinks` field returns record IDs — `["recAbC123…"]` — whereas
 * a `multipleLookupValues` field returns the values themselves. Both are
 * arrays, so both survive a naive `Array.isArray(x) ? x[0] : x` unscathed, and
 * only one of them yields a name. Printing "recAbC123" as a client name is
 * merely embarrassing; the silent half is that a `client` filter compared
 * against record IDs matches nothing and returns an empty set that reads as
 * "no such contract".
 */
function linkNames(raw: unknown, names: Map<string, string>): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => names.get(String(id)) || String(id)).filter(Boolean);
}

/** id → primary-field name, for resolving links. */
async function nameIndex(table: string, primaryField: string): Promise<Map<string, string>> {
  const res = await listRecords(table, { fields: [primaryField] });
  return new Map(res.records.map((r) => [r.id, String(r.fields[primaryField] ?? "")]));
}

/* ─────────────── Report: capacity ─────────────── */

export interface PersonCapacity {
  name: string;
  team: string | null;
  job: string | null;
  /** Engine user id where the base carries one. Absent means unlinked — which
   *  is NOT the same as having delivered nothing. */
  engineUserId: number | null;
  disciplines: { discipline: Discipline; capacityCu: number | null; capacityHours: number | null }[];
  /**
   * Account Management only, and only where the person has live allocations.
   * `allocatedCu` is CURRENT-STATE — `Account Manage` has no month link — so
   * it is a person's standing load, not this month's.
   */
  accountManagement: {
    capacityCu: number | null;
    allocatedCu: number;
    headroomCu: number | null;
    contracts: number;
    allocationIsCurrentState: true;
  } | null;
}

export interface CapacityData {
  month: string;
  /** Which allocation world the AM figures describe, or null when neither
   *  does — allocation exists only for this month (live) and next (scenario). */
  basis: "live" | "scenario" | null;
  planLoaded: boolean;
  people: PersonCapacity[];
  /** Named, because "13 people have no row" is actionable and a silent gap is not. */
  peopleWithoutPlan: string[];
  /**
   * Where production demand actually lives: company-wide, per format.
   * There is no per-person production demand in the base to put beside it.
   */
  disciplineTotals: {
    discipline: Discipline;
    capacityCu: number | null;
    demandCu: number | null;
    demandOverCapacity: number | null;
    freelancerEstimateChf: number | null;
  }[];
  /**
   * Present only for basis "compare": this month's live plan against next
   * month's scenario plan, differenced HERE rather than by the model across
   * two payloads it cannot tell are at different grains.
   */
  comparison?: {
    from: { month: string; basis: "live" };
    to: { month: string; basis: "scenario" };
    /** Scenario work with no manager attached — planned load with no owner. */
    unassignedCu: number;
    people: {
      name: string;
      fromCapacity: number | null;
      fromAllocated: number;
      fromHeadroom: number | null;
      toCapacity: number | null;
      toAllocated: number;
      toHeadroom: number | null;
      allocationDelta: number;
      headroomDelta: number | null;
    }[];
  };
}

/**
 * Per-person capacity for a month, and — for Account Management only — headroom.
 *
 * The asymmetry is the base's, not this file's. Capacity is recorded per person
 * per month for all five disciplines. DEMAND is recorded per person only for
 * Account Management, through the `Account Manage` join; production demand is a
 * company-wide figure derived by splitting the month's booked CUs across formats
 * by ratio. So "who personally has spare Text capacity" is not a question this
 * base can answer, and the honest report gives capacity pools per person plus
 * the company-level shortfall per format.
 *
 * An earlier version answered it anyway, by subtracting `Team resourcing.Text
 * CUs booked` from a person's Text capacity. That column is a lookup through
 * `Months` — the company total on every row — so it reported almost the entire
 * team as over capacity. See CAPACITY_COLUMNS above.
 */
export async function capacityReport(
  opts: { month?: string; person?: string; basis?: "live" | "scenario" | "compare"; now?: Date } = {}
): Promise<ReportResult<CapacityData>> {
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
    ...DISCIPLINES.flatMap((d) =>
      [CAPACITY_COLUMNS[d].capacity, CAPACITY_COLUMNS[d].hours].filter((x): x is string => !!x)
    ),
  ]);
  // Pins the fact that made the first version wrong: the `* CUs booked` columns
  // are LOOKUPS through Months — a company total on every person's row — while
  // capacity beside them is a per-person scalar. If someone ever turns one into
  // a genuine per-person rollup, this fails loudly and the report can start
  // using it. Until then it stays out of the arithmetic entirely.
  assertFieldTypes(resourcingSchema, {
    "Text CUs booked": "multipleLookupValues",
    "Text production capacity": "currency",
  });

  const warnings: string[] = [];

  const monthlySchema = readSchema(tables, "Monthly resourcing");
  // Asserted AND fetched together, deliberately. The first version asserted
  // only "Month" and fetched only "Month", then read five capacity and demand
  // columns off the returned record further down. `fields[]` restricts the
  // payload, so those five were never in it: every disciplineTotals row came
  // back null. assertFields could not catch it because the names were never
  // asserted, and the failure is invisible from the outside — the formatter
  // tells the model "null means NOT KNOWN, never zero", so the model correctly
  // reported "not recorded" for five columns that are fully populated.
  //
  // No field restriction here at all. The table is 66 rows and one page either
  // way, so restricting bought nothing and cost exactly this.
  const MONTHLY_FIELDS = [
    "Month",
    ...DISCIPLINES.flatMap((d) => {
      const c = MONTHLY_DEMAND[d];
      return [c.capacity, c.vsDemand, ...(c.freelancer ? [c.freelancer] : [])];
    }),
  ];
  assertFields(monthlySchema, MONTHLY_FIELDS);
  const monthly = await listRecords("Monthly resourcing");
  const monthRecord = findMonthRow(monthly.records, month);

  if (!monthRecord) {
    // The honest answer to "how much headroom in March 2028" is that the plan
    // does not go that far, not that everyone is free.
    const horizon = planHorizon(monthly.records);
    return ok(
      "capacity",
      { month, basis: null, planLoaded: false, people: [], peopleWithoutPlan: [], disciplineTotals: [] },
      [
        `The resourcing plan has no row for ${month}` +
          (horizon ? `; it currently runs to ${horizon}.` : ".") +
          ` This means the plan is not loaded that far out — it does NOT mean there is capacity available.`,
      ]
    );
  }

  const resourcing = await listRecords("Team resourcing", {
    fields: [
      "Team member",
      "Months",
      // Capacity only. The `* CUs booked` lookups are deliberately NOT fetched:
      // they are company totals, and having them in the payload at all is how
      // they ended up in a per-person subtraction.
      ...DISCIPLINES.flatMap((d) => {
        const c = CAPACITY_COLUMNS[d];
        return c.hours ? [c.capacity, c.hours] : [c.capacity];
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

  if (!byMember.size) {
    // A month can exist in the plan with no capacity loaded against it. That
    // is a different gap from "the plan does not reach that month", and it
    // needs saying differently — otherwise it reads as "nobody is available".
    return ok(
      "capacity",
      { month, basis: null, planLoaded: false, people: [], peopleWithoutPlan: [], disciplineTotals: [] },
      [
        `${month} exists in the plan but has no team capacity loaded against it. Nobody's capacity has been ` +
          `entered for that month — this does NOT mean the team is fully booked, and it does not mean they are free.`,
      ]
    );
  }

  const team = await listRecords("Team", { fields: ["Name", "Team", "Job", "Engine_IDs"] });
  if (team.truncated) warnings.push("The Team roster was truncated — this is a partial roster, not the whole team.");
  const teamById = new Map(team.records.map((r) => [r.id, r]));

  // The ROSTER IS WHOEVER HAS A CAPACITY ROW THIS MONTH, not whoever appears in
  // a view. The first cut filtered Team by the base's "Live team" view, on the
  // reasoning that it excludes leavers and scenario placeholders. It does — but
  // it holds 8 rows while 21 people have capacity loaded for September 2026, so
  // it would have dropped 13 real people from the answer while looking
  // complete. Capacity rows ARE the plan for a month; a leaver has none.
  const wanted = opts.person?.trim().toLowerCase();
  const rosterIds = Array.from(byMember.keys()).filter((id) => {
    if (!wanted) return true;
    const name = String(teamById.get(id)?.fields["Name"] || "");
    return name.toLowerCase().includes(wanted);
  });

  if (wanted && !rosterIds.length) {
    throw new Error(
      `Nobody matching "${opts.person}" has capacity loaded for ${month}. Names come from Airtable's Team table; ` +
        `check the spelling, or ask without a name for the whole roster.`
    );
  }

  // Per-person Account Management allocation — the only per-person demand the
  // base holds, and it exists in two worlds at once.
  //
  // LIVE is what managers carry today. SCENARIO is how next month is being
  // allocated, which is how the team sees where capacity will land before
  // committing to it. They are separate COLUMN PAIRS on the same row —
  // `Content Units`/`CU Manage` against `Scenario Content Units`/`Scenario CU
  // Manage` — with `live or scenario` naming which pair is filled.
  //
  // So they are alternatives, not layers: scenario REPLACES live for the month
  // it describes rather than adding to it. Summing both would report every
  // manager at roughly double their real load.
  const allocSchema = readSchema(tables, "Account Manage");
  const ALLOC_FIELDS = [
    "Editorial team",
    "CU Manage",
    "Content Units",
    "Scenario CU Manage",
    "Scenario Content Units",
    "live or scenario",
  ];
  assertFields(allocSchema, ALLOC_FIELDS);
  const allocRows = await listRecords("Account Manage", { fields: ALLOC_FIELDS });
  if (allocRows.truncated) {
    warnings.push("Account Manage was truncated — some account-management allocations are missing from this answer.");
  }

  // NEITHER WORLD CARRIES A MONTH. Live is "as things stand now"; scenario is
  // "the month ahead", rebuilt each month-end by copying scenario over live and
  // starting a fresh one. So the world a question is about is decided by WHICH
  // month is being asked about, not by a free choice:
  //
  //   this month  -> live       next month -> scenario
  //   any other month -> NEITHER set of allocations describes it
  //
  // That last case is the one worth being strict about. Attaching scenario
  // allocations to March 2027 would produce real numbers at the wrong grain,
  // which is exactly the shape of the bug that put a company total in a
  // person's headroom. Capacity is still reported for those months; allocation
  // simply is not available, and the report says so.
  const currentMonth = monthLabel(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const aheadMonth = monthLabel(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const impliedWorld: "live" | "scenario" | null =
    month === currentMonth ? "live" : month === aheadMonth ? "scenario" : null;

  const explicit = opts.basis === "live" || opts.basis === "scenario" ? opts.basis : null;
  const wantWorld = explicit ?? impliedWorld;

  if (explicit && impliedWorld && explicit !== impliedWorld) {
    warnings.push(
      `Account-management allocations were read from the ${explicit} plan, but ${month} is ` +
        `${impliedWorld === "live" ? "the current month, which the live plan describes" : "next month, which the scenario plan describes"}. ` +
        `Treat the allocation figures with care — they may not be about ${month}.`
    );
  } else if (!wantWorld) {
    warnings.push(
      `No account-management allocation is available for ${month}. Allocations exist in only two states — the ` +
        `live plan for ${currentMonth} and the scenario plan for ${aheadMonth} — and neither describes ${month}. ` +
        `Capacity below is real; allocation and headroom are simply not recorded that far out.`
    );
  }

  const useScenario = wantWorld === "scenario";
  const cuField = useScenario ? "Scenario Content Units" : "Content Units";
  const linkField = useScenario ? "Scenario CU Manage" : "CU Manage";

  const allocationByPerson = new Map<string, { cu: number; contracts: number }>();
  for (const r of allocRows.records) {
    if (!wantWorld) break;
    if (String(r.fields["live or scenario"] ?? "").toLowerCase() !== wantWorld) continue;
    const member = firstLink(r.fields["Editorial team"]);
    if (!member) continue;
    const cu = cellNumber(r.fields[cuField]);
    const contracts = Array.isArray(r.fields[linkField]) ? (r.fields[linkField] as unknown[]).length : 0;
    const acc = allocationByPerson.get(member) || { cu: 0, contracts: 0 };
    if (isNumber(cu)) acc.cu += cu;
    acc.contracts += contracts;
    allocationByPerson.set(member, acc);
  }

  const people: PersonCapacity[] = [];
  const peopleWithoutPlan: string[] = [];

  // Named separately: someone on the live roster with no capacity row for this
  // month is invisible in the answer above, and that absence is worth stating.
  // The "Live team" view is safe HERE precisely because it is narrow — it can
  // only ever under-report a gap, never truncate the roster itself.
  if (!wanted && teamSchema.views?.some((v) => v.name === "Live team")) {
    const live = await listRecords("Team", { view: "Live team", fields: ["Name"] });
    for (const person of live.records) {
      if (!byMember.has(person.id)) peopleWithoutPlan.push(String(person.fields["Name"] || "(unnamed)"));
    }
  }

  for (const personId of rosterIds) {
    const person = teamById.get(personId);
    const name = String(person?.fields["Name"] || "(unnamed)");
    const row = byMember.get(personId)!;

    // Single numeric Engine id. Absent means unlinked — left null, never 0.
    const rawId = String(person?.fields["Engine_IDs"] || "").trim();
    const firstId = rawId.split(/[,;\s]+/).filter(Boolean)[0];
    const engineUserId = firstId && /^\d+$/.test(firstId) ? Number(firstId) : null;

    const disciplines = DISCIPLINES.map((discipline) => {
      const cols = CAPACITY_COLUMNS[discipline];
      const capacity = cellNumber(row.fields[cols.capacity]);
      const hours = cols.hours ? cellNumber(row.fields[cols.hours]) : undefined;
      return {
        discipline,
        capacityCu: isNumber(capacity) ? capacity : null,
        capacityHours: isNumber(hours) ? hours : null,
      };
    }).filter((d) => d.capacityCu !== null);

    const amCapacity = disciplines.find((d) => d.discipline === "Account Management")?.capacityCu ?? null;
    const alloc = allocationByPerson.get(personId);
    // With no plan describing this month, allocation is UNKNOWN, not zero.
    // Emitting allocatedCu 0 and headroomCu = full capacity would be the exact
    // null-is-not-zero failure this file exists to prevent — and the worst
    // version of it, since it reports everyone as completely free. A prose
    // warning alongside is not enough: the numbers have to be absent.
    const accountManagement =
      !wantWorld || (amCapacity === null && !alloc)
        ? null
        : {
            capacityCu: amCapacity,
            allocatedCu: alloc?.cu ?? 0,
            headroomCu: amCapacity === null ? null : amCapacity - (alloc?.cu ?? 0),
            contracts: alloc?.contracts ?? 0,
            allocationIsCurrentState: true as const,
          };

    people.push({
      name,
      team: (person?.fields["Team"] as string) || null,
      job: (person?.fields["Job"] as string) || null,
      engineUserId,
      disciplines,
      accountManagement,
    });
  }

  if (peopleWithoutPlan.length) {
    warnings.push(
      `${peopleWithoutPlan.length} live team member(s) have no capacity row for ${month}: ` +
        `${peopleWithoutPlan.join(", ")}. They are absent from the plan, not idle — do not read them as available.`
    );
  }

  warnings.push(
    "Production capacity (Text, Video, Visuals, Strategy) is per person, but production DEMAND is not — the " +
      "month's booked CUs are split across formats by ratio at company level. So these are capacity POOLS per " +
      "person, not personal workloads, and who is 'most free' in a production discipline cannot be answered " +
      "from this base. Account Management is the exception: allocation there is per person."
  );
  if (useScenario) {
    warnings.push(
      "These are SCENARIO account-management allocations — the forward plan, not what is committed today. " +
        "Note that the discipline capacity-vs-demand figures below are IDENTICAL in the live and scenario " +
        "worlds: moving a contract between managers does not create or destroy a CU, so scenario changes who " +
        "carries the work, never how much of it there is. Do not present a scenario as reducing the shortfall."
    );
  }
  if (people.some((p) => p.accountManagement?.allocatedCu)) {
    warnings.push(
      "Account Management allocation is CURRENT STATE, not " +
        month +
        "'s — the Account Manage table has no month link. Read it as the standing load each manager carries " +
        "today, set against the capacity they are expected to have in " +
        month +
        "."
    );
  }

  // The company-level demand figures, so the per-person pools above are read
  // against something. Without these, a reader sees "Text: 7 CU" and has no
  // way to know the Text pool as a whole is 58% short.
  const disciplineTotals = DISCIPLINES.map((discipline) => {
    const cols = MONTHLY_DEMAND[discipline];
    const capacity = cellNumber(monthRecord.fields[cols.capacity]);
    const vs = cellNumber(monthRecord.fields[cols.vsDemand]);
    const freelancer = cols.freelancer ? cellNumber(monthRecord.fields[cols.freelancer]) : undefined;
    // Demand is not stored directly for AM; it is the whole month's booked
    // total. Deriving it from capacity × ratio keeps one source of truth.
    const demand = isNumber(capacity) && isNumber(vs) ? capacity * vs : null;
    return {
      discipline,
      capacityCu: isNumber(capacity) ? capacity : null,
      demandCu: demand,
      demandOverCapacity: isNumber(vs) ? vs : null,
      freelancerEstimateChf: isNumber(freelancer) ? freelancer : null,
    };
  });

  // ── compare: this month's live plan against next month's scenario ──
  //
  // Computed HERE, from fetches already made, rather than by returning two
  // payloads for the model to subtract. Arithmetic across separate tool results
  // is the pattern that produced the company-total-in-a-person's-headroom bug:
  // the model cannot see that two numbers are at different grains, and nothing
  // stops it differencing them anyway.
  let comparison: CapacityData["comparison"] = undefined;
  if (opts.basis === "compare") {
    // BOTH SIDES ARE BUILT FROM SCRATCH HERE, independent of `month`.
    //
    // The first version reused `byMember` and `allocationByPerson` for the live
    // side. Those are indexed against the REQUESTED month and the plan that
    // month implies — so asking to compare with month="next month", which is
    // the obvious way to phrase it, made both sides the scenario plan and every
    // delta came out exactly zero. "Nothing moves between the plans", stated
    // confidently, against a real 12.8 CU shift. Passing a far month was worse:
    // the live side collapsed to zero allocation and everyone appeared to gain
    // their entire scenario load.
    //
    // A comparison is always between the same two things — this month's live
    // plan and next month's scenario — so nothing about it may depend on which
    // month was asked about.
    const capacityIndexFor = (label: string) => {
      const rec = findMonthRow(monthly.records, label);
      const index = new Map<string, AirtableRecord>();
      if (rec) {
        for (const row of resourcing.records) {
          const months = row.fields["Months"];
          if (!Array.isArray(months) || !months.includes(rec.id)) continue;
          const m = firstLink(row.fields["Team member"]);
          if (m) index.set(m, row);
        }
      }
      return { rec, index };
    };

    const allocationFor = (world: "live" | "scenario") => {
      const cuCol = world === "scenario" ? "Scenario Content Units" : "Content Units";
      const linkCol = world === "scenario" ? "Scenario CU Manage" : "CU Manage";
      const byPerson = new Map<string, { cu: number; contracts: number }>();
      let unassigned = 0;
      for (const r of allocRows.records) {
        if (String(r.fields["live or scenario"] ?? "").toLowerCase() !== world) continue;
        const cu = cellNumber(r.fields[cuCol]);
        const member = firstLink(r.fields["Editorial team"]);
        if (!member) {
          // Allocated work with nobody attached yet. This is typically a
          // contract that has just been confirmed and not yet given an account
          // manager — a specific assignment to make, rather than either a
          // systemic gap or something to pass over in silence.
          if (isNumber(cu)) unassigned += cu;
          continue;
        }
        const contracts = Array.isArray(r.fields[linkCol]) ? (r.fields[linkCol] as unknown[]).length : 0;
        const acc = byPerson.get(member) || { cu: 0, contracts: 0 };
        if (isNumber(cu)) acc.cu += cu;
        acc.contracts += contracts;
        byPerson.set(member, acc);
      }
      return { byPerson, unassigned };
    };

    const live = capacityIndexFor(currentMonth);
    const ahead = capacityIndexFor(aheadMonth);
    const aheadRecord = ahead.rec;
    const aheadCapacity = ahead.index;
    const liveCapacity = live.index;
    const liveAlloc = allocationFor("live").byPerson;
    const scenarioSide = allocationFor("scenario");
    const scenarioAlloc = scenarioSide.byPerson;
    const unassignedCu = scenarioSide.unassigned;

    if (!live.rec) {
      warnings.push(
        `${currentMonth} has no row in the plan, so the live side of this comparison has no capacity to ` +
          `measure against. Allocation is shown; headroom on that side is not.`
      );
    }

    const amCapacityOf = (row: AirtableRecord | undefined): number | null => {
      if (!row) return null;
      const v = cellNumber(row.fields[CAPACITY_COLUMNS["Account Management"].capacity]);
      return isNumber(v) ? v : null;
    };

    // Anyone with capacity OR allocation on either side. Building this from
    // the allocation maps alone would drop a manager who has capacity in both
    // months but is allocated nothing — precisely the person with the most
    // headroom, and the one the question is usually about.
    const everyone = new Set<string>([
      ...Array.from(liveAlloc.keys()),
      ...Array.from(scenarioAlloc.keys()),
      ...Array.from(liveCapacity.keys()),
      ...Array.from(aheadCapacity.keys()),
    ]);

    comparison = {
      from: { month: currentMonth, basis: "live" },
      to: { month: aheadMonth, basis: "scenario" },
      unassignedCu,
      people: Array.from(everyone)
        .map((id) => {
          const fromCapacity = amCapacityOf(liveCapacity.get(id));
          const toCapacity = amCapacityOf(aheadCapacity.get(id));
          const fromAllocated = liveAlloc.get(id)?.cu ?? 0;
          const toAllocated = scenarioAlloc.get(id)?.cu ?? 0;
          const fromHeadroom = fromCapacity === null ? null : fromCapacity - fromAllocated;
          const toHeadroom = toCapacity === null ? null : toCapacity - toAllocated;
          return {
            name: String(teamById.get(id)?.fields["Name"] || "(unnamed)"),
            fromCapacity,
            fromAllocated,
            fromHeadroom,
            toCapacity,
            toAllocated,
            toHeadroom,
            allocationDelta: toAllocated - fromAllocated,
            headroomDelta: fromHeadroom === null || toHeadroom === null ? null : toHeadroom - fromHeadroom,
          };
        })
        .filter((p) => p.fromCapacity !== null || p.toCapacity !== null || p.fromAllocated || p.toAllocated)
        // A question about one person gets one person's comparison. Without
        // this, `person` narrowed the roster above but not the table below, so
        // asking about one manager returned the whole team's shift.
        .filter((p) => (wanted ? p.name.toLowerCase().includes(wanted) : true))
        // Least headroom first: the answer to "who is in trouble next month"
        // should be the first row, not buried. Null capacity sorts last rather
        // than as zero, since unknown is not the same as none.
        .sort((a, b) => (a.toHeadroom ?? Number.POSITIVE_INFINITY) - (b.toHeadroom ?? Number.POSITIVE_INFINITY)),
    };

    if (!aheadRecord) {
      warnings.push(
        `${aheadMonth} has no row in the plan, so the scenario side of this comparison has no capacity to ` +
          `measure against. Allocation is shown; headroom is not.`
      );
    }
    if (unassignedCu) {
      warnings.push(
        `${unassignedCu} CU in the scenario plan has no account manager assigned — usually a contract confirmed ` +
          `since the plan was last touched. Surface it as an action: someone needs assigning in Airtable. It is ` +
          `not counted in anyone's figures above, so the per-person totals will rise once it is. Do not describe ` +
          `it as unresourced or at risk, and do not spread it across the team as if it were already allocated.`
      );
    }
    const liveTotal = Array.from(liveAlloc.values()).reduce((a, b) => a + b.cu, 0);
    const scenarioTotal = Array.from(scenarioAlloc.values()).reduce((a, b) => a + b.cu, 0);
    warnings.push(
      `This compares ${currentMonth}'s live plan with ${aheadMonth}'s scenario plan — the two plans the base ` +
        `holds. They cover DIFFERENT MONTHS as well as different allocations, so the totals differ legitimately: ` +
        `${liveTotal} CU allocated in ${currentMonth} against ${scenarioTotal} CU in ${aheadMonth}. A person's ` +
        `delta therefore mixes two things — work reassigned between managers, and next month simply carrying ` +
        `more or less work than this one. Do not describe a rise as someone being given more of the same load.`
    );
  }

  return ok(
    "capacity",
    { month, basis: wantWorld, planLoaded: true, people, peopleWithoutPlan, disciplineTotals, comparison },
    warnings
  );
}

/* ─────────────── Report: horizon ─────────────── */

/**
 * Which total the format ratios get applied to.
 *
 * These are three different questions, not three precisions of one:
 *   booked   — work that exists. The floor.
 *   forecast — booked plus opportunities weighted by conversion. The plan.
 *   pipeline — booked plus every opportunity at full value. The ceiling.
 *
 * Verified on September 2026: `CU forecasted booked` 99.983 + `CU forecasted
 * contracted opportunities with manual override` 15.8 = `CU forecasted smart`
 * 115.783 exactly, against 35.75 CU of raw opportunity — an implied 44%
 * conversion. So `CU: booked + opps` is UNWEIGHTED, and presenting it as the
 * plan would overstate every shortfall by roughly the unconverted pipeline.
 */
export const DEMAND_BASIS = {
  booked: { field: "Total CUs booked", label: "booked work only" },
  forecast: { field: "CU forecasted smart", label: "booked plus opportunities weighted by conversion" },
  pipeline: { field: "CU: booked + opps", label: "booked plus ALL opportunities at full value — a ceiling, not a plan" },
} as const;

export type DemandBasis = keyof typeof DEMAND_BASIS;

export interface HorizonMonth {
  month: string;
  demandCu: number | null;
  targetCu: number | null;
  /** True only when EVERY discipline has capacity entered for the month. */
  capacityLoaded: boolean;
  /** Named, because a partly-loaded month is the dangerous case. */
  disciplinesWithoutCapacity: Discipline[];
  disciplines: {
    discipline: Discipline;
    capacityCu: number | null;
    /** False means nobody's capacity is entered — not that the team is zero. */
    capacityLoaded: boolean;
    demandCu: number | null;
    shortfallCu: number | null;
    demandOverCapacity: number | null;
    /** null for Account Management — see `remedy`. */
    freelancerCostChf: number | null;
    /**
     * What can actually be done about a shortfall in this discipline.
     * Production can be bought in by the CU; account management cannot, so its
     * only levers are delaying work or adding capacity.
     */
    remedy: "freelance" | "delay-or-add-capacity";
  }[];
}

export interface HorizonData {
  basis: DemandBasis;
  basisMeans: string;
  from: string;
  months: HorizonMonth[];
  /** The month each discipline first goes over capacity — the actionable bit. */
  firstShort: { discipline: Discipline; month: string | null }[];
  /** Freelancer cost across the horizon, at the base's own 250 CHF/CU. */
  totalFreelancerCostChf: number | null;
}

/** CHF per CU the base uses for freelancer estimates — verified, not assumed. */
const FREELANCER_CHF_PER_CU = 250;

/**
 * Where capacity lands over the next several months, and when we first run short.
 *
 * Costs no more Airtable calls than a single month: `Monthly resourcing` is 66
 * rows fetched whole either way, and the per-discipline capacity on it is
 * already the rollup of every person's row.
 *
 * Deliberately does NOT touch Contracts Monthly. That table exceeds the page
 * ceiling and would have to be fetched per month; the monthly rollups carry the
 * same totals, and using them keeps this report's numbers identical to the ones
 * in the base's own views.
 */
export async function horizonReport(
  opts: { months?: number; basis?: DemandBasis; now?: Date } = {}
): Promise<ReportResult<HorizonData>> {
  const now = opts.now || new Date();
  const basis: DemandBasis = opts.basis && opts.basis in DEMAND_BASIS ? opts.basis : "forecast";
  const span = Math.min(Math.max(Math.floor(opts.months ?? 6), 1), 24);

  const { tables } = await getBaseSchema();
  const monthlySchema = readSchema(tables, "Monthly resourcing");
  const ratioFields = DISCIPLINES.map((d) => MONTHLY_DEMAND[d].ratio).filter((x): x is string => !!x);
  assertFields(monthlySchema, [
    "Month",
    "CU Target",
    ...Object.values(DEMAND_BASIS).map((b) => b.field),
    ...DISCIPLINES.map((d) => MONTHLY_DEMAND[d].capacity),
    ...ratioFields,
  ]);

  const warnings: string[] = [];
  const rows = await listRecords("Monthly resourcing");

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const wanted: string[] = [];
  for (let i = 0; i < span; i++) {
    wanted.push(monthLabel(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  }

  const num = (rec: AirtableRecord, field: string): number | null => {
    const v = cellNumber(rec.fields[field]);
    return isNumber(v) ? v : null;
  };

  const months: HorizonMonth[] = [];
  const missing: string[] = [];

  for (const label of wanted) {
    const rec = findMonthRow(rows.records, label);
    if (!rec) {
      missing.push(label);
      continue;
    }
    const demand = num(rec, DEMAND_BASIS[basis].field);

    const disciplines = DISCIPLINES.map((d) => {
      const cols = MONTHLY_DEMAND[d];
      const capacity = num(rec, cols.capacity);
      // Account Management is measured against the WHOLE total — every CU needs
      // managing — while production formats take their ratio share.
      const ratio = cols.ratio ? num(rec, cols.ratio) : 1;
      const disciplineDemand = demand !== null && ratio !== null ? demand * ratio : null;

      // Zero capacity means NOBODY'S CAPACITY HAS BEEN ENTERED for this
      // discipline this month — not that a team of zero people faces the whole
      // demand. Treating it as real produced two contradictory claims in one
      // payload: `demandOverCapacity` guarded against dividing by zero and so
      // reported the discipline as never short, while `shortfallCu` billed its
      // entire demand as freelancer cost. Both are now absent, which is the
      // honest answer, and `loaded` says why.
      const loaded = capacity !== null && capacity > 0;
      const shortfall = loaded && disciplineDemand !== null ? Math.max(0, disciplineDemand - capacity) : null;

      return {
        discipline: d,
        capacityCu: capacity,
        capacityLoaded: loaded,
        demandCu: disciplineDemand,
        shortfallCu: shortfall,
        demandOverCapacity: loaded && disciplineDemand !== null ? disciplineDemand / capacity : null,
        // Production shortfalls are priced; an AM shortfall is not, and the
        // difference is not a gap in the data. Account management cannot be
        // bought in by the CU the way production can, so the only levers are
        // delaying work or adding capacity. Pricing it at 250 CHF/CU would
        // invent a remedy that does not exist.
        freelancerCostChf: cols.freelancer && shortfall !== null ? shortfall * FREELANCER_CHF_PER_CU : null,
        remedy: cols.freelancer
          ? ("freelance" as const)
          : ("delay-or-add-capacity" as const),
      };
    });

    months.push({
      month: label,
      demandCu: demand,
      targetCu: num(rec, "CU Target"),
      // Per-discipline, not month-level. An ANY test called a month "loaded"
      // when only one discipline had capacity, so the rest were silently
      // charged their full demand and the "no capacity entered" warning never
      // fired for them.
      capacityLoaded: disciplines.every((d) => d.capacityLoaded),
      disciplinesWithoutCapacity: disciplines.filter((d) => !d.capacityLoaded).map((d) => d.discipline),
      disciplines,
    });
  }

  if (missing.length) {
    warnings.push(
      `${missing.length} of the next ${span} months are not in the plan at all (${missing.join(", ")}). ` +
        `They are omitted below rather than shown as empty — the plan does not reach that far, which is not ` +
        `the same as having no demand.`
    );
  }
  const unloaded = months.filter((m) => m.disciplinesWithoutCapacity.length);
  if (unloaded.length) {
    warnings.push(
      "Some disciplines have NO capacity entered for these months, so they have no shortfall and no freelancer " +
        "cost — absent, not zero, and NOT to be read as the team being fully short: " +
        unloaded.map((m) => `${m.month} (${m.disciplinesWithoutCapacity.join(", ")})`).join("; ") +
        `. The total freelancer cost below therefore covers only the disciplines that ARE loaded.`
    );
  }

  const firstShort = DISCIPLINES.map((discipline) => ({
    discipline,
    month:
      months.find((m) => {
        const d = m.disciplines.find((x) => x.discipline === discipline);
        return d?.capacityLoaded && d.demandOverCapacity != null && d.demandOverCapacity > 1;
      })?.month ?? null,
  }));

  const costs = months
    .flatMap((m) => m.disciplines.filter((d) => d.capacityLoaded).map((d) => d.freelancerCostChf))
    .filter((c): c is number => c !== null);

  warnings.push(
    `Demand basis: ${basis} — ${DEMAND_BASIS[basis].label}. Switching basis changes every figure here, so say ` +
      `which one you are quoting.`
  );

  // Said explicitly because the absence of a cost figure beside an AM shortfall
  // otherwise reads as missing data rather than as a different kind of problem.
  const amShort = months.filter((m) => {
    const am = m.disciplines.find((d) => d.discipline === "Account Management");
    return am?.capacityLoaded && am.demandOverCapacity != null && am.demandOverCapacity > 1;
  });
  if (amShort.length) {
    warnings.push(
      `Account management is over capacity in ${amShort.map((m) => m.month).join(", ")}. There is no freelancer ` +
        `cost against it because account management cannot be bought in by the CU the way production can — the ` +
        `levers are delaying work or adding capacity. Report it as something to flag, not something to price.`
    );
  }

  return ok(
    "horizon",
    {
      basis,
      basisMeans: DEMAND_BASIS[basis].label,
      from: wanted[0],
      months,
      firstShort,
      totalFreelancerCostChf: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    },
    warnings
  );
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

  // Customer and Booking status here are LOOKUPS, which return the values
  // themselves — unlike the same-named LINK fields on Contracts, which return
  // record ids. Contract IS a link, so it needs resolving.
  const contractNames = await nameIndex("Contracts", "Contract name");

  const planRows: ClientPlanRow[] = rows.records
    .map((r) => {
      const customerCell = r.fields["Customer"];
      const client = Array.isArray(customerCell) ? String(customerCell[0] ?? "") : String(customerCell ?? "");
      return {
        client,
        engineClientId: engineIdByName.get(client.toLowerCase()) ?? null,
        contract: linkNames(r.fields["Contract"], contractNames).join(", "),
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
      // Scoped to the SAME clients as the plan rows above when a client filter
      // is in play. Without this, asking about one client returns that
      // client's plan beside every client's delivered CUs — two numbers that
      // invite exactly the comparison they cannot support.
      const known = new Set(
        wanted
          ? planRows.map((r) => r.engineClientId).filter((id): id is number => id != null)
          : Array.from(engineIdByName.values())
      );
      for (const [engineClientId, row] of Array.from(actuals.byClient.entries())) {
        if (known.has(engineClientId)) engineDelivered.push({ engineClientId, cu: row.cu, taskCount: row.taskCount });
        else if (!wanted) unmatchedEngineClientIds.push(engineClientId);
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
  // Customer and Account Manager are LINK fields, so the cells hold record ids
  // rather than names. Resolving them is what makes the rows readable at all,
  // and — less visibly — what makes the `client` filter below able to match.
  const [customerNames, teamNames] = await Promise.all([
    nameIndex("Customer", "Customer"),
    nameIndex("Team", "Name"),
  ]);

  // Booking status and Contract status are plain selects on this table, not
  // links, so they are read directly.
  const selectValue = (v: unknown): string | null =>
    Array.isArray(v) ? (v.length ? String(v[0]) : null) : v == null ? null : String(v);

  let out: ContractHealthRow[] = rows.records.map((r) => ({
    contract: String(r.fields["Contract name"] || "(unnamed)"),
    client: linkNames(r.fields["Customer"], customerNames).join(", "),
    bookingStatus: selectValue(r.fields["Booking status"]),
    contractStatus: selectValue(r.fields["Contract status"]),
    startDate: (r.fields["Start date"] as string) || null,
    endDate: (r.fields["End date"] as string) || null,
    endingInDays: num(r.fields["Contract ending days"]),
    contractedCu: num(r.fields["Contracted CUs"]),
    commissionedCu: num(r.fields["Commissioned CUs"]),
    remainingCu: num(r.fields["Remaining CUs"]),
    deliveredPct: num(r.fields["Contract delivered %"]),
    accountManager: linkNames(r.fields["Account Manager"], teamNames).join(", ") || null,
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
    /** Demand ÷ capacity. Above 1.0 means the discipline is short. */
    demandOverCapacity: number | null;
    /** Derived as capacity × demandOverCapacity, so there is one source. */
    demandCu: number | null;
    /** CHF, NOT CUs — the base computes shortfall × 250 CHF/CU. Reading this
     *  as CUs makes a 17-CU Text team look like it needs 2,477 CUs of freelance. */
    freelancerEstimateChf: number | null;
    /** Share of the month's booked CUs this format is assumed to take. */
    ratio: number | null;
  }[];
  totals: {
    cuBooked: number | null;
    cuBookedPlusOpportunities: number | null;
    cuDelivered: number | null;
    cuTarget: number | null;
    cuGapBooked: number | null;
    /** CHF, NOT CUs. */
    freelancerEstimateChf: number | null;
    activeCustomers: number | null;
  };
  /** Formats carrying a ratio but no capacity line — Social publishing and
   *  Contract adjustment, 7% of every month's CUs. Reported so the four
   *  production comparisons are not mistaken for the whole picture. */
  ratioWithoutCapacity: { name: string; ratio: number | null; cu: number | null }[];
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
    "Social publishing ratio",
    "Contract adjustment ratio",
    ...DISCIPLINES.map((d) => MONTHLY_DEMAND[d].ratio).filter((x): x is string => !!x),
  ]);

  // Matched on the text label, not Date — see findMonthRow. Date is empty on
  // every month after June 2025, which is all the months anyone asks about.
  const rows = await listRecords("Monthly resourcing");
  const row = findMonthRow(rows.records, month);

  if (!row) {
    const horizon = planHorizon(rows.records);
    throw new Error(
      `The resourcing plan has no row for ${month}` +
        (horizon ? `; it runs to ${horizon}.` : ".") +
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
      disciplines: DISCIPLINES.map((d) => {
        const capacity = n(capacityCol[d]);
        const vs = n(capacityVsDemand[d]);
        return {
          discipline: d,
          capacityCu: capacity,
          demandOverCapacity: vs,
          demandCu: capacity !== null && vs !== null ? capacity * vs : null,
          freelancerEstimateChf: freelancerCol[d] ? n(freelancerCol[d]!) : null,
          ratio: MONTHLY_DEMAND[d].ratio ? n(MONTHLY_DEMAND[d].ratio!) : null,
        };
      }),
      totals: {
        cuBooked: n("Total CUs booked"),
        cuBookedPlusOpportunities: n("CU: booked + opps"),
        cuDelivered: n("CU: delivered"),
        cuTarget: n("CU Target"),
        cuGapBooked: n("CU Gap: booked"),
        freelancerEstimateChf: n("Total freelancer estimate"),
        activeCustomers: n("Active customers"),
      },
      // 7% of the month's CUs are split to formats with no capacity line, so
      // the four production comparisons above cover 93% of the work, not all
      // of it. Stating that is the difference between a gap and a blind spot.
      ratioWithoutCapacity: (["Social publishing ratio", "Contract adjustment ratio"] as const).map((field) => {
        const ratio = n(field);
        const booked = n("Total CUs booked");
        return {
          name: field.replace(/ ratio$/, ""),
          ratio,
          cu: ratio !== null && booked !== null ? booked * ratio : null,
        };
      }),
      freelancers: {
        committedCu,
        byDiscipline: Array.from(byDiscipline.entries()).map(([discipline, cu]) => ({ discipline, cu })),
        unmappedCu: Array.from(unmapped.entries()).map(([format, cu]) => ({ format, cu })),
      },
    },
    warnings
  );
}
