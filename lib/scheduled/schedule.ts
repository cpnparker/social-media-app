/**
 * Deterministic schedule math for recurring prompts.
 *
 * All time arithmetic lives HERE, in code, with real IANA timezones — never in
 * the model (ChatGPT's scheduled-task timezone bugs came from letting the LLM
 * estimate time). Default tz Europe/Zurich; DST handled via a two-pass Intl
 * offset lookup, no external deps.
 */

export interface ScheduleConfig {
  hour?: number;      // 0-23, default 8
  minute?: number;    // 0-59, default 0
  dayOfWeek?: number; // ISO 1 (Mon) - 7 (Sun), weekly only
  dayOfMonth?: number;// 1-28, monthly only
  tz?: string;        // IANA, default Europe/Zurich
}

export type ScheduleType = "daily" | "weekdays" | "weekly" | "monthly";

const DEFAULT_TZ = "Europe/Zurich";

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - at.getTime();
}

/** Convert wall-clock parts in `tz` to a UTC Date (two-pass for DST edges). */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  const off1 = tzOffsetMs(tz, new Date(naive));
  const guess = new Date(naive - off1);
  const off2 = tzOffsetMs(tz, guess);
  return off1 === off2 ? guess : new Date(naive - off2);
}

/** Wall-clock date parts of an instant in `tz`. */
function partsInTz(at: Date, tz: string): { y: number; m: number; d: number; isoDow: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const dows: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { y: parseInt(p.year, 10), m: parseInt(p.month, 10), d: parseInt(p.day, 10), isoDow: dows[p.weekday] ?? 1 };
}

/** Next run strictly after `after` for the given schedule. */
export function computeNextRun(
  type: ScheduleType,
  cfg: ScheduleConfig | null | undefined,
  after: Date = new Date()
): Date {
  const tz = cfg?.tz || DEFAULT_TZ;
  const hour = Math.min(23, Math.max(0, cfg?.hour ?? 8));
  const minute = Math.min(59, Math.max(0, cfg?.minute ?? 0));

  // Walk forward day by day (max ~62 to cover monthly) from `after`'s date in tz.
  for (let i = 0; i < 62; i++) {
    const probe = new Date(after.getTime() + i * 86_400_000);
    const { y, m, d, isoDow } = partsInTz(probe, tz);
    let matches = false;
    if (type === "daily") matches = true;
    else if (type === "weekdays") matches = isoDow >= 1 && isoDow <= 5;
    else if (type === "weekly") matches = isoDow === (cfg?.dayOfWeek ?? 1);
    else if (type === "monthly") matches = d === Math.min(28, Math.max(1, cfg?.dayOfMonth ?? 1));
    if (!matches) continue;
    const candidate = zonedToUtc(y, m, d, hour, minute, tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  // Fallback (should be unreachable): +24h
  return new Date(after.getTime() + 86_400_000);
}

/** Human-readable schedule description for confirmation UI / emails. */
export function describeSchedule(type: ScheduleType, cfg: ScheduleConfig | null | undefined): string {
  const hh = String(Math.min(23, Math.max(0, cfg?.hour ?? 8))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, cfg?.minute ?? 0))).padStart(2, "0");
  const t = `${hh}:${mm}`;
  const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (type === "daily") return `Daily at ${t}`;
  if (type === "weekdays") return `Weekdays at ${t}`;
  if (type === "weekly") return `Every ${days[cfg?.dayOfWeek ?? 1]} at ${t}`;
  return `Monthly on day ${Math.min(28, Math.max(1, cfg?.dayOfMonth ?? 1))} at ${t}`;
}

/** Cheap stable fingerprint of a standing prompt (djb2 + length). Used to
 *  detect that an update-confirmation card was built against an older version
 *  of the task, so a stale card can't silently revert newer edits. */
export function promptFingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
}
