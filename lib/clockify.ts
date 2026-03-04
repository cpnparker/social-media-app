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

/**
 * Fetch all Clockify clients in the workspace.
 */
export async function getClockifyClients(): Promise<ClockifyClient[]> {
  const wsId = workspaceId();
  const allClients: ClockifyClient[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${BASE_URL}/workspaces/${wsId}/clients?page=${page}&page-size=${PAGE_SIZE}`,
      { headers: headers(), next: { revalidate: 300 } }
    );
    if (!res.ok) throw new Error(`Clockify clients error: ${res.status}`);
    const data = await res.json();
    for (const c of data) {
      allClients.push({ id: c.id, name: c.name });
    }
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  return allClients;
}

/**
 * Fetch all projects in the workspace.
 */
export async function getClockifyProjects(): Promise<ClockifyProject[]> {
  const wsId = workspaceId();
  const allProjects: ClockifyProject[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${BASE_URL}/workspaces/${wsId}/projects?page=${page}&page-size=${PAGE_SIZE}`,
      { headers: headers(), next: { revalidate: 300 } }
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

/**
 * Fetch all workspace users.
 */
export async function getClockifyUsers(): Promise<ClockifyUser[]> {
  const wsId = workspaceId();
  const res = await fetch(
    `${BASE_URL}/workspaces/${wsId}/users?page-size=${PAGE_SIZE}`,
    { headers: headers(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Clockify users error: ${res.status}`);
  const data = await res.json();
  return data.map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
}

/**
 * Fetch time entries for ALL users in a date range.
 * Iterates through every user and paginates their entries.
 */
export async function getAllTimeEntries(
  from: string, // ISO date e.g. "2025-01-01T00:00:00Z"
  to: string    // ISO date e.g. "2025-12-31T23:59:59Z"
): Promise<ClockifyTimeEntry[]> {
  const wsId = workspaceId();
  const users = await getClockifyUsers();
  const allEntries: ClockifyTimeEntry[] = [];

  await Promise.all(
    users.map(async (user) => {
      let page = 1;
      while (true) {
        const url = new URL(
          `${BASE_URL}/workspaces/${wsId}/user/${user.id}/time-entries`
        );
        url.searchParams.set("start", from);
        url.searchParams.set("end", to);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page-size", String(PAGE_SIZE));

        const res = await fetch(url.toString(), { headers: headers() });
        if (!res.ok) {
          console.error(`Clockify time entries error for user ${user.name}: ${res.status}`);
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

export interface ClientProfitability {
  clockifyClientId: string;
  clientName: string;
  totalHours: number;
  billableHours: number;
  activityBreakdown: Record<string, number>; // activity → hours
  /** Matched Supabase data */
  supabaseClientId: string | null;
  cusDelivered: number;
  cusContracted: number;
  hoursPerCU: number | null;
  contracts: {
    contractId: string;
    contractName: string;
    cusDelivered: number;
    cusContracted: number;
    dateStart: string | null;
    dateEnd: string | null;
    active: boolean;
  }[];
}

/**
 * Build per-client profitability data by joining Clockify time entries
 * with project→client mappings.
 */
export function buildClientProfitability(
  timeEntries: ClockifyTimeEntry[],
  projects: ClockifyProject[],
  clockifyClients: ClockifyClient[]
): {
  byClient: Record<string, { totalHours: number; billableHours: number; activityBreakdown: Record<string, number> }>;
  unmatchedProjects: string[];
} {
  // Build project lookup
  const projectMap = new Map<string, ClockifyProject>();
  for (const p of projects) projectMap.set(p.id, p);

  // Build client name lookup
  const clientNameMap = new Map<string, string>();
  for (const c of clockifyClients) clientNameMap.set(c.id, c.name);

  const byClient: Record<string, { totalHours: number; billableHours: number; activityBreakdown: Record<string, number> }> = {};
  const unmatchedProjectIds = new Set<string>();

  for (const entry of timeEntries) {
    const project = projectMap.get(entry.projectId);
    if (!project) {
      unmatchedProjectIds.add(entry.projectId);
      continue;
    }

    // Skip internal projects
    if (INTERNAL_PROJECTS.has(project.name)) continue;

    // Skip projects without a client
    if (!project.clientId) continue;

    const clientName = clientNameMap.get(project.clientId);
    if (!clientName) continue;

    // Skip "The Content Engine" internal client
    if (clientName === "The Content Engine") continue;

    const hours = parseDuration(entry.timeInterval.duration);
    const clientId = project.clientId;

    if (!byClient[clientId]) {
      byClient[clientId] = { totalHours: 0, billableHours: 0, activityBreakdown: {} };
    }

    byClient[clientId].totalHours += hours;
    if (entry.billable) byClient[clientId].billableHours += hours;

    // Categorize activity
    const activity = ACTIVITY_TYPES.has(project.name) ? project.name : "Other";
    byClient[clientId].activityBreakdown[activity] =
      (byClient[clientId].activityBreakdown[activity] || 0) + hours;
  }

  const unmatchedProjects = Array.from(unmatchedProjectIds);

  return { byClient, unmatchedProjects };
}
