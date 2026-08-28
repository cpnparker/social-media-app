/**
 * Guards the score card that appears INSIDE a chat conversation.
 *
 * Run: npx tsx scripts/verify-optimizer-inline-score.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * THE NUMBER, SHOWN WITHOUT ITS CAVEAT. A chat turn almost never carries a
 * target query, so Relevance — the heaviest pillar — is skipped, and the
 * overall is renormalised over the pillars that ran. That is correct, and it is
 * a DIFFERENT number from the one the studio shows for the same text with a
 * query set. Printing it bare invites "the optimiser says 61, chat says 48".
 * The card must say how many pillars it scored, and so must the sentence the
 * model is handed.
 *
 * THE LIST THAT STOPS AT THREE. Three fixes is the right size for a reply.
 * Three fixes presented as the whole list is a lie about the piece, and the
 * shape of the bug is a `.slice(0, 3)` with nothing counting what fell off.
 *
 * THE ESCAPE HATCH'S PROVENANCE. "Open in Optimiser" mints workspace content.
 * The rule the chat-import block exists for is that the BROWSER SUPPLIES NO
 * TEXT: it sends two ids and the server re-reads the row, so a crafted POST
 * cannot mint a piece containing anything it likes. The card path must obey the
 * same rule, and it takes a different text than the existing button — the
 * SCORED text rather than the reply — which is exactly the kind of difference
 * that gets implemented by passing the text up from the client.
 *
 * THE CARD THAT SURVIVES ONE READING. The reply is deliberately written NOT to
 * repeat the numbers. So a card held only in the browser leaves a reopened
 * thread reading as a verdict about nothing. Persistence is not a nicety here;
 * it is what makes the instruction to the model safe.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * Eighteen mutations, run in a detached worktree rather than by breaking this
 * tree — it is shared with other sessions and it also deploys, and a deliberate
 * break has reached production from here once already.
 *
 * KILLED  moreCount forced to 0 (the list stops at three, silently)          → check 3
 * KILLED  rest sliced from shown+2, so the remainder under-counts            → check 3
 * KILLED  open criteria sorted smallest-first                                → check 3
 * KILLED  partial hardcoded false                                            → check 2
 * KILLED  the short-band caveat made constant                                → check 2
 * KILLED  INLINE_SCORE_MIN_WORDS = 0 (score anything, including "hi")        → check 1
 * KILLED  the "ALREADY ON THE USER'S SCREEN" line removed                    → check 4
 * KILLED  verdictLine collapsed to one sentence for all four cases           → check 4
 * KILLED  one chain's handler renamed away                                   → check 5
 * KILLED  one chain's onToolCard call deleted                                → check 5
 * KILLED  the tool description told to fire on sight                         → check 5
 * KILLED  the ChatPanel POST sending text alongside the ids                  → check 6
 * KILLED  the fromCard branch reading body.text                              → check 6
 * KILLED  the tool_card update deleted from the messages route               → check 7
 * KILLED  the hydrator no longer called on load                              → check 7
 * KILLED  the stored-card shape check removed                                → check 7
 *
 * SURVIVED, and then killed by widening the check: `source: undefined` on the
 *   stored card. It opens no hole — the import route refuses rather than
 *   importing the wrong text — but it turns "Open in Optimiser" into a dead
 *   end for every card, which is a silent product failure. Check 6 now counts
 *   the chains that carry the scored text.
 *
 * SURVIVED, correctly: renaming the handler's `scoredText`/`scoredTitle`
 *   locals. Nothing reads the names, and check 6 asserts the PROPERTY — that a
 *   source text is carried — which holds under any spelling. Recorded rather
 *   than tidied away: a survivor is a fact about the check, and this one says
 *   the assertion is pitched at the right level.
 */
import {
  buildInlineScore,
  inlineScoreForModel,
  openCriteria,
  verdictLine,
  INLINE_SCORE_MIN_WORDS,
  INLINE_SCORE_SHORT_WORDS,
} from "../lib/optimizer/inline-score";
import { computeDraftScores } from "../lib/optimizer/engine";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);
const assert = (ok: boolean, msg: string) => (ok ? pass(msg) : fail(msg));

/** Comments describe code; they are not code. A detector that reads them
 *  reports a rule as present because somebody wrote about it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Long enough to score, structured enough to leave real criteria open. */
const ARTICLE = [
  "Generative engine optimisation is the practice of structuring writing so that AI assistants can retrieve it, quote it and attribute it.",
  "It is not search engine optimisation with a new name. A search engine returns a list of links and lets the reader choose; an assistant returns one answer and chooses on the reader's behalf.",
  "That single difference changes what a page has to do. It has to be findable by a retrieval step that reads passages rather than pages, and it has to be quotable by a model that will not paraphrase a claim it cannot attribute.",
  "Most corporate writing fails the second test long before the first. The claims are there, but they are unsourced, undated, and attached to nobody.",
  "A sentence that says the market grew sharply last year is unusable. A sentence that says the market grew 43 per cent in 2025, according to the trade body, is quotable as it stands.",
  "The same applies to opinion. An assistant will quote a named person saying something specific far more readily than it will quote a company saying something general about itself.",
  "Structure carries the other half of the work. Headings that ask the questions readers actually ask give a retrieval step something to match against.",
  "Passages that answer in the first two sentences give a model something to lift. A page that buries its answer under four hundred words of context will lose to a page that leads with it, even when the buried answer is better.",
  "None of this requires writing badly. It requires writing that can be taken apart and still make sense in pieces, which is a discipline good writers already have.",
].join("\n\n");

const SHORT = "Can you take a look at this and tell me what you think about the plan we discussed.";

// ── 1. A number is refused when it would describe the format ───────────────
console.log("\n1. The floor");
{
  // The fixture's OWN precondition, asserted first. A "short" fixture that
  // silently grew past the floor would leave this check certifying nothing.
  const shortWords = SHORT.split(/\s+/).filter(Boolean).length;
  assert(shortWords < INLINE_SCORE_MIN_WORDS, `the short fixture is ${shortWords} words, genuinely below the ${INLINE_SCORE_MIN_WORDS}-word floor`);

  const refused = buildInlineScore(SHORT);
  assert(refused.ok === false, "a chat-sized message is refused rather than scored");
  assert(!refused.ok && /\d+ words/.test(refused.reason), "the refusal says how long the text actually was");
  assert(
    !refused.ok && /calibrat|800/.test(refused.reason),
    "the refusal says WHY — the rubric's calibration band, not a bare 'too short'"
  );
  assert(
    inlineScoreForModel(refused).includes("do not guess"),
    "the model is told not to invent a number in place of the refusal"
  );

  const longWords = ARTICLE.split(/\s+/).filter(Boolean).length;
  assert(longWords >= INLINE_SCORE_MIN_WORDS, `the article fixture is ${longWords} words, above the floor`);
  const scored = buildInlineScore(ARTICLE, "What is generative engine optimisation?");
  assert(scored.ok === true, "an article-length piece scores");
}

// ── 2. The caveat travels with the number ──────────────────────────────────
//
// Both ways: the card carries it as a field, and the text handed to the model
// says it in words. Only one of those is visible to the reader, and only the
// other one governs what the reply claims.
console.log("\n2. Partial scoring is stated, not hidden");
{
  const card = buildInlineScore(ARTICLE, "What is generative engine optimisation?");
  if (!card.ok) { fail("fixture did not score"); }
  else {
    // The precondition again: this only tests anything if a pillar IS skipped.
    const raw = computeDraftScores({ body: ARTICLE, title: "x", targetQueries: [], format: "article" } as any);
    const skipped = raw.pillars.filter((p) => p.criteria.every((c) => c.skipped)).length;
    assert(skipped > 0, `no target query means ${skipped} pillar(s) are skipped — the case this check is about`);

    assert(card.partial === true, "the card reports the score as partial");
    assert(card.pillarsScored < card.pillarsTotal, `${card.pillarsScored} of ${card.pillarsTotal} pillars scored`);
    const forModel = inlineScoreForModel(card);
    assert(
      forModel.includes(`${card.pillarsScored} of ${card.pillarsTotal} pillars`),
      "the model is told the same fraction the card shows"
    );
    assert(/Relevance was skipped/.test(forModel), "and told WHICH pillar went missing, so it can say so");

    // The other caveat: short-but-scoreable. The band matters because a 300-word
    // post is a legitimate thing to write and an illegitimate thing to judge
    // against a rubric calibrated on 800-2,500.
    assert(card.wordCount < INLINE_SCORE_SHORT_WORDS && card.short === true, `${card.wordCount} words is flagged short`);
    assert(/short for this rubric/.test(inlineScoreForModel(card)), "and the model is told the number is rougher than usual");
    const longer = buildInlineScore([ARTICLE, ARTICLE].join("\n\n"), "GEO");
    assert(longer.ok === true && longer.wordCount >= INLINE_SCORE_SHORT_WORDS && longer.short === false, "a piece past the band is not flagged short — the caveat is measured, not constant");

    // The component must render the fraction, not just receive it.
    const ui = stripComments(read("components/ai-writer/ContentScoreCard.tsx"));
    assert(
      /pillarsScored\}[\s\S]{0,40}pillarsTotal\}/.test(ui) && /data\.partial/.test(ui),
      "the card component renders the fraction when the score is partial"
    );
  }
}

// ── 3. Three fixes, and an honest account of the rest ──────────────────────
console.log("\n3. What the list leaves out");
{
  const card = buildInlineScore(ARTICLE, "What is generative engine optimisation?");
  if (!card.ok) { fail("fixture did not score"); }
  else {
    const raw = computeDraftScores({ body: ARTICLE, title: "x", targetQueries: [], format: "article" } as any);
    const open = openCriteria(raw);
    assert(open.length > card.moves.length, `${open.length} criteria are open — more than the ${card.moves.length} shown, so the remainder is real`);
    assert(card.moves.length + card.moreCount === open.length, "shown + not-shown accounts for every open criterion");

    const points = card.moves.map((m) => m.points);
    assert(
      points.every((p, i) => i === 0 || points[i - 1] >= p),
      "the shown fixes are the biggest ones, in descending order"
    );
    const smallestShown = points[points.length - 1];
    const biggestHidden = open.slice(card.moves.length).reduce((n, c) => Math.max(n, c.maxPoints - c.earned), 0);
    assert(smallestShown >= biggestHidden, "nothing hidden is worth more than something shown");

    const restSum = open.slice(card.moves.length).reduce((n, c) => n + (c.maxPoints - c.earned), 0);
    assert(Math.abs(card.morePoints - restSum) < 0.11, "the remainder's point total is the actual sum, not an estimate");

    const forModel = inlineScoreForModel(card);
    assert(forModel.includes(`${card.moreCount}`), "the model is told how many it is not showing");
  }
}

// ── 4. The reply is told not to repeat the card ────────────────────────────
//
// Asserted on the RUN output rather than a grep of the source, because the
// string that matters is the one a model actually receives.
console.log("\n4. What the model is told");
{
  const card = buildInlineScore(ARTICLE, "GEO");
  const forModel = inlineScoreForModel(card);
  assert(/ALREADY ON THE USER'S SCREEN/.test(forModel), "the model is told the card is already drawn");
  assert(/Do NOT repeat the numbers/i.test(forModel), "and told not to restate the numbers");
  assert(/which fix to do first/i.test(forModel), "and given something to say instead");

  const verdicts = new Set([
    verdictLine(80, 80), verdictLine(80, 20), verdictLine(20, 80), verdictLine(20, 20),
  ]);
  assert(verdicts.size === 4, "each combination of the two roll-ups gets its own sentence");
}

// ── 5. Every chain draws the card and records it ───────────────────────────
//
// Four provider chains dispatch tools in four separate loops. A tool wired into
// three of them is not a type error and not a runtime error — it is a feature
// that works on Claude and silently does nothing on Grok.
console.log("\n5. All four provider chains");
{
  const src = stripComments(read("lib/ai/providers.ts"));
  const registered = (src.match(/tools\.push\(CONTENT_SCORE_(OPENAI_)?TOOL\)/g) || []).length;
  const handlers = (src.match(/=== "query_content_score"/g) || []).length;
  const enqueues = (src.match(/content_score: card/g) || []).length;
  const records = (src.match(/onToolCard\?\.\(\{\s*\n?\s*kind: "content_score"/g) || []).length;

  assert(handlers === 4, `${handlers} chains handle the tool (expected 4)`);
  assert(enqueues === 4, `${enqueues} chains draw the card (expected 4)`);
  assert(records === 4, `${records} chains record the card for reload (expected 4)`);
  // Registered is counted separately from handled: a chain that HANDLES a tool
  // it never offers is dead code, and a chain that OFFERS one it cannot handle
  // hangs the turn on a tool_use with no result.
  assert(registered === 4, `${registered} chains offer the tool (expected 4)`);

  assert(
    /"query_content_score",/.test(src.slice(src.indexOf("POST_TAINT_READ_TOOLS = new Set(["), src.indexOf("POST_TAINT_READ_TOOLS = new Set([") + 900)),
    "classified as a post-taint read — it is a pure function over text already in the turn"
  );

  const desc = src.slice(src.indexOf('name: "query_content_score"'), src.indexOf('name: "query_content_score"') + 2200);
  assert(/Do NOT call it unprompted/.test(desc), "the tool description tells the model to offer rather than fire on sight");
}

// ── 6. The browser supplies ids, never text ────────────────────────────────
console.log("\n6. Provenance of the escape hatch");
{
  const panel = stripComments(read("components/ai-writer/ChatPanel.tsx"));
  const at = panel.indexOf('source: "chat"');
  const post = at < 0 ? "" : panel.slice(panel.lastIndexOf("fetch(\"/api/optimizer/import\"", at), panel.indexOf("})", at));
  assert(at >= 0 && post.length > 0, "the card's open action posts to the import route");
  assert(/fromCard: true/.test(post), "and flags the card as the origin");
  assert(
    !/\btext\s*:|content\s*:|\bhtml\s*:/.test(post),
    "and sends NO text — ids only, so the server decides what the piece contains"
  );

  // The stored text is what makes the ids-only rule POSSIBLE. Dropping it does
  // not open a hole — the route refuses rather than importing the wrong thing —
  // but it turns the button into a dead end, and this survived the first pass.
  const chains = stripComments(read("lib/ai/providers.ts"));
  const carried = (chains.match(/source: \{ text: /g) || []).length;
  assert(carried === 4, `${carried} chains store the scored text with the card (expected 4)`);

  const route = stripComments(read("app/api/optimizer/import/route.ts"));
  const branch = route.slice(route.indexOf("body.fromCard === true"), route.indexOf("body.fromCard === true") + 900);
  assert(branch.length > 20, "the route has a branch for card-origin imports");
  assert(/tool_card/.test(branch), "which reads the text from the stored card on the message row");
  assert(
    !/body\.(text|content|html)/.test(branch),
    "and never from the request body — the rule the whole chat-import block exists for"
  );
  // The read must REACH tool_card without NAMING it. Naming a column that may
  // not exist yet makes PostgREST reject the whole query, and the casualty is
  // "Start writing" — a button with nothing to do with cards, broken by the gap
  // between a deploy and a migration. Deploy order is not ours to choose.
  // Bounded FORWARD from the read, not to the file's first .maybeSingle() —
  // which sits 35 lines earlier on the conversation lookup, so the naive slice
  // runs backwards and matches nothing while looking like a failing assertion.
  const readAt = route.indexOf('.from("ai_messages")');
  const msgRead = readAt < 0 ? "" : route.slice(readAt, route.indexOf(".maybeSingle()", readAt));
  assert(msgRead.length > 20 && msgRead.includes("id_conversation"), "the window really covers the message read — a slice that matched nothing would pass the negative assertion below for free");
  assert(msgRead.includes('.select("*")'), "the message read takes the whole row");
  assert(
    !/select\([^)]*tool_card/.test(msgRead),
    "and never names tool_card in the select — an unknown column fails the query, not just the card"
  );
}

// ── 7. The card outlives the browser that drew it ──────────────────────────
//
// Asserting it is USED, not merely written: a callback nobody assigns and a
// column nobody updates both leave every fixture above green.
console.log("\n7. Persistence, end to end");
{
  const route = stripComments(read("app/api/ai/conversations/[id]/messages/route.ts"));
  assert(/onToolCard:\s*\(card: any\) =>\s*\{\s*lastToolCard = card;/.test(route), "the streaming route subscribes to the callback");
  const update = route.slice(route.indexOf("if (lastToolCard"), route.indexOf("if (lastToolCard") + 400);
  assert(/\.update\(\{ tool_card: lastToolCard \}\)/.test(update), "and writes what it received to the message row");
  assert(/\.eq\("id_message", pendingMessageId\)/.test(update), "against the message the card belongs to");

  const mapper = stripComments(read("lib/ai/response-mappers.ts"));
  assert(/toolCard: row\.tool_card/.test(mapper), "the row's column reaches the client as toolCard");

  const panel = stripComments(read("components/ai-writer/ChatPanel.tsx"));
  assert(/hydrateToolCardsFromMessages\(data\.messages/.test(panel), "and the panel hydrates from it on load — a hydrator nobody calls is a hydrator that does nothing");
  const hyd = panel.slice(panel.indexOf("const hydrateToolCardsFromMessages"), panel.indexOf("const hydrateSlidesFromMessages"));
  assert(/typeof data\.overall !== "number"/.test(hyd), "a stored card of the wrong shape is dropped rather than rendered half-drawn");

  const migration = read("supabase/migrations/20260828_inline_tool_cards.sql");
  assert(/add column if not exists tool_card jsonb/.test(migration), "the column exists in a migration");
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Every detector above is driven against input that should trip it. A check
// that cannot fail reports nothing, and this working tree is shared and also
// deploys — so the alternative (break the code, watch it go red, restore) has
// already put a deliberate break into production once.
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  // 1 floor
  must(buildInlineScore("hi there").ok === false, "a two-word text (the floor)");
  // 2 partial
  const card = buildInlineScore(ARTICLE, "GEO");
  must(card.ok === true && card.partial === true, "a no-query score being flagged partial");
  const flat = { ...(card as any), partial: false, pillarsScored: 6, pillarsTotal: 6 };
  must(!inlineScoreForModel(flat).includes("pillars were scored"), "a card claiming all pillars ran (no caveat is emitted)");
  must(buildInlineScore(ARTICLE, "GEO").ok === true && (buildInlineScore(ARTICLE, "GEO") as any).short === true, "the short-band caveat");
  // 3 remainder
  const trimmed = { ...(card as any), moreCount: 0, morePoints: 0 };
  must(!inlineScoreForModel(trimmed).includes("A further"), "a card that hides its remainder");
  const desc = openCriteria(computeDraftScores({ body: ARTICLE, title: "x", targetQueries: [], format: "article" } as any));
  must(desc.length > 1 && (desc[0].maxPoints - desc[0].earned) >= (desc[1].maxPoints - desc[1].earned), "openCriteria ordering (biggest first)");
  // 4 the instruction
  must(/ALREADY ON THE USER'S SCREEN/.test(inlineScoreForModel(card)), "the do-not-repeat instruction being present");
  // 5/6/7 source detectors, against mutated copies of the real strings
  const src = read("lib/ai/providers.ts");
  must((src.match(/=== "query_content_score"/g) || []).length === 4, "the four-handler count");
  must(
    (stripComments(src.replace(/=== "query_content_score"/, '=== "query_content_scoreX"')).match(/=== "query_content_score"/g) || []).length === 3,
    "a chain losing its handler"
  );
  const badPost = 'fetch("/api/optimizer/import", { body: JSON.stringify({ source: "chat", fromCard: true, text: card.text }) })';
  must(/\btext\s*:/.test(badPost), "a browser that starts sending the text up");
  const namedSelect = '.from("ai_messages").select("id_message, tool_card").maybeSingle()';
  must(/select\([^)]*tool_card/.test(namedSelect), "a select that names the new column");
  const badBranch = 'if (body.fromCard === true) { chatText = String(body.text || ""); }';
  must(/body\.(text|content|html)/.test(badBranch), "a card branch reading the body instead of the row");
  const routeSrc = stripComments(read("app/api/ai/conversations/[id]/messages/route.ts"));
  must(
    !/\.update\(\{ tool_card: lastToolCard \}\)/.test(routeSrc.replace(/\.update\(\{ tool_card: lastToolCard \}\)/, ".update({})")),
    "the persistence write being deleted"
  );
  const panelSrc = stripComments(read("components/ai-writer/ChatPanel.tsx"));
  must(
    !/hydrateToolCardsFromMessages\(data\.messages/.test(panelSrc.replace("hydrateToolCardsFromMessages(data.messages", "noop(data.messages")),
    "the hydrator no longer being called"
  );

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ inline score holds\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
