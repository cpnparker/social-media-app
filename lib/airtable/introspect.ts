/**
 * Phase 0 analysis of the resourcing base, shared by the CLI script and the
 * admin endpoint so the two cannot drift.
 *
 * This answers the three questions the plan says decide the shape of every
 * report downstream. It is deliberately opinionated about the first one: the
 * identity join is the part that fails silently and expensively, so a missing
 * email column is reported as a blocker rather than as an observation.
 */
import { getBaseSchema, listRecords, type AirtableTable } from "./client";

const EMAIL_HINTS = ["email", "e-mail", "mail"];
const PERSON_HINTS = ["person", "people", "team", "staff", "member", "resource", "employee"];
const CLIENT_HINTS = ["client", "customer", "account", "company", "organisation", "organization"];
const PERIOD_HINTS = ["month", "period", "forecast", "plan", "expectation", "target", "quota", "capacity"];

const has = (s: string, hints: string[]) => hints.some((h) => s.toLowerCase().includes(h));

export interface FieldSummary {
  name: string;
  type: string;
  linkedTableId?: string;
}

export interface TableSummary {
  name: string;
  id: string;
  fields: FieldSummary[];
  views: string[];
  /** Populated only when counts are requested — each count costs API calls. */
  rowCount?: number;
  truncated?: boolean;
  countError?: string;
}

export interface Phase0Findings {
  tables: TableSummary[];
  people: {
    table: string;
    emailFields: string[];
    /** The design-blocking case: no email means the identity join has to fall
     *  back to display names, which merges duplicate-named colleagues. */
    blocked: boolean;
  }[];
  periodTables: { table: string; periodFields: string[]; linkFields: string[] }[];
  clientTables: { table: string; idLikeFields: string[]; mustMatchOnName: boolean }[];
  warnings: string[];
}

export function analyseSchema(tables: AirtableTable[]): Phase0Findings {
  const warnings: string[] = [];

  const summaries: TableSummary[] = tables.map((t) => ({
    name: t.name,
    id: t.id,
    fields: t.fields.map((f) => ({
      name: f.name,
      type: f.type,
      linkedTableId: f.type === "multipleRecordLinks" ? ((f.options as any)?.linkedTableId as string | undefined) : undefined,
    })),
    views: (t.views || []).map((v) => v.name),
  }));

  const people = tables
    .filter((t) => has(t.name, PERSON_HINTS))
    .map((t) => {
      const emailFields = t.fields.filter((f) => f.type === "email" || has(f.name, EMAIL_HINTS)).map((f) => f.name);
      return { table: t.name, emailFields, blocked: emailFields.length === 0 };
    });

  if (!people.length) {
    warnings.push("No table name looked like people/team — the people table needs identifying by eye from the field lists.");
  }
  for (const p of people.filter((x) => x.blocked)) {
    warnings.push(
      `"${p.table}" has no email column. Joining Airtable people to Engine users on display name is unsafe — production has two distinct users called "Mike Parsons" and two called "Faher Elfayez", so capacity would be silently merged. Add an email column before building reports on this table.`
    );
  }

  const periodTables = tables
    .filter((t) => has(t.name, PERIOD_HINTS) || t.fields.some((f) => has(f.name, PERIOD_HINTS)))
    .map((t) => ({
      table: t.name,
      periodFields: t.fields.filter((f) => ["date", "dateTime"].includes(f.type) || has(f.name, PERIOD_HINTS)).map((f) => f.name),
      linkFields: t.fields.filter((f) => f.type === "multipleRecordLinks").map((f) => f.name),
    }));

  if (!periodTables.length) {
    warnings.push(
      "Nothing matched on monthly expectations or capacity. Those forward-looking numbers are the whole reason for this integration — confirm they exist before building the monthly_plan report."
    );
  }

  const clientTables = tables
    .filter((t) => has(t.name, CLIENT_HINTS))
    .map((t) => {
      const idLikeFields = t.fields.filter((f) => /\bid\b|code|ref/i.test(f.name)).map((f) => f.name);
      return { table: t.name, idLikeFields, mustMatchOnName: idLikeFields.length === 0 };
    });

  for (const c of clientTables.filter((x) => x.mustMatchOnName)) {
    warnings.push(
      `"${c.table}" carries no id-like field, so clients must be matched to app_clients on normalised name. Unmatched rows must be REPORTED, never dropped silently.`
    );
  }

  return { tables: summaries, people, periodTables, clientTables, warnings };
}

/** Full Phase 0: schema + analysis, optionally with row counts (extra API calls). */
export async function runPhase0(opts: { withCounts?: boolean } = {}): Promise<Phase0Findings> {
  const { tables } = await getBaseSchema();
  const findings = analyseSchema(tables);

  if (opts.withCounts) {
    for (const t of findings.tables) {
      try {
        const first = t.fields[0]?.name;
        const res = await listRecords(t.name, first ? { fields: [first] } : {});
        t.rowCount = res.count;
        t.truncated = res.truncated;
      } catch (e: any) {
        t.countError = String(e?.message || e).slice(0, 120);
      }
    }
  }

  return findings;
}
