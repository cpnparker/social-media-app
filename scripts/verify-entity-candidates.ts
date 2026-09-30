/**
 * Candidate extraction, tested against the conversation that caused it.
 *
 * The first version passed a hand-written test and failed the real message
 * twice: it captured "From Ollie Cann" including the quote's opening word, and
 * it found NOTHING in "winning the Iffim contract" — one capitalised token
 * matches neither the two-word proper-name rule nor the all-caps acronym rule.
 * The extractor missed the exact term the feature is named after.
 *
 * So every case here is a real sentence from that chat or from ordinary use.
 * A synthetic fixture would have gone on passing.
 */
import { extractCandidates } from "../lib/entities/candidates";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);
const texts = (msg: string) => extractCandidates(msg).map((c) => c.text.toLowerCase());

const wants = (label: string, msg: string, expected: string[]) => {
  const got = texts(msg);
  const missing = expected.filter((e) => !got.includes(e.toLowerCase()));
  missing.length
    ? fail(`${label} — missed ${missing.join(", ")} (got: ${got.join(", ") || "nothing"})`)
    : pass(`${label} → ${expected.join(", ")}`);
};
const rejects = (label: string, msg: string, unwanted: string[]) => {
  const got = texts(msg);
  const present = unwanted.filter((u) => got.includes(u.toLowerCase()));
  present.length ? fail(`${label} — wrongly captured ${present.join(", ")}`) : pass(label);
};

console.log("\n1. The messages from the chat that prompted this");
wants("the congratulation note", `From Ollie Cann: "Congrats to you! Tough field in the end-Portman, another big agency"`, ["Ollie Cann", "Portman"]);
rejects("…without swallowing the quote's opening word", `From Ollie Cann: "Congrats"`, ["From Ollie Cann"]);
wants("the follow-up naming the client", "that was in reference to winning the Iffim contract. check emails to see", ["Iffim"]);
wants("the sender the user had to supply", "how about the email from Carol?", ["Carol"]);

console.log("\n2. Shapes that must resolve");
wants("an address", "can you check bob.smith@gavi.org for me", ["bob.smith@gavi.org"]);
wants("a bare domain", "anything from zhinst.com this week?", ["zhinst.com"]);
wants("an all-caps acronym", "what did GAVI say?", ["GAVI"]);
wants("two capitalised words", "prep me for Zurich Instruments", ["Zurich Instruments"]);

console.log("\n3. Ordinary language must not become a lookup storm");
rejects("sentence openers", "Can you write a post? Please keep it short. Thanks!", ["Can", "Please", "Thanks"]);
rejects("weekdays and months", "are we free on Tuesday in September?", ["Tuesday", "September"]);
rejects("the product's own name", "what can EngineAI do with Slack?", ["EngineAI", "Slack"]);
const plain = texts("can you write a blog post about our new service");
plain.length === 0 ? pass("a plain request yields no candidates at all") : fail(`plain request yielded ${plain.join(", ")}`);

console.log("\n4. Pasted third-party text is not mined for identities");
const pasted = "x".repeat(9000) + " Ollie Cann";
extractCandidates(pasted).length === 0 || !texts(pasted).includes("ollie cann")
  ? pass("a very long paste is truncated before names are taken from its tail")
  : fail("names are being lifted from pasted content");

console.log("\n5. The cap holds");
// Real name-shaped words: a fixture with digits matched nothing and made
// the cap test pass vacuously.
const many = Array.from({ length: 40 }, (_, i) => `Alpha Bravo${String.fromCharCode(97 + (i % 26))}`).join(", ");
extractCandidates(many).length <= 12
  ? pass(`capped at ${extractCandidates(many).length}`)
  : fail(`returned ${extractCandidates(many).length} candidates`);

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
