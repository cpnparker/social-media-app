/**
 * Every OpenAI request the app makes is one the OpenAI API accepts — checked
 * through the code that makes it. Run with
 * `npx tsx scripts/verify-openai-chain.ts --self-test`.
 *
 * WHY. Two faults were live at once on 2026-09-23, and neither failed loudly:
 *
 *  1. streamOpenAI sent `max_tokens` and `temperature: 0.4` to every model.
 *     GPT-5 and later 400 on both, so every GPT-6 Astra, GPT-5.6 Terra and
 *     auto "fast" turn since 2026-08-14 failed on round 0 and withGrokFallback
 *     answered it with Grok. The ledger held no OpenAI rows at all, which reads
 *     as "nobody picks OpenAI", not as "OpenAI is broken".
 *  2. The four cheap-tier jobs, moved to GPT-5.6 Luna on 2026-09-21, sent a
 *     temperature with no reasoning effort — also a 400. Memory extraction,
 *     summaries, client context and consolidation failed on every call into a
 *     console.error; the only trace was their rows vanishing from the ledger.
 *
 * And a third rule surfaced while fixing those: on /v1/chat/completions a
 * GPT-5+ model refuses function tools at any reasoning effort but "none", and
 * GPT-6 Astra refuses "none" — so with tools registered, Astra cannot run on
 * this chain at all.
 *
 * HOW. The app's REAL functions run — createStreamingResponse for chat turns,
 * the nine cheap-tier call sites for background work — against a stand-in for
 * the SDK's chat.completions.create. The stand-in enforces the contract below,
 * which is what the live API enforced when probed on 2026-09-23, and answers
 * the way the API does when a request passes. It is written independently of
 * lib/ai/openai-params.ts ON PURPOSE: a check that asked the app's own helper
 * what is allowed would pass whatever the helper said. So this asserts what
 * the app SENDS, through the code that sends it, and what happens next: a
 * chat turn must be answered by the model it resolved to (no `fallback`
 * event), and a background call must return a real result AND write its
 * ledger row — the row whose absence was the only symptom of fault 2.
 *
 * Nothing touches the network. The SDK method is replaced on its prototype,
 * and fetch is replaced so the ledger's Supabase inserts are recorded instead
 * of sent; any other fetch fails the run.
 *
 * MUTATION LOG.
 *  - KILLED, against the pre-fix tree (a `git archive` of HEAD before the
 *    change, with this file copied in — the shared working tree was never
 *    touched): the chat turns went red on `max_tokens` and fell back to Grok,
 *    and every cheap-tier site went red on temperature-without-effort with no
 *    ledger row. See the commit message for the run.
 *  - KILLED BY THE SELF-TEST: each contract rule against a synthetic request
 *    that breaks only that rule; the fallback detector against a stand-in that
 *    refuses every OpenAI call; the ledger detector the same way.
 */
import OpenAI from "openai";

// ── The contract, as probed live 2026-09-23 ──────────────────────────────
/** Violations OpenAI would answer with a 400. Empty = the API accepts it.
 *  Covers GPT-5 and later only; anything else is outside this contract. */
export function contractViolations(body: any): string[] {
  const out: string[] = [];
  const major = /^gpt-(\d+)/.exec(String(body?.model ?? ""));
  if (!major || Number(major[1]) < 5) return out;
  const effort = body.reasoning_effort; // undefined = the model default, which reasons
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  if (body.max_tokens !== undefined) {
    out.push("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
  }
  if (body.model === "gpt-6-astra" && effort === "none") {
    out.push("Unsupported value: 'reasoning_effort' does not support 'none' with this model.");
  }
  if (body.temperature !== undefined && body.temperature !== 1 && effort !== "none") {
    out.push(`Unsupported value: 'temperature' does not support ${body.temperature} with this model. Only the default (1) value is supported.`);
  }
  if (hasTools && effort !== "none") {
    out.push("Function tools with reasoning_effort are not supported for this model in /v1/chat/completions.");
  }
  return out;
}

// ── The stand-in ────────────────────────────────────────────────────────
type Captured = { baseURL: string; body: any; violations: string[] };
const captured: Captured[] = [];
const ledger: { name_model: string; type_source: string }[] = [];
const strayFetches: string[] = [];
let nextReply = "OK";
let refuseAllOpenAI = false; // self-test: prove the detectors can go red

function isOpenAIHost(baseURL: string): boolean {
  return /api\.openai\.com/.test(baseURL);
}

async function* fakeStream(text: string) {
  yield { choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] };
  yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  yield { choices: [], usage: { prompt_tokens: 40, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } };
}

function installStandIns() {
  const proto = Object.getPrototypeOf(new OpenAI({ apiKey: "verify" }).chat.completions);
  proto.create = function (body: any) {
    const baseURL = String((this as any)?._client?.baseURL ?? "");
    const violations = isOpenAIHost(baseURL) ? contractViolations(body) : [];
    captured.push({ baseURL, body, violations });
    if (isOpenAIHost(baseURL) && (refuseAllOpenAI || violations.length)) {
      const err: any = new Error(`400 ${refuseAllOpenAI ? "refused by the self-test" : violations[0]}`);
      err.status = 400;
      return Promise.reject(err);
    }
    if (body.stream) return Promise.resolve(fakeStream(nextReply));
    return Promise.resolve({
      choices: [{ index: 0, message: { role: "assistant", content: nextReply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
    });
  };

  const supabaseHost = "verify-openai-chain.invalid";
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.includes(supabaseHost)) {
      if (/\/ai_usage/.test(url) && String(init?.method ?? "GET").toUpperCase() === "POST") {
        try {
          const rows = JSON.parse(String(init?.body ?? "[]"));
          const list = Array.isArray(rows) ? rows : [rows];
          for (let i = 0; i < list.length; i++) ledger.push({ name_model: list[i].name_model, type_source: list[i].type_source });
        } catch { /* recorded as nothing */ }
        return new Response("", { status: 201 });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    strayFetches.push(url);
    throw new Error(`verify-openai-chain: unexpected network call to ${url}`);
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${supabaseHost}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "verify";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "verify";
  process.env.OPENAI_API_KEY = "verify";
  process.env.XAI_API_KEY = "verify";
}

// ── Reporting ───────────────────────────────────────────────────────────
let failures = 0;
function ok(msg: string) { console.log(`  ok   ${msg}`); }
function fail(msg: string) { failures++; console.log(`  FAIL ${msg}`); }

/** One chat turn through the real stream. Who answered, and was it the model asked for? */
async function chatTurn(providers: any, modelId: string) {
  let modelUsed = "";
  let fallbackReason = "";
  const stream: ReadableStream = providers.createStreamingResponse(
    [{ role: "user", content: "Reply with the single word OK." }],
    { model: modelId, systemPrompt: "You are terse.", maxTokens: 4096, webSearch: false, imageGeneration: true, source: "verify-openai-chain" },
    async (r: any) => { modelUsed = r.modelUsed; }
  );
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("data: ")) continue;
      try { const ev = JSON.parse(lines[i].slice(6)); if (ev.fallback) fallbackReason = String(ev.reason ?? "fallback"); } catch { /* [DONE] */ }
    }
  }
  return { modelUsed, fallbackReason };
}

async function main() {
  const selfTest = process.argv.indexOf("--self-test") >= 0;
  installStandIns();
  const providers = await import("../lib/ai/providers");
  const { FAST_MODEL } = await import("../lib/ai/auto-router");
  const { CHEAP_MODEL } = await import("../lib/ai/cheap-model");
  const memory = await import("../lib/ai/memory-extraction");
  const summary = await import("../lib/ai/conversation-summary");
  const consolidation = await import("../lib/ai/memory-consolidation");
  const clientContext = await import("../lib/ai/client-context-extract");

  // ── 1. Chat: every id that resolves to the OpenAI chain is answered by it ──
  console.log("\nChat turns on the OpenAI chain are answered by OpenAI, not the fallback");
  const registry = providers.MODEL_REGISTRY as Record<string, { provider: string; apiModel: string }>;
  const ids = Object.keys(registry).filter((id) => registry[id].provider === "openai");
  if (ids.indexOf(FAST_MODEL) < 0) ids.push(FAST_MODEL);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const before = captured.length;
    const { modelUsed, fallbackReason } = await chatTurn(providers, id);
    const mine = captured.slice(before).filter((c) => isOpenAIHost(c.baseURL));
    const bad = mine.filter((c) => c.violations.length);
    const want = providers.getModelInfo(id).apiModel;
    if (fallbackReason) fail(`${id}: fell back — "${fallbackReason}"${bad.length ? ` (the API would say: ${bad[0].violations[0]})` : ""}`);
    else if (modelUsed !== want) fail(`${id}: answered by ${modelUsed}, expected ${want}`);
    else if (!mine.length) fail(`${id}: no OpenAI request was made — the check saw nothing`);
    else ok(`${id} → ${want}, ${mine.length} request(s), effort=${mine[0].body.reasoning_effort}, cap=${mine[0].body.max_completion_tokens}`);
  }

  // ── 2. The cheap tier: all nine call sites return a result AND log a row ──
  console.log("\nEvery cheap-tier call is accepted, returns a result, and writes its ledger row");
  const memoriesReply = JSON.stringify({ memories: [{ content: "Writes in British English", category: "preference", confidence: 0.9 }] });
  const fileSummaries = [{ id_asset: 1, name: "Brand style guide.pdf", type: "application/pdf", summary: "Colour palette navy and teal; logo usage; typography.", chars_extracted: 900 }];
  const similar = [{ memory: { id: "m1", content: "Prefers British spelling", category: "preference", strength: 1, reinforcedCount: 1, dateCreated: "2026-09-01", dateLastAccessed: "2026-09-20", source: "chat" }, similarity: 0.8 }];
  const sites: { name: string; source: string; reply: string; run: () => Promise<unknown>; succeeded: (r: any) => boolean }[] = [
    { name: "extractMemories", source: "memory-extract", reply: memoriesReply, run: () => memory.extractMemories("I always write in British English.", "Noted.", []), succeeded: (r) => Array.isArray(r) && r.length > 0 },
    { name: "extractMeetingMemories", source: "memory-extract-meeting", reply: memoriesReply, run: () => memory.extractMeetingMemories({ meetingTitle: "Kick-off", meetingDate: "2026-09-22", summary: "Agreed British English throughout." }, []), succeeded: (r) => Array.isArray(r) && r.length > 0 },
    { name: "extractTaskMemories", source: "memory-extract-task", reply: memoriesReply, run: () => memory.extractTaskMemories({ taskTitle: "Localise copy to British English" }, []), succeeded: (r) => Array.isArray(r) && r.length > 0 },
    { name: "generateConversationSummary", source: "summary-generate", reply: "Discussed the launch plan.", run: () => summary.generateConversationSummary([{ role: "user", content: "Plan the launch" }, { role: "assistant", content: "Here is a plan." }]), succeeded: (r) => typeof r === "string" && r.length > 0 },
    { name: "updateConversationSummary", source: "summary-update", reply: "Discussed the launch plan and budget.", run: () => summary.updateConversationSummary("Discussed the launch plan.", [{ role: "user", content: "And the budget?" }]), succeeded: (r) => typeof r === "string" && r.length > 0 },
    { name: "classifyMemoryAction", source: "memory-consolidate", reply: JSON.stringify({ action: "REINFORCE", targetId: "m1" }), run: () => consolidation.classifyMemoryAction({ content: "Uses British spelling", category: "preference", confidence: 0.9 }, similar as any), succeeded: (r) => r?.action === "REINFORCE" },
    { name: "summariseDocument", source: "client-context", reply: "A brand guide.", run: () => clientContext.summariseDocument(new OpenAI({ apiKey: "verify" }), "Brand guide text", "guide.pdf"), succeeded: (r) => typeof r === "string" && r.length > 0 },
    { name: "consolidateProfile", source: "client-context", reply: "Client profile.", run: () => clientContext.consolidateProfile(new OpenAI({ apiKey: "verify" }), fileSummaries as any, "Acme"), succeeded: (r) => typeof r === "string" && r.length > 0 },
    { name: "extractVisualIdentity", source: "client-context", reply: JSON.stringify({ palette: ["navy", "teal"] }), run: () => clientContext.extractVisualIdentity(new OpenAI({ apiKey: "verify" }), fileSummaries as any, "Acme"), succeeded: (r) => !!r && typeof r === "object" },
  ];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    nextReply = s.reply;
    const before = captured.length;
    const ledgerBefore = ledger.length;
    let result: unknown;
    try { result = await s.run(); } catch (e: any) { fail(`${s.name}: threw — ${String(e?.message ?? e).slice(0, 120)}`); continue; }
    await new Promise((r) => setTimeout(r, 20)); // logAiUsage is fire-and-forget
    const mine = captured.slice(before).filter((c) => isOpenAIHost(c.baseURL) && c.body.model === CHEAP_MODEL);
    const rows = ledger.slice(ledgerBefore).filter((r) => r.name_model === CHEAP_MODEL && r.type_source === s.source);
    if (!mine.length) fail(`${s.name}: made no ${CHEAP_MODEL} request`);
    else if (mine[0].violations.length) fail(`${s.name}: the API would refuse it — ${mine[0].violations[0]}`);
    else if (!s.succeeded(result)) fail(`${s.name}: returned ${JSON.stringify(result)} — the call's result never reached the caller`);
    else if (!rows.length) fail(`${s.name}: no ledger row for ${CHEAP_MODEL}/${s.source}`);
    else ok(`${s.name}: accepted (effort=${mine[0].body.reasoning_effort}, temperature=${mine[0].body.temperature}), result returned, ledger row written`);
  }
  nextReply = "OK";

  // ── 3. Preconditions: the check saw what it claims to have checked ──────
  console.log("\nPreconditions — the check exercised what it claims to");
  const openaiCalls = captured.filter((c) => isOpenAIHost(c.baseURL));
  if (openaiCalls.length) ok(`${openaiCalls.length} OpenAI requests intercepted`); else fail("no OpenAI request was intercepted — nothing above was tested");
  if (openaiCalls.some((c) => Array.isArray(c.body.tools) && c.body.tools.length)) ok("tools were registered on at least one chat request, so the tools rule was exercised");
  else fail("no request carried tools — the tools-with-effort rule was never exercised");
  if (ledger.length) ok(`${ledger.length} ledger inserts recorded`); else fail("no ledger insert was recorded — the ledger assertion tested nothing");
  if (strayFetches.length) fail(`unexpected network calls: ${strayFetches.slice(0, 3).join(", ")}`); else ok("no network call left the process");

  // ── Self-test ───────────────────────────────────────────────────────────
  if (selfTest) {
    console.log("\nSelf-test — each detector against synthetic bad input");
    const tool = [{ type: "function", function: { name: "t", parameters: { type: "object", properties: {} } } }];
    const cases: [string, any, boolean][] = [
      ["the OLD chat shape (max_tokens + temperature 0.4) is refused", { model: "gpt-6-luna", max_tokens: 4096, temperature: 0.4 }, true],
      ["the OLD cheap-tier shape (temperature, no effort) is refused", { model: "gpt-5.6-luna", max_completion_tokens: 500, temperature: 0.3 }, true],
      ["tools at the default effort are refused", { model: "gpt-6-sol", max_completion_tokens: 4096, tools: tool }, true],
      ["gpt-6-astra at effort none is refused", { model: "gpt-6-astra", max_completion_tokens: 4096, reasoning_effort: "none" }, true],
      ["tools + temperature at effort none are accepted", { model: "gpt-6-luna", max_completion_tokens: 500, reasoning_effort: "none", temperature: 0.3, tools: tool }, false],
      ["a pre-GPT-5 id is outside the contract", { model: "deepseek-chat", max_tokens: 4096, temperature: 0.4 }, false],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [name, body, shouldRefuse] = cases[i];
      const refused = contractViolations(body).length > 0;
      if (refused === shouldRefuse) ok(`detects: ${name}`); else fail(`detector wrong: ${name}`);
    }
    refuseAllOpenAI = true;
    const r = await chatTurn(providers, FAST_MODEL);
    if (r.fallbackReason) ok(`detects a refused turn as a fallback ("${r.fallbackReason}")`); else fail("a refused OpenAI turn was NOT seen as a fallback — the chat detector cannot go red");
    const ledgerBefore = ledger.length;
    nextReply = memoriesReply;
    const res = await memory.extractMemories("I always write in British English.", "Noted.", []);
    await new Promise((r2) => setTimeout(r2, 20));
    if ((!Array.isArray(res) || !res.length) && ledger.length === ledgerBefore) ok("detects a refused background call: no result, no ledger row");
    else fail("a refused background call still produced a result or a ledger row — the cheap-tier detector cannot go red");
    refuseAllOpenAI = false;
    console.log("  — all detectors confirmed working");
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILURE(S).\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
