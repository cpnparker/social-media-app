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
const SELECT_TYPES = new Set(["singleSelect", "multipleSelects"]);

/**
 * A column carrying an Engine user or client id outright.
 *
 * This is a better join key than email, not a worse one — it is the id itself
 * rather than a proxy for it. The first version of this file only looked for
 * email and therefore called `Team.Engine_IDs` a blocker, which was exactly
 * backwards: the base already solved the identity problem, in the one way that
 * cannot be confounded by two colleagues sharing a name.
 */
const ENGINE_ID_RE = /engine[\s_-]*id|id[\s_-]*engine/i;

const has = (s: string, hints: string[]) => hints.some((h) => s.toLowerCase().includes(h));

export interface FieldSummary {
  name: string;
  type: string;
  linkedTableId?: string;
  /**
   * Option strings for select fields.
   *
   * Worth carrying even though it makes the payload bigger: these are the
   * literal values a filter has to match. Without them the only way to learn
   * that a status is "Active and extended" rather than "active" is to read
   * records — which means reading real business data to answer a question the
   * schema already knows the answer to.
   */
  choices?: string[];
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
    /** Columns holding an Engine id directly — the strongest join available. */
    engineIdFields: string[];
    /** The design-blocking case: neither an Engine id nor an email, which
     *  leaves display name as the only join — and that merges two colleagues
     *  who happen to share one. */
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
      choices: SELECT_TYPES.has(f.type)
        ? (((f.options as any)?.choices as { name: string }[] | undefined) || []).map((c) => c.name)
        : undefined,
    })),
    views: (t.views || []).map((v) => v.name),
  }));

  const people = tables
    .filter((t) => has(t.name, PERSON_HINTS))
    .map((t) => {
      const emailFields = t.fields.filter((f) => f.type === "email" || has(f.name, EMAIL_HINTS)).map((f) => f.name);
      const engineIdFields = t.fields.filter((f) => ENGINE_ID_RE.test(f.name)).map((f) => f.name);
      // A table of links and rollups with no identity column of its own is a
      // junction — it inherits identity from what it points at, so it is not
      // missing anything. Only tables that name people directly can be blocked.
      const namesPeopleDirectly = t.fields.some(
        (f) => f.type === "singleLineText" && /name|person|member/i.test(f.name)
      );
      return {
        table: t.name,
        emailFields,
        engineIdFields,
        blocked: !emailFields.length && !engineIdFields.length && namesPeopleDirectly,
      };
    });

  if (!people.length) {
    warnings.push("No table name looked like people/team — the people table needs identifying by eye from the field lists.");
  }
  for (const p of people.filter((x) => x.blocked)) {
    warnings.push(
      `"${p.table}" has neither an Engine id nor an email column, so the only way to join it to Engine users is display name — and that is unsafe: production has two distinct users called "Mike Parsons" and two called "Faher Elfayez", whose capacity would silently merge. Add an id or email column before building reports on this table.`
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
    // The name test alone is not enough: "Account Manage" is a person↔contract
    // junction that matches on the word "Account", and calling it a client
    // table produced a confident warning about a problem it does not have.
    // A real client table names its clients in a text column of its own.
    .filter((t) => has(t.name, CLIENT_HINTS) && t.fields.some((f) => f.type === "singleLineText"))
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

export interface IdentityProbe {
  table: string;
  field: string;
  total: number;
  populated: number;
  /** Distinct shapes seen, not the values themselves — see below. */
  shapes: { pattern: string; example: string; count: number }[];
}

/**
 * What is actually IN the identity columns.
 *
 * The schema says `Team.Engine_IDs` is single-line text and the plural name
 * hints at more than one id per row, but neither tells you whether the cell
 * holds `41`, `41,58`, or `chris@thecontentengine.com`. The join cannot be
 * written until that is known, and it is the one Phase 0 question the schema
 * genuinely cannot answer.
 *
 * It reports SHAPES rather than values — `digits`, `digits,digits`, `email` —
 * with one example per shape. That is enough to write the parser and stops a
 * diagnostic endpoint from turning into a staff-roster export.
 */
export async function probeIdentity(): Promise<IdentityProbe[]> {
  const { tables } = await getBaseSchema();
  const { people } = analyseSchema(tables);
  const out: IdentityProbe[] = [];

  for (const p of people) {
    for (const field of [...p.engineIdFields, ...p.emailFields]) {
      const res = await listRecords(p.table, { fields: [field] });
      const shapes = new Map<string, { example: string; count: number }>();
      let populated = 0;

      for (const rec of res.records) {
        const raw = rec.fields[field];
        if (raw === undefined || raw === null || raw === "") continue;
        populated++;
        const value = String(raw);
        const pattern = value
          .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "email")
          .replace(/\d+/g, "digits")
          .replace(/\s+/g, " ")
          .trim();
        const seen = shapes.get(pattern);
        if (seen) seen.count++;
        // An example is only safe once the pattern shows it holds no address.
        // Otherwise the "shapes, not values" promise above would be a lie the
        // first time this ran over the Freelancers table.
        else shapes.set(pattern, { example: pattern.includes("email") ? "(withheld)" : value.slice(0, 40), count: 1 });
      }

      out.push({
        table: p.table,
        field,
        total: res.count,
        populated,
        shapes: Array.from(shapes.entries())
          .map(([pattern, v]) => ({ pattern, ...v }))
          .sort((a, b) => b.count - a.count),
      });
    }
  }

  return out;
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
