# AI Cost Spike Investigation — Grok-Specific

## Context

The cost dashboard shows **Grok-only** costs spiking from ~$0.30/day to a **$10.44 peak** on Mar 18, with $9.81 on Mar 19-20. At Grok's low pricing ($0.20-$0.50/1M tokens), $10.44/day requires processing roughly **20-30 million tokens** — indicating a massive volume increase.

## Grok Models & Pricing in Use

| Internal ID | Actual API Model | Price (input/output per 1M) | Used For |
|---|---|---|---|
| `grok-4-1-fast` | `grok-4-1-fast-non-reasoning` | $0.20 / $0.50 | Default conversation model (auto-router) |
| `grok-3-mini` | `grok-3-mini` | $0.30 / $0.50 | Memory extraction, conversation summaries, client context cron, RFP doc extraction |
| `grok-3-fast` | `grok-3-fast` | ~$0.20 / $0.50 | Web search (`executeWebSearch()`) |

## Root Causes — Grok Cost Drivers

### 1. Web Search Multiplication (Mar 17) — **HIGHEST IMPACT**
- **Files**: `lib/ai/providers.ts` lines 1776-1790, 2930-2946; `lib/ai/system-prompts.ts`
- Commit `86d2532`: System prompt now mandates web search for **any factual claims** about companies, industries, trends, or current events
- When the model calls the `web_search` tool, it triggers `executeWebSearch()` which makes a **separate Grok API call** via the Responses API (`grok-3-fast`) — so **2 Grok calls per web search round**
- The tool loop allows up to **8 rounds** (`MAX_TOOL_ROUNDS = 8`, line 2677), and each round re-sends the **full conversation history + all previous tool results** as input
- Token growth per round is compounding: round 1 sends N tokens, round 2 sends N + search results + assistant response, round 3 sends all of that again, etc.
- A single message with 2 web searches across 3 rounds could easily consume **50,000+ input tokens** total

### 2. Memory Extraction on Every Message — **HIGH IMPACT**
- **File**: `lib/ai/memory-extraction.ts` line 68
- Runs `grok-3-mini` **after every single assistant response** — no batching, no throttling
- Input: system prompt + existing memories list + 2000 chars user message + 3000 chars assistant response
- At scale (e.g., 1000 messages/day), this alone = 1000 extra Grok calls/day
- Plus `memory-consolidation.ts` fires additional `grok-3-mini` calls when similar memories exist

### 3. Client Context Cron — Every Hour (Mar 17-20) — **MEDIUM-HIGH IMPACT**
- **Files**: `lib/ai/client-context-extract.ts`, `vercel.json` line 13
- Runs **hourly** (`"0 * * * *"`), processing clients' document files
- Each client with N asset files = N+1 Grok calls (N summaries via `summariseDocument()` + 1 `consolidateProfile()`)
- `summariseDocument()`: 12,000 char input + 600 max output tokens per file
- `consolidateProfile()`: all summaries concatenated + 1,500 max output tokens
- No check for whether assets have changed since last run — reprocesses everything every hour
- The resulting 800-1200 token profile is also **injected into every conversation's system prompt**, inflating all subsequent Grok conversation calls

### 4. Expanded System Prompts (Mar 20) — **MEDIUM IMPACT**
- **File**: `lib/ai/system-prompts.ts`
- ~100 lines added (doc gen, chart gen, factual accuracy rules) — system prompt grew ~15%
- Since the system prompt is sent with **every conversation message**, this adds ~200-400 extra input tokens to every single Grok call
- Combined with client context injection (~800-1200 tokens), each message's baseline input grew substantially

### 5. Tool Use Loop Token Compounding — **SYSTEMIC**
- **File**: `lib/ai/providers.ts` lines 2677-2997
- Each tool round re-sends the full `openaiMessages` array including all prior tool call results
- `query_engine` results include full JSON data (`JSON.stringify(result.data, null, 2)`) which can be **thousands of tokens**
- Web search results are injected as tool responses — each search adds 500-2000 tokens to subsequent rounds
- A message that triggers web_search → query_engine → generate_chart uses 3+ rounds, each resending everything

## Cost Math

At $0.20/1M input + $0.50/1M output for Grok 4 Fast:

| Scenario | Input tokens | Output tokens | Cost |
|---|---|---|---|
| Simple message (no tools) | ~3,000 | ~1,500 | $0.001 |
| Message with 1 web search (2 rounds) | ~15,000 | ~3,000 | $0.005 |
| Message with 2 web searches + query (3 rounds) | ~50,000 | ~5,000 | $0.013 |
| Message with client context + web search + query + chart (4 rounds) | ~80,000+ | ~8,000 | $0.020 |

To hit **$10.44/day**, you'd need roughly:
- ~500-800 complex messages (with tool use), OR
- ~2,000-3,000 simple messages + memory extraction overhead, OR
- A combination + the hourly client context cron reprocessing

## Recommended Optimizations

### Quick Wins
1. **Soften web search mandate** — Change from "USE IT for any factual claims" to "USE IT when the user is asking about current events or recent data". This is the single biggest lever since each web search triggers a separate Grok call + inflates all subsequent rounds.

2. **Reduce client context cron to every 12h** — `vercel.json`: change `"0 * * * *"` to `"0 */12 * * *"`. Add a `date_modified` check to skip clients whose assets haven't changed.

3. **Throttle memory extraction** — Don't run on every message. Skip if last extraction was < 5 messages ago, or batch extractions.

4. **Cap tool results size** — When `query_engine` returns data with a `result.summary`, send only the summary + a sample of 10-20 rows instead of the full JSON payload (`providers.ts` line 2920). For web search results, cap at ~1500 chars per search. This preserves the key data the model needs (aggregates, top rows, key facts) while cutting 50-70% of tokens in multi-round conversations. Quality impact is minimal — the model can't meaningfully analyze 100+ raw JSON rows anyway, and search results front-load important info.

### Medium-Term
5. **Cache client context in conversation config** — Fetch once per conversation session, not per message.

6. **Trim system prompt** — Condense the expanded doc gen / chart gen / factual accuracy sections.

7. **Reduce MAX_TOOL_ROUNDS** — Consider lowering from 8 to 4-5 to limit worst-case token compounding.

## Action
Commit this investigation as documentation only (no code changes). The recommended optimizations above are left for the user to implement at their discretion.
