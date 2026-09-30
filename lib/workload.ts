import { addDays, mondayOf } from "@/lib/date-utils";

// Open work for the Team Production "Workload" view — the same set Retool's
// Capacity Tracking / Work In Progress page shows, reconciled against it on
// 2026-09-29 across every user (1,057 vs Retool's 1,056 undated tasks, 44 vs
// 45 on other dates; the residue was tasks created or reassigned that day):
//
//   * not completed          — date_completed is null
//   * not spiked             — flag_spiked is not 1 (Retool: "Excludes content
//                              which has been completed or spiked")
//   * assigned to someone    — 1,043 open tasks have NO assignee; they belong
//                              to nobody's workload and Retool leaves them out
//   * content AND social-promo tasks — without social tasks the counts fall
//                              short of Retool by exactly the assigned ones
export interface OpenWorkFields {
  date_completed: string | null;
  flag_spiked: number | null;
  id_user_assignee: number | null;
}

export function isOpenWork(t: OpenWorkFields): boolean {
  return !t.date_completed && t.flag_spiked !== 1 && t.id_user_assignee != null;
}

// Where a deadline falls relative to the Monday–Sunday week containing
// `today` (a YYYY-MM-DD in the workspace timezone). These are Retool's
// modules: "thisWeek" and "nextWeek" are the detailed-view tables, "none" is
// "Assigned Without Deadlines", and "earlier" + "later" together are
// "Assigned With Deadlines — Other Dates".
export type DeadlineBucket = "none" | "earlier" | "thisWeek" | "nextWeek" | "later";

export function deadlineBucket(deadline: string | null | undefined, today: string): DeadlineBucket {
  if (!deadline) return "none";
  const d = deadline.slice(0, 10);
  const thisMon = mondayOf(today);
  if (d < thisMon) return "earlier";
  if (d < addDays(thisMon, 7)) return "thisWeek";
  if (d < addDays(thisMon, 14)) return "nextWeek";
  return "later";
}

// Open work whose deadline has passed. Distinct from the "earlier" bucket: a
// task due last Monday and one due yesterday (this week) are both overdue.
export function isOverdue(deadline: string | null | undefined, today: string): boolean {
  return !!deadline && deadline.slice(0, 10) < today;
}

// Heat level for a task's content units, shared by the calendar chips and the
// table cells so the two always agree (Retool colours both the same way).
export function cuHeatLevel(cus: number): 0 | 1 | 2 | 3 | 4 {
  if (!(cus > 0)) return 0;
  if (cus <= 0.5) return 1;
  if (cus <= 1) return 2;
  if (cus <= 2) return 3;
  return 4;
}

// The per-person load table's columns. Unlike the Retool modules (where a
// task due last Monday and one due yesterday sit in different tables), these
// partition a person's open work by what a manager does about it, so every
// task lands in exactly one column and the columns sum to the total:
//   overdue     — deadline before today (this week's or earlier)
//   restOfWeek  — due today through Sunday
//   nextWeek / later / none — as deadlineBucket
export type PersonColumn = "overdue" | "restOfWeek" | "nextWeek" | "later" | "none";

export function personColumn(deadline: string | null | undefined, today: string): PersonColumn {
  if (!deadline) return "none";
  if (isOverdue(deadline, today)) return "overdue";
  const b = deadlineBucket(deadline, today);
  if (b === "thisWeek") return "restOfWeek";
  if (b === "nextWeek") return "nextWeek";
  return "later";
}
