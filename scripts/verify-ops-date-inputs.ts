/**
 * verify-ops-date-inputs.ts — guards how the operations pages turn what is in
 * their date inputs into a query (lib/use-settled-date-range.ts and the
 * predicates in lib/date-utils.ts)
 *
 * 2026-09-30: Jan–Feb 2026 on /operations/commissioned-cus read 747.17 CU; the
 * true figure is 320.60. A native <input type="date"> fires onChange on every
 * segment typed, and every page fetched on every change. Typing 01.01.2026 –
 * 28.02.2026 sent sixteen requests — from=0002-01-01, 0020-01-01, 0202-01-01
 * (each all of history), a To of "" (open-ended to today), 2026-09-02,
 * 2026-09-28 — and nothing cancelled them or checked which was newest, so the
 * LAST ONE TO ARRIVE was drawn. The all-history queries are the slowest, so
 * they usually won. Replayed in Chrome: boxes reading 01/01/2026 – 28/02/2026
 * over 1008.67 CU and 7350 tasks.
 *
 * Three things now stand between a keystroke and the numbers, and this checks
 * each at its own seam:
 *   1. isCompleteDate / isUsableRange refuse partial, impossible, pre-2000 and
 *      reversed values — fixtures are the exact values Chrome produced.
 *   2. createRangeSettler (the hook's timing, minus React) holds on those and
 *      on a field the browser reports as half-typed, applies a preset (both
 *      ends at once) immediately, and otherwise waits for typing to pause. The
 *      REPLAY drives the REAL settler through the recorded keystrokes on a
 *      fake clock. What stays unexercised is the hook's thin React shell —
 *      reading validity.badInput off the refs and calling update() — for which
 *      the Chrome replay is the proof.
 *   3. createLatestRequest lets only the newest request write state, and
 *      aborts the one it replaces — driven with real AbortControllers and
 *      responses resolving out of order.
 * Then WIRING: every operations page with a date input reads its raw input
 * state ONLY in the input itself. Any other read — a memo, a query param, an
 * export link — is a place the half-typed value leaks back in, which is what
 * a later edit is most likely to reintroduce. The request-guard part of the
 * wiring (useLatestRequest + signal + isCurrent) is PRESENCE, labelled.
 *
 * MUTATION LOG (each run by --self-test, all KILLED unless noted)
 *  - no year floor in isCompleteDate       -> KILLED by "0202-01-01"
 *  - no calendar round-trip                -> KILLED by "2026-02-30"
 *  - no reversal check in isUsableRange    -> KILLED by 2026-03-01..2026-02-28
 *  - requireBoth ignored                   -> KILLED by the timeline fixture
 *  - settleAction never debounces          -> KILLED by the replay (every
 *    usable keystroke applies)
 *  - settleAction debounces presets too    -> KILLED by the preset step
 *  - settleAction never holds              -> KILLED by the replay pausing on
 *    0202-01-01 (the first version of this log credited the replay while the
 *    replay never paused on an unusable value — only a unit assertion caught it)
 *  - settleAction ignores badInput         -> KILLED by the pause on the
 *    half-typed To: a blank reads as an open end and queried all of history
 *  - settler forgets the previous values   -> KILLED: after the preset every
 *    usable keystroke is taken for a preset and applied at once
 *  - settler does not cancel the pending   -> KILLED: every usable
 *    intermediate value (2026-09-02, 2026-09-28) applies in turn
 *  - settler never reports invalid         -> KILLED by the half-typed pauses
 *  (the last two were found by review surviving the first, model-based replay)
 *  - begin() does not abort the previous   -> KILLED ("superseded is aborted")
 *  - isCurrent() always true               -> KILLED by the out-of-order race
 *  - a memo reading raw dateFrom           -> KILLED by the wiring check
 *  - a date page with no settled range     -> KILLED by the wiring check
 *  - a date input without its ref          -> KILLED by the wiring check
 *
 * Run: npx tsx scripts/verify-ops-date-inputs.ts [--self-test]
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { isCompleteDate, isUsableRange, settleAction, type SettleAction } from "../lib/date-utils";
import { createLatestRequest, createRangeSettler } from "../lib/use-settled-date-range";

type Impl = {
  isCompleteDate: (s: string) => boolean;
  isUsableRange: (f: string, t: string, requireBoth?: boolean) => boolean;
  settleAction: (
    prev: { from: string; to: string },
    f: string,
    t: string,
    requireBoth?: boolean,
    partial?: boolean
  ) => SettleAction;
  createRangeSettler: typeof createRangeSettler;
  createLatestRequest: typeof createLatestRequest;
};

const REAL: Impl = { isCompleteDate, isUsableRange, settleAction, createRangeSettler, createLatestRequest };

class Fail extends Error {}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Fail(msg);
}

/* ─── 1. Predicates ─── */
function checkPredicates(impl: Impl): void {
  // Every intermediate value Chrome produced while typing the Jan–Feb range.
  for (const s of ["0002-01-01", "0020-01-01", "0202-01-01", "0002-02-28", "0020-02-28", "0202-02-28", ""]) {
    assert(!impl.isCompleteDate(s), `isCompleteDate accepted the half-typed "${s}"`);
  }
  for (const s of ["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29", "2026-1-01", "20260101", "2026-01-01T00:00"]) {
    assert(!impl.isCompleteDate(s), `isCompleteDate accepted the impossible "${s}"`);
  }
  for (const s of ["2026-01-01", "2026-02-28", "2024-02-29", "2000-01-01", "2100-12-31", "2026-09-02"]) {
    assert(impl.isCompleteDate(s), `isCompleteDate refused the real date "${s}"`);
  }
  assert(impl.isUsableRange("2026-01-01", "2026-02-28"), "refused Jan–Feb 2026");
  assert(impl.isUsableRange("2026-01-01", "2026-01-01"), "refused a one-day range");
  assert(impl.isUsableRange("", ""), "refused Clear (all dates)");
  assert(impl.isUsableRange("2026-01-01", ""), "refused an open-ended range");
  assert(!impl.isUsableRange("2026-03-01", "2026-02-28"), "accepted a reversed range");
  assert(!impl.isUsableRange("0202-01-01", "2026-09-30"), "accepted a half-typed From");
  assert(!impl.isUsableRange("2026-01-01", "0020-02-28"), "accepted a half-typed To");
  // Timeline's custom window cannot draw an open end.
  assert(!impl.isUsableRange("2026-01-01", "", true), "requireBoth accepted an empty To");
  assert(!impl.isUsableRange("", "2026-02-28", true), "requireBoth accepted an empty From");
  assert(impl.isUsableRange("2026-01-01", "2026-02-28", true), "requireBoth refused a whole range");
}

/* ─── 2. Settling: the recorded keystrokes ─── */
// The inputs' values in order, as Chrome reported them, starting from the
// "This Month" preset on 2026-09-30. `partial` is the field's
// validity.badInput: true exactly where a segment is half-typed and the
// browser reports the value as "".
type Step = { from: string; to: string; partial?: boolean };
const START = { from: "2026-09-01", to: "2026-09-30" };
const TYPED: Step[] = [
  // From: 01 01 2026
  { from: "2026-01-01", to: "2026-09-30" },
  { from: "0002-01-01", to: "2026-09-30" },
  { from: "0020-01-01", to: "2026-09-30" },
  { from: "0202-01-01", to: "2026-09-30" },
  { from: "2026-01-01", to: "2026-09-30" },
  // To: 28 02 2026
  { from: "2026-01-01", to: "2026-09-02" },
  { from: "2026-01-01", to: "2026-09-28" },
  { from: "2026-01-01", to: "", partial: true },
  { from: "2026-01-01", to: "0002-02-28" },
  { from: "2026-01-01", to: "0020-02-28" },
  { from: "2026-01-01", to: "0202-02-28" },
  { from: "2026-01-01", to: "2026-02-28" },
];
const FINAL = { from: "2026-01-01", to: "2026-02-28" };

// Drives the REAL settler on a fake clock. `pauses` adds a gap (ms) BEFORE
// the step at that index; 120ms between keystrokes is a normal typing pace.
function replay(impl: Impl, steps: Step[], pauses: Record<number, number> = {}, initial = START) {
  let now = 0;
  let nextId = 0;
  let timers: { id: number; due: number; fn: () => void }[] = [];
  const applied: { from: string; to: string }[] = [];
  const invalidAt: { from: string; to: string }[] = [];
  let current: Step = { ...initial };
  const settler = impl.createRangeSettler({
    delayMs: 400,
    requireBoth: false,
    initial: { ...initial },
    schedule: (fn, ms) => {
      const id = ++nextId;
      timers.push({ id, due: now + ms, fn });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    onApply: (r) => applied.push(r),
    onInvalid: (b) => {
      if (b) invalidAt.push({ from: current.from, to: current.to });
    },
    decide: impl.settleAction,
  });
  const advance = (to: number) => {
    for (;;) {
      const due = timers.filter((t) => t.due <= to).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      timers = timers.filter((t) => t.id !== due.id);
      now = due.due;
      due.fn();
    }
    now = to;
  };
  for (let i = 0; i < steps.length; i++) {
    advance(now + 120 + (pauses[i] || 0));
    current = steps[i];
    settler.update(current.from, current.to, !!current.partial);
  }
  advance(now + 5000);
  return { applied, invalidAt };
}

const same = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from === b.from && a.to === b.to;

function checkSettling(impl: Impl): void {
  // From Last Month, click This Month — both ends change at once, so it
  // applies without waiting — then type.
  const fast = replay(impl, [START, ...TYPED], {}, { from: "2026-08-01", to: "2026-08-31" });
  assert(
    fast.applied.length > 0 && same(fast.applied[0], START),
    `the preset did not apply at once: ${JSON.stringify(fast.applied)}`
  );
  const typed = fast.applied.slice(1);
  assert(
    typed.length === 1 && same(typed[0], FINAL),
    `typing Jan–Feb at a normal pace applied ${typed.length} range(s): ${JSON.stringify(typed)} — expected exactly 2026-01-01..2026-02-28`
  );

  // A pause after finishing From legitimately queries From–today once.
  const paused = replay(impl, TYPED, { 5: 1500 });
  assert(
    paused.applied.length === 2 && same(paused.applied[0], { from: "2026-01-01", to: "2026-09-30" }) && same(paused.applied[1], FINAL),
    `pausing between fields applied ${JSON.stringify(paused.applied)}`
  );

  // Pausing on a half-typed year holds, and says so.
  const onYear = replay(impl, TYPED, { 4: 1500 });
  assert(!onYear.applied.some((r) => r.from === "0202-01-01"), `a pause on 0202-01-01 queried it: ${JSON.stringify(onYear.applied)}`);
  assert(onYear.invalidAt.some((r) => r.from === "0202-01-01"), "a pause on a half-typed year never reported invalid");

  // Pausing on a half-typed To (reported as "") must NOT read as an open end.
  const onBlank = replay(impl, TYPED, { 8: 1500 });
  assert(!onBlank.applied.some((r) => r.to === ""), `a pause on a half-typed To queried an open end: ${JSON.stringify(onBlank.applied)}`);
  assert(onBlank.invalidAt.some((r) => r.to === ""), "a pause on a half-typed To never reported invalid");
  assert(same(onBlank.applied[onBlank.applied.length - 1], FINAL), "after the half-typed pause the final range was not applied");

  // A field deliberately emptied (not half-typed) IS an open end.
  const cleared = replay(impl, [{ from: "2026-01-01", to: "2026-09-30" }, { from: "2026-01-01", to: "" }]);
  assert(
    cleared.applied.length === 1 && same(cleared.applied[0], { from: "2026-01-01", to: "" }),
    `emptying To did not apply an open-ended range: ${JSON.stringify(cleared.applied)}`
  );

  for (const r of fast.applied.concat(paused.applied, onYear.applied, onBlank.applied)) {
    assert(impl.isUsableRange(r.from, r.to), `an unusable range was applied: ${JSON.stringify(r)}`);
  }
  assert(impl.settleAction(START, "2026-09-01", "2026-09-02") === "debounce", "a one-field edit was not debounced");
  assert(impl.settleAction(START, "0202-09-01", "2026-09-30") === "hold", "a half-typed year was not held");
  assert(impl.settleAction(START, "2026-09-01", "", false, true) === "hold", "a half-typed (badInput) field was not held");
}

/* ─── 3. Only the newest request writes ─── */
async function checkLatestRequest(impl: Impl): Promise<void> {
  const latest = impl.createLatestRequest();
  const a = latest.begin();
  const b = latest.begin();
  assert(a.signal.aborted, "starting a new request did not abort the superseded one");
  assert(!a.isCurrent(), "a superseded request still reports itself current");
  assert(b.isCurrent(), "the newest request does not report itself current");

  // The incident: the slow wrong query answers LAST. Page pattern: write only
  // if still current.
  const race = impl.createLatestRequest();
  let shown = "";
  const slowWrong = race.begin();
  const fastRight = race.begin();
  const answer = (req: { isCurrent: () => boolean }, value: string, ms: number) =>
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (req.isCurrent()) shown = value;
        resolve();
      }, ms)
    );
  await Promise.all([answer(slowWrong, "747.17 (all history)", 40), answer(fastRight, "320.60", 5)]);
  assert(shown === "320.60", `out-of-order responses drew "${shown}", expected the newest request's "320.60"`);

  const unmounted = impl.createLatestRequest();
  const c = unmounted.begin();
  unmounted.abort();
  assert(!c.isCurrent() && c.signal.aborted, "a request outliving its component still reports itself current");
}

/* ─── 4. Wiring ─── */
const ROOT = join(__dirname, "..");
const OPS_DIR = join(ROOT, "app/(app)/operations");
// These must be found, so a glob that silently matches nothing cannot pass.
const EXPECTED_PAGES = [
  "commissioned-cus", "delivered", "formats", "all-content", "spiked",
  "team-production", "contracts", "contracts-grid", "timeline-resourcing",
];
// Fetches only on mount and on its Apply button, never on a change.
const EXEMPT: Record<string, string> = { profitability: "fetches on Apply, not on change" };

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function wiringProblems(name: string, src: string): string[] {
  const out: string[] = [];
  const code = stripComments(src);
  const calls = Array.from(code.matchAll(/useSettledDateRange\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*|"")/g));
  if (calls.length === 0) return [`${name}: has a date input but no useSettledDateRange`];
  for (const m of calls) {
    for (const id of [m[1], m[2]]) {
      if (id === '""') continue;
      const allowed = new RegExp(
        [
          `const \\[${id}, set\\w+\\] = useState`,
          `value=\\{${id}\\}`,
          `input(From|To)=\\{${id}\\}`,
          `useSettledDateRange\\(\\s*${id}\\b`,
          `useSettledDateRange\\(\\s*[\\w$]+\\s*,\\s*${id}\\b`,
        ].join("|"),
        "g"
      );
      const rest = code.replace(allowed, "");
      // A quoted "endAfter" is a query-param NAME, not a read of the state.
      const read = new RegExp(`(?<![\\w$"'])${id}(?![\\w$"'])`);
      const leaks = rest.split("\n").filter((l) => read.test(l));
      for (const l of leaks) out.push(`${name}: reads the raw input "${id}" outside the input: ${l.trim()}`);
    }
  }
  // Every date input hands its element to the hook, or a half-typed field
  // reads as a deliberately emptied one.
  const inputs = (code.match(/type="date"/g) || []).length;
  const refs = (code.match(/type="date"\s+ref=\{[\w$]+\.(from|to)Ref\}/g) || []).length;
  if (refs !== inputs) out.push(`${name}: ${inputs} date input(s) but ${refs} carry the hook's fromRef/toRef`);
  // PRESENCE, not use: the request guard is there and consulted.
  if (!/useLatestRequest\(\)/.test(code)) out.push(`${name}: no useLatestRequest`);
  if (!/signal: req\.signal/.test(code)) out.push(`${name}: the fetch is not given the request's abort signal`);
  if ((code.match(/req\.isCurrent\(\)/g) || []).length < 3)
    out.push(`${name}: fewer than three isCurrent() checks (after the response, in catch, before clearing loading)`);
  return out;
}

function checkWiring(): void {
  const found = readdirSync(OPS_DIR).filter((d) => existsSync(join(OPS_DIR, d, "page.tsx")));
  const dated = found.filter((d) => /type="date"/.test(readFileSync(join(OPS_DIR, d, "page.tsx"), "utf8")));
  for (const p of EXPECTED_PAGES) assert(dated.includes(p), `expected ${p} to have a date input — did the page move?`);
  const problems: string[] = [];
  for (const d of dated) {
    if (EXEMPT[d]) continue;
    problems.push(...wiringProblems(d, readFileSync(join(OPS_DIR, d, "page.tsx"), "utf8")));
  }
  // The exemption's own precondition: profitability really does not refetch on change.
  const prof = stripComments(readFileSync(join(OPS_DIR, "profitability/page.tsx"), "utf8"));
  assert(!/\[[^\]]*\b(fromDate|toDate)\b[^\]]*\]\s*\)/.test(prof), "profitability now refetches on a date change — it needs the settled range too");
  assert(problems.length === 0, problems.join("\n"));
}

/* ─── Runner ─── */
async function runAll(impl: Impl): Promise<void> {
  checkPredicates(impl);
  checkSettling(impl);
  await checkLatestRequest(impl);
}

// Deliberately broken copies of createRangeSettler, one fault each.
function brokenSettler(
  opts: Parameters<typeof createRangeSettler>[0],
  fault: { keepPrev?: boolean; cancel?: boolean; reportInvalid?: boolean }
): ReturnType<typeof createRangeSettler> {
  const decide = opts.decide ?? settleAction;
  let prev = { ...opts.initial };
  let cancel: (() => void) | null = null;
  const clear = () => {
    cancel?.();
    cancel = null;
  };
  return {
    update(from: string, to: string, partial: boolean) {
      if (fault.cancel !== false) clear();
      const action = decide(prev, from, to, opts.requireBoth, partial);
      if (fault.keepPrev !== false) prev = { from, to };
      if (action === "hold") {
        if (fault.reportInvalid !== false) cancel = opts.schedule(() => opts.onInvalid(true), opts.delayMs * 2);
        return;
      }
      opts.onInvalid(false);
      if (action === "apply") {
        opts.onApply({ from, to });
        return;
      }
      cancel = opts.schedule(() => opts.onApply({ from, to }), opts.delayMs);
    },
    dispose: clear,
  };
}

async function selfTest(): Promise<void> {
  const mutants: [string, Partial<Impl>][] = [
    ["no year floor", { isCompleteDate: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s }],
    ["no calendar round-trip", { isCompleteDate: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2100 }],
    ["no reversal check", { isUsableRange: (f, t, rb) => (!rb || (f !== "" && t !== "")) && (f === "" || isCompleteDate(f)) && (t === "" || isCompleteDate(t)) }],
    ["requireBoth ignored", { isUsableRange: (f, t) => isUsableRange(f, t) }],
    ["never debounces", { settleAction: (p, f, t, rb) => (isUsableRange(f, t, rb) ? "apply" : "hold") }],
    ["debounces presets", { settleAction: (p, f, t, rb) => (isUsableRange(f, t, rb) ? "debounce" : "hold") }],
    ["never holds", { settleAction: (p, f, t) => (p.from !== f && p.to !== t ? "apply" : "debounce") }],
    ["ignores badInput", { settleAction: (p, f, t, rb) => settleAction(p, f, t, rb, false) }],
    ["settler forgets previous values", { createRangeSettler: (o) => brokenSettler(o, { keepPrev: false }) }],
    ["settler does not cancel the pending timer", { createRangeSettler: (o) => brokenSettler(o, { cancel: false }) }],
    ["settler never reports invalid", { createRangeSettler: (o) => brokenSettler(o, { reportInvalid: false }) }],
    ["begin() does not abort", {
      createLatestRequest: () => {
        let seq = 0;
        return {
          begin() { const c = new AbortController(); const mine = ++seq; return { signal: c.signal, isCurrent: () => mine === seq && !c.signal.aborted }; },
          abort() {},
        };
      },
    }],
    ["isCurrent always true", {
      createLatestRequest: () => ({
        begin() { const c = new AbortController(); return { signal: c.signal, isCurrent: () => true }; },
        abort() {},
      }),
    }],
  ];
  const survived: string[] = [];
  for (const [name, patch] of mutants) {
    try {
      await runAll({ ...REAL, ...patch });
      survived.push(name);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }
  const page = readFileSync(join(OPS_DIR, "commissioned-cus/page.tsx"), "utf8");
  const leaky = page.replace("const isFiltered = applied.from || applied.to;", "const isFiltered = dateFrom || dateTo;");
  if (leaky === page) survived.push("wiring fixture did not apply (anchor moved)");
  else if (wiringProblems("mutant", leaky).length === 0) survived.push("a memo reading raw dateFrom");
  const bare = page.replace(/useSettledDateRange\(/g, "useSomethingElse(");
  if (wiringProblems("mutant", bare).length === 0) survived.push("a date page with no settled range");
  const refless = page.replace("ref={applied.toRef}", "");
  if (refless === page) survived.push("ref fixture did not apply (anchor moved)");
  else if (wiringProblems("mutant", refless).length === 0) survived.push("a date input without its ref");
  if (survived.length) {
    console.error(`SELF-TEST FAILED — these mutants survived: ${survived.join("; ")}`);
    process.exit(1);
  }
  console.log(`self-test: all ${mutants.length + 3} mutants killed`);
}

(async () => {
  try {
    if (process.argv.includes("--self-test")) await selfTest();
    await runAll(REAL);
    checkWiring();
    console.log("verify-ops-date-inputs: all checks pass");
  } catch (e) {
    if (e instanceof Fail) {
      console.error(`FAIL: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
})();
