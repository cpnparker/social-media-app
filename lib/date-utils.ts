// Format a Date as YYYY-MM-DD using its LOCAL calendar date.
//
// Never use `date.toISOString().split("T")[0]` for this: toISOString()
// converts to UTC first, so for any timezone ahead of UTC a local-midnight
// date (e.g. `new Date(y, m, 1)`) lands on the PREVIOUS day. That shifted
// every month/quarter date preset back a day at both ends — "Last Month"
// filtered 31 May–29 Jun instead of 1–30 Jun.
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The day after a YYYY-MM-DD date string (UTC math, DST-proof).
//
// Used for date-range upper bounds on the app_* views, whose date columns
// are TEXT holding bare "YYYY-MM-DD" values. PostgREST compares text
// lexicographically, so `gte("2026-07-01T00:00:00.000Z")` EXCLUDES rows
// dated exactly "2026-07-01" (the bare string sorts before the suffixed
// one) — every dashboard silently dropped the first day of its range.
// Correct bounds for these columns: .gte(col, from) and .lt(col, nextDay(to)).
export function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Today's calendar date in the workspace timezone (Europe/Zurich), as
// YYYY-MM-DD. Client-safe: Intl only. "en-CA" formats as ISO order.
export function workspaceTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

// `n` days after a YYYY-MM-DD date string (negative goes back). UTC math on a
// bare date, so a DST change can never move it by a day.
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date string.
export function weekdayMon0(dateStr: string): number {
  return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// The Monday of the Monday–Sunday week containing a YYYY-MM-DD date.
export function mondayOf(dateStr: string): string {
  return addDays(dateStr, -weekdayMon0(dateStr));
}
