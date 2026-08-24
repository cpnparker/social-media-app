/**
 * One tool loop, shared by all four provider chains.
 * Run with `npx tsx scripts/verify-tool-loop-guard.ts --self-test`.
 *
 * WHY THIS EXISTS. Until 2026-08-24 there were three implementations: the
 * factory in lib/ai/tool-loop-guard.ts, used by Gemini and OpenAI, and two
 * hand-copied inline loops in streamAnthropic and streamXAIChatCompletions.
 * The module's own docstring promised the four "cannot drift on wording again"
 * because they shared the refusal text — and they drifted on NUMBERS instead:
 * the inline copies carried query_gmail 8, query_slack 8, query_calendar 6 and
 * query_microsoft 6, and the shared table carried none of them. Gmail, calendar
 * and Microsoft are Claude-only so they never registered on the divergent
 * chains, but query_slack is not, and it ran there on a third of its intended
 * budget with nothing to show for it.
 *
 * Sharing constants was not enough. They now share the LOOP.
 *
 * The two inline copies existed for one reason the factory could not serve: a
 * retryable failure has to un-record the call signature, or an honest identical
 * retry is refused as a spiral. That is release(), and it is asserted here.
 *
 * usage() is what makes a flagged answer reviewable: names and counts, never
 * arguments and never results, so the record stays free of third-party text.
 */
import { readFileSync } from "fs";
import {
  createToolLoopGuard,
  toolBudgetFor,
  repeatedCallNotice,
  overBudgetNotice,
} from "../lib/ai/tool-loop-guard";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. The budgets every chain now sees");
const EXPECTED: [string, number][] = [
  ["query_xero", 8], ["query_engine", 8], ["query_resourcing", 8],
  ["query_gmail", 8], ["query_slack", 8],
  ["query_meetingbrain", 6], ["query_drive_docs", 6], ["search_notebook", 6],
  ["query_calendar", 6], ["query_microsoft", 6],
  ["generate_image", 3], ["a_tool_that_does_not_exist", 3],
];
for (let i = 0; i < EXPECTED.length; i++) {
  const [name, want] = EXPECTED[i];
  const got = toolBudgetFor(name);
  got === want ? pass(`${name} → ${got}`) : fail(`${name} → ${got}, expected ${want}`);
}

console.log("\n2. The same call twice is refused, and says why");
{
  const g = createToolLoopGuard();
  g.blockFor("query_engine", { report: "contracts_summary" }) === null
    ? pass("first call runs")
    : fail("first call was refused");
  const second = g.blockFor("query_engine", { report: "contracts_summary" });
  second === repeatedCallNotice("query_engine")
    ? pass("identical second call gets the repeated-call notice")
    : fail(`identical second call returned ${String(second).slice(0, 60)}`);
}

console.log("\n3. Different arguments run until the budget is spent");
{
  const g = createToolLoopGuard();
  const budget = toolBudgetFor("query_meetingbrain"); // 6
  let allowed = 0;
  for (let i = 0; i < budget; i++) if (g.blockFor("query_meetingbrain", { q: `q${i}` }) === null) allowed++;
  allowed === budget ? pass(`${budget} distinct calls all ran`) : fail(`only ${allowed} of ${budget} ran`);
  const over = g.blockFor("query_meetingbrain", { q: "one too many" });
  over === overBudgetNotice("query_meetingbrain")
    ? pass("the next one gets the over-budget notice")
    : fail(`over-budget call returned ${String(over).slice(0, 60)}`);
}

console.log("\n4. A repeat is reported as a repeat even when over budget");
// Precedence matters: both inline copies checked the signature FIRST, so a
// duplicate past the budget said "you already called this" rather than "too
// many calls". Telling the model the wrong thing sends it down the wrong path.
{
  const g = createToolLoopGuard();
  for (let i = 0; i < toolBudgetFor("search_notebook"); i++) g.blockFor("search_notebook", { q: `q${i}` });
  const dup = g.blockFor("search_notebook", { q: "q0" });
  dup === repeatedCallNotice("search_notebook")
    ? pass("duplicate wins over budget, as both inline copies did")
    : fail("an over-budget duplicate reported the budget message instead");
}

console.log("\n5. release() — the reason the inline copies existed");
{
  const g = createToolLoopGuard();
  const args = { prompt: "a cat" };
  g.blockFor("generate_image", args);
  const beforeRelease = g.blockFor("generate_image", args);
  beforeRelease !== null ? pass("without release, an identical retry is refused") : fail("a duplicate slipped through");
  g.release("generate_image", args);
  g.blockFor("generate_image", args) === null
    ? pass("after release, an honest retry of a FAILED call runs")
    : fail("release did not permit the retry — image failures would tell the model to give up");
}

console.log("\n6. release() does NOT refund the call count");
// A tool failing over and over must still exhaust its budget, or a broken tool
// becomes an infinite loop with extra steps.
{
  const g = createToolLoopGuard();
  const budget = toolBudgetFor("generate_image"); // 3
  for (let i = 0; i < budget + 2; i++) {
    g.blockFor("generate_image", { prompt: "same" });
    g.release("generate_image", { prompt: "same" });
  }
  const after = g.blockFor("generate_image", { prompt: "same" });
  after === overBudgetNotice("generate_image")
    ? pass("repeated failures still run out of budget")
    : fail("release refunded the count — a failing tool could retry for ever");
}

console.log("\n7. usage() — names and counts, never arguments or results");
{
  const g = createToolLoopGuard();
  g.blockFor("query_engine", { report: "a" });
  g.blockFor("query_engine", { report: "b" });
  g.blockFor("query_engine", { report: "a" });            // duplicate → blocked
  g.blockFor("query_slack", { q: "ceri" });
  const u = g.usage();
  const engine = u.filter((x) => x.name === "query_engine")[0];
  const slack = u.filter((x) => x.name === "query_slack")[0];
  u.length === 2 ? pass("two tools reported") : fail(`${u.length} tools reported, expected 2`);
  engine && engine.calls === 3 ? pass("query_engine calls=3 (attempts, including the refused one)") : fail(`query_engine calls=${engine?.calls}`);
  engine && engine.blocked === 1 ? pass("query_engine blocked=1") : fail(`query_engine blocked=${engine?.blocked}`);
  slack && slack.calls === 1 && slack.blocked === 0 ? pass("query_slack calls=1 blocked=0") : fail("query_slack miscounted");
  const serialised = JSON.stringify(u);
  serialised.indexOf("ceri") < 0 && serialised.indexOf("report") < 0
    ? pass("no arguments leak into the record")
    : fail(`usage() carries argument text: ${serialised.slice(0, 120)}`);
  // A tool never called must be ABSENT, not zero — absence is the signal that
  // answers "was a tool that could have answered simply never tried?"
  u.filter((x) => x.name === "query_calendar").length === 0
    ? pass("an uncalled tool is absent, not reported as zero")
    : fail("an uncalled tool appears in usage()");
}

console.log("\n8. No chain keeps its own copy any more");
// Absence cannot be tested behaviourally: a duplicated loop would pass every
// assertion above while quietly diverging again, which is exactly what happened.
const providers = readFileSync("lib/ai/providers.ts", "utf8");
const factories = (providers.match(/createToolLoopGuard\(\)/g) || []).length;
factories === 4
  ? pass("all four chains build a guard from the factory")
  : fail(`${factories} createToolLoopGuard() calls — expected one per chain (anthropic, xai, gemini, openai)`);
providers.indexOf("const executedToolSigs") < 0
  ? pass("no inline signature set remains")
  : fail("a chain still keeps its own executedToolSigs — the copies can drift again");
providers.indexOf("READ_ONLY_TOOL_BUDGET: Record<string, number>") < 0
  ? pass("no inline budget table remains")
  : fail("a chain still keeps its own budget table — this is exactly how query_slack ended up at 3 on two chains");
(providers.match(/toolLoopGuard\.usage\(\)/g) || []).length === 4
  ? pass("all four chains report their tool usage")
  : fail("a chain runs tools without reporting which — its answers cannot be reviewed");

// ── Self-test ───────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n9. Self-test — the detectors fire on the shapes they exist for");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    detects ${name}`);
    else { selfFails++; console.log(`  FAIL  does NOT detect ${name}`); }
  };

  // The divergence that actually happened: a chain-local table missing the
  // personal-data tools, so query_slack capped at the default.
  const localTableMissingSlack: Record<string, number> = {
    query_xero: 8, query_engine: 8, query_meetingbrain: 6, query_drive_docs: 6,
    search_notebook: 6, query_resourcing: 8,
  };
  detects("a budget table missing query_slack (the real divergence)",
    (localTableMissingSlack["query_slack"] ?? 3) !== toolBudgetFor("query_slack"));

  // A guard without release() — image retries refused after a failure.
  const g2 = createToolLoopGuard();
  g2.blockFor("generate_image", { p: 1 });
  detects("a guard that cannot release refuses an honest retry", g2.blockFor("generate_image", { p: 1 }) !== null);
  detects("the real guard exposes release()", typeof createToolLoopGuard().release === "function");
  detects("the real guard exposes usage()", typeof createToolLoopGuard().usage === "function");

  // The source assertions must be capable of failing.
  detects("the inline-copy detector would fire on a reintroduced table",
    "const READ_ONLY_TOOL_BUDGET: Record<string, number> = {".indexOf("READ_ONLY_TOOL_BUDGET: Record<string, number>") >= 0);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
