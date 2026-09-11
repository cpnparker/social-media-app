# Content Optimizer — answer-optimised content studio for EngineAI

**Status:** Spec v1 (2026-08-21). Research inputs: AuthorityOn platform + legacy codebases, llm-search-aggregator, TCE product docs (April 2026 deck, product definition, platform audit), 20+ competitor tools, and the 2024–2026 GEO evidence base.
**Owner:** Chris. **Surface:** `app/engineai/optimizer` inside the EngineAI shell.

---

## 1. What this is and why it wins

A three-phase studio inside EngineAI that helps writers produce content optimised for AI/LLM search (GEO/AEO):

1. **Brief & Draft** — write answer-optimised content from a structured brief, grounded in client context.
2. **Assess & Refine** — score the draft against an evidence-graded best-practice rubric, highlight issues inline in the editor, suggest edits, let the writer accept/reject/edit.
3. **Finalise & Score** — final content with an Optimization Score, exact before/after attribution, and export.

**Strategic fit.** The AuthorityOn platform audit names the moat explicitly: intelligence platform + TCE's editorial capabilities is "a combination Semrush cannot replicate." AuthorityOn *finds* the gap (audits, recommendations, "Est. lift +N AI Score"); this tool *closes* it. It is the execution layer of the six-engine recommendation queue and the production tool behind Authority Programme retainers (rung 03 of the services ladder).

**Market position.** The Aug-2026 GEO market splits into tracking dashboards (Profound, Peec, Otterly), SEO editors with a bolted-on AI score (Surfer, Semrush AIO, Frase, Clearscope), and volume auto-publishers (Relixir). Documented gaps across all of them:

- Recommendations are generic, not anchored to specific sentences (the #1 review complaint about Semrush AIO).
- Nobody scores at chunk/passage retrieval level or simulates query fan-out.
- Scores ignore run-to-run LLM variance and are black-box; no vendor validates an AI-search score against actual citation outcomes.

We ship the two rare patterns (sentence-anchored editorial comments + fan-out/chunk coverage) on top of the standard ones (dual score side panel, checklist, one-click apply, pre-publish gate), with a **published, evidence-graded rubric** — the trust move competitors can't make because their scores are black-box.

---

## 2. Evidence base for the rubric

Every check carries an **evidence grade** so the rubric can be re-weighted cheaply as research expires. Grades: **A** causal (controlled experiment), **B** large-N observational, **C** mechanistic (retrieval mechanics imply it), **D** vendor claim / house doctrine.

What the 2024–2026 research supports (key sources: Princeton GEO paper arXiv 2311.09735; the July 2026 critical survey of 45 studies arXiv 2607.14035; "What Gets Cited" 252k-trial factorial arXiv 2605.25517; SAGEO Arena; GEO-16 arXiv 2509.10762; Evertune ~400M-citation analysis; Ahrefs ~17M-citation + schema null test):

| Signal | Evidence | Grade |
|---|---|---|
| Topical relevance & context position dominate all rewrite tactics | 45-study survey, factorial exp. | A |
| Quotations with named attribution (+41% PAWC), statistics with sources (+31%), cited sources (+27%) | GEO paper, replicated in direction | A− |
| Recent dates / freshness (~2× citation rate when updated <3mo; causally positive) | Causal + observational agreement | A |
| Answer-first structure (44.2% of citations extracted from first 30% of page) | 400M-citation observational | B |
| Ranked-list / listicle format for comparative intent (63% of citations) | Observational; intent confound | B |
| Self-contained chunks, question headings, extractable definitions | Retrieval mechanics + AIO query data | B/C |
| Entity clarity (canonical naming, no pronoun-opening chunks) | Mechanistic; no effect size | C |
| Named author + credentials; primary-source citations | Directional; vendor multipliers unreliable | C |
| First-hand data improves AI visibility 30–40% | TCE deck doctrine | D |

**Anti-checklist (penalties and non-rewards):** keyword stuffing (−8%, grade A); word count (Spearman 0.04 — never reward length); formatting-only edits without substance; authoritative tone without evidence (penalise hedge-free claims with no source); **llms.txt is effectively unhonoured as of Aug 2026** (408 targeted fetches in 500M AI-bot visits; no vendor commitment) — we do not score it, and we say why; JSON-LD schema showed **no causal citation lift** in Ahrefs' controlled test — hygiene suggestion only, never a scored promise.

**The single most defensible 2026 insight** (SAGEO): optimizing prose for citation can *reduce* retrieval (−9% top-20 presence) — extraction-friendly rewrites can strip the keywords/headings retrieval needs. Therefore the score has **two headline components** that are shown separately and warn when an edit trades one against the other.

**Platform lenses** (well-evidenced differences): ChatGPT is Wikipedia/definitional-heavy and often answers without searching; Perplexity is Reddit/UGC-heavy and cites lower-polish pages (freshness > polish); AI Overviews retain ~54% overlap with organic top-10 (classic on-page still matters). Only ~11% of domains are cited by both ChatGPT and Perplexity — so the writer picks target platform(s) and the rubric re-weights.

---

## 3. The three phases (user workflow)

State machine per session: `brief → drafting → draft_ready → assessing → refining ⟲ → finalised`. A session always belongs to a client (or "TCE / no client") and stores every draft version, assessment, and score for exact before/after attribution.

### Phase 1 — Brief & Draft

Input is a **structured brief**, not freeform prose:

- **Target AI queries** (1–5): "the phrase a real buyer asks an AI when they don't yet know the brand" (AuthorityOn keyword doctrine). The writer types their own and/or clicks **Suggest queries** — a mini prompt-research step that generates candidate discovery queries from topic + client context (this is the audit report's named "biggest competitive gap vs Semrush," seeded here). Each query gets a fan-out expansion (the sub-questions an answer engine would ask) that later drives coverage scoring.
- **Format** (explainer / ranked list / FAQ / data brief / op-ed / case study) with an intent-match hint — ranked lists are recommended when the target query implies "best/top/vs" intent (63% of citations), prose formats for informational intent.
- **Audience & goal** (what should AI learn and repeat about the brand).
- **Brand context** — auto-assembled per client into a **client canon** (see below). Editable chips, not a wall of text.
- **Voice** — client voice preset (the aggregator's editorial-voice pattern: cached system block per client); TCE house rules baked in (answer-first, banned AI-tell vocabulary, no em-dash tells, cite outlet by name in first 100 words where relevant).
- **Length band** — default 800–1,500 words (cited pages cluster at 1,000–2,000; length itself is never scored).

**Per-client tailoring (the client canon).** The studio is client-scoped end to end, reusing the machinery EngineAI already has — the session's client comes from the same dropdown as chat (`CustomerProvider` / `useCustomer`, fed by `/api/me/customers` and scoped by `getAllowedClientIds`), and `optimizer_sessions.id_client` ties everything to it. A new `lib/optimizer/client-canon.ts` assembles the client's grounding from four existing sources:

1. **Engine** — the client record plus the same `ClientContext` payload `buildSystemPrompt` already constructs (industry, description, contracts, content pipeline, social platforms).
2. **Client assets** — `intelligence.ai_client_context`, the consolidated structured profile already extracted from client files (`lib/ai/client-context-extract.ts`).
3. **Meetings** — MeetingBrain's workspace-shared client meetings (the `client_meetings` / `meeting_details` reports): recent themes, stated priorities, quotes from client stakeholders. Only workspace-shared client meetings — the same privacy rule the chat enforces; personal reports never feed a canon.
4. **AuthorityOn** — where the client is on the platform: canonical brand names and disambiguation keywords, category/keywords, competitors, sector.

The canon is a per-client fact sheet (each fact tagged with its source and date), cached in `optimizer_client_canon`, rendered as editable chips in the brief, and **snapshotted onto the session at generation time** so later assessments are reproducible against what the writer actually saw. It drives all three phases: Phase 1 grounds the draft (on-voice, facts only from canon, `[NEEDS SOURCE]` when the model wants a fact the canon lacks); Phase 2's entity-consistency pillar checks the draft against it (canonical naming, correct people/programmes/figures); Phase 3 exports into that client's content pipeline. Suggested target queries are seeded from client industry + AuthorityOn keywords + **recent meeting themes** — "what the client's stakeholders actually asked about" is a query source no competitor tool has. Each client also accumulates a **query library** (target queries persist per client, reusable across pieces) and a **voice preset** (cached system block per client, aggregator pattern).

Generation streams the draft into the editor, **baking best practice in at write time** (Goodie's "draft for retrieval" pattern): answer-first opening that could be quoted alone, self-contained H2 chunks, stats-with-source placeholders flagged honestly as `[NEEDS SOURCE]` rather than fabricated, an extractable definition of the main entity, TL;DR/key-takeaways block, dateline. A writer can also **skip Phase 1** and paste/import existing content (incl. fetch-from-URL for optimising published pages) straight into Phase 2.

### Phase 2 — Assess & Refine (the centerpiece)

Two scoring layers with different costs and cadences:

- **Deterministic engine — instant, free, every keystroke** (debounced). Ported from AuthorityOn's `computeContentScores()`: pure function, per-criterion `{key, earned, maxPoints, passed}`. Powers the live score dial and checklist. Reproducible by construction — the same text always scores the same.
- **LLM judge — on Assess** (auto after generation, then user-triggered / pre-finalise). Claude with temperature 0, strict JSON: per-category scores + **span-anchored findings** `{category, severity, evidenceGrade, quote (verbatim ≤180 chars), explanation, suggestedEdit, estLift}`. Anti-drift rule inherited from AuthorityOn: LLM category scores ≥ deterministic baseline unless a specific issue is cited. Findings pass a cheap Haiku quality gate (AuthorityOn's validator pattern: reject generic advice, wrong-fit-for-brand advice, duplicates) before reaching the writer.

The editor (Tiptap) renders findings as inline highlights color-coded by severity; clicking one opens a card: explanation, evidence grade, suggested rewrite, **Apply / Edit / Dismiss**. The side panel shows:

- **Score dial** — overall 0–100 + letter grade, with **Retrievability** and **Citability** sub-scores side by side, and a variance band (never a false-precision single point after an LLM pass).
- **Category bars** — the six pillars (§4), click to filter issues.
- **Issue list** — prioritized by `estLift × severity`, house vocabulary: "Est. lift +N", effort tier. Grouped: Fix now / Improve / Polish.
- **Query coverage map** — per target query and its fan-out sub-queries: which chunk answers it, which sub-queries are uncovered (the category-first feature: chunk-level coverage no commercial editor ships).
- **Trade-off warnings** — "this rewrite improves Citability but removes the keyword-bearing heading retrieval needs."

Writers edit freely; deterministic score updates live; a **Re-assess** re-runs the judge (findings for unchanged spans are re-anchored, not regenerated — cost control). Every accepted/dismissed suggestion is logged with its fingerprint (learning loop, §8).

### Phase 3 — Finalise & Score

- **Score card**: final Optimization Score + grade, Retrievability/Citability, category breakdown, and a **waterfall of exactly what changed** — the fixed-weight linear rubric means a +12 decomposes into named causes that "sum exactly" (the AuthorityOn honesty-by-design pattern the business already sells).
- **Pre-publish gate**: a final checklist pass (all high-severity issues resolved or explicitly waived; `[NEEDS SOURCE]` markers gone; dateline present; schema/meta hygiene suggestions with copy-paste JSON-LD that matches visible text).
- **Export**: copy Markdown/HTML, Google Doc, Word (existing `lib/documents/word.ts`), or push into the content pipeline (`app_content`); score card embeddable in client reporting.
- **Honesty block** (small, permanent): "This score predicts citation-readiness among retrieved content. No tool can promise AI traffic." — the methodology-page stance that pre-empts overselling and matches the platform's "what we don't claim to know" section.
- **Post-publish loop (v2, designed now)**: fingerprint the published piece (stats, phrases, URL — AuthorityOn `detect-mentions.ts` NAME/URL/STAT/PHRASE matching) and verify pickup in AuthorityOn scans; "we validated the score against observed citations" would be a category-first claim.

---

## 4. Scoring model

**Optimization Score (0–100) = Σ (pillar score × weight)**, fixed linear weights so deltas decompose exactly. Two roll-ups shown alongside: **Retrievability** (query alignment: title/H1–query match, keyword-bearing headings, topical completeness vs fan-out set, intent-format match) and **Citability** (extraction: answer-first position, chunk self-containment, evidence density, freshness, definitive language). Pillars (draft-stage; weights are `RUBRIC_VERSION`-tagged constants, initial values below):

| # | Pillar | Weight | Sample checks (det = deterministic, LLM = judge) |
|---|---|---|---|
| 1 | Relevance & query coverage | 0.22 | LLM: draft vs each target query + fan-out sub-query (covered/partial/missing per chunk); det: title/H1 alignment. Highest weight — grade A evidence that relevance dominates. |
| 2 | Evidence & quotability | 0.20 | det: statistic density, source-adjacency regex ("according to", linked citation in same sentence), naked-stat penalty; LLM: quote attribution quality, primary-source ratio, unique-data check. |
| 3 | Answer-first structure & extractability | 0.18 | det: answer-bearing content in first 10%, TL;DR/key-takeaways present, question-heading ratio, heading→answer adjacency; LLM: "could this opening be quoted alone as the answer?", per-chunk self-containment. |
| 4 | Entity clarity & consistency | 0.14 | det: pronoun-opening chunks, canonical-name drift; LLM: "reading only this chunk, who is it about?", main entity defined once ("X is a [category] that…"), draft facts vs client canon (entity-consistency is a sold audit component). |
| 5 | Authority & experience signals | 0.13 | det: byline + credential line present, first-person experience markers; LLM: are experience claims substantiated; hedge-free claim with no source → penalty (never score "authoritative tone"). |
| 6 | Freshness & format hygiene | 0.13 | det: dateline present + recent, stale-year references, current-year stats, sentence length ~18w norm, list/table presence for comparative intent, heading hierarchy (AuthorityOn `heading-hierarchy.ts` drop-in), keyword-stuffing ceiling, AI-tell vocabulary. |

**Penalties** apply within pillars, never as a mystery deduction: each shows as a failed criterion with its evidence grade.

**Porting note — the AuthorityOn rubric does not transplant unmodified.** A full criterion audit (38 criteria) found 65% of its weighted points are draft-reachable; the rest assume a crawled site. Required adaptations, verified against `content-scoring-engine.ts`:

- **Drop the 13 page-only criteria** (URL-pattern checks for FAQ/glossary/case-study/team/blog pages, subpage counts, about-page depth) — 200 of 575 points. Replace the two narrative URL checks with in-text detection (does *this draft* contain a named customer story / worked example).
- **Recalibrate every site-scale tier to article scale.** As-is, full marks need 25 question marks, 20 brand mentions, 10 date references, 25,000 words — tuned for concatenated whole-site text. New tiers sized for an 800–2,500-word draft (e.g. questions 2/4/6, dates 1/2/4).
- **Renormalise per category** (`earned / categoryMax × 100`, not `min(100, sum)`) — the original category maxima are inconsistent (85–125 pts), so a perfect Clarity draft could only reach 85/100, and Freshness is over-subscribed.
- **Fix the inherited FAQ double-count** (same URL test scored twice for 25 pts) — don't port it.
- "Unique Value" is the only 100%-draft-reachable AuthorityOn category and gets a corresponding weight increase here (folded into Evidence & quotability + Entity clarity); "Topical Depth" mostly evaporates at draft stage — its job is done by the fan-out coverage map instead, which is a better measure of depth than word count anyway.

**Blending:** live score = deterministic-only (marked "live"). After an Assess: `final = 0.4 × deterministic + 0.6 × LLM` per category (AuthorityOn's proven blend), judge at temperature 0, displayed with a ±band; the deterministic floor and anti-drift rule bound variance. Re-assessing unchanged text must not visibly move the score — if it does in testing, drop the LLM share until it doesn't.

**Platform lenses:** target-platform multipliers (AIO / ChatGPT / Perplexity / balanced) adjust pillar weights ±0.04 max (e.g. Perplexity ↑freshness ↓polish; ChatGPT ↑entity/definitional). Lens choice lives in the brief.

**Grades:** A+ ≥90 … F <30 (AuthorityOn thresholds, same letters clients already see).

---

## 5. Architecture (EngineAI integration)

**Surface.** Dedicated sub-surface `app/engineai/optimizer/page.tsx` inside the EngineAI shell (the Design Mode / Live copilot pattern). Chat stays an entry point: an `optimize_content` tool creates a session from a chat brief and drops a session card into the conversation (slides-draft card pattern) linking into the studio. The existing `app/(app)/content/[id]` proto pipeline (brief → generate → fact-check on grok-4-1-fast, no highlighting) is superseded, not extended — but its fact-check/detect-ai JSON shapes (quoted span + reason + score) are the precedent the finding schema follows.

**New module `lib/optimizer/`:**

- `rubric.ts` — pillars, weights, criteria, evidence grades, `RUBRIC_VERSION`. Ported from `authorityon-platform/packages/core/src/audit/content-scoring-rubric.ts` with a provenance header; draft-inapplicable criteria (URL page patterns, subpage counts, sitemap/robots/schema-on-page) dropped and weights rebalanced.
- `engine.ts` — deterministic scorer (port of `computeContentScores()` + `heading-hierarchy.ts`; pure functions, no LLM). Runs client-side for live scoring; same code server-side for persisted scores (one implementation, imported both places).
- `judge.ts` — LLM assessment. Calls the existing Anthropic client via `lib/ai/providers.ts` machinery with `source: 'optimizer'`, temperature 0, strict JSON with retry-on-parse-fail → fallback to deterministic-only (AuthorityOn's fallback pattern).
- `suggest-gate.ts` — Haiku classifier gating findings (APPROVED / REJECTED / DUPLICATE_OF), AuthorityOn validator rules.
- `anchors.ts` — span anchoring (mechanism verified against the installed Tiptap v3.20): build a plain-text-offset ↔ ProseMirror-position index by walking text nodes (never naive `textBetween` arithmetic), then exact `indexOf(quote)` → prefix/suffix disambiguation on multiple hits → normalized retry (curly quotes, NBSP, dashes) → orphan. **Never guess** — a wrong anchor silently corrupts the apply action. Contract: judge returns verbatim quotes ≤200 chars + ≤32-char prefix/suffix (W3C TextQuoteSelector pattern, same contract Tiptap's own paid AI Suggestion extension uses), quotes may not cross a paragraph boundary.
- `briefs.ts` — brief schema, query suggestion, fan-out expansion.
- `client-canon.ts` — assembles the per-client canon from Engine + `ai_client_context` + MeetingBrain client meetings + AuthorityOn brand data (§3, Phase 1); cached, source-tagged, snapshotted per session.
- `fanout.ts` — sub-query generation + per-chunk coverage (embeddings or LLM-judged; start LLM-judged, cheaper to build, revisit if cost bites).

**Model routing & cost.** Draft generation: `claude-sonnet-5` (quality writing + tool-free). Judge: `claude-sonnet-5` temp 0 (~2–4 calls per session). Suggest-gate + query suggestion: `claude-haiku-4-5`. Everything logs to `intelligence.ai_usage` under `source: 'optimizer'`, kill-switchable and spend-capped via `assertServiceAllowed('engine','optimizer')` from day one. Note the Sonnet 5 price cliff (intro $2/$10 → $3/$15 on 2026-08-31) is already in `model-costs.ts`; a full session ≈ 1 generation + 2 assessments + gates ≈ $0.15–0.40 — fine against retainer economics.

**Access.** New `users_access.flag_access_optimizer`, checked server-side in every route (fail closed), same pattern as `flag_access_finance`. Client scoping through the existing `getAllowedClientIds`.

**Chat tool wiring** (if/when `optimize_content` ships): paired Anthropic + OpenAI tool defs, dispatched in all four provider chains, explicitly classified in `POST_TAINT_READ_TOOLS`/blocked list — `scripts/verify-post-taint-policy.ts` goes red otherwise. The 5-file model-registry trap doesn't apply (no new model ids), but the tool-wiring one does.

**Verification scripts** (house rule: prove a check fails before trusting it):

- `scripts/verify-optimizer-rubric.ts` — feeds fixture drafts with known defects (answer buried at 60%, naked stats, pronoun-opening chunks, stale dates, stuffed keywords) and asserts each criterion actually fires; also asserts weights sum to 1.0 and every criterion has an evidence grade. Reintroduce-the-bug discipline on every new check.
- `scripts/verify-optimizer-anchors.ts` — asserts exact-match, fuzzy-match, and orphan paths against fixture edits (edit-above, edit-inside, delete-span), and that an orphaned finding is *reported* as orphaned (a check that data was written, not used, is the documented failure mode).
- Score-stability harness: same text, 5 judge runs → per-category variance must stay within the displayed band, else lower the LLM blend share.

### Data model (Supabase `intelligence` schema, raw-SQL migration)

```
optimizer_sessions   id, id_user, id_client, title, status (brief|drafting|refining|finalised),
                     brief jsonb, target_platform, rubric_version, created/updated
optimizer_drafts     id, id_session, version, document (html), word_count, created
                     -- every generation and every finalise snapshots a version
optimizer_assessments id, id_session, id_draft, kind (deterministic|full),
                     scores jsonb (per-pillar {det, llm, blended, criteria[]}),
                     retrievability, citability, overall, created
optimizer_findings   id, id_assessment, category, severity, evidence_grade,
                     quote, prefix, suffix, explanation, suggested_edit, est_lift,
                     status (open|applied|edited|dismissed|orphaned), fingerprint
optimizer_feedback   fingerprint, helpful/not/applied counts, avg_lift_when_applied
                     -- the learning-loop signal table (AuthorityOn RecommendationSignal pattern)
optimizer_client_canon id_client, facts jsonb (each: text, source engine|assets|meetings|authorityon|manual,
                     as_of), voice_preset, query_library jsonb, updated
                     -- per-client grounding; sessions snapshot it at generation time
rubric_signals       -- v2: Pulse-signal-driven rubric change proposals (§7)
```

Findings persist with `quote + prefix + suffix` (not offsets) so anchors are recomputed against the current draft on load — offsets rot, quotes re-anchor.

### Editor mechanics (decided; verified against installed deps)

The repo already has Tiptap **v3.20.0** (`@tiptap/react`, `starter-kit`, `pm` — ProseMirror `Plugin`/`Decoration`/`DecorationSet` importable via `@tiptap/pm` today, no new dependency). `components/content/TiptapEditor.tsx` is the only consumer; the highlight layer is greenfield.

- **Highlights are ProseMirror decorations, not marks.** Four forcing reasons: (1) the editor persists `getHTML()` on a 2s debounce — marks would serialize `<span class="ai-issue">` into every saved draft and thrash the content-prop round-trip; (2) marks pollute undo history (undo after dismiss would resurrect a highlight); (3) issues are server-state — decorations are exactly a projection of external state onto the doc; (4) Tiptap's own paid AI Suggestion extension chose decorations for this identical use case (it's also private-registry, subscription-priced, and deprecated mid-migration — we build our own ~150-line plugin instead).
- **Survival through edits**: the plugin's `apply(tr, prev)` maps each issue range through `tr.mapping.mapResult()`; a deleted/collapsed range flips the issue to `orphaned` instead of guessing.
- **Apply is transactional**: read the current (post-mapping) range from plugin state, revalidate the text under the highlight still equals the anchored quote (user may have edited inside the span → orphan, never replace wrong text), then `insertText(replacement)` + decoration resolution in **one transaction** so undo restores both coherently. Accept-all maps subsequent ranges through the same transaction's mapping and skips overlaps.
- **Orphans stay visible** in the side panel (struck-through quote, "couldn't locate — text has changed", dismiss or re-assess; no Apply button). On reload or undo, an orphan whose quote matches again silently re-anchors.
- Highlight CSS joins the `.ai-*` family in `globals.css` (category tint + severity intensity), inside `.engine-ai-scope`.

---

## 6. UX spec (designs in the companion canvas)

**Layout grammar** follows EngineAI: Geist, HSL tokens (auto dark mode), `.ai-`-prefixed CSS inside `.engine-ai-scope`, elevated cards, one accent. The studio is a full-width three-region layout (not the 46rem chat column — this is a workbench, like Design Mode).

- **Header**: session title, client chip, three-step progress (Brief → Refine → Finalise), rubric version tag (click → methodology).
- **Phase 1**: single centered column (brief form); "Suggest queries" and "Suggest format" inline AI assists; Generate streams into Phase 2's editor live.
- **Phase 2**: left = editor (≈62%), right = assessment panel (≈38%, collapsible; NotebookPanel docking pattern). Highlights: category-tinted underline + severity intensity; hover = mini card; click = full card anchored to span with Apply/Edit/Dismiss. Panel tabs: **Issues** / **Coverage** / **Checklist**. Score dial animates only on assessed score changes; live deterministic ticker is subtle (avoid slot-machine anxiety while typing).
- **Phase 3**: centered report: score card, waterfall (before → named causes → after, bars sum exactly), checklist with evidence grades, export row, honesty line. "Back to editor" keeps the loop open.
- **Score display rules**: letter grade is the headline (writer-friendly, Clearscope-style); number secondary; band shown after LLM passes; never show a moving decimal.

**Interaction details worth getting right** (from competitor UX synthesis): the issue card shows *the rewrite itself*, not advice-about-advice; Apply is one click and undoable; dismissals ask nothing but are logged; "Fix all safe formatting issues" bulk action for det-only mechanical fixes (dateline, TL;DR insertion point, heading case) with a diff preview; fan-out coverage rows deep-link to the chunk that should answer them; an uncovered sub-query offers "Draft this section."

---

## 7. Keeping it current (the AuthorityOn feed — future upgrade, designed now)

The llm-search-aggregator already runs weekdays (03:17 UTC) and emits, per article, a structured `signals` array — `{subject, signalType: model-change|citation-pattern|ranking-factor|tooling, change, direction (what it rewards/penalises), affectedAreas, evidenceTier: CONFIRMED|LIKELY|RUMOURED, effectiveDate}` — which authorityon-platform dedupes, corroborates (LIKELY→CONFIRMED at 2 independent sources), and stores in `PulseSignal` with the hard rule that **only CONFIRMED signals may change customer recommendations**.

The upgrade consumes that, not article prose:

1. Platform exposes `GET /api/pulse/signals?affectedAreas=content,ai-visibility&tier=CONFIRMED&since=…` (thin read endpoint over PulseSignal).
2. EngineAI weekly cron pulls new signals → maps each to a **proposed rubric change** (weight nudge, new check, retired check, platform-lens adjustment) in `rubric_signals`.
3. **Admin approves** → new `RUBRIC_VERSION` with changelog; nothing self-mutates silently. Old assessments keep their version; re-assess offers "score against current rubric."
4. UI surfaces currency as a feature: "Rubric v1.4 · updated 18 Aug 2026 from 3 confirmed signals" — a living rubric is a marketing asset no static competitor checklist has.

Because both apps share the Supabase estate, v1 of the endpoint can be a direct read with a service key; the public-API version is the platform audit's roadmap item anyway.

---

## 8. Learning loop (v1.5)

Port AuthorityOn's closed loop to suggestions: fingerprint every finding → collect Apply/Dismiss + post-apply score delta → maintain `optimizer_feedback` running averages → inject top patterns into the judge prompt as "SUGGESTION INTELLIGENCE (aggregate, cross-client)": highest-lift finding types, low-acceptance patterns to avoid. The optimizer's advice measurably improves with use, independent of the Pulse feed. (Schema exists in AuthorityOn `RecommendationFeedback`/`RecommendationSignal` — copy the design.)

---

## 9. Build plan

| Milestone | Scope | Est. |
|---|---|---|
| **M1 — Score engine** | `lib/optimizer/` rubric + deterministic engine + fixtures + `verify-optimizer-rubric.ts`. No UI; scriptable. | 3–4 d |
| **M2 — Studio core** | Session/draft/assessment tables + routes; Phase 1 brief form; generation streaming into Tiptap; live det score panel. | 5–7 d |
| **M3 — Assess loop** | Judge + gate + anchoring + inline highlights + issue cards + apply/dismiss; `verify-optimizer-anchors.ts`; stability harness. | 5–7 d |
| **M4 — Finalise** | Score card, waterfall attribution, pre-publish gate, exports, methodology page. | 3–4 d |
| **M5 — Entry points** | `optimize_content` chat tool (post-taint classified), content-pipeline handoff, URL import. | 2–3 d |
| **v1.5** | Learning loop; per-platform lenses if not in M1. | 3–4 d |
| **v2** | Pulse-signal rubric updater; post-publish citation verification via AuthorityOn scans. | separate |

Every milestone ends deployed behind `flag_access_optimizer` (deploy = `vercel deploy --prod`).

## 8a. How the optimiser meets the rest of EngineAI

Decided 2026-08-21 from a design pass over the shipped studio, the Design Mode precedent, and a survey of eight comparable products. Designs: the *EngineAI Articles Integration* canvas.

**Import is the PRIMARY entry point, not the escape hatch.** Most optimisation work is on content that already exists — a draft, a published page, a commissioned piece — and writing from a brief is the rarer case. The start screen leads with "bring content in" and demotes "write something new" below it. Three sources, all backed by plumbing that already exists:

- **Paste.** Always available, no setup.
- **A Google Doc**, via `queryDriveDocs` (`lib/gdrive/docs.ts`), which lists and reads Docs exported to `text/plain`. **Access is a service account**, so a doc must be shared with `GOOGLE_SA_EMAIL` as Viewer before it appears — surface that address in the picker, because "my doc isn't listed" is otherwise a dead end.
- **From the Engine content pipeline.** Content units already carry `documentReference` with `documentType: "google_doc"`, so a commissioned piece can arrive with its client attached — which means the canon is known without asking.

**For imported content the brief is for SCORING, not generation.** Target queries and the platform lens still matter; audience, goal, voice and length are generation-only inputs and must not be asked for a piece that already exists.

**The Relevance gap, and the rule it forces.** Imported content arrives with no target query, so pillar 1 — the heaviest at 0.22 — skips. The score is then over five pillars, and printing a confident number over that gap would be the "a view that drops data must say so" rule broken at the product's most visible surface. So: the headline says *measured on 5 of 6 pillars*, the Relevance row reads *not scored — no target query* rather than showing a zero, and the fix is offered **where the gap is visible** (an inline query field in the panel, seeded from the client canon), never by sending the writer back to a form.

**Articles are a PEER of conversations, not a kind of conversation.** Design Mode already settled this shape: the artifact gets its own table with its own `type_visibility` and its own share table mirroring `ai_shares`, and the chat transcript that produced it is hidden from the list (commit `bddedd4` — the exclusion was about NOISE, not privacy). Articles follow it, with one difference: an article is worth finding, so it gets a sidebar row.

- **Prerequisite:** the Private/Team tabs filter on strict equality, so a row with no visibility value is invisible in *both*. `optimizer_sessions` needs `type_visibility text NOT NULL DEFAULT 'private'` before any of this can render.
- **A titled Articles section above Conversations, never interleaved.** Interleaving by recency fails three ways independently: the 5-slot-per-client budget gets spent on chats; article titles are authored and stable while chat titles are auto-generated and churn; and articles are exactly the items whose value grows with age, so recency buries them.
- **Type is a leading icon, not a badge.** A badge sits in the slot the timestamp owns and is read after the title — too late for someone scanning.
- **Search keeps the two lists apart.** An article matched deep in its body and a chat matched on its title cannot be honestly ranked against each other; merging forces an arbitrary answer. Separate lists never ask, the per-type counts answer "does it exist" directly, and the structure stays identical whether browsing or searching. Two rules for article results: body text is a **first-class** match (not the fallback it is for a chat — a writer searches for the sentence they wrote), and a body match must **show the matched phrase** or the result looks like a mistake. Match, then filter by visibility — never the reverse.

## 9a. Known deferrals

These are decided-not-to-do-yet, not oversights. Recorded so they are found here rather than in production.

- **Spend fairness is not solved, only spend TOTAL.** `assertServiceAllowed` caps on `(app, source) = engine/optimizer`, which is global. One user looping assessments can exhaust the daily cap and 503 the optimizer for everyone else until it resets, and the users denied did nothing wrong. That is a blast-radius problem, not a spend problem, and the right guard is per-user or per-workspace spend — the same mechanism, a narrower key — not a per-session frequency limit (which punishes the writer who edits and re-assesses, exactly the behaviour the product is for, and is sidestepped by opening a second session anyway). Deferred deliberately: it is a tenancy design decision, and the feature is dark.
- **Client data on provider fallback.** The generation path inherits the Anthropic→Grok fallback, so on an Anthropic failure a client's canon would reach xAI. That is a processor decision against the audience model in [[engineai-security-posture]], not a code detail. Needs an explicit answer before the flag is switched on for client-facing work.
- **The judge's own stability is unmeasured.** `scripts/verify-optimizer-stability.ts` is designed (fixtures, thresholds, mutation protocol) but not built. Until it exists, the claim that the score holds still rests on the memo and on quantized verdicts — both structural, neither measured.

## 10. Open product decisions

1. **Name.** Working title "Content Optimizer"; candidates: Answer Studio, Authority Writer. House vocab says the score should be called an **Optimization Score** and never "AI Score" (that's AuthorityOn's brand-level metric — same family, different object; the UI should say "feeds your AI Score").
2. **Who gets it.** TCE staff only at launch, or client seats too? (Affects whether the methodology page ships in M4 or later.)
3. **Judge model tier.** Sonnet 5 recommended; Opus 5 would raise finding quality at ~2.5× the per-assess cost — A/B once the stability harness exists.
4. **Fan-out coverage v1**: LLM-judged (recommended, simpler) vs embedding-based chunk retrieval simulation (the fuller "Retrieval Twin" idea — v2 candidate).
