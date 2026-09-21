/**
 * A deck change the user asked for is made, or the reply says it was not.
 *
 * THE INCIDENT, 2026-09-15 (thread 04c5d402). A deck-edit request ran on
 * claude-sonnet-5, ended round 0 with stop_reason=end_turn and no tool call,
 * and replied "Slide 9 ... is gone, replaced by two more accurate slides" and
 * "The deck is now 12 slides total". Nothing changed. No chain could stop that:
 * a round with no tool call and a normal stop is a finished answer in all four,
 * needsForcedFinal reads only the last sentence for a promise, and each of the
 * three end-of-turn notices needs something this turn did not have (an
 * attached source, a refused call, a stall).
 *
 * The guard is TWO questions, and both must be yes:
 *   - did the USER'S message this turn ask for the deck to be built or changed
 *     (asksForDeckChange), and
 *   - does the REPLY say a change was made (deckChangeClaim)?
 * with no generate_slides call having reached the builder
 * (SlidesTurnState.lastOutcome unset), and no OTHER deliverable made this turn
 * (a Word document, a .pptx file, a chart, an image): a reply describing the
 * thing that was made reads like a deck change whenever the deck was its
 * source. The reply question alone fired on 11 of 13 honest replies about REAL
 * earlier edits — "What's on slide 9 now?", "Did the change go through?", a
 * recap, a LinkedIn post about the new deck — and a notice saying "the change
 * did not happen" is false on every one of them. With the ask gate the notice
 * speaks only about THIS reply, so it is true whenever it speaks.
 *
 * Pure on purpose: no providers import, so the checks load it without the SDKs.
 *
 * KNOWN LIMITATIONS, accepted by the owner (2026-09-15):
 *   - English only. A request or reply in German or French is unguarded.
 *   - The gate is per TURN. A turn that really edits once and then claims a
 *     second edit it never made stays silent, because lastOutcome is set. The
 *     same holds for a turn that made a Word document, a chart or an image and
 *     then claims a deck change beside it.
 *   - After a successful retry the kept narration can disagree with the deck
 *     (the incident said 12 slides; the change makes 13). No deterministic
 *     slide-count line is added after the retry.
 *   - The retry round's text is streamed as it arrives. A model that answers
 *     the nudge ("You're right, nothing changed") shows that to the user; the
 *     nudge's own "never acknowledge or mention it" is the only guard. Holding
 *     that text back would also hold back the one question a genuinely unclear
 *     request needs, so it was left.
 *   - A provider fallback leg inherits config.slidesTurn from the failed leg,
 *     so an outcome the failed leg recorded silences this notice (and
 *     unresolvedSlidesNotice) on the leg that replaces it. Pre-existing; not
 *     fixed here.
 *   - Slide edits are not exempt from the route's web-search override, so plain
 *     deck edits still reach Claude; this guard is what covers them there.
 *   - The corpus in check 40 was written with these rules in view. It has NOT
 *     been calibrated on stored ai_messages rows: that reads other users'
 *     chats and needs the owner's go-ahead. Expect real phrasing to find misses.
 *   - A ChatPanel slide comment is read by its own words only when the deck
 *     and slide titles carry no double quote; otherwise the template's "Change
 *     only that slide" reads as an ask, as it did before.
 */
import { GENERATION_CONTROL_CHAT_MD } from "@/lib/ai/capability-control";
import { stripQuotedContent } from "@/lib/ai/personal-data-intent";
import type { SlidesTurnState } from "@/lib/slides/failure";

// ------------------------------------------------------------ the user's ask
//
// No regex `u` flag anywhere in this file: under this tsconfig (no target) it
// fails the build with TS1501. Every emoji matched below is in the BMP.
const ASK_VERBS = "add|insert|remove|delete|drop|cut|replace|swap|change|update|edit|amend|revise|rewrite|redo|rework|move|reorder|shorten|lengthen|tighten|trim|fix|correct|make|turn|split|merge|put|rename|retitle|build|create|generate|recreate|rebuild|redraw|restyle|tweak|adjust|use|lose|convert|expand|condense|simplify|combine|highlight|recolou?r|colou?r|set|give";
const ASK_GERUNDS = "adding|inserting|removing|deleting|dropping|cutting|replacing|swapping|changing|updating|editing|moving|reordering|shortening|tightening|trimming|fixing|putting|renaming|splitting|merging|making|turning|using|combining|highlighting|recolouring|recoloring|giving|losing";
const SLIDE_REF = "slides?\\s+\\d{1,2}|(?:first|second|third|last|final|next|opening|closing|cover) slide";
// A cover PAGE or LETTER belongs to a document, and a deck LINK is something to
// paste into one: "Add a cover page to the Word report" and "add the deck link"
// name a deck word without asking for a deck change.
const TARGETS_GUARDED = "slides?|deck|presentation|slideshow|cover(?!\\s+(?:page|letter|note|email|e-mail)\\b)|title slide|closing slide|divider";
const TARGETS_BARE = "slides?|deck|presentation|slideshow|cover|title slide|closing slide|divider";
// An artefact between the verb and the deck noun makes the deck the SUBJECT of
// the thing asked for ("write a post announcing the new deck"), not its object.
const ARTEFACTS = "post|posts|email|e-mail|message|note|notes|summary|script|article|blog|caption|release|announcement|brief|copy|document|doc|report|memo|newsletter|tweet|reply|letter|agenda|invite|speaker notes|outline";
// ...unless the artefact word is a slide or a slide's field: "Delete the agenda
// slide", "Fix the copy on slide 5", "Add a note to slide 10". Slides carry a
// `note` field, and the incident's own new slide 10 had one.
const SLIDE_FIELD = `(?!\\s+slides?\\b|\\s+(?:on|to|in|for|of)\\s+(?:the\\s+)?(?:${SLIDE_REF}|slides?|cover|title slide|closing slide)\\b)`;
// The deck is the SOURCE of something else: "Turn the deck into a Word
// document", "Use the deck to write a LinkedIn post". Read from the rest of the
// clause after the deck noun, because the artefact comes after it.
const OTHER_OUTPUTS = "(?:(?:word|google|pdf|editable|linkedin|board)\\s+)?(?:doc(?:ument)?s?|docx|pdf|e-?mails?|posts?|summary|report|memo|brief|one-pager|article|blog(?:\\s+post)?|newsletter|script|tweet|letter|outline|handout)(?!\\s+slides?\\b)";
const SOURCE_OF_OTHER = new RegExp(`^[^.?!\\n]{0,40}?\\b(?:(?:into|as)\\s+(?:an?\\s+|the\\s+)?${OTHER_OUTPUTS}\\b|to\\s+(?:an?\\s+|the\\s+)?(?:word|google)\\s+(?:doc(?:ument)?|report)\\b|to\\s+(?:write|draft|compose)\\b)`, "i");

const verbTargetCache: { [k: string]: RegExp } = {};
function verbTargetRe(x: { [k: string]: boolean }): RegExp {
  const key = `${x.noArtefactBlock ? 1 : 0}${x.noArtefactExemption ? 1 : 0}${x.noTargetGuard ? 1 : 0}`;
  if (verbTargetCache[key]) return verbTargetCache[key];
  const blocker = x.noArtefactBlock ? "" : `(?!\\b(?:${ARTEFACTS})\\b${x.noArtefactExemption ? "" : SLIDE_FIELD})`;
  const targets = x.noTargetGuard ? TARGETS_BARE : TARGETS_GUARDED;
  const tail = x.noTargetGuard ? "" : "(?!\\s+(?:link|url|address)\\b)";
  verbTargetCache[key] = new RegExp(`\\b(?:${ASK_VERBS})\\b(?:${blocker}[^.?!\\n]){0,60}?\\b(?:${targets}|${SLIDE_REF})\\b${tail}`, "i");
  return verbTargetCache[key];
}

export const ASK_RULES: { id: string; re: RegExp }[] = [
  { id: "verb-target", re: verbTargetRe({}) },
  { id: "ref-should", re: new RegExp(`\\b(?:${SLIDE_REF}|cover|title slide|closing slide)\\b[^.?!\\n]{0,40}?\\b(?:should|needs? to|has to|must)\\s+(?:say|read|be|show|have|use|become|go|come)\\b`, "i") },
  { id: "new-slide-spec", re: /^\s*new slide \d{1,2}\b/im },
  // Separate from verb-target because the artefact blocker sees "document" or
  // "report" in "Convert the attached document into a deck".
  { id: "into-deck", re: /\b(?:into|as)\s+(?:a|an|the)?\s*(?:\d+[- ]slide\s+)?(?:deck|slides|presentation|slideshow)\b/i },
  // "How about moving AuthorityOn to the front?" names no deck, so it is read
  // as an edit only when a deck is in the conversation.
  { id: "how-about", re: new RegExp(`\\b(?:how|what) about\\s+(?:${ASK_GERUNDS})\\b(?:(?!\\b(?:${ARTEFACTS})\\b)[^.?!\\n]){0,60}?\\b(?:${TARGETS_GUARDED}|${SLIDE_REF}|(?:front|start|beginning|end)(?!\\s+of\\s+(?:the\\s+)?(?!deck\\b|presentation\\b|slides\\b)\\w+))\\b`, "i") },
];
const QUESTION_OPENER = /^\s*(?:what|which|how|why|who|whose|where|when|did|does|do|is|are|was|were|has|have|had|should|shall)\b/i;
// Requests written as questions. "Is it possible to replace slide 9?" asks for
// the change as plainly as "Replace slide 9".
const POLITE_REQUEST = /^\s*(?:is it possible to|would it be possible to|are you able to|is there (?:any )?way to|how about|what about|what if (?:we|you))\b/i;
// "Give me three options for the cover title" asks for words to choose from.
const OPTIONS_ONLY = /\b(?:give me|suggest|propose|come up with|brainstorm|offer)\b[^.?!\n]{0,30}?\b(?:options?|alternatives?|ideas?|versions?|suggestions?|variations?|choices)\b/i;
// A thank-you or an approval asks for nothing, however recently the deck
// changed: "Perfect, thanks!" after a real edit is not a request to edit again.
// A bare "ok" is left out on purpose; after an offer it means yes.
const APPROVAL_WORD = "great|perfect|lovely|nice|cool|good|brilliant|excellent|awesome|amazing|fantastic|love (?:it|this|that)|looks? (?:good|great|fine|right|perfect)|sounds? (?:good|great)|all good|thanks|thank you|thanks a lot|many thanks|cheers|much better|that works|works for me";
const APPROVAL_ONLY = new RegExp(`^\\s*(?:ok(?:ay)?[\\s,.!]+)?(?:${APPROVAL_WORD})(?:[\\s,.!]+(?:ok(?:ay)?|${APPROVAL_WORD}))*[\\s,.!]*$`, "i");
// A short reply that can only be an answer: a yes, a choice, or a bare change
// verb with nothing else named ("Replace it"). A message that names the deck or
// an artefact ("Turn the deck into a Word document") is read by the rules
// below, blockers and all, whatever the reply before it asked.
const AFFIRMATIVE_OR_CHOICE = /^\s*(?:yes|yep|yeah|yup|sure|ok(?:ay)?|alright|all right|go ahead|do it|please do|go for it|absolutely|definitely|please)\b|\b(?:both|either)\b|\b(?:the\s+)?(?:first|second|third|last|other)\s+one\b|\boption\s+\d\b/i;
const BARE_CHANGE_VERB = new RegExp(`\\b(?:${ASK_VERBS}|apply)\\b`, "i");
function answerShape(text: string): boolean {
  return AFFIRMATIVE_OR_CHOICE.test(text) || (BARE_CHANGE_VERB.test(text) && !DECK_NOUN.test(text) && !ARTEFACT_WORD.test(text));
}
const NEGATIVE_ANSWER = /^\s*(?:no|nope|nah|not (?:now|yet|really)|don'?t|do not|leave it|never ?mind|cancel|stop|wait|hold (?:on|off)|skip it)\b/i;
const DECK_NOUN = /\b(?:slides?|deck|presentation|cover)\b/i;
const OFFER_VERB = new RegExp(`\\b(?:${ASK_VERBS}|apply|proceed|go ahead)\\b`, "i");
const ARTEFACT_WORD = new RegExp(`\\b(?:${ARTEFACTS})\\b`, "i");
// ChatPanel's sendSlideComment (components/ai-writer/ChatPanel.tsx). The tail
// is fixed text the client adds to EVERY comment, so it says nothing about
// whether this comment asks for a change.
const COMMENT_TEMPLATE = /^On slide \d{1,3}(?: \("[^"\n]*"\))? of "[^"\n]*": ([\s\S]*?)\n\nChange only that slide\. Leave every other slide exactly as it is, and resend the complete deck\.\s*$/;

function isQuestion(s: string, x: { [k: string]: boolean }): boolean {
  return /\?\s*$/.test(s) && QUESTION_OPENER.test(s) && (!!x.noPolite || !POLITE_REQUEST.test(s));
}

/**
 * The reply ends by asking whether to change the deck: "Want me to replace
 * slide 9 with those two slides?", "Replace slide 9, or insert after it?". Its
 * last sentence is a question with a change verb in it, about the deck. "Want
 * me to publish the deck to Drive?" is not one, and neither is a question about
 * the Word document.
 */
export function endsInDeckChangeQuestion(reply: string): boolean {
  const parts = String(reply || "").replace(/[*_`#>]/g, "").split(/(?<=[.!?])\s+|\n+/);
  let last = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].trim();
    if (t) { last = t; break; }
  }
  if (!/\?\s*$/.test(last) || !OFFER_VERB.test(last)) return false;
  if (DECK_NOUN.test(last)) return true;
  if (ARTEFACT_WORD.test(last)) return false;
  return DECK_NOUN.test(String(reply || ""));
}

/** The text of the most recent assistant message, or "". The route passes it
 *  so a bare "yes" can be read against the question it answers. */
export function lastAssistantReply(messages: { role: string; content?: unknown }[] | null | undefined): string {
  const ms = messages || [];
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m && m.role === "assistant" && typeof m.content === "string") return m.content;
  }
  return "";
}

function verbTargetAsks(s: string, x: { [k: string]: boolean }): boolean {
  const re = verbTargetRe(x);
  let rest = s;
  // Blocked when the deck is the source of another output; the rest of the
  // sentence may still ask for a real change ("... and update slide 3").
  for (let guard = 0; guard < 6 && rest; guard++) {
    const m = re.exec(rest);
    if (!m) return false;
    const after = rest.slice(m.index + m[0].length);
    if (x.noSourceBlock || !SOURCE_OF_OTHER.test(after)) return true;
    rest = after;
  }
  return false;
}

/**
 * The user's latest message asks for a deck to be built or changed. Quoted
 * spans are the deck's CONTENT, not the ask (the same rule the personal-data
 * routing applies). An approval asks for nothing. A short answer is an ask
 * only when the reply it answers ended by asking whether to change the deck. A
 * question about the deck ("what's on slide 9 now?") is not an ask, and a
 * request that USES the deck to make something else is not a deck change.
 *
 * `off` exists only for check 40's ablation: it switches single rules off so
 * the check can prove each one carries a case.
 */
export function asksForDeckChange(userMessage: string, o: { deckInConversation: boolean; lastAssistantText?: string }, off?: { [k: string]: boolean }): boolean {
  const x = off || {};
  const raw = String(userMessage || "");
  if (!x.noTemplate) {
    const cm = COMMENT_TEMPLATE.exec(raw);
    if (cm) {
      // A comment on one slide asks for a change unless every sentence of it
      // is a question or an approval: "is this 12% figure right?" asks nothing.
      const comment = (x.noStrip ? cm[1] : stripQuotedContent(cm[1])).trim();
      if (!comment || (!x.noApproval && APPROVAL_ONLY.test(comment))) return false;
      const cs = comment.split(/(?<=[.!?])\s+|\n+/);
      for (let i = 0; i < cs.length; i++) {
        const s = cs[i].trim();
        if (s && (x.noQuestionSkip || !isQuestion(s, x))) return true;
      }
      return false;
    }
  }
  const text = x.noStrip ? raw.trim() : stripQuotedContent(raw).trim();
  if (!text) return false;
  if (!x.noApproval && APPROVAL_ONLY.test(text)) return false;
  if (!x.noAnswer && text.length <= 80 && answerShape(text) && !NEGATIVE_ANSWER.test(text) && !isQuestion(text, x)
      && (x.noOfferCheck ? DECK_NOUN.test(o.lastAssistantText || "") || o.deckInConversation : endsInDeckChangeQuestion(o.lastAssistantText || ""))) {
    return true;
  }
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i].trim();
    if (!s) continue;
    if (!x.noQuestionSkip && isQuestion(s, x)) continue;   // "what's on slide 9 now?"
    if (!x.noOptionsSkip && OPTIONS_ONLY.test(s)) continue;
    for (let r = 0; r < ASK_RULES.length; r++) {
      const id = ASK_RULES[r].id;
      if (x[id]) continue;
      if (id === "verb-target") { if (verbTargetAsks(s, x)) return true; continue; }
      if (id === "how-about" && !o.deckInConversation) continue;
      if (ASK_RULES[r].re.test(s)) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------ the reply's claim
const PAST = "added|removed|replaced|updated|rebuilt|inserted|deleted|swapped|moved|changed|rewritten|rewrote|reordered|shifted|renumbered|restyled|redesigned|revised|edited|merged|dropped|applied|made|put|split|cut|fixed|corrected|redrawn|redrew|shortened|lengthened|tightened|trimmed|renamed|retitled|simplified|recoloured|recolored|highlighted|expanded|condensed|combined|reworked|redone|recreated|built|created|generated|converted|turned";
const GERUND = "adding|removing|replacing|updating|rebuilding|inserting|deleting|swapping|moving|changing|rewriting|reordering|shifting|restyling|redesigning|revising|editing|merging|dropping|applying|putting|splitting|cutting|fixing|correcting|redrawing|shortening|tightening|trimming|renaming|retitling|building|creating|generating|converting|turning";
const NOUN = "slides?|deck|presentation|preview|cover|title slide|closing slide";
const NUMS = "\\d+(?:\\s*(?:,|and|&|to|-)\\s*\\d+)*";
const NUMWORD = "\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const REF = `(?:(?:old|new|the)\\s+)?(?:slides?\\s+${NUMS}(?:'s)?|cover|title slide|closing slide)`;
// "Slide 9 is now out of date" judges a slide; it does not claim an edit.
const EVALUATIVE = "out of date|outdated|wrong|inaccurate|stale|misleading|incorrect|redundant|obsolete|too long|too dense|missing|fine|ok|okay|good|great|clear|clearer|better|stronger|weaker|busy|cluttered|consistent|accurate";
type Rule = { id: string; re: RegExp; wholeClauseNegation?: boolean };
/** Every rule carries at least one case alone in check 40's corpus (40b). */
export const CLAIM_RULES: Rule[] = [
  { id: "count", re: new RegExp(`\\b(?:deck|presentation)\\b[^.]{0,40}?\\b(?:is now|now has|now runs(?: to)?|now contains|now stands at|now at|comes to|is up to|runs to|is down to)\\s+(?:${NUMWORD})\\s+slides\\b|\\bnow\\s+(?:${NUMWORD})\\s+slides\\b|\\bis now\\s+(?:${NUMWORD})\\s+slides\\b|\\bbrings?\\s+the\\s+(?:deck|presentation)\\s+to\\s+\\d+\\s+slides\\b|\\bgets?\\s+(?:${NUMWORD})\\s+(?:new\\s+)?slides\\s+now\\b`) },
  { id: "ref-state", re: new RegExp(`\\b${REF}\\b[^.]{0,80}?\\b(?:(?:is|are|has been|have been|was|were)\\s+(?:now\\s+)?(?:gone|out(?!\\s+of)|done|in(?=\\s*(?:$|,|;|place|after|before|now|there))|${PAST})|(?:has|have)\\s+(?:now\\s+)?(?:been\\s+)?gone)\\b`) },
  { id: "ref-participle", re: new RegExp(`^${REF}(?:\\s+(?:title|photo|picture|image|subtitle|chart|layout|card|cards|body))?\\s*(?::|-)?\\s*(?:${PAST})\\b`) },
  { id: "ref-now", re: new RegExp(`\\b${REF}\\b[^.]{0,40}?\\bnow\\s+(?:reads?|shows?|says?|has|have|covers?|carr(?:y|ies)|opens?|sits?|contains?|includes?|holds?|uses?)\\b(?!\\s+(?:${EVALUATIVE})\\b)|\\b${REF}\\s+(?:is|are)\\s+now\\s+(?!(?:${EVALUATIVE})\\b)`) },
  { id: "slides-now", re: new RegExp(`\\bslides\\b[^.]{0,40}?\\bnow\\s+(?:sit|live|appear|come|cover|read|show|follow|open)\\b|\\b(?:new|two|three|both|the|updated|revised|corrected)\\s+(?:[a-z-]+\\s+){0,3}slides?(?:\\s+${NUMS})?\\s+(?:are|is)\\s+(?:now\\s+)?(?:in(?=\\s*(?:$|,|;|place|after|before|now|there))|added|in place|done|live|below|above|ready)\\b`) },
  { id: "first-person", re: new RegExp(`\\b(?:i|we)(?:'ve|\\s+have)?\\s+(?:now\\s+|just\\s+|also\\s+|(?:gone|went)\\s+ahead\\s+and\\s+)?(?:${PAST})\\b[^.]{0,80}?\\b(?:${NOUN})\\b`) },
  { id: "past-opener", re: new RegExp(`^(?:ok(?:ay)?|done|right|got it|sure|all set|all done|perfect)?[\\s,:!-]*(?:${PAST})\\b[^.]{0,80}?\\b(?:${NOUN})\\b`) },
  { id: "gerund-opener", re: new RegExp(`^(?:ok(?:ay)?|right|got it|sure)?[\\s,:!-]*(?:${GERUND})\\b[^.]{0,80}?\\b(?:${NOUN})\\b`), wholeClauseNegation: true },
  { id: "passive", re: new RegExp(`\\b(?:${NOUN})\\b[^.]{0,60}?(?:\\b(?:has|have)|'s|'ve)\\s+(?:now\\s+)?been\\s+(?:${PAST})\\b`) },
  { id: "replaced-by", re: new RegExp(`\\b(?:replaced|swapped)\\s+(?:by|with|for|out for)\\b[^.]{0,60}?\\bslides?\\b|\\bslides?\\b[^.]{0,60}?\\b(?:in its place|in their place|in place of|where slide \\d+ (?:was|used to be))\\b|\\bslides?\\s+(?:now\\s+)?replaces?\\b|\\bslides?\\s+(?:now\\s+)?(?:have|has)\\s+(?:now\\s+)?(?:replaced|taken\\s+(?:its|their|the)\\s+place)\\b`) },
  { id: "artefact-ready", re: new RegExp(`\\bhere(?:'s| is| are)\\s+(?:the|your)\\s+(?:(?:updated|revised|new|rebuilt|corrected|edited|finished)\\s+)?(?:deck|slides|preview|presentation)\\b(?!\\s+(?:outline|plan|structure))|\\b(?:(?:updated|revised|rebuilt|corrected|edited|refreshed|new)\\s+)?(?:deck|preview|presentation)\\b[^.]{0,30}?\\b(?:is|are)\\s+(?:now\\s+)?(?:ready|above|below|on screen|in place|there|updated|done)\\b|\\bhere(?:'s| is)\\s+(?:how|what)\\s+(?:the|your)\\s+(?:deck|presentation|slides?)\\s+(?:looks?|reads?)(?:\\s+like)?\\s+now\\b|\\b(?:deck|presentation)\\s+(?:now\\s+)?has\\s+(?:the\\s+)?(?:new|updated|revised|corrected)\\s+(?:[a-z-]+\\s+){0,3}slides?\\b`) },
  { id: "rest-unchanged", re: /\b(?:the rest of the deck|everything else|every other slide|all (?:the )?other slides|the other slides|the rest)\b\s*(?:is|are|stays?|remains?|was|were|has been|have been|left|kept)?\s*(?:exactly\s+)?(?:as\s+(?:it|they)\s+(?:was|were)|unchanged|untouched|as is)\b/ },
  // "Deck updated." "Changes are in - have a look at the preview." A claim with
  // no subject but the thing changed.
  { id: "bare-participle", re: new RegExp(`^(?:(?:the|your|all|those|these)\\s+)?(?:deck|presentation|slides|changes?|edits?|updates?)\\s*(?::|-)?\\s*(?:(?:are|is|have been|has been|were|was)\\s+)?(?:now\\s+)?(?:${PAST}|done|live|in(?=\\s*(?:$|,|;|-|and\\b|place|now|there)))\\b`) },
];
// A modal, an offer, a promise or a negation before the claim, in the same
// clause, makes it not a claim: "I can replace slide 9", "I'll replace slide 9
// now" (the promise is endsWithUnfulfilledPromise's job), "I couldn't replace
// slide 9". Scoped to the CLAUSE, not the sentence: "Nothing else was touched:
// slide 9 has been replaced" still claims.
export const NEGATORS = /\b(?:would|could|can|can't|cannot|shall|should|might|may|want me to|would you like|do you want|if you(?:'d)? (?:like|want|prefer)|happy to|i'd|i'll|i will|we'll|let me|going to|about to|propose|suggest|recommend|plan(?: is)? to|ready to|once you|when you|if we|if i|not|n't|never|no longer|nothing|none|unable|failed to)\b/;
// A condition anywhere before the claim, or after it in its clause, holds it
// back: "Before I change anything: slide 9 now has the old copy".
export const LEADS = /\b(?:before|until|unless|once|when|if)\s+(?:i|we|you)\b/;
// A hypothetical after the claim in its clause: "I've put together what the two
// new slides would say".
export const HYPOTHETICAL = /\b(?:would|could|might)\b/;
// An edit placed in the past of the conversation is not a claim about this turn.
export const TEMPORAL = /\b(?:already|earlier|previously|last time|last turn|originally|yesterday|since then|in (?:my|the|our) (?:previous|last|earlier|first) (?:turn|reply|message|version|edit|pass|round|answer)|(?:previous|last|earlier) (?:version|edit|turn|reply|message|change))\b/;
// ...but "the slides you sent earlier" and "the version in your last message"
// place the USER'S message in the past, not the edit.
const USER_MESSAGE_REF = /\b(?:in |from )?your (?:last|previous|earlier|first) (?:message|reply|note)\b|\byou (?:sent|shared|pasted|gave|wrote|posted|attached)(?: me)?(?: (?:earlier|previously|before|last time|yesterday))?\b/g;
// A claim joined to a follow-up question is still a claim: "I've replaced slide
// 9 with the two new slides - want me to publish it to Drive?"
const FOLLOW_UP = /(?:\s+-\s+|[,;:]\s+)(?:want me to|would you like|do you want|shall i|should i|anything else|is there anything|let me know|does (?:that|this|it) (?:look|work|read)|happy with|ready to|what next|ok\b|okay\b|sound good)[\s\S]*\?\s*$/;
const CLAUSE_BREAK = /\s+-\s+|[,;:]\s+|\s+but\s+/g;

/** The reply as lowercase sentences, markdown and bullets stripped, arrows
 *  read as "is now" ("Slide 9 → gone"). */
export function sentences(text: string): string[] {
  return String(text || "")
    .replace(/[*_`#>]/g, "")
    .replace(/[—–]/g, " - ")
    .replace(/[‘’]/g, "'")
    .replace(/\s*(?:→|->|=>)\s*/g, " is now ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^\s*(?:[-•✅✔☑️]+|\d+[.)])\s*/, "").trim().toLowerCase())
    .filter(Boolean);
}

export type ClaimOpts = {
  noTemporal?: boolean; noNegators?: boolean; noQuestion?: boolean; noFollowUp?: boolean;
  noUserRef?: boolean; noLeads?: boolean; noHypothetical?: boolean; sentenceScope?: boolean;
};

function negated(s: string, start: number, end: number, rule: Rule, opts: ClaimOpts): boolean {
  if (opts.sentenceScope) return !opts.noNegators && NEGATORS.test(rule.wholeClauseNegation ? s : s.slice(0, end));
  let cs = 0, ce = s.length;
  const re = new RegExp(CLAUSE_BREAK.source, "g");
  let b: RegExpExecArray | null;
  while ((b = re.exec(s))) {
    if (b.index + b[0].length <= start) cs = b.index + b[0].length;
    else if (b.index >= end) { ce = b.index; break; }
  }
  if (!opts.noNegators && NEGATORS.test(rule.wholeClauseNegation ? s.slice(cs, ce) : s.slice(cs, end))) return true;
  if (!opts.noLeads && (LEADS.test(s.slice(0, start)) || LEADS.test(s.slice(end, ce)))) return true;
  if (!opts.noHypothetical && HYPOTHETICAL.test(s.slice(end, ce))) return true;
  return false;
}

/** Every (sentence, rule) that claims a change. `rules` and `opts` exist for
 *  check 40's ablation; the product calls deckChangeClaim. */
export function claimingRules(text: string, rules: Rule[], opts?: ClaimOpts): { sentence: string; rule: string }[] {
  const o = opts || {};
  const out: { sentence: string; rule: string }[] = [];
  const ss = sentences(text);
  for (let i = 0; i < ss.length; i++) {
    let s = ss[i];
    if (/\?\s*$/.test(s) && !o.noQuestion) {
      const f = o.noFollowUp ? null : FOLLOW_UP.exec(s);
      if (!f) continue;
      s = s.slice(0, f.index);
    }
    if (!o.noTemporal && TEMPORAL.test(o.noUserRef ? s : s.replace(USER_MESSAGE_REF, " "))) continue;
    for (let p = 0; p < rules.length; p++) {
      const m = rules[p].re.exec(s);
      if (!m) continue;
      if (negated(s, m.index, m.index + m[0].length, rules[p], o)) continue;
      out.push({ sentence: s, rule: rules[p].id });
    }
  }
  return out;
}
/** The first sentence of `text` that says the deck was changed, or null. */
export function deckChangeClaim(text: string) { const a = claimingRules(text, CLAIM_RULES); return a.length ? a[0] : null; }

// ------------------------------------------------------------ turn-level guard

/** Tools that make a deliverable that is not the slides preview. A turn that
 *  called one has made something, and the reply describing it reads like a
 *  deck change whenever the deck was its source ("I've turned the deck into a
 *  Word document"), or IS a deck (generate_document builds a real .pptx). */
export const OTHER_DELIVERABLE_TOOLS = ["generate_document", "generate_word_document", "generate_chart", "generate_image", "generate_video"];
export function madeAnotherDeliverable(toolsUsed: { name: string; calls: number }[] | null | undefined): boolean {
  const used = toolsUsed || [];
  for (let i = 0; i < used.length; i++) {
    if (used[i] && used[i].calls > 0 && OTHER_DELIVERABLE_TOOLS.indexOf(used[i].name) >= 0) return true;
  }
  return false;
}

/** Model-directed, never shown. Pushed as a user-role message after the
 *  assistant's own text, for ONE extra round with tools still on. It points the
 *  model at the user's message rather than at its own reply, because the reply
 *  that claimed the change is the thing that was wrong. */
export const DECK_CLAIM_NUDGE =
  "SYSTEM NOTE (not from the user - never acknowledge or mention it): generate_slides was not called this turn, so nothing in the deck has changed - no slide was added, removed or edited - even though your reply above reads as if it had. The user's latest message asks for a change to the deck. Call generate_slides NOW to make exactly the change that message asks for (not the change your reply described, which may be wrong), and write nothing before the call: your reply is already on the user's screen. After the call succeeds, add at most one short sentence. If the request is genuinely unclear, ask the one question you need answered in a single sentence and call nothing; do not say whether the deck changed, because the user is told that separately.";

// User-facing. Both speak only about "this reply", so each is literally true
// whenever the gate holds, including when an earlier turn did make a change.
// With no deck in the conversation the ask may be a new deck OR an edit to one
// that lives elsewhere ("Update slide 3 of our Q3 deck in Drive"), so that
// notice says neither "there is no deck" nor which one was asked for.
export const DECK_NOT_CHANGED_NOTICE =
  "\n\n---\n\n⚠ **The deck was not changed.** No slides were added, removed or edited in this reply, so the deck on screen is as it was before your message. Ask again to make the change.";
export const NO_DECK_BUILT_NOTICE =
  "\n\n---\n\n⚠ **No deck was built or changed.** No slides were drawn in this reply, even if the reply above describes a deck. Ask again to make it.";
// The same fact, for a turn where generate_slides was never registered. Both
// notices above end "Ask again", which is the right advice exactly when asking
// again can work — and false advice when the switch is off, because the second
// ask reaches a turn with no builder in it either. It names the switch instead,
// from the one string the prompt also reads.
export const DECK_SWITCHED_OFF_NOTICE =
  `\n\n---\n\n⚠ **The deck was not changed.** No slides were added, removed or edited in this reply. Building and changing decks is switched off for this conversation — turn on ${GENERATION_CONTROL_CHAT_MD} and ask again.`;

export interface DeckClaimRetryInput {
  text: string; asked: boolean; turn: SlidesTurnState | null | undefined; offered: boolean;
  alreadyRetried: boolean; round: number; maxRounds: number; elapsedMs: number; budgetMs: number;
  /** The claiming round wrote text to replay as the assistant turn. */
  replayable: boolean;
  /** What ran this turn (toolLoopGuard.usage()). */
  toolsUsed: { name: string; calls: number }[] | null | undefined;
}
/**
 * One extra round, with tools on, for a turn that says the deck changed when
 * no call reached the builder. The text already streamed stays: it is on
 * screen, only ChatPanel can take text back, and if the retry's call succeeds
 * the narration becomes true.
 *
 * Not when generate_slides was not offered this round (a tainted Anthropic
 * round, imageGeneration off), not twice, not on the last round (nothing could
 * follow the call), not past the time budget (a retried deck with images takes
 * about a minute), not when another deliverable was made this turn, and not
 * when the claiming round wrote no text: the claim then came from an earlier
 * round, and replaying an EMPTY assistant turn is a request the Anthropic API
 * rejects, which would throw the turn into the provider fallback.
 */
export function shouldRetryDeckClaim(i: DeckClaimRetryInput): boolean {
  if (!i.asked || !i.offered || i.alreadyRetried || !i.replayable) return false;
  if (i.turn && i.turn.lastOutcome) return false;
  if (madeAnotherDeliverable(i.toolsUsed)) return false;
  if (i.round >= i.maxRounds - 1) return false;
  if (i.elapsedMs >= i.budgetMs) return false;
  return deckChangeClaim(i.text) !== null;
}
/**
 * The notice appended when the turn still ends on a claimed change with no call
 * — after the retry declined, asked a question or claimed again, or when no
 * retry was allowed. Deterministic text rather than more guidance to the
 * model: guidance to finish already existed, and it is what failed.
 * `alreadySaid` keeps it to one notice a turn.
 */
export function unmadeDeckChangeNotice(
  text: string, turn: SlidesTurnState | null | undefined,
  o: { asked: boolean; deckInConversation: boolean; alreadySaid: boolean; offered: boolean; toolsUsed: { name: string; calls: number }[] | null | undefined }
): string {
  if (o.alreadySaid || !o.asked) return "";
  if (turn && turn.lastOutcome) return "";
  if (madeAnotherDeliverable(o.toolsUsed)) return "";
  if (!deckChangeClaim(text)) return "";
  // `offered` is the same question shouldRetryDeckClaim asks, put to the
  // notice: was generate_slides in this turn's tool array at all? The retry
  // gate has always read it — a turn with no builder cannot be made to call
  // one — while the notice did not, and closed on "Ask again to make the
  // change" whatever the answer was. With the capability switched off, asking
  // again reaches another turn with no builder, so that sentence sent the user
  // round the loop that made them leave in the first place.
  //
  // Read off the REGISTERED tool array and not off the taint, unlike the retry
  // gate's own `offered`: a tainted turn refuses the call for this turn only,
  // so "ask again" is exactly right there and naming a switch would be the
  // wrong advice. The switch is the only thing that survives the turn.
  if (!o.offered) return DECK_SWITCHED_OFF_NOTICE;
  return o.deckInConversation ? DECK_NOT_CHANGED_NOTICE : NO_DECK_BUILT_NOTICE;
}
