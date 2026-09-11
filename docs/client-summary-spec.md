# Client Summary — specification

**Section:** `/operations/clients` (landing) + `/operations/clients/[id_client]` (detail)
**Job:** walk into a client cold — holiday cover, new AM, CEO, finance — and be useful in Tuesday's client run-through within one screen.
**Status:** buildable spec. Every call below is made, not offered. Open questions at the end are the ones I genuinely cannot answer without Chris or the Airtable base.

---

## 0. Two things to fix before this is built

Both surfaced during research; neither is part of this section, both block shipping it responsibly.

1. **`SUPABASE_SERVICE_ROLE_KEY` was partially materialised into a transcript** during the research pass for this spec (first 12 chars, via a `grep` over `/Users/chris/social-media-app/.env.local`). This design depends on service-role reads for the walkthrough job. Rotate the key first.
2. **`/Users/chris/social-media-app/app/api/customers/[id]/contracts/route.ts` has no `requireAuth()` and no `canAccessClient()`** (whole file, lines 1–51) while every sibling route in `app/api/customers/` calls both. Any caller reads any client's contract values. Fix or delete on its own ticket. Do not build on it.

---

## 1. The cut line, stated first

Chris asked for a section. The four research passes described a platform. Here is what is **in v1**, and what I cut and why.

**In v1**
- Landing table, one row per client, three named columns (AM / contract summary / renewal) + one status badge.
- Detail page: header, attention flags, contracts, delivery, latest content, client meetings, Tuesday walk-through, renewal, money (gated), provenance.
- One nightly + on-demand refresh job that writes a snapshot. Pages read the snapshot.
- The Tuesday walk-through extraction. This is the differentiator — everything else is a prettier `contracts-grid`.
- Seven derived signals, worst-of banding, no score.

**Cut from v1, with reasons**
| Cut | Why |
|---|---|
| **Airtable `Invoices` panel** | Entirely new code, nothing in the repo reads that table, and the Xero→Airtable sync cadence is unverified in *both* directions (`Late` is a local value not in Xero's set; `AUTHORISED` can be a paid invoice). A payment panel that is wrong in both directions on a page finance will quote is worse than no panel. v2, after the sync is characterised. |
| **`Contracts Monthly`** (current-year revenue, monthly plan) | 2,500+ rows, truncates unfiltered, year-qualified `Month` options, 12 filtered requests per client per year. Buys a revenue-by-month chart nobody asked for. |
| **`Import from CRM` deals** | Sibling `Opportunity` contracts already answer "is there a successor" from a fetch we're already doing. The CRM join adds a second id space (`Customer.CRM ID` is a number, `Contracts.CRM ID` is text) for marginal signal. |
| **`Account Manage` CU allocation table** | Answers "how many CUs of this contract does this person manage" — a resourcing question, already served by `lib/airtable/reports.ts` capacity reports. Not a relationship question. |
| **LLM "standing brief" prose paragraph** | Highest-risk, lowest-verifiability component on the page. The signals + the verbatim Tuesday bullet already do the job with receipts. Revisit only once the signal set has survived a quarter of Tuesdays. |
| **`processed_meeting.risks` / `sentiment` / `insights[].category=='risk'`** | Populated on 158 and 1,460 of 8,381 meetings, skewed toward *internal* morning meetings, and returned by neither RPC today (needs a manual SQL deploy to reach). A red-flag panel at that coverage manufactures reassurance. Red flags in v1 come from deterministic contract rules + the Tuesday bullet. |
| **Meeting-cadence-drop signal** ("relationship gone quiet") | The most seductive and least reliable derived signal available. Needs ≥4 meetings to establish a median, breaks on August, breaks on shared domains, breaks on delivery-phase projects. We show *last meeting date* as a fact; we do not fire on it. |
| **Scope-creep / over-commissioning signal** | Fires on legitimate variations recorded outside Airtable, i.e. accuses the AM team weekly. Needs the extensions question (§12) answered first. |
| **Signal acknowledge/snooze lifecycle** | Real need at scale; premature at seven signals. Add when the Tuesday meeting starts ignoring chips. |
| **Any write-back** | Read-only, v1. |

---

## 2. Access model

- **The whole section is TCE-staff-only.** `requireAuth()` → `isTCEStaff(role)` (`/Users/chris/social-media-app/lib/permissions.ts:10,21`). `freelancer` is a *client* role in this codebase and gets 403. Enforced server-side on the page **and** on every API route. Hiding a nav item is not a gate.
- **`requireAuth()` currently keeps the session role when the DB lookup throws** (`lib/permissions.ts:43` — the `catch` retains `role`). That fails open for a stale JWT. This section must not accept that: wrap it in a local `requireTceStaff()` that treats an *errored* role lookup as a denial, mirroring the fail-closed audience pattern at `app/api/conversations/[id]/messages/route.ts:793`.
- **Money is a per-viewer layer, not a per-page one.** Gate on `intelligence.users_access.flag_access_finance` (pattern: `app/api/ai/voice/session/route.ts:182-192`). Money fields are **omitted from the JSON payload** for non-finance viewers — never rendered and hidden in CSS. `lib/finance/forecast.ts` has **no internal guard** (unlike `queryXero`, which fails closed at `lib/xero/client.ts:161`), so any route importing it owns the check itself.
- Do **not** reuse `hasEngineAiAccess` — different question.
- Non-finance viewers whose client band is driven by a money signal see `Attention — finance detail restricted`, not a bare red. A colour with no visible cause is worse than an honest restriction.

---

## 3. Client identity join — the spine

**Join key: `app_clients.id_client` ⇄ Airtable `Customer.'Engine ID'`. Name matching is never used for the client join.**

Method:
```
listRecords("Customer", { fields: CUSTOMER_FIELDS })   // 125 rows, 1 page
→ Map<cellNumber(r.fields["Engine ID"]), record>
→ match app_clients.id_client in JS
```
Fetch whole; never `filterByFormula` on `Engine ID` — a formula miss and a genuine absence are indistinguishable in the response.

Five outcomes, all reachable in the UI. **No unmatched client is ever dropped.**

| `join_state` | Landing behaviour | Detail behaviour |
|---|---|---|
| `matched` | normal row | normal page |
| `engine_only` — Engine client, `flag_active=1 AND date_end >= today`, no Customer row carrying that id | appears in main table, badged **Not linked in Airtable**; AM/renewal/money columns read `not linked in Airtable`, never blank, never 0 | page renders; every Airtable panel shows `No Customer record carries Engine ID <n>` |
| `airtable_only` — Customer with an active-status contract and empty/unresolvable `Engine ID` | appears in main table, badged **No Engine record**; delivery column reads `no Engine client record` | page renders from Airtable only; delivery panel names the miss |
| `duplicate_engine_id` — two Customer rows claim the same id | hard data-quality row naming both `rec…` ids; **no silent first-match** | banner on the page |
| `internal` — `id_client ∈ (1,2)` (`lib/airtable/engine-actuals.ts:31`), plus test rows 44, 67 | excluded from the table and from all totals; listed in the orphan block | n/a |

Contract-level join across systems: **there is none that is verified.** `Contracts.'Engine contract'` and `Contracts.'Contract ID'` are read by nothing in this repo. **v1 therefore never pairs an Airtable contract row with an Engine delivery figure inside one card.** Airtable contract cards carry plan fields only; Engine delivery is shown at **client** level and, from Engine's own `id_contract`, at Engine-contract level. Two lists side by side, honestly labelled. See §12 Q3.

---

## 4. Source authority — who wins, and what the UI does when they disagree

One named source is authoritative per fact. Every other source carrying the same fact is a **corroborator**. A disagreeing corroborator is **rendered as a disagreement**. Nothing is averaged, nothing is silently picked.

| Fact | Authority | Corroborator | On disagreement |
|---|---|---|---|
| Client identity, industry, logo | Engine `app_clients` | Airtable `Customer.Customer` | Engine name is the row title; Airtable name shown as subtitle only when different |
| Which clients are live | Airtable `Booking status ∈ ACTIVE_BOOKING_STATUSES` | Engine `flag_active=1 AND date_end>=today`; `Customer.Active` | Union, never intersection. Disagreement is a badge, not a filter |
| **Account manager** | **Airtable `Contracts.'Account Manager'`** (Chris asked for it) | Engine `app_clients.name_account_manager` | **Show both, labelled by source, and do not pick.** A disagreement usually *is* the handover, and holiday cover needs to see it |
| Contract existence, dates, status, contracted CUs, roles | Airtable `Contracts` | Engine `app_contracts` | Both end dates shown when they differ. `Active - Late Delivery` past its end date is **normal**, not styled as an error. `Active` in Engine + `Ended` in Airtable **is** an error |
| **Delivered CUs** | **Engine, recomputed from `app_tasks_content ∪ app_tasks_social`** | `app_contracts.units_total_completed`; Airtable `'Delivered CUs in Engine'` | Recomputed figure is the headline. Digest disagreement > 2 CU appears as a provenance row. Airtable's Engine-mirror columns are a **reconciliation flag only**, never a delivery source |
| Renewal state | Airtable `Contracts` (end date, siblings, extension) | Forecast term dates; meeting mentions | Forecast revenue after the Airtable end date = "finance is banking a renewal Airtable has no record of" — the single most valuable disagreement on the page |
| Contract value / projection | Forecast workbook (client level) | Airtable `'Total contracted value (CHF)'` | Both shown, both labelled |
| Relationship narrative | MeetingBrain | — | Nothing numeric ever sourced from MeetingBrain |

**Freshness classes are on screen, not in tooltips.** Engine = live. Airtable = *"we read it at HH:MM; Airtable records no edit time"* — never "updated HH:MM". Forecast = cache age + Drive `modifiedTime` if available, else "sheet last saved: unknown". MeetingBrain = `max(processed_at)` + coverage caveat. Derived = `extracted_at` + model + `source_meeting_date`.

**The universal null rule.** Every figure is `value | not recorded`. `null` never renders as `0`, `0%`, `CHF 0`, or "on track". `cellNumber()` (`lib/airtable/client.ts:354`) already returns `undefined`/`AMBIGUOUS` and never 0 — carry that to the pixel. Note `cellNumber` returns `AMBIGUOUS` for **booleans** by design, so `'Contract ending soon (90 days)'` must be read through a boolean path or it silently vanishes.

---

## 5. Screen 1 — `/operations/clients`

One row per **client**, contracts expandable inline. Not one row per contract: a client with three live contracts must read as one relationship with three contracts, which is how the Tuesday meeting walks it.

### 5.1 Header bar

**Fields:** per-source status from the snapshot — `engine_read_at`, `airtable_fetched_at`, `airtable_truncated[]`, `forecast_cached_at`, `meetingbrain_latest_processed_at`, `walkthrough_extracted_at` + `source_meeting_date`, `snapshot_computed_at`.

Five chips, always present. Plus: **"Last Tuesday run-through: 11 Aug · 14 clients covered"** and a **Refresh** button (any TCE staff; re-runs the job, disabled for 60s after).

**Empty/error:** a source that failed reads `unreachable at HH:MM — dependent columns hidden, not empty`. `truncated: true` from any Airtable table renders **loudly**, naming the table (`lib/airtable/client.ts:20` — this is the Hiscox lesson). Never a page-level "Updated 2 minutes ago"; that laundered our HTTP call as data freshness.

### 5.2 Grouping and sort

Default: **group by `Customer.Pod` → sort by status severity desc → then weeks-since-Tuesday-coverage desc.** That surfaces, per pod, the clients nobody has talked about — the actual rotation problem (their own 2026-07-21 notes: the team agreed to divide the client list).

A **"covered this Tuesday / not yet"** divider inside each pod makes the walk resumable.

Alternate sorts in **URL params** (so a sorted link can be pasted into the meeting): `?sort=am` (transfer/cover view), `?sort=end` (renewal view), `?sort=value` (CEO view, finance viewers only), `?sort=name`.

In **every** sort, rows whose sort key is null go into a trailing block labelled `not recorded` — never interleaved, never at an extreme. `Pod` null → its own labelled group at the bottom, never merged.

### 5.3 Columns

**A. Client**
`app_clients.name_client`, `logos`, `information_industry`, `link_website`, `id_client`; Airtable `Customer.Customer`, `Customer.Pod` → `Pods.'Pod lead'` → `Team.Name`.
Empty: no logo → initials monogram, never a broken image. `information_industry` null → line omitted, not `—`. Pod null → grey chip `No pod set in Airtable`. Pod lead unresolvable → `Pod X (lead not resolved)`, never a bare `rec…`.
*(The `Pods` table is read nowhere in this repo today. If introspection shows the field is not `Pod lead`, ship without the escalation contact rather than guessing — §12 Q6.)*

**B. Account manager** — Chris's column 1
Airtable `Contracts.'Account Manager'` (`multipleRecordLinks` → `Team`), resolved via `nameIndex("Team","Name")` + `linkNames()` — **currently module-private at `lib/airtable/reports.ts:241,257,263`; export them, do not reimplement.** Hover reveals `'Senior Account Manager'`. Engine side read by **direct `app_clients` select** (the `app/api/operations/contracts/route.ts:53` pattern) — `ALLOWED_COLUMNS.app_clients` at `lib/ai/providers.ts:1448` omits both AM columns, so `query_engine` cannot return them.

The AM is a field on **Contracts**, not Customer, so the client-level AM is derived: the set across live contracts. Collapse to one name **only when every live contract agrees**; otherwise show the latest-contract AM + `+N others`.

Landing-row rendering when Airtable and Engine disagree: **Airtable name with a small amber dot**; the dot's tooltip and the detail page show both, labelled. (Chosen over stacking both names because the column must stay scannable and sortable — §12 Q1.)
Empty: empty link array → `No AM on this contract (Airtable)`. Team lookup miss → `Unresolved (Airtable)`, rec id visible only in the provenance drawer. No Customer row → Engine name labelled `(Engine)`.

**C. Contract summary** — Chris's column 2
Header shows the **latest active contract**; the CU figures beneath are **client-level across all live contracts**, and the two grains are labelled differently (`latest contract` vs `all live contracts`) with a `1 of 3 live` badge. Conflating them makes multi-contract clients read as under-delivering.

*Selection rule, printed in the column-header tooltip:* among contracts in the three active booking statuses, **latest `Start date`**; tie-break latest `End date`; tie-break largest `Contracted CUs`. (Sorting by end date first is wrong — an extension row carries a far end date on an old start and is not the current work.)

Fields: Airtable `'Contract name'`, `'Start date'`, `'End date'`, `'Booking status'`, `'Contracted CUs'`; Engine `app_contracts.units_contract`, `date_start`, `date_end`, plus recomputed commissioned/delivered CU (§7.1).
Display: `Delivered 48 of 120 CU · 40% · 12 CU last 30d`.
Empty: `units_contract` null → `CU total not recorded`, utilisation renders **null**, not 0% (precedent: `reportContractsSummary` returns `utilization_pct: null` when `cu_total === 0`, `lib/ai/providers.ts:2151`). `0 delivered` (red number) and `no delivery data` (grey text) are visually distinct states. Airtable-active with no Engine contract → `Not set up in Engine` — a real, actionable state.

**D. Renewal** — Chris's column 3
Airtable `'End date'`, `'Contract ending days'`, `'Contract extension date'`, `'Contract ending soon (90 days)'` (boolean path), sibling contracts with `Booking status ∈ {Booked, Opportunity}`; forecast `'Monthly revenue'` P/Q/U/N.

Derived state, first match wins, reason shown **in the cell**:
1. `Renewal booked` — sibling `Booked` contract starting ≥ (this `End date` − 30d)
2. `Renewal in pipeline` — sibling `Opportunity`
3. `Ends in Nd, no successor` — `0 ≤ Contract ending days ≤ 90`
4. `End date passed, still Active` — a data problem on plain `Active`; **expected and unflagged** on `Active - Late Delivery`
5. `Running`
6. `Not dated`

Empty: no Customer row → `Renewal status unavailable — not linked in Airtable`. `End date` null → `No end date recorded` — never `renews in NaN days`, and **never treated as no renewal risk**. No forecast name match → `Not matched in the forecast workbook (name match)`, never `CHF 0`.

Traps encoded: `'Is renewal'` / `'New or existing'` describe whether **this** contract was a renewal of a prior one — history, not a forward signal; they appear on the detail page labelled as history and never drive the badge. A negative `'Contract ending days'` is normal on `Active - Late Delivery` and a defect on `Active` — same number, opposite meanings, so the badge reads booking status first.

**E. Status badge** — one per row, first match in fixed severity order, reason in the badge. Definitions in §7.

**F. Value** — finance viewers only. Airtable `'Total contracted value (CHF)'`; forecast column **U** (not N). Absent for everyone else — the column does not exist in the payload, and `?sort=value` 400s for them.

**G. Last seen** — `Client meeting: 5 Aug` · `Tuesday: 11 Aug`. See §7.7 empty states; both are always rendered, never blank.

### 5.4 Orphan block (bottom, collapsed, with a count)

Engine-active clients with no Customer row · Customers with active contracts and no `Engine ID` · duplicate `Engine ID` · clients with **no usable email domain** (today: VARO Energy 46, Siemens AG 91, Zurich Instruments 92 — permanently invisible to all meeting intelligence) · `Customer.Active` disagreeing with the booking-status derivation.

Empty: `All active clients are linked across both systems and have a registered domain` — worth seeing when true.
**This block is the first thing that will be cut for tidiness. It should not be.** Without it, "we are looking at 57 of 60 clients" is invisible by construction.

### 5.5 Landing error states

- Airtable failed at last refresh → table renders from Engine with a banner: *"Airtable unavailable at HH:MM — AM, renewal and commercial columns not shown; this list is Engine-derived and will miss Extended / Late Delivery contracts."*
- Both sources failed → error page naming which, with the last good `snapshot_computed_at` and a **View last snapshot** link.
- Snapshot older than 60 min → renders **with** an amber `as of HH:MM` banner and the refresh control. Never a spinner, never an empty table.
- **The string "No active clients" must never be renderable.** An empty roster is an error, not a result.

---

## 6. Screen 2 — `/operations/clients/[id_client]`

Read top to bottom by someone who has never touched the account. Only §6.6 and §6.7 contain prose, and every prose line carries a clickable receipt (meeting date + link) or is dropped.

### 6.1 Header — who owns this, who to ask
Fields: `app_clients.name_client / information_industry / information_description / link_website / logos / id_client / user_account_manager / name_account_manager`; Airtable `Customer.Customer`, `'Engine ID'`, `Pod`; `Contracts.'Account Manager' / 'Senior Account Manager' / 'Content Manager' / 'Strategy Manager'` → `Team.Name`; `Pods.'Pod lead'` → `Team.Name`.
Roles rendered **per live contract**, collapsed only on unanimity. Airtable vs Engine AM disagreement renders both, labelled, with *"These disagree — a handover may have landed in one system only."*
Empty: (a) no Customer row → `Not linked in Airtable` stamped on every Airtable panel, Engine AM shown alone labelled `Engine only`. (b) Customer row, no active contract → `No live contract, so Airtable has no assigned AM` + the AM from the most recent `Ended` contract, dated. (c) Link present, Team lookup failed → `recorded but name could not be resolved`, never the raw rec id, never blank.

### 6.2 Attention — the fired signals
Each chip expands to: source fields, raw values, threshold, and the read time of each source. **No signal is ever a bare colour.** Definitions §7.
Empty: **never a green void.** `No flags raised by the 7 checks that ran` — followed immediately by the checks that could **not** run and why (`Pace check skipped — Contracted CUs not recorded`, `Meeting checks skipped — no client email domain registered`).

### 6.3 Contracts (the plan) — Airtable
Fields: `'Contract name'`, `'Booking status'`, `'Contract status'`, `'Start date'`, `'End date'`, `'Contract extension date'`, `'Contracted CUs'`, `'Commissioned CUs'`, `'Remaining CUs'`, `'Average CUs month'`, `'Forecasted CUs'`, the four role links.
Buckets, from `ACTIVE_BOOKING_STATUSES` (`lib/airtable/reports.ts:87`) and the rest: **Live** (`Active`, `Active - Extended`, `Active - Late Delivery`) · **Upcoming** (`Booked`) · **Pipeline** (`Opportunity`) · **History** (`Ended`, `Lost`, collapsed).
Do **not** recompute `'Remaining CUs'`. If it disagrees with `Contracted − Commissioned`, print the disagreement in provenance.
**No `%` sign is printed anywhere in v1** — see §7.3; percent scale is unverified (`percent` fields return `0.85`; a formula returning `85` returns `85`; `contractHealthReport` passes it through raw with no unit at `reports.ts:1343`). v1 computes pace from Engine CUs and Airtable dates, which have known scales, and shows Airtable's percent fields only in the provenance drawer, unlabelled and raw.
Empty: `No live contract in Airtable`, with the most recent `Ended` contract shown beneath, dated. Individual absent figures → `not recorded`.

### 6.4 Delivery (the actual) — Engine
Fields: `app_tasks_content ∪ app_tasks_social` — `id_task, id_client, id_contract, units_content, date_created, date_completed, date_deadline, flag_spiked, name_user_assignee`; `app_contracts.units_contract`.
Shows: delivered CU per Engine contract, delivered CU by month for 12 months (bucketed on `date_completed`), in-flight count, spiked count (shown, not hidden — cancelled work is signal for a stand-in AM), and the count of tasks with null `units_content` excluded from the sum.
Empty: `No delivered CU recorded in the last 12 months` + date of the most recent completed task ever + commissioned-not-completed count. A failed query renders `delivery could not be read`, never `0` — copy the spirit of the error branch at `lib/ai/providers.ts:1751-1756`, which explicitly prints *"Do NOT tell the user this client has no contracts."*

### 6.5 Latest content delivered
Source: `GET /api/operations/commissioned-cus?clientId=<id>&from=&to=` — reuse verbatim, plus one change (below). Fields used: `contentTitle, contentType, taskTitle, taskCUs, taskCreatedAt, taskCompletedAt, taskStatus, assigneeName, contractName, source`.
**Required change:** that route filters `from`/`to` on **`date_created`** (`route.ts:40-41, :53-54`), not `date_completed`. A 90-day window therefore drops work *delivered* last week against a commission opened last year — the exact opposite of "latest delivered". Add optional `completedFrom` / `completedTo` params; leave existing callers untouched.
Always pass `clientId` — the route accepts it server-side precisely because unscoped ranges are multi-MB.
Empty: `No task completed in this window. Last completed: <date> — <title>.` plus the in-flight list, so a client with a full pipeline and nothing shipped this month does not read as idle. No tasks at all → `no tasks recorded in Engine for this client`.

### 6.6 Client meetings — the relationship
Source: `queryMeetingBrain("client_meetings", …)` (`lib/ai/providers.ts:4231-4300`) → `{ meeting_id, title, date, summary, key_topics, next_steps, attendees }`; expand calls `meeting_details`. Window 90 days.
Rules:
- **Strip `attendees` of anything matching an email pattern before rendering, or drop the field.** The RPC's SQL claims names only; Google Calendar sets `name` to the email when there is no display name, and it returns live client addresses (`jacsd@orsted.com`, `sara.fontanella@esmo.org`). This page is open to ~60 staff.
- Meetings older than 14 days arrive with `summary` truncated to 150 chars and `next_steps`/`attendees` dropped by the age taper. Label those rows **`abbreviated by age`** and offer expand; never present the stub as the whole summary.
- Shared-domain clients (`worldbank.org` → 2 records, `marsh.com` → 3, `zurich.com` → 3, `ubs.com` → 3) show the meeting on all siblings with an explicit **`shared domain — could be any of: …`** label. Never silently pick the first match.
- **Do not source this from `intelligence.ai_client_meetings`.** Nothing in this repo writes it; 188 rows / 19 clients of ~60. It is why `lookupClientContext`'s "Recent Client Meetings" block is silently empty for most clients today.
- Never use `search_meetings` / `meetings` / `upcoming_meetings` / `my_tasks` — personal scope, blocked on a shared page.

Empty, two **different** states that must never be conflated:
- `No client meeting recorded in the last 90 days` (we looked, found nothing)
- `This client has no email domain registered, so client meetings cannot be matched to it at all` (we cannot look) — today: VARO Energy 46, Siemens AG 91, Zurich Instruments 92.

Sub-panel: **Commitments made in meetings** — owner-attributed `next_steps` with date + link. **No checkbox, no status, no "overdue" badge.** MeetingBrain's `task` table is `user_id`-scoped personal data, blocked here, and its `responsible` is free text (`"arne"`). Implying tracked state that does not exist is worse than omitting the section.

### 6.7 Tuesday walk-through — how the team describes this account
Source: `intelligence.ai_client_walkthrough_segments` (new, §9.3), written by the nightly job from `meetingbrain.processed_meeting`.

Renders: **`Last covered in the Tuesday walk-through: 11 Aug (1 week ago)`**, then the **verbatim `key_topics` bullet(s)** for this client, dated, each linking back to the occurrence, plus any renewal mentions and red flags the extraction pulled out of that bullet.

**The single most important empty state on the page:** `Not covered in the last N occurrences (last covered <date> / never)`. The team explicitly rotates — 10–20 of ~60 clients per week. **Absence from last Tuesday means not covered this week, never nothing happening.** An empty panel here reads as calm and would be wrong most weeks.
Also renders: `Only 6 processed occurrences exist (7 Jul – 11 Aug)` when the horizon is short, and `last extraction 12 Aug — the 18 Aug meeting has not been processed` when the job is behind.

### 6.8 Renewal
Fields as §5.3 D, plus `'Is renewal'` / `'New or existing'` shown **labelled as history, not forecast**, and renewal mentions extracted from meetings (§7.5).
Empty: `No renewal signal recorded`, followed by exactly which checks ran: no `Opportunity` contract for this Customer; `End date` is `<date>` (`<n>` days away); no renewal mentioned in the last N meetings or walk-throughs. `'Renewal in Engine'` is **omitted entirely** until introspected — a field whose semantics are guessed must not render.

### 6.9 Commercial (finance viewers only)
Fields: Airtable `'Total contracted value (CHF)'`, `'Price per CU (CHF)'`, `Customer.'Revenue 2023/2024/2025'`; forecast `'Monthly revenue'` — B–M monthly, **N = row total for one year**, P Start, Q End, R Term months, S CU, T CU/month, **U = total contract revenue (local)**, V per-month CHF, W/X currency.
Rules: **return ALL matching rows, never the first, never silently the non-zero one.** A zero-total row renders `no figures on this row (often a superseded duplicate)` — explicitly not "worth nothing". This has already produced one wrong answer in production. **P and Q are Excel date serials** on the 1899-12-30 epoch — 46266 is 1 September 2026, not CHF 46,266. Each figure is captioned with the matched **row label verbatim**, because matching is name-only via `labelMatches()` (`lib/finance/forecast.ts:109`) and deliberately over-matches. **Forecast is shown at client level only and never attached to a contract card** — there is no contract id in the workbook. Rows running past December are annotated `term runs beyond the 12 columns in this workbook (Forecast 2026)`.
Absence is only ever reported after an **unfiltered** read of `'Monthly revenue'` — reporting absence off a filtered read is how a live CHF 49,672 Gavi IFFIm contract was reported as non-existent. Absence from any other sheet means nothing: the scenario sheets are totals; `'Contract Details'` and `'Monthly revenue 2024'` are hidden and stale.
No 2026 revenue column exists in `Customer` — say so and point at Xero rather than implying a gap in the data.
Empty for a non-finance viewer: the section **does not render**, and no money figure leaks into §6.2 or §6.3.

### 6.10 Provenance & reconciliation
Per-source `fetchedAt` / read time, `truncated` flags per table, MeetingBrain window and count, extraction model + timestamps, snapshot age, and the reconciliation checks:
Airtable vs Engine AM · recomputed delivered CU vs `units_total_completed` vs `'Delivered CUs in Engine'` · Airtable `Booking status` vs Engine `flag_active + date_end` · `'Remaining CUs'` vs `Contracted − Commissioned` · Airtable dates vs Engine dates · identity state · shared/missing domain.
**An integrity flag downgrades the signals that depend on it to `unassessable`**, it does not merely appear in a list. Nothing is auto-corrected. `Active - Late Delivery` vs Engine `date_end` is classified **expected divergence** and does not render as a fault, or the ledger becomes noise.
Empty: `The sources agree on everything this page checks — 7 checks run.` Naming the count is what makes an empty panel evidence the checks ran.

---

## 7. Derived signals

Four states, always: **`red` | `amber` | `clear` | `unassessable`.** A null input produces `unassessable` — a grey chip reading *"cannot be assessed — `<named missing input>`"*. **A signal whose divisor or comparand is null never renders `clear`.** This is the rule that separates this page from every dashboard that has cried wolf.

Thresholds live in one config object, not inline — they will be wrong on first contact with the Tuesday meeting.

Client band = **worst severity among fired signals, with every contributor named.** No weighting, no arithmetic on colours, and **never cached as a stored score** — recomputed on read from named sources. A stored band is "the id still resolved but no longer meant what the table thought" with a colour on it.

### 7.1 The CU definition, stated once
```
delivered CU  = Σ units_content over (app_tasks_content ∪ app_tasks_social)
                where date_completed IS NOT NULL
                and NOT (flag_spiked = 1 AND date_completed IS NULL)
                and id_client NOT IN (1,2)
commissioned  = same union, same spike rule, all tasks regardless of date_completed
```
**Spike rule: the route rule** (`flag_spiked = 1 && !date_completed`), matching `commissioned-cus` — the route reconciled against Retool — and `contracts-grid:75-89`. Not the stricter `flag_spiked = 1` used by `engine-actuals.ts:105` and `profitability`. One rule, everywhere on this page, printed as a footnote on the figure; the delta from the strict rule appears in provenance. (§12 Q2 if Chris wants the other.)

Mechanics that are load-bearing: paginate with `fetchAllRows` ordered by the **unique `id_task`** (`lib/supabase-paginate.ts:9-13` — a non-unique sort duplicates and skips at page boundaries and inflates totals); date columns are **TEXT bare dates**, so `gte(from)` / `lt(nextDay(to))` per `lib/date-utils.ts:16-25` — a `T`-suffixed filter matches nothing and returns a reassuring, entirely false, zero.

**Never** use `completed_units` or `pipeline_summary` (`providers.ts:1960-2026`) — `app_content`-only, the whole social stream invisible, CU at content-item grain. **Never** use `commissioned_units` — its social branch has no spike filter at all (`:1862-1870`). **Never** use `app_contracts.units_total_completed` as the figure.

`engineActuals()` groups `byClient` only — its `SELECT` (line 50) has no `id_contract`. v1 writes one new function that unions, spike-filters and groups by **both** `id_client` and `id_contract`, reusing engine-actuals' pagination and column discipline. Closing that gap is unavoidable for a page organised around contracts.

### 7.2 Signal: **Blocked** — red
Airtable contract in an active booking status, and either no Engine contract for the client, or `units_contract` null on the Engine contract.
*Fires:* work is sold with nothing to deliver against.
*False alarm:* a brand-new contract in the setup window. **Suppress when Airtable `Start date` is within 14 days.**

### 7.3 Signal: **Behind pace** — amber / red
```
deliveredPct   = delivered CU (client, live contracts) ÷ Σ Airtable 'Contracted CUs'
termElapsedPct = (today − min Start date) ÷ (max effectiveEnd − min Start date)
                 effectiveEnd = COALESCE('Contract extension date', 'End date')
gap            = termElapsedPct − deliveredPct
```
amber at gap ≥ 15pp, red at ≥ 25pp. Computed from **Engine CUs and Airtable dates only** — never from `'Contract delivered %'` / `'Contract term delivered %'`, whose scale is unverified. Those two are shown raw in provenance as a cross-check.
*False alarms, suppressed by construction:*
- **< 30 days elapsed OR < 10% of term elapsed** → suppressed entirely; a tiny denominator makes any gap look catastrophic.
- **`Booking status = 'Active - Late Delivery'`** → downgraded to an informational `known late delivery` chip. Lateness there is already known, owned and re-planned; firing weekly trains the team to ignore the colour.
- **Back-loaded contracts** (strategy phase first) are indistinguishable from failing ones from CU counts, and no field anywhere distinguishes them. The chip therefore reads **"behind an even-pace assumption"**, never "behind schedule".
- `'Contracted CUs'` null or 0, or either date null → `unassessable`, never `clear`.

### 7.4 Signal: **Ends soon, no successor** — amber at T-60, red at T-30
`0 ≤ 'Contract ending days' ≤ threshold` AND no sibling contract on the same Customer with `Booking status ∈ {Booked, Opportunity}` and `Start date ≥ thisEnd − 30d`.
*False alarms:*
- Negative `'Contract ending days'` on `Active - Extended` / `Active - Late Delivery` is **normal operation** — not this signal. On plain `Active` it is a data problem and routes to provenance, not here.
- **Multi-record clients** (Marsh ×3, Zurich ×3, UBS ×3, World Bank ×2) are one commercial relationship split across Customer rows. The successor search must span the sibling set or a booked renewal on a sibling reads as "no renewal". v1 does this by matching on the domain-alias group (§9.3); §12 Q4 asks whether a proper grouping field is wanted.
- **An extension recorded by moving `End date`** produces a contract that never appears to be ending — a false **clear**, the dangerous direction. Cannot be detected in v1; §12 Q5.
*The wording matters:* `no successor contract found in Airtable`, never `no renewal in progress`. The deal may live only in a salesperson's head.

### 7.5 Signal: **Renewal discussed, not recorded** — amber
A renewal mention extracted from a client meeting or a Tuesday bullet in the last 90 days, with no `Booked`/`Opportunity` sibling contract and no `'Contract extension date'`. Renders the **verbatim quote** with its date and link.
Detection is a constrained LLM pass inside the nightly job over `key_topics` / `next_steps` — **not** a regex. "renewal" misses *"what does 2027 look like"*, *"rolling this over"*, and false-fires on *"renewal of the strapline"*.
*False alarm / hard disable:* clients with no registered domain have no meetings to search — signal is `unassessable`, labelled `cannot be measured — no client email domain registered`, **never** `no mention found`. Shared-domain siblings carry the ambiguity label.

### 7.6 Signal: **No delivery in 30 days** — amber
Live contract with `Remaining CUs > 0` (or Engine commissioned < contracted) and zero tasks with `date_completed` in the last 30 days.
*False alarms:* configurable holiday window (August, late December) excluded; suppressed when the contract started < 30 days ago; suppressed when in-flight task count > 0 **and** the oldest in-flight `date_created` is < 30 days.

### 7.7 Signal: **Stale** — amber
No client meeting **and** no Tuesday coverage in 21 days.
*False alarm:* no registered domain → `unassessable`, not stale. Coverage rotation means Tuesday absence alone is never enough — both must be silent.

### 7.8 Signal: **Forecast beyond contract** — informational, finance viewers only
Forecast monthly columns carry revenue in months after `effectiveEnd`. Reads: *"finance is projecting revenue past the contract end recorded in Airtable."* Also the inverse: a live Airtable contract with no `'Monthly revenue'` row at all (after an unfiltered read).
*False alarm:* name-only matching over-matches by design — `Marsh` pulls three accounts. Always caption with the matched row label verbatim, and never escalate this beyond informational.

### 7.9 **Insufficient data** — grey, and load-bearing
Rendered when the majority of checks are `unassessable`. **Green is only reachable when every input to signals 7.2–7.7 evaluated to false rather than null.** A client with no Airtable link and no meeting coverage is grey, never green. The difference between "nothing is wrong" and "we cannot see" is the whole point of this section; collapsing them makes holiday cover dangerous rather than merely unhelpful.

---

## 8. Data loading, caching, and cost

**Architectural decision: Airtable and the forecast workbook are read ONLY by the refresh job. Neither page touches them at request time.** Airtable's limit is 5 req/s per base with a 220 ms enforced gap, and the 60s response cache is per-lambda-instance. Ten staff opening the landing page at 09:00 on Tuesday across three cold instances would blow the base limit instantly. One writer, many readers, permanently.

### 8.1 The refresh job
`app/api/cron/client-summary-refresh/route.ts` — every 15 minutes 07:00–19:00 CET on weekdays, plus a manual **Refresh** from the page header.

| Step | Requests |
|---|---|
| Airtable `Customer` (125 rows, `CUSTOMER_FIELDS`) | 1 |
| Airtable `Contracts` (311 rows, `CONTRACT_FIELDS`) | 4 |
| Airtable `Team` (35 rows) | 1 |
| Airtable `Pods` | 1 |
| **Airtable total** | **7 ≈ 1.6 s** |
| Engine `app_clients` (direct select, incl. AM columns) | 1 |
| Engine `app_contracts` (`flag_active=1 AND date_end >= today`) | 1 |
| Engine task union, batched by `id_contract` in slices of 200 (`contracts-grid:55` pattern), paginated by `id_task` | ~6–10 |
| Forecast workbook (10-min cache, `lib/finance/forecast.ts:19`) | 0–1 Drive |
| Walkthrough segments (`intelligence`, one select) | 1 |
| Client-meeting last-seen dates (one `get_client_meetings` call, 90d, mapped by domain) | 1 |

**Total per refresh ≈ 7 Airtable + ~13 Supabase + ≤1 Drive, ~3–4 s.** Independent of client count — whole-table fetches, not per-client. At 40 or 400 active clients the cost is identical.

Writes one row per client to `intelligence.ai_client_summary_snapshot`, plus a run row carrying per-source `{ok, fetchedAt, truncated}`.

### 8.2 Landing page cost
**One Supabase select from the snapshot. That is the whole page.** Sub-200 ms. Signals are computed **on read** from the snapshot's stored source values (never stored as a band).

### 8.3 Detail page cost
- Snapshot row: 1 select (all Airtable-derived and forecast content).
- `GET /api/operations/commissioned-cus?clientId=…` for the task list: 1 route call.
- Delivery-by-month from the same union: 1–2 selects.
- `queryMeetingBrain("client_meetings", …)`: 1 RPC.
- Walkthrough segments for this client: 1 select.
**Zero Airtable requests.** Cold ≈ 1.5 s.

### 8.4 The walkthrough extraction job
`app/api/cron/client-walkthrough/route.ts` — Tuesdays 14:00 CET and nightly catch-up. See §9.3.

### 8.5 Discipline rules
- **One exported field constant per Airtable table, used for BOTH `assertFields` and the `fields[]` passed to `listRecords`.** `capacityReport:388-407` documents the bug: asserting one list and fetching a narrower one makes un-fetched columns `undefined`, which the formatter faithfully reports as "not recorded" for five fully-populated columns. `assertFields` cannot catch it.
- Every panel shows its snapshot age. Our own cache gets the same rule we apply to Airtable's.
- Components never fetch independently.

---

## 9. Routes, files, functions

### 9.1 Reuse verbatim
| What | Path |
|---|---|
| `listRecords` / `cellNumber` / pacing / `truncated` | `/Users/chris/social-media-app/lib/airtable/client.ts` |
| `ACTIVE_BOOKING_STATUSES` | `/Users/chris/social-media-app/lib/airtable/reports.ts:87` |
| `nameIndex` / `linkNames` / `firstLink` | `/Users/chris/social-media-app/lib/airtable/reports.ts:241,257,263` — **export these; do not reimplement** |
| `fetchAllRows` | `/Users/chris/social-media-app/lib/supabase-paginate.ts` |
| bare-date bounds | `/Users/chris/social-media-app/lib/date-utils.ts:16-25` |
| task-list route (+ `completedFrom/To` param) | `/Users/chris/social-media-app/app/api/operations/commissioned-cus/route.ts` |
| per-contract CU recompute pattern | `/Users/chris/social-media-app/app/api/operations/contracts-grid/route.ts:48-89` |
| content-type / format breakdown, avg production time | `/Users/chris/social-media-app/app/api/operations/contracts/route.ts:170-232` |
| `queryMeetingBrain("client_meetings" \| "meeting_details")` | `/Users/chris/social-media-app/lib/ai/providers.ts:4118-4300` |
| `loadClientDomains()` | `/Users/chris/social-media-app/lib/ai/providers.ts:3757` |
| `resolveClientFromText()` — the ambiguity guard | `/Users/chris/social-media-app/lib/meeting/client-match.ts` |
| service-role MeetingBrain client | `/Users/chris/social-media-app/lib/supabase-meetingbrain.ts` |
| forecast cache + `labelMatches()` | `/Users/chris/social-media-app/lib/finance/forecast.ts:19,109` |
| role primitives | `/Users/chris/social-media-app/lib/permissions.ts` |
| series-matching precedent | `/Users/chris/social-media-app/app/api/ai/meeting/mb-context/route.ts` |

### 9.2 Do not reuse
- `lookupClientContext()` (`providers.ts:1635-1765`) — returns a **markdown string**, filters `flag_active = 1` with **no expiry check** (the exact `-791d` failure `reportContractsSummary:2160` was fixed for), and reads `intelligence.ai_client_meetings` for meetings, which this repo never writes. Take the four queries inside it; leave the function. *(Fixing its expiry check is a worthwhile side-ticket — it feeds live client conversations.)*
- `completed_units`, `pipeline_summary`, `commissioned_units` report functions — §7.1.
- `/api/customers/*`, `/api/contracts` — raw tables, not the `app_*` views; CU from the denormalized column; and `[id]/contracts` is unauthenticated.
- `queryForecast()` — pipe-joined text, 40 rows / 7,000 chars, `raw:false`. Write a structured reader over the same cached workbook buffer.
- `engineActuals()` as the figure source — different spike rule, no `id_contract`. Reuse its discipline, not the function.

### 9.3 New
**Pages** — `app/(app)/operations/clients/page.tsx`, `app/(app)/operations/clients/[id]/page.tsx`
**Routes** — `app/api/operations/clients/route.ts`, `app/api/operations/clients/[id]/route.ts`, `app/api/operations/clients/refresh/route.ts`, `app/api/cron/client-summary-refresh/route.ts`, `app/api/cron/client-walkthrough/route.ts`
**Lib** — `lib/clients/identity.ts` (the join, §3) · `lib/clients/engine-delivery.ts` (the union, spike rule, group by client **and** contract) · `lib/clients/snapshot.ts` · `lib/clients/signals.ts` (the seven, pure functions over the snapshot) · `lib/clients/forecast-reader.ts` (structured, Excel-serial-aware) · `lib/clients/walkthrough.ts`
**Tables (4, all in `intelligence`)**
- `ai_client_summary_snapshot` — PK `(id_workspace, id_client)`, raw source values + per-source `{ok, fetchedAt, truncated}` + `computed_at`. No bands stored.
- `ai_client_walkthrough_segments` — unique `(id_workspace, calendar_event_id, id_client)`; `verbatim_bullet, derived_status, red_flags[], renewal_mentions[], owner_named, confidence, source_meeting_date, extraction_model, extracted_at`. **Written by this repo**, so it is not a mirror we cannot restart.
- `meeting_series_config` — `{series_base, label, role, valid_from, valid_to}`, admin-editable. Seed: `4ub45of5mo7qb50hqgpnur8rjl` (current Tuesday client run-through, from 2026-07-07) and `mogt0g7d65kh12nvvki05emo9g` (predecessor, to 2026-06-25). **Config, not constants** — the team has reshuffled the morning meetings twice already, and the page must be re-pointable without a deploy.
- `client_meeting_domains` — `{id_client, domain, is_primary, alias_group}`. Seeded from `loadClientDomains()`. `app_clients.link_website` is a **marketing URL, not an email domain**, and overloading it further is how VARO Energy, Siemens AG and Zurich Instruments became permanently invisible. `alias_group` is what lets Marsh ×3 / UBS ×3 share a successor search and carry the shared-domain label.

### 9.4 The walkthrough job, precisely
1. For each configured series base: `meetingbrain.processed_meeting` where `calendar_event_id LIKE '<base>%'` **AND `meeting_date <= now()`**. Future occurrences exist as **empty stubs** (2026-08-18, 08-25, 09-01 all have `summary=0`, `transcript=0`); an unbounded query returns a blank "latest".
2. Group by `calendar_event_id`. 8–10 sibling rows per occurrence share a transcript but have different summaries, and on the three most recent occurrences **only one sibling carries `key_topics`/`next_steps`**. Pick the richest (`key_topics NOT NULL` first, then longest transcript); **union `key_topics` across siblings** where several are populated — different attendees' extractions cover different clients.
3. Segment on the **`key_topics` bullet**, which is already one bullet per client with the AM named. Never on the transcript: it is voice-to-text and mangles names (`Amorize`/Amrize, `B1 Medicines`/BeOne, `Bahrain Bin`/Bahrain EDB) while naive tokens over-fire (`Marsh` → 3 records, `Zurich` → 4 including Climate Week Zurich).
4. LLM pass constrained to the active client roster, returning `id_client | null`, guarded by `resolveClientFromText()`. Its `strong` flag is the auto-attach threshold; anything weaker goes to an **"unattributed updates"** list on a Tuesday-meeting view — visible, not filed.
5. Store the **verbatim bullet** as the receipt. A paraphrase of a paraphrase is how "no Hiscox contract exists" happened.
6. **Identify the series by `calendar_event_id` base, never by title.** `"Morning meeting - farewell Jack"` (2026-07-23) is a one-off *title* sitting on the **Highlights** series base — title matching mis-files it, base matching does not.

**Why this bypasses the RPC gate, and the two hard rules.** This meeting's attendees are exclusively `@thecontentengine.com`, so it will never appear in `client_meetings` and `meeting_details` correctly blocks it for team audience. The job therefore uses direct service-role access via `meetingBrainDb`. That is defensible **only** because: (a) it runs over the **configured series bases and nothing else, ever** — never arbitrary internal meetings; and (b) it stores **derived, client-attributed business content only** — never `coaching_notes` (which `providers.ts:4207` refuses to release even privately, because the RPC cannot tell whose they are), never sibling-row identity, never the raw transcript. Never write anything back to the `meetingbrain` schema.

---

## 10. Empty and error states — the rule behind all of them

Every section distinguishes **three** states and renders them differently:

| State | Meaning | Rendering |
|---|---|---|
| **empty** | we looked, found nothing | `No X in the last N days`, with N stated |
| **unreachable** | we could not look | names the reason and the missing input (`no email domain registered`, `not linked in Airtable`, `not recorded`) |
| **failed** | the query errored | `X could not be read at HH:MM` — never a 0, never a blank |

Section-by-section states are given inline in §5 and §6. Three that carry the most weight, repeated because they are the ones that will get lost in implementation:

1. **Tuesday coverage** is always rendered as a date or an explicit "not covered in N weeks". Never blank.
2. **Meeting sections** distinguish "no meetings found" from "this client cannot be matched to meetings at all".
3. **A grey "insufficient data" badge is a success state**, not a fallback. Green must be earned.

---

## 11. v1 / later

**v1 (build this):** landing table + detail page as specified · identity join with all five outcomes · the seven signals · refresh job + snapshot · walkthrough extraction job + segments table · domain alias table · forecast at client level, finance-gated · provenance panel · orphan block.

**v2:** Airtable `Invoices` panel (after the Xero sync cadence is characterised) · `risks`/`sentiment` via an RPC extension · Contracts Monthly revenue-by-month · CRM deal join · signal acknowledge/snooze · the LLM standing brief · scope-creep signal · meeting-cadence signal.

**Why the line is here:** everything in v1 either answers Chris's literal three columns, or is what makes the answers trustworthy (identity join, null discipline, provenance, orphan block). Everything in v2 is either a second opinion on something v1 already answers, or depends on a source whose freshness nobody in this codebase can currently characterise. The section is worth building because it complements the Tuesday meeting; the walkthrough extraction is therefore in v1 even though it is the most work, and the invoice panel is out even though it is the least.

---

## 12. Open questions — only Chris can answer these

1. **Landing AM column when the two systems disagree:** Airtable name + amber disagreement dot (my call, keeps the column scannable), both names stacked, or `disputed` forcing a click-through?
2. **Spike rule ratification.** I picked the Retool-reconciled route rule (`flag_spiked=1 && !date_completed`) for the whole page, with the strict-rule delta in provenance. This is the number the Tuesday meeting will quote out loud, so it is your call — and the alternative is unifying the repo on one rule, which is bigger but removes a permanent footgun.
3. **Is there a real contract-level join between Airtable `Contracts` and Engine `app_contracts`?** `'Engine contract'` and `'Contract ID'` exist and nothing in the repo reads them. Ten minutes in the base decides whether contract cards can carry Engine delivery figures at all, or stay plan-only as specced.
4. **Multi-record clients** (Marsh ×3, Zurich ×3, UBS ×3, World Bank ×2): is a page one Airtable Customer record, or one real client grouping records? v1 groups them only for the successor search and the shared-domain label. A proper grouping field in the base would be better and needs someone to own it.
5. **How is an extension recorded** — a new `Contracts` row, a moved `End date`, or `'Contract extension date'`? A moved `End date` produces a **false clear** on renewal drift, the dangerous direction, and I cannot detect it.
6. **Three introspections needed before build** (Administration → Integrations → Airtable → Inspect base, or `GET /api/airtable/status?schema=1`): (a) what does **`'Renewal in Engine'`** mean? If it is "the successor contract has been created in Engine", it is the best renewal-not-actioned flag anywhere in the four sources and §6.8 should lead with it. (b) Are the `%` fields fractions or whole numbers? v1 sidesteps this by computing pace from CUs, but the answer unlocks showing Airtable's own percentages. (c) Does the `Pods` table have `'Pod lead'`, and does `Customer.Active` return a boolean?
7. **The three invisible clients** — VARO Energy (46), Siemens AG (91), Zurich Instruments (92) have no usable email domain, so their relationship panel is permanently empty. Supply the domains, or ship with the named blind spot visible in the orphan block?
8. **Do `Booked` contracts appear on the landing page?** My call: a separate "Starting soon" group above the walk — folding them into Live shows 0% delivered and reads as failure; dropping them hides a contract starting next week. Confirm.
9. **Money visibility.** `users_access.flag_access_finance` is set for **5 of 693 users**. Is it set for the CEO and the finance viewers this page is partly built for? And should a finance-only signal drive an AM's band as `Attention — finance detail restricted` (my call) or not at all?
10. **Verbatim internal quotes on a shared page.** §6.7 stores and displays verbatim Tuesday bullets — internal candour about a client, with speakers named, on a page ~60 staff can open. That is right for provenance. Confirm you are comfortable, and confirm the hard exclusions (never `coaching_notes`, never raw transcript, email addresses stripped from attendees).
11. **Walkthrough history.** Only 6 processed occurrences exist (7 Jul – 11 Aug). Backfill the predecessor series (`mogt0g7d65kh12nvvki05emo9g`, to 25 Jun) to make "not covered in N weeks" meaningful, accepting that it was a differently-shaped meeting? And do you want the other four weekday series (Priorities / Highlights / Knowledge sharing / Social) mined, or strictly the Tuesday client run-through?
12. **Threshold ratification.** Behind-pace 15pp/25pp; ends-soon T-60/T-30; no-delivery 30 days; stale 21 days. These are proposals, not measurements. Worth back-testing against Q2: which clients would have been red in April, and was that right?
13. **Who may press Refresh**, and is 15 minutes right — or does the meeting want a live fetch at open (~4 s cold)?
14. **Does TCE's own work (client ids 1, 2) appear** as a pinned row at the bottom, or stay absent entirely? v1 says absent, listed in the orphan block.