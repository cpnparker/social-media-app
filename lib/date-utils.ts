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
