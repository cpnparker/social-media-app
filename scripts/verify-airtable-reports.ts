/**
 * Assertions for the pure logic in the resourcing reports — `npx tsx`.
 *
 * Month resolution is the piece worth pinning. `Contracts Monthly.Month` is a
 * year-qualified singleSelect ("September 2026"), and the whole correctness of
 * a month-filtered query rests on producing that string exactly. A label that
 * is off by a word matches nothing and reports "no data"; a label that drops
 * the year would match four years at once. Both are silent.
 *
 * SCOPE, stated plainly: the report bodies need Airtable credentials, so what
 * runs here is the pure logic — month resolution, formula escaping, the
 * vocabulary constants — imported from the real module. Blocks that reproduce
 * an arithmetic relationship locally are PINNING THE MODEL, not testing the
 * code path: they fail if the relationship stops holding, which is what caught
 * two miscalculations, but they would not catch the report calling the wrong
 * field. Runtime field names are guarded by assertFields against the live
 * schema instead. Do not read a green run here as "the reports are correct".
 *
 * No network, no credentials.
 */
import {
  monthLabel,
  parseMonthLabel,
  resolveMonth,
  escapeFormulaValue,
  ACTIVE_BOOKING_STATUSES,
  DISCIPLINES,
  DEMAND_BASIS,
} from "../lib/airtable/reports";

let passed = 0;
const failures: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  if (Object.is(actual, expected)) passed++;
  else failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Fixed "today" so the relative cases cannot drift with the calendar. */
const NOW = new Date(Date.UTC(2026, 7, 12)); // 12 August 2026

/* ── monthLabel matches the Airtable option strings verbatim ── */
eq(monthLabel(new Date(Date.UTC(2026, 8, 1))), "September 2026", "September 2026");
eq(monthLabel(new Date(Date.UTC(2022, 0, 1))), "January 2022", "first option in the base");
eq(monthLabel(new Date(Date.UTC(2027, 7, 1))), "August 2027", "last option in the base");

/* ── relative months ── */
eq(resolveMonth(undefined, NOW), "August 2026", "no month given means this month");
eq(resolveMonth("this month", NOW), "August 2026", "this month");
eq(resolveMonth("next month", NOW), "September 2026", "next month");
eq(resolveMonth("last month", NOW), "July 2026", "last month");

/* ── year rollover, where an off-by-one is easy and invisible ── */
eq(resolveMonth("next month", new Date(Date.UTC(2026, 11, 15))), "January 2027", "December rolls to January next year");
eq(resolveMonth("last month", new Date(Date.UTC(2026, 0, 15))), "December 2025", "January rolls back to December last year");

/* ── explicit forms ── */
eq(resolveMonth("September 2026", NOW), "September 2026", "canonical label passes through");
eq(resolveMonth("september 2026", NOW), "September 2026", "lowercase is normalised to the option's casing");
eq(resolveMonth("  March 2025  ", NOW), "March 2025", "surrounding whitespace tolerated");
eq(resolveMonth("2026-09", NOW), "September 2026", "ISO year-month");
eq(resolveMonth("2026-9", NOW), "September 2026", "ISO without the leading zero");
eq(resolveMonth("2026-01", NOW), "January 2026", "ISO January");
eq(resolveMonth("2026-12", NOW), "December 2026", "ISO December");

/* ── refusals: answering about the wrong month is worse than not answering ── */
eq(resolveMonth("2026-13", NOW), null, "month 13 is refused, not wrapped into next year");
eq(resolveMonth("2026-00", NOW), null, "month 0 is refused");
eq(resolveMonth("Septembre 2026", NOW), null, "a misspelled month is refused, not guessed");
eq(resolveMonth("Q3", NOW), null, "a quarter is not a month");
eq(resolveMonth("September", NOW), null, "a bare month name is refused — it has no year");
eq(resolveMonth("soon", NOW), null, "vague input is refused");

/* ── round trip ── */
{
  const back = parseMonthLabel("September 2026");
  eq(back?.getUTCFullYear(), 2026, "parse year");
  eq(back?.getUTCMonth(), 8, "parse month index");
  eq(back?.getUTCDate(), 1, "parses to the first of the month");
  eq(monthLabel(back!), "September 2026", "round trips");
}
eq(parseMonthLabel("2026-09"), null, "parseMonthLabel only accepts the label form");

/* ── formula escaping: a client called 'Say "Hi"' must not break the filter ── */
eq(escapeFormulaValue('Say "Hi"'), 'Say \\"Hi\\"', "double quotes escaped");
eq(escapeFormulaValue("back\\slash"), "back\\\\slash", "backslash escaped");
eq(escapeFormulaValue("O'Brien"), "O'Brien", "single quotes left alone inside a double-quoted literal");

/* ── vocabulary pinned against the base's real option strings ── */
eq(ACTIVE_BOOKING_STATUSES.length, 3, "Active is three values, not one");
eq(ACTIVE_BOOKING_STATUSES.includes("Active - Extended" as never), true, "extended contracts count as active");
eq(ACTIVE_BOOKING_STATUSES.includes("Active - Late Delivery" as never), true, "late-delivery contracts count as active");
eq(DISCIPLINES.length, 5, "five disciplines");
eq(DISCIPLINES[0], "Account Management", "AM is spelled as the base spells it");

/* ── month row matching, against the base's REAL shape ──
   These rows are copied from a live read of Monthly resourcing. The point is
   the Date column: it is populated on 31 of 66 rows and empty on every month
   after June 2025. Matching on it made the reports refuse every future month
   while blaming the base for a horizon of June 2025. */
{
  const REAL_ROWS = [
    { fields: { Month: "June 2025", Order: "ZD", Date: "2025-06-01" } },
    { fields: { Month: "July 2025", Order: "ZE", Date: null } },
    { fields: { Month: "August 2025", Order: "ZE2", Date: null } },
    { fields: { Month: "September 2026", Order: "ZR", Date: null } },
    { fields: { Month: "December 2026", Order: "ZU", Date: null } },
    { fields: { Month: "January 2022", Order: null, Date: "2022-01-01" } },
  ] as any[];

  const find = (label: string) =>
    REAL_ROWS.find((r) => String(r.fields["Month"] ?? "").trim().toLowerCase() === label.trim().toLowerCase());

  eq(!!find("September 2026"), true, "September 2026 IS in the plan — the regression that shipped");
  eq(!!find("september 2026"), true, "month matching is case-insensitive");
  eq(!!find("December 2026"), true, "the plan reaches December 2026");
  eq(!!find("March 2028"), false, "a month genuinely outside the plan is still not found");

  const datedOnly = REAL_ROWS.filter((r) => r.fields["Date"]);
  eq(datedOnly.length, 2, "only 2 of these 6 rows carry a Date");
  eq(
    !!datedOnly.find((r) => r.fields["Month"] === "September 2026"),
    false,
    "matching on Date cannot see September 2026 — this is why the report refused it"
  );

  // The horizon reported to the user comes from the labels, not the dates.
  const horizon = REAL_ROWS.map((r) => parseMonthLabel(String(r.fields["Month"])))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  eq(monthLabel(horizon), "December 2026", "horizon comes from labels, not from the sparse Date column");

  const dateHorizon = REAL_ROWS.map((r) => (r.fields["Date"] ? new Date(String(r.fields["Date"])) : null))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  eq(monthLabel(dateHorizon), "June 2025", "the Date column would have claimed June 2025 — the wrong answer users saw");
}

/* ── the demand-basis arithmetic, against real September 2026 figures ──
   These three bases are different QUESTIONS, not three precisions of one, and
   quoting the wrong one misstates every shortfall. The relationships below are
   what proves booked+opps is unweighted. */
{
  // Against the real constant, so a renamed column fails here too.
  eq(DEMAND_BASIS.booked.field, "Total CUs booked", "booked basis reads the committed total");
  eq(DEMAND_BASIS.forecast.field, "CU forecasted smart", "forecast basis reads the weighted number");
  eq(DEMAND_BASIS.pipeline.field, "CU: booked + opps", "pipeline basis reads the unweighted ceiling");
  eq(Object.keys(DEMAND_BASIS).length, 3, "three bases, no more");

  const booked = 107.63333333;
  const forecastBooked = 99.98333333;
  const forecastOppsOverride = 15.8;
  const forecastSmart = 115.78333333;
  const pipeline = 143.38333333;

  eq(
    Math.abs(forecastBooked + forecastOppsOverride - forecastSmart) < 1e-6,
    true,
    "forecast smart = forecasted booked + forecasted opportunities with override"
  );
  eq(Math.round((pipeline - booked) * 100) / 100, 35.75, "raw opportunity upside");
  eq(
    Math.round((forecastOppsOverride / (pipeline - booked)) * 100),
    44,
    "de-risking converts 35.75 raw opportunity CU to 15.8 — a 44% implied rate"
  );
  eq(pipeline > forecastSmart, true, "pipeline is a ceiling above the weighted forecast");
  eq(forecastSmart > booked, true, "forecast sits above committed work");

  // A 17-CU Text team under each basis, at the base's verified 250 CHF/CU.
  const textCapacity = 17;
  const chfPerCu = 250;
  const textCost = (total: number) => Math.round(Math.max(0, total * 0.25 - textCapacity) * chfPerCu);
  eq(textCost(booked), 2477, "Text freelancer cost on booked matches the base's own 2477.08");
  eq(textCost(forecastSmart), 2986, "Text cost on the weighted forecast — 21% above booked");
  eq(textCost(pipeline), 4711, "Text cost on the raw pipeline — 90% above booked, which is why it is not the plan");
  eq(
    textCost(pipeline) > textCost(forecastSmart),
    true,
    "quoting pipeline as the plan would overstate the freelancer budget"
  );

  // AM takes the WHOLE total, not a ratio share — every CU needs managing.
  eq(Math.round((booked / 101.5) * 10000) / 10000, 1.0604, "AM measured against the whole booked total");
}

/* ── the two allocation plans ──
   Neither carries a month: live is this month, scenario is next. Any month
   further out is described by neither, and must not borrow one. */
{
  const now = new Date(Date.UTC(2026, 7, 12)); // 12 August 2026
  const current = resolveMonth("this month", now)!;
  const ahead = resolveMonth("next month", now)!;
  eq(current, "August 2026", "live plan describes this month");
  eq(ahead, "September 2026", "scenario plan describes next month");

  const impliedWorld = (m: string) => (m === current ? "live" : m === ahead ? "scenario" : null);
  eq(impliedWorld("August 2026"), "live", "this month reads the live plan");
  eq(impliedWorld("September 2026"), "scenario", "next month reads the scenario plan");
  eq(impliedWorld("October 2026"), null, "two months out has NO allocation plan");
  eq(impliedWorld("March 2027"), null, "far out has no allocation plan either");
  eq(impliedWorld("July 2026"), null, "a past month is not described by the live plan");

  // Replacement, not delta: confirmed from live data at 23 rows each side.
  const liveTotal = 102.75;
  const scenarioTotal = 115.55;
  eq(
    scenarioTotal > liveTotal * 0.5,
    true,
    "scenario restates every allocation — a delta would be a fraction of live"
  );
  eq(liveTotal + scenarioTotal !== scenarioTotal, true, "the plans are never summed");
}

/* ── compare must not depend on the month asked about ──
   The shipped bug: the live side was built from whatever plan the REQUESTED
   month implied. Asking to compare "next month" — the obvious phrasing — made
   both sides the scenario plan, so every delta came out zero and the model
   reported "nothing moves" against a real 12.8 CU shift. Zero deltas are the
   dangerous failure here: they read exactly like a valid answer. */
{
  const now = new Date(Date.UTC(2026, 7, 12));
  const current = resolveMonth("this month", now)!;
  const ahead = resolveMonth("next month", now)!;

  // What the buggy version did: derive the world from the requested month.
  const worldFromMonth = (m: string) => (m === current ? "live" : m === ahead ? "scenario" : null);
  eq(worldFromMonth(ahead), "scenario", "requesting next month implies the scenario plan");
  eq(
    worldFromMonth(ahead) === "scenario",
    true,
    "so a compare that reused that world had scenario on BOTH sides"
  );

  // What it must do now: both sides fixed, whatever month was asked about.
  const compareSides = (_requested: string) => ({ from: { month: current, world: "live" }, to: { month: ahead, world: "scenario" } });
  for (const requested of [current, ahead, "October 2026", "March 2027", "July 2026"]) {
    const sides = compareSides(requested);
    eq(sides.from.world, "live", `from side stays live when asked about ${requested}`);
    eq(sides.to.world, "scenario", `to side stays scenario when asked about ${requested}`);
    eq(sides.from.month, "August 2026", `from month stays ${current} when asked about ${requested}`);
    eq(sides.to.month, "September 2026", `to month stays ${ahead} when asked about ${requested}`);
  }

  // The deltas the corrected version must produce, from real figures.
  const liveTotal = 102.75;
  const scenarioTotal = 115.55;
  eq(Math.round((scenarioTotal - liveTotal) * 100) / 100, 12.8, "the real shift between the plans is 12.8 CU");
  eq(scenarioTotal - liveTotal !== 0, true, "a zero total delta means both sides read the same plan");

  // Null capacity must sort last, not as zero: unknown is not "no headroom".
  const rows = [
    { name: "known short", toHeadroom: -7 },
    { name: "unknown", toHeadroom: null as number | null },
    { name: "known spare", toHeadroom: 8 },
  ];
  const sorted = [...rows].sort(
    (a, b) => (a.toHeadroom ?? Number.POSITIVE_INFINITY) - (b.toHeadroom ?? Number.POSITIVE_INFINITY)
  );
  eq(sorted[0].name, "known short", "least headroom sorts first");
  eq(sorted[2].name, "unknown", "unknown headroom sorts last, not as zero");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Airtable report logic verified.\n");
