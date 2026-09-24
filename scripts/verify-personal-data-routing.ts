/**
 * A turn that needs a Claude-only tool must REACH a Claude chain.
 * Run with `npx tsx scripts/verify-personal-data-routing.ts --self-test`.
 *
 * query_gmail, query_calendar and query_microsoft register only on the Claude
 * chains — a deliberate data-processing boundary, not a capability gap. So when
 * an auto-routed turn that needs one lands on Grok, the failure is not a
 * degraded answer. The tool is simply absent, and the model answers from
 * nothing while sounding certain.
 *
 * THE TURN THIS EXISTS FOR. "Did Carol send the kick off meeting invite?" — a
 * calendar question by any reading, and the router classified it correctly as
 * meeting_data. It matched neither word list ("send" is not a mail verb here,
 * and it names no possessive calendar noun), so it stayed on Grok, where
 * query_calendar is not registered. It answered "No, Carol did not send it"
 * from a MeetingBrain search that structurally has no organiser field — and
 * produced the real organiser, Carol, one turn later from the calendar.
 *
 * The one turn correctly identified as a calendar question was the one turn
 * that lost the calendar.
 *
 * AND A TURN THAT DOES NOT NEED ONE MUST NOT BE MOVED. Thread 04c5d402,
 * 2026-09-15: a deck edit whose new slides were ABOUT MeetingBrain ("your
 * meetings", "action items", "every 15 minutes") classified meeting_data, was
 * moved off Grok to Claude by branch 3, and the Claude turn narrated a finished
 * edit without calling generate_slides. The meeting words were the deck's
 * content. Sections 1b, 2c, 2d, 3b and 4b pin that, and 2e pins the other
 * direction inside a build request: a real calendar question that shares its
 * message with a slide edit must still reach the calendar.
 *
 * IT IMPORTS THE REAL PREDICATES. A script that re-implements these regexes
 * tests its own copy and passes while the product is wrong — the failure this
 * repo has already booked twice. lib/ai/personal-data-intent.ts exists so this
 * file can import what the route actually runs.
 *
 * KNOWN AND ACCEPTED, so nobody reads their absence as an oversight:
 *  - Plain deck edits with no meeting words ("Remove slide 9 and keep
 *    everything else exactly as it is") still reach Claude through the route's
 *    web-search override. Exempting slide edits from it was decided against;
 *    the slide-claim guard covers a Claude turn that describes an unmade edit.
 *  - The router's "you MUST call query_meetingbrain" hint still fires on the
 *    incident message. Suppressing it for deliverables would cost grounding for
 *    "add a slide on what we agreed in the Gavi meeting".
 *  - English only. Single-quoted copy, and unquoted "Outlook" or "next meeting"
 *    in bullet copy, still escalate exactly as they did before (3b's NOTE).
 *  - A question left UNQUOTED in slide copy escalates, because a question that
 *    survives the quote strip is read as the user's (2e). That is the price of
 *    not losing the calendar on a real question, and it is what happened before
 *    the deliverable guard existed.
 *  - Quote stripping can hide a real ask: a mail question relayed in quotes no
 *    longer hands the mailbox need to a short follow-up, and the text between
 *    two inch marks is removed with the "quotes". Printed as NOTEs under 4b.
 *
 * MUTATION LOG — each mutant applied to the real edit in a detached worktree
 * (never the shared tree), this script run with --self-test, then restored.
 * Survivors are recorded as findings about the check, not tidied away.
 * Run 2026-09-15 on 856d73c plus this edit: 13 killed, 0 survived.
 *  M1  branch 3 back to the bare intent ........... killed, exit 2 (1b, 3b, self-test)
 *  M2  ask text keeps quoted copy ................. killed, exit 2 (3b, 4b mailbox, self-test)
 *  M3  own-meeting carve-back removed ............. killed, exit 1 (2c)
 *  M4  carve-back reads raw text .................. killed, exit 2 (3b, 3/29 decoys)
 *  M5  ASKS_ABOUT_AN_EDIT removed ................. killed, exit 1 (2d "Did Carol update the slides")
 *  M6  slide-number clause removed ................ killed, exit 2 (3b "For slide 4: …")
 *  M7  a deliverable short-circuits every branch .. killed, exit 1 (2c mail and schedule cases)
 *  M8  route calendar block on the bare intent .... killed, exit 1 (4b condition and count)
 *  M9  textNeedsMailbox on raw text ............... killed, exit 1 (4b mailbox)
 *  M10 (?!you\b) removed .......................... killed, exit 2 (3b "Will you update slide 9")
 *  M11 curly quotes not stripped .................. killed, exit 2 (3b curly-quote decoy)
 *  M12 carve-back reduced to calendar nouns ....... killed, exit 1 (2c)
 *  M13 who-organised clause removed ............... killed, exit 1 (the three 2c organiser cases)
 * M11 needs a LINE replace: the file holds literal curly quotes, so a
 * substring anchor written with “ escapes reports ANCHOR MISSING and
 * proves nothing — which is how the design-stage batch runner recorded it.
 *
 * SECOND MUTATION LOG, after the verifiers' second pass added the question
 * clause and widened the carve-back (detached worktree, 2026-09-15). M1-M13
 * were re-anchored on the current text; 16 mutants in all.
 *  M1-M4, M6-M13 ................................. killed, by the same sections as above
 *  M14 the question clause removed ................. killed, exit 1 (2e)
 *  M15 carve-back back to "who organised" only ..... killed, exit 1 (2c "who I'm meeting", "whoever sent")
 *  M16 the question clause reads raw text .......... killed, exit 2 (3b quoted two-question prompt, self-test)
 *  M5  ASKS_ABOUT_AN_EDIT removed .................. killed, exit 1 (2d, the question with no "?")
 * Two SURVIVORS on the first run of this log, both findings about the check,
 * each closed by a fixture and then killed:
 *  - M5 survived: the question clause already escalated 2d's only case, "Did
 *    Carol update the slides before the meeting?", so ASKS_ABOUT_AN_EDIT
 *    carried nothing. The same question typed without its "?" now does.
 *  - M16 survived twice: no decoy was a meeting_data build request with a
 *    question in its quoted copy, and the first one written could not tell,
 *    because `\?(\s|$)` never matches a "?" that a closing quote follows. The
 *    decoy now quotes two questions.
 */
import {
  needsClaudeForPersonalData,
  MAIL_INTENT,
  PERSONAL_SCHEDULE_INTENT,
  isPersonalMeetingQuestion,
  isDeliverableRequest,
  personalDataAskText,
  OWN_MEETING_REFERENCE,
} from "../lib/ai/personal-data-intent";
import { routeQuery, textNeedsMailbox } from "../lib/ai/query-router";
import { readFileSync } from "fs";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** A user with the calendar flag, auto-routed to Grok — the failing setup. */
const ON_GROK = {
  gmailAccess: true, calendarAccess: true, microsoftAccess: true,
  isTeamThread: false, wasAutoRouted: true, model: "grok-4-1-fast",
};

/** Run a real phrasing through the real router, then the real predicate. */
function escalates(text: string, opts?: Partial<typeof ON_GROK>): boolean {
  const route = routeQuery(text);
  return needsClaudeForPersonalData({
    userMessage: text,
    intent: route.intent,
    ...ON_GROK,
    ...(opts || {}),
  });
}
const intentOf = (t: string) => routeQuery(t).intent;

// The 2026-09-15 message, verbatim. Every meeting word in it is slide copy.
const DECK_EDIT_0915 = "Update the MeetingBrain part of this deck. Remove slide 9 (\"MeetingBrain writes up your meetings\") and put these two slides in its place, as new slides 9 and 10. Keep every other slide exactly as it is. The old slide 9 overstated two things (no bot joins calls, and prep briefs are on request, not automatic), so it goes rather than being kept. Use hyphens, never em or en dashes.\n\nNew slide 9. two-column - title \"MeetingBrain: meetings in, {actions} out\", subtitle \"Your calendar is checked every 15 minutes. No bot joins your calls.\", columns left \"What goes in\" and right \"What comes out\", tones [\"blue\", \"teal\"]. body, four lines: \"Gemini or Google Docs notes on the invite, read automatically\" / \"A recording made in Chrome or Edge\" / \"An uploaded audio or video file, up to 500 MB\" / \"A pasted transcript\". bodyRight, four lines: \"A summary, key topics and next steps\" / \"A client-ready summary you edit and copy\" / \"Action items pulled from meetings, email and Slack\" / \"The transcript, shared with colleagues who were there\".\n\nNew slide 10. cards - title \"MeetingBrain and EngineAI, {together}\", subtitle \"Your meetings feed straight into EngineAI\". cards: \"Prepare me\" body \"One click before a meeting: where things stand, who is coming, open actions.\" icon sparkles tone blue; \"Ask about your meetings\" body \"In a private chat, EngineAI reads your meetings, transcripts and open tasks.\" icon message-square tone teal; \"The secure bridge\" body \"Your Google, Microsoft and Slack connections live in MeetingBrain. EngineAI borrows them.\" icon lock tone amber. note \"Invite-only: an admin adds you at meetingbrain.ai/admin. Your own meetings and tasks only show in private chats.\"";
const QUOTED_PROMPTS_DECK = "Build a deck of example prompts: \"check my gmail\", \"what's on my calendar tomorrow?\", \"prep me for my next meeting\"";

console.log("\nPreconditions");
const probe = routeQuery("Did Carol send the kick off meeting invite?");
probe && typeof probe.intent === "string"
  ? pass(`router reachable — that question classifies as "${probe.intent}"`)
  : fail("routeQuery did not return an intent — this check is testing nothing");
// 1b is only worth anything while the incident still reaches branch 3. If a
// router change stops calling it meeting_data, 1b would pass for the wrong
// reason — and the turn may be reaching Claude by the web-search door instead.
intentOf(DECK_EDIT_0915) === "meeting_data"
  ? pass("the 2026-09-15 deck edit still classifies meeting_data — 1b tests the branch it was moved by")
  : fail(`the 2026-09-15 deck edit now classifies "${intentOf(DECK_EDIT_0915)}" — 1b no longer exercises branch 3; pick a fixture that does`);

console.log("\n1. The exact turn that failed");
escalates("Did Carol send the kick off meeting invite?")
  ? pass('"Did Carol send the kick off meeting invite?" escalates to Claude')
  : fail('"Did Carol send the kick off meeting invite?" still does NOT escalate — the calendar is unreachable on the turn that needs it');

console.log("\n1b. The deck edit that was moved (thread 04c5d402, 2026-09-15)");
!escalates(DECK_EDIT_0915)
  ? pass("the MeetingBrain deck edit stays on the auto-routed model")
  : fail("the MeetingBrain deck edit escalates — slide copy about meetings is being read as a calendar question");
!isPersonalMeetingQuestion(DECK_EDIT_0915, intentOf(DECK_EDIT_0915))
  ? pass("and the route's \"call query_calendar as well\" block would not fire on it")
  : fail("isPersonalMeetingQuestion calls the deck edit a question about the user's calendar");
!textNeedsMailbox(DECK_EDIT_0915)
  ? pass("and the mailbox override does not fire on it")
  : fail("textNeedsMailbox fires on the deck edit");

console.log("\n2. Questions that need a personal-data tool");
const MUST_ESCALATE = [
  "check my gmail",
  "any unread emails?",
  "did Ceri email me back?",
  "what's the email from Gavi about?",
  "what's on my calendar tomorrow?",
  "am I free at 3?",
  "when do I next meet Sharanya?",
  "what's my next meeting?",
  // 2026-09-07, reported from a live Auto turn. Nobody says "email" when they
  // ask who invited them — the invitation IS the mail, and the organiser is a
  // calendar field. The turn routed to Grok, found nothing, and told the user
  // to "switch to Claude or EngineAI Auto", which is what they were already
  // using. Every one of these must reach a model with a mailbox.
  "can you work out who invited me to the Sustainability Live conference this week and reply saying that unfortunately I can't make it",
  "who invited me to the conference",
  "who sent me the invite",
  "who added me to this event",
  "reply to the invitation and decline it",
  "can you decline the invite for me",
  "rsvp no to the summit invitation",
];
for (let i = 0; i < MUST_ESCALATE.length; i++) {
  const q = MUST_ESCALATE[i];
  escalates(q) ? pass(`"${q}"`) : fail(`"${q}" does not escalate — it needs a Claude-only tool`);
}

// ── The gap this fix does NOT close ─────────────────────────────────────
// The escalation keys off the ROUTER's classification, so it reaches a calendar
// question only when the router recognises one. These are the same class as the
// turn that failed — "who organised X" is a question about an invite's
// organiser — but they use "call"/"handover" rather than a meeting word, so
// routeQuery returns "general" and they stay on Grok without the calendar.
//
// Printed rather than failed, deliberately: widening the meeting_data
// classifier changes hint generation and cost for every turn it newly matches,
// which is a product decision, not a test fixture. Shown here so the gap is
// visible instead of silently absent.
console.log("\n2b. Known gap — same class, phrased without a meeting word");
const GAP = [
  "who organised the kickoff call?",
  "who set up the IFFIm handover?",
  "what time does the client run-through start?",
  // Deliverables built from own meetings that the ROUTER never calls
  // meeting_data: DATA_KEYWORDS has "meeting" but not "meetings", so a leading
  // "make " reads as a text edit; "last month" makes the second workspace_data.
  // These did not escalate before the 2026-09-15 guard either.
  "make me a deck about my meetings this week",
  "prepare a deck on the meetings I had with Gavi last month",
];
let stillGapped = 0;
for (let i = 0; i < GAP.length; i++) {
  const g = GAP[i];
  if (escalates(g)) console.log(`  ok    "${g}" now escalates (intent=${intentOf(g)}) — the gap narrowed`);
  else { stillGapped++; console.log(`  NOTE  "${g}" stays on Grok (intent=${intentOf(g)}) — no calendar on this turn`); }
}
console.log(`  ${stillGapped}/${GAP.length} still gapped. Closing them means widening meeting_data in query-router.ts, which costs money on every newly-matched turn.`);

// The deliverable guard must not swallow a deck or document built FROM the
// user's own meetings, mail or calendar. The last three are the Carol question
// riding on a build request — they escalated before the guard, and only the
// who-organised clause of OWN_MEETING_REFERENCE keeps them escalating.
console.log("\n2c. Deliverables built FROM the user's own data still escalate");
const OWN_DATA_DELIVERABLES = [
  "turn my action items from yesterday's meetings into a slide",
  "Draft a briefing document for my meeting with Siemens tomorrow",
  "build a one-pager from my calendar for next week",
  "Put together a slide on what's on my calendar next week",
  "create a presentation summarising the emails in my inbox from Gavi",
  "Add a slide listing who invited me to this week's events",
  "Can you check my gmail for the latest version of the deck and update slide 3",
  "When am I next meeting Sharanya? I need to update the deck before then",
  "Update slide 3 then tell me who sent the invite for Thursday's meeting",
  "Update slide 3 with who organised Thursday's Siemens meeting",
  "For slide 9 I need to know who organised the kick-off meeting",
  // Verifiers, 2026-09-15: first person without "my", and organiser wording
  // other than "who organised". Each escalated before the guard and stayed on
  // Grok after it.
  "Add a slide listing who I'm meeting tomorrow",
  "Build slides covering everyone we're meeting at Web Summit next week",
  "Update slide 4 with whoever sent the calendar invite for the Gavi review meeting",
];
for (let i = 0; i < OWN_DATA_DELIVERABLES.length; i++) {
  const q = OWN_DATA_DELIVERABLES[i];
  escalates(q) ? pass(`"${q}"`) : fail(`"${q}" does not escalate — the deliverable guard swallowed a request for the user's own data`);
}

// A deck or slide WORD is not a build request. "Did Carol update the slides"
// is a question about an event, and must keep the calendar.
console.log("\n2d. Questions that merely mention a deck still escalate");
const DECK_WORD_QUESTIONS = [
  "Is the deck review meeting still on for 3pm?",
  "Did Carol update the slides before the meeting?",
  // The same question typed without its question mark. The question clause
  // in isPersonalMeetingQuestion holds the line above on its own, so without
  // this one ASKS_ABOUT_AN_EDIT carried no case (M5 survived, 2026-09-15).
  "did Carol update the slides before Thursday's meeting",
  "who organised the Siemens meeting on Thursday?",
  "what meetings do I have tomorrow?",
  "did the minutes from Tuesday's meeting get sent round?",
  "prep me for my next meeting",
];
for (let i = 0; i < DECK_WORD_QUESTIONS.length; i++) {
  const q = DECK_WORD_QUESTIONS[i];
  escalates(q) ? pass(`"${q}"`) : fail(`"${q}" does not escalate — a question was taken for a build request`);
}

// A calendar QUESTION sharing its message with a slide edit. The slide number
// makes the message a build request, and before the question clause these
// stayed on Grok with no calendar and no "call query_calendar" block. The
// verifiers found thirteen, and 2d's own first fixture fails this way once
// "If so, update slide 1." is appended.
console.log("\n2e. A calendar question riding on a slide edit still escalates, with the calendar block");
const QUESTION_AND_EDIT = [
  "Did the Siemens meeting move? I need to update my deck.",
  "When is the Gavi meeting? I want to prepare the slides for it.",
  "Has the client meeting been moved? I need to change the date on slide 1.",
  "Was the Siemens meeting moved to Friday? Change slide 1's date if it was.",
  "Did the Siemens meeting get cancelled? If so drop slide 9.",
  "What's in the invite Gavi sent for the review meeting? Summarise it on slide 3.",
  "Can you see if the Siemens meeting has an agenda attached and add it to slide 5?",
  "Who's attending the Siemens kick-off meeting? Add their names to slide 3.",
  "Who is invited to Thursday's Siemens meeting? Put the list on slide 2.",
  "Is Thursday's Siemens meeting in person or online? Put it on slide 3",
  "Will the Siemens meeting run over? I need to trim slide 6",
  "Is the deck review meeting still on for 3pm? If so, update slide 1.",
  "Who created the invite for the Galderma meeting? Add them to the contacts slide in the deck.",
  "Who's the organiser of the Gavi meeting? Add them to slide 2",
  // Escalates through the mailbox door either way; what it lost was the
  // calendar block, which only isPersonalMeetingQuestion opens.
  "Did the invite for Thursday's meeting come from Carol? Update slide 2.",
];
for (let i = 0; i < QUESTION_AND_EDIT.length; i++) {
  const q = QUESTION_AND_EDIT[i];
  const it = intentOf(q);
  // PRECONDITION: only a meeting_data build request reaches the question
  // clause. Anything else would pass here without it.
  if (it !== "meeting_data" || !isDeliverableRequest(q)) { fail(`"${q}" is no longer a meeting_data build request (intent=${it}) — it does not exercise the question clause; pick another fixture`); continue; }
  escalates(q) && isPersonalMeetingQuestion(q, it)
    ? pass(`"${q}"`)
    : fail(`"${q}" loses the calendar — a question was read as slide copy because the message names a slide`);
}

console.log("\n3. Decoys — ordinary work that must NOT be moved off the fast model");
// Everyday words in a content agency. Escalating these would silently swap the
// model mid-conversation, and pay Claude prices, for routine work.
const MUST_NOT_ESCALATE = [
  // Drafting an invitation is not reading one. These must stay cheap.
  "write an invitation for the launch party",
  "draft an invite for the webinar",
  "who should we invite to the roundtable",
  "draft an email campaign for Galderma",
  "write the email subject lines for the newsletter",
  "how many emails did the campaign send?",
  "what's in the social inbox?",
  "email marketing best practice for 2026",
  "add a calendar of content for September",
  "build an editorial calendar",
  "what's the content pipeline looking like?",
  "summarise the contracts ending this quarter",
  "write a LinkedIn post about our AI work",
];
for (let i = 0; i < MUST_NOT_ESCALATE.length; i++) {
  const q = MUST_NOT_ESCALATE[i];
  !escalates(q) ? pass(`"${q}" stays put`) : fail(`"${q}" escalates — ordinary work would move to Claude`);
}

console.log("\n3b. Decoys — decks and documents whose CONTENT mentions meetings, calendars or mail");
const DELIVERABLE_DECOYS = [
  DECK_EDIT_0915,
  QUOTED_PROMPTS_DECK,
  "Add a slide after slide 4 titled \"MeetingBrain writes up your meetings\" with three bullets about meeting notes, action items and minutes",
  "Create a presentation for the team on running better meetings",
  "Write a Word document explaining the meeting notes feature for new starters",
  "Replace slide 7 with a cards slide: Email, Slack, Calendar, Meetings",
  "Remove the stand-up slide from the deck and keep everything else",
  "Turn this into a presentation: our weekly sync with the client covers the agenda, the minutes and action items",
  "Create a Google Doc template for meeting minutes",
  "Add a slide about the Slack integration and how action items from meetings get pulled in",
  "Change slide 5 so the card reads “Prep me for my next meeting” instead of “Prepare me”",
  "Insert a new slide 6 called \"Ask about your meetings\" with the note \"Your own meetings and tasks only show in private chats\"",
  "Edit the deck: slide 5 should say the prep brief is on request and no bot joins the meeting",
  "For slide 4: title \"Meetings in, actions out\", three bullets about action items and minutes",
  "Add a slide 3 quote: \"I never miss my action items now\" with a note about meetings",
  "Will you update slide 9 so it says \"MeetingBrain writes up your meetings\" and mentions action items",
  // QUESTIONS inside the quoted copy. The question clause must read the ask
  // text, not the message. Two of them, because `\?(\s|$)` never matches a
  // question mark that a closing quote follows, so a one-question prompt cannot
  // tell the two apart (M16 survived that version, 2026-09-15).
  "Update slide 11: headline \"Meetings, minutes and action items in one place\", example prompts \"Who organised Thursday's meeting? What did we agree?\"",
];
for (let i = 0; i < DELIVERABLE_DECOYS.length; i++) {
  const q = DELIVERABLE_DECOYS[i];
  const label = q.replace(/\n/g, " ").slice(0, 90);
  !escalates(q) ? pass(`"${label}" stays put`) : fail(`"${label}" escalates — deck content read as a personal-data question`);
}
// Printed, not failed: bare "outlook" and "teams chat" are deliberate
// PERSONAL_SCHEDULE_INTENT clauses and are not in quotes here.
const RESIDUAL = "Make slides for onboarding: how to book meetings, how to use Outlook, Teams chat etiquette";
console.log(escalates(RESIDUAL) ? `  NOTE  "${RESIDUAL}" still escalates — unquoted product names on branch 2` : `  ok    "${RESIDUAL}" no longer escalates`);

console.log("\n4. The gates hold");
const q = "what's on my calendar tomorrow?";
!escalates(q, { isTeamThread: true })
  ? pass("team thread never escalates — personal data stays out of shared threads")
  : fail("a team thread escalated toward personal-data tools");
!escalates(q, { wasAutoRouted: false })
  ? pass("a model the user picked themselves is left alone")
  : fail("escalated over an explicit user model choice");
!escalates(q, { model: "claude-sonnet-5" })
  ? pass("already on Claude — no-op")
  : fail("escalated a turn that is already on Claude");
!escalates(q, { gmailAccess: false, calendarAccess: false, microsoftAccess: false })
  ? pass("no access flags — never escalates toward a tool the user cannot reach")
  : fail("escalated for a user with no personal-data access at all");
!escalates("Did Carol send the kick off meeting invite?", { calendarAccess: false })
  ? pass("meeting_data without calendar access does not escalate")
  : fail("meeting_data escalated without calendar access — pointless model switch");

console.log("\n4b. Both meeting_data consumers and both mailbox doors ask the same question");
// The calendar block in the route cannot be driven without the network, so
// assert the CONDITION that guards it calls the predicate — the if() directly
// above the block's text, not merely somewhere in the file. A predicate that
// exists but is not what the if() reads is the failure this repo has booked.
const route = readFileSync("app/api/ai/conversations/[id]/messages/route.ts", "utf8");
const blockAt = route.indexOf("## Also required this turn");
const ifAt = blockAt < 0 ? -1 : route.lastIndexOf("if (", blockAt);
const cond = ifAt < 0 ? "" : route.slice(ifAt, route.indexOf("{", ifAt));
blockAt >= 0 && ifAt >= 0
  ? pass("found the calendar block and its condition")
  : fail("could not find the \"Also required this turn\" block — this assertion is now blind");
cond.indexOf("isPersonalMeetingQuestion(") >= 0 && cond.indexOf("\"meeting_data\"") < 0
  ? pass("the calendar block is gated on isPersonalMeetingQuestion, not the bare intent")
  : fail(`the calendar block condition does not use isPersonalMeetingQuestion: ${cond.trim()}`);
(route.match(/intent\s*===\s*"meeting_data"/g) || []).length === 0
  ? pass("no bare meeting_data comparison left in the route")
  : fail("the route still compares intent === \"meeting_data\" somewhere — a third consumer that reads deck copy as a calendar question");
// Behavioural, through the router: the mailbox override reads the same ask text.
!textNeedsMailbox(QUOTED_PROMPTS_DECK) && !routeQuery(QUOTED_PROMPTS_DECK).needsMailbox
  ? pass("a quoted \"check my gmail\" on a slide does not open the mailbox door either")
  : fail("textNeedsMailbox fires on quoted slide copy — the deck reaches Claude through the mailbox override instead");
textNeedsMailbox("check my gmail")
  ? pass("while the same words as an ask still do")
  : fail("textNeedsMailbox no longer fires on \"check my gmail\" — the stripping is eating real asks");
// Quote stripping can also hide a REAL ask inside a build request. Accepted,
// and printed rather than failed so the behaviour change stays visible: a mail
// question RELAYED in quotes no longer hands the mailbox need to a short
// follow-up ("and draft the reply to them"), and the text between two inch
// marks goes with the "quotes". In the second, the web-search override still
// happens to reach Claude; nothing here promises it will.
const RELAYED = "Carol forwarded \"has Siemens emailed us back?\" - put the answer on slide 5";
const INCHES = "On slide 2 make the logo 2\" wide, check my gmail for Sam's brand guidelines, and make the photo 3\" tall";
console.log(textNeedsMailbox(RELAYED)
  ? "  ok    a mail question relayed in quotes still needs the mailbox"
  : `  NOTE  "${RELAYED}" no longer needs the mailbox, so its follow-up does not inherit it`);
console.log(textNeedsMailbox(INCHES)
  ? "  ok    inch marks no longer hide a mail ask"
  : `  NOTE  two inch marks hide "check my gmail" in "${INCHES}"`);

console.log("\n5. Every Claude-only tool is named by a routing rule");
// A fifth tool gated on /^claude/ with no escalation branch would be
// unreachable in exactly the way query_calendar was on the failing turn.
const providers = readFileSync("lib/ai/providers.ts", "utf8");
const gated = providers.match(/\/\^claude\/\.test\(apiModel[^)]*\)/g) || [];
gated.length >= 3
  ? pass(`${gated.length} Claude-only tool gates found in providers.ts`)
  : fail(`only ${gated.length} Claude-only gates matched — the pattern moved and this check is now blind`);
const intentSrc = readFileSync("lib/ai/personal-data-intent.ts", "utf8");
for (const tool of ["gmail", "calendar", "microsoft"]) {
  new RegExp(tool, "i").test(intentSrc)
    ? pass(`${tool} has a routing rule`)
    : fail(`${tool} is Claude-only but no routing rule mentions it`);
}

// ── Self-test ───────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n6. Self-test — the fixes are what make cases 1 and 1b pass");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    ${name}`);
    else { selfFails++; console.log(`  FAIL  ${name}`); }
  };

  // The predicate as it stood BEFORE the meeting_data branch: the two word lists only.
  const OLD = (text: string) => MAIL_INTENT.test(text) || PERSONAL_SCHEDULE_INTENT.test(text);

  const CASE1 = "Did Carol send the kick off meeting invite?";
  const intent1 = intentOf(CASE1);
  detects("the OLD predicate misses the failing turn (so the clause is load-bearing)", OLD(CASE1) === false);
  detects("the NEW predicate catches it", escalates(CASE1) === true);
  detects("the router really does classify it meeting_data", intent1 === "meeting_data");

  // The predicate as it stood on 2026-09-15, before the deliverable guard. If
  // it did not escalate the incident, 1b would pass without the guard doing
  // anything.
  const PRE_GUARD = (text: string) => OLD(text) || intentOf(text) === "meeting_data";
  detects("the pre-guard predicate escalates the 2026-09-15 deck edit (so the guard is load-bearing)", PRE_GUARD(DECK_EDIT_0915) === true);
  detects("the incident message is recognised as a deliverable request", isDeliverableRequest(DECK_EDIT_0915));
  detects("quote-stripping is load-bearing: the raw quoted prompts match MAIL_INTENT", MAIL_INTENT.test(QUOTED_PROMPTS_DECK));
  detects("…and the ask text does not", !MAIL_INTENT.test(personalDataAskText(QUOTED_PROMPTS_DECK)));
  const OWN = "Draft a briefing document for my meeting with Siemens tomorrow";
  detects("the own-meeting carve-back is load-bearing: a 2c case IS a meeting_data deliverable request",
    isDeliverableRequest(OWN) && intentOf(OWN) === "meeting_data");
  const QE = "Did the Siemens meeting get cancelled? If so drop slide 9.";
  detects("the question clause is load-bearing: a 2e case is a meeting_data build request naming no meeting of the user's own",
    isDeliverableRequest(QE) && intentOf(QE) === "meeting_data" && !OWN_MEETING_REFERENCE.test(QE));

  // And no decoy may be caught — a rule that escalates everything would also
  // make cases 1 and 2c pass, vacuously.
  let decoyEscalations = 0;
  const allDecoys = MUST_NOT_ESCALATE.concat(DELIVERABLE_DECOYS);
  for (let i = 0; i < allDecoys.length; i++) if (escalates(allDecoys[i])) decoyEscalations++;
  detects(`no clause is a catch-all (${decoyEscalations}/${allDecoys.length} decoys escalate)`, decoyEscalations === 0);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
