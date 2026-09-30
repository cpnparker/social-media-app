/**
 * The auto-router's POLARITY: a good model by default, the cheap one by exception.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * `routeOwn` escalated on keywords and fell through to FAST_MODEL. That made
 * the cheap leg the destination for every prompt that matched no rule — which
 * is most real questions — and the cheap leg is grok-4.3.
 *
 * Nobody had measured it. Artificial Analysis scores Grok 4.3 at 38 against
 * Grok 4.6's 61, and xAI's own launch note for 4.6 says "+23 points compared
 * to Grok 4.3". So the model answering most EngineAI traffic was the weakest
 * thing in the picker by roughly seventeen points, while three better models
 * sat one keyword away. The August audit had already called this tier the one
 * real mispricing; a month later the router still pointed at it.
 *
 * The fix is one line — fall through to REASONING_MODEL, and reach FAST_MODEL
 * only through a narrow trivial gate — and one line is exactly the kind of
 * thing that gets reverted by someone optimising cost without the quality
 * number in front of them. Hence this file.
 *
 * ── WHAT IT ASSERTS ─────────────────────────────────────────────────────────
 *
 *   1. An ordinary question does NOT route to the cheap leg.
 *   2. A greeting or acknowledgement DOES — the cheap leg still earns its keep.
 *   3. The escalations that already worked still work (documents, images,
 *      code, length, keywords).
 *   4. Refinement inheritance stays ONE-WAY: it can raise a tier, never lower.
 *   5. The three legs are distinct models, so a "simplification" that points
 *      two legs at one model fails here rather than silently in the ledger.
 *
 * MUTATION LOG
 *   - routeOwn falls through to FAST_MODEL again      → KILLED (check 1)
 *   - the trivial gate matches everything             → KILLED (check 1)
 *   - the trivial gate matches nothing                → KILLED (check 2)
 *   - TRIVIAL_MAX_CHARS raised to 500                 → KILLED, but only after
 *     a fixture was added that is BOTH over the cap and opens like a greeting;
 *     it survived the first run because no ordinary fixture was long AND
 *     trivial-looking, so the cap itself was unpinned.
 *   - the length cap removed entirely                 → KILLED (same fixture)
 *   - document attachment stops forcing the grounded leg → KILLED (check 3)
 *   - image generation stops forcing the grounded leg → KILLED (check 3)
 *   - two legs pointed at one model                   → KILLED (check 5)
 *   - inheritance allowed to lower a tier             → KILLED, and this one
 *     also survived first: the fixture has to be a message that is ITSELF a
 *     refinement and substantive on its own, over a trivial prior. Anything
 *     less never reaches the guard being tested.
 */
import { routeModel, FAST_MODEL, REASONING_MODEL, GROUNDED_MODEL } from "../lib/ai/auto-router";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const ok = (m: string) => console.log(`  ok    ${m}`);

const name = (m: string) =>
  m === FAST_MODEL ? "FAST" : m === REASONING_MODEL ? "REASONING" : m === GROUNDED_MODEL ? "GROUNDED" : m;

console.log("\n1. An ordinary question does not fall to the cheap leg");
{
  const before = failures;
  // None of these match a REASONING keyword, a code fence, the 500-char rule
  // or a multi-step pattern. Under the old polarity every one went to a model
  // scoring 38 on the Artificial Analysis index.
  const ORDINARY = [
    "what did we agree with Zurich Instruments about the workshop",
    "who owns the entity map for Amrize",
    "summarise the last board update",
    "is the AI score for Holcim up or down this month",
    "draft a note to Thomas about the deck",
    "what's the difference between GEO and AEO",
    "find the slide about knowledge graphs",
  ];
  for (const q of ORDINARY) {
    const got = routeModel(q, []);
    if (got === FAST_MODEL) fail(`"${q.slice(0, 44)}" routes to the cheap leg — the default polarity is inverted again`);
  }
  // AND THE LENGTH CAP ITSELF. A message can OPEN like a greeting and still be
  // real work; without this fixture the cap is unpinned, and raising it to 500
  // survived the mutation run that found this. Chosen to match a trivial
  // pattern, exceed TRIVIAL_MAX_CHARS, and hit no escalation keyword — so the
  // only thing standing between it and the cheap leg is the cap.
  const LONG_BUT_TRIVIAL_LOOKING =
    "ok great, and can you also add the second line to the footer on the closing slide and tidy the spacing under it";
  if (LONG_BUT_TRIVIAL_LOOKING.length <= 90) {
    fail(`the length-cap fixture is only ${LONG_BUT_TRIVIAL_LOOKING.length} chars — it must exceed TRIVIAL_MAX_CHARS or it pins nothing`);
  }
  if (routeModel(LONG_BUT_TRIVIAL_LOOKING, []) === FAST_MODEL) {
    fail("a long message that merely OPENS like a greeting reaches the cheap leg — the trivial gate's length cap is not holding");
  }
  if (failures === before) ok(`${ORDINARY.length + 1} ordinary questions all route above the cheap leg`);
}

console.log("\n2. But a greeting still does — the cheap leg earns its keep");
{
  const before = failures;
  const TRIVIAL = ["hi", "thanks!", "morning", "ok great", "yes please do", "what's the time", "cheers"];
  for (const q of TRIVIAL) {
    const got = routeModel(q, []);
    if (got !== FAST_MODEL) fail(`"${q}" routes to ${name(got)} — a greeting does not need the workhorse`);
  }
  // PRECONDITION: if the gate matched everything, check 1 would already have
  // failed; if it matched nothing, this one would. Both directions are pinned.
  if (failures === before) ok(`${TRIVIAL.length} trivial messages reach the cheap leg`);
}

console.log("\n3. The escalations that already worked still work");
{
  const before = failures;
  const doc = routeModel("look over this", [], { hasDocumentAttachment: true });
  if (doc !== GROUNDED_MODEL) fail(`a document attachment routes to ${name(doc)}, not the only chain that reads a PDF natively`);
  const img = routeModel("generate an image of a wind farm at dusk", []);
  if (img !== GROUNDED_MODEL) fail(`image generation routes to ${name(img)} — Grok writes fake markdown images`);
  const code = routeModel("fix this\n```ts\nconst x = 1\n```", []);
  if (code !== REASONING_MODEL) fail(`a code fence routes to ${name(code)}`);
  const long = routeModel("x".repeat(600), []);
  if (long !== REASONING_MODEL) fail(`a 600-character prompt routes to ${name(long)}`);
  const kw = routeModel("compare the two strategies and explain why one wins", []);
  if (kw !== REASONING_MODEL) fail(`a reasoning keyword routes to ${name(kw)}`);
  if (failures === before) ok("documents and images reach the grounded leg; code, length and keywords reach the workhorse");
}

console.log("\n4. Refinement inheritance stays one-way");
{
  const before = failures;
  // A trivial follow-up to a substantive thread must not drag it down.
  const raised = routeModel("shorten it", ["write a careful strategy memo for the whole company"]);
  if (raised === FAST_MODEL) fail("a refinement of a substantive request fell to the cheap leg");
  // And a substantive follow-up to a trivial thread is judged on its own.
  const own = routeModel("compare these two approaches and explain the trade-off", ["hi"]);
  if (own !== REASONING_MODEL) fail(`a substantive follow-up routes to ${name(own)} on its own merits`);
  // THE ONE-WAY GUARD ITSELF. This message is BOTH a refinement (it opens with
  // "revise") and substantive on its own (it carries a reasoning keyword), and
  // its prior is trivial. Only the `own !== FAST_MODEL` guard stops the walk
  // from replacing REASONING with the prior's FAST. Without this fixture,
  // deleting that guard survived the mutation run.
  const lowered = routeModel("revise it to be more strategic", ["hi"]);
  if (routeModel("revise it to be more strategic", []) !== REASONING_MODEL) {
    fail("the one-way fixture does not route to REASONING on its own — it pins nothing");
  } else if (lowered !== REASONING_MODEL) {
    fail(`a substantive refinement of a trivial prior was LOWERED to ${name(lowered)} — inheritance must only ever raise`);
  }
  if (failures === before) ok("inheritance raises a tier and never lowers one");
}

console.log("\n5. The three legs are three different models");
{
  const before = failures;
  const legs = [FAST_MODEL, REASONING_MODEL, GROUNDED_MODEL];
  if (new Set(legs).size !== 3) {
    fail(`the legs collapse to ${new Set(legs).size} distinct model(s): ${legs.join(", ")} — a tier that points at its neighbour is a tier that does nothing`);
  }
  if (failures === before) ok(`three distinct legs: ${FAST_MODEL} / ${REASONING_MODEL} / ${GROUNDED_MODEL}`);
}

console.log(failures
  ? `\n✗ ${failures} failure${failures === 1 ? "" : "s"}\n`
  : "\n✓ the workhorse answers by default and the cheap leg answers greetings\n");
process.exit(failures ? 1 : 0);
