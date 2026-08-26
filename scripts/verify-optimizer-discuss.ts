/**
 * Guards the Writer's Discuss panel — the conversation held beside the draft.
 *
 * Run: npx tsx scripts/verify-optimizer-discuss.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * Three things, none of which a type-checker can see:
 *
 *   THE PROMPT COSTS. The draft is attached to the current turn and stripped
 *   from history. Storing the built turn instead of the bare question would
 *   grow every later prompt by the length of the article, silently, and invite
 *   answers about versions since rewritten. Nothing about that is a type error.
 *
 *   THE INSERT BUTTON. A ```draft fence is a button in somebody's editor. If
 *   the parser treats every fence as insertable, a JSON example ends up in an
 *   article; if it treats a half-arrived fence as a block, the button flickers
 *   over a partial sentence.
 *
 *   THE SEPARATION. The Writer's rail must not grow a Score tab. That is the
 *   exact merge this ship exists to undo, and it would re-merge by someone
 *   adding one line to a tab list.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  removing `while (out[0].role !== "user")` from trimForPrompt        → check 2
 * KILLED  storing buildDiscussTurn(...) instead of `question` in the route    → check 5
 * KILLED  matching /```/ instead of /```draft/ in parseDiscussReply           → check 3
 * KILLED  escaping AFTER paragraphing in draftBlockToHtml                     → check 4
 * KILLED  adding {key:"score"} to the writer's tab list                       → check 7
 * KILLED  restoring `fetch(body.fileUrl)` in the sources upload branch        → check 8
 * SURVIVED  deleting the `.trim()` in buildDiscussTurn's question — the model
 *           is unaffected by trailing whitespace on a question, and no
 *           assertion depends on it. Recorded rather than tidied away: it is a
 *           finding about the check, not an omission.
 */
import {
  trimForPrompt,
  trimForStorage,
  parseDiscussReply,
  draftBlockToHtml,
  buildDiscussSystem,
  buildDiscussTurn,
  readTurns,
  DISCUSS_PROMPT_TURNS,
  DISCUSS_STORED_TURNS,
  type DiscussTurn,
} from "../lib/optimizer/discuss";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);
const assert = (ok: boolean, msg: string) => (ok ? pass(msg) : fail(msg));

/** Comments are prose about code, not code. A detector that reads them reports
 *  a rule as present because somebody described it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * ONE function's body, bounded at the next top-level export.
 *
 * Slicing to the end of the file instead is how check 6 first reported a
 * failure: DELETE is declared above POST, so "does DELETE touch the draft?"
 * was reading POST's code. A detector whose window is wrong is not a stricter
 * detector, it is a detector answering a different question.
 */
function functionBody(src: string, name: string): string {
  const head = src.indexOf(`export async function ${name}(`);
  if (head < 0) return "";
  const next = src.indexOf("\nexport ", head + 1);
  return next < 0 ? src.slice(head) : src.slice(head, next);
}

/** The region that WRITES the conversation back, not the one that builds the
 *  prompt. Both mention a user turn; only one of them persists it. */
function storageRegion(src: string): string {
  const at = src.indexOf("trimForStorage(");
  if (at < 0) return "";
  const end = src.indexOf(".eq(\"id_session\"", at);
  return end < 0 ? src.slice(at) : src.slice(at, end);
}

const turn = (role: "user" | "assistant", content: string): DiscussTurn => ({ role, content, at: "" });

// ── 1. Storage keeps the tail, and is bounded ──────────────────────────────
console.log("\n1. History bounds");
{
  const many: DiscussTurn[] = [];
  for (let i = 0; i < DISCUSS_STORED_TURNS + 10; i++) many.push(turn(i % 2 ? "assistant" : "user", `m${i}`));
  const stored = trimForStorage(many);
  assert(stored.length === DISCUSS_STORED_TURNS, `storage capped at ${DISCUSS_STORED_TURNS}`);
  assert(
    stored[stored.length - 1].content === many[many.length - 1].content,
    "the newest exchange survives — trimming from the front would drop what they are reading"
  );
  assert(trimForPrompt(many).length <= DISCUSS_PROMPT_TURNS, `prompt window capped at ${DISCUSS_PROMPT_TURNS}`);
}

// ── 2. The prompt never opens on an assistant turn ─────────────────────────
//
// A naive tail slice produces one half the time, and every provider this app
// routes to rejects or mishandles it. The failure is a 400 at a random point in
// a working conversation, which reads as "the assistant is broken".
console.log("\n2. Prompt shape");
{
  let bad = 0;
  for (let n = 1; n <= DISCUSS_PROMPT_TURNS + 6; n++) {
    const conv: DiscussTurn[] = [];
    for (let i = 0; i < n; i++) conv.push(turn(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    const out = trimForPrompt(conv);
    if (out.length > 0 && out[0].role !== "user") bad++;
  }
  assert(bad === 0, "no conversation length produces a prompt starting on an assistant turn");
  assert(trimForPrompt([turn("assistant", "orphan")]).length === 0, "a lone assistant turn yields nothing, not a bad array");
  assert(readTurns([{ role: "nonsense" }, null, { role: "user", content: "" }, { role: "user", content: "ok" }]).length === 1,
    "a malformed jsonb row degrades to the usable turns rather than throwing");
}

// ── 3. Only ```draft is insertable ─────────────────────────────────────────
console.log("\n3. Parsing what is offered for the piece");
{
  const a = parseDiscussReply("Try this:\n```draft\nA sharper opening.\n```\nIt is shorter.");
  assert(a.drafts.length === 1 && a.drafts[0] === "A sharper opening.", "a closed draft fence is extracted");
  assert(a.commentary.indexOf("A sharper opening") < 0, "the block does not also remain in the prose");
  assert(a.commentary.indexOf("It is shorter") >= 0, "prose after the block survives");

  const b = parseDiscussReply('Here is the shape:\n```json\n{"a":1}\n```\nUse that.');
  assert(b.drafts.length === 0, "a ```json example is NOT offered for the article");

  const c = parseDiscussReply("Working on it:\n```draft\nHalf a sen");
  assert(c.drafts.length === 0, "an UNCLOSED fence yields no block — that is every reply mid-stream");

  const d = parseDiscussReply("```draft\nOne.\n```\nand\n```draft\nTwo.\n```");
  assert(d.drafts.length === 2 && d.drafts[1] === "Two.", "two blocks both survive, in order");

  const e = parseDiscussReply("Just commentary, no fence.");
  assert(e.drafts.length === 0 && e.commentary === "Just commentary, no fence.", "commentary alone offers no button");
}

// ── 4. Escaping happens BEFORE paragraphing ────────────────────────────────
console.log("\n4. Text into the editor");
{
  const html = draftBlockToHtml('Margins under <10% are thin.\n\nSo is "growth" & scale.');
  assert(html.indexOf("&lt;10%") >= 0, "an angle bracket is escaped, not treated as a tag");
  assert(html.indexOf("&amp;") >= 0, "an ampersand is escaped");
  assert((html.match(/<p>/g) || []).length === 2, "a blank line becomes a second paragraph");
  // The ordering bug: paragraph first and the <p> tags themselves get escaped,
  // so the writer gets literal "&lt;p&gt;" in their article.
  assert(html.indexOf("&lt;p&gt;") < 0, "the paragraph tags are NOT themselves escaped");
  assert(draftBlockToHtml("   ") === "", "an empty block produces nothing to insert");
}

// ── 5. The draft rides on the current turn, never in history ───────────────
//
// Asserted on the ROUTE, because this is a property of what gets STORED and no
// pure function can hold it.
console.log("\n5. The draft is not stored in the conversation");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/discuss/route.ts"));
  assert(/role:\s*"user",\s*content:\s*question/.test(src.replace(/\s+/g, " ").replace(/ /g, " ")) ||
         /content:\s*question\b/.test(src),
    "the stored user turn is the bare QUESTION");
  const stored = storageRegion(src);
  assert(stored.length > 0, "the storage region is identifiable");
  assert(!/buildDiscussTurn/.test(stored),
    "the built turn — which contains the whole draft — is NOT what gets stored");
  assert(/content:\s*question\b/.test(stored),
    "what IS stored is the bare question");
  assert(/promptTurns\.push\(\s*\{[\s\S]{0,200}buildDiscussTurn/.test(src),
    "the built turn IS what gets sent, on the current turn only");
  assert(/logAiUsage\(/.test(src), "the call is logged — an unlogged call is invisible to the spend cap");
  assert(/assertServiceAllowed\(/.test(src), "the spend gate is applied");
  assert(src.indexOf("systemPrompt") > 0 && /buildGroundingBlock\(/.test(src),
    "grounding comes from the SHARED builder, not a second description of the client");
}

// ── 6. Clearing is reachable ───────────────────────────────────────────────
//
// It shipped as `if (body.clear === true)` BELOW the "ask a question first"
// guard, so clearing required sending a question and sending a question meant
// it was never a clear. It type-checked and read correctly.
console.log("\n6. Clearing the conversation");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/discuss/route.ts"));
  assert(/export async function DELETE\(/.test(src), "clear is its own verb, not a flag on POST");
  assert(!/body\.clear/.test(src), "no clear flag survives on POST, where it sat behind the question guard");
  // Bounded at the next export. DELETE sits ABOVE POST in this file, so a
  // slice to end-of-file reads POST's body and answers the wrong question.
  const del = functionBody(src, "DELETE");
  assert(del.length > 0 && del.indexOf("export async function POST") < 0,
    "the DELETE body is bounded — it does not run on into POST");
  assert(/config_chat:\s*\[\]/.test(del), "DELETE empties the conversation");
  assert(!/optimizer_drafts/.test(del), "DELETE does not touch the draft — it clears the talk, never the piece");
  assert(/loadSessionForCaller\(/.test(del), "DELETE checks entitlement");
}

// ── 7. The Writer's rail has no Score tab ──────────────────────────────────
//
// The merge this ship undoes. Re-merging is one line in a tab list.
console.log("\n7. The two rails stay different");
{
  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  const m = page.match(/if \(surface === "writer"\) \{([\s\S]*?)return t;/);
  assert(!!m, "the writer's tab list is identifiable");
  if (m) {
    const writerTabs = m[1];
    assert(writerTabs.indexOf('key: "score"') < 0, "the Writer's rail offers NO Score tab");
    assert(writerTabs.indexOf('key: "coverage"') < 0, "the Writer's rail offers no Coverage tab");
    assert(writerTabs.indexOf('key: "discuss"') >= 0, "the Writer's rail offers Discuss");
    assert(writerTabs.indexOf('key: "sources"') >= 0, "the Writer's rail offers Background");
  }
  assert(/key === panelTab/.test(page) && /setPanelTab\(panelTabs\[0\]\.key\)/.test(page),
    "a tab this surface does not offer is corrected, not left selected under a fallback panel");
  // USED, not merely present. This repo has closed a live hole on the strength
  // of a line existing.
  assert(/<DiscussPanel\b/.test(page), "DiscussPanel is actually rendered");
  assert(/<SourcesPanel\b/.test(page), "SourcesPanel is actually rendered");
  assert(/getDraftHtml=\{getDraftHtml\}/.test(page), "the panel is handed the LIVE draft, not the saved body");
  assert(/editorRef\.current\.getHTML\(\)/.test(page.slice(page.indexOf("const getDraftHtml"), page.indexOf("const getDraftHtml") + 400)),
    "getDraftHtml reads the editor rather than the debounced state");
  assert(/onApply=\{applyDraftText\}/.test(page), "the Apply button is wired to the editor");
}

// ── 8. Nothing fetches a caller-supplied address ───────────────────────────
//
// The sources upload branch shipped as fetch(body.fileUrl): a server-side
// request to any address a caller named, whose response was then stored.
console.log("\n8. Background material reaches out safely");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/sources/route.ts"));
  assert(!/fetch\(\s*fileUrl/.test(src) && !/body\?\.fileUrl/.test(src),
    "no unguarded fetch of a caller-supplied URL");
  assert(/expectedPrefix\s*=\s*`optimizer-uploads\/w\$\{guard\.caller\.workspaceId\}/.test(src),
    "an uploaded file must sit under the CALLER's own workspace prefix");
  assert(/startsWith\(expectedPrefix\)/.test(src) && /indexOf\("\.\."\)/.test(src),
    "the prefix is checked, and traversal refused");
  assert(/importFromUrl\(/.test(src), "the url branch goes through the shared guarded fetch");
  assert(/get\(blobPath,\s*\{\s*access:\s*"private"\s*\}\)/.test(src),
    "blob bytes are read with credentials — the store is private and a plain GET is refused");
}

// ── 9. The model is told to mark text meant for the piece ──────────────────
console.log("\n9. The instruction the button depends on");
{
  const sys = buildDiscussSystem({ title: "T", format: "article", grounding: "# Background material\nNone." });
  assert(sys.indexOf("```draft") >= 0, "the fence is named in the prompt");
  assert(/nothing else inside it/i.test(sys), "the fence is specified as containing ONLY the words for the piece");
  assert(/no fence at all/i.test(sys), "commentary-only answers are told to offer no fence");
  assert(sys.indexOf("# Background material") >= 0, "the grounding is carried into the system block");

  const t = buildDiscussTurn({ draftText: "The draft.", selection: "one line", question: "Tighter?" });
  assert(t.indexOf("The draft.") >= 0 && t.indexOf("Tighter?") >= 0, "draft and question travel together");
  assert(t.indexOf("selected") >= 0 && t.indexOf("one line") >= 0, "a selection is quoted separately, so 'this bit' is not guessed");
  const empty = buildDiscussTurn({ draftText: "", selection: null, question: "Where do I start?" });
  assert(/empty/i.test(empty), "an empty piece says so rather than presenting a blank as the draft");
  const long = buildDiscussTurn({ draftText: "x".repeat(40000), selection: null, question: "q" });
  assert(/TRUNCATED/.test(long), "a truncated draft SAYS it is truncated");
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Drives every detector against synthetic bad input. Used rather than
// break-test-restore because this working tree is shared with other sessions
// and also deploys — a deliberate break has reached production from here once.
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };

  // check 3
  detects("a ```json block treated as insertable",
    parseDiscussReply('```json\n{"a":1}\n```').drafts.length === 0);
  detects("an unclosed fence treated as a block",
    parseDiscussReply("```draft\npartial").drafts.length === 0);
  // check 4 — the ordering bug, simulated
  const wrongOrder = (b: string) =>
    b.split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  detects("escaping after paragraphing (tags escaped into the article)",
    wrongOrder("a<b").indexOf("&lt;p&gt;") >= 0 && draftBlockToHtml("a<b").indexOf("&lt;p&gt;") < 0);
  // check 2 — the naive slice
  const naive = (t: DiscussTurn[]) => t.slice(Math.max(0, t.length - DISCUSS_PROMPT_TURNS));
  const odd: DiscussTurn[] = [];
  for (let i = 0; i < DISCUSS_PROMPT_TURNS + 1; i++) odd.push(turn(i % 2 === 0 ? "user" : "assistant", `m${i}`));
  detects("a naive tail slice opening on an assistant turn",
    naive(odd)[0].role === "assistant" && trimForPrompt(odd)[0].role === "user");
  // check 5 / 6 / 7 / 8 string detectors, against synthetic sources
  detects("a stored turn carrying the built draft",
    /content:\s*buildDiscussTurn/.test("      content: buildDiscussTurn({ draftText, selection, question }),"));
  detects("a clear flag hidden behind the question guard",
    /body\.clear/.test("  if (body.clear === true) {"));
  detects("a Score tab added to the writer's rail",
    '  t.push({ key: "score", label: "Score" });'.indexOf('key: "score"') >= 0);
  detects("an unguarded fetch of a caller-supplied URL",
    /fetch\(\s*fileUrl/.test("      const res = await fetch(fileUrl);"));
  detects("a comment being read as code",
    stripComments('// const x = fetch(fileUrl);\nconst y = 1;').indexOf("fileUrl") < 0);
  // The narrowing itself, in BOTH directions. Over-narrowing turns a false
  // positive into a false negative, which is worse: it reports full coverage
  // while seeing nothing. That happened on the previous ship.
  const fakeSrc =
    'export async function DELETE(a) {\n  config_chat: []\n}\n' +
    'export async function POST(b) {\n  optimizer_drafts.select()\n}\n';
  detects("a DELETE window that runs on into POST",
    functionBody(fakeSrc, "DELETE").indexOf("optimizer_drafts") < 0);
  detects("a DELETE window narrowed to nothing (would see no code at all)",
    functionBody(fakeSrc, "DELETE").indexOf("config_chat") >= 0);
  const fakeRoute =
    '  promptTurns.push({ role: "user", content: buildDiscussTurn({ d }) });\n' +
    '  const next = trimForStorage(history.concat([{ role: "user", content: question }]));\n' +
    '  await db.from("x").update({ config_chat: next }).eq("id_session", id);\n';
  detects("a storage window that swallows the prompt-building push",
    storageRegion(fakeRoute).indexOf("buildDiscussTurn") < 0);
  detects("a storage window narrowed past the stored turn",
    storageRegion(fakeRoute).indexOf("content: question") >= 0);
  const badRoute = fakeRoute.replace("content: question", "content: buildDiscussTurn({ d })");
  detects("a route that really does store the built turn",
    /buildDiscussTurn/.test(storageRegion(badRoute)));

  detects("a truncated draft that does not say so",
    /TRUNCATED/.test(buildDiscussTurn({ draftText: "x".repeat(40000), selection: null, question: "q" })));

  if (broken > 0) {
    console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`);
    process.exit(1);
  }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

console.log(failures === 0 ? "\n✓ discuss checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
