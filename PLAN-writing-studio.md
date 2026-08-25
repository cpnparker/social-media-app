# PLAN — The Writing Studio

Designed 2026-08-25 from the owner's brief (live analysis while writing, inline
continue/finish, recognised content types, dynamic review on paste, context
documents, private with session-grade sharing). Investigated against HEAD by
four parallel readers, designed whole, then adversarially verified from three
lenses (spend/abuse, the writer, feasibility-at-file:line). Every Δ Vn.m marks
a verifier finding that changed the design, at the point it changed it.

All file:line references re-verified against HEAD today (2026-08-25). Verifier-driven changes are marked **Δ Vn.m** (verifier n, finding m) at the point they changed the design, with the reason. Where verifiers offered different fixes for the same defect, the adjudication is stated inline.

---

## 1. THE SHAPE IN ONE PARAGRAPH

The existing Content Optimizer studio grows into EngineAI's create-and-improve surface: same sidebar section (relabelled **Content**), same sessions, same Tiptap editor, same one anchoring path — extended with three content types (article/report/CV) that re-weight the existing rubric and gate which analyses may run and **which chrome renders**; three analysis layers with three costs (free tier-0 marks per keystroke, cheap luna "hints" by sentence-index on block completion, the paid Sonnet judge on explicit Assess); an opt-in end-of-document ghost continuation and explicit finish-section/finish-document streams, all Sonnet-written and digit-gated against invented figures; attachable source documents that extend the fabrication gate's allowed corpus so real figures from a brief can enter suggestions with visible provenance; and per-recipient view/collaborate sharing on the design_shares pattern, with every mutating or paid route gated so a view share can never spend or write. Every automatic model call is counted **before** it runs against seeded, fail-closed service rows — the spend curve stays dominated by what the writer explicitly clicked.

---

## 2. THE WRITER'S EXPERIENCE

**Scene: a new article.** Start screen shows two co-equal cards — "Write something new" (chips: Article · Report · CV) and "Bring content in" (the five existing tabs, `SOURCE_FOR_TAB` StartScreen.tsx:42, unchanged). Picking Article opens the Set up step (today's brief phase: title, target queries with canon chips, sub-format from `FORMATS` page.tsx:59, platform, audience/goal). The studio opens with the type chip in the header. She types; tier-0 underlines appear and move with the text on the 600ms debounce (page.tsx:1134-1137, `repaintLive` :701-728), $0. When she closes a paragraph with Enter, a hint pass runs on the dirty blocks; 2–4s later a dotted underline appears — "AI hint" in the popover badge. The header health pill is a severity dot on desktop (the panel already shows counts, page.tsx:1170-1174); below `lg`, where the panel is hidden, it carries the count and opens a suggestions sheet **(Δ V2.8 — the pill duplicated the panel count exactly where the header is most crowded; scoped to dot-only on lg+)**. At the end of the draft she pauses 2.5s: one grey sentence renders at the caret — but only because she accepted the first-use chip "Suggestions as you type? Tab accepts · Esc dismisses · turn off any time"; ghost is **opt-in, persisted per writer, toggle beside the health pill** **(Δ V2.3 — default-on 1.2s ghost with the switch in an overflow menu is the configuration most likely to feel like the tool fighting the writer's voice)**. Tab inserts it as a normal undoable transaction. ⌘⏎ runs Assess exactly as today (memo → claim → Sonnet → findings land via `judgeFindingsRef` page.tsx:699); hints overlapping a judge finding are dropped. Finish section (⌘⇧⏎) streams Sonnet into the caret's section; its subtext reads "One model call — a few cents, up to ~10¢ on a long draft" **(Δ V1.5 — "about a cent" understated an 8000-max-token pass by up to 10×)**.

**Scene: pasting existing content.** She pastes 2,000 words into a fresh session. Tier-0 marks are instant. All pasted blocks enter the dirty set and **one bulk hint call** covers the whole paste (single luna request, its own length gate, exempt from the 20s spacing, counted once against the hourly cap); the pill shows "Reviewing pasted text…" for ~3–5s and, if the document exceeds the bulk cap, says "Reviewed the first ~6,000 words" — partial coverage stated, never implied-complete **(Δ V1.6 + V2.1, same finding independently: the promised one-pass review could not fit through the interactive route's ≤12-block/≤4,000-char/20s gates — a 40k-char review would have taken 3+ minutes; both proposed the dedicated bulk variant, adopted)**. The free type heuristics re-run; "This looks like a CV — switch type?" appears as a non-blocking chip, never a silent switch. Imports keep landing directly in the studio (`onImported={openSession}` page.tsx:816); the detected type renders as the header chip in a "detected — tap to confirm" state, pre-opened when confidence is low **(Δ V2.7 — routing imports through a Set up interstitial would have broken the import-first hierarchy; the design now says which path each entry takes: Set up is the write-new path only)**.

**Scene: a CV.** The chrome fits the type, not just the backend: no assessment chip, no Assess button, no Coverage tab, and the Score tab is replaced by a **Checks** list (the checklist presentation IssueList.tsx:96-99 names as the honest home for absence criteria) — because with the judge off, today's chrome would show "Not reviewed" forever beside a button that 400s, a Coverage tab for a disabled analysis, and a graded "Optimisation Score" circle over a CV, which the page's own doctrine calls dishonest (page.tsx:102-110) **(Δ V2.2 — the per-type backend was specified but the cockpit still offered everything; the registry's `analyses` record now drives chrome, and `verify-optimizer-types` asserts the wiring)**. What the CV writer gets: placeholder/name-consistency/stale-year/heading marks, hints with CV doctrine (fragment bullets, no first-person prose), ghost, and the IssueList empty state no longer says "Assess this draft" (IssueList.tsx:102-117).

**Scene: shared.** A teammate receives "Chris shared 'Q3 outlook' with you — view" with a `?session=` deep link. Sidebar shows it under Content with "shared by Chris". View: editor `editable={false}`, ghost/hint triggers never arm, paid buttons hidden, panels replay the stored assessment; clicking a tier-0 mark opens a **read-only popover** — explanation, severity, "view only", no Fix-with-AI/Apply/Edit row **(Δ V2.10 — the default popover offers paid and mutating actions (IssuePopover.tsx:160-178) that would 403; view recipients are never offered a button that hits a wall)**. Collaborate: full studio; every paid call they fire is billed and logged as them (`logAiUsage({userId: guard.caller.userId})`, assess/route.ts:214-216) — but the plan no longer claims they are *capped* as themselves: service caps are one shared pool per row (`getRecentSpendCents` filters only `type_app`+`type_source`, service-control.ts:89-94); the per-actor bound is the per-user rate cap below **(Δ V1.2 — the attribution claim was false against the guard code; corrected, and a real per-actor bound added)**.

---

## 3. ARCHITECTURE

### Tables (all `intelligence.*`, shipped as explicit ALTERs/CREATEs per the migration's own discipline, sql:270-290)

```sql
-- Stage 1
ALTER TABLE optimizer_sessions ADD COLUMN IF NOT EXISTS type_content text NOT NULL DEFAULT 'article';
ALTER TABLE optimizer_sessions ADD CONSTRAINT optimizer_sessions_content_chk
  CHECK (type_content IN ('article','report','cv'));            -- 23514 handler replicated from import/route.ts:360-367
-- status CHECK re-created with 'generating' added, so finish can hold an assess-style claim   (Δ V1.5)
-- Stage 2
CREATE TABLE optimizer_sources (
  id_source uuid PK, id_session uuid FK ON DELETE CASCADE,
  type_source text CHECK ('pasted','file','gdoc-link','url'), name_title text,
  document_source_ref text, document_text text, document_summary text,
  units_words int, flag_untrusted boolean, date_created timestamptz);
CREATE TABLE optimizer_auto_calls (                              -- (Δ V1.1 + V3.1)
  id_call uuid PK, id_session uuid, user_caller int,
  type_call text CHECK ('live','bulk','ghost'), units_seq bigint, date_created timestamptz);
CREATE INDEX ... ON optimizer_auto_calls (id_session, type_call, date_created);
CREATE INDEX ... ON optimizer_auto_calls (user_caller, type_call, date_created);
INSERT INTO service_config (app, type_source, killed, hard_block, daily_cap_cents, monthly_cap_cents)
  VALUES ('engine','optimizer-ghost', false, true, 500, 5000)
  ON CONFLICT (app, type_source) DO NOTHING;                     -- (Δ V1.3); onConflict shape proven at service-control.ts:330-336
-- Stage 3
CREATE TABLE optimizer_live_memo (key_memo text PK, findings jsonb, flag_failed boolean,
  id_session uuid, user_caller int, date_created timestamptz);
CREATE TABLE optimizer_shares ( ... );                           -- exact mirror of design_shares, 20260517_design_mode_v2.sql:204-213
ALTER TABLE optimizer_sessions ADD COLUMN IF NOT EXISTS config_hint_dismissals jsonb NOT NULL DEFAULT '[]';
INSERT INTO service_config ... ('engine','optimizer-live', false, true, 300, 3000) ON CONFLICT DO NOTHING;
```

**Δ V1.1 + V3.1 (same major finding, adjudicated):** the ghost rate cap had no enforcement substrate — `optimizer_live_memo` only ever receives tier-1 rows, ghost is deliberately unmemoised, and `ai_usage` carries no session id (`id_conversation: null` hardcoded, usage-logger.ts:42) and is inserted fire-and-forget *after* the call. V1 offered a counter table or counting `ai_usage`; V3 offered nonce memo rows or `ai_usage`. Adjudication: a dedicated `optimizer_auto_calls` row inserted **before** every billable automatic call (one per tier-1 miss batch, per bulk pass, per ghost render; memo hits insert nothing and correctly don't count). It cleanly separates memo (idempotent cache) from rate accounting (append-only counter), enforces before spend rather than after, and gives both per-session and per-user counts from two indexed queries. `units_seq` is a client-monotonic sequence per session; ghost requests with a non-increasing seq are rejected before the model — a replayed request costs nothing (V1's stale-`draftVersion` server-side rejection, implemented as the cheaper seq compare).

**Δ V1.3 (major):** the two automatic service rows are **seeded in the same migration as their routes**, upsert-on-conflict, `hard_block=true`, caps set from §4's own economics — because an absent row is a silent no-op guard: `getConfig` returns null (service-control.ts:63), `assertNotKilled` passes on null (:117-118), `isOverHardCap` returns false on `!cfg` (:130). This is the generate route's recorded failure ("the cap could never fire", generate/route.ts:116-122) reborn. Source summarisation and type-detection fallback are **explicitly assigned to `optimizer-live`**; finish and detection-confirm-free paths stay on `optimizer`.

### Routes

Under `app/api/optimizer/sessions/[id]/`: **`live`** (POST; `mode: "interactive" | "bulk"`), **`ghost`** (POST), **`finish`** (POST, SSE), **`sources`** (GET/POST) + `sources/[sourceId]` (DELETE), **`shares`** (GET/POST/PATCH/DELETE). Unchanged in shape: import, sessions, draft (PATCH updates the current version row, draft/route.ts:1-9), assess, suggest, generate, coverage, audit.

### Content types

Registry `lib/optimizer/content-types.ts` as designed (pillars re-weighted to 10000, criteria filtered from the shared universe before the engine runs, one byte-stable `judgeSystem` per type, versions stamped `"<type>@<version>"`), **plus a chrome contract** derived from `analyses` **(Δ V2.2)**: `judge:false` hides the assessment chip (page.tsx:1012-1045), the Assess button (:1081-1086), and the IssueList assess CTA (:102-117); `coverage:false` hides the Coverage tab (:1176-1182); CV replaces the graded Score circle with the Checks list. `type_content` joins `assessmentKeyWith`'s parts (judge.ts:589-607, which already carries `input.format` and `JUDGE_MODEL`) and `coverageKey` (coverage.ts:367), pipeline versions bumped. An analysis a type turns off 400s **before** `assertServiceAllowed`. Detection: deterministic heuristics from source priors + parsed structure; disagreement resolved by one memoised closed-label call on **gpt-5.6-luna** (never grok-4-1-fast — retired slug redirected and billed at grok-4.3's $1.25/$2.50, model-costs.ts). **Δ V3.6:** the assess route's 413 copy ("calibrated for 800-2,500 words", assess/route.ts:108-115) becomes type-aware — a report writer is not told their document should be 2,500 words; report behaviour at the 40k cap is Open Decision 1.

### The live protocol (indices, never quotes)

Interactive: `{draftVersion, blocks:[{key,text}]}`, ≤12 blocks / ≤4,000 chars, coalesce 2s, 20s minimum spacing, trigger = block completion. Bulk (`mode:"bulk"`): one call, ≤40k chars, whole-doc memo key, exempt from spacing, counted once — used on paste ≥400 chars and once on first open of imported/stale sessions. Misses go to luna with a ~700-token system covering **only intra-block criteria: experience substantiation, unsourced absolutes, antecedent self-containment, and intra-block entity inconsistency** — returns `{block, sentenceIndex, criterion, severity, note}`; the server slices quote+prefix+suffix via the `sliceFinding` shape (judge.ts:466-491) and returns judge-wire findings with ids `hint:{criterion}:{blockKey}:{n}`.

**Δ V3.2 (major, adjudicated):** the memo key (`workspace|type_content|model|LIVE_PROMPT_VERSION|blockText`) omits session context, but entity drift is *defined* by the session's registered names (`buildSessionBlock`: "Registered names for the main entity (any OTHER form is drift)", judge.ts:133) — so either session context enters prompt+key, or the criterion can't work as described. Adjudication: **option (b)** — the tier-1 prompt is session-blind by construction (no canon, no sources, no brief), entity drift is scoped to two variant spellings *inside the submitted block*, stated in the registry; full cross-document drift remains the judge's. This keeps the key honest, the cache workspace-reusable, and avoids re-fighting the version-never-reached-the-hash war (judge.ts:578-588). `verify-optimizer-live` asserts the prompt contains no session-derived bytes.

**Hint layer in the UI (Δ V2.4):** IssueList currently splits two ways on the `live:` prefix alone (IssueList.tsx:60-61) — `hint:` ids would land in `judgeOpen` and be miscounted as "from the AI review". Specified: a three-way split on id prefix, header line "N instant · N AI hints · N from the AI review / AI review not run", hint cards badged distinctly, popover badge gains the third state (IssuePopover.tsx:124 split extended). The health pill counts **all advisory marks** (tier-0 + hints), named consistently. **Δ V3.5:** overlap priority judge > hint > tier-0 cannot ride quote length — `anchorFindings` claims longest-first (highlight-plugin.ts:117-119) and hint quotes clamp to the same 200-char cap; an explicit `tier` field (derived from id prefix at construction) joins `HighlightFinding`, sort `(tier, length)`, with fixtures that fail under the old length-only sort. **Δ V2.9:** hints are honest about permanence — the memo *is* the persistence: reopening a stale session re-runs the bulk pass where unchanged blocks are free memo hits; dismissed hint ids persist in `config_hint_dismissals` so dismissals survive reload (the stable-id rationale made true).

### Ghost

Opt-in per writer **(Δ V2.3)**; trigger = 2.5s idle **and caret at the end of the document** (last block, nothing after but whitespace), ≥8 words since last render, no stream, not IME-composing. **Adjudication (from Δ V1.7 + Δ V2.3 jointly, going further than either):** v1 ghost is end-of-document continuation *only* — mid-document continuation is what Finish section is for, an absent mid-edit ghost needs no explanation, and it makes the append-only cache model true by construction instead of by hope. One sentence, `max_tokens: 64`, stop `\
\
`; Tab accepts, Esc dismisses. **Δ V2.6:** Esc precedence specified — the ghost handler runs first inside the plugin's `handleKeyDown`, swallows and stops propagation, so the popover's window listener (IssuePopover.tsx:114-120) never sees the same press; one key, one effect. **Δ V3.4:** the ghost extension joins the module-constant `OPTIMIZER_EXTENSIONS` (page.tsx:52-57) at studio load — `useEditor` silently ignores a changed extension array (TiptapEditor.tsx:59-66) — and the toggle, per-type doctrine, and Tab precedence flow through plugin meta / ref-backed state (the `judgeFindingsRef` pattern), never through the array.

**Ghost caching (Δ V3.3, confirmed against the current API reference via the claude-api skill):** cache entries key on exact bytes at block boundaries with a 20-block lookback; a single monolithic draft block with `cache_control` at its end changes bytes on every append, so the whole draft would re-write at 1.25× ($2.50/M) per call — ~4× the modelled cost. Fix adopted: serialize draft-so-far as **one content block per top-level draft block**, breakpoint on the last (3 of 4 breakpoints used: system+doctrine ≥1024 tokens (the verified Sonnet 5 minimum) → session+canon+sources → draft-last-block; caret instruction volatile). Appending re-writes only the current paragraph; the lookback lands hits at the last completed block. A paste adding >20 blocks misses once, then re-caches.

Digit gate before return (corpus = draft ∪ source texts ∪ canon facts, extending suggest-gate.ts's doctrine); **Δ V2.5:** the generation doctrine for ghost/finish/suggest now requires that a source-derived figure **names its source in the same sentence** (`name_title` exists for this) — otherwise `stat-source-adjacency`, severity high (live-issues.ts:48), red-flags the tool's own freshly-accepted prose while the provenance note says "from Q3 brief" one inch away.

### Model slots (rates verified in `lib/ai/model-costs.ts` today)

| Slot | Model | Notes |
|---|---|---|
| Tier-0 | none, in-browser | page.tsx:701-728, $0 |
| Tier-1 hints, bulk pass, type detection, source summarisation | gpt-5.6-luna ($0.20/$1.20, both key spellings priced; no cached rate — reads bill at full input, immaterial here) | indices remove the verbatim constraint |
| Judge / Suggest | claude-sonnet-5 ($2/$10 permanent; cache $0.20 read / $2.50 write) | JUDGE_MODEL judge.ts:38; not a cost lever (models.ts:29-34) |
| Ghost / Finish / Generate | claude-sonnet-5 | client-visible prose |

### Spend controls

- Every route: allow-check **before** the model, `logAiUsage` with the model used, after.
- Three service rows: `optimizer` (explicit presses), `optimizer-live` (tier-1 + bulk + detection + summarisation), `optimizer-ghost`. **Corrected statement (Δ V1.2):** these caps are one shared pool per row platform-wide; `ai_usage` attribution is per caller. The per-actor bound is the counter table: **≤60 live and ≤60 ghost per session per hour, and ≤90 of each per user per hour across sessions** — the per-user cap closes the free-session-creation evasion. Worst-case per user is thereby bounded (~$1.2/hr ghost cold, ~$0.1/hr live) independent of the shared pool.
- **Δ V1.4:** the automatic rows invert the failure posture — a new strict config lookup distinguishes "row says allowed" / "row absent" / "lookup failed"; live and ghost treat the latter two as paused (the pill state), while manual routes keep the existing fail-open. During an intelligence-DB outage the only surfaces still spending are ones a human is clicking.
- **Δ V1.5:** finish takes the assess-style conditional claim (`type_status='generating'`, stale window reused, assess/route.ts:184-194 shape) — same order of money at risk as assess, which is the design's own criterion for a DB claim — and its price label is honest.
- Degradation: cap or outage → hints pause with writer-language copy ("Live suggestions are taking a break — back within the hour" — never "budget", **Δ V2.3**); ghost simply stops rendering, silently. Tier-0 immune. Manual Assess survives until its own row 503s. Failures memoised (`flag_failed`, the coverage/route.ts:142-146, 275-288 pattern); no auto-retry.

### Sharing

As designed, verified against the precedents: `optimizer_shares` mirrors design_shares (20260517 sql:204-213); one parametric checker preserving `requireOptimizer`'s workspace-first ordering (_lib/access.ts:40-43) and the workspace-mismatch 404 before shares (:87-89); `OptimizerPermission` gains `"view"` (:72; the comment at :69-71 anticipates exactly this); `loadOwnedSession` alias (:103) deleted. The one-change rule: `requireWritable(loaded)` gates assess, coverage, suggest, generate, finish, audit, draft PATCH, targetQueries/type_content PATCH, live, ghost, sources POST/DELETE — introduced in Stage 1 while `view` is impossible, so every later route is born gated. View's surface is exactly the free read path (stored assessment replay; "Read-only access" 403 precedent messages/route.ts:604). Share CRUD parameterised from conversations (owner-only, member + `hasOptimizerAccess` recipient check, cap 20, upsert, optional Resend deep link); private→team flip purges shares (conversations/[id]/route.ts:300-308); sessions list gains the shared-ids union + `myPermission` beside the server-decided `isOwner` (sessions/route.ts:35-50; sharedByMap pattern conversations/route.ts:38-43).

---

## 4. THE ECONOMICS TABLE

Sonnet 5 $2/$10 (cache $0.20 read, $2.50 write); luna $0.20/$1.20. Per **active writing hour**:

| Mode | Mechanics | Cost/hour |
|---|---|---|
| Typing (tier-0 only) | in-browser | $0 |
| Hints, interactive | ~20 block-completions/hr × ~$0.0004 | ~$0.008 |
| Bulk paste/first-open pass | one luna call, ≤40k chars | ~$0.003/pass |
| Ghost, forward writing (warm) | ~25 renders/hr × ~$0.0018 (read prefix 0.1× + write current block + 64 out) | ~$0.045 |
| Ghost at the 60/hr cap, worst case (repeated upstream edits forcing cold re-writes) | 60 × ~$0.009 | **~$0.55 bounded** (Δ V1.7 — stated, not hidden; the end-of-doc trigger makes it rare) |
| Assess (explicit) | memoised; ~$0.04/press | writer-controlled |
| Finish section / document | ~$0.02–0.04 / up to ~$0.10 | writer-controlled, claimed |

Monthly at 630 writer-hours, mixed writing/revising, partial ghost adoption: tier-1 ~$5, ghost ≤$30, ~300 assesses ~$12, finishes ~$5, bulk ~$1 → **~$50–75/month**, versus ~$750 for the rejected always-re-assess design (whose real failure was 25–45s latency anyway). The bill stays dominated by explicit clicks. **(Δ V1.7 + V3.3: the previous $65 figure assumed append-only writing and token-level cache matching; re-based on block-granular writes and a revision mix.)**

---

## 5. STAGES — each shippable alone; every check proven to fail first, mutation logs record survivors, all scripts indexed-loops/`Array.from`

**Stage 1 — the typed writing studio (no new automatic spend).** Start-screen flip; Set up step; `type_content` column + registry + heuristic detection + confirm chip; **per-type chrome gating (Δ V2.2)**; per-type engine/judge gating with 400-before-spend; memo-key extension; type-aware 413 copy (Δ V3.6); finish-section/document with the `generating` claim and honest pricing (Δ V1.5); health pill (dot-only lg+, Δ V2.8); header collapse order specified; `requireWritable` introduced as a no-op.
*Verify:* `verify-optimizer-types.ts` — pillar weights sum 10000; criteria keys exist in the shared universe; each judgeSystem byte-stable and >1024 tokens; type reaches **both** memo keys; detection fixtures from real samples; **chrome helper is imported and called by the page and its per-type outputs are asserted (USED, not written)**; finish claim goes red when the conditional update is made unconditional.

**Stage 2 — grounding and ghost.** `optimizer_sources` (+sheet, attach flows via `extractRawText` for sources — the inversion file-import.ts:4-6 documents — prompt entry, sources-hash into both keys, summarisation memo); digit-gate corpus extension + in-sentence source naming (Δ V2.5); ghost route: opt-in UX (Δ V2.3), end-of-doc trigger (adjudicated), multi-block cache serialization (Δ V3.3), plugin-meta wiring + Esc/Tab precedence (Δ V3.4, V2.6); **`optimizer_auto_calls` + seq replay rejection + per-session/per-user ghost caps (Δ V1.1/V3.1, V1.2)**; `optimizer-ghost` service row seeded (Δ V1.3); strict fail-closed config lookup (Δ V1.4).
*Verify:* `verify-optimizer-sources.ts` (source path uses `extractRawText` not `convertToHtml`; a source-only figure passes the gate, a novel one fails; deterministic serialization; sourcesHash reaches both keys) and the ghost half of `verify-optimizer-live.ts` — **a stubbed 61st call 429s; a replayed seq is rejected before the model; the migration seeds the row with `hard_block` and non-null caps, and when intelligence creds are present the script queries `service_config` through the same client — reporting INFO, never silent pass, when it cannot look**.

**Stage 3 — live semantics and sharing.** `live` route (interactive + bulk, Δ V1.6/V2.1) + dirty tracking + `optimizer_live_memo` + failure memoisation + `optimizer-live` row + caps; hint layer: three-way panel split (Δ V2.4), tier field in anchoring with red-first fixtures (Δ V3.5), dismissal persistence + reopen bulk pass (Δ V2.9); paste/import auto-pass; `optimizer_shares` + parametric checker + share CRUD + sidebar union + read-only studio **including the read-only popover (Δ V2.10)**.
*Verify:* `verify-optimizer-live.ts` (index→offset fixtures; failure memo fires; **prompt never requests quotes and contains no session-derived bytes (Δ V3.2)**; bulk mode's distinct gate and memo key; rate caps fire for live as for ghost) and `verify-optimizer-shares.ts` (list union includes shared ids; **every mutating and paid route rejects a stubbed view caller**; private→team purges shares; view path renders no action affordances where the check can drive the component).

---

## 6. OPEN DECISIONS FOR THE OWNER

1. **Reports over 40k chars** (common for the type the detector defines): hard 413 with type-aware copy (recommended for v1 — zero new machinery), or judge-the-first-40k with an explicit "assessed the first ~6,000 words" note (honest, but adds truncation memo semantics). Changes the assess route and memo key.
2. **Ghost consent default:** opt-in per writer (recommended, Δ V2.3) versus on-by-default with the first-use dismissible notice. Changes adoption and the ghost line of §4 by up to ~$30/month.
3. **End-of-document-only ghost:** the adjudicated v1 scope kills the revision-cost blowup structurally, but narrows the brief's "continue/finish" to continuation-at-the-end plus explicit Finish section. If mid-document ghost is wanted in v1, the revision suppression heuristic and the ~$0.55/hr bounded worst case come with it.

---

## 7. WHAT IT DOES NOT DO

- **No score from the cheap tiers.** Hints never enter `optimizer_assessments`; the Sonnet judge remains the only number on screen — and for CV, no number renders at all (Δ V2.2).
- **No cheap-model prose.** Luna emits indices and labels; every client-read sentence is Sonnet.
- **No per-keystroke model calls, no background rewriting, no auto-accepted text, no auto-retry.**
- **No per-user spend ledger.** Caps are shared pools per service row plus per-user *rate* bounds (Δ V1.2) — a true per-user dollar cap is out of scope and said so.
- **No real-time co-editing.** Draft PATCH is last-write-wins on the current version row (draft/route.ts:1-9); simultaneous editors can tear saves. Stated, not solved.
- **No public or cross-workspace sharing; no link tokens.** Workspace mismatch 404s before shares are consulted.
- **No new rubric universe; no citation-verification pillar.** Types filter and re-weight existing criteria.
- **No silent type switches.** Detection proposes; a person confirms (imports confirm via the header chip, Δ V2.7).
- **No grammar/plagiarism/SEO ambitions.** Tier 0 stays the GEO-mechanical engine.
- **Coverage and page audit do not extend to reports or CVs**; the audit route stays model-free but view-blocked.
- **No cross-document entity drift in the live tier** (Δ V3.2) — intra-block only; the judge owns the rest.
