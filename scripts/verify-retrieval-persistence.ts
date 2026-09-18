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
import { toolBudgetFor } from "../lib/ai/tool-loop-guard";

const providers = readFileSync("lib/ai/providers.ts", "utf8");
const prompt = readFileSync("lib/ai/system-prompts.ts", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. Search tools have enough calls to actually search");
// ASKED OF THE FUNCTION, not of a regex over a literal.
//
// This used to count `const READ_ONLY_TOOL_BUDGET` tables in providers.ts and
// require at least two — which described the world only while the chains each
// kept their own copy. They were folded onto lib/ai/tool-loop-guard.ts on
// 2026-08-24 and the count went to zero, so the check failed on a repair.
//
// Counting copies was always the weaker question. It could not have caught the
// divergence that actually happened either: the two inline tables agreed with
// each other and BOTH disagreed with the shared one, which had none of the
// personal-data tools, so Gemini and OpenAI capped query_slack at 3. Asking
// toolBudgetFor what a chain will actually allow is the question that matters,
// and there is now exactly one answer to it.
const SEARCH_TOOLS = ["query_gmail", "query_slack", "query_meetingbrain", "query_calendar", "query_microsoft"];
for (let i = 0; i < SEARCH_TOOLS.length; i++) {
  const tool = SEARCH_TOOLS[i];
  const n = toolBudgetFor(tool);
  // Two calls per mailbox answer — search returns headers, only "thread"
  // returns bodies — so anything under 6 is one or two real attempts.
  n >= 6
    ? pass(`${tool} = ${n}`)
    : fail(`${tool} = ${n} — too few to search iteratively (the default 3 gives one attempt)`);
}
(providers.match(/createToolLoopGuard\(\)/g) || []).length === 4
  ? pass("all four chains draw that budget from the one shared loop")
  : fail("a chain is not using the shared loop — budgets can diverge again, silently");

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
// Same repair as section 1: read the budget the app enforces, not a literal in
// a file that no longer holds it. The prompt tells the model it has eight
// mailbox calls; if that promise and the guard ever disagree, one of them is
// lying and the model pays for it either by giving up early or by being cut off
// mid-search.
const promised = Number(/mailbox and Slack tools allow (\w+) calls/.exec(prompt)?.[1] === "eight" ? 8 : 0);
const actual = toolBudgetFor("query_gmail");
promised === actual
  ? pass(`prompt says ${promised}, code allows ${actual}`)
  : fail(`prompt promises ${promised || "?"} calls but code allows ${actual} — one of them is lying to the model`);

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
