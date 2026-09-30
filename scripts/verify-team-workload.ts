/**
 * verify-team-workload.ts — guards the Team Production "Workload" view
 *
 * The Workload view replaces Retool's Capacity Tracking / Work In Progress
 * page, so its numbers are compared against Retool by the people who use it.
 * Two things decide those numbers and both fail silently:
 *
 *  1. WHICH tasks count (lib/workload.ts isOpenWork). Reconciled against Retool
 *     across every user on 2026-09-29: open + not spiked + ASSIGNED, content
 *     and social tasks. Dropping the assignee test adds 1,043 unowned tasks;
 *     dropping social tasks loses 34. Either moves the totals with no error.
 *  2. WHICH week a deadline lands in (deadlineBucket, isOverdue, and "today"
 *     itself). Week maths on dates is where off-by-one days live: a Sunday
 *     deadline, a Monday "today", a year boundary, a DST change, and the
 *     classic one — computing "today" in UTC, which after 22:00 in Zurich in
 *     summer is already tomorrow's calendar date there... and the reverse.
 *
 * It also asserts the rules are USED where they matter (checkWiring): this
 * repo has closed a live hole on the strength of a line merely existing.
 *
 * MUTATION LOG (each is a MUTANT below; --self-test refuses to pass unless all die)
 *  - isOpenWork without the spiked test        -> KILLED by the spiked fixture
 *  - isOpenWork without the assignee test      -> KILLED by the unassigned fixture
 *  - isOpenWork treating flag_spiked=null as spiked -> KILLED by the null fixture
 *    (PostgREST neq drops NULLs; a SQL-side "neq 1" makes exactly this mistake)
 *  - week boundary <= instead of <             -> KILLED by "next Monday"
 *  - Sunday-start weeks                        -> KILLED by "this Sunday"
 *  - isOverdue with <= (today counts as late)  -> KILLED by "due today"
 *  - "today" from toISOString (UTC)            -> KILLED by the 22:30Z-in-summer fixture
 *  - heat bands with < instead of <= at 0.5    -> KILLED by the 0.5 fixture
 *  - person column: due today counted overdue  -> KILLED by "due today is rest of week"
 *  - person column: this week's overdue left in rest-of-week -> KILLED by "yesterday"
 *
 * checkWiring is PRESENCE, not behaviour: it pins the exact expressions that
 * decide the numbers (the filter applied to both lists, both lists returned,
 * the bucket call that feeds the tables) so a refactor that drops one goes
 * red. What it cannot see — recorded as SURVIVORS, not tidied away:
 *  - swapping which list feeds which table after bucketing (e.g. rendering
 *    buckets.later under the "Next week" heading) keeps every string present
 *  - a keep() that stops calling isOpenWork but still contains the text
 *    "isOpenWork(t)" in a comment
 * Both need a render test to catch, which this repo does not have for pages.
 *
 * Run: npx tsx scripts/verify-team-workload.ts [--self-test]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { isOpenWork, deadlineBucket, isOverdue, cuHeatLevel, personColumn, type OpenWorkFields, type DeadlineBucket, type PersonColumn } from "../lib/workload";
import { workspaceTodayISO, addDays, mondayOf, weekdayMon0 } from "../lib/date-utils";

interface Impl {
  isOpenWork: (t: OpenWorkFields) => boolean;
  deadlineBucket: (d: string | null | undefined, today: string) => DeadlineBucket;
  isOverdue: (d: string | null | undefined, today: string) => boolean;
  todayOf: (now: Date) => string;
  cuHeatLevel: (cus: number) => number;
  personColumn: (d: string | null | undefined, today: string) => PersonColumn;
}

const REAL: Impl = { isOpenWork, deadlineBucket, isOverdue, todayOf: workspaceTodayISO, cuHeatLevel, personColumn };

function check(impl: Impl): string[] {
  const f: string[] = [];
  const eq = (label: string, got: unknown, want: unknown) => {
    if (got !== want) f.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };

  // 1. Which tasks count
  eq("open, assigned, not spiked", impl.isOpenWork({ date_completed: null, flag_spiked: 0, id_user_assignee: 43 }), true);
  eq("flag_spiked null is NOT spiked", impl.isOpenWork({ date_completed: null, flag_spiked: null, id_user_assignee: 43 }), true);
  eq("completed", impl.isOpenWork({ date_completed: "2026-09-01", flag_spiked: 0, id_user_assignee: 43 }), false);
  eq("spiked", impl.isOpenWork({ date_completed: null, flag_spiked: 1, id_user_assignee: 43 }), false);
  eq("unassigned", impl.isOpenWork({ date_completed: null, flag_spiked: 0, id_user_assignee: null }), false);

  // 2. Week buckets — "today" is Tuesday 29 Sep 2026; its week is Mon 28 Sep – Sun 4 Oct
  const T = "2026-09-29";
  eq("no deadline", impl.deadlineBucket(null, T), "none");
  eq("last Sunday", impl.deadlineBucket("2026-09-27", T), "earlier");
  eq("this Monday", impl.deadlineBucket("2026-09-28", T), "thisWeek");
  eq("this Sunday", impl.deadlineBucket("2026-10-04", T), "thisWeek");
  eq("next Monday", impl.deadlineBucket("2026-10-05", T), "nextWeek");
  eq("next Sunday", impl.deadlineBucket("2026-10-11", T), "nextWeek");
  eq("Monday after next", impl.deadlineBucket("2026-10-12", T), "later");
  eq("deadline with a time part", impl.deadlineBucket("2026-10-05T09:00:00", T), "nextWeek");
  // today on the edges of its own week
  eq("today Sunday: that Sunday", impl.deadlineBucket("2026-10-04", "2026-10-04"), "thisWeek");
  eq("today Sunday: next day", impl.deadlineBucket("2026-10-05", "2026-10-04"), "nextWeek");
  eq("today Monday: day before", impl.deadlineBucket("2026-09-27", "2026-09-28"), "earlier");
  // year boundary: Thu 31 Dec 2026 is in the week Mon 28 Dec – Sun 3 Jan
  eq("year end: Sun 3 Jan", impl.deadlineBucket("2027-01-03", "2026-12-31"), "thisWeek");
  eq("year end: Mon 4 Jan", impl.deadlineBucket("2027-01-04", "2026-12-31"), "nextWeek");
  // DST: clocks go back Sun 25 Oct 2026 and forward Sun 28 Mar 2027
  eq("DST end: Sun 25 Oct from Mon 26", impl.deadlineBucket("2026-10-25", "2026-10-26"), "earlier");
  eq("DST end: Mon 2 Nov from Mon 26", impl.deadlineBucket("2026-11-02", "2026-10-26"), "nextWeek");
  eq("DST start: Sun 28 Mar from Thu 25", impl.deadlineBucket("2027-03-28", "2027-03-25"), "thisWeek");
  eq("DST start: Mon 29 Mar from Thu 25", impl.deadlineBucket("2027-03-29", "2027-03-25"), "nextWeek");

  // 3. Overdue
  eq("due yesterday is overdue", impl.isOverdue("2026-09-28", T), true);
  eq("due today is NOT overdue", impl.isOverdue("2026-09-29", T), false);
  eq("no deadline is never overdue", impl.isOverdue(null, T), false);

  // 4. "Today" in Zurich, not UTC
  eq("22:30Z in summer is the next day in Zurich", impl.todayOf(new Date("2026-09-29T22:30:00Z")), "2026-09-30");
  eq("21:30Z in summer is still the same day", impl.todayOf(new Date("2026-09-29T21:30:00Z")), "2026-09-29");
  eq("23:30Z on 31 Dec is New Year in Zurich", impl.todayOf(new Date("2026-12-31T23:30:00Z")), "2027-01-01");

  // 5. Heat bands (chips and cells share them)
  const heat: Array<[number, number]> = [[0, 0], [-1, 0], [NaN, 0], [0.2, 1], [0.5, 1], [0.75, 2], [1, 2], [1.5, 3], [2, 3], [2.5, 4]];
  for (let i = 0; i < heat.length; i++) eq(`heat ${heat[i][0]}`, impl.cuHeatLevel(heat[i][0]), heat[i][1]);

  // 6. Per-person columns partition open work: each deadline lands in exactly
  //    one column (the table's columns must sum to its "Total open").
  eq("person: no deadline", impl.personColumn(null, T), "none");
  eq("person: yesterday (this week) is overdue", impl.personColumn("2026-09-28", T), "overdue");
  eq("person: last week is overdue", impl.personColumn("2026-09-20", T), "overdue");
  eq("person: due today is rest of week", impl.personColumn("2026-09-29", T), "restOfWeek");
  eq("person: this Sunday is rest of week", impl.personColumn("2026-10-04", T), "restOfWeek");
  eq("person: next Monday", impl.personColumn("2026-10-05", T), "nextWeek");
  eq("person: Monday after next", impl.personColumn("2026-10-12", T), "later");
  // Exactly-one over a span of 40 days (catches overlaps and gaps alike)
  for (let i = -20; i < 20; i++) {
    const d = addDays(T, i);
    const col = impl.personColumn(d, T);
    const inOverdue = d < T;
    if ((col === "overdue") !== inOverdue) f.push(`person partition: ${d} -> ${col}`);
  }

  return f;
}

// Helpers the buckets are built on — asserted directly, not via a mutant.
function checkDateHelpers(): string[] {
  const f: string[] = [];
  const eq = (l: string, g: unknown, w: unknown) => { if (g !== w) f.push(`${l}: got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`); };
  eq("weekdayMon0 Tue", weekdayMon0("2026-09-29"), 1);
  eq("weekdayMon0 Sun", weekdayMon0("2026-10-04"), 6);
  eq("mondayOf Sun", mondayOf("2026-10-04"), "2026-09-28");
  eq("mondayOf Mon", mondayOf("2026-09-28"), "2026-09-28");
  eq("addDays across DST", addDays("2026-10-24", 2), "2026-10-26");
  eq("addDays back across year", addDays("2027-01-01", -1), "2026-12-31");
  return f;
}

function checkWiring(): string[] {
  const f: string[] = [];
  const root = join(__dirname, "..");
  const read = (rel: string) => {
    try { return readFileSync(join(root, rel), "utf8"); } catch { f.push(`${rel}: cannot read`); return ""; }
  };

  const route = read("app/api/operations/team-workload/route.ts");
  if (route) {
    if (route.indexOf('from "@/lib/workload"') === -1) f.push("team-workload route: does not import lib/workload");
    if (route.indexOf("isOpenWork(t)") === -1) f.push("team-workload route: never applies isOpenWork to a task row");
    // The predicate must reach BOTH lists, and both lists must reach the response.
    if (route.indexOf("contentRows.filter(keep)") === -1) f.push("team-workload route: content rows bypass the open-work filter");
    if (route.indexOf("socialRows.filter(keep)") === -1) f.push("team-workload route: social rows bypass the open-work filter — spiked/unassigned promos leak");
    if (route.indexOf('build("app_tasks_social"') === -1) f.push("team-workload route: social-promo tasks are not fetched — totals fall short of Retool");
    if (route.indexOf('social.map((t) => toRow(t, "social"))') === -1) f.push("team-workload route: social rows are fetched but never returned");
    if (route.indexOf("i += 50") === -1) f.push("team-workload route: assignee ids are not batched — All Staff (~730 ids) risks the URL limit");
    if (/\.(gte|lte|lt|gt)\(/.test(route)) f.push("team-workload route: a date bound crept in — open work must not be limited by date");
  }

  const comp = read("components/operations/TeamWorkload.tsx");
  if (comp) {
    // Pin the exact uses: deadlineBucket feeds the four module tables, personColumn the load table.
    if (comp.indexOf("out[deadlineBucket(t.deadline, today)].push(t)") === -1) f.push("TeamWorkload: the module tables are not built with deadlineBucket");
    if (comp.indexOf("personColumn(t.deadline, today)") === -1) f.push("TeamWorkload: the per-person columns are not built with personColumn");
    if (comp.indexOf("seq !== requestSeq.current") === -1) f.push("TeamWorkload: responses are not sequenced — a slow older load can overwrite a newer one");
    if (comp.indexOf("workspaceTodayISO()") === -1) f.push("TeamWorkload: 'today' does not come from workspaceTodayISO (Zurich)");
    if (comp.indexOf("toISOString().slice(0, 10)") !== -1 || comp.indexOf('toISOString().split("T")') !== -1) {
      f.push("TeamWorkload: a UTC date string is computed — 'today' would be wrong in the evening");
    }
    if (comp.indexOf("/api/operations/team-workload") === -1) f.push("TeamWorkload: does not read the team-workload API");
  }

  const page = read("app/(app)/operations/team-production/page.tsx");
  if (page) {
    if (page.indexOf("<TeamWorkload") === -1) f.push("team-production page: the Workload view is not rendered");
    if (page.indexOf('view === "workload"') === -1) f.push("team-production page: no Workload view branch");
  }
  return f;
}

const MUTANTS: Array<[string, Partial<Impl>]> = [
  ["isOpenWork ignores spiked", { isOpenWork: (t) => !t.date_completed && t.id_user_assignee != null }],
  ["isOpenWork ignores assignee", { isOpenWork: (t) => !t.date_completed && t.flag_spiked !== 1 }],
  ["isOpenWork treats null flag as spiked", { isOpenWork: (t) => !t.date_completed && t.flag_spiked === 0 && t.id_user_assignee != null }],
  ["week boundary <=", {
    deadlineBucket: (d, today) => {
      if (!d) return "none";
      const x = d.slice(0, 10), m = mondayOf(today);
      if (x < m) return "earlier";
      if (x <= addDays(m, 7)) return "thisWeek";
      if (x <= addDays(m, 14)) return "nextWeek";
      return "later";
    },
  }],
  ["Sunday-start weeks", {
    deadlineBucket: (d, today) => {
      if (!d) return "none";
      const x = d.slice(0, 10), s = addDays(today, -((weekdayMon0(today) + 1) % 7));
      if (x < s) return "earlier";
      if (x < addDays(s, 7)) return "thisWeek";
      if (x < addDays(s, 14)) return "nextWeek";
      return "later";
    },
  }],
  ["isOverdue <=", { isOverdue: (d, today) => !!d && d.slice(0, 10) <= today }],
  ["today from UTC", { todayOf: (now) => now.toISOString().slice(0, 10) }],
  ["heat < at 0.5", { cuHeatLevel: (c) => (!(c > 0) ? 0 : c < 0.5 ? 1 : c <= 1 ? 2 : c <= 2 ? 3 : 4) }],
  ["person: due today counted overdue", {
    personColumn: (d, today) => {
      if (!d) return "none";
      if (d.slice(0, 10) <= today) return "overdue";
      const b = deadlineBucket(d, today);
      return b === "thisWeek" ? "restOfWeek" : b === "nextWeek" ? "nextWeek" : "later";
    },
  }],
  ["person: overdue this week left in rest-of-week", {
    personColumn: (d, today) => {
      if (!d) return "none";
      const b = deadlineBucket(d, today);
      if (b === "earlier") return "overdue";
      return b === "thisWeek" ? "restOfWeek" : b === "nextWeek" ? "nextWeek" : "later";
    },
  }],
];

function main(): void {
  if (process.argv.indexOf("--self-test") !== -1) {
    const inert: string[] = [];
    for (let i = 0; i < MUTANTS.length; i++) {
      const impl = Object.assign({}, REAL, MUTANTS[i][1]) as Impl;
      const caught = check(impl);
      if (caught.length === 0) inert.push(MUTANTS[i][0]);
      else console.log(`  ✓ mutant killed (${MUTANTS[i][0]}) — first: ${caught[0]}`);
    }
    if (inert.length > 0) {
      console.error(`\n✗ SELF-TEST FAILED — not caught:\n  - ${inert.join("\n  - ")}`);
      process.exit(1);
    }
    console.log(`\n✓ self-test passed: all ${MUTANTS.length} mutants killed`);
  }

  const failures = check(REAL).concat(checkDateHelpers(), checkWiring());
  if (failures.length > 0) {
    console.error(`\n✗ verify-team-workload FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("✓ verify-team-workload passed: open-work rule, week buckets (edges, year end, DST), Zurich 'today', heat bands, wiring");
}

main();
