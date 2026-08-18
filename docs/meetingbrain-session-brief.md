# Brief for a MeetingBrain session

Three jobs, all in `/Users/chris/meetingbrain`, all driven by work done in the EngineAI repo (`/Users/chris/social-media-app`) on 17 August 2026. Every file path, line number and figure below was verified against the live code and the live database on that date — none of it is inferred. Re-check anything that looks stale before acting on it.

Jobs 2 and 3 are one-line fixes with unambiguous evidence and should be done first — one stops a meter running, the other stops users copy-pasting emails the product already fetched. Job 1 is the real work.

---

## Job 1 — Capture the calendar's own privacy flag

### Why

EngineAI now derives per-meeting visibility from meeting *shape* — who attended and how many. That rule is deployed and working, but it can only guess. When someone marks a calendar event **private** in Google or Outlook, that is not a guess: it is an explicit statement of intent, and it should win over anything inferred.

MeetingBrain does not capture it today. Verified on the live database:

- `meetingbrain.processed_meeting` has **36 columns** and none is a visibility or sensitivity field. The nearest, `transcript_shared_by`, is provenance.
- `meetingbrain.processed_ms_cal_event` has **0 rows**.

### What to capture

| Source | Field | Values |
|---|---|---|
| Google Calendar | `event.visibility` | `"default"` \| `"public"` \| `"private"` \| `"confidential"` |
| Microsoft Graph | `event.sensitivity` | `"normal"` \| `"personal"` \| `"private"` \| `"confidential"` |

Store it raw. Do not normalise to a boolean at ingest — `confidential` and `private` may need to diverge later, and a boolean cannot be un-collapsed.

Suggested column on `processed_meeting`:

```sql
ALTER TABLE meetingbrain.processed_meeting
  ADD COLUMN IF NOT EXISTS calendar_visibility text;

COMMENT ON COLUMN meetingbrain.processed_meeting.calendar_visibility IS
  'Raw visibility/sensitivity as set by the meeting organiser in their calendar. Google: default|public|private|confidential. Microsoft: normal|personal|private|confidential. NULL means not captured (all rows before Aug 2026) — which is NOT the same as "default" and must not be treated as one.';
```

**`NULL` must mean "we did not capture this", never "default".** Every row written before this ships will be NULL, and code that reads NULL as "the organiser chose default" would be asserting a fact about ~8,400 meetings that nobody ever recorded.

### The trap: there are six write sites

`lib/meeting-scanner.ts` writes `processed_meeting` in **six** places. Verified line numbers as of commit `c1aa8ba`:

- `:371` — an UPDATE that refreshes metadata (title/date/attendees/location) on an existing row
- `:394`, `:442`, `:574`, `:595`, `:622` — upserts on `onConflict: 'user_id,calendar_event_id'`

Miss one and some meetings silently carry NULL for ever, indistinguishable from pre-migration rows. **Add the field to all six, then grep to confirm the count matches.** This is the single most likely way this job goes wrong.

### How EngineAI will consume it

Do not build the consumption side here — EngineAI owns it. But build the capture so this shape works:

| Calendar value | Effect on the derived rule |
|---|---|
| `private`, `confidential`, `personal` | Force **private**, overriding the shape rule |
| `public` | Force **team**, overriding the shape rule |
| `default`, `normal`, NULL | Fall through to the shape rule |

It is a **promotion/demotion signal, not a classifier.** Google's default value is literally the string `"default"` and most people never change it, so keying the model on it would classify almost nothing. Where someone *has* set it, it is intent and should win.

### Backfill

Only possible for events still fetchable from the calendar APIs. Historic meetings keep NULL and fall through to the shape rule, which is fine — the shape rule is the floor and this only refines it. **Do not invent a value for old rows.**

### Context worth having

EngineAI's side is deployed and verified. Relevant objects in the shared Supabase project:

- `meetingbrain.get_meeting_visibility(p_internal_domain, p_client_domains)` — derives per-event visibility. Keyed on `calendar_event_id`, **not** `processed_meeting.id`, because 1,183 of 5,879 events (20%) have more than one recorder and `get_meeting_details` serves the richest sibling.
- `meetingbrain.meeting_visibility_override` — deliberate human exceptions. RLS on; anon can read nothing.
- `meetingbrain.get_visible_meetings(...)` — the widened client-meetings report.

Full design and measurements: `social-media-app/docs/meetingbrain-meeting-visibility-spec.md`.

### Three gotchas that cost real time on the EngineAI side

1. **`thecontentengine.com` is registered as a client website** (`public.app_clients.id_client 2`). Any code matching attendee domains against the client list must exclude the internal domain, or every internal meeting classifies as client work — 2,835 events instead of 410.
2. **`attendees` is a JSON array string**, parsed as `jsonb_array_elements(attendees::jsonb)->>'email'`. `jsonb_array_elements` **errors** on non-JSON text, which is why the existing RPCs gate on `attendees LIKE '[%'`. Roughly 36% of rows have no attendee data at all.
3. **`get_client_meetings` widens on an empty allowlist.** Passing `NULL` or `[]` for `p_client_domains` makes it treat *any* non-internal, non-free-mail attendee as a client — 209 meetings instead of 140, silently. Anything new should fail closed instead.

---

## Job 2 — Fix the Grok rate table (one line)

### The bug

`lib/ai.ts:28`:

```ts
'grok-4-1-fast': { input: 200, output: 500 },   // $0.20/M input, $0.50/M output
```

xAI **retired** `grok-4-1-fast-reasoning` and `grok-4-1-fast-non-reasoning` on 15 May 2026. The slugs still resolve — requests redirect to `grok-4.3` and are billed at grok-4.3 rates — so nothing failed and nothing surfaced. MeetingBrain has been recording $0.20/$0.50 for calls actually charged **$1.25/$2.50** ever since.

### The fix

Units are **tenths of a cent per 1M tokens** (`claude-sonnet-4-6: { input: 3000 }` = $3/M), so:

```ts
'grok-4-1-fast': { input: 1250, output: 2500 },  // retired slug — redirects to grok-4.3, billed at $1.25/$2.50
```

Understatement is **6.25× on input and 5× on output**.

### Evidence

Measured against `intelligence.ai_usage` on 17 Aug 2026. The rows come from `logSupabaseUsage` at **`lib/ai.ts:126`**, which inserts with `type_app: "meetingbrain"`:

- 2,950 MeetingBrain rows since 1 August: **15,935 recorded** against **17,404 correct** — understated by **8.4%**
- Mismatching rows date from 14 August onward and are **still arriving**; that is the day EngineAI's own rate table was corrected, so from then the two systems disagree and only one was fixed
- Every mismatching row carries `type_source` of `dashboard`, `email`, `slack`, `meeting` or `dedup` — none of which exist in the EngineAI repo

### Note while you are in there

The variable at `lib/ai.ts:285` is named `costCents` but holds **tenths of a cent**. Not a correctness bug — the value flows into `units_cost_tenths` correctly — but it is a trap for the next person doing rate maths. Consider renaming.

There are also **two** usage writers: `ai_usage_log` (MeetingBrain's own table, ~`:290`) and `intelligence.ai_usage` (shared with EngineAI, `:126`). Both read the same `COST_PER_M`, so one fix corrects both.

### After the fix

Ask Chris to re-run step 2 of `social-media-app/scripts/backfill-grok-fast-cost.sql` once, to correct rows written between the last backfill and the deploy. Then step 4 of that script should return **no rows** and stay that way — it lists every writer still producing understated rows, newest first.

---

## Job 3 — Raise the email body cap (one line, and it is biting daily)

### The bug

`lib/gmail-query.ts:20`:

```ts
const MAX_BODY = 2000;
```

Every message body is cut to 2,000 characters with `"… (truncated)"` appended (`:77-79`). Two thousand characters is roughly 300 words — shorter than an ordinary business email.

### Why it matters more than the number suggests

A real case, 18 Aug 2026. A client email of ~2,400 characters was cut at 2,000. Everything before the cut was preamble; what was lost was the **proposed meeting dates** and a **handover note naming who was covering while the sender was away**. The assistant reported the truncation honestly, called the thread a second time hoping for more, got the identical cut, and asked the user to paste the message in. The user had to copy an email into a chat window that had already fetched it.

Truncation lands on the END of an email, which in business correspondence is where the asks, dates and decisions live. A cap that removes the last 20% removes most of the value.

### The fix

Raise it, and vary it by report — `thread` is a deliberate request for one conversation, whereas a search can return 25 messages:

```ts
const MAX_BODY = 2000;          // search results: many messages, keep them light
const MAX_BODY_THREAD = 12000;  // an explicitly requested conversation
```

`getThread` (`:216-234`) passes `toSummary(m, true)`; give it the larger cap. `searchMessages` (`:192`) can stay at the smaller one.

12,000 characters is roughly 1,800 words — long enough for essentially any real email including a quoted reply chain, and a 20-message thread still caps at ~240KB, which is within a single tool result.

### Keep the marker

`"… (truncated)"` must stay. EngineAI now detects it and tells the model that retrying will return the same cut — the retry loop above happened because nothing said so. Silent truncation would be worse than the current cap.

---

## Ground rules that apply to all three jobs

- **Never print or log meeting content.** Titles, summaries, transcripts and attendee lists are other people's data. Counts, shapes and column names answer almost every question worth asking.
- **The database has no local Postgres credentials.** SQL is run by hand in the Supabase SQL Editor. Print it inline in chat rather than only writing a file, name the target project, and include a sanity check.
- **Supabase's linter flags DDL as destructive.** Say what the change actually does and let Chris read the dialog.
- **Verify before asserting.** Three separate claims in the EngineAI work were confidently wrong and had to be retracted: that `get_client_meetings` ignores `p_since` (the corpus simply starts 2026-01-21), that its body was not in the repo (it is, at `scripts/fix-get-client-meetings-rpc.sql`), and a "byte-stable" cache claim that two ordinary events break. Each survived review because nothing errored. If a number looks surprising, find the control before explaining it.
