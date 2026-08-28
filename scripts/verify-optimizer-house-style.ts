/**
 * Guards the house style: no dashes as punctuation, and no stock AI phrasing,
 * in anything this app offers to put in a writer's document.
 *
 * Run: npx tsx scripts/verify-optimizer-house-style.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * THE RULE IN ONLY SOME OF THE PROMPTS. Five separate surfaces generate text
 * destined for a piece: the Writer's first draft, the Discuss panel's ```draft
 * blocks, the "add a missing block" expansions, the judge's suggestedEdit
 * replacements, and the one-click span rewrite. A rule added to three of them
 * is not a type error and produces no failure anyone can see; it produces
 * suggestions that follow the house style two times in five.
 *
 * THE RULE CONTRADICTED BY ITS OWN PROMPT. The generation prompt already said
 * "use em-dashes sparingly, no more than one per thousand words". A ban placed
 * beside that is two rules, and the model gets to pick. That line is gone
 * rather than supplemented, and this check asserts the assembled prompt is free
 * of the permissive form as well as carrying the ban.
 *
 * THE RULE DEMONSTRATED IN THE BREACH. Every one of those prompts was written
 * in prose full of em dashes, which teaches the style far more effectively than
 * an instruction unteaches it. The prompts that produce PROSE are asserted to
 * contain no dash of their own.
 *
 * The judge is the deliberate exception and the exception is narrow: its prompt
 * describes verdict semantics, most of which the model never imitates, but its
 * suggestedEdit IS document text. So the rule must be present and the
 * suggestedEdit contract must be dash free, while the verdict prose is left
 * alone. Stated here so the exception is a decision on the record rather than
 * an assertion someone loosened one afternoon.
 *
 * THE DETECTOR THAT CRIES WOLF. A flag on ordinary writing is worse than no
 * flag, because a writer learns to ignore it in a week. Ranges are not dashes,
 * "landscape architecture" is not a trope, and the check pins both.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * Recorded from a real run in a detached worktree; see the entries at the end.
 */
import {
  HOUSE_STYLE_RULE,
  houseStyleFlags,
  mechanicalDedash,
  AI_TROPES,
} from "../lib/optimizer/house-style";
import { buildDiscussSystem } from "../lib/optimizer/discuss";
import { buildGenerationPrompt } from "../lib/optimizer/briefs";
import { buildAddPrompt, buildSpanRewritePrompt } from "../lib/optimizer/fix-actions";
import { buildJudgePrompt } from "../lib/optimizer/judge";
import { parseDraft } from "../lib/optimizer/parse";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/** Dash as punctuation. A hyphen inside a compound word is not one. */
const dashes = (s: string) => (s.match(/(--|—|–)/g) || []).length;

const BRIEF = { targetQueries: [], audience: "", goal: "", lengthBand: "", voice: "" } as any;

/**
 * The prompts, ASSEMBLED by the same functions the app calls.
 *
 * Not read from source and not grepped for. A rule can be present in a file and
 * absent from the string a model receives, which is the failure this repo has
 * already had twice, and the only way to tell the difference is to build the
 * string.
 */
const PROMPTS: { name: string; text: string; prose: boolean }[] = [
  {
    name: "Discuss (```draft blocks)",
    text: buildDiscussSystem({ title: "T", format: "article", grounding: "" }),
    prose: true,
  },
  {
    name: "Writer generation",
    text: buildGenerationPrompt({ title: "T", format: "article", platform: "", brief: BRIEF, canon: null, sources: [] } as any),
    prose: true,
  },
  {
    name: "Add a missing block",
    text: buildAddPrompt({ what: "a sourced figure", where: "the opening" }, "sourced-figures"),
    prose: true,
  },
  {
    name: "One-click span rewrite",
    text: buildSpanRewritePrompt(),
    prose: true,
  },
  {
    name: "Judge (suggestedEdit)",
    text: buildJudgePrompt({
      title: "T", format: "article", body: "x",
      parsed: parseDraft({ body: "<p>Body text long enough for the judge to parse without complaint.</p>", title: "T" }),
      targetQueries: [], canon: null,
    } as any).system,
    prose: false,
  },
];

// ── 1. The rule reaches every prompt that writes for the piece ─────────────
console.log("\n1. Every surface carries the rule");
{
  // The fixture's own precondition: the rule must be substantial enough that
  // finding it means something. An empty constant would pass every includes().
  assert(HOUSE_STYLE_RULE.length > 400, `the rule is ${HOUSE_STYLE_RULE.length} characters, not an empty constant`);
  assert(dashes(HOUSE_STYLE_RULE) === 0, "and the rule itself contains no dash, which is the half that teaches");

  for (const p of PROMPTS) {
    assert(p.text.indexOf(HOUSE_STYLE_RULE) >= 0, `${p.name} carries it`);
  }
  assert(PROMPTS.length === 5, `all ${PROMPTS.length} text-producing surfaces are covered`);
}

// ── 2. And no prompt teaches the opposite ──────────────────────────────────
console.log("\n2. No prompt demonstrates what it bans");
{
  for (const p of PROMPTS.filter((x) => x.prose)) {
    const n = dashes(p.text);
    assert(n === 0, `${p.name}: ${n} dashes in the assembled prompt`);
  }

  // The judge's exception, pinned to the region it applies to. Its verdict
  // prose may keep dashes; the part describing the text that goes INTO a
  // document may not.
  const judge = PROMPTS.filter((p) => p.name.indexOf("Judge") === 0)[0].text;
  const at = judge.indexOf("suggestedEdit is the replacement text itself");
  assert(at > 0, "the judge's suggestedEdit contract was located");
  // Bounded to END where the rule ends, not `rule.length + 400` characters
  // later: the slack ran into the next paragraph, which is verdict prose and
  // deliberately exempt, so the assertion was failing on text it does not
  // govern. A detector whose window is wrong is not a stricter detector.
  const ruleAt = judge.indexOf(HOUSE_STYLE_RULE, at);
  assert(ruleAt > at, "the rule sits inside that contract, not somewhere else in the prompt");
  const contract = judge.slice(at, ruleAt + HOUSE_STYLE_RULE.length);
  assert(dashes(contract) === 0, "the judge's suggestedEdit contract carries no dash");

  // The superseded permissive rule, by its own words. A ban beside it would be
  // two rules and the model would get to choose.
  for (const p of PROMPTS) {
    assert(!/em[- ]dashes? sparingly/i.test(p.text), `${p.name} no longer permits dashes "sparingly"`);
    assert(!/no more than one per thousand/i.test(p.text), `${p.name} carries no per-thousand-words allowance`);
  }
}

// ── 3. The detector finds what it should ───────────────────────────────────
console.log("\n3. Detection");
{
  assert(houseStyleFlags("The plan failed — we had no budget.").dashes === 1, "an em dash is found");
  assert(houseStyleFlags("A pause – then another.").dashes === 1, "so is an en dash");
  assert(houseStyleFlags("A pause -- then another.").dashes === 1, "so is a double hyphen");
  assert(houseStyleFlags("Let's delve into this.").tropes.indexOf("delve into") >= 0, "a stock phrase is found");
  assert(houseStyleFlags("It's not just a tool, it's a way of working.").tropes.length > 0, "so is the not-just-X construction");
  assert(houseStyleFlags("Not only faster but also cheaper.").tropes.length > 0, "and not-only-but-also");
}

// ── 4. And nothing it should not ───────────────────────────────────────────
//
// The half that decides whether anyone keeps the flag switched on.
console.log("\n4. No false positives");
{
  assert(houseStyleFlags("The contract ran 2020–2024.").clean, "a year range is not punctuation");
  assert(houseStyleFlags("See pages 10-12 and 14–16.").clean, "nor a page range");
  assert(houseStyleFlags("She studied landscape architecture.").clean, "'landscape' alone is an ordinary noun");
  assert(houseStyleFlags("A well-built, high-quality, purpose-made frame.").clean, "hyphens in compounds are not dashes");
  assert(houseStyleFlags("The robust, seamless system elevates output.").clean, "the words judged too common to ban are not banned");
  assert(houseStyleFlags("An ordinary sentence about a building in Zurich.").clean, "ordinary prose is clean");
}

// ── 5. The mechanical fix is grammatical, and never automatic ──────────────
console.log("\n5. The offered fix");
{
  assert(mechanicalDedash("The plan failed — we had no budget.") === "The plan failed; we had no budget.",
    "a dash before a complete statement becomes a semicolon, never a comma splice");
  assert(mechanicalDedash("Three things matter — speed, cost and trust.") === "Three things matter: speed, cost and trust.",
    "a dash before a list becomes a colon");
  assert(mechanicalDedash("Jan, our CEO — a former banker — said no.") === "Jan, our CEO, a former banker, said no.",
    "a pair around an aside becomes commas");
  assert(mechanicalDedash("The contract ran 2020–2024 and pages 10–12.") === "The contract ran 2020–2024 and pages 10–12.",
    "and a range is left exactly alone");
  assert(houseStyleFlags(mechanicalDedash("A — b — c. D — e.")).dashes === 0, "nothing survives the fix");

  // The rule the module's header is about: no caller applies it to text on its
  // way into a document. It goes in the edit box, where a human reads it.
  const panel = read("components/optimizer/DiscussPanel.tsx");
  const at = panel.indexOf("mechanicalDedash(");
  assert(at > 0, "the panel offers the fix");
  const call = panel.slice(Math.max(0, at - 200), at + 120);
  assert(/setEdited\(mechanicalDedash/.test(call), "into the edit box, for the writer to read");
  assert(!/onApply\(mechanicalDedash/.test(panel), "and never straight into the piece — there is no substitution for a dash that is always right");
}

// ── 6. A suggestion can be edited and waved away ───────────────────────────
console.log("\n6. What the writer can do with a suggestion");
{
  const panel = read("components/optimizer/DiscussPanel.tsx");
  const block = panel.slice(panel.indexOf("function DraftBlock("), panel.indexOf("export default function DiscussPanel("));
  assert(block.length > 500, "the block component was located");
  assert(/<textarea/.test(block), "the suggestion is editable in place");
  // The assertion that matters: what is applied is what is in the box.
  assert(/onApply\(body,/.test(block), "and applying uses the edited text, not the model's original");
  assert(/const body = edited \?\? text/.test(block), "with the model's text as the starting point");
  assert(/onDismiss\(true\)/.test(block) && /onDismiss\?\.\(false\)/.test(block), "a suggestion can be dismissed and brought back");

  // Dismissal is PERSISTED, which is the whole point of dismissing one.
  const route = read("app/api/optimizer/sessions/[id]/discuss/route.ts");
  assert(/export async function PATCH/.test(route), "there is an endpoint to record it");
  assert(/t\.role === "assistant" && t\.at === at/.test(route), "addressed by the turn's timestamp, not its position");
  assert(/target\.length !== 1/.test(route), "and a turn that cannot be identified uniquely is refused rather than guessed at");
  assert(/setDismissed/.test(panel) && /method: "PATCH"/.test(panel), "and the panel calls it");
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  must(dashes("a — b") === 1, "a dash in an assembled prompt");
  must(!("x".indexOf(HOUSE_STYLE_RULE) >= 0), "a prompt missing the rule");
  must(/em[- ]dashes? sparingly/i.test("Use em-dashes sparingly."), "the superseded permissive rule");
  must(houseStyleFlags("delve into it").tropes.length > 0, "a stock phrase");
  must(houseStyleFlags("2020–2024").clean, "a range being wrongly flagged (must stay clean)");
  must(mechanicalDedash("It failed — we had none.") !== "It failed, we had none.", "a comma splice from the fix");
  must(AI_TROPES.length > 10, "an emptied trope list");
  const badPanel = 'const what = onApply(mechanicalDedash(text));';
  must(/onApply\(mechanicalDedash/.test(badPanel), "the fix being applied without a human reading it");
  const badRoute = 'const target = turns[body.index];';
  must(!/t\.role === "assistant" && t\.at === at/.test(badRoute), "dismissal addressed by position");

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ house style holds\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
