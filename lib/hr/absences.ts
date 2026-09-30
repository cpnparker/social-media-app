/**
 * Who is away — from the CharlieHR calendar feed.
 *
 * EngineAI kept asserting stale holiday information: it read "both are on
 * holiday next week and back on the 17th" in a 7 August email and repeated it
 * on 18 August as though it still held. Anchoring relative dates fixed the
 * reasoning; this gives it the actual answer.
 *
 * THREE THINGS THE FEED DOES THAT ARE EASY TO GET WRONG, all verified against
 * the live 222-event feed rather than assumed:
 *
 *  1. DTEND ON A DATE VALUE IS EXCLUSIVE. DTSTART:20260223 DTEND:20260224 is a
 *     ONE-day absence. Treating DTEND as inclusive makes every holiday read a
 *     day longer than it is — the kind of quiet off-by-one that ends up in a
 *     client email.
 *  2. EACH DAY IS ITS OWN EVENT. A two-week holiday arrives as roughly ten
 *     separate VEVENTs. Without coalescing, "who is away" lists the same
 *     person ten times and no date range is legible.
 *  3. THE URL CARRIES A CREDENTIAL (team_member_token). It lives in an env
 *     var, is never logged, and never appears in an error message — the
 *     failure text below deliberately says nothing about the URL.
 */

export interface Absence {
  /** Display name as CharlieHR renders it. */
  name: string;
  /** "holiday", "public holiday", or whatever else the feed labels it. */
  type: string;
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD — DTEND has already been decremented. */
  to: string;
  /**
   * The booking covers only PART of the day, as CharlieHR worded it
   * ("half day"). Absent on a whole-day booking.
   *
   * The from/to range can say which days are booked and nothing about how much
   * of a day. So a colleague working Monday morning and off Monday afternoon
   * rendered identically to one away all day, and "is Gabi working today?" was
   * answered "no" on the strength of it. That answer was flagged.
   */
  partial?: string;
}

export interface AbsenceResult {
  ok: boolean;
  absences: Absence[];
  /** Populated when ok is false. Never contains the URL or the token. */
  error?: string;
  fetchedAt: string;
}

const TZ = "Europe/Zurich";
/** The feed is ~65KB and changes rarely; a short cache keeps it off the hot path. */
const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; result: AbsenceResult } | null = null;

/** YYYY-MM-DD in the workspace's zone — never toISOString(), which is UTC. */
export function workspaceToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Leave types CharlieHR emits, longest first so "public holiday deductible
 * leave" is matched before "holiday".
 *
 * This list is the whole correctness story. An unrecognised type falls through
 * to "the entire summary is the name", which is how "Jess Foley life event
 * day" became a PERSON — and why a first pass reported 32 people when the
 * company has roughly half that. The invented ones looked completely ordinary
 * in the output; only counting distinct first names exposed them.
 *
 * If CharlieHR adds a type, this must gain it. isUnparsedLeaveType() below
 * exists so that failure is loud rather than another fictional colleague.
 */
const LEAVE_TYPES = [
  "public holiday deductible leave",
  "public holiday leave",
  "public holiday",
  // Compounds ending in "leave" MUST precede the bare "leave" below, or the
  // shorter match wins and the rest sticks to the name: "Chris Parker time in
  // lieu leave" became a person called "Chris Parker time in lieu".
  "life event day leave",
  "time in lieu leave",
  "time off leave",
  "life event day",
  "compassionate leave",
  "parental leave",
  "maternity leave",
  "paternity leave",
  "unpaid leave",
  "study leave",
  "sabbatical",
  "time in lieu",
  "time off",
  "sick leave",
  "holiday",
  "sick",
  "leave",
  "absent",
];

/** Labels CharlieHR uses for company-wide entries that are NOT a person. */
const NON_PERSON_LABELS = new Set(["restricted date", "company", "company holiday", "office", "bank holiday"]);
/** Whole-company entries that arrive with no person attached at all. */
const NON_PERSON_SUMMARIES = /^(company\s+holiday|bank\s+holiday|office\s+closed|public\s+holiday)$/i;

/** "Jane Doe holiday (26th Feb - 13th Mar)" -> { name: "Jane Doe", type: "holiday" } */
export function parseSummary(raw: string): { name: string; type: string; isPerson: boolean; partial?: string } {
  // Strip the trailing human-readable range CharlieHR appends. It repeats the
  // dates we already have from DTSTART/DTEND, and describes the WHOLE booking
  // rather than the single day this event represents.
  // REPEATEDLY: CharlieHR appends both a qualifier and a date range, so
  // "X public holiday (non-deductible) (7th Aug - 24th Aug)" has two trailing
  // groups. Stripping one left "(non-deductible)" attached and produced a
  // colleague named after their own leave type.
  // ALL parenthetical groups, wherever they sit — not just trailing ones.
  // "Katie R. public holiday (non-deductible) leave - One Day" carries its
  // qualifier in the MIDDLE, so a trailing-only strip never fired and the
  // parenthetical ended up glued to the name, inventing a colleague called
  // "Katie R. public holiday (non-deductible)".
  let s = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // A trailing "- One Day" / "- Half Day" / "- 2 Days" is a qualifier on the
  // DURATION, not part of the type and certainly not part of the name. Stripped
  // generically: an earlier version handled only "One Day", so every half-day
  // booking produced a separate fictional colleague.
  //
  // KEPT, not merely stripped, when it says the day is only PARTLY booked. A
  // whole-day qualifier tells us nothing the date range does not already say,
  // so it is dropped as before; "half" and any fraction are the one thing the
  // range cannot express, and throwing it away is what made a morning-working
  // colleague read as away.
  const durationMatch = s.match(/\s*[–—-]\s*(a\s+)?(half|one|two|three|\d+(\.\d+)?)\s+days?\s*$/i);
  const qualifier = durationMatch ? durationMatch[2].toLowerCase() : "";
  const partial =
    qualifier === "half" || (qualifier !== "" && Number(qualifier) > 0 && Number(qualifier) < 1)
      ? "half day"
      : undefined;
  s = s.replace(/\s*[–—-]\s*(a\s+)?(half|one|two|three|\d+(\.\d+)?)\s+days?\s*$/i, "").trim();

  // "Restricted Date: COP30" — a company-wide entry wearing a person's shape.
  const colon = s.match(/^(.+?):\s*(.+)$/);
  if (colon) {
    const label = colon[1].trim();
    return {
      name: label,
      type: colon[2].trim().toLowerCase(),
      isPerson: !NON_PERSON_LABELS.has(label.toLowerCase()),
    };
  }

  // A summary that is ONLY a company-wide label names nobody.
  if (NON_PERSON_SUMMARIES.test(s)) return { name: s, type: "company", isPerson: false };

  for (const t of LEAVE_TYPES) {
    // The type is matched WHEREVER it appears, not only at the end. CharlieHR
    // appends the occasion to a public holiday — "…deductible leave - Swiss
    // National Day" — and an end-anchored match failed on every one of those,
    // handing the whole string back as a name.
    const at = new RegExp(`^(.*?)\\s+${t.replace(/ /g, "\\s+")}(\\b|$)`, "i");
    const m = s.match(at);
    if (m && m[1].trim()) {
      return { name: m[1].trim(), type: t, isPerson: true, partial };
    }
  }
  // Unrecognised. Kept, but flagged by isUnparsedLeaveType so a new CharlieHR
  // type shows up as a test failure rather than as a new colleague.
  return { name: s, type: "away", isPerson: true, partial };
}

/** True when parseSummary could not identify the leave type. */
export function isUnparsedLeaveType(parsed: { type: string }): boolean {
  return parsed.type === "away";
}

/** Minimal ICS reader — enough for a feed of all-day VEVENTs. */
export function parseIcs(text: string): Absence[] {
  // Unfold: RFC 5545 continues a long line with CRLF + a single space or tab.
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const out: Absence[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) { cur = {}; continue; }
    if (line.startsWith("END:VEVENT")) {
      if (cur && cur.DTSTART && cur.SUMMARY) {
        const from = cur.DTSTART.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
        // DTEND is EXCLUSIVE on a DATE value. Decrement for an inclusive end;
        // fall back to a single day when DTEND is absent.
        const rawEnd = cur.DTEND ? cur.DTEND.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : null;
        const to = rawEnd ? addDays(rawEnd, -1) : from;
        const { name, type, isPerson, partial } = parseSummary(cur.SUMMARY);
        // Company-wide entries ("Restricted Date: COP30") are not somebody's
        // absence and must not appear under "who is away".
        if (name && isPerson) out.push({ name, type, from, to: to < from ? from : to, ...(partial ? { partial } : {}) });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0];
    cur[key] = line.slice(idx + 1);
  }
  return out;
}

/**
 * Merge consecutive days for the same person and type into one range.
 *
 * A fortnight off arrives as ten separate events; listing it ten times is
 * unreadable and makes the team look far more absent than it is. Gaps of up to
 * three days are bridged so a Friday-to-Monday booking is not split by the
 * weekend it spans.
 */
export function coalesce(list: Absence[]): Absence[] {
  const byKey = new Map<string, Absence[]>();
  const out: Absence[] = [];
  for (const a of list) {
    // A PART-DAY BOOKING IS NEVER MERGED. It stands alone as its own single
    // day, because merging one into a range destroys the detail a second
    // time: a half day cannot describe the days either side of it.
    //
    // NOT done by adding `partial` to the group key, which looks equivalent
    // and is not — two half days on Monday and Wednesday would share that
    // key, sit two days apart, fall inside the three-day bridge below, and
    // merge into "Monday to Wednesday, half day", inventing a Tuesday
    // nobody booked.
    if (a.partial) { out.push({ ...a }); continue; }
    const k = `${a.name} ${a.type}`;
    byKey.set(k, [...(byKey.get(k) || []), a]);
  }
  for (const group of Array.from(byKey.values())) {
    group.sort((x, y) => x.from.localeCompare(y.from));
    let run = { ...group[0] };
    for (const a of group.slice(1)) {
      if (a.from <= addDays(run.to, 3)) {
        if (a.to > run.to) run.to = a.to;
      } else {
        out.push(run); run = { ...a };
      }
    }
    out.push(run);
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

export async function fetchAbsences(): Promise<AbsenceResult> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const url = (process.env.CHARLIE_HR_CALENDAR_URL || "").trim();
  if (!url) {
    // Deliberately not an empty list. "No feed configured" and "nobody is
    // away" must never look the same to the model.
    return {
      ok: false, absences: [],
      error: "The absence calendar is not configured on this server.",
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    // redirect "follow" is load-bearing: charliehr.com 301s to www.charliehr.com,
    // and without it the body comes back empty with a 200 further down.
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`feed returned ${res.status}`);
    const text = await res.text();
    const absences = coalesce(parseIcs(text));
    const result: AbsenceResult = { ok: true, absences, fetchedAt: new Date().toISOString() };
    cache = { at: Date.now(), result };
    return result;
  } catch (e: any) {
    // The URL carries a token, so this message says nothing about it.
    const result: AbsenceResult = {
      ok: false, absences: [],
      error: `The absence calendar could not be read (${String(e?.message || e).slice(0, 80)}).`,
      fetchedAt: new Date().toISOString(),
    };
    // Cache failures briefly too, so a dead feed cannot be hammered once a turn.
    cache = { at: Date.now() - CACHE_MS + 60_000, result };
    return result;
  }
}

/** Who is away on `day`, and who starts within `soonDays`. */
export function splitAbsences(all: Absence[], day: string, soonDays = 14) {
  const horizon = addDays(day, soonDays);
  return {
    current: all.filter((a) => a.from <= day && a.to >= day),
    soon: all.filter((a) => a.from > day && a.from <= horizon),
  };
}

/** The prompt block. */
export function formatAbsenceBlock(result: AbsenceResult, day: string): string {
  if (!result.ok) {
    // Says it could not look, rather than implying nobody is away — the same
    // distinction the meetings panel makes, and for the same reason.
    return `\n\n## Who is away\n${result.error} Do NOT infer that everyone is available: say you could not check, and do not repeat holiday claims from emails or meeting notes as though they were current.`;
  }
  const { current, soon } = splitAbsences(result.absences, day);
  if (!current.length && !soon.length) {
    return `\n\n## Who is away\nNobody is recorded as away today or in the next 14 days, per the HR calendar.`;
  }
  const fmt = (a: Absence) => {
    const what = a.partial ? `${a.type}, ${a.partial}` : a.type;
    return a.from === a.to
      ? `${a.name} — ${a.from} (${what})`
      : `${a.name} — ${a.from} to ${a.to} inclusive (${what})`;
  };
  return [
    `\n\n## Who is away`,
    `From the HR calendar as at ${result.fetchedAt.slice(0, 16).replace("T", " ")} UTC. This is CURRENT and overrides any holiday claim you read in an email, meeting note or message — those were written on an earlier date and may describe leave that has since ended.`,
    `THIS IS BOOKED LEAVE, NOT AN ATTENDANCE RECORD. It says what someone has booked off, not whether they are at their desk. Asked "is X working today?", answer with what the calendar holds — "the HR calendar has X on holiday today" — and offer to check if it matters. A booking marked HALF DAY means they are working part of that day, so the answer to whether they are working is YES for part of it; never report a half day as a day off.`,
    current.length ? `\nAway today:\n${current.map((a) => `- ${fmt(a)}`).join("\n")}` : `\nNobody is away today.`,
    soon.length ? `\nAway within 14 days:\n${soon.map((a) => `- ${fmt(a)}`).join("\n")}` : "",
    `\nIf someone is not listed here, do not assert that they are away. If you need leave beyond this window, say so rather than guessing.`,
  ].filter(Boolean).join("\n");
}
