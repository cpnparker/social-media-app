# TCE Operations & Resourcing base — Phase 0 schema digest (read 2026-08-12)

17 tables. Row counts are real (retrieved, not estimated).

> **This file is a DIGEST, not the schema.** The field lists below are abridged
> — grouped, elided with `…`, and summarised in prose. A name's absence here is
> NOT evidence it is absent from the base.
>
> That distinction has already cost real work: an audit was pointed at this file
> as ground truth and reported two blocking defects, both false, because
> `Contracts Monthly.Customer`, `Contracts Monthly.Booking status` and the five
> `<Discipline> capacity` rollups on `Monthly resourcing` are all real columns
> that this digest never listed.
>
> **To check a field name, read the base**, not this file:
> `GET /api/airtable/status?schema=1` as a workspace admin, or
> Administration → Integrations → Airtable → Inspect base. `assertFields()`
> checks against the live schema at runtime for the same reason.

## The spine

**Contracts** `tblbUyXiJ6L6zSrfm` — 311 rows
Identity: `Contract ID` (number), `CRM ID` (text), `ID` (formula), `Customer ID` (lookup)
Core: `Contract name`, `Customer`→Customer, `Contract status` (singleSelect), `Booking status` (singleSelect),
`Contract type`, `New or existing`, `Start date`, `End date`, `Contract extension date`, `Payment term`
Money: `Total contracted value (contract currency)`, `Total contracted value (CHF)`, `Contract currency`→Currency exchange,
`Price per CU (CHF)`, `Contract price per CU (CHF)`, `Monthly management fee`, `Monthly service fee`, `Revenue 2023/2024/2025`
Volume: `Contracted CUs`, `Commissioned CUs`, `Remaining CUs`, `Delivered CUs in Engine`, `Commissioned CUs in Engine`,
`Forecasted CUs`, `Average CUs month`, `Contract delivered %`, `Contract commissioned %`, `Contract term delivered %`
People (all →Team): `Account Manager`, `Senior Account Manager`, `Content Manager`, `Strategy Manager`,
`Writer 1`, `Writer 2`, `Freelance writer`, plus `Scenarios *` variants of each
Links: `Delivery months`→Contracts Monthly, `CU Management`→Account Manage, `CU Production`→Production,
`Contract payments`→Invoices, `Freelancer assignments`→Freelancer assignments, `CRM contract`→Import from CRM
Engine bridge: `Engine contract` (formula), `Delivered CUs in Engine`, `Renewal in Engine`
Flags: `Contract ended`, `Contract ending soon`, `Contract ending soon (90 days)`, `Contract ending days`,
`Is renewal`, `New business`, `Delivered after contract ended`, `CUs match`
DENORMALISED MONTH COLUMNS: ~150 rollups named `<Month> <Year> contracted CU` / `booked CU` / `contracted CHF`,
spanning January 2023 → September 2026. A human adds a new column every month. Do not build reports on these.

**Contracts Monthly** `tble5uNG3aannvQyf` — **2500 rows, TRUNCATED (there are more)**
The per-contract-per-month grain. `Contract`→Contracts, `Month` (singleSelect), `Order` (number),
`Date` (lookup), `Delivery month` (formula), `Year` (formula), `Active in month` (formula)
Three separately-owned volume columns, and the owner is named in the column:
  `Contracted CU (SALES)` · `Booked CU (EDITORIAL)` · `Production CU (FINANCE)` · `Delivered CU`
Time: `Contracted Time hours (SALES)`, `Booked Time hours (EDITORIAL)`, `Production time hours (FINANCE)`
Forecast: `Forecasted CU de-risked (SALES)`, `... (BOOKED)`, `... (BOOKED and SALES)`, `... with manual override`,
`Probability with override`, `Probability of conversion manual override`
Revenue: `Contracted revenue (CHF)`, `Booked revenue (CHF)`, `Commissioned revenue (CHF) raw`,
`Delivered revenue (CHF) raw`, `Forecasted revenue (CHF) ...`, `Revenue recognised`, `Rollover CUs`
Link up: `Month targets`→Monthly resourcing

## Resourcing

**Team** `tblPjFckBAAvYaHiM` — 35 rows
`Name`, `Job` (singleSelect), `Position` (singleSelect), `Team` (singleSelect), `Pod`→Pods, `FTE rate`
**`Engine_IDs` (singleLineText) ← THE IDENTITY BRIDGE TO ENGINE. Not an email. Format unverified.**
Quotas: `Production quota`, `Strategy production quota`, `Video production quota (current month)`,
`Visuals production quota`, `Text quota (current month)`, `AM quota (current month)`, `AM quota (next month)`,
`Quota %`, `Quota % Scenario`, `Reset quotas`
Load: `CU Management total`, `CU Production total`, `Customers #`, `Contracts #`, `Writing for clients`
Links: `Resourcing`→Team resourcing, plus live/scenario link pairs to Contracts

**Team resourcing** `tblNgTWUWv5zXbTGg` — 336 rows
Per person per month. `Team member`→Team, `Months`→Monthly resourcing, `Month-Team` (formula key), `Month order`
Capacity, in BOTH CUs and hours, per discipline:
  `AM capacity` / `AM capacity time (hours)`
  `Text production capacity` / `... time (hours)`
  `Video production capacity` / `... time (hours)`
  `Visuals production capacity` / `... time (hours)`
  `Strategy production capacity` / `... time (hours)`
Demand lookups: `Total CUs booked`, `Text/Video/Visuals/Strategy CUs booked`

**Monthly resourcing** `tblCovc88YOn0MdVO` — 66 rows ← company-level monthly rollup, small enough to fetch whole
`Month` (text), `Date`, `Order`, `Order and month`, `Year`
Capacity vs demand per discipline: `AM capacity vs demand`, `Text capacity vs demand`, `Video ...`,
`Visuals ...`, `Strategy ...`, plus `* vs predicted demand` variants
Freelancer: `Text/Video/Visuals/Strategy freelancer estimate` (+ predicted), `Total freelancer estimate`,
`Total freelancing costs CHF (booked)`, `Total freelancing CUs`
Targets & gaps: `CU: target`→Sales targets, `Revenue: target`, `CU Gap: forecasted`, `CHF GAP: forecasted`,
`CU Gap: booked`, `CHF GAP: booked`, `CHF GAP: CU price`
Actuals: `CU: booked + opps`, `CU: contracted`, `CU: delivered`, `Revenue: booked/contracted/delivered/forecasted`,
`Commissioned CUs`, `Active customers`, `Opportunities customers`, `Average booked CU price (CHF)`
Format mix ratios: `Text ratio`, `Video ratio`, `Visuals ratio`, `Strategy ratio`, `Social publishing ratio`,
`Contract adjustment ratio`, `Total ratio check`

## Assignment junctions

**Account Manage** `tblQtCjgrIv7FQzBF` — 48 rows
`Editorial team`→Team, `CU Manage`→Contracts, `Scenario CU Manage`→Contracts, `Content Units`,
`Scenario Content Units`, `Role` (singleSelect), `live or scenario` (formula), `Time (hours)`,
`CUs booked in current month`
NOT a client table — it matched a "account" name heuristic. It is the person↔contract allocation join.

**Production** `tblqZRZUpnwY4BETh` — **1 row** — same shape as Account Manage, effectively abandoned.

## Clients, money, external systems

**Customer** `tblj5u3r8C5EATeSD` — 125 rows
`Customer` (name), **`Engine ID` (number)**, **`CRM ID` (number)** ← clean id join, no name matching needed
`Pod`→Pods, `Contracts`, `Contracted CUs`, `Contracted value`, `Average price of CU`,
`Earliest contract start date`, `Latest contract end date`, `Start year`, `Active` (formula),
`Number of contracts`, `Revenue 2023/2024/2025`

**Invoices** `tblRT8vNuhSR1eLa8` — 393 rows
`Contract`→Contracts, `Customer` (lookup), `Status` (singleSelect), `Payment amount`, `Paid amount`,
`Payment due date`, `Paid date`, `Invoice date`, `Period start date`, `Period end date`, `past due date`,
**`Xero ID`, `Xero customer name`, `Currency`** ← direct bridge to the existing Xero integration

**Freelancers** `tblnM50ItziG8SOZg` — 51 rows — `Name`, **`Email` (type email)**, `Rate per CU`, `Rate currency`
**Freelancer assignments** `tbl117ELScIZLrKk6` — 321 rows — `Freelancer`→Freelancers, `Contract`→Contracts,
`Commissioned by`→Team, `Contracting month`→Monthly resourcing, `Format` (singleSelect), `Status` (singleSelect),
`CU`, `Total cost CHF`, `Rate per CU CHF`, `Assigned date`, `Engine content link` (url)

**Import from CRM** `tbl3Uw4VIHD5e7zFN` — 115 rows — `Deal`, `Deal ID`, `Client ID`, `CUs`, `Amount`,
`Status`, `Calculated status`, `Probability`, `create date`, `close date`, `Contracts`→Contracts
**Sales targets** `tblJhPPK91fOomKme` — 60 rows — `Target CUs`, `Target CHFs`, `Target CUs price CHFs`, `Month`
**Pods** `tblX9IrkqnxTt320f` — 6 rows — `Pod name`, `Pod lead`→Team, `Customers`
**Currency exchange** `tblOxSaUKyqd0h0zp` — 7 rows — `Currency`, `Value`
**Formats** `tblIPb6C9qFycOoR9` — 5 rows — `Format`

## Views worth knowing (they encode business logic already)

Contracts: `Active and extended`, `Opportunities`, `Lost`, `Resourcing summary`, `Resourcing needs resourcing`,
`Resourcing scenarios summary`, `CHECK - ending soon (30 days)`, `CHECK - ending soon (90 days)`,
`RENEWALS - opportunities`, `RENEWALS - missing (ending in 90 days)`, `Contracts missing from the Engine`,
`Contracts in the Engine live`, `Contracts overdelivered`, `Not yet delivered CUs`
Monthly resourcing: `Resourcing - Summary booked`, `Resourcing - Summary predicted`, `Resourcing - Capacity`,
`Resourcing - Account Management`, `Resourcing - Text/Video/Visuals/Strategy`, `SALES report`, `FINANCE report`
Team: `Live team capacity time (hours)`, `Scenario team capacity time (hours)`, `Live vs Scenario differences`
Team resourcing: `Define staff capacity (per team)`, `Teams - Account Management/Video/Visuals/Text/Strategy`
Contracts Monthly: `SUMMARY Active and Opportunities by month`, `SUMMARY Resourcing`, `Active by month`

## Identity join — probed 2026-08-12

`Team.Engine_IDs` holds **a single numeric Engine user id** (e.g. `12`), on every populated row.
The column name is plural; the data is not. Parse defensively anyway — the name invites
someone to type `12,34` eventually — but do not build the join around a list that isn't there.

**Populated on 11 of 35 rows.** Team mixes live staff with leavers and scenario placeholders,
so the live-roster coverage is better than 31% but is not 100%.

The consequence for the report layer, which holds either way:

> **The identity join is optional, never foundational.** Every Airtable-only report — roster
> capacity, monthly outlook, contract health — works for all 35 rows without it, because
> Airtable knows its own people by name. The id is needed for exactly two things: resolving
> the signed-in Engine user to their Team row ("what is *my* workload"), and blending Engine
> actuals into the Airtable plan. Both must fail by name — "your Engine account is not linked
> to a Team row" — and never by returning zero, or by falling back to matching on display name.

`Freelancers` has `Email` and is the separate people surface; staff and freelancers do not
share an identity scheme.

## Select options — read 2026-08-12, these are the literal filter values

**`Contracts Monthly.Month`** is **year-qualified**: `January 2022` … `August 2027`, 68 options,
`"<Month> <YYYY>"`. So `{Month} = "September 2026"` is unambiguous and the separate `Year`
formula is redundant for filtering. This was the single largest correctness risk and it is closed.

**`Contracts.Booking status`** — `Opportunity`, `Booked`, `Active`, `Ended`, `Active - Extended`,
`Lost`, `Active - Late Delivery`.
> **Active is THREE values.** `{Booking status} = "Active"` silently drops extended and
> late-delivery contracts. Always match the set.

**`Contracts.Contract status`** — `Contract signed`, `Contract sent`, `Proposal sent`,
`Qualification`, `Lost`, `Approved by DM`. (Sales pipeline stage; orthogonal to Booking status.)

**`Contracts.Contract type`** — `Member - extension`, `Trial`, `Project ` (trailing space —
copy verbatim), `Member`, `Briefing`.
**`Contracts.New or existing`** — `Renewal`, `New business`.
**`Contracts.Payment term`** — `Annually`, `Quarterly`, `Monthly`, `Custom`.

**`Team.Team`** — `Account Management`, `Text`, `Video`, `Visuals`, `Strategy`. The five
disciplines, matching the capacity columns on Team resourcing.
**`Team.Job`** — `Senior Account Manager`, `Account Manager`, `Content Manager`,
`Hybrid writer/AM`, `Management`, `Writer`, `Video producer`, `Freelancer`, `Strategy Manager`,
`Designer`.
**`Team.Position`** — `CEO`, `Senior management`, `Management`, `Account manager`, `Writer`,
`Associate`, `Hybrid Writer AM`, `Pod lead`, `Marketing manager`, `N/A`.

**`Freelancer assignments.Format`** — `Text`, `Visual`, `Video`, `Account Management`, `Report`,
`Other`, `Animation`, `Editing`, `Voiceover`, `Strategy`.
> **Ten formats, five disciplines.** `Text`/`Video`/`Strategy` map straight across, `Visual`→Visuals,
> `Account Management`→AM. `Report`, `Other`, `Animation`, `Editing`, `Voiceover` map to nothing.
> The `Formats` table cannot help — one column, and `Format` is a singleSelect that does not link
> to it. So the map is code-owned, and unmapped CUs go in a named bucket printed beside the gap,
> never dropped.
**`Freelancer assignments.Status`** — `Planned`, `Accepted-Booked`, `Completed`, `Invoiced`, `Paid`.
**`Invoices.Status`** — `Late`, `AUTHORISED`, `PAID`, `DRAFT` (Xero's casing, plus a local `Late`).
**`Account Manage.Role`** — `Account Manager`, `Content Manager`, `Senior AM`, `Strategy Manager`.

## Field types that change the arithmetic

`Team resourcing` pairs scalar capacity with **lookup** demand:

| Column | Type | Reads as |
|---|---|---|
| `AM capacity`, `Text/Video/Visuals/Strategy production capacity` | `currency` | number |
| `* capacity time (hours)` | `duration` | number |
| `Total CUs booked`, `Text/Video/Visuals/Strategy CUs booked` | **`multipleLookupValues`** | **array** |
| `Month order` | **`multipleLookupValues`** | **array** |

So `capacity - booked` mixes a scalar with an array. `Number([5,3])` is `NaN`, `NaN || 0` is `0`,
and the person on four contracts reads as fully idle while the person on one reads correctly.
Every numeric read goes through `cellNumber()` (`lib/airtable/client.ts`), which returns
`AMBIGUOUS` rather than a number. See `scripts/verify-airtable-cells.ts`.

`Monthly resourcing.Order` is **`singleLineText`** — lexical sort puts "10" before "9". Order
months by the real `Date` field (type `date`), never by `Order` or by the text `Month`.

## Still unverified

- True row count of Contracts Monthly beyond the 2,500 page cap
- Whether the populated `Engine_IDs` values all resolve to live `users.id_user` rows
