/**
 * Does this turn need a Claude chain to answer?
 *
 * query_gmail, query_calendar and query_microsoft register ONLY on the Claude
 * chains — a deliberate data-processing boundary, not a capability gap (see the
 * four-gate comment above the Gmail registration in providers.ts). So a turn
 * that needs one of them and is auto-routed to Grok does not get a degraded
 * answer; it gets an answer composed from nothing, and the model reports the
 * data does not exist.
 *
 * LIFTED OUT OF THE ROUTE so it can be tested against the real predicates. A
 * check that re-implements these regexes tests its own copy and passes while
 * the product is wrong, which is the failure this repo has booked more than
 * once. scripts/verify-personal-data-routing.ts imports THESE.
 */

export const MAIL_INTENT = new RegExp(
  [
    "\\bg-?mail\\b",
    "\\bmy (inbox|mailbox|e-?mails?|mails)\\b",
    "\\bin my (inbox|mailbox|mail|e-?mails?)\\b",
    "\\b(check|search|read|look in|find in|go through) (my )?(mail|e-?mails?|inbox|mailbox)\\b",
    "\\b(e-?mailed|mailed) (me|us)\\b",
    "\\b(did|does|has|have|hasn.t|didn.t|will) \\w+ (e-?mail(ed)?|replied|reply|written|got back|come back)",
    "\\b(e-?mails?|mail) from\\b",
    "\\bany (unread|new) (mail|e-?mails?)\\b",
    "\\bunread (mail|e-?mails?)\\b",
    "\\b(e-?mails?|mail) (i|we) (got|received|have|missed)\\b",
    "\\breceived (an?|any) (e-?mails?|mail)\\b",
    "\\bthe (e-?mail|thread) (from|about)\\b",
  ].join("|"),
  "i"
);

// Calendar and Microsoft register on the Claude chains only, for the same
// reason mail does, so they need the same auto-route override or the tool
// is simply never offered and the model answers from nothing.
// Narrow, like MAIL_INTENT: "the meeting" and "my diary" are everyday words
// here, and "calendar" alone appears in content-planning chat constantly.
export const PERSONAL_SCHEDULE_INTENT = new RegExp(
  [
    "\\bmy (calendar|diary|schedule|agenda)\\b",
    "\\b(in|on) my (calendar|diary|schedule)\\b",
    "\\bwhat.s (on|in) (my )?(calendar|diary|schedule|agenda)\\b",
    "\\b(am i|are we) (free|busy|meeting)\\b",
    "\\bwhen (am i|do i) (next )?(meet|meeting|see)\\b",
    "\\bnext meeting\\b",
    "\\boutlook\\b",
    "\\bteams (chat|message|messages)\\b",
    "\\bmicrosoft 365\\b",
    "\\bm365\\b",
  ].join("|"),
  "i"
);

export interface PersonalDataRoutingInput {
  userMessage: string;
  /** queryRoute.intent from lib/ai/query-router.ts */
  intent: string;
  gmailAccess: boolean;
  calendarAccess: boolean;
  microsoftAccess: boolean;
  isTeamThread: boolean;
  /** The user did not pick a model themselves. */
  wasAutoRouted: boolean;
  /** The model the router landed on so far. */
  model: string;
}

/**
 * True when the turn must be moved to Claude to reach a personal-data tool.
 *
 * Three ways in, and the third is the one that was missing:
 *  1. MAIL_INTENT — the user's own mailbox, by wording.
 *  2. PERSONAL_SCHEDULE_INTENT — their own calendar, by wording.
 *  3. The ROUTER's own classification. "Did Carol send the kick off meeting
 *     invite?" is a calendar question by any reading, and the router
 *     classified it meeting_data — but it matched neither word list ("send"
 *     is not a mail verb here, and it names no possessive calendar noun), so
 *     it stayed on Grok where query_calendar is not registered. The one turn
 *     correctly identified as a calendar question was the one turn that lost
 *     the calendar, and the model answered "No, Carol did not send it" from a
 *     source that structurally cannot know who sent anything.
 *
 * Every branch is gated on the matching access flag, so it can never escalate
 * toward a tool the user cannot reach anyway.
 */
export function needsClaudeForPersonalData(input: PersonalDataRoutingInput): boolean {
  const { userMessage, intent, gmailAccess, calendarAccess, microsoftAccess, isTeamThread, wasAutoRouted, model } = input;
  if (!(gmailAccess || calendarAccess || microsoftAccess)) return false;
  if (isTeamThread) return false;
  if (!wasAutoRouted) return false;
  if (model.startsWith("claude")) return false;
  const text = userMessage || "";
  if (MAIL_INTENT.test(text)) return true;
  if ((calendarAccess || microsoftAccess) && PERSONAL_SCHEDULE_INTENT.test(text)) return true;
  if (calendarAccess && intent === "meeting_data") return true;
  return false;
}
