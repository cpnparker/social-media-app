# Thumbs-down review

What users flagged, what it turned out to be, and what is planned. One row per
flagged answer. **Add to this file rather than re-reviewing from scratch** —
the point is that a later review starts where this one ended.

Source of truth: `intelligence.ai_message_feedback` (append-only, survives the
conversation being deleted). Read it with the service key; the table snapshots
the question, the answer, the reason, the model and the tools that ran.

## Reading the table

It is APPEND-ONLY and a single flag writes more than one row: the thumb-down is
one row, the reason picked afterwards is another. The first review read 13 rows
as 13 incidents; they are **6**. Dedupe on `id_message` before counting
anything.

## Review 1 — 2026-09-11, covering 2026-08-24 to 2026-09-03

6 flagged answers, 13 rows. 1 thumbs-up in the same period.

| # | Date | Reason given | What it actually was | Status |
|---|---|---|---|---|
| 1 | 24 Aug | wrong_facts | "Is Gabi working today?" answered from booked leave as if it were an attendance record. The HR pipeline parses half-day markers and throws them away, so a morning-working colleague renders identically to a whole day off. | **Fixed** 11 Sep |
| 2 | 24 Aug | missed_data | Voice, asked what was left on Rob's handover list. The list had been pasted into that thread 151 messages earlier and the voice assistant could not read its own conversation. | **Fixed** 24 Aug (8694f43, completed by 80cc529) |
| 3 | 27 Aug | wrong_facts | Asked to finish a half-written email, it reported the draft as already SENT. The mail bridge strips every Gmail label except UNREAD, so a draft and a sent message are indistinguishable to the model. | **Open** |
| 4 | 27 Aug | ignored_request | User corrected a wrong claim; the redrafted note still opened with the exact sentence being corrected. It patched around the error instead of reissuing a clean draft. | **Open** |
| 5 | 31 Aug | ignored_request | A 35-slide conversion produced no deck; asked "is everything okay?", it described its own internal state and asked permission to do the job it already had. | **Fixed** 11 Sep |
| 6 | 3 Sep | wrong_datetime | Asked to summarise a call with Thomas, it never looked the meeting up, answered from a stale cached snapshot and offered to fetch the real data instead of fetching it. | **Partly** 11 Sep — offering rather than acting is closed; the routing that never reached a meeting lookup is not |

### Cross-cutting

Two of the six (#5, #6) are the same shape: **it offers to do the thing instead
of doing it.** Both had the capability and the instruction; neither acted. That
is the single most repeated complaint in this set.

Two more (#1, #3) are the same shape one level down: **a source is reported as
a stronger fact than it is.** Booked leave read as attendance; an unsent draft
read as sent. Neither is the model inventing — both are the pipeline handing it
something that cannot express the distinction the user's question turns on.

### A defect in the review channel itself, found while reviewing

`document_asked` stored the WRONG question on the voice flag: it used a strict
`<` on the timestamp, and a voice turn persists the user transcript and the
reply with the SAME timestamp, so the query skipped the actual question and
walked back to one from an hour earlier. Flag #2 looked like a non-sequitur for
that reason alone. Fixed 2026-09-11.

## Plan

Ordered by how often the class would recur, not by how loud the flag was.

1. ~~**Act, do not offer** (#5, #6).~~ **Done 11 Sep.** A deterministic
   end-of-turn notice when a conversion was asked for and generate_slides never
   ran, plus a general prompt rule for the cases that are not decks.
2. ~~**Half-days in the HR feed** (#1).~~ **Done 11 Sep.** The marker survives
   parsing, a part-day booking is never merged into a range, and the block says
   booked leave is not an attendance record. STILL OPEN from the same file: the
   three-day gap bridge applies to any gap, not only weekends, so two bookings
   either side of a midweek gap merge and assert days nobody booked. Separate
   latent defect, not what caused #1.
3. **Gmail labels** (#3). Carry the labels through the bridge so a draft is
   distinguishable from a sent message. This is a MeetingBrain change.
   **Still open, re-checked 16 Sep.** Untouched: `lib/gmail-query.ts:130` still
   keeps UNREAD and nothing else, and `git log` on that file ends at 87dbe23.
   Carried into review 2's plan as item 8, with the ordering constraint.
4. **Re-issue, do not patch around** (#4). When a correction lands, the redraft
   must not contain the corrected sentence.
   **Still open, re-checked 16 Sep.** No rule and no check anywhere in the repo.
   It now has a structural precedent to copy — `lib/slides/claim.ts` (e8e327d,
   15 Sep). Carried into review 2's plan as item 9.
5. **Route on "conversation/call/spoke with"** (#6). The fast-path guard uses a
   narrower keyword list than the detectors it pre-empts, so meeting questions
   phrased as "the conversation I had with X" never reach the meeting route.
   Weigh the cost: it widens what gets a live lookup.
   **Still open, re-checked 16 Sep — and worse than described here.** The
   pre-emption happens at Step 1, which returns `conversational` with ZERO
   hints, so the turn gets no mandated tools at all AND is told to answer from
   what it has. Reproduced live: `"Summarise the call with Thomas"` →
   `intent=conversational, hints=0`, although `call with` is literally in
   `MEETING_KEYWORDS`. Carried into review 2's plan as item 11, FROZEN.

### Not planned, deliberately

No guard against a model contradicting itself inside one answer (#1 opens "not
on the away list" and closes "not working today"). That is one sentence in one
reply, not a class, and a check for it would assert something unmeasurable.

## Review 2 — 2026-09-16, covering 2026-09-03 to 2026-09-16

5 distinct flagged messages, 18 rows all time (10 distinct all time). Of the 5
since review 1: one thumbs-down is #6 above, already logged. One is new. The
other three are thumbs-**up**, all cast within a minute of the new flag, and
they turn out to be the most useful thing in this review — see below.

| # | Date | Reason given | What it actually was | Status |
|---|---|---|---|---|
| 7 | 16 Sep | none given | "Tell me about NatureFinance and help me prepare for starting the contract", four minutes before the meeting it was preparing him for. Three paragraphs of the model narrating its own plan streamed to the screen first, one per tool round, each wiping the tool-activity chips; the answer landed at 1,161 words with the only time-critical fact in paragraph four. It then reported two meetings it never reached — one "(no recording)" — as unavailable sources, when both sit on Chris's own MeetingBrain record with transcripts. **Open** |

The briefing underneath was right. Contract 255, 12 CU, 0 used, 17 Sep–30 Dec,
the 8+4 option, the four client contacts, the open Ed task, the 10:00 internal
"Nature Finance chat", and the "nothing commissioned, no ideas" negative all
check out against the database. This is not a hallucinating answer. It is a
badly served one, and it withheld the best source it had.

### What the three thumbs-up say, which is the point of them

They were cast at 08:02:17, 08:02:23 and 08:02:44 UTC — 30 to 57 seconds after
the thumbs-down, on answers from a week earlier. That is a deliberate
good-versus-bad pass, not three unrelated ratings, and it is the closest thing
to a stated reason this flag has.

All three are claude-sonnet-5 with `data_tools` NULL — **zero tool calls**.
They are 4,348 / 2,468 / 1,984 characters against 6,972. Each opens with at
most one short past-tense line and then goes straight to the deliverable:

> "Good, that pins down every variable. Let me rebuild the estimate at 1.5
> minutes with your specifics." — then a costed table.
>
> "Here's a scoping brief you can send straight to the video team:" — then the
> brief.

What he is rating is **time to the deliverable**. Not brevity for its own sake:
earlier unrated answers in the same conversation do carry mid-answer narration
("Let me search for this internally…") and were not flagged either way. One
short line is tolerated. Three paragraphs on top of a 1,161-word answer is not.
Read against #5 and #7 together, the rule is: say what you did in the past
tense, briefly, or say nothing — never what you are about to do.

### Cross-cutting

**The reply foregrounds its own internal state instead of the work.** Third
appearance (#5, #6, #7) and the single most repeated complaint in this log —
but the first with a PRODUCT-side mechanism rather than a prompt one. Every
round's streamed text is appended to one `fullText` and persisted as the
message body, so a turn that runs four rounds writes three false starts into
the transcript permanently. `providers.ts:11184` even has a comment about
keeping "the next round's narration" from jamming into the previous round's
text: the code already knows this happens and makes room for it. Measured over
the last 200 assistant messages: 55 (27.5%) open with a first-person plan
paragraph, 53% of tool-running turns against 6% of tool-free ones. This turn
was flagged; the other 54 were not, which is what makes it a class.

**A gap in the data reported as a fact about the world.** Fourth appearance
(#1, #3, the latent HR gap bridge, now #7), and this instance is the sharpest
yet because the mechanism is a false *negative* about a source:

> "I could not open the 21 August Chris/Gary scoping call, the 1 September
> client meeting (no recording), or the truncated tail of the proposal."

Neither meeting claim is true. The 1 September kick-off is on Chris's own
record with a **28,563-character transcript** and a 725-character summary
carrying the Option 3 scope, the CU-allocation-by-impact agreement, the AI MSD
report launch and the NY Climate Week roundtables — none of which reached the
answer. The 21 August Chris/Gary call has a 5,167-character transcript and a
summary covering the 11→10 CU adjustment against the $9,000 budget and the
one-off discount framing. Both were refused by `query_meetingbrain`'s per-tool
budget of 6, in one batch in the last tool round. The model reported its own
exhausted allowance as a property of the source, and invented "(no recording)"
to explain it.

The repo has already written the correct wording for this, three functions
away: `postTaintRefusal` says "tell the user this specific step was blocked —
do NOT say the source is unavailable or that you have no access to it."
`overBudgetNotice` says only "Say plainly which parts you could not fetch and
why", and the model supplied its own why.

**The budgets were tuned on a call shape that is no longer the default.** Of
turns that ran tools in the window, grok-4.6 hit a refusal in 12 of 22 (55%),
claude-sonnet-5 in 1 of 64 (1.6%). Grok fans out eight calls per round; Claude
issues one or two. `auto-router.ts:38` makes grok-4-6 the default. Four of the
eight available rounds were unused in this turn — the round cap was never the
constraint, the per-tool cap was.

### Confidence, and the reading I did not take

**Confident on shape, and it is no longer only shape.** The evidence for shape
is behavioural: no reason and no note (none of wrong_facts / missed_data /
ignored_request / wrong_datetime describes "badly shaped", and he did pick a
reason when a fact was wrong, on #6); three contrasting thumbs-up 30 seconds
later; a deck built on the same briefing three minutes after that; and no
correction turn anywhere in the conversation. He flagged it at 10:01:47 Zurich
— one minute into the meeting it was written for.

But the "(no recording)" line is a false statement about a source, made in
writing, to a user who personally sat in that meeting. Whether or not it is why
he clicked, it is the thing in this answer that should stop him trusting the
next one, and it is not a presentation defect.

**The strongest alternative reading** is that he objected to something in the
NatureFinance content itself. The candidate is the Airtable thread: the answer
says "Airtable has no September plan row", "Resourcing cannot see this contract
yet", and then actions him to "Get the Airtable September row in" — while his
own MeetingBrain task "Add ESMO and Nature Finance contracts to Airtable" is
DONE, closed 2026-09-11T08:30:59. Either the answer caught a real gap (the most
valuable line in it) or it told him to redo work he finished five days earlier
(the most annoying). There is no Airtable key on this machine, so this is
unverifiable here; see the open question below. If the negative is false, #7
promotes from shape to wrong_facts and item 2 of the plan gains urgency rather
than changing.

Two things the brief flagged as contradictions are **not** errors and are not
planned against. Both halves of the calendar pair are true — the 10:00 "Nature
Finance chat" is internal (Prachi, Catherine, Chris) and there genuinely is no
NatureFinance *client* meeting in the fortnight. It costs a re-read; it does not
contain a false statement. One small date slip is real but trivial:
"NatureFinance is live in Engine as of this morning" — client 94 and contract
255 were both created 15 Sep, yesterday afternoon.

### Plan

Ordered by how often the class would recur, not by how loud the flag was.

1. **Stop interim round narration reaching the user as answer text** (#7, #5).
   Two parts, in this order. (a) An anti-preamble rule in the UNGATED chat
   section of `lib/ai/system-prompts.ts` — today the only two such rules are
   both gated behind Design Mode at :621 and :660, while voice has a CRITICAL
   one at `lib/ai/voice.ts:396` with a check on it. Assert it against the
   ASSEMBLED prompt in `scripts/verify-incident-fixes.ts`, where the prompt is
   already built at :185. (b) The deterministic half: drop a round's text from
   the PERSISTED `document_message` when that round ended in `tool_calls`. The
   seam exists — `roundTextStart` at `providers.ts:10996` / `:9321`, already
   replayed for the deck-claim retry at :11170.
   *Cost:* (a) six lines and a check, half an hour. (b) ~10 lines × 4 chains
   plus a check, half a day.
   *Risk:* (a) low but partial — nothing tells the model to narrate and it does
   it anyway, so this reduces rather than eliminates; re-run the probe in a
   fortnight rather than assuming. (b) real, and do not ship it without (a)
   first: persisted text would differ from what was streamed, and a round can
   carry genuine answer text the model continues after a tool call, so strip
   only leading plan-shaped paragraphs. **Also fix `ChatPanel.tsx:1049-1057`
   with it** — the first token of any round calls `setRunningTools([])`, so
   today each narration paragraph wipes the honest activity card and the turn
   goes quiet again. Removing the narration without that leaves two silent
   minutes, which is the failure the activity map was written against.

2. **Make a refused call say whose limit was hit** (#7). Add to
   `overBudgetNotice` and `repeatedCallNotice` in `lib/ai/tool-loop-guard.ts`
   the clause `postTaintRefusal` already carries: do NOT report this as the
   source being unavailable, missing, unrecorded or non-existent — say the
   lookup budget for this turn was used up and name what was not reached.
   *Cost:* two string constants; the file is already the single source of
   refusal wording for all four chains.
   *Risk:* low, wording only. Pin it with an assertion that both notices carry
   the do-not-blame-the-source clause, so the chains cannot drift on it the way
   they once drifted on the numbers.

3. **A deterministic end-of-turn notice when a data tool was refused over
   budget** (#7). Name the tool, say the lookup was cut short, say the answer
   may be missing what it would have fetched. Beside the four notices already
   at `providers.ts:11879-11915` and `:10726-10780`, driven off
   `toolLoopGuard.usage()`, which route.ts already persists to `data_tools`.
   13 turns in the window would have carried it.
   *Cost:* ~15 lines plus four call sites and a check. A day, check first.
   *Risk:* low. Keep it to OVER-BUDGET refusals only — a duplicate-signature
   refusal is not a hole (`repeatedCallNotice` says the result is already
   above) and announcing it would cry wolf. This is the review-1 precedent
   applied a level down: say it yourself rather than hoping the model is honest
   about a gap it cannot see. It volunteered "(no recording)" instead.

4. **Raise `query_meetingbrain` 6 → 8 and put `web_search` in the table at 6**
   (`lib/ai/tool-loop-guard.ts:29` and :25). `query_meetingbrain` has the same
   two-call search→details contract the file itself cites when raising
   `query_gmail` to 8, six reports behind one name, and is both the most-used
   tool in the window (48 turns) and the most-capped (5 over). `web_search` is
   absent from the table entirely, so it runs on the default 3 and went over in
   4 of its 6 turns.
   *Cost:* two constants plus two lines in the EXPECTED list at
   `scripts/verify-tool-loop-guard.ts:37`. Under an hour.
   *Risk:* more tokens on a model that already fans out eight calls a round —
   this turn read 280,704 cached tokens for ~41 cents. Watch the ledger. This
   treats the symptom: see "not planned" on the per-round cap.

5. **Score the fuzzy client match instead of taking row order**
   (`lookupClientContext`, `providers.ts:2836`, `clients[0] // Best match` over
   an unordered `.limit(500)` scan). Rank containment hits above Levenshtein
   hits, and hand the model a shortlist when more than one client matches
   instead of asserting one and instructing it to "Use X from now on".
   `"Nature Finance"` → `"Centre for Future Generations"` is reproducible
   against the live table today: the record is `NatureFinance` so the `ilike`
   misses, and `levenshtein("nature","future")=2` is inside tolerance.
   *Cost:* ~15 lines, no schema change.
   *Risk:* low-medium. The fuzzy path exists for voice transcription
   ("Gelderma" → "Galderma"); fixture both directions before touching it. Note
   the failure mode is worse than no match — it confidently names a different
   REAL client, and that false hit is what paragraph two of this answer was
   about.

6. **Give `upcoming_meetings` the truncation notice the other reports have**
   (`providers.ts:6059`, `p_limit: 30`, logged as `Upcoming: 30 (14d window)`
   with no hint on that path; the helper exists at :3006). Chris has 55
   meetings in that window, so the list reached 23 Sep and the answer asserted
   a negative "across the next two weeks" over half a fortnight. The conclusion
   happened to be true.
   *Cost:* one return path. *Risk:* low. Same class as the logged
   tool-result-truncation incident; this path was missed when the report
   functions were fixed.

7. **Drive truncation: delete the offer that cannot be honoured.** Both notices
   (`lib/gdrive/docs.ts:131` and `formatDriveDocsResult`) end by telling the
   model to "offer to look at a specific section", but the tool takes only
   `action` and `name` — no offset, no section — and caches the TRUNCATED text
   for 10 minutes, so a second read returns the identical first 8,000
   characters and is refused as a duplicate signature anyway. The tail is
   unreachable by any sequence of calls. This answer's closing offer to "pull
   them next in one pass" is the model doing as it was told.
   *Cost:* short fix two lines, an hour — do it now. Proper fix (an offset
   parameter threaded through four chain call sites) ~40 lines, a day.
   *Risk:* the short fix is free. The proper fix's one trap is the cache key —
   keyed on file id today, so a paged read without a composite key silently
   serves page one again: the same bug wearing a new parameter.

8. **Gmail labels** (#3, review 1 plan item 3, unchanged since). Add
   `is_draft` / `is_sent` to `toSummary()` and the wire type in
   `/Users/chris/meetingbrain/lib/gmail-query.ts:130`, then one instruction
   line in `formatGmailResult` (`providers.ts:7035`) and one clause in the
   tool description. No shape change needed on the EngineAI side —
   `fenceUntrusted` serialises the whole object.
   *Cost:* ~4 lines there, 2 here, a check, two deploys.
   *Risk:* low in code, but it is cross-repo with an ordering constraint: ship
   MeetingBrain first and confirm a real search returns the field, or the model
   is told to read a field that is never present and will infer meaning from
   its absence.

9. **Re-issue, do not patch around** (#4, review 1 plan item 4, no work of any
   kind against it). Copy `lib/slides/claim.ts` (e8e327d) wholesale as a shape:
   a pure predicate module, two gates that must both be yes — the user's
   message corrects a claim in the previous assistant message, AND the new
   draft still contains that sentence — one retry round with an unseen note,
   and a deterministic line if it is still there. Anchor on normalised sentence
   containment against the previous assistant message, which is measurable.
   Hand-write the corpus as check 40's was; calibrating on stored `ai_messages`
   reads other users' chats.
   *Cost:* medium, mostly corpus. The distinctions that have to be drawn: a
   correction versus an addition, and a user who QUOTES the wrong sentence back
   to point at it — `stripQuotedContent` already exists for exactly that.
   *Risk:* medium. A retry round is a second model call on every firing turn.
   Gate on the previous message actually containing the sentence, never on the
   user's tone. Do not ship a prompt rule alone — e8e327d is on record that
   prompt rules were already there and were what failed.

10. **HR gap bridge** (latent, from #1; flagged as still-open in review 1 plan
    item 2). `lib/hr/absences.ts:242` bridges any gap up to three days with no
    day-of-week test, so bookings on Mon 7 and Thu 10 Sep merge into one range
    and the model is told the person was away on the Tuesday — inside a block
    that says this record overrides any holiday claim in an email. Reproduced.
    Replace with a test that bridges only when every day strictly between is a
    non-working day; the ICS feed already carries the company-wide holidays
    that `parseIcs` currently discards.
    *Cost:* one predicate plus fixtures in `scripts/verify-absences.ts`, which
    is 23/23 today with no case for it.
    *Risk:* low for the code, but check the feed first — if CharlieHR emits
    weekend days as VEVENTs, the correct change is to DELETE the bridge rather
    than narrow it, and `CHARLIE_HR_CALENDAR_URL` is Vercel-only. While in the
    file: line 235 carries a committed NUL byte in the group key, which makes
    the whole file read as binary, so plain `grep` finds nothing in it. That is
    this repo's own recorded failure mode and it is behaviour-neutral to fix.

11. **FROZEN — routing** (#6, review 1 plan item 5). Do not implement pending
    the owner's decision. The right change is NOT to widen `MEETING_KEYWORDS`
    but to make the Step 1 fast-path guards at `query-router.ts:297/300/305`
    require that no Step 3-5 detector fires, rather than merely that
    `DATA_KEYWORDS` misses — expressed as one shared predicate so guard and
    detectors cannot drift apart again. This cannot newly classify anything the
    router has no detector for; it only stops Step 1 hiding a match that
    already exists two steps down.
    *Cost:* small in code, real in money — these turns currently cost nothing
    and would gain a mandated lookup, and a `meeting_data` classification can
    additionally move an auto-routed turn to Claude. Sizing it needs a count of
    production turns landing conversational-with-zero-hints while containing a
    meeting keyword, which means reading stored messages: needs a go-ahead.
    *Risk:* asymmetric, both ways. Doing nothing leaves the turn with zero
    mandated tools AND an explicit instruction to answer from what it has —
    flag #6's failure written down as a rule. Doing it risks a WRONG meeting
    matched to a vague reference, which converts a hedged answer into a
    confidently mis-sourced one. The mitigation belongs in the hint, not the
    route: tell the model to name which meeting it used and to say so when the
    reference is ambiguous.
    Available today under the freeze with no behaviour change: add these
    phrasings to the existing "Known gap" NOTE list in
    `scripts/verify-personal-data-routing.ts:199`, which prints rather than
    fails, so the gap is visible in check output instead of being rediscovered
    in six months. Do that now. Also inside the frozen file and independent of
    all the above: the comment at `query-router.ts:81` claims the "Update me on
    IFFIm" fall-through is closed and it is not — that exact string still routes
    conversational with zero hints, because `DATA_KEYWORDS` has `update on` and
    the user writes "update ME on". A demonstrably wrong comment inside a frozen
    file is worth a one-word fix on its own.

12. **Instrumentation, for the next review rather than the user.** Split
    `ToolUsage.blocked` (`tool-loop-guard.ts:139`) into `blockedRepeat` and
    `blockedBudget` — this review had to reconstruct the two causes
    arithmetically against the budget table. Move the Anthropic chain's
    activity frame (`providers.ts:9447`) below its guard (:9618), or emit a
    distinct `tool_blocked` frame: today Claude shows "Reading meeting notes"
    for a call that never ran, while the other three chains show nothing, which
    is the exact per-chain drift `lib/ai/tool-activity.ts` was written to stop.
    Wire up `toolDoneEvent` (`tool-activity.ts:88`), exported, never called, and
    already handled at `ChatPanel.tsx:1022`.
    *Cost:* half a day, additive to `data_tools` so old rows still read.
    *Risk:* low. Nothing reads `blocked` today except a human doing this.

### Not planned, deliberately

**Still no guard against a model contradicting itself inside one answer.**
Review 1 declined this and #7 is the case for keeping the decision: the 10:00
internal meeting and the absent client meeting are both true, read from one
tool result, and the model does distinguish them. The reader pays a re-read.
There is no false statement to catch, and a check would assert something
unmeasurable.

**Do not widen `PERSONAL_SCHEDULE_INTENT` to catch "help me prepare for
starting the contract".** The router was right: the message names no meeting,
no organiser, and still asks nothing once quoted copy is removed. Widening is
the documented too-broad incident (thread 04c5d402), where a deck edit was
classified `meeting_data` from the words on its slides and the turn described
an edit it never made. The defect here is the answer overclaiming its source —
it said "your calendar" twice in a turn that had no calendar tool at all and
was reading MeetingBrain's meeting mirror. Fix the wording, not the route.
(FROZEN as a routing decision, recorded so it is not relitigated.)

**No length cap, and no rule modelled on the thumbs-up lengths.** Those three
answers are short because they had nothing to fetch — `data_tools` NULL, zero
tool calls. A briefing assembled from 24 tool calls is legitimately longer. The
lesson from them is ordering, not word count, and a length rule would cut the
six unresolved items and the agenda, which are the parts he then built a deck
from three minutes later.

**No per-round or per-turn tool budget on the strength of one flag.** A
per-tool cap fits a sequential caller and fits a parallel fan-out badly, and
grok-4-6 is now the default — that is a real question and item 4 only treats
the symptom. But the cap exists to stop a documented spiral, and one flag is
not enough evidence to redesign it. Raise the two numbers, ship the notice in
item 3 so the cost is visible when it bites, and revisit with a fortnight of
data.

**No code change chasing the Airtable contradiction.** It is one data question,
not a class. One `query_resourcing` call — `client_plan_vs_actual` for
September 2026 plus `contract_health`, filtered to NatureFinance — settles it,
and it needs a key this machine does not have.

**Do not add `-in:drafts` to the Gmail bridge query** as a shortcut for item 8.
It would hide the draft from "finish my half-written email", which is the
request that produced flag #3 in the first place.

### Open questions carried into review 3

- Is "Airtable has no September plan row" / "Resourcing cannot see this
  contract yet" actually true? Decides whether #7 is shape or wrong_facts.
- Why no reason was given. Second wordless flag in a row; the channel's value
  depends on that field being used. Worth asking Chris directly rather than
  inferring twice.
- `units_rounds` is NULL on all three `ai_usage` rows for this conversation
  although dc7b76a is the head commit locally — either not deployed or not
  being written. The round count is exactly the figure that would have made
  this turn's cost visible (4 rounds, 126,913 uncached input tokens, ~41c).
- Post-taint refusals increment neither `calls` nor `blocked` (the refusal
  `continue`s before `blockFor` on all three OpenAI-shaped chains), so a
  tainted turn under-reports what the model attempted. Not active in #7, but it
  will undercut the next reconstruction.
