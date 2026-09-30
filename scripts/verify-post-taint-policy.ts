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
  // Reads nothing of the user's and writes nothing — but it makes an OUTBOUND
  // REQUEST to an address that arrives as a model argument, which is the shape
  // web_search is blocked for. inline-audit.ts already refuses any address the
  // user did not type and fetches the human's own string rather than the
  // model's, so the exfiltration path is closed by construction. This is the
  // second layer, and the point of a second layer is that it does not depend on
  // the first one's reasoning being right.
  "query_page_audit",
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
const narrows =
  /roundTools = allowPostTaintReads\s*\n\s*\? tools\.filter\(\(t: any\) => POST_TAINT_READ_TOOLS\.has\(t\?\.name\)\)/.test(src);
// AND that the narrowed list is the one that goes to the API. This check used
// to stop at the line above, which asserted only that the filter had been
// WRITTEN. It had — and its result was then dropped on the floor: the request
// two lines below passed the unfiltered `tools`, so every tainted round went
// out with the full set, server-side web_search included, while this script
// reported the path closed. An enforcement point that nothing reads is a
// comment, and a check that cannot tell the difference is worse than none.
//
// Read through ONE LEVEL OF INDIRECTION since the E1 prompt-cache change: both
// request sites now take their tools from an anthropicCacheLayout result, and
// that function calls cacheableTools on whatever array it is handed. So the
// question "is the narrowed list the one sent" is now "which array was each
// layout built FROM". Followed rather than re-pointed at a new string: a check
// rewritten to match whatever the code says next is not a check.

/** The balanced `{...}` starting at the first `{` at or after `from`. */
function bodyAt(text: string, from: number): string {
  if (from < 0) return "";
  const open = text.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return "";
}

/** One object field's expression, read by balancing brackets. */
function field(body: string, name: string): string {
  const idx = body.indexOf(name + ":");
  if (idx < 0) return "";
  let depth = 0;
  let out = "";
  for (let i = idx + name.length + 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") { if (depth === 0) break; depth--; }
    else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

const requestSites: number[] = [];
{
  const re = /anthropic\.messages\.stream\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) requestSites.push(m.index);
}
/** For each Anthropic request, the array its tool list was ultimately built from. */
const sentFrom: string[] = [];
for (let i = 0; i < requestSites.length; i++) {
  const toolsExpr = field(bodyAt(src, requestSites[i]), "tools");
  const viaLayout = /^([A-Za-z0-9_$]+)\.tools$/.exec(toolsExpr);
  if (!viaLayout) {
    // Still allowed: a site that calls cacheableTools directly, the way this
    // read before E1. Recorded as-is so the assertion below judges it.
    const direct = /^cacheableTools\(([A-Za-z0-9_$]+)\)$/.exec(toolsExpr);
    sentFrom.push(direct ? direct[1] : toolsExpr || "?");
    continue;
  }
  const declRe = new RegExp("const\\s+" + viaLayout[1] + "\\s*=\\s*anthropicCacheLayout\\(", "g");
  let d: RegExpExecArray | null;
  let declAt = -1;
  while ((d = declRe.exec(src)) !== null) { if (d.index < requestSites[i]) declAt = d.index; }
  sentFrom.push(declAt < 0 ? `${viaLayout[1]} (undeclared)` : field(bodyAt(src, declAt), "tools") || "?");
}
const sends = requestSites.length === 2
  && sentFrom.indexOf("roundTools") >= 0
  && sentFrom.indexOf("finalTools") >= 0;
// The unfiltered array must not reach the API by any route — neither straight
// into cacheableTools nor through a layout built from it.
const stillSendsAll = /cacheableTools\(tools\)/.test(src) || sentFrom.indexOf("tools") >= 0;
narrows && sends && !stillSendsAll
  ? pass(`the narrowed list is the one sent (${sentFrom.join(", ")}) — server-side web_search is absent, not merely filtered`)
  : fail(
      !narrows ? "the Anthropic tool list is not narrowed"
      : !sends ? `roundTools/finalTools never reach the API — the requests send [${sentFrom.join(", ")}], so the narrowing is dead code`
      : "a call still passes the unfiltered tool list"
    );

console.log(`\n6. The budget is bounded and counted per call`);
const max = src.match(/const MAX_POST_TAINT_CALLS = (\d+)/)?.[1];
max && +max > 0 && +max <= 10 ? pass(`MAX_POST_TAINT_CALLS = ${max}`) : fail(`MAX_POST_TAINT_CALLS is ${max}`);
(src.match(/postTaintCallsUsed\+\+/g) || []).length >= 3
  ? pass("counted per permitted call in every chain")
  : fail("per-call counting missing in at least one chain");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
