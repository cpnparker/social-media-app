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
    // AN INVITATION IS MAIL, and nobody says "email" when they ask about one.
    // Reported live 2026-09-07: "who invited me to the Sustainability Live
    // conference this week and reply saying I can't make it" matched none of
    // the clauses above, routed to Grok, found nothing, and told the user to
    // "switch to Claude or EngineAI Auto" — which is what they were already
    // using. The sender's name is in the invitation mail, and the organiser is
    // a calendar field; both live on the Claude chains.
    //
    // Kept narrow deliberately. "invited ME/US" and "who sent me" are about a
    // real message that exists. Writing one is not: "write an invitation for
    // the launch" and "who should we invite" stay on the cheap leg, and the
    // decoy list in the check pins that.
    "\\bwho (invited|added|sent|asked) (me|us)\\b",
    "\\b(invited|added) (me|us) to\\b",
    "\\bwho sent (me|us) (the|this|that|an?) \\w+",
    "\\b(reply|respond|replying|decline|declining|accept|accepting|rsvp)\\w*\\b[^.?!]{0,40}\\b(invite|invitation|guest pass)\\b",
    "\\b(invite|invitation|guest pass)\\b[^.?!]{0,30}\\b(from|for me|i (got|received))\\b",
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

/**
 * A request to BUILD or CHANGE a deck or a document.
 *
 * THE TURN THIS EXISTS FOR (thread 04c5d402, 2026-09-15). "Update the
 * MeetingBrain part of this deck. Remove slide 9 … put these two slides in its
 * place" carried two new slides of copy about MeetingBrain — "your meetings",
 * "action items", "every 15 minutes". The router counted those words and
 * classified the turn meeting_data, branch 3 below moved it off Grok to
 * Claude, and the Claude turn narrated a finished edit without calling
 * generate_slides. The words were the deck's CONTENT. Nothing in the request
 * needed the user's calendar.
 *
 * Verb-anchored like COMPOSITION_REQUEST in query-router.ts, so "the deck Carol
 * sent" is not a build request. A slide NUMBER on its own marks a build
 * request. That does not make the whole message deck copy: "Did the Siemens
 * meeting get cancelled? If so drop slide 9" asks the calendar a real question,
 * and a question left in the ask after quotes are stripped is still one
 * (isPersonalMeetingQuestion).
 *
 * English only, like every other word list in this file, and accepted as such.
 */
export const DELIVERABLE_REQUEST = new RegExp(
  [
    "\\b(make|create|build|generate|draft|write|produce|prepare|put together|turn|convert|add|insert|update|edit|change|amend|revise|rework|redo|replace|remove|delete|drop|swap|move|reorder)\\b[^.?!\\n]{0,60}\\b(slides?|deck|presentation|slideshow|powerpoint|pptx|word doc(ument)?|google doc|docx|document|one-pager)\\b",
    "\\b(into|as) an? (slides?|deck|presentation|slideshow|word doc(ument)?|google doc|document|one-pager)\\b",
    "\\bslides? \\d{1,2}\\b",
  ].join("|"),
  "i"
);

// "Did Carol update the slides before the meeting?" asks about an EVENT, which
// the calendar may answer; it is not a request to build anything. "will you"
// is excluded because that one IS the request.
const ASKS_ABOUT_AN_EDIT =
  /\b(did|has|have|had|was|were|will) (?!you\b)\w+( \w+)? (update|send|share|edit|change|make|create|build|finish|approve)\w*\b/i;

// Quoted spans in a deliverable request are its CONTENT, not the user's ask:
// a slide titled "What's on my calendar?" is not a calendar question. Double
// and curly double quotes only — single quotes cannot be told apart from
// apostrophes, so 'What's on my calendar?' in single quotes still escalates,
// exactly as it did before this guard.
const QUOTED_SPAN = /"[^"\n]{0,400}"|“[^”\n]{0,400}”/g;

/** The text with quoted spans removed. Exported for the check, and for
 *  lib/slides/claim.ts, which reads a deck request's ask the same way. */
export function stripQuotedContent(text: string): string {
  return (text || "").replace(QUOTED_SPAN, " ");
}

/**
 * The user's OWN meetings, in the first person. Slide copy about a product
 * addresses the reader ("your meetings"); a deck built FROM the user's data
 * says "my". Read over the quote-stripped text, so copy saying "my next
 * meeting" does not count.
 *
 * The organiser clauses are not first person and are there on purpose. "Update
 * slide 3 with who organised Thursday's Siemens meeting" is the Carol question
 * again, riding on a build request, and without them that turn stays on Grok,
 * where query_meetingbrain has no organiser field to answer from. "whoever sent
 * the invite", "who created the invite" and "the organiser of" ask the same.
 * "who I'm meeting tomorrow" is first person without "my".
 */
export const OWN_MEETING_REFERENCE =
  /\bmy ([\w'-]+ ){0,2}(meetings?|calls?|1:1s?|one[- ]to[- ]ones?|invites?|invitations?|action items?|tasks?|calendar|diary|schedule|agenda|week|day)\b|\b(meetings?|calls?) (i|we) (had|have|attended|ran|joined)\b|\b(i|we) met\b|\bwho(ever)? (organi[sz]ed|sent|set up|scheduled|invited|booked|created)\b|\borgani[sz]er\b|\b(i.m|i am|we.re|we are) (meeting|seeing)\b/i;

export function isDeliverableRequest(text: string): boolean {
  const ask = stripQuotedContent(text);
  return DELIVERABLE_REQUEST.test(ask) && !ASKS_ABOUT_AN_EDIT.test(ask);
}

/**
 * The part of a message that is the user's ASK. For a deliverable request, the
 * quoted copy is removed; for anything else the message is returned whole.
 * query-router.ts's textNeedsMailbox reads this too — the mailbox override and
 * this one must agree, or a quoted "check my gmail" on a slide reaches Claude
 * through the other door.
 */
export function personalDataAskText(text: string): string {
  return isDeliverableRequest(text) ? stripQuotedContent(text) : (text || "");
}

/**
 * Is a meeting_data turn really a question about the user's own meetings?
 *
 * Used by BOTH the auto-route override below and the route's "Also required
 * this turn … call query_calendar" block, which told the incident turn it was
 * "a question about the user's calendar" on top of moving it.
 *
 * It does not touch the router's own "you MUST call query_meetingbrain" hint,
 * which still fires on a deck edit whose copy mentions meetings. Removing it
 * for deliverables would cost the grounding "add a slide on what we agreed in
 * the Gavi meeting" needs, so that was decided against, not overlooked.
 */
export function isPersonalMeetingQuestion(text: string, intent: string): boolean {
  if (intent !== "meeting_data") return false;
  if (!isDeliverableRequest(text)) return true;
  const ask = stripQuotedContent(text);
  // A question that survives the quote strip is the user's, not the deck's:
  // "Has the client meeting been moved? I need to change the date on slide 1."
  // Without this, a slide number anywhere in the message sent a real calendar
  // question to Grok without the calendar. The cost, accepted: a rhetorical
  // question left UNQUOTED in slide copy still escalates, as it did before the
  // deliverable guard existed.
  if (/\?(\s|$)/.test(ask)) return true;
  return OWN_MEETING_REFERENCE.test(ask);
}

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
 *  4. And one way that must NOT be in: the CONTENT of a deliverable. Thread
 *     04c5d402 (2026-09-15) was a deck edit whose new slides were about
 *     MeetingBrain; the router read the meeting words in that copy as
 *     meeting_data, branch 3 moved the turn to Claude, and the Claude turn
 *     described an edit it never made. Quoted copy in a build request is not
 *     the ask, so every branch reads the ask text, and branch 3 fires on a
 *     build request only when the user names their own meetings, names an
 *     organiser, or still asks a question once the quoted copy is gone.
 *     Quote stripping can also hide a real ask: a mail question RELAYED in
 *     quotes inside a build request, or text between two inch marks. Accepted,
 *     and printed by the check as a NOTE.
 *
 * Every branch is gated on the matching access flag, so it can never escalate
 * toward a tool the user cannot reach anyway.
 *
 * What this does NOT stop: a plain deck edit with no meeting words still
 * reaches Claude through the route's web-search override, which was left
 * alone deliberately (a new deck on a current topic can need search). The
 * slide-claim guard, not routing, is what covers a Claude turn that describes
 * an edit it never made.
 */
export function needsClaudeForPersonalData(input: PersonalDataRoutingInput): boolean {
  const { userMessage, intent, gmailAccess, calendarAccess, microsoftAccess, isTeamThread, wasAutoRouted, model } = input;
  if (!(gmailAccess || calendarAccess || microsoftAccess)) return false;
  if (isTeamThread) return false;
  if (!wasAutoRouted) return false;
  if (model.startsWith("claude")) return false;
  const raw = userMessage || "";
  const ask = personalDataAskText(raw);
  if (MAIL_INTENT.test(ask)) return true;
  if ((calendarAccess || microsoftAccess) && PERSONAL_SCHEDULE_INTENT.test(ask)) return true;
  if (calendarAccess && isPersonalMeetingQuestion(raw, intent)) return true;
  return false;
}
