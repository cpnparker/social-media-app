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
| 1 | 24 Aug | wrong_facts | "Is Gabi working today?" answered from booked leave as if it were an attendance record. The HR pipeline parses half-day markers and throws them away, so a morning-working colleague renders identically to a whole day off. | **Open** |
| 2 | 24 Aug | missed_data | Voice, asked what was left on Rob's handover list. The list had been pasted into that thread 151 messages earlier and the voice assistant could not read its own conversation. | **Fixed** 24 Aug (8694f43, completed by 80cc529) |
| 3 | 27 Aug | wrong_facts | Asked to finish a half-written email, it reported the draft as already SENT. The mail bridge strips every Gmail label except UNREAD, so a draft and a sent message are indistinguishable to the model. | **Open** |
| 4 | 27 Aug | ignored_request | User corrected a wrong claim; the redrafted note still opened with the exact sentence being corrected. It patched around the error instead of reissuing a clean draft. | **Open** |
| 5 | 31 Aug | ignored_request | A 35-slide conversion produced no deck; asked "is everything okay?", it described its own internal state and asked permission to do the job it already had. | **Partly** — the no-deck half is closed; asking instead of acting is not |
| 6 | 3 Sep | wrong_datetime | Asked to summarise a call with Thomas, it never looked the meeting up, answered from a stale cached snapshot and offered to fetch the real data instead of fetching it. | **Open** |

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

1. **Act, do not offer** (#5, #6). The only non-prompt mechanism today speaks
   after a deck renders, so a job that never started produces no signal. The
   server knows at end of turn whether a conversion was asked for and whether
   the tool ever ran; that is checkable rather than hoped for.
2. **Half-days and gap-bridging in the HR feed** (#1). Keep the half-day marker
   instead of discarding it, and stop bridging gaps that are not weekends. Add
   the two fixtures that would have caught both.
3. **Gmail labels** (#3). Carry the labels through the bridge so a draft is
   distinguishable from a sent message. This is a MeetingBrain change.
4. **Re-issue, do not patch around** (#4). When a correction lands, the redraft
   must not contain the corrected sentence.
5. **Route on "conversation/call/spoke with"** (#6). The fast-path guard uses a
   narrower keyword list than the detectors it pre-empts, so meeting questions
   phrased as "the conversation I had with X" never reach the meeting route.
   Weigh the cost: it widens what gets a live lookup.

### Not planned, deliberately

No guard against a model contradicting itself inside one answer (#1 opens "not
on the away list" and closes "not working today"). That is one sentence in one
reply, not a class, and a check for it would assert something unmeasurable.
