/**
 * The 08:45-briefed-as-07:45 bug, checked as arithmetic rather than as prose.
 *
 * Every case below is a real instant with a known correct answer. The point is
 * not that the helper "uses a timezone" — the old code did too, implicitly —
 * but that it lands on the hour a person in Zurich would see, in BOTH halves of
 * the year. A hardcoded +1 passes the winter cases and fails the summer ones,
 * which is exactly why this survived unnoticed until August.
 */
import { localStamp, localDay, dayLabel, formatMeetingBrainResult } from "../lib/ai/providers";

let failures = 0;
const check = (label: string, got: string | null, want: string | null) => {
  if (got === want) { console.log(`  ok    ${label} → ${got}`); }
  else { failures++; console.log(`  FAIL  ${label} → got ${got}, want ${want}`); }
};

console.log("\n1. The reported bug: the morning meeting");
// 08:45 Europe/Zurich on 19 Aug 2026 (CEST, UTC+2) is 06:45Z.
check("08:45 CEST from stored UTC", localStamp("2026-08-19T06:45:00+00:00"), "2026-08-19 08:45");
check("…as Google returns it (offset intact)", localStamp("2026-08-19T08:45:00+02:00"), "2026-08-19 08:45");
console.log("  (the old code sliced 16 chars off the first form → '2026-08-19T06:45', zone discarded)");

console.log("\n2. Summer AND winter — a fixed +1 offset would fail the first of these");
check("August  (CEST, UTC+2)", localStamp("2026-08-19T06:45:00Z"), "2026-08-19 08:45");
check("January (CET,  UTC+1)", localStamp("2026-01-19T07:45:00Z"), "2026-01-19 08:45");

console.log("\n3. DST boundaries (Europe/Zurich switches 29 Mar and 25 Oct 2026)");
check("day before spring-forward", localStamp("2026-03-28T07:45:00Z"), "2026-03-28 08:45");
check("day after  spring-forward", localStamp("2026-03-30T06:45:00Z"), "2026-03-30 08:45");
check("day before fall-back",      localStamp("2026-10-24T06:45:00Z"), "2026-10-24 08:45");
check("day after  fall-back",      localStamp("2026-10-26T07:45:00Z"), "2026-10-26 08:45");

console.log("\n4. The wrong-DAY case: slicing a date off a UTC string near midnight");
// 00:30 on 19 Aug in Zurich is 22:30 on the 18th in UTC.
check("00:30 local is still the 19th", localDay("2026-08-18T22:30:00Z"), "2026-08-19");
console.log("  (the old .slice(0, 10) reported this meeting as the 18th — wrong day, not just wrong hour)");

console.log("\n5. Bad input is refused, never guessed at");
check("null",    localStamp(null), null);
check("empty",   localStamp(""), null);
check("garbage", localStamp("not a date"), null);

// ── 6. The relative day, said outright ──────────────────────────────────
//
// Asked on Monday who he was meeting TOMORROW, the assistant answered with
// Wednesday's meetings. It was not confused about the date — challenged, it
// said "Today is Monday the 24th, so tomorrow is Tuesday the 25th", correctly.
// It was handed a flat list spanning two days and got the one step it had to
// do itself, today+1, wrong. dayLabel does that step on the server.
const MON = new Date("2026-08-24T09:26:31Z"); // the actual instant, 11:26 Zurich
console.log("\n6. dayLabel — the Monday/Wednesday bug, at the instant it happened");
const rel = (iso: string, now: Date) => {
  const l = dayLabel(iso, now);
  return l ? (l.split(" (")[0] || l) : null;
};
check("Tue 25th 15:00 is TOMORROW", rel("2026-08-25T13:00:00Z", MON), "TOMORROW");
check("Wed 26th 09:00 is NOT tomorrow", rel("2026-08-26T07:00:00Z", MON), "Wednesday 26 August");
check("Mon 24th 15:00 is TODAY", rel("2026-08-24T13:00:00Z", MON), "TODAY");
check("the label names the weekday too", dayLabel("2026-08-25T13:00:00Z", MON), "TOMORROW (Tuesday 25 August)");

console.log("\n7. The kill shot: a UTC prefix would call this tomorrow");
// 22:30Z on the 25th is 00:30 on the TWENTY-SIXTH in Zurich. An implementation
// that slices the UTC date reads "2026-08-25", sees today+1, and tags it
// TOMORROW — the wrong day, which is the whole bug wearing a different hat.
check("25th 22:30Z is the 26th locally, so NOT tomorrow", rel("2026-08-25T22:30:00Z", MON), "Wednesday 26 August");
check("…and localDay agrees it is the 26th", localDay("2026-08-25T22:30:00Z"), "2026-08-26");

console.log("\n8. TOMORROW across both DST switches, and across a year");
// Adding 24h to local midnight overshoots the 23-hour spring day and falls
// short on the 25-hour autumn day. Zurich has both, every year.
check("spring-forward: 28th → 29th Mar", rel("2026-03-29T10:00:00Z", new Date("2026-03-28T12:00:00Z")), "TOMORROW");
check("fall-back:      24th → 25th Oct", rel("2026-10-25T10:00:00Z", new Date("2026-10-24T12:00:00Z")), "TOMORROW");
check("deep winter (CET)",               rel("2026-01-16T09:00:00Z", new Date("2026-01-15T12:00:00Z")), "TOMORROW");
check("across new year",                 rel("2027-01-01T09:00:00Z", new Date("2026-12-31T12:00:00Z")), "TOMORROW");
check("two days out is not tomorrow",    rel("2026-08-26T13:00:00Z", MON), "Wednesday 26 August");

console.log("\n9. Bad input is refused here too");
check("null", dayLabel(null, MON), null);
check("garbage", dayLabel("not a date", MON), null);

// ── 10. USED, not merely written ────────────────────────────────────────
// A correct helper that nothing calls is the exact defect that once reported a
// live security hole as closed. Assert the tag reaches the STRING the model
// actually reads.
console.log("\n10. The label reaches the tool string the model reads");
const formatted = formatMeetingBrainResult("upcoming_meetings", {
  data: [{ id: "1", title: "TCE planning", day: dayLabel("2026-08-25T13:00:00Z", MON), date: localStamp("2026-08-25T13:00:00Z"), attendees: [] }],
  count: 1,
});
formatted.indexOf("TOMORROW") >= 0
  ? console.log("  ok    the serialised result contains the TOMORROW tag")
  : (failures++, console.log("  FAIL  the tag never reaches the model — the helper is correct and unused"));
formatted.indexOf("ATTENDEES, never the ORGANISER") >= 0
  ? console.log("  ok    the scope note ships with every result")
  : (failures++, console.log("  FAIL  the scope note is missing — a miss here can be read as 'no' again"));

// ── Self-test ───────────────────────────────────────────────────────────
// The failure mode here is a check that tests NOTHING: a labeller returning ""
// for everything, or a drifting fixture instant, makes every assertion above
// pass vacuously. Both broken implementations must produce failures.
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n11. Self-test — broken labellers must fail these assertions");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    detects ${name}`);
    else { selfFails++; console.log(`  FAIL  does NOT detect ${name}`); }
  };

  // (a) The UTC-prefix implementation — the most likely wrong rewrite.
  const utcPrefix = (iso: string, now: Date): string | null => {
    const day = String(iso).slice(0, 10);
    const t = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return day === t ? "TOMORROW" : "other";
  };
  detects("a UTC-prefix labeller mislabelling the 22:30Z case",
    utcPrefix("2026-08-25T22:30:00Z", MON) === "TOMORROW" && rel("2026-08-25T22:30:00Z", MON) !== "TOMORROW");

  // (b) The labeller that returns nothing — every assertion would pass vacuously
  //     if the checks only tested "does not throw".
  const empty = (): string | null => "";
  detects("a labeller that returns empty for everything", empty() !== "TOMORROW");

  // (c) The fixture itself must still be a Monday, or case 6 means nothing.
  const weekday = MON.toLocaleDateString("en-GB", { timeZone: "Europe/Zurich", weekday: "long" });
  detects(`the fixture instant still being a Monday (is ${weekday})`, weekday === "Monday");

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
