/**
 * Parser guards for the CharlieHR absence feed.
 * `npx tsx scripts/verify-absences.ts`   (needs /tmp/charlie.ics, see below)
 *
 * The two traps here are silent, not loud:
 *   DTEND on a DATE value is EXCLUSIVE, so treating it as inclusive makes
 *   every holiday read a day longer than it is; and each day of a booking is
 *   its own VEVENT, so without coalescing a fortnight off appears as ten
 *   entries and the range is unreadable.
 *
 * To refresh the fixture (the URL carries a credential, so it is never in the
 * repo):  curl -sL "$CHARLIE_HR_CALENDAR_URL" -o /tmp/charlie.ics
 * Note the -L: charliehr.com 301s to www, and without it the body is empty.
 *
 * PRIVACY: this is colleagues' leave. Nothing here prints a full name.
 */
import { readFileSync, existsSync } from "fs";
import { parseIcs, coalesce, splitAbsences, parseSummary, addDays } from "../lib/hr/absences";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: string) => { console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); ok ? pass++ : fail++; };

console.log("1. DTEND is exclusive");
const oneDay = parseIcs("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260223\nDTEND;VALUE=DATE:20260224\nSUMMARY:Jane Doe holiday\nEND:VEVENT");
check("a 23rd->24th event is ONE day on the 23rd", oneDay[0]?.from === "2026-02-23" && oneDay[0]?.to === "2026-02-23", JSON.stringify(oneDay[0]));
const noEnd = parseIcs("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260223\nSUMMARY:Jane Doe holiday\nEND:VEVENT");
check("a missing DTEND is a single day", noEnd[0]?.to === "2026-02-23");

console.log("\n2. Consecutive days coalesce into one range");
const days = ["20260810","20260811","20260812","20260813","20260814"].map((d) =>
  `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${d}\nDTEND;VALUE=DATE:${d.slice(0,6)}${String(Number(d.slice(6))+1).padStart(2,"0")}\nSUMMARY:Ceri Smith holiday (10th Aug - 14th Aug)\nEND:VEVENT`).join("\n");
const merged = coalesce(parseIcs(days));
check("five daily events become one range", merged.length === 1, `${merged.length} ranges`);
check("the range is 10-14 Aug inclusive", merged[0]?.from === "2026-08-10" && merged[0]?.to === "2026-08-14", JSON.stringify(merged[0]));
check("the trailing '(10th Aug - 14th Aug)' is stripped from the name", merged[0]?.name === "Ceri Smith", merged[0]?.name);

console.log("\n3. Summary shapes seen in the live feed");
check("'X holiday'", parseSummary("Jane Doe holiday (26th Feb - 13th Mar)").name === "Jane Doe");
check("type is holiday", parseSummary("Jane Doe holiday (26th Feb - 13th Mar)").type === "holiday");
check("'X public holiday deductible leave'", parseSummary("Jane Doe public holiday deductible leave - Swiss National Day").name === "Jane Doe");
check("'X: Trip'", parseSummary("Jane Doe: COP30 (10th Nov - 21st Nov)").name === "Jane Doe");

console.log("\n4. Against the REAL feed");
if (!existsSync("/tmp/charlie.ics")) {
  console.log("   (skipped — no fixture at /tmp/charlie.ics; see the header for how to fetch one)");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
const real = coalesce(parseIcs(readFileSync("/tmp/charlie.ics", "utf8")));
const raw = parseIcs(readFileSync("/tmp/charlie.ics", "utf8"));
console.log(`   raw events: ${raw.length}   coalesced ranges: ${real.length}`);
check("coalescing genuinely reduces the list", real.length > 0 && real.length < raw.length);
check("every range is start<=end", real.every((a) => a.from <= a.to));
check("no name still carries a bracketed range", !real.some((a) => a.name.includes("(")));
check("no name is empty", real.every((a) => a.name.length > 1));
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
const { current, soon } = splitAbsences(real, today);
console.log(`   today=${today}  away now: ${current.length}  starting within 14d: ${soon.length}`);
// Names redacted — this is colleagues' leave.
console.log(`   sample ranges (names redacted): ${real.slice(0,3).map((a) => `${a.from}..${a.to} (${a.type})`).join("  |  ")}`);
check("distinct people found", new Set(real.map((a) => a.name)).size > 1, `${new Set(real.map((a) => a.name)).size} people`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
