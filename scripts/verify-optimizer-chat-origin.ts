/**
 * A piece born from a chat answer must not carry the conversation's privacy
 * away with it.
 * Run with `npx tsx scripts/verify-optimizer-chat-origin.ts --self-test`.
 *
 * WHY THIS IS THE CROSSING THAT NEEDS A CHECK. Everywhere else in the studio,
 * content arrives from a file, a URL or a paste — containers with no privacy of
 * their own. A conversation has plenty: it can be incognito (deliberately
 * unstored), private to one person, shared read-only, or carrying material from
 * connectors whose processor contract restricts it to a single vendor. "Start a
 * piece from this answer" copies text OUT of that container and into one the
 * owner can flip to team-visible at any moment.
 *
 * The design review's finding, which changed the build: the obvious
 * implementation sends the rendered answer up with the request, and is
 * indefensible — the browser would supply the content, the provenance AND the
 * privacy decision, so a crafted POST could mint a piece containing anything,
 * attributed to a conversation it never came from, with the private-source flag
 * conveniently unset. So the client sends two ids and the server does the rest.
 *
 * These assertions are therefore about WHO DECIDES, not about whether a line
 * exists. A route that imports checkConversationAccess and never calls it looks
 * identical to one that does, under grep — the trap this repo has already
 * shipped a security hole through once.
 *
 * MUTATION LOG.
 *  - KILLED: deleting the incognito refusal trips check 2.
 *  - KILLED: reading body.content on the chat path trips check 1.
 *  - KILLED: setting flag_private_source to a constant 0 trips check 3.
 *  - KILLED: removing the visibility refusal trips check 4.
 *  - SURVIVED, and worth stating: these read SOURCE, so they prove the guards
 *    are written and ordered, not that they behave correctly against a live
 *    database. Behavioural proof needs a seeded conversation and Postgres
 *    credentials, which this machine does not have — the gap is real and named
 *    rather than papered over with an assertion that only looks behavioural.
 */
import * as fs from "fs";
import * as path from "path";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);
const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Source with comments stripped — a detector must read code, not prose about code. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The chat branch only: from its opening to the end of its block. */
export function chatBranch(src: string): string {
  const i = src.indexOf('if (source === "chat")');
  if (i < 0) return "";
  let depth = 0;
  let j = src.indexOf("{", i);
  const start = j;
  while (j < src.length) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
    j++;
  }
  return src.slice(start, j + 1);
}

const importSrc = stripComments(read("app/api/optimizer/import/route.ts"));
const branch = chatBranch(importSrc);

console.log("\n1. The server lifts the text; the browser never supplies it");
{
  branch
    ? pass("the chat branch exists")
    : fail("no chat branch found — the rest of this file is testing nothing");

  // The single most important assertion here.
  /from\("ai_messages"\)/.test(branch)
    ? pass("the answer is read from ai_messages, server-side")
    : fail("the route does not read the message row — it must be trusting the client for the text");

  /body\.(content|text|answer)\b/.test(branch)
    ? fail("the chat branch reads body text — the browser would be supplying the content AND its provenance")
    : pass("no body-supplied text is read on the chat path");

  /document_message/.test(branch)
    ? pass("it takes document_message from the row it just read")
    : fail("the lifted text does not come from the message row");

  /role_message.*assistant|assistant.*role_message/.test(branch)
    ? pass("only an assistant message can start a piece")
    : fail("any message role would do — 'start a piece from this answer' must mean an answer");
}

console.log("\n1b. Every source has a branch in the content chain");
{
  // THE BUG THIS EXISTS FOR, found by QA in a real browser: the chain that
  // acquires content ends in a bare `else` meaning "from the Engine pipeline".
  // A source with no branch therefore does not fall through harmlessly — it
  // falls into a DIFFERENT importer and fails with that importer's error.
  // "Start a piece" returned "Which piece?", which is the Engine branch asking
  // for a content id. A missing branch is invisible to a typechecker and to
  // every assertion about the chat branch itself.
  const chainStart = importSrc.indexOf('if (source === "pasted")');
  const head = chainStart >= 0 ? importSrc.slice(0, chainStart) : "";
  const chain = chainStart >= 0 ? importSrc.slice(chainStart) : "";
  const branchesFor = (src: string) => {
    const out: string[] = [];
    const re = /source === "([a-z-]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  };
  const allowed = (() => {
    const m = importSrc.match(/\[([^\]]*)\]\.indexOf\(source\)/);
    return m ? m[1].split(",").map((v) => v.trim().replace(/"/g, "")) : [];
  })();
  const covered = branchesFor(chain).concat(branchesFor(head));
  const orphans = allowed.filter((v) => covered.indexOf(v) < 0);
  chainStart >= 0
    ? pass("the content chain was found")
    : fail("could not locate the content chain — this check is testing nothing");
  // Exactly ONE source may be uncovered: the one the terminal `else` is FOR.
  // That is "engine", and naming it here is the point — it turns "the last
  // branch catches whatever is left" into "the last branch is the Engine
  // importer, and nothing else may land in it". Any second orphan is a source
  // that will fail with a stranger's error message.
  const TERMINAL = "engine";
  const unexpected = orphans.filter((v) => v !== TERMINAL);
  unexpected.length === 0
    ? pass(`every accepted source has a branch, or is the terminal else (${allowed.length} checked)`)
    : fail(`${unexpected.join(", ")} would fall into the chain's final else — the Engine importer — and fail with its error`);
  orphans.indexOf(TERMINAL) >= 0
    ? pass(`the terminal else is still the ${TERMINAL} importer`)
    : fail(`${TERMINAL} gained its own branch — the terminal else now catches something unnamed`);
}

console.log("\n2. Access, workspace and incognito are decided here");
{
  const gate = branch.indexOf("checkConversationAccess(");
  const lift = branch.indexOf('from("ai_messages")');
  gate >= 0
    ? pass("checkConversationAccess is CALLED, not merely imported")
    : fail("the route never checks conversation access");
  gate >= 0 && lift >= 0 && gate < lift
    ? pass("access is checked BEFORE the text is read")
    : fail("the text is read before access is checked — a refusal would come after the data was already in hand");

  /permission === "view"/.test(branch)
    ? pass("a view-only recipient is refused")
    : fail("a read-only share recipient could create workspace content from someone else's thread");

  /flag_incognito/.test(branch)
    ? pass("incognito conversations are refused")
    : fail("an incognito thread could be copied into a stored document — the one promise incognito makes");

  /id_workspace.*caller\.workspaceId|caller\.workspaceId.*id_workspace/.test(branch)
    ? pass("cross-workspace conversations are refused")
    : fail("no workspace isolation on the conversation lookup");
}

console.log("\n3. The privacy floor is set, and set in the safe direction");
{
  /chatPrivateSource\s*=\s*\(conv as any\)\.type_visibility !== "team"/.test(branch)
    ? pass("anything not positively confirmed as a team thread is treated as private")
    : fail("the floor is not derived defensively — a new visibility value would default to shareable");

  /flag_private_source:\s*chatPrivateSource \? 1 : 0/.test(importSrc)
    ? pass("the flag reaches the insert")
    : fail("flag_private_source is computed and never stored");

  // A constant would pass a grep for the column name; this catches that.
  /flag_private_source:\s*0\s*,/.test(importSrc) && !/chatPrivateSource/.test(importSrc)
    ? fail("flag_private_source is hardcoded — every piece would read as shareable")
    : pass("the flag is derived, not constant");
}

console.log("\n4. The floor is enforced, not merely recorded");
{
  const sessionSrc = stripComments(read("app/api/optimizer/sessions/[id]/route.ts"));
  /body\.visibility === "team" && \(owned\.session as any\)\.flag_private_source/.test(sessionSrc)
    ? pass("the PATCH route refuses private-source → team")
    : fail("a piece born in a private thread could be flipped to team — hiding the control is not a guard");

  const visIdx = sessionSrc.indexOf("body.visibility");
  const floorIdx = sessionSrc.indexOf("flag_private_source");
  const assignIdx = sessionSrc.indexOf("patch.type_visibility =");
  floorIdx >= 0 && assignIdx >= 0 && floorIdx < assignIdx
    ? pass("the refusal precedes the assignment")
    : fail("the visibility is assigned before the floor is checked");
}

console.log("\n5. The allowlist and the deployed CHECK agree");
{
  // Three copies of this constraint exist in 20260821; the NEWEST definition is
  // the one the database ends up with, so that is the one to agree with.
  const mig = read("supabase/migrations/20260825_writing_studio_chat_origin.sql");
  const m = mig.match(/type_source IN \(([^)]*)\)/);
  const migValues = m ? m[1].split(",").map((v) => v.trim().replace(/'/g, "")).sort() : [];
  const r = importSrc.match(/\[([^\]]*)\]\.indexOf\(source\)/);
  const routeValues = r ? r[1].split(",").map((v) => v.trim().replace(/"/g, "")).sort() : [];

  migValues.length > 0 && routeValues.length > 0
    ? pass(`both lists found (${routeValues.length} values)`)
    : fail("could not read one of the two lists — this check is testing nothing");

  // The route's list omits 'generated' by design: that source is set by the
  // create route, never imported.
  const missing = routeValues.filter((v) => migValues.indexOf(v) < 0);
  missing.length === 0
    ? pass("every source the route accepts is permitted by the CHECK")
    : fail(`the route accepts ${missing.join(", ")} which the CHECK would reject with 23514`);

  migValues.indexOf("chat") >= 0 && routeValues.indexOf("chat") >= 0
    ? pass("'chat' is in both")
    : fail("'chat' is missing from the CHECK or the route allowlist");
}

// ── Self-test ──────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n6. Self-test — the detectors fire on the shapes they exist for");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    caught ? console.log(`  ok    catches ${name}`) : (selfFails++, console.log(`  BROKEN  misses ${name}`));
  };

  detects("a branch that trusts body text", /body\.(content|text|answer)\b/.test('const t = body.content;'));
  detects("a derived flag is NOT read as trusting body", !/body\.(content|text|answer)\b/.test('const t = msg.document_message;'));
  detects("access checked after the lift", (() => {
    const bad = 'from("ai_messages") ... checkConversationAccess(';
    return bad.indexOf("checkConversationAccess(") > bad.indexOf('from("ai_messages")');
  })());
  detects("a hardcoded privacy flag", (() => {
    const bad = "flag_private_source: 0,";
    return /flag_private_source:\s*0\s*,/.test(bad) && !/chatPrivateSource/.test(bad);
  })());
  detects("the branch extractor finds a balanced block", (() => {
    const src = 'if (source === "chat") { const a = { b: 1 }; }\nconst after = 2;';
    const b = chatBranch(src);
    return b.indexOf("const a") > 0 && b.indexOf("after") < 0;
  })());
  detects("a source with no branch in the chain", (() => {
    const allowed = ["pasted", "chat"];
    const chain = 'if (source === "pasted") {} else { engine }';
    const covered: string[] = [];
    const re = /source === "([a-z-]+)"/g; let m: RegExpExecArray | null;
    while ((m = re.exec(chain)) !== null) covered.push(m[1]);
    return allowed.filter((v) => covered.indexOf(v) < 0).length === 1;
  })());
  detects("a route/CHECK mismatch", (() => {
    const mig = ["a", "b"].sort();
    const route = ["a", "b", "chat"].sort();
    return route.filter((v) => mig.indexOf(v) < 0).length === 1;
  })());

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
