/**
 * An uploaded file must never reach the model as silence.
 *
 * The failure being guarded: a 1.3MB presentation PDF was uploaded, text
 * extraction returned an empty string (a deck whose slides are images parses
 * fine and yields nothing), the turn had been auto-routed to a chain with no
 * native PDF support, and the builder skipped the block. The model received
 * "can you look over this presentation thoroughly" with no presentation, and —
 * having no way to know a file had been sent — replied that the PDF was not in
 * the shared Drive and asked for it to be shared with a service account.
 *
 * Three separate defects had to line up, so this checks all three.
 */
import { readFileSync } from "fs";
import { routeModel } from "../lib/ai/auto-router";

const src = readFileSync("lib/ai/providers.ts", "utf8");
const route = readFileSync("app/api/ai/conversations/[id]/messages/route.ts", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. A document attachment routes to a model that can actually read it");
const withDoc = routeModel("can you look over this presentation thoroughly", [], { hasDocumentAttachment: true });
withDoc.startsWith("claude")
  ? pass(`document attached → ${withDoc}`)
  : fail(`document attached → ${withDoc}, which cannot open a PDF`);
const withoutDoc = routeModel("can you look over this presentation thoroughly", []);
pass(`same text, no attachment → ${withoutDoc} (unchanged routing)`);
withDoc !== withoutDoc
  ? pass("the attachment is what changes the decision, not the wording")
  : fail("routing ignores the attachment");

console.log("\n2. An image attachment must NOT force the heavy model");
const withImg = routeModel("what is in this photo", [], { hasDocumentAttachment: false });
withImg === withoutDoc ? pass(`image-only → ${withImg}`) : fail(`image-only → ${withImg}`);

console.log("\n3. Every builder reports what it could not read");
for (const chain of ["Anthropic", "OpenAI", "XAI"]) {
  const fn = src.match(new RegExp(`async function build${chain}Content[\\s\\S]*?\\n}\\n`))?.[0] || "";
  fn.includes("unreadableAttachmentNote")
    ? pass(`build${chain}Content emits a note instead of dropping the file`)
    : fail(`build${chain}Content can still drop an attachment silently`);
}

console.log("\n4. The note tells the model the truth about what happened");
const note = src.match(/function unreadableAttachmentNote[\s\S]*?\n}/)?.[0] || "";
/DID attach/.test(note)
  ? pass("states the file WAS provided")
  : fail("does not tell the model the file was provided");
/not say it was not provided|do NOT say it was not provided/i.test(note)
  ? pass("forbids the \"you didn't give me it\" answer that was actually produced")
  : fail("does not forbid claiming the file is missing");
/share it\s*\n?\s*somewhere else|share it/i.test(note)
  ? pass("forbids redirecting the user to Drive or a paste")
  : fail("does not forbid the share-it-elsewhere suggestion");

console.log("\n5. An empty extraction is not passed off as content");
/parsed but contains no extractable text/.test(route)
  ? pass("an image-only PDF is recorded as unextractable, not as empty text")
  : fail("an empty extraction can still be returned as though it were text");
/\.trim\(\)\s*\|\|\s*undefined/.test(route)
  ? pass("whitespace-only extractions collapse to undefined")
  : fail("a whitespace-only extraction would still read as truthy");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
