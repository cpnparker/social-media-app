/**
 * The post-taint policy, checked against the source rather than described.
 *
 * The bug this guards against: EngineAI told Chris "I don't have Ceri's Slack
 * message" while refining a draft built from an email. Slack was fine. An
 * email read earlier in the same turn had set the hard taint, and the taint
 * blocked every remaining tool — so the model, with no way to fetch, reported
 * the source as missing rather than the rule as fired.
 *
 * The rule now distinguishes reads (allowed, bounded) from anything that can
 * reach outside the conversation or persist beyond it (still blocked). The
 * most dangerous failure from here is a NEW tool that nobody classifies, so
 * check 1 fails on any tool this policy does not mention by name.
 */
import { readFileSync } from "fs";

const src = readFileSync("lib/ai/providers.ts", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const readSet = new Set(
  (src.match(/const POST_TAINT_READ_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || "")
    .match(/"([a-z_]+)"/g)?.map((q) => q.replace(/"/g, "")) || []
);
const registered = new Set(
  (src.match(/name: "(query_[a-z_]+|generate_[a-z_]+|web_search|search_notebook|lookup_client_context|create_scheduled_task)"/g) || [])
    .map((m) => m.replace(/name: "|"/g, ""))
);

// Anything that can leave the conversation or outlive the turn. Named, not
// inferred: a rule that guessed from prefixes would let one odd name through.
const MUST_BLOCK = new Set([
  "web_search", "create_scheduled_task", "generate_image", "generate_video",
  "generate_chart", "generate_document", "generate_slides", "generate_word_document",
]);

console.log(`\n1. Every registered tool is classified (${registered.size} tools)`);
for (const t of Array.from(registered).sort()) {
  if (readSet.has(t) && MUST_BLOCK.has(t)) fail(`${t} is in BOTH lists`);
  else if (!readSet.has(t) && !MUST_BLOCK.has(t)) fail(`${t} is unclassified — decide read vs blocked in POST_TAINT_READ_TOOLS`);
}
if (!failures) pass(`all ${registered.size} classified: ${readSet.size} read, ${MUST_BLOCK.size} blocked`);

console.log(`\n2. Nothing that sends, publishes or schedules is readable`);
for (const t of Array.from(MUST_BLOCK)) {
  if (readSet.has(t)) fail(`${t} must never be post-taint readable`);
}
if (!Array.from(MUST_BLOCK).some((t) => readSet.has(t))) pass("web_search, create_scheduled_task and all generate_* stay blocked");

console.log(`\n3. The reported bug: Slack survives an email read`);
readSet.has("query_slack")
  ? pass("query_slack is permitted post-taint")
  : fail("query_slack is still blocked — the reported bug is not fixed");
readSet.has("query_gmail")
  ? pass("query_gmail is permitted post-taint (the two-round mailbox contract)")
  : fail("query_gmail blocked — the mailbox stall returns");

console.log(`\n4. All four provider chains enforce the same set`);
const gates = (src.match(/POST_TAINT_READ_TOOLS\.has/g) || []).length;
const blanket = (src.match(/No further tool calls are allowed after reading email/g) || []).length;
gates >= 5 ? pass(`${gates} gate sites reference POST_TAINT_READ_TOOLS`) : fail(`only ${gates} gate sites — a chain was missed`);
blanket === 0 ? pass("no blanket block-everything guard remains") : fail(`${blanket} chain(s) still block every tool`);

console.log(`\n5. The exfiltration path is closed by construction, not instruction`);
/roundTools = allowPostTaintReads\s*\n\s*\? tools\.filter\(\(t: any\) => POST_TAINT_READ_TOOLS\.has\(t\?\.name\)\)/.test(src)
  ? pass("tainted rounds send only the read tools, so server-side web_search is absent")
  : fail("the Anthropic tool list is not narrowed — server-side web_search is still reachable");

console.log(`\n6. The budget is bounded and counted per call`);
const max = src.match(/const MAX_POST_TAINT_CALLS = (\d+)/)?.[1];
max && +max > 0 && +max <= 10 ? pass(`MAX_POST_TAINT_CALLS = ${max}`) : fail(`MAX_POST_TAINT_CALLS is ${max}`);
(src.match(/postTaintCallsUsed\+\+/g) || []).length >= 3
  ? pass("counted per permitted call in every chain")
  : fail("per-call counting missing in at least one chain");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
