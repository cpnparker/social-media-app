/**
 * Airtable REST client for the TCE operations & resourcing base.
 *
 * Read-only, read-through: no mirror into Supabase. Same reasoning that
 * governed the Engine-tasks feature — a mirror goes stale, needs a sync job,
 * and creates a second thing to keep correct. The base is hundreds of rows,
 * not millions, and the API is fast enough to serve a tool call.
 *
 * Three things here exist because of specific ways this would otherwise break:
 *
 *  1. RATE LIMITS. Airtable allows 5 requests/second per base and 429s hard,
 *     with a 30-second lockout on repeat offence. A single chat turn can fan
 *     out across several tables, and several people can ask at once. The 60s
 *     cache and the backoff are not optimisations; without them the first busy
 *     minute in a client meeting returns errors.
 *
 *  2. PAGINATION. Airtable returns 100 records per page and an `offset`.
 *     Stopping at the first page silently answers "we have 100 contracts".
 *     This follows the offset to completion, and when it hits its own ceiling
 *     it SAYS so — `truncated` is surfaced, never swallowed. That is the
 *     lesson from the Hiscox incident, where a capped query reported itself as
 *     complete and a user was told a live contract did not exist.
 *
 *  3. FIELD NAMES. Airtable columns are renamed by whoever is editing the
 *     base, and a renamed field does not error — it returns undefined, which
 *     reads as an empty column. Callers get a helper to assert the fields they
 *     depend on and fail loudly with the missing name.
 */

const API = "https://api.airtable.com/v0";

/** Airtable's documented limit is 5 req/s per base; stay under it. */
const MIN_REQUEST_GAP_MS = 220;
const CACHE_TTL_MS = 60_000;
const MAX_PAGES = 25; // 2,500 records — far beyond this base, and a runaway guard
const REQUEST_TIMEOUT_MS = 15_000;

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

export interface AirtablePage {
  records: AirtableRecord[];
  offset?: string;
}

export interface ListResult {
  records: AirtableRecord[];
  /** Total actually retrieved. Airtable has no count API, so this is a real
   *  count of what came back, not an estimate. */
  count: number;
  /** True when MAX_PAGES stopped us before Airtable ran out of records. The
   *  caller MUST surface this rather than presenting a partial set as whole. */
  truncated: boolean;
}

export function airtableConfigured(): boolean {
  return !!(process.env.AIRTABLE_PAT && process.env.AIRTABLE_RESOURCING_BASE);
}

function pat(): string {
  return (process.env.AIRTABLE_PAT || "").trim();
}

function baseId(): string {
  return (process.env.AIRTABLE_RESOURCING_BASE || "").trim();
}

/* ─────────────── Request pacing ─────────────── */

let lastRequestAt = 0;

/** Serialise requests to stay under the per-base rate limit. In-process only,
 *  which is the honest scope: a second lambda instance has its own counter, so
 *  this reduces 429s rather than eliminating them — which is why the retry
 *  below still exists. */
async function pace(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/* ─────────────── Response cache ─────────────── */

const cache = new Map<string, { at: number; value: AirtablePage }>();

function cacheGet(key: string): AirtablePage | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: AirtablePage): void {
  // Bounded so a long-lived lambda cannot grow the map without limit.
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

/* ─────────────── Core fetch ─────────────── */

async function airtableFetch(path: string, params: URLSearchParams): Promise<AirtablePage> {
  const key = `${path}?${params.toString()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let lastError = "";
  // Two retries, both on 429 or 5xx only. A 401/404 is a configuration problem
  // and retrying it just burns the rate limit we are trying to protect.
  for (let attempt = 0; attempt < 3; attempt++) {
    await pace();
    let res: Response;
    try {
      res = await fetch(`${API}/${path}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${pat()}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: any) {
      lastError = err?.name === "TimeoutError" ? "timed out" : String(err?.message || err).slice(0, 120);
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as AirtablePage;
      cacheSet(key, json);
      return json;
    }

    if (res.status === 429 || res.status >= 500) {
      // Airtable's 429 lockout is 30s; backing off ~1s then ~2s is enough for a
      // transient burst and short enough not to blow the chat turn's budget.
      lastError = `HTTP ${res.status}`;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      continue;
    }

    const body = await res.text().catch(() => "");
    // 401/403 almost always means the PAT lacks a scope or the base is not in
    // its allow-list — worth saying, because the generic message sends people
    // hunting in the wrong place.
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Airtable rejected the token (${res.status}). Check the PAT has data.records:read and schema.bases:read, and that this base is in its access list.`
        : `Airtable request failed (${res.status}): ${body.slice(0, 160)}`
    );
  }

  throw new Error(`Airtable unavailable after retries: ${lastError}`);
}

/* ─────────────── Public API ─────────────── */

/**
 * Every record in a table (or view), following pagination to completion.
 *
 * `filterByFormula` is passed through verbatim — callers must build it, and
 * must not interpolate user text into it without escaping. Prefer filtering in
 * JS over smuggling a formula together from model output.
 */
export async function listRecords(
  table: string,
  opts: {
    view?: string;
    fields?: string[];
    filterByFormula?: string;
    maxRecords?: number;
    sort?: { field: string; direction?: "asc" | "desc" }[];
    /**
     * Raise the page ceiling for a table that is genuinely larger than the
     * default guard. Contracts Monthly is the live example: it exceeded 2,500
     * rows on the first read, so the default would report a truncated answer
     * for any unfiltered query against it. Filtering is still the right fix —
     * at 220ms between pages a 10,000-row fetch costs ~22s, which no chat turn
     * should spend — so treat this as the escape hatch, not the default.
     */
    maxPages?: number;
  } = {}
): Promise<ListResult> {
  const records: AirtableRecord[] = [];
  const pageCeiling = Math.max(1, opts.maxPages ?? MAX_PAGES);
  let offset: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (opts.view) params.set("view", opts.view);
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    if (opts.maxRecords) params.set("maxRecords", String(opts.maxRecords));
    for (const f of opts.fields || []) params.append("fields[]", f);
    (opts.sort || []).forEach((s, i) => {
      params.append(`sort[${i}][field]`, s.field);
      params.append(`sort[${i}][direction]`, s.direction || "asc");
    });
    if (offset) params.set("offset", offset);

    const page = await airtableFetch(`${baseId()}/${encodeURIComponent(table)}`, params);
    records.push(...(page.records || []));
    offset = page.offset;
    pages++;
  } while (offset && pages < pageCeiling);

  return {
    records,
    count: records.length,
    // An offset still present means Airtable had more and WE stopped.
    truncated: !!offset,
  };
}

/* ─────────────── Schema introspection ─────────────── */

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface AirtableTable {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableField[];
  views?: { id: string; name: string; type: string }[];
}

/**
 * The base's tables and their fields. This is Phase 0 — it is what tells us
 * what the reports can actually be built from, and it is also the runtime
 * guard against a renamed column.
 */
let schemaCache: { at: number; value: { tables: AirtableTable[] } } | null = null;

export async function getBaseSchema(): Promise<{ tables: AirtableTable[] }> {
  // Cached and retried like every other call. This one is easy to overlook
  // because it does not go through airtableFetch — and it is the FIRST call
  // every report makes, so without this a single transient 429 fails a report
  // that the record fetches after it would have survived. It is also the call
  // most likely to hit the rate limit, since four reports asking for the
  // schema is four requests before any data moves.
  if (schemaCache && Date.now() - schemaCache.at < CACHE_TTL_MS) return schemaCache.value;

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    await pace();
    let res: Response;
    try {
      res = await fetch(`${API}/meta/bases/${baseId()}/tables`, {
        headers: { Authorization: `Bearer ${pat()}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: any) {
      lastError = err?.name === "TimeoutError" ? "timed out" : String(err?.message || err).slice(0, 120);
      continue;
    }

    if (res.ok) {
      const value = (await res.json()) as { tables: AirtableTable[] };
      schemaCache = { at: Date.now(), value };
      return value;
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Airtable rejected the token for schema access (${res.status}). The PAT needs the schema.bases:read scope in addition to data.records:read.`
        : `Could not read base schema (${res.status}): ${body.slice(0, 160)}`
    );
  }

  throw new Error(`Could not read base schema after retries: ${lastError}`);
}

/**
 * Assert that a table still has the fields a report depends on.
 *
 * Airtable columns get renamed by whoever is editing the base, and a renamed
 * field does not error — reads just return undefined, which is indistinguishable
 * from an empty cell. A report that silently returns blanks is worse than one
 * that refuses, so this fails loudly with the missing name.
 */
export function assertFields(table: AirtableTable, required: string[]): void {
  const have = new Set(table.fields.map((f) => f.name));
  const missing = required.filter((r) => !have.has(r));
  if (missing.length) {
    throw new Error(
      `Airtable table "${table.name}" is missing expected field(s): ${missing.join(", ")}. ` +
        `They were probably renamed in the base — update the report rather than reading blanks.`
    );
  }
}

/**
 * Assert that fields still have the TYPE a report assumes, not just the name.
 *
 * Name-only checking misses the change that actually hurts. A lookup field
 * returns an ARRAY; a rollup returns a scalar. Switch one to the other in the
 * base — a thing done by dragging a column, with no warning — and every read
 * keeps succeeding while the arithmetic downstream silently changes meaning.
 * `Team resourcing`'s demand columns are lookups today, so this is not
 * hypothetical.
 */
export function assertFieldTypes(table: AirtableTable, expected: Record<string, string>): void {
  const byName = new Map(table.fields.map((f) => [f.name, f.type]));
  const wrong = Object.entries(expected)
    .filter(([name, type]) => byName.has(name) && byName.get(name) !== type)
    .map(([name, type]) => `${name} is ${byName.get(name)}, expected ${type}`);
  if (wrong.length) {
    throw new Error(
      `Airtable table "${table.name}" has field(s) of an unexpected type: ${wrong.join("; ")}. ` +
        `A lookup returns an array where a rollup returns a number, so this changes results without erroring.`
    );
  }
}

/** A number that could not be read, and must not be silently treated as zero. */
export const AMBIGUOUS = Symbol("airtable-ambiguous");

/**
 * Read a numeric cell, refusing to guess.
 *
 * The trap this exists for: Airtable lookup fields return arrays, and the
 * reflexive `Number(v) || 0` turns `[5, 3]` into NaN and then into 0. Applied
 * to a "CUs booked" lookup that means the busiest people — the ones linked to
 * several contracts — read as zero booked, i.e. as fully idle. The error is
 * invisible, and it points the wrong way: it invents capacity exactly where
 * there is least.
 *
 * So a multi-value cell returns AMBIGUOUS rather than a number, and callers
 * must exclude it from arithmetic and say so in the output. An empty cell
 * returns undefined, which is also not zero — no row for a month means the
 * plan is not loaded, not that the person has no capacity.
 */
export function cellNumber(raw: unknown): number | undefined | typeof AMBIGUOUS {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return undefined;
    if (raw.length > 1) return AMBIGUOUS;
    return cellNumber(raw[0]);
  }
  // Booleans coerce to 1/0 and would sail through the isFinite check below.
  // An Airtable checkbox read as a quantity is a type confusion, not one CU.
  if (typeof raw === "boolean") return AMBIGUOUS;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : AMBIGUOUS;
}
