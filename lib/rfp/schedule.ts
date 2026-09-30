/**
 * Compute the next run date for a scheduled search.
 */
export function computeNextRun(
  typeSchedule: string | null,
  configSchedule: { dayOfWeek?: number } | null
): Date {
  const now = new Date();

  if (typeSchedule === "daily") {
    // Next day at 07:00 UTC
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(7, 0, 0, 0);
    return next;
  }

  if (typeSchedule === "weekly") {
    // Next occurrence of the specified day at 07:00 UTC
    const targetDay = configSchedule?.dayOfWeek ?? 1; // default Monday
    const next = new Date(now);
    const currentDay = next.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // Convert our 1-7 (Mon-Sun) to JS 0-6 (Sun-Sat)
    const targetJsDay = targetDay === 7 ? 0 : targetDay;
    let daysUntil = targetJsDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    next.setUTCDate(next.getUTCDate() + daysUntil);
    next.setUTCHours(7, 0, 0, 0);
    return next;
  }

  // Fallback: 24 hours from now
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
