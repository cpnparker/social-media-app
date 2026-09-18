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
