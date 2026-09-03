/**
 * What the meeting reports tell the model about WHEN a meeting was, and whether
 * there is any record of it.
 *
 * ── TWO FAILURES, ONE THREAD ────────────────────────────────────────────────
 *
 * Asked to summarise a call from that morning, EngineAI answered with two
 * mistakes, both of them the tool layer's fault rather than the model's.
 *
 * FIRST, it placed a "Digital Authority Briefing" at 09:00-13:00 "today". The
 * times were exactly right and the day was not: that meeting is the following
 * day. `dayLabel` exists precisely to stop this — its own comment records that
 * it was added after the model "answered Monday's 'tomorrow' with Wednesday's
 * meetings" — and it had been wired into exactly ONE of the five meeting
 * reports. The other four handed over a bare ISO date and left the model to
 * work the weekday out, which is the step already known to fail.
 *
 * SECOND, it told the user MeetingBrain had "no transcript and no summary" for
 * the call. The row says otherwise: it carries a `document_id` — a Google Doc
 * of notes attached to the calendar entry — with
 *
 *     error: "Document too short to extract tasks"
 *
 * and transcript, local_transcript and summary all null. MeetingBrain fetched
 * the notes, judged them too short to mine for TASKS, and stored nothing.
 * EngineAI then read `has_transcript: false` off a search result and stopped,
 * without ever opening the meeting.
 *
 * So this file asserts two things a passing type-check cannot:
 *   - every meeting report SAYS the day rather than implying it, and
 *   - no report lets "no recording" be reported to the user as "no record".
 *
 * MUTATION LOG
 *   - dayLabel removed from any one report        → KILLED (count assertion)
 *   - dayLabel stops distinguishing tomorrow      → KILLED
 *   - the has_transcript note dropped from search → KILLED
 *   - the notes-document read removed             → KILLED
 *   - table cells skipped when flattening a doc   → KILLED
 */

import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const ok = (m: string) => console.log(`  ok    ${m}`);
const assert = (cond: boolean, m: string) => { if (!cond) fail(m); };

const root = join(__dirname, "..");

(async () => {
  const { dayLabel } = await import("../lib/ai/providers");
  const { docToText } = await import("../lib/gdrive/meeting-notes");

  console.log("1. Every report says which DAY");
  {
    // Anchored on a fixed "now" so the assertions are about the labelling and
    // not about when the check happens to run.
    const now = new Date("2026-09-03T10:29:00Z");           // Thursday, Zurich 12:29
    const todayNoon = "2026-09-03T09:15:00+00:00";          // the call in question
    const tomorrowAM = "2026-09-04T07:00:00+00:00";         // the briefing it mislabelled
    const nextWeek = "2026-09-10T07:00:00+00:00";

    assert(/^TODAY /.test(dayLabel(todayNoon, now) || ""), `today is labelled TODAY (${dayLabel(todayNoon, now)})`);
    // THE ONE THAT MATTERS: the briefing the model called "today".
    assert(/^TOMORROW /.test(dayLabel(tomorrowAM, now) || ""),
      `the next day is labelled TOMORROW, not left for the model to derive (${dayLabel(tomorrowAM, now)})`);
    assert(!/TODAY|TOMORROW/.test(dayLabel(nextWeek, now) || ""),
      `a date further out gets a plain weekday (${dayLabel(nextWeek, now)})`);
    assert((dayLabel(tomorrowAM, now) || "").indexOf("Friday") >= 0,
      `and names the weekday (${dayLabel(tomorrowAM, now)})`);
    assert(dayLabel(null, now) === null, "a missing date is not labelled");

    // Wired into EVERY meeting report, not one. This is the assertion that
    // fails when a new report is added without the label, which is exactly how
    // the other four came to be missing it.
    const prov = readFileSync(join(root, "lib/ai/providers.ts"), "utf8");
    const wired = (prov.match(/day: dayLabel\(/g) || []).length;
    assert(wired === 5,
      `all five meeting reports label the day — meetings, upcoming_meetings, search_meetings, client_meetings, meeting_details (${wired} of 5)`);
    if (!failures) ok("no report leaves the model to work out the weekday for itself");
  }

  console.log("\n2. \"No recording\" is never reported as \"no record\"");
  {
    const before = failures;
    const prov = readFileSync(join(root, "lib/ai/providers.ts"), "utf8");

    // The search result the model actually stopped on.
    assert(/has_transcript: false means there is no RECORDING/.test(prov),
      "search_meetings explains what has_transcript actually means");
    assert(/call meeting_details with its id BEFORE answering/.test(prov),
      "and tells the model to open the meeting before answering");
    assert(/Never tell the user a meeting has no record on the strength of this field alone/.test(prov),
      "and forbids the answer the user actually got");
    assert(/has_transcript: false means no RECORDING, not "no notes"/.test(prov),
      "the past-meetings report carries the same warning");

    // The notes document itself.
    assert(/notes_document: notesDoc/.test(prov), "meeting_details returns the notes document when it is the only record");
    assert(/\.select\("document_id"\)/.test(prov),
      "reading the column the RPC does not expose");
    assert(/that IS the record of this meeting/.test(prov),
      "and says so in the hint, rather than leaving the model to infer it");
    // Only when there is genuinely nothing else — this must not fire on every
    // meeting and spend a Docs API call per lookup.
    assert(/if \(!transcript && !hasNotes\) \{/.test(prov),
      "and only when the meeting has no transcript and no notes at all");
    if (failures === before) ok("a meeting with notes can no longer read as a meeting with none");
  }

  console.log("\n3. Reading the notes document");
  {
    const before = failures;
    // Notes are very often a TABLE — agenda in one column, decisions in the
    // other. A flattener that walks only paragraphs returns an empty string
    // from a document full of content, and "empty" would then be reported to
    // the user as "no notes" all over again.
    const doc = {
      title: "Visio avec Thomas — notes",
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: "Changes to authorityon.ai\n" } }] } },
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [{ paragraph: { elements: [{ textRun: { content: "Scan targets" } }] } }] },
                    { content: [{ paragraph: { elements: [{ textRun: { content: "add competitor set" } }] } }] },
                  ],
                },
                {
                  tableCells: [
                    { content: [{ paragraph: { elements: [{ textRun: { content: "Model list" } }] } }] },
                    { content: [{ paragraph: { elements: [{ textRun: { content: "drop sonar" } }] } }] },
                  ],
                },
              ],
            },
          },
          { paragraph: { elements: [{ textRun: { content: "Owner: Thomas\n" } }] } },
        ],
      },
    };
    const text = docToText(doc);
    assert(text.indexOf("Changes to authorityon.ai") >= 0, "paragraphs are read");
    assert(text.indexOf("Scan targets | add competitor set") >= 0,
      `table rows are read, cell by cell (${JSON.stringify(text.slice(0, 120))})`);
    assert(text.indexOf("drop sonar") >= 0, "every row, not just the first");
    assert(text.indexOf("Owner: Thomas") >= 0, "and content after the table");
    // A genuinely empty document must report empty rather than a blank record.
    assert(docToText({ body: { content: [] } }) === "", "an empty document is empty");
    assert(docToText(null) === "", "and a missing document is not a crash");
    if (failures === before) ok("a notes document survives being flattened, tables included");
  }

  console.log(failures ? `\n✗ ${failures} failure${failures === 1 ? "" : "s"}` : "\n✓ meetings carry their day, and notes are found where MeetingBrain left them");
  process.exit(failures ? 1 : 0);
})();
