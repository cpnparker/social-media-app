/**
 * The rules that came out of one painful chat, pinned so they cannot quietly
 * be dropped by a later prompt edit.
 *
 * WHAT HAPPENED. The user pasted a congratulation note about winning a contract.
 * EngineAI ran one mailbox search, missed, and asked what to try next. Two turns
 * later it named the right query itself — the client's name alone — and asked
 * permission to run it rather than running it. In the same reply it quoted a
 * calendar event containing that client's name while stating it could not
 * confirm the client existed. The user finally supplied the sender's name from
 * memory, at which point it found the whole thread instantly: the award email,
 * the replies it had itself drafted, and the meeting already in the diary.
 *
 * Two causes, and the checks below cover both:
 *   1. STRUCTURAL — query_gmail and query_slack were not in the read-only budget
 *      table, so they fell back to 3 calls a turn. The mailbox contract costs
 *      two per answer (search returns headers, only "thread" returns bodies), so
 *      the turn had one real attempt. Asking is what the model does when it has
 *      no calls left.
 *   2. BEHAVIOURAL — nothing told it to exhaust the obvious query before
 *      reporting absence, or that evidence already in hand contradicts a null
 *      result.
 */
import { readFileSync } from "fs";

const providers = readFileSync("lib/ai/providers.ts", "utf8");
const prompt = readFileSync("lib/ai/system-prompts.ts", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. Search tools have enough calls to actually search");
const budgets = providers.match(/const READ_ONLY_TOOL_BUDGET[\s\S]*?\n  \};/g) || [];
budgets.length >= 2
  ? pass(`${budgets.length} budget tables found (one per provider chain)`)
  : fail(`only ${budgets.length} budget table(s) — a chain was missed`);
for (const [i, table] of budgets.entries()) {
  for (const tool of ["query_gmail", "query_slack"]) {
    const n = Number(new RegExp(`${tool}:\\s*(\\d+)`).exec(table)?.[1] ?? 0);
    // Two calls per mailbox answer, so anything under ~6 is one or two attempts.
    n >= 6
      ? pass(`table ${i + 1}: ${tool} = ${n}`)
      : fail(`table ${i + 1}: ${tool} = ${n || "absent (defaults to 3)"} — too few to search iteratively`);
  }
}

console.log("\n2. The prompt requires finishing the search before reporting the outcome");
const RULES: [string, RegExp][] = [
  ["try the plain noun on its own before reporting a miss", /PLAINEST FORM OF THE NOUN/],
  ["never propose a search it could just run", /Never propose a search you could simply run/i],
  ["never report absence while holding contradicting evidence", /Never report absence while holding evidence to the contrary/i],
  ["don't dress an irrelevant hit up as a result", /Do not present an irrelevant hit as a result/i],
  ["state the terms actually searched", /Say which terms you actually searched/i],
  ["treat \"did this happen\" as cross-source", /cross-source question/i],
];
for (const [label, re] of RULES) {
  re.test(prompt) ? pass(label) : fail(`prompt no longer says: ${label}`);
}

console.log("\n3. The prompt does not contradict the budget it promises");
const promised = Number(/mailbox and Slack tools allow (\w+) calls/.exec(prompt)?.[1] === "eight" ? 8 : 0);
const actual = Number(/query_gmail:\s*(\d+)/.exec(providers)?.[1] ?? 0);
promised === actual
  ? pass(`prompt says ${promised}, code allows ${actual}`)
  : fail(`prompt promises ${promised || "?"} calls but code allows ${actual} — one of them is lying to the model`);

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
