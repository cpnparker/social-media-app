# Plan — Airtable resourcing in EngineAI

**Written:** 2026-07-30. **Status:** plan, not built.
**Decisions taken:** Engine is authoritative for actuals, Airtable for plan. Access gated behind a new per-user `flag_access_resourcing`, off by default.

---

## 1. What this actually adds

Three of the four categories already exist in the Engine and are queryable by EngineAI today:

| Category | Engine (`app_contracts`) | Airtable adds |
|---|---|---|
| Contracts, renewal dates | `date_start`, `date_end`, `flag_active` | forward view: likelihood, owner, renewal stage |
| Account managers | `user_account_manager`, `name_account_manager` (populated) | — |
| CU quotas | `units_contract`, `units_content`, `units_social` + `_completed` | — |
| **Team capacity / quotas** | **absent** | **the real gap** |
| **Monthly CU expectations** | **absent** (only actuals) | **the real gap** |

So the value is concentrated in capacity and forward targets. Everything else is duplication, and duplication is where this can go wrong.

## 2. The rule that keeps it coherent

**The Engine says what happened. Airtable says what is planned.**

- "How many CUs have we delivered for UBS?" → Engine. Always.
- "How many are we expecting this month?" → Airtable.
- "Are we over-servicing them?" → both, and the answer names each side: *"Plan is 12 CUs this month (Airtable); 17 delivered (Engine) — 5 over."*

This must be enforced in three places, not just hoped for:

1. **The system prompt** states the rule explicitly and gives the compare-and-attribute output shape.
2. **The tool description** for `query_resourcing` says it returns PLAN data and that actuals come from `query_engine`.
3. **The tool result** carries a one-line provenance header (`Source: Airtable resourcing base, synced <timestamp>`) so the model cannot present it as live Engine data.

Without all three, the assistant will eventually quote an Airtable target as a delivered figure. That failure mode is the whole reason for the split.

## 3. Architecture — read-through, matching the existing connectors

Query Airtable at request time. No mirror into Supabase.

Same reasoning that governed the Engine-tasks feature: a mirror goes stale, needs a sync job, and creates a second thing to keep correct. Airtable is small (hundreds of rows, not millions) and its API is fast enough for a tool call.

**One exception worth considering:** Airtable's rate limit is **5 requests/second per base**, and it 429s hard. If several people query resourcing in the same minute, or one turn fans out across tables, that is reachable. Mitigation is a short-lived in-process cache (60s) keyed by table+filter, the same shape as `lib/gdrive/docs.ts`'s `contentCache`. Build it in from the start — retrofitting it after the first 429 in a client meeting is worse.

**Files** (mirroring how Xero and Drive are structured):

| Path | Purpose |
|---|---|
| `lib/airtable/client.ts` | auth, fetch wrapper, 60s cache, rate-limit backoff, typed row mapping |
| `lib/airtable/resourcing.ts` | the reports: `capacity`, `monthly_plan`, `renewals`, `team_load` |
| `lib/ai/providers.ts` | `QUERY_RESOURCING_TOOL` + `QUERY_RESOURCING_OPENAI_TOOL`, registered and executed on **all four chains** |
| `lib/ai/system-prompts.ts` | the actuals-vs-plan rule, and naming the tool in the briefing gather-set |

## 4. Auth

A **scoped Airtable Personal Access Token**, not an API key (API keys are deprecated and are account-wide).

Scopes needed: `data.records:read`, `schema.bases:read`. Access limited to the one resourcing base.

```
AIRTABLE_PAT=            # you create it; never shared with me or committed
AIRTABLE_RESOURCING_BASE=appXXXXXXXXXXXXXX
```

Two things to remember from earlier today: **Vercel bakes env vars at build time**, so adding them requires a redeploy; and the code must degrade gracefully when they are absent, exactly as `queryXero` returns a "not connected" notice rather than throwing.

## 5. Discovery step — before any of the above

I cannot see the base. Rather than asking you to write out the schema, the first task is a throwaway script that introspects it:

```
GET https://api.airtable.com/v0/meta/bases/{baseId}/tables
```

That returns every table, field name and field type. From that I can map:
- which table holds people and what their capacity field is called
- which holds monthly expectations, and at what grain (per client? per person? per month?)
- how a row identifies a client and a person

**This step decides the whole shape of the reports**, so it comes first and everything downstream is provisional until it runs.

## 6. Identity — the part most likely to be wrong

Airtable will identify people by **name** (a collaborator field or a text field). The Engine identifies them by `id_user`. Today's audit found exactly this class of bug three times over.

**The rule: join on email, never on name.** Production has two distinct users called "Mike Parsons" and two called "Faher Elfayez"; `%Chris%` matches ten people.

The chain is `Airtable person → email → lower/trim → public.users.email_user → id_user`, reusing `findUserByEmail` in `lib/user-lookup.ts` (already handles the case-insensitivity and the `_`-as-wildcard hazard in `ilike`).

If the Airtable table has no email column, **that is the first thing to add** — matching on display names will silently merge colleagues' capacity.

Same for clients: join on a stable id if the base carries one, otherwise exact normalised name against `app_clients`, and report unmatched rows rather than dropping them silently.

## 7. Access control

`intelligence.users_access.flag_access_resourcing integer NOT NULL DEFAULT 0`, following `flag_access_finance` exactly:

- read with an explicit `=== 1`; an absent row is **denied**; a query error is **denied**
- gate at **registration on all four chains** *and* again inside the executor, so a chain that forgets cannot serve it
- add the toggle to Settings → Users (the `accessFields` array is array-driven; the API route needs the field in five places — destructure, `hasAccessUpdate`, update branch, insert branch, GET mapping)

**Audience question to settle at build time:** should resourcing be blocked in multi-reader threads, as finance now is? Individual capacity is performance-adjacent. My recommendation is **no** — team capacity is legitimately a team conversation, unlike one person's mailbox — but per-person utilisation figures should be attributed rather than aggregated anonymously, so nobody is discussed without being named.

## 8. Tool shape

```
query_resourcing({ report, client_name?, person_email?, month?, scope? })
```

| report | Returns |
|---|---|
| `capacity` | per person: planned capacity, committed, headroom, for a month |
| `monthly_plan` | expected CUs per client per month |
| `renewals` | contracts approaching renewal, with owner and stage |
| `team_load` | roll-up across the team for a month |

Every report returns `{ data, count, matched_total, truncated?, warning?, source, synced_at }`.

**`matched_total` is not optional.** Today's headline bug was a capped query reporting itself as complete — a user was told a live contract did not exist. Airtable paginates at 100 records per page; the client must follow `offset` to completion, and if it stops early it must say so in the tool result. Same rule as `runCapped`.

## 9. Phases

**Phase 0 — discovery (½ day).** PAT + base id from you; introspect the schema; report back the actual tables and fields, and flag any missing email/id columns. Everything below is provisional until this lands.

**Phase 1 — client and reports (1 day).** `lib/airtable/client.ts` with cache and backoff; `resourcing.ts` with the four reports; a `scripts/verify-resourcing.ts` assertion script in the `verify-engine-scoping.ts` style (no test runner in this repo). *Verify:* run each report against the live base and eyeball it against what you know to be true.

**Phase 2 — the flag (½ day).** SQL for `flag_access_resourcing` (printed inline, Engine project, with the sanity check), the admin toggle, and the gate. *Verify:* enabled user gets data; non-enabled gets a clean refusal; absent row denies.

**Phase 3 — tool wiring (1 day).** Register and execute on all four chains, with the provenance header. *Verify:* ask the same question on each model and confirm all four answer; confirm the actuals-vs-plan attribution appears.

**Phase 4 — the prompt rule (½ day).** The actuals-vs-plan instruction and the over-servicing output shape. *Verify:* in the real UI, ask "are we over-servicing UBS?" and check the answer names both sources.

**Phase 5 — write-back.** Out of scope. Flag it explicitly: if resourcing plans are ever editable from EngineAI, that needs its own design, because Airtable has no per-record permission model that matches the Engine's.

## 10. Risks

**Two sources drifting.** If Airtable's contract list disagrees with the Engine's, the assistant will look wrong whichever it picks. Worth a one-off reconciliation report during Phase 1 showing where they already disagree today — that number decides whether the split is comfortable or a problem.

**Airtable as a schema.** Airtable columns get renamed by whoever is editing. A renamed field silently breaks a report. Mitigation: resolve fields by name once at startup against the meta API and fail loudly with the missing field name, rather than returning empty rows.

**Rate limits under fan-out.** See §3.

**Manual data going stale.** Airtable is hand-maintained; the Engine is generated. If the monthly plan has not been updated since March, the assistant will quote March's plan as current. The `synced_at` / row-modified timestamp must be surfaced, and the prompt must say to flag anything older than the current month.

---

## What I need from you

1. **Airtable PAT** with `data.records:read` + `schema.bases:read`, scoped to the resourcing base — add it to Vercel yourself as `AIRTABLE_PAT`; I never need to see the value.
2. **The base id** (`appXXXXXXXXXXXXXX`, from the base URL).
3. Whether the people table has an **email column**. If not, that's the first fix.

Then Phase 0 tells us what we're actually working with.
