# EngineAI Recurring Prompts — plan (approved 2026-07-16)

Scheduled prompts à la Perplexity Tasks / ChatGPT scheduled tasks, grounded in
workspace data. Research: 4-agent sweep (Perplexity Gen1/Gen2, ChatGPT Jun-2026
relaunch, Gemini scheduled actions, Copilot scheduled prompts) + infra audit.

## The wedge
Every incumbent leaves the same gaps: (1) no private-business grounding in
scheduled runs (ChatGPT: no files/GPTs; Gemini: Google apps read-only;
Perplexity: web only) — EngineAI runs the full tool belt (query_engine reports,
MeetingBrain, memories, web) with citations; (2) zero reliability transparency
(Gemini silently skips runs for paying users — the #1 trust killer); (3) no way
to iterate a task from its results.

## Design rules (from the leaders' failures)
- Deterministic time math in infra (cron + IANA tz, Europe/Zurich default) —
  NEVER let the model compute schedules (ChatGPT's timezone bugs).
- Two named task species: **Digest** (always delivers) vs **Monitor** (runs
  quietly, notifies only on change/threshold; snapshot + diff + re-arm).
- Compute at send time, never precompute (Gemini staleness); stamp "data as of".
- Never fail silently: per-run history, retry once, partial delivery on source
  failure, owner email + loud auto-pause after 2 consecutive failures.
- Promote-a-proven-prompt is the primary creation path; NL scheduling second;
  hub + templates third. Confirmation card shows next 2 run times before save.
- Anti-abandonment: track opens; ~5 ignored runs → "still useful?" → pause.
- Caps: 10 active/user, hourly floor (daily recommended). Cost attribution via
  ai_usage type_source='scheduled-prompt' → Control Centre kill/caps for free.

## Architecture (reuses the RFP scheduling skeleton)
- Tables: `ai_scheduled_prompts` (prompt, context config, schedule, delivery,
  linked conversation, snapshot, failure/ignored counters) + `ai_scheduled_runs`
  (status delivered|no_change|partial|failed|skipped, tokens, cost, error).
- One Vercel cron (*/15) → claims ALL due rows (batched — the RFP one-per-tick
  worker drifts) → headless runner: buildSystemPrompt + routeQuery +
  createStreamingResponse drained server-side (proven headless by fact-check
  route + client-disconnect semantics) → assistant message appended to the
  task's persistent conversation (results are a real thread; follow-ups work)
  → Resend email (Morning Brew craft: one screen, delta-first, deep link).
- Schedule advance ALWAYS, even on failure (RFP pattern — no retry storms).

## Phases
1. **Core loop (this build)**: tables, schedule lib, runner, cron, CRUD +
   run-now APIs, minimal hub dialog (list/create/pause/run-now/delete), email.
2. **Creation UX**: "Make recurring" on any answer, NL `create_scheduled_task`
   tool + confirmation card, templates incl. "Monday Morning Operations Brief",
   run-history UI.
3. **Monitors + iteration**: snapshot diff/threshold/re-arm, reply-to-refine
   standing prompt (old→new diff), ignored-run telemetry + courteous pause.
- v2: Slack delivery (via MeetingBrain, which holds tokens), per-task model
  override, shared/team tasks.

Full research: session workflow wf_9f1f569e (4 agents, cited).
