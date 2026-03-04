/**
 * Clockify API client utilities (server-side only)
 *
 * Clockify structure at TCE:
 *   - Clients: e.g. "Bahrain", "MASDAR", "Zurich Insurance"
 *   - Projects: activity types linked to clients via clientId
 *     e.g. "Content Production" (clientId → Bahrain)
 *          "Account Management" (clientId → Bahrain)
 *          "Strategy" (clientId → Bahrain)
 *   - Time entries: linked to a project (and thus indirectly to a client)
 */

const BASE_URL = "https://api.clockify.me/api/v1";
const PAGE_SIZE = 200;

function headers(): Record<string, string> {
  const key = process.env.CLOCKIFY_API_KEY;
  if (!key) throw new Error("CLOCKIFY_API_KEY is not set");
  return { "X-Api-Key": key, "Content-Type": "application/json" };
}

function workspaceId(): string {
  const id = process.env.CLOCKIFY_WORKSPACE_ID;
  if (!id) throw new Error("CLOCKIFY_WORKSPACE_ID is not set");
  return id;
}

// ── Types ──────────────────────────────────────────

export interface ClockifyClient {
  id: string;
  name: string;
}

export interface ClockifyProject {
  id: string;
  name: string; // activity type, e.g. "Content Production"
  clientId: string | null;
  archived: boolean;
}

export interface ClockifyUser {
  id: string;
  name: string;
  email: string;
}

export interface ClockifyTimeEntry {
  id: string;
  description: string;
  userId: string;
  projectId: string;
  billable: boolean;
  timeInterval: {
    start: string;
    end: string;
    duration: string; // ISO 8601 e.g. "PT2H30M"
  };
}

// ── Duration parser ────────────────────────────────

/**
 * Parse ISO 8601 duration (e.g. "PT2H30M", "PT45M", "PT1H") to decimal hours.
 */
export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours + minutes / 60 + seconds / 3600;
}

// ── API fetchers ───────────────────────────────────

export async function getClockifyClients(): Promise<ClockifyClient[]> {
  const wsId = workspaceId();
  const allClients: ClockifyClient[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${BASE_URL}/workspaces/${wsId}/clients?page=${page}&page-size=${PAGE_SIZE}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Clockify clients error: ${res.status}`);
    const data = await res.json();
    for (const c of data) allClients.push({ id: c.id, name: c.name });
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return allClients;
}

export async function getClockifyProjects(): Promise<ClockifyProject[]> {
  const wsId = workspaceId();
  const allProjects: ClockifyProject[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${BASE_URL}/workspaces/${wsId}/projects?page=${page}&page-size=${PAGE_SIZE}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Clockify projects error: ${res.status}`);
    const data = await res.json();
    for (const p of data) {
      allProjects.push({
        id: p.id,
        name: p.name,
        clientId: p.clientId || null,
        archived: p.archived || false,
      });
    }
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return allProjects;
}

export async function getClockifyUsers(): Promise<ClockifyUser[]> {
  const wsId = workspaceId();
  const res = await fetch(
    `${BASE_URL}/workspaces/${wsId}/users?page-size=${PAGE_SIZE}`,
    { headers: headers(), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Clockify users error: ${res.status}`);
  const data = await res.json();
  return data.map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
}

/** Small delay helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a single Clockify API page with retry on 429 (rate limit).
 * Retries up to 3 times with exponential back-off.
 */
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  label: string,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429 && attempt < retries) {
      // Use Retry-After header if available, else exponential back-off
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      console.warn(
        `[Clockify] 429 rate limit for ${label}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`
      );
      await sleep(waitMs);
      continue;
    }
    return res;
  }
  // Should not reach here, but return the last attempt
  return fetch(url, opts);
}

/**
 * Fetch time entries for ALL users in a date range.
 * Processes users in small batches to avoid Clockify API rate limits.
 */
export async function getAllTimeEntries(
  from: string,
  to: string
): Promise<ClockifyTimeEntry[]> {
  const wsId = workspaceId();
  const users = await getClockifyUsers();
  const allEntries: ClockifyTimeEntry[] = [];
  const BATCH_SIZE = 5; // Process 5 users concurrently
  const BATCH_DELAY = 500; // 500ms pause between batches

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (user) => {
        let page = 1;
        while (true) {
          const url = new URL(
            `${BASE_URL}/workspaces/${wsId}/user/${user.id}/time-entries`
          );
          url.searchParams.set("start", from);
          url.searchParams.set("end", to);
          url.searchParams.set("page", String(page));
          url.searchParams.set("page-size", String(PAGE_SIZE));

          const res = await fetchWithRetry(
            url.toString(),
            { headers: headers(), cache: "no-store" },
            user.name
          );
          if (!res.ok) {
            console.error(
              `Clockify entries error for ${user.name}: ${res.status}`
            );
            break;
          }
          const data = await res.json();
          for (const e of data) {
            allEntries.push({
              id: e.id,
              description: e.description || "",
              userId: e.userId,
              projectId: e.projectId,
              billable: e.billable,
              timeInterval: {
                start: e.timeInterval.start,
                end: e.timeInterval.end,
                duration: e.timeInterval.duration,
              },
            });
          }
          if (data.length < PAGE_SIZE) break;
          page++;
        }
      })
    );

    // Pause between batches to stay under rate limits
    if (i + BATCH_SIZE < users.length) {
      await sleep(BATCH_DELAY);
    }
  }

  return allEntries;
}

// ── Aggregation helpers ────────────────────────────

/** Known activity types (project names that represent work categories) */
const ACTIVITY_TYPES = new Set([
  "Account Management",
  "Content Production",
  "Strategy",
]);

/** Internal/non-client project names to exclude from client profitability */
const INTERNAL_PROJECTS = new Set([
  "Internal",
  "Internal Admin",
  "Leave",
  "Holiday",
  "Training",
  "Engine Rebuild",
  "New business development",
  "Marketing",
  "Editorial approvals",
  "Writing requests",
]);

/**
 * Build per-client hour aggregation from Clockify time entries.
 * Keyed by Clockify client ID.
 */
export function buildClientProfitability(
  timeEntries: ClockifyTimeEntry[],
  projects: ClockifyProject[],
  clockifyClients: ClockifyClient[]
): {
  byClient: Record<
    string,
    {
      totalHours: number;
      billableHours: number;
      activityBreakdown: Record<string, number>;
    }
  >;
  unmatchedProjects: string[];
} {
  const projectMap = new Map<string, ClockifyProject>();
  for (const p of projects) projectMap.set(p.id, p);

  const clientNameMap = new Map<string, string>();
  for (const c of clockifyClients) clientNameMap.set(c.id, c.name);

  const byClient: Record<
    string,
    {
      totalHours: number;
      billableHours: number;
      activityBreakdown: Record<string, number>;
    }
  > = {};
  const unmatchedProjectIds = new Set<string>();

  for (const entry of timeEntries) {
    const project = projectMap.get(entry.projectId);
    if (!project) {
      unmatchedProjectIds.add(entry.projectId);
      continue;
    }
    if (INTERNAL_PROJECTS.has(project.name)) continue;
    if (!project.clientId) continue;

    const clientName = clientNameMap.get(project.clientId);
    if (!clientName) continue;
    if (clientName === "The Content Engine") continue;

    const hours = parseDuration(entry.timeInterval.duration);
    const clientId = project.clientId;

    if (!byClient[clientId]) {
      byClient[clientId] = {
        totalHours: 0,
        billableHours: 0,
        activityBreakdown: {},
      };
    }

    byClient[clientId].totalHours += hours;
    if (entry.billable) byClient[clientId].billableHours += hours;

    const activity = ACTIVITY_TYPES.has(project.name)
      ? project.name
      : "Other";
    byClient[clientId].activityBreakdown[activity] =
      (byClient[clientId].activityBreakdown[activity] || 0) + hours;
  }

  return { byClient, unmatchedProjects: Array.from(unmatchedProjectIds) };
}

// ── Fuzzy client name matching ─────────────────────

/**
 * Normalize a client name for matching:
 * lowercase, trim, strip dashes/hyphens/slashes, collapse whitespace.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[-–—/\\]/g, " ")     // replace dashes, slashes with space
    .replace(/[()]/g, "")           // remove parens
    .replace(/\s+/g, " ")           // collapse whitespace
    .trim();
}

/**
 * Extract a potential acronym from parentheses: "Islamic Development Bank (IsDB)" → "isdb"
 */
function extractParenAcronym(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1].trim().toLowerCase() : null;
}

/**
 * Match a Clockify client name to a Supabase client using fuzzy matching.
 * Returns the Supabase client or null.
 *
 * Strategy (in priority order):
 * 1. Exact match (case-insensitive, trimmed)
 * 2. Clockify name matches acronym in parentheses in Supabase name
 *    e.g. "IsDB" → "Islamic Development Bank (IsDB)"
 * 3. One name starts with the other
 *    e.g. "Bahrain" → "Bahrain EDB", "Holcim" → "Holcim Group"
 * 4. One name contains the other (minimum 4 chars to avoid false positives)
 *    e.g. "GAVI" → "GAVI The Vaccine Alliance"
 */
export function fuzzyMatchClient(
  clockifyName: string,
  supabaseClients: { id: string; name: string }[]
): { id: string; name: string } | null {
  const cn = normalize(clockifyName);

  // 1. Exact match
  for (const sc of supabaseClients) {
    if (normalize(sc.name) === cn) return sc;
  }

  // 2. Clockify name matches parenthesised acronym in Supabase
  //    (use raw name for extraction, compare against raw clockify name lowered)
  const cnRaw = clockifyName.trim().toLowerCase();
  for (const sc of supabaseClients) {
    const acronym = extractParenAcronym(sc.name);
    if (acronym && acronym === cnRaw) return sc;
  }

  // 3. One starts with the other
  for (const sc of supabaseClients) {
    const sn = normalize(sc.name);
    if (sn.startsWith(cn) || cn.startsWith(sn)) return sc;
  }

  // 4. One contains the other (min 4 chars to avoid false positives)
  if (cn.length >= 4) {
    for (const sc of supabaseClients) {
      const sn = normalize(sc.name);
      if (sn.length >= 4 && (sn.includes(cn) || cn.includes(sn))) return sc;
    }
  }

  return null;
}
