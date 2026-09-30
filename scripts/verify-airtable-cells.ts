/**
 * Assertions for the Airtable cell readers — run with `npx tsx`.
 *
 * These two helpers are load-bearing: every capacity and headroom figure the
 * resourcing reports produce passes through cellNumber(), and the failure they
 * exist to prevent is invisible. `Number([5,3]) || 0` is 0, so a person linked
 * to several contracts reads as zero booked — fully idle — while a person on
 * one contract reads correctly. Getting that wrong doesn't error; it just
 * quietly recommends giving more work to whoever already has the most.
 *
 * No network, no credentials. Pure functions only.
 */
import { AMBIGUOUS, assertFieldTypes, cellNumber, type AirtableTable } from "../lib/airtable/client";

let passed = 0;
const failures: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  if (Object.is(actual, expected)) passed++;
  else failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function throws(fn: () => void, match: RegExp, label: string) {
  try {
    fn();
    failures.push(`${label}: expected a throw, got none`);
  } catch (e: any) {
    if (match.test(String(e?.message))) passed++;
    else failures.push(`${label}: threw "${e?.message}", expected /${match.source}/`);
  }
}

/* ── cellNumber: scalars ── */
eq(cellNumber(5), 5, "plain number");
eq(cellNumber(0), 0, "zero is a real value, not empty");
eq(cellNumber(-3.5), -3.5, "negative float");
eq(cellNumber("7"), 7, "numeric string");
eq(cellNumber("7.25"), 7.25, "decimal string");

/* ── cellNumber: empty is NOT zero ──
   A missing Team resourcing row means the plan is not loaded for that month.
   Reading it as 0 capacity would report the person as fully booked; reading it
   as 0 booked would report them as fully idle. Both are worse than "unknown". */
eq(cellNumber(undefined), undefined, "undefined stays undefined");
eq(cellNumber(null), undefined, "null is empty, not zero");
eq(cellNumber(""), undefined, "empty string is empty, not zero");
eq(cellNumber([]), undefined, "empty lookup array is empty, not zero");

/* ── cellNumber: lookup arrays, the actual trap ── */
eq(cellNumber([5]), 5, "single-value lookup unwraps");
eq(cellNumber(["5"]), 5, "single-value lookup of a numeric string unwraps");
eq(cellNumber([5, 3]), AMBIGUOUS, "multi-value lookup must NOT collapse to 0");
eq(cellNumber([5, 3, 1]), AMBIGUOUS, "three values are still ambiguous");
eq(cellNumber([0, 0]), AMBIGUOUS, "two zeroes are ambiguous, not zero");

/* ── cellNumber: junk ── */
eq(cellNumber("n/a"), AMBIGUOUS, "non-numeric text is ambiguous, not zero");
eq(cellNumber("CHF 1,200"), AMBIGUOUS, "a formatted currency string is not silently parsed");
eq(cellNumber(NaN), AMBIGUOUS, "NaN never becomes 0");
eq(cellNumber(Infinity), AMBIGUOUS, "Infinity is not a usable figure");
eq(cellNumber({}), AMBIGUOUS, "an object is ambiguous");
eq(cellNumber(true), AMBIGUOUS, "a boolean is not a quantity");

/* ── the regression this file is really about ── */
{
  const booked = cellNumber([5, 3]);
  const capacity = 10;
  const wrong = capacity - (Number([5, 3] as any) || 0);
  eq(wrong, 10, "the naive coercion really does invent 10 CUs of headroom");
  eq(booked === AMBIGUOUS, true, "cellNumber refuses that subtraction instead");
}

/* ── assertFieldTypes ── */
const table: AirtableTable = {
  id: "tblNgTWUWv5zXbTGg",
  name: "Team resourcing",
  primaryFieldId: "fld1",
  fields: [
    { id: "fld1", name: "Month-Team", type: "formula" },
    { id: "fld2", name: "Total CUs booked", type: "multipleLookupValues" },
    { id: "fld3", name: "AM capacity", type: "currency" },
  ],
};

{
  let threw = false;
  try {
    assertFieldTypes(table, { "Total CUs booked": "multipleLookupValues", "AM capacity": "currency" });
  } catch {
    threw = true;
  }
  eq(threw, false, "matching types pass");
}

throws(
  () => assertFieldTypes(table, { "Total CUs booked": "rollup" }),
  /Total CUs booked is multipleLookupValues, expected rollup/,
  "a lookup silently changed to a rollup is caught"
);

{
  // Deliberate: an absent field is assertFields' job, not this one. Reporting
  // it here too would produce two errors for one cause.
  let threw = false;
  try {
    assertFieldTypes(table, { "Nonexistent field": "number" });
  } catch {
    threw = true;
  }
  eq(threw, false, "an absent field is left to assertFields");
}

/* ── report ── */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Airtable cell readers verified.\n");
