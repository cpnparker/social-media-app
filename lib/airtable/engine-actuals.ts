/**
 * Delivered CUs from Engine, for comparison against the Airtable plan.
 *
 * Airtable knows what was sold, booked and budgeted. Engine knows what was
 * actually produced. This module supplies the second half, and it exists
 * separately from the report bodies so the definition of "a delivered CU" is
 * stated once.
 *
 * Two things here are copied deliberately rather than reinvented:
 *
 *  1. BOTH task views. Every CU surface in this repo unions
 *     `app_tasks_content` and `app_tasks_social` — commissioned-cus (the route
 *     reconciled against Retool), profitability, contracts, contracts-grid and
 *     client-export all do. Querying one is not a smaller answer, it is a wrong
 *     one: it drops the entire social production stream while still looking
 *     like a complete figure.
 *
 *  2. SPIKED tasks are excluded outright, matching profitability and
 *     commissioned-cus. A spiked task is cancelled work, and counting it as
 *     delivered would flatter every delivery figure.
 *
 * Both date columns are TEXT bare dates, so the filters are bare `gte` and
 * `lt(nextDay)` — never a T-suffixed timestamp, which matches nothing.
 */
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { nextDay } from "@/lib/date-utils";
import { parseMonthLabel } from "./reports";

/** Client ids that are TCE's own, not customers. Reported separately, never folded in. */
export const INTERNAL_CLIENT_IDS = [1, 2] as const;

export interface ActualsRow {
  cu: number;
  taskCount: number;
}

export interface EngineActuals {
  from: string;
  to: string;
  byAssignee: Map<number, ActualsRow>;
  byClient: Map<number, ActualsRow>;
  /** TCE's own work, kept out of the maps above so it cannot inflate anyone. */
  internal: ActualsRow;
  totals: ActualsRow;
  /** Per-source split, so a divergence from the Operations dashboards is visible. */
  bySource: { content: ActualsRow; social: ActualsRow };
}

const SELECT = "id_task, id_client, id_user_assignee, units_content, date_completed, flag_spiked";

function add(map: Map<number, ActualsRow>, key: number, cu: number) {
  const row = map.get(key) || { cu: 0, taskCount: 0 };
  row.cu += cu;
  row.taskCount += 1;
  map.set(key, row);
}

/** The inclusive date range covering a canonical month label ("September 2026"). */
export function monthRange(label: string): { from: string; to: string } | null {
  const start = parseMonthLabel(label);
  if (!start) return null;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

/**
 * Delivered CUs in a date range, grouped by assignee and by client.
 *
 * Completion-dated, not deadline-dated: the question these reports answer is
 * what was delivered in a month, and a task with a September deadline finished
 * in October was delivered in October.
 */
export async function engineActuals(from: string, to: string): Promise<EngineActuals> {
  const cap = nextDay(to);

  const [content, social] = await Promise.all(
    (["app_tasks_content", "app_tasks_social"] as const).map((table) =>
      fetchAllRows((start, end) =>
        supabase
          .from(table)
          .select(SELECT)
          .gte("date_completed", from)
          .lt("date_completed", cap)
          // .range() pagination needs a UNIQUE sort or rows duplicate and skip
          // across page boundaries — date_completed has large equal clusters.
          .order("id_task", { ascending: true })
          .range(start, end)
      )
    )
  );

  const byAssignee = new Map<number, ActualsRow>();
  const byClient = new Map<number, ActualsRow>();
  const internal: ActualsRow = { cu: 0, taskCount: 0 };
  const totals: ActualsRow = { cu: 0, taskCount: 0 };
  const bySource = { content: { cu: 0, taskCount: 0 }, social: { cu: 0, taskCount: 0 } };
  const internalIds = new Set<number>(INTERNAL_CLIENT_IDS);

  for (const [rows, source] of [
    [content, "content"],
    [social, "social"],
  ] as const) {
    for (const t of rows) {
      if (t.flag_spiked === 1) continue;
      const cu = Number(t.units_content) || 0;

      bySource[source].cu += cu;
      bySource[source].taskCount += 1;

      if (t.id_client && internalIds.has(t.id_client)) {
        internal.cu += cu;
        internal.taskCount += 1;
        continue;
      }

      totals.cu += cu;
      totals.taskCount += 1;
      if (t.id_user_assignee) add(byAssignee, t.id_user_assignee, cu);
      if (t.id_client) add(byClient, t.id_client, cu);
    }
  }

  return { from, to, byAssignee, byClient, internal, totals, bySource };
}
