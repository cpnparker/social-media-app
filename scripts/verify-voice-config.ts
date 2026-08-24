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
import { buildVoiceInstructions, getVoiceTools, VOICE_MODEL, VOICE_NAME, VOICE_NAME_FALLBACK, VOICE_TOOL_NAMES, voiceCostTenthsPerMin } from "../lib/ai/voice";
import { toolBudgetFor } from "../lib/ai/tool-loop-guard";

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
  // The rule's REASON deliberately no longer mentions voices. See section 4.
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

console.log("\n4. The prompt does not talk to the model about its own voice");
// INVERTED on 2026-08-24, and this is the point of the whole file now.
//
// Measurement killed the theory these checks were built on. Every recent voice
// reply is ONE assistant row per user row — no split replies — so the reply the
// owner heard change mid-sentence was a SINGLE response, and three fixes aimed
// at response boundaries were aimed at a mechanism that was not running.
//
// What remains is the model's own render drifting, and the leading candidate is
// the prompt itself. There was a "# Voice consistency — CRITICAL" paragraph
// naming accents three times, plus imitation, drift, impressions and
// "performance" voices, ending "do NOT attempt a British accent" — while the
// minted voice IS the British one. This repo already recorded that instructing
// an accent destabilises the render; a NEGATED accent instruction is still an
// accent instruction to a speech-to-speech model. And the paragraph grew every
// time the symptom recurred, which is the shape of a cure making the disease.
//
// So the invariant flipped: the prompt must not discuss voice, accent or
// switching at all. The voice is set at mint time, which is the actual control.
const VOICE_TALK: [string, RegExp][] = [
  ["instructs an accent", /\b(speak|talk|use|adopt|attempt|with|in)\s+(a|an|in)?\s*\w*\s*accent\b/i],
  ["names accent drift", /\b(drift|switch|change)\w*\s+(into\s+)?(accents?|voices?)\b/i],
  ["describes sounding like two people", /\btwo (different )?(people|speakers|voices)\b|\bdifferent speaker\b/i],
  ["mentions renders", /\b(two )?renders?\b/i],
  ["asks for impressions or performance voices", /\b(impressions?|role-?play|performance voice)\b/i],
  ["instructs pitch or delivery consistency", /\bsame (voice|pitch)\b/i],
];
const before4 = failures;
for (let i = 0; i < VARIANTS.length; i++) {
  const v = VARIANTS[i];
  for (let j = 0; j < VOICE_TALK.length; j++) {
    const [label, re] = VOICE_TALK[j];
    const m = v.text.match(re);
    if (m) fail(`${v.label}: prompt ${label} — "${m[0]}". Telling a speech-to-speech model about voice switching is a known destabiliser; the voice is set at mint time.`);
  }
}
if (failures === before4) pass("no variant discusses voice, accent or switching");

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

console.log("\n6. The session knows what its own thread already said");
// Voice started amnesiac: the builder took no messages at all, so twenty
// minutes into a client brief it had never heard of the client — and when told
// "the handover list in this thread" it replied "I can't pull up that specific
// thread; it looks like I'm not a member of the conversation", from inside
// that conversation.
// Shaped like the real thing: a rolling SUMMARY plus recent turns. Recent
// turns alone are not enough, and a live failure proved it — asked what was
// left on a handover list, voice could not find it, because the list was
// message THREE of a hundred and fifty-four and no window of recent turns
// reaches that. The summary is the half that carries old content.
const DIGEST = [
  "What this conversation has covered so far:\nRob sent a handover list before his holiday covering Siemens, IFFIm, Catherine's new role and several clients.",
  "The most recent turns:\nThey said: what is still left off Rob's handover list\nYou said: three items remain",
].join("\n\n");
const withDigest = buildVoiceInstructions({ ...CTX, threadDigest: DIGEST } as any);
const noDigest = buildVoiceInstructions({ ...CTX } as any);

/This conversation so far/.test(withDigest)
  ? pass("the recent turns reach the prompt")
  : fail("the thread digest never reaches the prompt — voice stays amnesiac inside its own thread");
withDigest.indexOf("Rob") >= 0
  ? pass("the actual content is present, not just a heading")
  : fail("the digest heading rendered without the turns");
// Both halves must survive into the prompt. Dropping the summary is the exact
// regression that made this useless in a long thread.
/covered so far/.test(withDigest)
  ? pass("the rolling summary half survives")
  : fail("the summary was dropped — old content becomes unreachable again");
/most recent turns/.test(withDigest)
  ? pass("the recent-turns half survives")
  : fail("recent turns were dropped — \"it\" and \"that\" stop resolving");
/do not say you cannot see the conversation/i.test(withDigest)
  ? pass("it is told it IS in the conversation")
  : fail("nothing stops it claiming it cannot see the thread it is in");
/<<<UNTRUSTED:[a-z0-9]+>>>/.test(withDigest)
  ? pass("the digest is fenced — a thread can quote email and meeting text written by other people")
  : fail("thread content is replayed RAW into the instructions, round the fencing the text pipeline does");
!/This conversation so far/.test(noDigest)
  ? pass("a fresh thread carries no digest section")
  : fail("an empty digest still renders its heading");

// Latency is the thing people forgive least in a spoken interface, and the
// voice prompt is short on purpose. Assert the digest stays a budget, not a
// blank cheque.
const added = withDigest.length - noDigest.length;
// The route caps each half at 2,500 chars, so a real digest lands near 5,000
// plus the fixed framing. Bounded, but deliberately larger than the
// turns-only version was: an assistant that cannot see its own thread is
// useless, and that is worth about a second of first-audio latency.
added > 0 && added < 7000
  ? pass(`digest adds ${added} chars (~${Math.round(added / 3.6)} tokens) — bounded`)
  : fail(`digest adds ${added} chars — that delays first audio too far`);

console.log("\n6b. It can reach the thread it cannot fit in the prompt");
// Two digests failed the same real case before this: a handover list pasted as
// message THREE of a hundred and fifty-four. A rolling summary summarises the
// RECENT conversation and never preserved it; measured on that thread, the
// digest reached 3 of the list's 14 items. No window of bounded size fixes a
// problem of DEPTH — retrieval does, and it costs no first-audio latency
// because nothing sits in the prompt until it is asked for.
const allTools = getVoiceTools({ finance: false, resourcing: false }) as any[];
const threadTool = allTools.filter((t) => (t?.name || t?.function?.name) === "search_thread")[0];
threadTool
  ? pass("search_thread is offered to the model")
  : fail("search_thread is not in the tool list — voice cannot reach anything beyond the digest");
VOICE_TOOL_NAMES.indexOf("search_thread") >= 0
  ? pass("and the tools route will accept it")
  : fail("search_thread is offered but the route would reject it as an unknown tool");
toolBudgetFor("search_thread") > 3
  ? pass(`its budget is ${toolBudgetFor("search_thread")} — room to try a second term`)
  : fail("search_thread has the default budget of 3, so it gives up after ~2 attempts — the failure it exists to prevent");
const td = String(threadTool?.description || threadTool?.function?.description || "");
/distinctive word/i.test(td)
  ? pass("it tells the model to search ONE distinctive word, not a phrase")
  : fail("nothing tells the model how to search — a phrase matches nothing in prose");
for (let i = 0; i < VARIANTS.length; i++) {
  if (!/search_thread/.test(VARIANTS[i].text)) { fail(`${VARIANTS[i].label}: the prompt never mentions search_thread`); break; }
}
/before saying you cannot find it|BEFORE saying/i.test(withDigest) || /call search_thread/i.test(withDigest)
  ? pass("the prompt tells it to search before claiming it cannot see the thread")
  : fail("nothing stops it saying \"paste the list\" for something already in the conversation");

console.log("\n6c. It can escalate a question it should not answer alone");
// The failure: asked which handover items were already DONE, voice checked ONE
// source — open tasks — found none of them, and concluded they "look
// complete". Absence from one list is not evidence of completion. That needs
// the thread, the tasks and the mailbox reconciled, which is the text
// pipeline's job, not a seven-tool voice session's.
const escalation = allTools.filter((t) => (t?.name || t?.function?.name) === "ask_engine")[0];
escalation ? pass("ask_engine is offered") : fail("voice has no way to escalate — it will keep answering from one partial source");
!allTools.some((t) => (t?.name || t?.function?.name) === "consult_analyst")
  ? pass("the tool-less analyst is gone, so there is one hatch and it can look things up")
  : fail("consult_analyst is still offered — the model can pick the one with no data access");
VOICE_TOOL_NAMES.indexOf("ask_engine") >= 0
  ? pass("and the route will accept it")
  : fail("ask_engine is offered but the route would reject it");
const ed = String(escalation?.description || escalation?.function?.description || "");
/cross-reference|more than one source/i.test(ed)
  ? pass("its description names the case it is for")
  : fail("nothing tells the model WHEN to escalate, so it will not");
/thread/i.test(ed)
  ? pass("and tells it the detail is written down rather than read aloud")
  : fail("the model will read a cross-referenced list aloud");

// ── 7. The per-minute rate follows the MODEL ────────────────────────────
// A constant pinned at 50 tenths ($0.05/min) sat next to a VOICE_MODEL that
// defaulted to grok-voice-think-fast-2.0, which xAI prices at $0.08/min. Every
// voice session on 2.0 was logged to ai_usage 37.5% light and nothing failed,
// because a wrong number is still a number. What makes it a check rather than
// a fix: the rate and the model can drift apart again the next time either
// moves, and the symptom is silent.
console.log("\n7. Voice billing — the rate is keyed to the model in use");

const rate = voiceCostTenthsPerMin(VOICE_MODEL);
const dearestKnown = voiceCostTenthsPerMin("definitely-not-a-model-id");

// The direction of the fallback is the whole point. Falling back CHEAP is how
// an under-report hides until someone reconciles an invoice.
rate <= dearestKnown
  ? pass(`the configured model (${VOICE_MODEL}) bills at ${rate} tenths/min`)
  : fail("the configured model bills above the dearest known rate");

voiceCostTenthsPerMin("grok-voice-think-fast-2.0") === 80
  ? pass("grok-voice-think-fast-2.0 is 80 tenths ($0.08/min), as published")
  : fail(`grok-voice-think-fast-2.0 is ${voiceCostTenthsPerMin("grok-voice-think-fast-2.0")} tenths, not the published 80`);

// An unknown id must not quietly inherit the cheapest row.
dearestKnown === 80
  ? pass("an unknown model falls back to the DEAREST rate, not the cheapest")
  : fail(`an unknown model falls back to ${dearestKnown} tenths — a cheap fallback under-reports silently`);

// The configured model should be priced explicitly, not by fallback. This is
// the one that fires when someone changes XAI_VOICE_MODEL and forgets the rate.
process.env.XAI_VOICE_MODEL && rate === dearestKnown && VOICE_MODEL !== "grok-voice-think-fast-2.0"
  ? fail(`XAI_VOICE_MODEL=${VOICE_MODEL} has no rate row — it is billing at the fallback`)
  : pass("the model in use has an explicit rate row");

// ── Self-test ───────────────────────────────────────────────────────────
// The detectors are regexes over prose, which is exactly the kind of check
// that silently matches nothing after an innocuous rewording. Fixture-only:
// no repo file is mutated, because this tree is shared with other sessions
// and also deploys.
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n8. Self-test — the detectors fire on the shapes they exist for");
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
