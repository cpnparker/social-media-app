/**
 * Unit tests for the recurring-prompt schedule math.
 * Run with: node --test lib/scheduled/schedule.test.ts   (Node >= 22.18, type stripping)
 *
 * All expectations are fixed UTC instants — computeNextRun uses explicit IANA
 * timezones via Intl, so results are independent of the host timezone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextRun } from "./schedule.ts";

const ZURICH = { tz: "Europe/Zurich" };

function iso(d: Date): string {
  return d.toISOString();
}

test("daily: later the same local day when time not yet passed", () => {
  // 2026-07-16 07:00 CEST (+02:00) = 05:00Z; daily 08:00 → same day 06:00Z
  const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, new Date("2026-07-16T05:00:00Z"));
  assert.equal(iso(next), "2026-07-16T06:00:00.000Z");
});

test("daily: next local day when time already passed", () => {
  // 2026-07-16 12:00 CEST = 10:00Z; daily 08:00 → next day 06:00Z
  const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, new Date("2026-07-16T10:00:00Z"));
  assert.equal(iso(next), "2026-07-17T06:00:00.000Z");
});

test("daily: strictly after — run exactly at the scheduled instant advances a day", () => {
  const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, new Date("2026-07-16T06:00:00Z"));
  assert.equal(iso(next), "2026-07-17T06:00:00.000Z");
});

test("daily: UTC timezone", () => {
  const next = computeNextRun("daily", { tz: "UTC", hour: 8, minute: 0 }, new Date("2026-07-16T07:00:00Z"));
  assert.equal(iso(next), "2026-07-16T08:00:00.000Z");
});

test("weekdays: Friday afternoon rolls to Monday", () => {
  // Fri 2026-07-17 12:00 CEST = 10:00Z → Mon 2026-07-20 08:00 CEST = 06:00Z
  const next = computeNextRun("weekdays", { ...ZURICH, hour: 8, minute: 0 }, new Date("2026-07-17T10:00:00Z"));
  assert.equal(iso(next), "2026-07-20T06:00:00.000Z");
});

test("weekly: next matching ISO weekday", () => {
  // Mon 2026-07-13 00:00Z → Wed (dayOfWeek 3) 2026-07-15 08:00 CEST = 06:00Z
  const next = computeNextRun("weekly", { ...ZURICH, hour: 8, minute: 0, dayOfWeek: 3 }, new Date("2026-07-13T00:00:00Z"));
  assert.equal(iso(next), "2026-07-15T06:00:00.000Z");
});

test("monthly: same month when day not yet passed, else next month", () => {
  const cfg = { ...ZURICH, hour: 8, minute: 0, dayOfMonth: 28 };
  assert.equal(iso(computeNextRun("monthly", cfg, new Date("2026-07-16T10:00:00Z"))), "2026-07-28T06:00:00.000Z");
  assert.equal(iso(computeNextRun("monthly", cfg, new Date("2026-07-29T10:00:00Z"))), "2026-08-28T06:00:00.000Z");
});

// --- DST regression tests -------------------------------------------------
// Europe/Zurich spring-forward 2027: Sun 2027-03-28, 02:00 CET → 03:00 CEST
// (a 23-hour local day). Fixed 24h-UTC probes starting late Saturday evening
// used to skip the local date 2027-03-28 entirely.

test("DST spring-forward: daily task created Sat 23:30 local still runs Sunday", () => {
  // Sat 2027-03-27 23:30 CET (+01:00) = 22:30Z
  // Expected: Sun 2027-03-28 08:00 CEST (+02:00) = 06:00Z — not Monday.
  const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, new Date("2027-03-27T22:30:00Z"));
  assert.equal(iso(next), "2027-03-28T06:00:00.000Z");
});

test("DST spring-forward: no local date is skipped for any late-evening start", () => {
  // Every start between Sat 23:00 and midnight local must yield Sunday's run.
  for (let min = 0; min < 60; min += 5) {
    const after = new Date(Date.UTC(2027, 2, 27, 22, min)); // 23:00–23:55 CET local
    const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, after);
    assert.equal(iso(next), "2027-03-28T06:00:00.000Z", `start at 22:${String(min).padStart(2, "0")}Z`);
  }
});

test("DST spring-forward: weekly Sunday schedule is not pushed a full week", () => {
  // Weekly on Sunday (ISO 7), created Sat 2027-03-27 23:30 local → Sun 2027-03-28, not Apr 4.
  const next = computeNextRun("weekly", { ...ZURICH, hour: 8, minute: 0, dayOfWeek: 7 }, new Date("2027-03-27T22:30:00Z"));
  assert.equal(iso(next), "2027-03-28T06:00:00.000Z");
});

test("DST spring-forward: monthly on the 28th is not pushed a full month", () => {
  const next = computeNextRun("monthly", { ...ZURICH, hour: 8, minute: 0, dayOfMonth: 28 }, new Date("2027-03-27T22:30:00Z"));
  assert.equal(iso(next), "2027-03-28T06:00:00.000Z");
});

test("DST fall-back: daily task across the 25-hour day", () => {
  // Europe/Zurich fall-back 2027: Sun 2027-10-31, 03:00 CEST → 02:00 CET.
  // Sat 2027-10-30 23:30 CEST (+02:00) = 21:30Z → Sun 08:00 CET (+01:00) = 07:00Z
  const next = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, new Date("2027-10-30T21:30:00Z"));
  assert.equal(iso(next), "2027-10-31T07:00:00.000Z");
});

test("DST spring-forward: consecutive daily runs stay one local day apart", () => {
  // Chain runs across the transition; each next run must land on the next
  // local calendar date (22h/23h/24h UTC gaps are fine, 48h is the bug).
  let at = new Date("2027-03-26T06:00:00Z"); // Fri 2027-03-26 07:00 CET, before the 08:00 run
  const expected = [
    "2027-03-26T07:00:00.000Z", // Fri 08:00 CET
    "2027-03-27T07:00:00.000Z", // Sat 08:00 CET
    "2027-03-28T06:00:00.000Z", // Sun 08:00 CEST (spring-forward day)
    "2027-03-29T06:00:00.000Z", // Mon 08:00 CEST
  ];
  for (const want of expected) {
    at = computeNextRun("daily", { ...ZURICH, hour: 8, minute: 0 }, at);
    assert.equal(iso(at), want);
  }
});
