/**
 * The voice surface must never be told to speak before a tool call.
 * Run with `npx tsx scripts/verify-voice-config.ts --self-test`.
 *
 * WHY. The speech-to-speech model renders its voice FRESH FOR EACH RESPONSE,
 * and xAI's realtime API has no per-response voice field — voice is a
 * session-level setting only (checked against docs.x.ai, 2026-08-24). So the
 * only way to guarantee one voice per reply is to make each reply ONE response.
 *
 * A tool turn is structurally two responses: the model emits the function call,
 * that response ends, the result is submitted, and a second response speaks the
 * answer. If the model ALSO speaks before the call, both responses carry audio —
 * two renders — and the second can come back as a different speaker. The client
 * queues audio from every response onto one cursor back to back
 * (VoiceDock playCursorRef), so the change lands seamlessly, which is why users
 * report it as the voice changing MID-SENTENCE rather than as two speakers.
 *
 * The serialization fix (ae563a4) stopped the two responses OVERLAPPING. It did
 * not stop there being two renders, and the comment it left at response.done —
 * "so the reply stays ONE voice, back to back" — is the assumption this file
 * exists to keep honest. Serializing made the seam seamless, not single-voiced.
 *
 * If response 1 carries no audio there is only one render and the question does
 * not arise. That is entirely a matter of what the prompt and the tool
 * descriptions tell the model to do, which is what is asserted here.
 *
 * Also guarded: never instruct an ACCENT. Asking for one destabilised the
 * render and is a known cause of the same symptom (fixed c03d4fc). British
 * spelling in TEXT is fine; a British accent must come from the VOICE.
 */
import { buildVoiceInstructions, getVoiceTools, VOICE_NAME, VOICE_NAME_FALLBACK } from "../lib/ai/voice";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/**
 * Phrases that make the model speak before it calls a tool.
 *
 * Matched case-insensitively against the assembled instructions AND every tool
 * description, because a tool description is prompt text too — "Tell the user
 * you're 'digging into that' first" lived in one for months and instructed
 * exactly the behaviour the session prompt now forbids.
 */
const PRE_TOOL_FILLER: [string, RegExp][] = [
  ["let me look", /\blet me (look|check|see|dig|pull|grab|fetch)\b/i],
  ["one moment", /\b(one moment|just a (moment|sec|second)|hang on|bear with)\b/i],
  ["digging into that", /\bdigging into (that|it)\b/i],
  ["tell the user first", /\btell (the user|them)\b[^.]{0,40}\bfirst\b/i],
  ["say you're checking", /\bsay (you're|you are)\s+(checking|looking|searching|fetching)/i],
  ["I'll check / I'm checking", /\b(i'll (check|look|see)|i'm (checking|looking))\b[^.]{0,20}\bfirst\b/i],
];

const CTX = {
  userName: "Chris",
  workspaceName: "The Content Engine",
  clientName: null,
  clientId: null,
  isTeamThread: false,
  now: "Monday, 24 August 2026, 11:26",
  clientRoster: ["Acme"],
};

/** Assembled instructions for every gate combination — a rule that only holds
 *  for one flag combination is not a rule. */
const VARIANTS: { label: string; text: string }[] = [];
const FLAGS: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
for (let i = 0; i < FLAGS.length; i++) {
  const [finance, resourcing] = FLAGS[i];
  VARIANTS.push({
    label: `finance=${finance} resourcing=${resourcing}`,
    text: buildVoiceInstructions({ ...CTX, financeAccess: finance, resourcingAccess: resourcing } as any),
  });
}
// Team threads change the audience rules and therefore the prompt.
VARIANTS.push({
  label: "team thread",
  text: buildVoiceInstructions({ ...CTX, isTeamThread: true, financeAccess: true, resourcingAccess: true } as any),
});

console.log("\nPreconditions — the check can see a real prompt");
if (VARIANTS.length !== 5) fail(`expected 5 prompt variants, built ${VARIANTS.length}`);
else pass(`${VARIANTS.length} prompt variants built`);
const shortest = VARIANTS.reduce((a, b) => (a.text.length < b.text.length ? a : b));
if (shortest.text.length < 2000) fail(`shortest variant is only ${shortest.text.length} chars — the builder is not producing a real prompt`);
else pass(`shortest variant is ${shortest.text.length.toLocaleString()} chars`);

console.log("\n1. No instruction to speak before a tool call");
const before1 = failures;
for (let i = 0; i < VARIANTS.length; i++) {
  const v = VARIANTS[i];
  for (let j = 0; j < PRE_TOOL_FILLER.length; j++) {
    const [label, re] = PRE_TOOL_FILLER[j];
    // The rule itself QUOTES the phrases it forbids, so a hit is only a
    // failure outside the block that forbids them.
    const withoutRule = v.text.replace(/# Never speak before a tool call[\s\S]*?(?=\n# |$)/, "");
    if (re.test(withoutRule)) fail(`${v.label}: instructions contain pre-tool filler "${label}"`);
  }
}
if (failures === before1) pass("no pre-tool filler in any variant");

console.log("\n2. The rule forbidding it is actually present");
const before2 = failures;
for (let i = 0; i < VARIANTS.length; i++) {
  const v = VARIANTS[i];
  if (!/Never speak before a tool call/i.test(v.text)) fail(`${v.label}: the no-speech-before-tool rule is missing`);
  if (!/two renders|different speaker/i.test(v.text)) fail(`${v.label}: the rule states no REASON — a rule without its reason is the first one dropped in an edit`);
}
if (failures === before2) pass("the rule and its reason are in every variant");

console.log("\n3. Tool descriptions are prompt text too");
const before3 = failures;
const toolSets: { label: string; tools: any[] }[] = [
  { label: "no flags", tools: getVoiceTools({ finance: false, resourcing: false }) as any[] },
  { label: "all flags", tools: getVoiceTools({ finance: true, resourcing: true }) as any[] },
];
let described = 0;
for (let i = 0; i < toolSets.length; i++) {
  const set = toolSets[i];
  for (let j = 0; j < set.tools.length; j++) {
    const t = set.tools[j];
    const name = t?.function?.name || t?.name || "(unnamed)";
    const desc = String(t?.function?.description || t?.description || "");
    if (!desc) { fail(`${set.label}: tool ${name} has no description`); continue; }
    described++;
    for (let k = 0; k < PRE_TOOL_FILLER.length; k++) {
      const [label, re] = PRE_TOOL_FILLER[k];
      // A description may forbid the behaviour; it may not instruct it.
      const forbids = /\bsay nothing\b|\bsilently\b|\bsay NOTHING\b/i.test(desc);
      if (re.test(desc) && !forbids) fail(`${set.label}: tool ${name} instructs pre-tool speech ("${label}")`);
    }
  }
}
if (described < 5) fail(`only ${described} tool descriptions inspected — getVoiceTools returned an unexpected shape`);
if (failures === before3) pass(`${described} tool descriptions inspected, none instructs pre-tool speech`);

console.log("\n4. Voice consistency is stated, and no ACCENT is instructed");
const before4 = failures;
for (let i = 0; i < VARIANTS.length; i++) {
  const v = VARIANTS[i];
  if (!/same voice|Voice consistency/i.test(v.text)) fail(`${v.label}: no voice-consistency rule`);
  // "do NOT attempt a British accent" is the guard, not a violation — match
  // only an instruction TO adopt one.
  const instructsAccent = /\b(speak|talk|use|adopt|with)\s+(a|an|in)?\s*(british|american|australian|irish|scottish|posh|rp)\s+accent\b/i;
  const m = v.text.match(instructsAccent);
  if (m) {
    const at = v.text.indexOf(m[0]);
    const around = v.text.slice(Math.max(0, at - 60), at + m[0].length);
    if (!/\b(not|never|don't|do NOT|avoid)\b/i.test(around)) fail(`${v.label}: instructs an accent — a known cause of mid-reply voice drift: "${m[0]}"`);
  }
}
if (failures === before4) pass("voice consistency stated; no accent instructed");

console.log("\n5. The configured voice is one xAI actually has");
// A wrong name does not fail loudly at runtime — the session route falls back
// to VOICE_NAME_FALLBACK and the user simply hears a different speaker, which
// is indistinguishable from the bug this file is about.
const XAI_VOICES = [
  "eve", "ara", "rex", "sal", "leo",
  "lumen", "castor", "atlas", "carina", "orion", "luna",
];
XAI_VOICES.indexOf(VOICE_NAME) >= 0
  ? pass(`VOICE_NAME="${VOICE_NAME}" is a known voice`)
  : fail(`VOICE_NAME="${VOICE_NAME}" is not in the known list — if xAI rejects it the mint falls back to "${VOICE_NAME_FALLBACK}" and the user hears a different speaker with no error`);
XAI_VOICES.indexOf(VOICE_NAME_FALLBACK) >= 0
  ? pass(`fallback "${VOICE_NAME_FALLBACK}" is a known voice`)
  : fail(`fallback "${VOICE_NAME_FALLBACK}" is not a known voice`);

// ── Self-test ───────────────────────────────────────────────────────────
// The detectors are regexes over prose, which is exactly the kind of check
// that silently matches nothing after an innocuous rewording. Fixture-only:
// no repo file is mutated, because this tree is shared with other sessions
// and also deploys.
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n6. Self-test — the detectors fire on the shapes they exist for");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    detects ${name}`);
    else { selfFails++; console.log(`  FAIL  does NOT detect ${name}`); }
  };
  const hits = (text: string) => {
    for (let i = 0; i < PRE_TOOL_FILLER.length; i++) if (PRE_TOOL_FILLER[i][1].test(text)) return true;
    return false;
  };

  detects('the "let me look" filler that was live until 2026-08-24',
    hits('- Talk like a colleague. Contractions, occasional brief acknowledgments ("sure", "mm, let me look").'));
  detects('the consult_analyst wording that was live until 2026-08-24',
    hits("Tell the user you're 'digging into that' first — the analyst takes a few seconds."));
  detects("a hang-on variant", hits("Say hang on while you fetch the data."));
  detects("an instruction to announce a search", hits("Always say you're checking the calendar before you call it."));
  detects("plain prose is NOT flagged", !hits("Answer in one to three sentences and stop."));

  const accentRe = /\b(speak|talk|use|adopt|with)\s+(a|an|in)?\s*(british|american)\s+accent\b/i;
  detects("an accent instruction", accentRe.test("Please speak with a British accent."));
  detects("the negated accent line is NOT a violation",
    (() => {
      const line = "Use British spelling and vocabulary, but do NOT attempt a British accent.";
      const m = line.match(accentRe);
      if (!m) return true;
      const at = line.indexOf(m[0]);
      return /\b(not|never|don't|do NOT|avoid)\b/i.test(line.slice(Math.max(0, at - 60), at + m[0].length));
    })());

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
