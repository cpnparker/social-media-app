/**
 * The 08:45-briefed-as-07:45 bug, checked as arithmetic rather than as prose.
 *
 * Every case below is a real instant with a known correct answer. The point is
 * not that the helper "uses a timezone" — the old code did too, implicitly —
 * but that it lands on the hour a person in Zurich would see, in BOTH halves of
 * the year. A hardcoded +1 passes the winter cases and fails the summer ones,
 * which is exactly why this survived unnoticed until August.
 */
import { localStamp, localDay } from "../lib/ai/providers";

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

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
