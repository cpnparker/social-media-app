# Model update plan — EngineAI + MeetingBrain

Execution plan from the 2026-08-24 price/performance audit (12 agents; prices
verified against provider pricing pages and adversarially re-checked; both
repos inventoried). Findings in memory: `llm-price-performance-audit-2026-08`.

- **Part A** — EngineAI, `/Users/chris/social-media-app`
- **Part B** — MeetingBrain, `/Users/chris/meetingbrain`

Hand to the main session for each repo. Delete when done.

---

## 1. What changes

| # | Path | Today | Change to | Driver |
|---|------|-------|-----------|--------|
| **A** | **EngineAI** | | | |
| A1 | Auto-router FAST leg (chat default) | `grok-4-1-fast` → billed grok-4.3 $1.25/$2.50 | **Luna** $0.20/$1.20 | −84% in / −52% out |
| A2 | Background fan-out (memory, summaries, client-context, social ideas) | same retired slug | **Luna** | same, ~3–5 calls/turn |
| A3 | Live meeting copilot (T2, handoff, digest, lookup) | same retired slug | **Luna**, revert to explicit `grok-4.3` if latency suffers | latency-gated |
| A4 | `executeWebSearch` | retired slug | explicit **`grok-4.3`** + `reasoning_effort:"none"` | xAI-only tool |
| A5 | RFP search / extract | `grok-3` (retired), `grok-3-mini` | explicit **`grok-4.3`** / verify | ledger overstates 2.4–6x |
| — | Grounded leg (search, mailbox, image-gen, PDFs) | `claude-sonnet-5` | **no change** | $2/$10 permanent; mailbox Claude-only by contract |
| — | Reasoning leg | `grok-4-6` | **no change** | cheapest frontier $/task |
| — | Entity capture | `claude-opus-5` | **no change** | #1 quality, sub-cent/call |
| **B** | **MeetingBrain** | | | |
| B1 | Meeting + audio extraction (forced source default) | `grok-4-1-fast` → billed grok-4.3 | **Luna** (min: explicit `grok-4.3`) | ~18,916 calls/30d |
| B2 | Scanner extraction — slack, email, ms-email, teams, ms-calendar | `claude-sonnet-4-6` $3/$15 (Haiku on hybrid, grok-4.3 on grok pref) | **Luna** — ⚠️ see Decision 2 | ~10x cheaper |
| B3 | Dashboard analysis | `claude-sonnet-4-6` | **Luna** | huge repeated input |
| B4 | Task actions, project suggestions, focus triage | Sonnet 4.6 / Haiku 4.5 | **Luna** | small structured calls |
| B5 | Chat assistant | `claude-sonnet-4-6` | **Terra** $2/$12 | user-facing; AA 57 |
| B6 | Prep brief (local fallback) | `claude-sonnet-4-6` | **Terra** | quality path |
| B7 | Cross-vendor failure fallback | Haiku 4.5 | **`grok-4.3`** | see §4 |
| — | AssemblyAI STT, OpenAI embeddings | unchanged | **no change** | |

Everything above is additionally gated by **Decision 1** in §2.

---

## 2. Decide these first

**Decision 1 — the DPA/sub-processor check (gates all of Part B, and A2's
scope).** Are OpenAI *and* Anthropic both named as sub-processors in TCE's
privacy policy and customer DPAs? Under nFADP/GDPR each processor handling
third-party personal data (attendee speech, counterparty emails) must be
disclosed.

- Likely **yes** — MeetingBrain already sends full transcripts to xAI and task
  titles to OpenAI. If so, proceed as written.
- If **no**: run Part A only (EngineAI's background jobs carry first-party
  workspace data, not third-party mailbox content), and for Part B substitute
  the in-vendor fallback in §5 while the disclosure is updated.
- EngineAI's Gmail/personal-data paths are Claude-only **by contract**
  regardless of this answer. Not in scope to change.

**Decision 2 — the mailbox/messaging sources (B2), decided separately from the
rest.** Email, Slack, Teams and MS-calendar extraction read other people's
messages: counterparties who never consented to anything. This is the highest-
sensitivity data in either app and deserves its own answer, not a blanket one.

Three facts that should shape it:

1. **They are not Anthropic-exclusive today.** `lib/ai.ts:40` routes *every*
   source to xAI for any user whose `ai_model` preference is `grok`, and the
   cost-alert cron lists slack and email as "sources that should normally run
   on Grok" (`cron/cost-alert/route.ts:13`). So this is not a pristine-Anthropic
   path being opened up — it is already multi-vendor. Whatever posture you
   want here is worth setting deliberately across all four vendors, because
   the current one is an accident of a per-user preference toggle.
2. **Most of the saving does not need a vendor change.** These sources make
   **one LLM call per message** (`slack-scanner.ts:1116`,
   `ms-teams-scanner.ts:365`, `ms-calendar-scanner.ts:240`). B-1's batching
   plus caching cuts that materially with zero new processor. Email already
   batches 3–8 bodies and is the model to copy.
3. **Hybrid users are on Haiku 4.5 (AA 30) today** — for them Luna is a
   quality *lift* as well as a saving.

*Plan recommendation: do B-1 batching/caching on these sources first and bank
that saving now; take the Luna decision separately once Decision 1 has a real
answer.* If you want them held on Anthropic permanently, say so and they get
Sonnet 5 (§5) while everything else moves — the plan works either way.

**Decision 3 — EngineAI unattended floor.** Scheduled runs currently floor the
fast tier at `grok-4-3` because nobody is watching for fabrication. Keep, or
raise to `gpt-5-6-terra` for unattended quality? *Plan default: keep grok-4-3.*

**Decision 4 — Luna in the EngineAI picker?** Expose as a visible "fast" option
or keep hidden behind Auto? *Plan default: hidden.*

---

## 3. Expected effect — honest split

**Cost: down substantially and everywhere.** The two highest-volume paths in
each app (EngineAI's fast leg + fan-out, MeetingBrain's extraction + scanners)
move from $1.25–$3.00 per M input to $0.20. MeetingBrain's structural fixes
(§B, MB-1) cut token *volume* independently of rate.

**Quality: up in three places, a wash in one — and one needs measuring.**

- **Up:** anything on Haiku 4.5 today (AA 30 → Luna 52) — MeetingBrain's focus
  triage and hybrid scanners, plus EngineAI's optimizer gate later.
- **Up:** MeetingBrain chat, Sonnet 4.6 → Terra (AA 57), cheaper on input too.
- **Wash:** EngineAI's fast leg — grok-4.3 is unscored on AA but sits below
  Grok 4.5's 56; Luna at 52 is comparable, with better tool-use scores
  (TAU-bench 71.3) and 1M context.
- **⚠️ Unverified:** MeetingBrain bulk extraction, Sonnet 4.6 → Luna. I have
  no AA score for Sonnet 4.6, so treat this as a large cost win with
  *unproven* quality parity. It is the one change that must be A/B'd rather
  than assumed — and MB already has the harness for it
  (`/api/admin/task-quality-report`: ignore rate, duplicate clusters,
  tray accept rate). Flip one source, hold a week, compare, then widen.

---

# Part A — EngineAI

> **Status 2026-08-24 — A-1, A-4 and A-5 are shipped; A-2 and A-3 are not.**
> A-2 still needs its live Luna probe and A-3 must not ship before it. What
> shipped is the groundwork that makes the routing switch safe, plus three
> findings turned up while doing it:
>
> 1. **`scripts/verify-model-ids.ts`** now asserts the registry, the rate table
>    and the label map agree — with a `--self-test` that proves each detector
>    goes red against synthetic bad input rather than mutating a repo file.
>    It caught two live faults and one error of its own.
> 2. **`executeWebSearch` logged no usage at all.** Every web search in the app
>    was invisible to the ledger, so the 30-day baseline in A-0 excludes one of
>    the busiest callers. **Re-run the A-0 query after this has been live a few
>    days** — the number it produced before is a floor, not a measurement.
> 3. **`executeWebSearch` described itself three ways at once**: docstring said
>    grok-3-mini, the call sent the retired grok-4-1-fast, the comment beside it
>    quoted $0.20/$0.50 — the advertised price of a slug xAI had been billing at
>    $1.25/$2.50 since May. Now one constant, read by request and ledger alike.
>
> Still open in A-4: `grok-3-mini` in `lib/rfp/extract.ts` is NOT on the
> confirmed retirement list, so it was left alone and the uncertainty written
> into the file. If it has been retired, that line understates spend — the
> dangerous direction. **Confirm it in the xAI console.**

## A-0. Baseline

- [ ] `npx tsx scripts/verify-model-params.ts` green (plus slide/optimizer
      suites if you touch those areas — see CLAUDE.md).
- [ ] Size the prize. Verify column names against `lib/db/schema.ts` / the
      usage-logger insert before running:

**The query below was corrected on 2026-08-24 — every column name in the
original was wrong** (`model`, `tokens_input`, `tokens_output`,
`cost_tenths_cent`, `created_at`), so it would have errored rather than
returned a baseline. Real columns per `scripts/create-intelligence-schema.sql`:
`name_model`, `units_input`, `units_output`, `units_cost_tenths`,
`date_created`, plus `type_app` from the 2026-03-20 multi-app migration.

It is also no longer scoped to Grok. Scoping the baseline to the models you
already intend to move measures the answer you assumed, not the bill.

```sql
-- Where EngineAI's model spend actually goes, last 30 days.
select
  type_source,
  name_model,
  count(*)                                         as calls,
  sum(units_input)                                 as tokens_in,
  sum(units_output)                                as tokens_out,
  round(sum(units_cost_tenths)::numeric / 1000, 2) as cost_usd
from intelligence.ai_usage
where date_created >= now() - interval '30 days'
  and type_app = 'engine'
group by type_source, name_model
order by cost_usd desc
limit 60;
```

Sanity check first — if `rows_30d` is 0 or `earliest` is only days old, the
window is not what you think it is and the numbers below mean nothing:

```sql
select
  count(*)                                         as rows_30d,
  min(date_created)                                as earliest,
  max(date_created)                                as latest,
  round(sum(units_cost_tenths)::numeric / 1000, 2) as total_usd
from intelligence.ai_usage
where date_created >= now() - interval '30 days'
  and type_app = 'engine';
```

⚠️ Whatever this returns is a FLOOR, not a measurement, until web search has
been logging for a full window. `executeWebSearch` never logged at all before
2026-08-24.

Record the projected saving in the PR description.

## A-1. Register Luna properly

- [x] Add a first-class `gpt-5-6-luna` entry to `MODEL_REGISTRY`
      (`lib/ai/providers.ts`; today Luna exists only as the apiModel of the
      legacy hidden `gpt-4o-mini` entry ~line 651). Dashed key like
      `gpt-5-6-terra`, apiModel `gpt-5.6-luna`, `hidden: true`.
- [x] **Adding a model id touches 5 files and 4 of them fail silently**
      (memory: `engineai-chat-tool-routing`):
  - `lib/ai/model-costs.ts` — dotted row exists; **add the dashed key too**
    (dotted-only keys fall through to the Sonnet-4.6 fallback rate, as Terra
    did). Add cached-input $0.02/M if per-model cache rates are supported.
  - `lib/ai/models.ts` MODEL_LABELS — add **both** spellings, else
    `getModelLabel` renders the raw id under historical messages.
  - Label/colour maps — `app/(app)/settings/ai-usage/page.tsx` + AdminDialog.
  - `lib/ai/anthropic-params.ts` — N/A (OpenAI model). Noted so nobody
    "fixes" it.

## A-2. One cheap-tier helper, then migrate the background jobs

- [ ] Create `lib/ai/cheap-model.ts` — the cheap-tier id, client, and param
      shape in ONE place. The slug is currently hardcoded across ~30 call sites
      in 10 files, with four private `getXAIClient()` copies
      (`memory-extraction.ts:15`, `conversation-summary.ts:20`,
      `client-context-extract.ts:19`, `memory-consolidation.ts:100`). That
      duplication is why the May retirement went unnoticed for three months.
- [ ] ⚠️ **Probe first:** one live Luna call with the existing params. The
      background jobs pass `temperature` (e.g. 0.3); if the GPT-5.6 family
      rejects sampling params the way Claude 4.7+ does, strip it in the helper.
- [ ] Migrate to the helper (xAI client → OpenAI client, keep
      `max_completion_tokens`, keep the JSON prompts):
      `lib/ai/memory-extraction.ts` (×3) · `memory-consolidation.ts` ·
      `conversation-summary.ts` (×2) · `client-context-extract.ts` (×4) ·
      `app/api/ai/route.ts` (~15).
- [ ] Update every `logAiUsage({ model })` — billing follows the logged id.
- [ ] Meeting-copilot routes **last** (`app/api/ai/meeting/{triggers,handoff,end,lookup,session}`)
      — latency-sensitive. Spot-check T2 card feel; if it regresses, leave them
      on explicit `grok-4.3` + `reasoning_effort:"none"` and just fix the
      logged id (they already send grok-4.3 while logging the dead slug).
- [ ] Confirm the third-party-taint guard still gates each migrated call — the
      skip lives at the call sites, not in the model.

## A-3. Switch the router (ship 2–3 days after A-2)

- [ ] `lib/ai/auto-router.ts:18` → `FAST_MODEL = "gpt-5-6-luna"`. Fix the
      header comment (still quotes $0.20/$0.50 and names Grok 4.3 as the
      reasoning leg when it is grok-4-6).
- [ ] ⚠️ **Critical — the web-search override.**
      `app/api/ai/conversations/[id]/messages/route.ts:~1381` reads
      `… && model.startsWith("grok") && !queryRoute.composition`. With Luna as
      FAST that is false, so auto search turns would stay on Luna, which has
      **no web capability** (`WEB_SEARCH_OPENAI_TOOL` is defined but
      deliberately unregistered) — reviving the tail-chasing spiral. Change
      both branches (override **and** the composition `else if`) to
      `!model.startsWith("claude")`, matching the mailbox/personal-data
      overrides at ~1575/~1656, which need no change.
- [ ] `lib/scheduled/runner.ts:146` compares the literal `"grok-4-1-fast"` —
      silently stops matching once FAST_MODEL changes. Compare the imported
      constant, and apply Decision 2.
- [ ] `MODEL_REGISTRY.auto` (`providers.ts:589`) resolves to grok-4.3 for
      callers that skip `routeModel`. Find `getModelInfo("auto")` consumers
      before deciding whether it follows FAST.
- [ ] If Luna disappoints on interactive chat specifically, the fallback
      candidate is Gemini 3.7 Flash (AA 56, 340 tok/s, $0.75/$3.75) — but note
      that price doubles 2027-01-01.

## A-4. Retired-slug hygiene

- [x] `lib/rfp/search.ts:703,752` sends `grok-3` (retired 2026-05-15). The
      ledger prices it at $3/$15 while xAI bills $1.25/$2.50 — RFP rows are
      **overstated**. Send explicit `grok-4.3`, log accordingly.
- [ ] `lib/rfp/extract.ts:74,97` uses `grok-3-mini` — not on the confirmed
      retirement list; verify it exists in the xAI console before trusting the
      $0.30/$0.50 row.
- [x] `lib/ai/providers.ts:4433` (`executeWebSearch`) — explicit `grok-4.3` +
      `reasoning_effort:"none"`; fix the ~4421 comment claiming grok-3-mini.
- [ ] Keep the `grok-4-1-fast` registry entry addressable with `legacy: true`
      (saved preferences must still resolve) — but no longer any path's default.

## A-5. Cleanup

- [x] Remove `deepseek-chat` from the client picker (`lib/ai/models.ts:18`) —
      DeepSeek retired the alias 2026-07-24, so selecting it now errors. It is
      already `legacy` in the registry. Do not repoint to DeepSeek V4:
      first-party DeepSeek stores data in the PRC.
- [ ] Stale comments: `providers.ts:3369` says grok-2-image; code sends
      grok-imagine-image.
- [ ] Note (don't do): the optimizer gate `lib/optimizer/suggest-gate.ts:171`
      is Haiku 4.5 — poor value vs Luna, but the feature is dark until its
      migration runs. Add to the optimizer backlog.

## A-6. Model-id issues surfaced by the 2026-08-24 AuthorityOn audit

These are EngineAI bugs found while verifying current provider ids. Verify
each against the live provider before acting — but all three are cheap checks.

- [ ] ⚠️ **Perplexity `sonar` retires 2026-09-27 (34 days).** "Sonar will be
      supported until September 27, 2026" — Chat Completions moves to the
      Agent API. EngineAI carries `sonar` and `sonar-pro` as hidden registry
      entries (`providers.ts:690, 697`). `sonar-pro`'s fate is an inference,
      not documented — confirm with Perplexity. **Also hits AuthorityOn**,
      where sonar is a scan target *and* four analysis sources.
- [ ] ⚠️ **`gemini-3-flash` may not be a valid API id.** Gemini 3 Flash
      shipped only as `gemini-3-flash-preview`; Google's migration doc renames
      it to `gemini-3.5-flash`. EngineAI exposes bare `gemini-3-flash` as a
      **user-selectable picker model** (`providers.ts:621`). If the bare id
      404s, that picker entry is dead. Test one live call before anything else
      here.
- [ ] **`RATE_EXPIRIES` may be on the wrong model.** The $0.75/$3.75 →
      $1.50/$7.50 doubling on 2027-01-01 belongs to `gemini-3.7-flash` /
      `gemini-3.6-flash`. `gemini-3.5-flash` — the actual successor to the id
      the repo carries — is $1.50/$9.00 flat with no promo. Re-point the
      expiry to whichever id the previous item lands on.
- [ ] **`gpt-5.6-sol` is over-priced in the cost table.** OpenAI lists
      $4.00/$20.00 with "promotional pricing available at least through
      November 21, 2026"; `model-costs.ts:61` carries the pre-promo $5/$30.
      Correct it **and** add a `RATE_EXPIRIES` entry for the November
      reversion. (The $5/$30 figure is what secondhand blogs quote — exactly
      the stale-table failure mode CLAUDE.md warns about.)
- [ ] **`mistral-large-latest` no longer means "the best Mistral."** Mistral's
      top model is now `mistral-medium-3-5-26-04`; Large 3 became a mid-tier
      open-weight model at $0.50/$1.50. The repo prices it $2/$6, matching
      neither. It is a cost-table-only row with no call path — correct or drop.
- [ ] **DeepSeek peak pricing, if `deepseek-chat` is ever repointed:** V4 rates
      double during peak (01:00–04:00 and 06:00–10:00 **UTC**, Mon–Fri) — that
      second window is 08:00–12:00 Zurich, this workspace's business morning.
      Correct target for both retired aliases is `deepseek-v4-flash`, not
      `-pro` (assuming `-pro` costs ~3.1x more for identical tokens).

---

# Part B — MeetingBrain

Architecture: all non-streaming calls route through `callClaude()` in
`lib/ai.ts`; model ids are hardcoded constants; the only runtime swap is the
Control Centre `intelligence.model_overrides` table, keyed on
(app='meetingbrain', source). Users hold a 4-value `ai_model` preference
(sonnet default / haiku / grok / hybrid). Scanners run on a 15-min cron. Usage
dual-writes `ai_usage_log` and `intelligence.ai_usage` (type_app='meetingbrain').

## B-0. Attribute the Haiku line, fix the ledger

The Anthropic console's largest line is Haiku 4.5 ($24.29 of a $34.40 day on
Aug 12; $179 MTD total). MB's own ledger comment (`lib/ai.ts:55`) accounts for
Grok ≈$25 and Sonnet ≈$23 over 30 days — neither explains it. Candidates:
hybrid/haiku-preference scanners (one call per Slack/Teams message per tick),
focus triage, speaker attribution, and the **Grok-failure → Haiku fallback**
(the bursty pattern fits outage days).

- [ ] Run it (verify column names first):

```sql
select type_app, model, type_source, date_trunc('day', created_at) as day,
       count(*) as calls,
       round(sum(cost_tenths_cent)::numeric / 1000, 2) as cost_usd
from intelligence.ai_usage
where created_at >= now() - interval '30 days'
  and model ilike '%haiku%'
group by 1,2,3,4 order by cost_usd desc limit 50;
```

- [ ] Cross-check spike days against cost-alert emails (the cron fires on ≥50
      Claude calls on Grok-default sources — that signature *is* the fallback).
- [ ] **Fix the rate:** `lib/ai.ts:27` prices Haiku at $0.80/$4 — that is Haiku
      *3.5*'s rate. Haiku 4.5 is $1/$5, so MB under-reports its largest Claude
      line by ~20%.

## B-1. Structural savings (no vendor change — do these regardless)

- [ ] **Prompt caching: there is not one `cache_control` in the repo.** Cache
      reads are 90% off. Three candidates:
  - Chat rebuilds a byte-identical multi-thousand-token system prompt every
    turn (tasks + 20 meeting summaries + support KB; admin prompts reach tens
    of thousands of tokens) — `app/api/chat/route.ts:~175`.
  - The dashboard analyser resends the same ~300k-char context to the contact
    call and every dashboard call in one run — `lib/dashboard-analyser.ts:168,
    283-292`. Cache once, read N times.
  - The ~1–1.5k-token extraction/insights rubrics on every scanner call.
  - Mind the ~1024-token minimum cacheable prefix and TTL vs the 15-min cron
    (5-min TTL covers within-run reuse; pay the 1-hour write only where reads
    across ticks pencil out).
- [ ] **Merge extraction + insights.** Every meeting sends its full transcript
      (15k–80k chars) **twice** — `extractTasksAndSummaryWithClaude`
      (`meeting-scanner.ts:2516`) then `extractInsightsWithClaude` (`:2718`),
      different rubrics, zero input reuse. One combined call halves
      per-meeting input regardless of vendor.
- [ ] **Batch the per-item scanners.** Slack, Teams and MS-calendar make one
      call per message/event (`slack-scanner.ts:1116`, `ms-teams-scanner.ts:365`,
      `ms-calendar-scanner.ts:240`); email already batches 3–8. Group per
      conversation per tick.
- [ ] Note: the re-extraction duplicate loop is already triple-gated (SHA-256
      content hash + sibling election, `meeting-scanner.ts:1380, 1398/1479`).
      Genuine content changes still cost a full extraction+insights pair —
      which the merge above halves.

## B-2. Move the models (gated on Decision 1)

Target state per §1: **Luna** for B1–B4 (extraction, scanners, dashboards,
small structured calls), **Terra** for B5–B6 (chat, prep-brief fallback).

- [ ] Plumbing is cheap: `callGrok` (`lib/ai.ts:177-221`) already converts
      Anthropic-format messages to OpenAI-chat format — an OpenAI leg is a
      baseURL + key swap on that adapter, not new plumbing. ⚠️ It **drops
      non-text blocks**; confirm no path sends images or document blocks first.
- [ ] MB sets no temperature anywhere → no sampling-param trap.
- [ ] Add Luna/Terra rows to `COST_PER_M` and the admin `MODEL_META` map. Keep
      the 4.6 rows for historical data. Unknown ids silently bill at Sonnet
      rates (`lib/ai.ts:151, 352`), so a missing row hides the saving.
- [ ] **Roll out one source at a time via `model_overrides` — no deploy
      needed.** After each: watch `ai_usage_log` cost and
      `/api/admin/task-quality-report` for extraction regressions (see §3 —
      this is the change that needs measuring).
      Order: **dashboards → task actions/project/focus → meeting** (all
      first-party or already-multi-vendor), then **stop**. The mailbox and
      messaging sources — slack → email → teams/calendar — only proceed once
      Decision 2 is answered; B-1's batching should already have landed most
      of their saving by then.

## B-3. The forced Grok slug + the precedence bug

`grok-4-1-fast` is **forced** for sources `meeting`/`meeting-audio`
(`lib/ai.ts:56, 254-256`) and hardcoded in both dedup calls
(`task-dedup.ts:182, 1189`) — ~18,916 calls/30d riding xAI's silent redirect.

- [ ] **Minimum, do regardless:** send explicit `grok-4.3` so nothing depends
      on a redirect that could start erroring.
- [ ] **Preferred (Decision 1):** Luna. ⚠️ Probe the dedup confirm call first —
      it runs `max_tokens: 50` and reasoning tokens count against the cap (the
      code comment already documents this trap for the Grok slug).
- [ ] **Fix the precedence bug:** the AssemblyAI webhook explicitly requests
      Haiku for speaker mapping (`webhooks/assemblyai/route.ts:319`) but the
      GROK_DEFAULT_SOURCES force runs *after* explicit models and silently
      overrides it. Explicit per-call models should win over source defaults.
- [ ] **Keep the fallback cross-vendor.** Today: xAI primary → Anthropic
      (Haiku) fallback, chosen deliberately after an xAI outage spiked spend
      ~17x. If the primary becomes Luna, the fallback must *not* also be
      OpenAI. Set it to `grok-4.3` — cheaper than Haiku during an outage, and
      it removes the most likely source of the Haiku spikes in B-0.

## B-4. Hygiene

- [ ] The chat route bypasses `callClaude` (`app/api/chat/route.ts:176` hits
      `anthropicClient` directly), so the kill switch, provider spend cap and
      model overrides are all **inert** on the heaviest interactive path.
      Route it through the wrapper or replicate the gates.
- [ ] Admin dashboard `MODEL_META` keys `grok-4-1-fast-non-reasoning`
      (`app/admin/usage/page.tsx:34`) while `lib/ai.ts:297` logs
      `grok-4-1-fast` — current rows render unstyled. Align on the final id.
- [ ] cost-alert `GROK_SOURCES` (`cron/cost-alert/route.ts:13`) lists
      slack/email, but only meeting/meeting-audio are Grok-forced — false
      positives on legitimate Claude traffic.
- [ ] Port a minimal `verify-model-params`-style script (see §4).
- [ ] Confirm MB's own deploy command in that repo — do not assume EngineAI's.

---

## 4. Verification & rollout

Guard script assertions (both repos; per CLAUDE.md **prove each fails first** —
reintroduce the bug, watch it go red, restore):

1. No live path sends a retired slug (`grok-4-1-fast*`, bare `grok-3`,
   `grok-4-fast*`, `deepseek-chat`) — assert on the strings actually passed to
   clients, not that a constant was edited (memory:
   `verification-scripts-must-assert-use`).
2. Every id used by router/registry/jobs has a cost row under the **exact
   logged spelling** (the dashed/dotted trap).
3. EngineAI: the search override fires for a non-Claude, non-Grok FAST model —
   unit-test the predicate with `model="gpt-5-6-luna"`.
4. EngineAI: FAST_MODEL and the scheduled-runner floor reference one constant.
5. MeetingBrain: primary and fallback models are never the same vendor.

Rollout order: **A-0 → A-1/A-2 → (2–3 days) → A-3 → A-4/A-5**, then
**B-0 → B-1 → B-2 one source at a time → B-3 → B-4**.

EngineAI deploy: `vercel deploy --prod` (git push alone does **not** deploy).

Post-deploy: EngineAI — confirm `[Messages] Web search: auto-route override`
still logs on auto search turns; compare cost/day for sources
`memory-extract`, `summary-*`, `client-context`, `engine` against A-0.
MeetingBrain — task-quality report before/after each source flip.

## 5. If Decision 1 fails (MeetingBrain stays Anthropic)

Substitute for Part B's model moves, keeping everything else:

- `claude-sonnet-4-6` → `claude-sonnet-5` ($3/$15 → $2/$10, a generation
  newer). ⚠️ Pass `thinking: {type: "disabled"}` — omitting it runs adaptive
  thinking, whose tokens count against MB's 300–4,000 `max_tokens` caps and
  will truncate JSON.
- Haiku 4.5 stays for the cheap paths (correct its rate per B-0).
- B-1 (caching, merge, batching) and B-3's minimum fix are unaffected and
  still deliver most of the volume saving.
- Put the sub-processor disclosure on the roadmap — it is worth real money.

## 6. Non-goals

- No change to: EngineAI's Sonnet 5 grounded leg, grok-4-6 reasoning leg,
  Opus 5 entity capture, Gmail/personal-data Claude-only gates, image/voice/STT
  models, AssemblyAI, OpenAI embeddings.
- No Chinese first-party APIs near personal or client data (GLM-5.3, DeepSeek
  V4, Kimi K3 and Qwen3.8 are strong value — GLM-5.3 is the best
  cost-per-intelligence above AA 59 — but PRC data residency rules them out
  here; revisit only for isolated non-personal bulk work via US/EU hosts).
- The May–Aug `ai_usage` backfill (understated grok rows; now also the
  overstated RFP `grok-3` rows) stays a separate task — do not fold it in.
- EngineAI's grounded leg on Terra + OpenAI web search
  (`WEB_SEARCH_OPENAI_TOOL` is already defined and unregistered) is a
  legitimate future test for non-mailbox search traffic. Out of scope; check
  PDF-attachment handling first, since Claude takes PDFs as native document
  blocks.

## 7. Reference — verified rates, 2026-08-24

| Model | Input /M | Output /M | Cached in | AA intel | Notes |
|---|---|---|---|---|---|
| GPT-5.6 Luna | $0.20 | $1.20 | $0.02 | 52 | 1M ctx, 118 tok/s, TAU 71.3 |
| GPT-5.6 Terra | $2.00 | $12.00 | $0.20 | 57 | GPQA 90.4 |
| Claude Sonnet 5 | $2.00 | $10.00 | $0.20 | 55.3 | permanent; +~30% tokenizer |
| Claude Sonnet 4.6 | $3.00 | $15.00 | — | — | superseded |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | 30 | 200K ctx |
| Claude Opus 5 | $5.00 | $25.00 | $0.50 | 63 | #1 AA + SWE-bench |
| grok-4.3 | $1.25 | $2.50 | $0.20 | — | 1M ctx |
| grok-4.6 | $2.00 | $6.00 | $0.50 | 61 | 500K ctx |

Long-context repricing (whole request, not the excess): xAI and Gemini step up
at ~200K prompt tokens, OpenAI at ~272K. **Anthropic bills flat across 1M** —
the reason the Sonnet 5 grounded leg stays put. Anthropic cache writes 1.25x
(5-min) / 2x (1-hour); reads 0.1x. Batch API 50% off on both Anthropic and
OpenAI — worth claiming on MeetingBrain's non-urgent crons.

Re-verify against provider pages before acting on any figure older than a
quarter; reseller tables (OpenRouter et al.) show routing prices, not
first-party rates.
