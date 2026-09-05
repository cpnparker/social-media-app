# Content Optimizer — ledger & spend-control fixes

From a 2026-08-25 audit of every AI call site under `lib/optimizer/` and
`app/api/optimizer/`, adversarially verified against the files. Line numbers
below are the verified ones.

**Context:** the optimizer is deployed but dark until its migration runs, so
these are **pre-launch fixes, not a live leak**. That is the good news — P1 and
P2 are much cheaper to fix now than after the feature carries traffic.

**What is already correct, so nobody "fixes" it:** all four routes write
`type_source "optimizer"` / `type_app "engine"`, which matches exactly what
`assertServiceAllowed`'s spend query, the service registry, the Control Centre
and the usage dashboard read — no string mismatch anywhere. And every route
calls `logAiUsage` **before** parsing, so demoted sub-queries, dropped novelty
claims, unparseable JSON and truncated responses are all billed *and* logged.
That is the episode-extract lesson correctly applied. Preserve both properties.

---

## M — Model selection: the optimizer is 100% Claude today

Every optimizer call runs on Anthropic — judge, suggest, generate, all three
coverage legs. That is a default, not a decision, and on price/performance it
is the wrong one in most slots. **But two of these slots must not be chosen on
price at all** — read the distinction before changing anything.

| Path | Today | Recommend | Rationale |
|---|---|---|---|
| **Judge** (assess) | `claude-sonnet-5` | **grok-4.6** or **GPT-5.6 Terra** | Independence (below) + AA 61 / 57. Input-dominated |
| **Generate** (drafting) | `claude-sonnet-5` | **Gemini 3.7 Flash** | AA 56, **$3.75 output vs Sonnet's $10**, below-median verbosity |
| **Suggest** (rewrite) | `claude-sonnet-5` | **Luna** or **Gemini 3.5 Flash-Lite** | 350 max_tokens — Sonnet is absurd here |
| **Coverage fan-out** | `claude-sonnet-5` | **Luna** or **Gemini 3.5 Flash-Lite** | Mechanical structured decomposition |
| **Coverage parametric** | `claude-sonnet-5` | ⚠️ **hold — not a cost lever** | See M.2 |
| **Novelty** | `claude-haiku-4-5` | **any non-Claude family** | See M.1 — currently Claude judging Claude |

### M.1 Independence — the strongest argument here, and it isn't price

The optimizer **generates** drafts and then **judges** them. With both on
Claude, the judge is marking its own homework — a known self-preference bias,
and a real credibility problem for a product whose output is a score.

The same flaw sits inside coverage. `verify-optimizer-coverage.ts` already
asserts the novelty comparison runs on a **different model** from the one that
produced the answer — good instinct, but today that is `claude-sonnet-5`
(parametric) vs `claude-haiku-4-5` (novelty): different ids, **same family**.
Two Anthropic models are not independent judges of each other.

**Constraints to hold when you assign models:**
- `generate` family ≠ `judge` family
- `parametric` family ≠ `novelty` family

A working assignment that satisfies both: generate → Gemini 3.7 Flash,
judge → grok-4.6, fan-out → Luna, parametric → hold, novelty → Luna or Gemini.

⚠️ **Strengthen the check with the change.** CLAUDE.md notes the existing
assertion compares model ids "as widened strings on purpose", because as literal
types TypeScript proves the comparison can never be false. Extend it to compare
**families**, not ids — otherwise the current Claude-vs-Claude arrangement keeps
passing.

### M.2 The parametric leg is a measurement instrument, not a cost line

The parametric call answers the target query **without the draft**, to establish
what an AI already says about the topic — that baseline is what makes the draft
read as novel or as commodity. So the model choice *changes the meaning of the
score*: a weaker model makes everything look novel, a stronger one makes more
look commodity.

Two consequences:
1. **Do not pick it for price.** Pick a mainstream model representative of what
   real assistants answer with — the same logic that governs AuthorityOn's scan
   targets.
2. **Changing it invalidates historical comparisons.** If it moves, treat it as
   a scoring-model version bump and record it, or old and new sessions are not
   comparable.

### M.3 Where the money actually is

- **Judge and coverage fan-out are input-dominated** (full draft + rubric in,
  ordinal verdicts out) — so input and cached-input price decide them, not
  output price. Cache-read ratios are ~0.1x on Anthropic, OpenAI and Gemini and
  ~0.25x on grok-4.6, so this is close to a wash on structure; pick on rate.
- **Generate is output-dominated** (max_tokens 8000) — this is the one slot
  where output price rules. Sonnet 5's $10/MTok output against Gemini 3.7
  Flash's $3.75 for +1 AA point is the single biggest per-call saving available
  in the optimizer.
- ⚠️ **Assess's `JUDGE_SYSTEM` cache is real and working.** Any move off
  Anthropic must re-establish an equivalent cached prefix on the new vendor, or
  the rate win is partly given back. Coverage's caching is inert either way (P6).

### M.4 Prose quality is not measured by any of this

The AA Intelligence Index is a reasoning/knowledge composite. **No
writing-quality benchmark covers these models.** Generate is client-facing
prose, so run a blind bake-off — Gemini 3.7 Flash vs Sonnet 5 vs grok-4.6 on a
real brief — and judge the prose directly. The 2.7x output-cost gap is wide
enough that if Gemini's prose holds, it is the answer.

Same for the judge: score it against a set of drafts with known-good human
verdicts before switching. A cheaper judge that scores differently is not a
saving, it is a silent product change.

### M.5 Verified rates (2026-08-25)

| Model | In / cached / out per MTok | AA | Note |
|---|---|---|---|
| GPT-5.6 Luna | $0.20 / $0.02 / $1.20 | 52 max, **34 low** | strict JSON schema; 2.17x verbose |
| Gemini 3.5 Flash-Lite | $0.30 / $0.03 / $2.50 | **37** | 362 t/s; multimodal |
| Gemini 3.7 Flash | $0.75 / $0.075 / $3.75 | 56 | **below-median verbosity**; ⚠️ doubles 2027-01-01 |
| Claude Haiku 4.5 | $1.00 / $0.10 / $5.00 | 24 non-reasoning | best TTFT |
| grok-4.6 | $2.00 / $0.50 / $6.00 | **61** | 500K ctx |
| Claude Sonnet 5 *(today)* | $2.00 / $0.20 / $10.00 | 55.3 | flat to 1M; +~30% tokenizer |
| GPT-5.6 Terra | $2.00 / $0.20 / $12.00 | 57 | GPQA 90.4 |

Compare on *effective* cost: multiply the output rate by measured verbosity, and
note Claude 4.7+ models emit ~30% more tokens for the same text. Sequence this
**after** P1 — swapping models while the ledger mislabels them means you cannot
measure whether the swap helped.

---

## P1 — Generate logs the wrong model on every single run

`app/api/optimizer/sessions/[id]/generate/route.ts:115` reads
`result.model || "claude-sonnet-5"`. **`StreamResult` has no `model` field —
it is `modelUsed`** (`lib/ai/providers.ts:7097`, returned by every provider
chain). The route's own inline callback type at `:100` declares
`model?: string`, so `StreamResult` stays structurally assignable, tsc stays
green, and `result.model` is `undefined` on **every** run.

Consequences:
- Every generate row is logged as `claude-sonnet-5`.
- When Anthropic fails and `providers.ts:7194` falls back to **grok-4.3**, those
  tokens are priced at Sonnet's $2/$10 instead of grok-4.3's $1.25/$2.50 — a
  **4x over-price on output** — and counted against the **claude** provider cap
  by `modelToProvider` (`lib/admin/service-control.ts:232`).
- A Control Centre model override (`providers.ts:7152-7154`) is likewise
  invisible in the ledger.

**Fix:** read `modelUsed`. The chat route already does this correctly —
`app/api/ai/conversations/[id]/messages/route.ts:1767`, with a comment at
`:1760` explaining this exact trap.

⚠️ **Do not just change the field name.** The optional inline type is what let
this ship. Type the callback against the exported `StreamResult` (or make the
field required) so the next rename cannot silently re-open it.

---

## P2 — Coverage has no kill switch and no spend cap

`app/api/optimizer/sessions/[id]/coverage/route.ts` imports no service-control
module at all. Every other AI-spending optimizer route does:
assess `:164`, suggest `:62`, generate `:70`.

Because it uses the raw Anthropic SDK rather than `createStreamingResponse`, it
also escapes the global provider cap (`isOverProviderCap`,
`lib/ai/providers.ts:7164`, inside the `:7148-7171` block).

It is simultaneously **the most expensive press in the studio**: three calls per
press (fan-out Sonnet @4000, parametric Sonnet @1200, novelty Haiku @4000).

Net effect: **coverage spend counts toward the `engine/optimizer` bucket, so it
can push assess/suggest/generate over the cap while remaining itself
unstoppable.** Flipping `killed` for engine/optimizer stops generation,
assessment and rewrites and leaves the three priciest calls running.

**Fix:** add `assertServiceAllowed("engine", "optimizer")` before the calls,
matching the other three routes.

*(Note: the route is not ungated — `requireOptimizer` at `:44` →
`app/api/optimizer/_lib/access.ts:45` → `hasEngineAiAccess`. But revoking that
kills all of EngineAI for the user. It is not a spend control.)*

---

## P3 — Generate writes nothing on failure, and a disconnect can double-charge

`onComplete` runs at `lib/ai/providers.ts:7306-7307` **inside the try**. The
catch at `:7309` emits an SSE error and returns without it. So if Anthropic
throws *and* the grok-4.3 fallback also throws, **two billed attempts produce
zero ai_usage rows.**

Worse: the Anthropic branch's inner catch at `providers.ts:7188` is
unconditional (`catch (anthropicErr: any)`). A client disconnecting mid-stream
makes `controller.enqueue` throw — which is read as "Anthropic failed" and
triggers a **full grok-4.3 generation into the same dead controller**, which
throws again. **One writer navigating away can pay for two complete
generations, with no ledger row for either.**

There is also a partial-stream leak: `streamAnthropic` accumulates usage in
locals (`providers.ts:7710-7713`) and only returns it at the end; on a
mid-stream throw those already-billed tokens are discarded when `result` is
reassigned by the fallback at `:7194`.

**Fix, in order:**
1. Distinguish an aborted/dead-controller error from a provider error at
   `:7188` so a disconnect does **not** trigger a second generation.
2. Log usage on the failure path — surface whatever usage the failed leg
   accumulated rather than discarding it.
3. Only then worry about the partial-stream totals.

⚠️ This is shared streaming code — it affects chat, scheduled runs and RFP too,
not just the optimizer. Change it deliberately and check the other callers.

---

## P4 — Coverage re-bills its own failures

- **The memo caches success and not failure.** `coverage/route.ts:192-208`
  writes the memo on any *partial* success; the both-legs-failed path returns
  502 at `:174` writing nothing. So the input that reliably fails is precisely
  the one never cached, and **every re-press pays all three calls again.**
- **No character ceiling and no `stop_reason === "max_tokens"` check.** Assess
  documents this failure at `:71-81` and defends with `MAX_ASSESS_CHARS=40000`;
  coverage has no equivalent.
- **The cache is probably inert in production right now.** It depends on
  `config_coverage` and the widened `type_kind` constraint at the tail of
  `supabase/migrations/20260821_content_optimizer.sql:382-388` — a manually-run
  migration. Until it runs, the read returns nothing and the insert fails
  (42703/PGRST204). The route detects this and appends a `notAssessable` note at
  `:203-207` but still serves. **Every press is 3 fresh calls, indefinitely.**
- **The panel's copy is untrue in that state** —
  `components/optimizer/CoveragePanel.tsx:74` says "cached against this draft,
  so reopening is free until you edit."
- **No in-flight guard and no rate limit.** `assess/route.ts:185-194` claims the
  session with a conditional update *specifically because* two concurrent clicks
  both passed every guard and both billed. Coverage has only the client's
  `disabled={loading}` (per component instance) — a second tab, a reload
  mid-run, or a direct POST all bill in full. `middleware.ts` applies no rate
  limit to `/api/optimizer`.

**Fix:** memoise the failure (or a negative marker), add a character ceiling,
add an in-flight claim like assess's, and confirm the migration has run before
trusting the panel's copy.

---

## P5 — The genuinely unlogged class: timeouts and fire-and-forget

Failed legs are unlogged on every route (the throw happens inside
`messages.create`, so the log line is never reached). For clean 4xx/5xx that is
harmless — nothing was billed. **The real exposure is a client-side timeout or
abort where the upstream request completed and billed:**

- coverage runs two round trips of up to 4000 output tokens against
  `maxDuration=120`;
- suggest sets `maxDuration=30` against the Anthropic SDK's much longer default,
  so a slow Sonnet response can kill the invocation mid-call.

Separately, **`logAiUsage` is fire-and-forget at all four sites** —
`lib/ai/usage-logger.ts:28` issues an unawaited insert and returns void, and the
repo uses no `waitUntil`/`after`. On serverless the instance can freeze once the
response is written. Most exposed: `suggest/route.ts:122` (only synchronous work
follows) and coverage's 502 path at `:174`. Assess and coverage's success path
are safer only by accident — awaited DB writes hold the instance open.

**Fix:** await the insert, or route it through `waitUntil`. Raise suggest's
`maxDuration`, or lower the SDK timeout below it so the failure is catchable.

---

## P6 — Prompt caching on the coverage legs is inert

All three legs set `cache_control: {type: "ephemeral"}` on their system block
(`coverage/route.ts:106`), but `FANOUT_SYSTEM`, `PARAMETRIC_SYSTEM` and
`NOVELTY_SYSTEM` are each **well under 1,000 tokens** — below Anthropic's
minimum cacheable prefix (1,024 for Sonnet, 2,048 for Haiku). **No cache is ever
written or read; every press pays full uncached input.** The draft sits in the
user message and was never cacheable anyway.

Either remove the misleading `cache_control`, or restructure so the cached
prefix clears the minimum. (Assess's `JUDGE_SYSTEM` *is* large enough — its
`cache_control` works. Do not change that one.)

---

## P7 — The ledger cannot separate coverage spend from judge spend

All four routes write `type_source "optimizer"`, so the cost of the new
coverage/novelty feature is not attributable from the ledger at all — you can
only infer it from `name_model` (Haiku rows are novelty-only today, since the
Stage-2 gate is unwired). If per-feature attribution matters, split the source
string (`optimizer-coverage`, `optimizer-judge`, …).

⚠️ If you split it, **update `assertServiceAllowed`'s spend query and the
Control Centre aggregation together** — they filter on `type_source`, so a new
string silently drops out of the cap. That is the same gate-source/log-source
mismatch class already found in the sibling AuthorityOn codebase.

---

## P8 — Documentation and registry drift (no spend impact, but misleading)

- `lib/admin/service-registry.ts:218` describes "Haiku for the suggestion gate".
  The Stage-2 Haiku gate is **dead code** — `GATE_MODEL`
  (`lib/optimizer/suggest-gate.ts:171`), `buildGatePrompt` and
  `parseGateResponse` have no call site outside
  `scripts/verify-optimizer-gate.ts`. Only the deterministic `preGate` runs
  (assess `:282`, suggest `:151`), and the suggestion path that *does* run bills
  **Sonnet**. Either wire the gate or correct the description.
- The assess route's header promises "**THE RATE LIMIT. Per session**". There is
  no rate limiting anywhere under `app/api/optimizer` or `lib/optimizer`. Only
  the memo, the in-flight claim and the spend cap are real.
- `assertServiceAllowed` is weaker than it reads: `isOverHardCap`
  (`lib/admin/service-control.ts:128-143`) returns false unless the
  engine/optimizer row has `hard_block` **and** a daily/monthly cap set, and
  `getRecentSpendCents` **fails open** — it catches its own query error and
  returns zero spend (`:107-111`). Accurate summary: *kill switch yes; hard cap
  only if configured, and fail-open.*

---

## Verification

Per the house rule, **prove each check fails first** — reintroduce the bug,
watch it go red, restore. Do this in a worktree, not in the shared tree.

New assertions worth having:

1. **Assert `modelUsed` is READ, not that the line exists.** The P1 bug is
   invisible to a grep for `logAiUsage`. Exercise a fallback and assert the
   logged model is grok-4.3.
2. **Every AI-spending optimizer route calls `assertServiceAllowed`.** Assert on
   the route module set, so a new route is a failure by default rather than an
   omission nobody notices.
3. **Logging is reached on the failure path**, not only on success.
4. **`cache_control` blocks clear the provider's minimum cacheable prefix** —
   otherwise the annotation is decorative.

⚠️ **Audit-tooling trap:** `lib/optimizer/judge.ts` contains NUL bytes (the
memo-key join separator, ~`:605`), so `file` reports it as `data` and plain
`grep` treats it as binary and prints **nothing**. Use `grep -a` or open it. A
model call added there would be invisible to a grep-based sweep. (Verified
2026-08-25: it currently has no network call.)

---

## Suggested order

**P1 → P2** before the feature carries any traffic: one is a one-line fix that
stops the ledger lying, the other is a one-line fix that puts the most expensive
press in the studio behind the kill switch. Then **P4** (repeat-billing), then
**P3** (shared streaming code — needs care and affects other callers), then
P5–P8 as cleanup.

## Non-goals

- Do not change the `type_source` wiring without also changing the cap query and
  Control Centre aggregation (P7).
- Do not remove the "log before parse" ordering on any route — it is deliberate
  and correct.
- Do not touch assess's working `cache_control` while fixing coverage's inert one.
