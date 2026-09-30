/**
 * What in this message might be a person, an organisation or an engagement?
 *
 * WHY THIS IS NOT A TOOL. system-prompts.ts already instructs the model: "If
 * the user mentions a product, tool, initiative, or name that sounds internal
 * and isn't covered above, search MeetingBrain meetings and memory FIRST …
 * before web-searching it or concluding it's unknown." It was told, and it did
 * not comply — it searched once for "Ollie Cann", missed, and asked the user
 * what to try next. Resolution that depends on the model choosing to resolve
 * has already been tried here and failed. This runs every turn, before the
 * model sees anything.
 *
 * WHERE CANDIDATES MAY COME FROM. The USER'S OWN MESSAGE, and nothing else.
 * Never an email body, never a transcript, never a calendar description. Those
 * are written by people outside this workspace, and a name lifted from one is
 * an attacker's choice of what we go and look up. The database refuses to
 * learn an identity from anything but a structural field; this refuses to even
 * ask the question.
 */

/** Words that are capitalised mid-sentence but are not names. Deliberately
 *  short: the resolver returns nothing for an unknown candidate, so a false
 *  candidate costs one indexed lookup, while a missing one costs the failure
 *  this exists to fix. */
const STOPWORDS = new Set([
  "I", "I'm", "I've", "The", "This", "That", "These", "Those", "A", "An",
  "We", "We're", "Our", "You", "Your", "It", "Its", "If", "But", "And", "Or",
  "Can", "Could", "Would", "Should", "Please", "Thanks", "Hi", "Hello", "Hey",
  "What", "When", "Where", "Who", "Why", "How", "Is", "Are", "Was", "Were",
  "Do", "Does", "Did", "Have", "Has", "Had", "Will", "Let", "Let's", "No", "Yes",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "AI", "EngineAI", "Engine", "Slack", "Gmail", "Google", "Teams", "Outlook",
  // Email furniture. "From Ollie Cann" was captured whole because a quoted
  // message opens with a capitalised "From", which reads to a regex exactly
  // like a first name.
  "From", "To", "Cc", "Bcc", "Re", "Fwd", "Subject", "Sent", "Dear", "Regards",
  "Congrats", "Congratulations", "Thank",
]);

export interface Candidate {
  text: string;
  /** How it was spotted. `email` and `domain` are exact keys; the rest are
   *  looked up through the alias index and may legitimately miss. */
  kind: "email" | "domain" | "proper_name" | "acronym";
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
// Two or more capitalised words: "Ollie Cann", "Zurich Instruments".
const PROPER_RE = /\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+\b/g;
// All-caps, or caps with a lowercase tail: "GAVI", "IFFIm", "TCE".
const ACRONYM_RE = /\b[A-Z]{2,6}[a-z]{0,3}\b/g;
/**
 * ONE capitalised word, mid-sentence.
 *
 * Added because the case this module exists for did not match anything else.
 * "winning the Iffim contract" is a single capitalised token: not two words, so
 * not a proper name, and only one capital, so not an acronym. The extractor
 * returned nothing for the exact term the feature is named after.
 *
 * Mid-sentence only — a capital after a full stop is just a sentence starting,
 * and treating those as candidates would make every message a lookup storm. A
 * false candidate costs one indexed miss; the missing one cost the incident.
 */
const SOLO_RE = /(?<![.!?]\s|^)\b[A-Z][A-Za-z'’-]{2,}\b/g;

/** Trim leading and trailing stopwords off a matched phrase. The raw regex
 *  captured "From Ollie Cann" — "From" is capitalised because it opened the
 *  quote, not because it is part of anyone's name. */
function trimStopwords(phrase: string): string {
  const words = phrase.split(/\s+/);
  while (words.length && STOPWORDS.has(words[0])) words.shift();
  while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * Candidates from one message, deduplicated and capped.
 *
 * The cap matters: this feeds an indexed lookup per candidate on every turn,
 * and a pasted document could otherwise carry hundreds. Twelve covers any real
 * sentence; beyond that the user is pasting, and pasted text is exactly the
 * content this must not mine.
 */
export function extractCandidates(userMessage: string, max = 12): Candidate[] {
  if (!userMessage || userMessage.length > 8000) {
    // A very long message is a paste, not a question. Resolving names out of
    // pasted third-party text is the boundary this module exists to hold.
    userMessage = (userMessage || "").slice(0, 8000);
  }
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const push = (text: string, kind: Candidate["kind"]) => {
    const t = text.trim();
    const key = `${kind}:${t.toLowerCase()}`;
    if (!t || seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push({ text: t, kind });
  };

  for (const m of userMessage.match(EMAIL_RE) || []) push(m, "email");
  // Domains only when not already inside a captured address.
  // Array, not a Set spread: scripts/ and lib/ are type-checked by `next
  // build`, whose target predates ES2015 iteration helpers. Local tsc accepts
  // the spread; the build does not. See CLAUDE.md.
  const emails = (userMessage.match(EMAIL_RE) || []).map((e) => e.toLowerCase());
  for (const m of userMessage.match(DOMAIN_RE) || []) {
    if (emails.some((e) => e.endsWith(m.toLowerCase()))) continue;
    push(m, "domain");
  }
  const claimed: string[] = [];
  for (const m of userMessage.match(PROPER_RE) || []) {
    const t = trimStopwords(m);
    if (!t || !t.includes(" ")) {
      // Trimming can leave a single word ("From Ollie" -> "Ollie"); that is a
      // solo candidate, not a proper name, and SOLO_RE will pick it up.
      if (t) claimed.push(t.toLowerCase());
      continue;
    }
    claimed.push(t.toLowerCase());
    push(t, "proper_name");
  }
  for (const m of userMessage.match(ACRONYM_RE) || []) {
    if (STOPWORDS.has(m)) continue;
    claimed.push(m.toLowerCase());
    push(m, "acronym");
  }
  for (const m of userMessage.match(SOLO_RE) || []) {
    if (STOPWORDS.has(m)) continue;
    // Skip anything already inside a longer phrase we captured — "Ollie" on its
    // own adds nothing when "Ollie Cann" is already a candidate.
    if (claimed.some((c) => c === m.toLowerCase() || c.split(" ").indexOf(m.toLowerCase()) >= 0)) continue;
    push(m, "proper_name");
  }
  return out;
}
