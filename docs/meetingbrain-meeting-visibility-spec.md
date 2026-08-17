# Per-meeting visibility in MeetingBrain

**Status:** proposed, not built. Needs MeetingBrain schema + RPC changes; EngineAI consumption is a small diff on top.
**Written:** 17 August 2026, against the live `meetingbrain` corpus (8,405 rows / 5,879 calendar events).
**Origin:** an EngineAI session in which a director asked for an all-company message and the assistant grounded it in her own 1:1 records — a colleague's morale complaint about redundancies, two named departures and a promotion. Access was correct throughout; what was missing was any notion of what a meeting is *about*.

All numbers here are produced by `scripts/measure-meeting-visibility.ts` and are re-runnable. Where an earlier draft of this document was wrong, the correction is kept rather than deleted — see "Corrections".

---

## The rule

Visibility is **derived from the meeting**, not set by hand. Decided 17 Aug 2026:

| Shape | Visibility |
|---|---|
| Any attendee at a registered client domain (**any size, including 1:1**) | **team** |
| Internal only, 3+ attendees | **team** |
| Internal only, 3+ attendees, **personnel screen trips** | **private** |
| Internal only, 1–2 attendees | **private** |
| External non-client (vendors, recruiters) | **private** |
| No attendee data | **private** |

Two precedence decisions worth stating because they were genuine forks:

- **Client beats 1:1.** An account manager's 1:1 with their client contact is client work the team needs — consistent with how `get_client_meetings` already behaves.
- **Personnel beats team.** A leadership meeting about restructuring is shaped exactly like any other 3+ internal meeting. Without this carve-out the rule would publish it to the people being discussed, which is the failure this document exists to prevent, reproduced as a feature.

### What it does to the corpus

| | Events | |
|---|---|---|
| **team** — client (any size) | 410 | |
| **team** — internal 3+ | 847 | |
| private — internal 3+, personnel-flagged | 129 | ← what the carve-out holds back |
| private — internal 1:1 / solo | 1,268 | |
| private — vendor / other external | 181 | |
| private — no attendee data | 3,044 | 52% of the corpus |
| **Total team** | **1,257 (21%)** | |
| **Total private** | **4,622 (79%)** | |

**This is an expansion of access, and that should be deliberate.** 140 meetings are readable company-wide today; the rule makes it 1,257 — roughly 9×. The gain is that team meetings stop being invisible to the team. The cost is that 847 internal meetings become readable by everyone, and the personnel screen is the only thing standing between that and a leadership conversation.

The personnel screen trips on **308 events (5%)** overall — low enough not to be noise — but changes the outcome for only **129**, because the rest were private under the shape rule anyway.

---

## Two design decisions that follow from the data

### 1. Derive it; do not materialise it

The earlier draft proposed storing a `visibility` value per meeting and backfilling it. **That was the wrong shape**, and the backfill trap below is why.

The rule above is a pure function of data MeetingBrain already holds — attendee domains, attendee count, title and summary. So compute it **in the RPC at read time** and store nothing. That removes the entire class of problem:

- **No backfill**, so no chance of a mis-scoped one publishing thousands of meetings.
- **No drift.** If a meeting's attendees are corrected, its visibility follows immediately.
- **No stale rows** to reconcile when the rule changes.

`meeting_visibility` survives only as an **override table** — rows exist *only* where a human deliberately disagreed with the rule. It ships empty and stays nearly empty, which is the safest possible migration: nothing to get wrong.

### 2. Key any override on the calendar event, not the row

`processed_meeting` holds **one row per recorder**, and `get_meeting_details` serves the **richest sibling row** across everyone who recorded the event. **1,183 of 5,879 events (20%) have more than one recorder.**

With a per-row override: Chris marks his row private, Rob's row for the same meeting is untouched, the RPC picks whichever row has the fullest transcript — Rob's — and serves it. The control was set, it read back as set, and it did nothing.

Rows with no `calendar_event_id`: **0 of 8,405**, so it is a safe key.

---

## The backfill trap (kept — it is why the design changed)

Had visibility been materialised, the obvious backfill would be "mark everything with a registered client attendee as `team`, those are shared already". Measured:

| Backfill rule | Events marked `team` |
|---|---|
| Naive domain match | **2,835** |
| Domain match, internal domain excluded | **410** |
| What `get_client_meetings` actually returns | **140** |

**`thecontentengine.com` is itself registered as a client website** — `app_clients.id_client 2`, one of the two internal client ids. So a naive match treats *every internal meeting* as client work. EngineAI's production path is correct (`loadClientDomains` and `loadClientDomainMap` both filter the caller's own domain, twice over); the 2,835 came from a measurement script that did not — an accidental live demonstration of the exact failure.

**The remaining 410 vs 140 gap is fully explained**, and no longer by guesswork. The function body IS in this repository — `scripts/fix-get-client-meetings-rpc.sql` — which an earlier draft asserted it was not, using that claimed unknowability as an argument. Reading it (`:71-90`), three gates the naive re-derivation omits:

```sql
WHERE pm.attendees IS NOT NULL
  AND pm.attendees LIKE '[%'      -- attendees must parse as a JSON array
  AND pm.summary IS NOT NULL      -- unprocessed meetings excluded
  AND (p_since IS NULL OR pm.meeting_date >= p_since)
```

plus `DISTINCT ON (calendar_event_id)`. Unprocessed meetings and non-JSON attendee fields are dropped, and siblings collapse. That is 410 → 140.

Two things follow. The third line **honours `p_since`**, independently confirming correction 1 below by reading rather than by measurement. And `attendees` is a JSON array string parsed with `jsonb_array_elements(...)->>'email'` — whereas the new rule regex-matches addresses out of the raw text, which is deliberate: it also classifies rows whose attendee field is not valid JSON, which the `LIKE '[%'` gate silently drops.

Deriving at read time makes the backfill question unreachable anyway: there is no backfill to get wrong.

---

## Schema — overrides only

```sql
-- ONLY deliberate human disagreement with the derived rule. Absent row = use
-- the rule. Ships empty; a half-finished migration exposes nothing.
--
-- Keyed on calendar_event_id, NOT on processed_meeting.id: one meeting can be
-- recorded by several people (20% of events are), and get_meeting_details
-- serves the richest sibling. A per-row override would be set on one row and
-- silently bypassed via another.
CREATE TABLE IF NOT EXISTS meetingbrain.meeting_visibility_override (
  calendar_event_id   text PRIMARY KEY,
  visibility          text NOT NULL CHECK (visibility IN ('private', 'team')),
  reason              text,
  set_by              integer NOT NULL,
  date_created        timestamptz NOT NULL DEFAULT now(),
  date_updated        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meetingbrain.meeting_visibility_override IS
  'Deliberate exceptions to the derived visibility rule. Absent row means the rule applies. Never written by automation — a classifier that can overwrite a human decision is worse than no classifier.';
```

**Automation must never write to this table.** If the rule and a human disagree, the human wins permanently; that is the table's only purpose.

---

## Calendar privacy status

Asked for, and worth having — but it is **not available today and cannot be backfilled**.

`processed_meeting` has 36 columns and **none** is a visibility or sensitivity field. `processed_ms_cal_event` is empty (0 rows). So MeetingBrain does not capture what the organiser set in their calendar.

To use it, ingest would need to persist:
- Google Calendar: `event.visibility` — `"default" | "public" | "private" | "confidential"`
- Microsoft Graph: `event.sensitivity` — `"normal" | "personal" | "private" | "confidential"`

**It should be a promotion/demotion signal, not the classifier.** Google's default value is literally `"default"` (inherit the calendar), and most people never change it — keying the model on a field almost nobody sets would classify almost nothing. Where someone *has* set it, it is an explicit statement of intent and should win:

| Calendar value | Effect |
|---|---|
| `private` / `confidential` / `personal` | Force **private**, overriding the rule |
| `public` | Force **team**, overriding the rule |
| `default` / absent | Fall through to the derived rule |

Backfill is only possible for events still fetchable from the calendar APIs, so historic meetings keep the derived rule. That is fine — the derived rule is the floor, and this only ever refines it.

---

## RPC changes

Three deployed functions read meetings. They deploy **manually via the Supabase SQL Editor**, so each needs its own verification pass — there is no migration history to lean on.

| Function | Change |
|---|---|
| `get_client_meetings` | Widen from "has a client attendee" to the full derived rule, so internal team meetings appear. This is the change that expands access from 140 to ~1,257 — verify the count before and after. |
| `get_meeting_details` | Return the derived `visibility`. Serve the owner/attendee their own meeting **regardless** — this is about third parties, never about locking someone out of their own record. |
| `search_meetings` | Return `visibility` per row for labelling. Do **not** filter: the caller's own private meetings must stay findable by the caller. |

The invariant across all three: **visibility restricts what a THIRD PARTY sees; it never restricts an attendee or owner from their own record.** Backwards, this makes the product feel broken and pushes people back to their inbox.

---

## EngineAI consumption

Only possible once the RPCs return the field — EngineAI reaches meetings exclusively through RPCs and cannot read a column a function does not return.

1. Pass `visibility` through to the model on each row from `meeting_details` and `search_meetings`.
2. Where a meeting is `private` **and the caller is not an attendee**, return the summary with a notice instead of the transcript.
3. Label private meetings in search results so the model does not present them as team knowledge.

~20 lines in `lib/ai/providers.ts` plus one line in the tool description. No prompt change needed: the "Who will read what you are writing" rule shipped in `c309709` already governs what happens to the content afterwards, and `isPersonnelSensitive` already attaches a handling note.

---

## What this does not fix

**It would not have prevented the incident.** Those were Gabi's own meetings, in her own private thread, which she was entitled to read. No visibility flag blocks that and none should. The fix for that was the output-audience rule and the personnel handling note, both shipped in `c309709`. This closes the adjacent hole and gives the product a vocabulary it lacks.

**The rule is a guess about the future.** A team meeting in March may become sensitive in August when someone in it leaves. Nothing re-evaluates, and the derived-at-read-time design at least means a corrected attendee list takes effect immediately.

**`transcript_shared_by` is unexamined.** It implies transcripts already move between people by some other route. Understand it before shipping, or there will be two mechanisms that disagree.

**The personnel screen is a keyword match.** It trips on 5% of the corpus and holds back 129 team meetings, but "organisational structures, role efficiency and strategic realignment" contains no obvious personnel marker — the phrase from the actual incident would likely pass straight through it.

---

## Related finding

### The empty-allowlist fallback is real

`lib/ai/providers.ts` warns never to pass a null or empty `p_client_domains`, because the function then treats *any* non-internal external attendee as a client. Demonstrated accidentally while writing this: a bug in the measurement script produced an empty domain list, and `get_client_meetings` returned **209** meetings instead of **140** — 49% wider, no error, no signal the allowlist had been ignored. The caller-side guard in EngineAI is the only thing preventing it; it would be better placed in the function.

---

## Corrections to earlier drafts of this document

Kept deliberately — each was a confident claim that measurement disproved.

1. **"`get_client_meetings` ignores `p_since`."** It does not. The corpus starts **2026-01-21**; only 13 meetings predate the function's oldest result, so it was returning nearly everything. `p_limit` is honoured too, and `search_meetings` honours `p_since`. A suspicious range is evidence of a cap only if the underlying data goes back further — the measurement script now prints the corpus range beside every function range.
2. **Sampling.** A 2,000-row sample put sibling-recorder events at 8.6% (true: **20%**) and 1:1s at 47% of internal meetings (true: **60%**) — wrong about exactly the two populations the design turns on. All figures are now whole-corpus.
3. **The 20× over-promotion was blamed on a date window.** The real cause is the internal domain being registered as a client website.
4. **"The function body is not in this repository."** It is: `scripts/fix-get-client-meetings-rpc.sql`. Two conclusions rested on that premise — the diagnosis of the 410 vs 140 gap, and the decision to stay additive rather than modify the function — and neither was checked against an `ls scripts/`. Both survived on other grounds, which is the least useful way for a false premise to behave: it leaves no symptom.

---

## Order of work

1. Implement the derived rule as a SQL function and compare its output against `get_client_meetings` today. **Read-only, reversible.**
2. Create the override table. Ships empty; nothing changes.
3. Point `get_client_meetings` at the rule. **First behavioural change** — this is the 140 → ~1,257 expansion; verify deliberately.
4. Return `visibility` from `get_meeting_details` and `search_meetings`.
5. EngineAI consumption.
6. Capture calendar `visibility`/`sensitivity` at ingest, as an override signal.

Step 1 is safe to do now and proves the rule against real rows before anything depends on it.
