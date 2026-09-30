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

// A date input's value is only worth querying once it is a whole, real
// YYYY-MM-DD in a plausible year.
//
// A native <input type="date"> reports every segment as it is typed. Typing
// 01.01.2026 into it produces 0002-01-01, 0020-01-01 and 0202-01-01 on the way
// to 2026-01-01 — each a valid date string, each an all-of-history query — and
// clearing a segment produces "". Treating those as ranges is how the
// commissioned page showed 747.17 CU for a January–February that was 320.60.
export function isCompleteDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Each end either empty (open) or a complete date, and not reversed. Pages
// that cannot draw an open-ended range pass requireBoth.
export function isUsableRange(from: string, to: string, requireBoth = false): boolean {
  if (requireBoth && (from === "" || to === "")) return false;
  if (from !== "" && !isCompleteDate(from)) return false;
  if (to !== "" && !isCompleteDate(to)) return false;
  return from === "" || to === "" || from <= to;
}

// What a page should do with a change to its date inputs (see
// useSettledDateRange): hold the previous range while the inputs are not a
// usable one; apply at once when BOTH ends changed in one go, which is a
// preset or Clear and never typing (typing edits one field); otherwise wait
// for typing to pause.
//
// `partial` is the input's own validity.badInput. A half-typed field reports
// its value as "", exactly like a deliberately emptied one, and "" is an open
// end — so without it, pausing mid-edit on 01/mm/2026 queried all of history.
export type SettleAction = "apply" | "debounce" | "hold";
export function settleAction(
  prev: { from: string; to: string },
  from: string,
  to: string,
  requireBoth = false,
  partial = false
): SettleAction {
  if (partial || !isUsableRange(from, to, requireBoth)) return "hold";
  return prev.from !== from && prev.to !== to ? "apply" : "debounce";
}
