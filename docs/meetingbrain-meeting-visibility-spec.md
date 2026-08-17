# Per-meeting visibility in MeetingBrain

**Status:** proposed, not built. Needs a MeetingBrain schema change plus RPC changes; EngineAI consumption is a small diff on top.
**Written:** 17 August 2026, against the live `meetingbrain` schema.
**Origin:** an EngineAI session in which a director asked for an all-company message and the assistant grounded it in her own 1:1 records — a colleague's morale complaint about redundancies, two named departures and a promotion. Access was correct throughout. What was missing was any notion of what a meeting is *about*.

---

## The one-line version

MeetingBrain has exactly one axis for a meeting — **whose it is**. This adds a second — **who may see it** — set per calendar event, defaulting to private.

---

## Measured facts

Everything below is measured against the **whole** `meetingbrain` corpus on 17 August 2026 — 8,404 rows of `processed_meeting`, 36 columns — by `scripts/measure-meeting-visibility.ts`, which is re-runnable. These are the numbers that should decide the design, and three of them are counter-intuitive enough that guessing would have produced the wrong build.

(An earlier draft of this document used a 2,000-row sample and got two of them materially wrong: it put sibling-recorder events at 8.6% when the true figure is 20%, and 1:1s at 47% of internal meetings when the true figure is 60%. Sampling understated exactly the two populations the design turns on.)

| Fact | Value | Why it matters |
|---|---|---|
| Existing privacy column | **none** | `transcript_shared_by` is provenance, not privacy. There is nothing to extend. |
| Meetings with an **empty/null** `attendees` field | **3,044 / 8,404 (36%)** | Attendee count **cannot** be the classifier. Over a third of the corpus has no attendee data at all — and it is empty, not "names without emails" (0 rows have names without emails). |
| Calendar events with **more than one recorder** | **1,183 / 5,878 (20%)** | A per-**row** flag is unsafe for one meeting in five. See "Key the flag on the event". |
| Internal-only meetings | **2,101** | The population this is for. |
| …of those, 1–2 attendees | **1,268 (60%)** | The 1:1 band — the sensitive core — is the *majority* of internal meetings, not an edge case. |
| `get_client_meetings` returns today | **140** | The real shared set. See the backfill trap. |
| A domain-matching backfill would mark `team` | **2,835 (20×)** | The obvious backfill is catastrophically wrong. |

---

## Two design decisions that follow from the data

### 1. Key the flag on the calendar event, not on the row

`processed_meeting` holds **one row per recorder**, so a single real meeting attended by three colleagues can be three rows. **20% of events — one in five — are already like this.**

`get_meeting_details` returns **the richest sibling row** across everyone who recorded the event. So with a per-row flag:

> Chris marks his row for the restructure meeting private. Rob's row for the same meeting is untouched. `get_meeting_details` picks whichever row has the fullest transcript — Rob's — and serves it. The flag was set, the UI showed it set, and it did nothing.

That is a silent failure of exactly the kind this codebase keeps producing: the control exists, it reads back correctly, and only the outcome is wrong. **The flag must live on `calendar_event_id`**, and every sibling row must resolve through it.

Rows with no `calendar_event_id`: **0 out of 8,404**, so this is a safe key.

### 2. Default private — and it is nearly free

The instinct is that default-private is safe but disruptive. Here it is safe *and* cheap, because of how the current sharing gate works.

`get_client_meetings` shares a meeting workspace-wide only when an attendee sits at a **registered client domain**. So today:

| Meeting kind | Reachable by colleagues today? | After default-private | Net change |
|---|---|---|---|
| Returned by `get_client_meetings` (**140**) | **Yes** — workspace-shared | Classified `team` at backfill | none |
| Empty attendees (36%) | **No** — cannot match a client domain, so owner-only already | `private` | **none in practice** |
| Internal-only with attendees | Owner-only via personal reports, but reachable by a third party through the domain-gated path | `private` | **tightened — this is the point** |
| Client-domain meetings outside the live function's window (~2,700) | **No** — the function does not return them | `private` | none |

So the 36% that cannot be auto-classified are *already* effectively private. Defaulting them to private changes nothing operationally while closing the third-party path for internal meetings. That third path is the confirmed-medium finding from the incident audit: an internal conversation becomes workspace-readable the moment one attendee is at a registered client domain — an ex-colleague now client-side, a consultant whose firm is in `app_clients`.

The last row is the one that catches people out, and it is why the backfill below must be seeded from the function's output rather than from a re-derivation of its logic.

**A default of `team` would be actively harmful**: it would take the 36% with no attendee data — currently owner-only — and publish them workspace-wide. That is the opposite of the intent, and it is what a naive "public by default, mark the sensitive ones" build would ship.

---

## Schema

```sql
-- Visibility is per CALENDAR EVENT, not per processed_meeting row: one meeting
-- can be recorded by several people, and get_meeting_details serves the richest
-- sibling. A per-row flag would be set on one row and silently bypassed via
-- another. 20% of events in the live data have more than one recorder.
CREATE TABLE IF NOT EXISTS meetingbrain.meeting_visibility (
  calendar_event_id   text PRIMARY KEY,
  visibility          text NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private', 'team')),
  -- How it got this value. 'inferred' may be re-evaluated by a later pass;
  -- 'user_set' must NEVER be overwritten by automation — someone marked this
  -- deliberately and a classifier changing it back is the worst outcome here.
  source              text NOT NULL DEFAULT 'inferred'
                        CHECK (source IN ('inferred', 'user_set', 'backfill')),
  set_by              integer,          -- meetingbrain.users(id) when user_set
  date_created        timestamptz NOT NULL DEFAULT now(),
  date_updated        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_visibility_team
  ON meetingbrain.meeting_visibility (calendar_event_id)
  WHERE visibility = 'team';

COMMENT ON TABLE meetingbrain.meeting_visibility IS
  'Who may see a meeting, as opposed to whose meeting it is. Keyed on calendar_event_id because processed_meeting holds one row per recorder and the details RPC serves the richest sibling — a per-row flag would be silently bypassed. Absent row means private.';
```

**Absence means private.** No row = not shared. This is what makes the rollout safe: the table can ship empty and nothing is exposed by a half-finished migration.

### Backfill — do NOT derive it from attendee domains

The obvious backfill is "mark every meeting with a registered client attendee as `team`, since those are shared already". **That is wrong by a factor of twenty, and it was measured, not guessed:**

| | Events |
|---|---|
| `get_client_meetings` actually returns today | **140** |
| A domain-matching backfill would mark `team` | **2,835** |
| Over-promotion factor | **20×** |

It would have published roughly **2,700 meetings that are currently private**, and it would have done so silently: the SQL runs, reports success, and the damage is only visible to whoever later notices their 1:1s in a colleague's search results. This is the failure this whole document exists to prevent, reproduced in the fix for it.

**Why they diverge.** The deployed `get_client_meetings` is narrower than its parameters suggest. Measured against the live function:

- It returns meetings dated **2026-01-27 → 2026-08-12** when asked for everything since **2000-01-01**. `p_since` is ignored or clamped to roughly a six-month window.
- It returns the same 140 rows for `p_limit` 500 and 100,000, so `p_limit` is not honoured either.
- Every returned row has both a `summary` and populated `external_attendees`, so unprocessed meetings are excluded. Only 1,270 of the 2,835 domain-matching events have a summary at all.

Its true selection rule is not knowable from this repository — the function body is deployed, not checked in. **So the backfill must be seeded from what the function returns, not from a re-implementation of what it appears to do:**

```sql
-- Seed ONLY from the set that is demonstrably shared today. Re-implementing
-- the domain match promotes 2,835 events instead of 140.
-- get_client_meetings returns meeting_id, so map back to the calendar event.
INSERT INTO meetingbrain.meeting_visibility (calendar_event_id, visibility, source)
SELECT DISTINCT pm.calendar_event_id, 'team', 'backfill'
FROM meetingbrain.get_client_meetings(
       '<internal_domain>', ARRAY[<client_domains>], '2000-01-01'::timestamptz, 100000
     ) g
JOIN meetingbrain.processed_meeting pm ON pm.id = g.meeting_id
WHERE pm.calendar_event_id IS NOT NULL
ON CONFLICT (calendar_event_id) DO NOTHING;
```

Verify before letting any RPC read the table:

```sql
SELECT count(*) AS team_rows FROM meetingbrain.meeting_visibility WHERE visibility = 'team';
```

**Expect ~140.** Anything in the thousands means the domain-matching version was run by mistake — delete every `source = 'backfill'` row and start again. Nothing reads this table until step 3, so that rollback is clean.

One consequence to accept deliberately: because the live function has a ~6-month window, client meetings older than that are **not** shared today and will therefore backfill as private. That matches current behaviour exactly. If older client meetings should be shared, that is a change to `get_client_meetings`, not to this table.

---

## Separate bug found while measuring this

`get_client_meetings` **ignores `p_since` and `p_limit`**. EngineAI passes both (`lib/ai/providers.ts`, the `client_meetings` report) and presents the result as the complete answer for the window the user asked about. So "what client meetings did we have last year" returns the last six months and reads as exhaustive.

This is the same shape as the tool-result truncation already fixed elsewhere in EngineAI: a capped query reported as a complete one. It is independent of visibility work and should be fixed on its own — either honour the parameters in the function, or have it return the window it actually applied so EngineAI can say so.

### And the empty-allowlist fallback is real

`lib/ai/providers.ts` warns never to pass a null or empty `p_client_domains`, because the function then treats *any* non-internal external attendee as a client. That warning was demonstrated accidentally while writing this document: a bug in the measurement script produced an empty domain list, and `get_client_meetings` returned **209** meetings instead of **140** — a 49% widening, with no error and no indication that the allowlist had been ignored.

So the fallback is not theoretical, and the caller-side guard in EngineAI is the only thing preventing it. It would be better placed in the function: an empty allowlist should return nothing, not everything.

---

## RPC changes

Three deployed functions read meetings. All are in the `meetingbrain` schema and deploy **manually via the Supabase SQL Editor**, so each change needs its own verification pass — there is no migration history to rely on.

| Function | Change |
|---|---|
| `get_client_meetings` | Add `AND v.visibility = 'team'` (LEFT JOIN, `IS NOT DISTINCT FROM 'team'` so an absent row excludes). Narrowing only. |
| `get_meeting_details` | Return `visibility` in the row. Keep serving the owner their own meeting regardless — this is about third parties, not about locking someone out of their own record. |
| `search_meetings` | Return `visibility` per row so EngineAI can label results. Do **not** filter here: the caller's own private meetings must still be findable by the caller. |

The invariant across all three: **visibility restricts what a THIRD PARTY sees. It never restricts an attendee or owner from their own record.** Getting this backwards would make the product feel broken and would push people back to searching their inbox.

---

## Who sets it

Auto-classification cannot carry this. 36% of meetings have no attendee data, and the incident that prompted the work involved a meeting that a keyword classifier would plausibly have missed — "organizational structures, role efficiency, and strategic realignment" contains no obvious personnel marker.

So: **explicit, with a nudge.**

1. **Default private.** Nothing is shared until someone shares it.
2. **A toggle on the meeting in MeetingBrain** — "Visible to the team" — writing `source = 'user_set'`, which automation must never overwrite.
3. **Auto-promote only what is already shared**: a registered client attendee sets `team` at ingest, `source = 'inferred'`. This reproduces today's behaviour exactly and no more.
4. **Never auto-demote a `user_set` row.** If someone shared it deliberately, a classifier disagreeing later is not grounds to un-share it silently.

EngineAI's existing personnel screen (`isPersonnelSensitive`, `lib/ai/providers.ts`) stays as it is regardless. It is a *handling* signal, not an access one, and it covers the case this flag cannot: a meeting correctly marked `team` that is still not material for an all-company email.

---

## EngineAI consumption

Small, and only possible once the RPCs return the field — EngineAI reaches meetings exclusively through RPCs, so it cannot read a column the function does not return.

1. `queryMeetingBrain` `meeting_details` / `search_meetings`: pass `visibility` through to the model on each row.
2. When a returned meeting is `private` **and the caller is not an attendee**, return the summary with a notice rather than the transcript.
3. Label private meetings in search results so the model does not describe them as team knowledge.

Roughly 20 lines in `lib/ai/providers.ts`, plus one line in the tool description. No prompt change: the "Who will read what you are writing" rule already added covers what happens to the content afterwards.

---

## What this does **not** fix

Worth stating plainly, because the temptation is to treat this as closing the incident.

**It would not have prevented what happened to Gabi.** Those were her own meetings, read in her own private thread, which she was entitled to see. No visibility flag blocks that, and none should. The fix for that was the output-audience rule and the personnel-handling note, both shipped in `c309709`. This spec closes the *adjacent* hole — a third party reaching an internal meeting through the client-domain path — and gives the product a vocabulary it currently lacks.

**A flag set at ingest is a guess about the future.** A meeting marked `team` in March may become sensitive in August when someone in it leaves. Nothing here re-evaluates.

**`transcript_shared_by` is unexamined.** It suggests transcripts already move between people by some other route. That should be understood before this ships, or the new flag will be one of two mechanisms that disagree.

---

## Order of work

1. Create the table. Ships empty; nothing changes. **Reversible.**
2. Run the backfill and compare counts against `get_client_meetings`. **Reversible.**
3. Change `get_client_meetings` to join it. First behavioural change — verify the count is identical to before.
4. Add the toggle in MeetingBrain.
5. Return `visibility` from `get_meeting_details` and `search_meetings`.
6. EngineAI consumption.

Steps 1–2 are safe to do now and prove the data model against real rows before anything reads it.
