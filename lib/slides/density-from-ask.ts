/**
 * WHICH DENSITY A NEW DECK IS BUILT AT, read off the user's own words.
 *
 * `read` is today's numbers — 20pt titles, 10pt body, more words on a page —
 * and it is what every deck built so far was built at. `present` is the same
 * deck for a room: ~30pt titles in brand blue, a standfirst at 14, body at 12,
 * bodyY down from 103.68 to 158.40 and a body band a fifth shorter. That is
 * why it holds about half the words; it is not a font-size swap.
 *
 * READ IS THE ANSWER WHENEVER THE ASK IS AMBIGUOUS. `read` is the default
 * (DEFAULT_DENSITY, decided 2026-09-21), and a default that a loose predicate
 * can talk its way out of is not a default. So this returns `present` only on
 * an explicit statement that somebody will STAND UP AND TALK, and `read` for
 * everything else — including every ask that says nothing about purpose, which
 * is 34 of the 42 real deck-building asks in intelligence.ai_messages.
 *
 * MEASURED, NOT GUESSED, and measured TWICE over. The first pass read the 78
 * stored deck drafts and the 42 creation asks among them. The second read
 * every one of the 2,936 stored user messages, because a trigger's cost is not
 * how often it fires on the asks that happened to build a deck — it is how
 * often the WORD occurs in this workspace at all. Four triggers died on that
 * second measurement and they are named below with the number that killed
 * them. The rule flipped 7 of 42 creations, 16.7%.
 *
 * AND A THIRD TIME, 2026-09-23, for the possession form (HELD, below), over
 * the corpus as it then stood: 2,974 stored user messages (2,970 with text)
 * and 45 conversations holding a deck. Creations: 7 of 45 before (15.6%), 8
 * of 45 after (17.8%), and the eighth is the ask the form was written for —
 * 3ec51a09, the Amrize workshop — and no other. Every message: 63 before
 * (2.1%), 72 after (2.4%), none lost; the nine new ones are eight distinct
 * sentences, all an occasion the writer is about to attend ("I have an
 * editorial meeting tomorrow", "I am holding a farewell meeting with the team
 * … today", "I have a meeting with Gabi and Rob to define our roles"), and
 * none of those seven conversations holds a deck, so no stored deck would
 * have been built differently by any of them.
 *
 *   - "presentation" IS NOT A TRIGGER. It is a plain synonym for deck in this
 *     corpus ("Can you make this presentation in TCE format", "can you make me
 *     a 10 slide presentation on this") and appears in 12 of 42 asks. Trigger
 *     on it and 29% of creations flip on a word carrying no information about
 *     how the deck is used.
 *   - NOR IS THE BARE VERB "present". 19 of the 2,936 stored messages carry
 *     one and about five of them mean speaking: the rest are "present the ways
 *     as 4-5 bullet points", "how to present this research on LinkedIn", and
 *     twice the ADJECTIVE — "which companies apart from Hiscox are present in
 *     this space?" — which no word boundary can exclude. The verb only counts
 *     bound to a person: to somebody it is presented TO, or to somebody who
 *     says they will do it.
 *   - NOR IS THE BARE NOUN "pitch". 23 messages carry it and 22 are a MEDIA
 *     pitch — a written thing, the daily work of this agency ("an article
 *     pitch bylined by Noor", "Omit this part of the pitch"). One is a deck
 *     somebody stands up with, and it says so the way an occasion says so:
 *     "a new deck that works for sales pitches".
 *   - BARE "call" IS NOT AN OCCASION either. The plan offered "a deck for
 *     Thursday's call" as the example trigger; "call" occurs 9 times in the
 *     corpus and not once as a meeting — four are "three tool calls", the rest
 *     are slide copy. It is readmitted only when a day or a clock time pins it.
 *   - AND "run through" IS NOT "walk through". "Run through these interview
 *     transcripts", "a summary of clients to run through": every one of the 4
 *     stored `run ... through` messages is the READING sense, and no stored
 *     deck ask needs the word. Walk and talk stay; run is gone.
 *
 * THE WORD BOUNDARIES ARE STILL LOAD-BEARING under all of that. The canonical
 * READ deck — the Siemens ITM executive report, 2026-09-07 — contains "stock
 * images ... that represent the subject of the slide" and no other
 * present-stem, so a substring match on "present" turns the read control into
 * a present deck.
 *
 * NOTHING WIDER WITHOUT A REAL SENTENCE TO POINT AT. Every pattern here is
 * answerable with a message somebody actually sent: five are needed by one of
 * the seven decks that flipped first, the possession form by the eighth, and
 * the three `present`-verb forms are needed by
 * real messages of this workspace that mean somebody will speak ("I want to
 * present and launch EngineGPT to the company tomorrow morning", "I now need
 * to present to the team"), measured to fire on nothing else. A trigger with
 * no sentence behind it is fitted to zero examples, which is exactly how
 * "call" got in, and how "board", "pitch", "run through" and "I'm doing" got
 * in and back out. Widen it per observed ask, the way the write-off name
 * pattern is widened.
 *
 * PURE ON PURPOSE. Nothing here imports the builder — a type, which is erased,
 * and one bound shared with the deck-ask window — so the predicate can be
 * driven by a check without standing a deck up, and so the one place that
 * DECIDES a density cannot quietly grow a second opinion about geometry.
 */
import type { Density } from "@/lib/slides/brand";
import { DECK_ASK_WINDOW } from "@/lib/slides/claim";

/**
 * HOW FAR INTO THE ASK WE READ. Quoted copy in a build request is content, not
 * the ask — the rule this repo already writes down for personal-data routing,
 * and the corpus says it is the dominant false positive here too, not an edge
 * case. Run whole-text and per-turn over the 36 later turns of the stored
 * decks, 4 of them re-stamp a deck that already exists, and 3 of those match
 * on words that are ON THE SLIDES being written: "or talk it through",
 * "before a meeting", "for a meeting" inside pasted notes. Three of the four
 * are consecutive turns in one thread (04c5d402, 2026-09-15) — the same
 * thread, and the same failure mode, that CLAUDE.md already records for
 * `meeting_data`.
 *
 * 300 characters removes those three and costs nothing: all seven true
 * positives name the occasion inside the first 160. The median ask is 122
 * characters, so for most asks this clamp does nothing at all. The fourth is a
 * real occasion phrase in the opening of a turn that rebuilds an existing
 * deck; no text rule can help there, and none is asked to — inference never
 * runs on a conversation that already has a deck.
 */
const OPENING = 300;

/**
 * The opening of the ask, cut on a WHOLE WORD.
 *
 * The word extension is not tidiness. A cut mid-word can MANUFACTURE a trigger
 * the text does not contain: an ask whose 301st character falls inside
 * "meetings" ends in "...for our meeting", and the singular is an occasion
 * where the plural is not. Whether it OUGHT to be is a separate question the
 * corpus has not answered; the point is that a truncation must not answer it.
 * No stored ask does this today (measured: 0 of 78), so it is pinned by a
 * synthetic fixture rather than by the corpus — pinned precisely because a
 * check that only drives real asks would never see it.
 */
export function askOpening(text: string | undefined): string {
  const t = String(text == null ? "" : text);
  if (t.length <= OPENING) return t;
  let end = OPENING;
  while (end < t.length && /\w/.test(t.charAt(end))) end += 1;
  return t.slice(0, end);
}

/** Who a deck gets presented TO. The audience is what makes "present" the
 *  speaking verb rather than the laying-out one.
 *
 *  `board` is here and deliberately NOT in the occasion nouns below: the board
 *  is somebody you present TO, and "for the board pack" is a document. The
 *  word is evidence in one position and noise in the other. */
const AUDIENCE = "(?:team|client|clients|board|company|group|room|audience|staff|partners?|leadership|execs?|executives?|everyone|colleagues|department)";

/** Somebody says they will SPEAK. The verb bound to a person, never the noun. */
const SPOKEN: RegExp[] = [
  // "produce a Google Slides presentation for me to present for the client" —
  // the one stored deck ask that turns on this word. NOT "you to present",
  // which in this workspace is the layout sense ("I'd like you to present: -
  // title - brief or description").
  /\b(?:me|us|him|her|them)\s+to\s+present\b/i,
  // "I want to present and launch EngineGPT to the company tomorrow morning",
  // "I now need to present to the team the sections on section 5".
  /\b(?:want|need|going|have|hoping|due)\s+to\s+present\b/i,
  // "so I can present to the client the following". The audience follows the
  // verb directly: "presenting these ideas to the client in an email" — a real
  // message, and not a deck being spoken — is three words away and misses.
  new RegExp("\\bpresent(?:s|ing|ed)?\\s+(?:to|at)\\s+(?:the|my|our|a|this)?\\s*" + AUDIENCE + "\\b", "i"),
  // "make a google presentation to walk through the findings", "talk it
  // through". NOT `run ... through`, which is the reading sense here.
  /\b(?:walk|talk)(?:ing|s)?\s+(?:me|us|them|you|it)?\s*through\b/i,
  // "I'm giving a briefing to the team on AI tools for TCE tomorrow morning."
  /\b(?:giving|give|deliver|delivering|running|run)\s+(?:a|the|my|this)\s+(?:briefing|talk|session|workshop|pitch|presentation|keynote|demo)\b/i,
];

/** Days and near-days, for an occasion that is pinned to one. */
const WHEN = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|this afternoon|next week)";

/**
 * AN OCCASION THE DECK IS FOR. The binding preposition is what separates the
 * occasion from the topic: "for my 10am meeting" is an occasion; "notes from
 * my prep meeting" and "MeetingBrain writes up your meetings" are not, and
 * both are real corpus text that a bare noun list would have flipped.
 *
 * `pitch(?:es)?` is here rather than in a pattern of its own, and that IS the
 * fix for the media pitch: bound this way it matches "a new deck that works
 * for sales pitches" and not one of the other 22 stored messages about
 * pitching an article. `board` is NOT here: it fired on nothing in 2,936
 * messages — "for the board meeting" is already an occasion because of the
 * word meeting — while "for the board pack", a document, would have flipped.
 */
const OCCASION_NOUN = "(?:meeting|briefing|workshop|all-hands|all hands|off-?site|stand-?up|webinar|conference|keynote|session|kick-?off|away ?day|demo|pitch(?:es)?|talk)";

const OCCASION = new RegExp(
  "\\b(?:for|at|ahead of|before)\\s+(?:my|our|the|this|next|" + WHEN + "(?:'s|’s)?)?\\s*(?:\\w+\\s+){0,3}?" +
  OCCASION_NOUN + "\\b",
  "i"
);

/**
 * AN OCCASION THE USER HAS, rather than one the deck is FOR. The same event,
 * owned instead of served, and it is the canonical `present` ask: thread
 * 3ec51a09 (2026-09-22) opened "we have a workshop with Amrize toi show them
 * how to create and optimise content for AI. Can you build a presentation…",
 * and the deck was built at `read` because OCCASION needs its preposition —
 * nine of its eighteen slides ended below 72% of the canvas, where at
 * `present` two do.
 *
 * WIDENED PER OBSERVED ASK, and each verb has a real sentence behind it:
 * "we have a workshop with Amrize" (have), "I'm having a workshop with Gabi
 * and Roberts this morning" and "We are having a morning meeting to say
 * goodbye to Holly" (having), "I am holding a farewell meeting with the team
 * and her today" (holding — a speech, asked for in the same message). `have
 * got` / `'ve got` occurs NOWHERE in the 2,974 stored user messages and is
 * admitted anyway, as the British spelling of the observed verb rather than a
 * new trigger; it was measured to fire on nothing (both stored "got a"
 * messages miss). "Hosting" was drafted beside holding and taken back out: the
 * one stored sentence it was meant for, "we are co hosting this session",
 * does not have the shape (a word sits between the verb and its tense) and
 * was already `present` by another rule, so it had no sentence of its own.
 * "I'm running a workshop for" needs nothing new — SPOKEN already binds
 * `running` to its noun.
 *
 * FOUR THINGS KEEP IT FROM BEING THE BARE NOUN LIST AGAIN, and the corpus
 * says plainly which of them it needs today and which it does not:
 *   - PAST TENSE IS NOT AN OCCASION TO PREPARE FOR, and this is the one the
 *     corpus demands. "We had a meeting with Siemens yesterday. Can you give
 *     me a summary" — five stored messages say `had` before an occasion noun,
 *     every one asks about a meeting that is over, and four of them flip the
 *     moment `had` is admitted. Only have, have got and the progressive are
 *     read.
 *   - A DETERMINER DIRECTLY AFTER THE VERB, so the verb is POSSESSION rather
 *     than an auxiliary: "we have finished the workshop with Amrize" is a
 *     perfect tense about something over, and with the determiner optional
 *     "finished" is one of the three words allowed before the noun.
 *   - THE NOUN MUST BE THE HEAD, followed by what follows an event — with,
 *     for, to, on, a day — or ending the clause. "we have the meeting notes
 *     from Tuesday" is a document, and MeetingBrain means this workspace
 *     writes that sentence every week.
 *   - A QUESTION IS NOT A STATEMENT: "do we have a meeting with Siemens
 *     tomorrow?" is the shape of the calendar questions this app answers.
 * The last three are NOT demanded by any stored message — measured, each can
 * be removed on its own and no message of the 2,970 changes its answer (the
 * real near-miss, "I have attached the briefing document for SCOPE", is
 * stopped by the determiner and the head-noun rule each on its own). They are
 * kept because this is a new trigger on a word as common as `have`, and each
 * is pinned by a SYNTHETIC fixture in check 16a of verify-slide-edit.ts, said
 * to be synthetic there, for the reason the clamp's word-boundary fixture is.
 */
const HELD = new RegExp(
  "(?<!\\b(?:do|did)\\s)\\b(?:we|i)" +
  "(?:\\s+have(?:\\s+got)?|(?:'ve|’ve)\\s+got|(?:'re|’re|'m|’m|\\s+are|\\s+am)\\s+(?:having|holding))" +
  "\\s+(?:a|an|the|our|my|this)\\s+(?:\\w+\\s+){0,3}?" + OCCASION_NOUN +
  "(?=\\s+(?:with|for|at|on|in|to|about|tomorrow|today|tonight|this|next|later)\\b|\\s*(?:[.,;:!?]|$))",
  "i"
);

/**
 * "a deck for Thursday's call", "slides for the 10am call" — the plan's own
 * example, kept working. A day or a clock time is what makes a call an event
 * rather than a function call or a line of slide copy.
 */
const TIMED_CALL = new RegExp(
  "\\b(?:for|at|ahead of|before)\\s+(?:my|our|the)?\\s*(?:" + WHEN + "(?:'s|’s)?|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))\\s*(?:\\w+\\s+){0,2}?call\\b",
  "i"
);

/**
 * THE DENSITY ONE TURN ASKS FOR. The unit the checks drive; the call site
 * reads a few turns of them through densityFromAsks.
 */
export function densityFromAsk(text: string | undefined): Density {
  const opening = askOpening(text);
  if (!opening) return "read";
  for (let i = 0; i < SPOKEN.length; i++) {
    if (SPOKEN[i].test(opening)) return "present";
  }
  if (OCCASION.test(opening)) return "present";
  if (HELD.test(opening)) return "present";
  if (TIMED_CALL.test(opening)) return "present";
  return "read";
}

/**
 * THE DENSITY A NEW DECK IS BUILT AT, from the user's last few turns, NEWEST
 * FIRST. Called in exactly one place — where a conversation that has no deck
 * yet builds its first one. An existing deck INHERITS the density it was
 * created at and this is never consulted again; see prepareSlidesForBuild.
 *
 * WHY MORE THAN ONE TURN. The occasion is stated when it comes up, and the
 * build is asked for when the material is ready, and those are not always the
 * same message. The deck this misses otherwise is the most valuable one in the
 * corpus: 04c5d402 opens "I'm giving a briefing to the team on AI tools for
 * TCE tomorrow morning. can you make me an outline of this for me", and asks
 * for the deck eighteen minutes later with "can you make me a 10 slide
 * presentation on this". That deck was published to Drive at `read`.
 *
 * The bound is DECK_ASK_WINDOW, imported rather than retyped, because this is
 * the same question the route already answers for deck asks — commit 1d9f633,
 * "The ask survives the turns it takes to fetch the source" — and two windows
 * that are meant to agree and are written down twice are two windows that will
 * not. Measured over the corpus, the window turns 6 creations into 7; the one
 * it adds is 04c5d402 and it adds no other.
 *
 * ONLY AT CREATION, still. Reading back over turns makes the creation/edit
 * asymmetry matter MORE, not less: an existing deck never reaches this.
 */
export function densityFromAsks(texts: (string | undefined)[] | undefined): Density {
  const all = texts || [];
  const n = Math.min(all.length, DECK_ASK_WINDOW);
  for (let i = 0; i < n; i++) {
    if (densityFromAsk(all[i]) === "present") return "present";
  }
  return "read";
}
