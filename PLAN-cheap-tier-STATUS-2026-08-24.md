# Status handoff → the LLM pricing review session

**Date:** 2026-08-24 · **Repo:** `social-media-app` (EngineAI) · **All items below are committed AND deployed to production.**

Re: `PLAN-cheap-tier-model-update.md` and memory `llm-price-performance-audit-2026-08`.

The plan was good — it independently found the Luna registration gap, the web-search
override hazard, and the retired slugs. Three of its premises turned out to be wrong,
and the measured bill reorders its priorities substantially. Details below.

---

## 1. Shipped (7 commits)

| Commit | What |
|---|---|
| `7ca5510` | Luna registered first-class; 3 wire slugs given rate rows; `deepseek-chat` removed from picker; RFP `grok-3` → `grok-4.3`; `executeWebSearch` named + **usage logging added**; new `scripts/verify-model-ids.ts` |
| `6488ccc` | `RATE_EXPIRIES` + expiry check; AI usage dashboard wired to shared label fn |
| `3d68254` | Plan's A-0 baseline query corrected |
| `44e5c00` | Sonnet 5 expiry **reverted** (see §2.1) |
| `363897b` | AdminDialog label map wired to shared fn |
| `c87b755` | `units_cache_read` / `units_cache_write` persisted (migration ran first) |
| `0236811` | **Prompt-cache invalidation fixed** (see §3) |

Plan items closed: **A-1 ✅, A-4 🟡 (see §4.2), A-5 ✅.** A-2/A-3 not started. Part B untouched.

---

## 2. Corrections to the plan's premises

### 2.1 The Sonnet 5 cliff does not exist — do not plan around it

`claude-sonnet-5` at **$2/$10 is PERMANENT.** Anthropic cancelled the 1 Sep rise to
$3/$15 on 2026-08-10. I briefly added a `RATE_EXPIRIES` entry for it from a
pricing table cached in June, then removed it the same day against the provider's
own page.

**Consequence for the plan:** the "Sonnet 5 price cliff 31 Aug" driver is void, and
the grounded leg is *better* value than the plan assumed. The only live rate expiry
is Google's: `gemini-3-flash` $0.75/$3.75 → $1.50/$7.50 on **2027-01-01**, now
recorded in `RATE_EXPIRIES` and enforced by check 6 of `verify-model-ids.ts`.

### 2.2 `gpt-5-6-luna` existed in no table

The id the whole plan is written against was **not in `MODEL_REGISTRY`** — Luna
existed only as the `apiModel` of the hidden legacy `gpt-4o-mini` entry. And
`getModelInfo` answers an unknown id with `claude-sonnet-5` rather than throwing.

So `FAST_MODEL = "gpt-5-6-luna"` would have routed the cheap tier to **Sonnet 5 at
15× Luna's input price**, while the ledger showed nothing wrong — it would correctly
log the Sonnet call it actually made. A cost-cutting change that raises cost and
reports success. Now registered, priced under both spellings, labelled, and guarded.

**Note the spelling convention:** dashed (`gpt-5-6-luna`) is the registry id, dotted
(`gpt-5.6-luna`) is the wire slug. Both need rate rows and labels.

### 2.3 The A-0 baseline query had all five column names wrong

`model`, `tokens_input`, `tokens_output`, `cost_tenths_cent`, `created_at` — none
exist. Real columns: `name_model`, `units_input`, `units_output`,
`units_cost_tenths`, `date_created`, plus `type_app` (`'engine'`). Corrected in the
plan. `units_cost_tenths` is **tenths of a cent** → USD is `/1000`.

---

## 3. The measured bill reorders everything

30 days to 2026-08-24, `type_app='engine'`: **$139.94 over 3,145 rows.**

| | calls | spend | share |
|---|---:|---:|---:|
| chat (`enginegpt`) | 582 | **$124.98** | **89%** |
| everything else | 2,249 | $10.31 | 7% |

Chat averages **66,703 input tokens/call** against 2,833 elsewhere. The
`claude-sonnet-5` line alone is $110.93 at 73,541 in / 1,166 out — **a 63:1 ratio.**

**Part A executed perfectly end-to-end is worth ~$11/month of a ~$140 bill.** The row
the plan marks "no change" is 79% of it.

### 3.1 The prefix cache was being written every turn and never read

Found and fixed (`0236811`). Two independent causes, both inside the region the code
calls stable:

- **`fenceUntrusted` mints a fresh `Math.random()` nonce per call**, and three call
  sites appended to `prompt` rather than `volatileTail` (MeetingBrain snapshot,
  client asset summaries, client meeting summaries). Any conversation with that
  context — most — discarded the whole prefix every turn.
- **Per-turn route appends filed as stable.** The required-tools hint is built from
  the current message; the LiveSearch block flips with `searchMode`. Both used `+=`
  *after* `buildSystemPrompt` returned, landing them past the close marker. Measured:
  swapping one tool hint diverged at **char 53,084 of 53,090**.

A cache write costs 1.25× input, a read 0.1× — so this was **worse than not caching
at all**. Measured across two realistic consecutive turns, prefix now byte-identical
at 54,064 chars:

| | /month, Sonnet chat line |
|---|---:|
| broken (write every turn) | $15.47 |
| no caching at all | $12.37 |
| **fixed** | **$1.24** |

**≈$14/mo measured**, assuming one prefix load per call. Rounds-per-turn is
unmeasured and scales it linearly (2 rounds ≈ $28, 3 ≈ $43). New `appendVolatile`
in `lib/ai/prompt-cache.ts` is the API for per-turn route appends.

**This is the only change so far that reduces real spend.** Everything else in §1
makes the numbers *truer*, not smaller.

### 3.2 Sequencing consequence

The `imageGeneration` flag split was worth **$9.27/mo before** the cache fix and
**$0.74/mo after**. Fixing the cache destroyed 92% of that lever. General rule:
**payload/caching work before any prompt-slimming**, or you take a behaviour risk
for a saving you are about to delete.

---

## 4. Measurement caveats — read before quoting any number

### 4.1 $139.94 is neither a floor nor a ceiling; it is distorted in both directions

- `claude-sonnet-5` was priced **$3/$15** in the ledger from 2026-07-10 to
  2026-08-17 against a true $2/$10 → up to **$32.71 of the $110.93 was never
  charged**.
- `grok-4-1-fast` was priced **6.25× low** for ~20 days of the same window.
- `executeWebSearch` logged **nothing at all** until `7ca5510`.
- The nine largest lines sum to $135.29/2,831 rows — $4.65 and 314 rows unlisted.

These partly cancel. A defensible read is **true spend ≈ $107–140**. The day-split
query in the audit resolves it exactly.

### 4.2 Still unverified — needs a human

`lib/rfp/extract.ts` sends **`grok-3-mini`**, which is *not* on xAI's confirmed
retirement list (unlike `grok-3`). Left alone rather than guessed at, with the
uncertainty written into the file. **If it has been retired, that line understates
spend** — the dangerous direction, since the ledger feeds a hard provider cap.
Needs an xAI console check.

### 4.3 Next month's number will RISE even though spend fell

Web-search spend is now logged and the cache columns are populated. **Do not compare
next month to $139.94.**

---

## 5. New guards

- **`scripts/verify-model-ids.ts --self-test`** — asserts registry, rate table and
  label map agree; queries them through the same functions the app calls. 9
  detectors, each proven to fire against synthetic input. Check 6 enforces
  `RATE_EXPIRIES`. It caught two live faults on first run (`deepseek-chat`
  selectable a month after the alias retired; `grok-4.3`/`grok-4.6` billing at the
  $3/$15 fallback) **and one wrong assertion of my own.**
- **`scripts/verify-prompt-cache.ts`** — extended. It had been **green throughout
  both bugs in §3.1**: its fixture set neither `meetingBrainContext` nor
  `clientBackground`, so `fenceUntrusted` never ran; and its check 2 *positively
  asserted* the per-turn appends should be cached — a check written for the previous
  bug entrenching the next one. Now builds what the app builds, asserts each append
  lands on the correct side, and self-tests both bug shapes. Watched red before the
  fix, green after.

Both documented in `CLAUDE.md`.

---

## 6. Open decisions (owner's, not ours)

1. **DPA / sub-processor** — gates all of Part B and A-2/A-3. Unchanged.
2. **The web-search default** — `query-router.ts:389` turns `searchMode` on for
   anything it fails to classify; `route.ts:1380` then promotes those turns to a
   **hardcoded `"claude-sonnet-5"`**. This is the dominant input to the largest cost
   line, and it is a *default*, not a user choice. Directionally the biggest
   remaining lever, but genuinely unquantified — an earlier narrowing attempt lost
   web search on 13 of 20 topical drafting prompts. **Do not quote the $70 figure**
   from the audit; it comes from a non-reproducible replay on a ledger with verified
   row-level model mislabelling.
3. **The fence nonce** — Option A (shipped: move untrusted blocks to volatile, ~$4/mo
   of uncached context, zero security change) vs Option B (stable derived nonce,
   keeps it cached, needs a security review of forgeability). It is a
   prompt-injection defence, so it is not ours to weaken.
4. **Backfill the mispriced history?** Three known distortions in both directions.
   No month-over-month comparison is valid until decided.

---

## 7. Things NOT to do

1. **Do not point `GROUNDED_MODEL` at Luna.** It would not move the $110.93 —
   `route.ts:1380` hardcodes the literal `"claude-sonnet-5"` and never reads
   `GROUNDED_MODEL`. Where it *would* apply is document attachments, and
   `auto-router.ts:173` says why it is Claude: the only chain that takes a PDF
   natively. Luna also has **no web search**, which is what those turns are for.
2. **Do not assume Grok is the cheap destination.** `grok-4-1-fast` is retired and
   bills at grok-4.3's $1.25/$2.50; **`grok-4-6` is $2/1M input — identical to
   Sonnet 5.**
3. **Do not demote user-facing turns to Haiku 4.5** on cost grounds (AA 30 vs Sonnet
   5's 55.3).
4. **Do not set `ttl: "1h"`** until the new cache columns show reads dominating
   writes — it doubles the write premium.
5. **Do not touch the mailbox / personal-data overrides.** Contract-bound: Google's
   Workspace API Limited Use policy makes the feature lawful *conditional on vendors
   not training on the data*, and a breach revokes the Gmail scope MeetingBrain's
   scanner depends on. (Multi-vendor eligibility is being researched separately.)

---

## 8. Suggested next order

Wait for real `units_cache_read` / `units_cache_write` data (a few days) →
run the day-split query → confirm reads dominate writes → then Decision 1 →
A-2/A-3 with the live Luna probe → then Decision 2 behind a flag, measured.

**Watch the read:write ratio.** If writes still dominate after a few days, something
is still invalidating the prefix that I have not found, and that matters more than
any model swap on this list.
