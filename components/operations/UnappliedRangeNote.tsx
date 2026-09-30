import { isCompleteDate } from "@/lib/date-utils";

const fmt = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function describe(from: string, to: string): string {
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `from ${fmt(from)}`;
  if (to) return `up to ${fmt(to)}`;
  return "all dates";
}

// Shown while the date inputs hold something that is not a usable range, so
// the figures on screen belong to the previous one (see useSettledDateRange).
// Without it the boxes and the numbers silently disagree.
export function UnappliedRangeNote({
  invalid,
  inputFrom,
  inputTo,
  appliedFrom,
  appliedTo,
}: {
  invalid: boolean;
  inputFrom: string;
  inputTo: string;
  appliedFrom: string;
  appliedTo: string;
}) {
  if (!invalid) return null;
  const reversed = isCompleteDate(inputFrom) && isCompleteDate(inputTo) && inputFrom > inputTo;
  return (
    <p className="text-[11px] text-amber-700 dark:text-amber-400">
      {reversed ? "From is after To" : "The dates entered are not complete yet"} — still showing{" "}
      {describe(appliedFrom, appliedTo)}.
    </p>
  );
}
