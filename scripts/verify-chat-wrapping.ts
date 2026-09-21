/**
 * Guards the one thing a conversation must never do: scroll sideways.
 *
 * Run: npx tsx scripts/verify-chat-wrapping.ts
 *      npx tsx scripts/verify-chat-wrapping.ts --self-test
 *
 * ── WHY THIS IS A BROWSER AND NOT A REGEX ───────────────────────────────────
 *
 * Chris pasted a booking URL into a thread and the whole conversation grew a
 * horizontal scrollbar. Measured in his browser, on the live thread:
 *
 *     document.documentElement   scrollWidth 1398 === clientWidth 1398
 *     p.whitespace-pre-wrap      clientWidth  566   scrollWidth 1473   +907
 *     div.rounded-xl.max-w-[85%] clientWidth  598   scrollWidth 1489   min-width: auto
 *     div.max-w-[46rem]          clientWidth  736   scrollWidth 1571
 *     div.flex-1.overflow-y-auto clientWidth 1031   scrollWidth 1718   overflow-x: auto
 *
 * The page did not scroll; the MESSAGE LIST did, and it took every other
 * message sideways with it. Three separate things had to be true at once for
 * that: nothing in the prose CSS allowed the URL to break, the bubble is a
 * flex item and so is floored at its min-content width, and the list was the
 * nearest box willing to scroll. No stylesheet read can tell you that. It is
 * a question about a DOM at a width, so this check builds the DOM, puts the
 * real compiled stylesheet on it, and measures it at four widths.
 *
 * Everything here is EXTRACTED, never copied:
 *   · the class strings come out of the components that ship them, so a
 *     dropped `min-w-0` or `break-anywhere` fails this check rather than
 *     quietly passing against a stale copy;
 *   · the CSS is app/globals.css compiled through the project's own Tailwind;
 *   · the assistant HTML is the real pipeline — parseSourcesFromContent →
 *     formatMarkdown → DOMPurify (the real bundle, run in the page, with the
 *     ADD_ATTR list read out of MessageBubble).
 *   · the user side is the real splitter too — `<UserText>` maps the same
 *     pieces onto React nodes, and the anchor's class is read out of the
 *     component so the two cannot drift apart unnoticed.
 * A hand-written approximation of that output would only prove the
 * approximation wraps.
 *
 * BOTH SIDES are measured every time. They are rendered by different
 * machinery — the model's text becomes HTML and is sanitised, the user's
 * stays a tree of React nodes — and for one commit they broke the same URL
 * in different places: the model's copy at its separators, the paste it was
 * quoting inside the hostname.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * --self-test re-breaks the fix in memory and refuses to report anything
 * unless each mutation turns this check red. Nothing is written to the tree.
 *
 * KILLED   the shipped bug: no wrap rule anywhere (prose overflows on both
 *          sides at every width)
 * SURVIVED min-w-0 dropped from the user bubble. Written down beforehand as
 *          a kill and measured as a survivor, which corrects the diagnosis:
 *          the bubble in the bug report was at 598px, and 598 is exactly 85%
 *          of the row's 704px content box. It was at its max-width, NOT at a
 *          min-content floor — css-flexbox-1 §4.5 clamps the automatic
 *          minimum size by the max main size. The text simply overflowed the
 *          bubble. min-w-0 is kept as defence for a bubble that loses its
 *          cap; it is not what fixed this.
 * SURVIVED `overflow-wrap: break-word` in place of `anywhere` — same reason.
 *          The one thing `anywhere` adds is a min-content width of one
 *          character, and with a max-width on every bubble that measurement
 *          never decides anything here.
 * KILLED   `word-break: break-all` instead of `overflow-wrap: anywhere` —
 *          caught by the ordinary paragraph, which starts breaking mid-word,
 *          and by the hostname detector written for another mutation
 * KILLED   the bare-URL pass reaching inside <pre> again. This one SHIPPED:
 *          the guard was missing for a commit, and the check passed anyway
 *          because section 5 asked the code block for its computed
 *          overflow-wrap and got "normal". It was telling the truth and
 *          answering the wrong question — <wbr> is a break opportunity under
 *          `white-space: pre` as well, so a one-line command was DISPLAYED
 *          over three lines while pre.textContent stayed 94 characters.
 *          Copying it gave the right command; reading it gave the wrong one.
 *          Section 5 now counts the lines on screen against the lines in the
 *          fixture's source, which is the only form of the question a reader
 *          would recognise.
 * KILLED   the link styling scoped back under .ai-response. The user's bubble
 *          is not inside one, so the class matched no rule and the URL
 *          painted as ordinary body text — clickable and invisible, which is
 *          the worse half of the two failures. The geometry is identical, so
 *          nothing that measures a width can see it; section 7 asks the
 *          rendering for its colour and its underline instead.
 * KILLED   the link treatment removed from the user's own message. Nothing
 *          overflows and nothing scrolls — the prose rule still wraps it —
 *          so every overflow detector stays silent while the URL breaks
 *          inside the hostname. The surface the bug was reported from is the
 *          one that needed its own detector.
 * KILLED   overflow-x dropped from .ai-code-block. Not by an overflow — the
 *          .ai-code-wrap around it clips, so the conversation stays the right
 *          width and the END OF THE COMMAND silently disappears. Caught by
 *          asking whether the frame can still be scrolled to it, which is
 *          why that detector measures scrollLeft rather than a computed
 *          overflow-x.
 * KILLED   overflow-x dropped from .ai-table-wrap. Nothing clips the table,
 *          so this one does push the whole conversation (641px) as well as
 *          putting the last columns out of reach.
 * NOT TESTABLE HERE  whether either frame SHOWS that it scrolls while it is
 *          sitting still. Headless Chrome draws no scrollbars in any mode, and
 *          reports a 0 gutter for a plain `overflow-x: auto` div just as
 *          readily as for these two — so the 0 that looks like evidence of an
 *          overlay bar is the harness. Section 5 prints the numbers with that
 *          control beside them and asserts nothing on them.
 * SURVIVED overflow-x-hidden removed from the message list. Honest result, and
 *          it is the point of section 6: with the prose fixed there is
 *          nothing left to overflow, so the clip changes no measurement. It
 *          is a guard against the NEXT unbreakable thing, not the fix.
 * KILLED   <wbr> removed from bare URLs. Written down beforehand as an
 *          expected survivor and measured as a kill: Chrome offers a break
 *          after "/" by itself, but not inside a percent-escape, so the
 *          227-character fixture gained one break mid-escape at 375px. The
 *          offered breaks are the readable ones and they cost nothing —
 *          <wbr> adds no character to the copied text (section 7).
 */
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { formatMarkdown, parseSourcesFromContent, splitLinkedText, urlPieces } from "../lib/ai/chat-markdown";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/* ─── The markup under test, lifted out of the components ─────────────────── */

/** One capture, or a loud failure. A check that quietly matched nothing is the
 *  sibling failure to a check that asserts a line exists: it tests NOTHING and
 *  reads as a pass. */
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
const SHELL = "app/engineai/page.tsx";

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
const proseCls = captureOnce(
  BUBBLE,
  /\{content \? <p className="([^"]+)"><UserText text=\{content\} \/><\/p> : null\}/,
  "the user bubble's paragraph"
);
/** The user side renders React nodes rather than HTML, so the harness has to
 *  build the same anchor the component does. Reading its class and rel out of
 *  the component is what stops the two drifting apart unnoticed. */
const userLinkCls = captureOnce(
  BUBBLE,
  /href=\{piece\.url\}[\s\S]{0,80}?className="([^"]+)"/,
  "the link in a user's own message"
);
const addAttr = captureOnce(
  BUBBLE,
  /ADD_ATTR: \[([^\]]*)\]/,
  "the sanitiser's allowed attributes"
);
const listCls = captureOnce(
  PANEL,
  /<div ref=\{scrollContainerRef\} className="([^"]+)">/,
  "the message list"
);
const columnCls = captureOnce(
  PANEL,
  /<div className="(py-4 space-y-1[^"]*)">/,
  "the 46rem column"
);
const mainCls = captureOnce(
  SHELL,
  /─── Main content area ───[\s\S]{0,80}?<div className="([^"]+)">/,
  "the shell's main content area"
);
const chatViewCls = captureOnce(
  SHELL,
  /─── Chat view ───[\s\S]{0,60}?<div className="([^"]+)">/,
  "the shell's chat view"
);

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

const LONG_URL =
  "https://booking.thecontentengine.com/schedule/discovery-call-with-the-content-engine" +
  "?utm_source=engine-ai&utm_medium=chat&utm_campaign=q3-2026-advisory-programme" +
  "&ref=a7f3c9e1b2d4&slot=2026-09-24T09%3A30%3A00Z&tz=Europe%2FZurich";
/** The reported case. Chris's thread measured a 1473px token inside a 566px
 *  paragraph, which means ~190 characters with no break opportunity in them:
 *  a signed link. Our own Vercel Blob URLs are shaped exactly like this, and
 *  so is every calendar link with a token in it. The URL above breaks at its
 *  hyphens all by itself and so CANNOT reproduce the bug at a desk width —
 *  that is the whole reason this one exists beside it. */
const OPAQUE_URL =
  "https://vfs8kq2xpz1ltmnr.public.blob.vercel-storage.com/" +
  "bookings/7f3c9e1b2d4a5c08e1f29f3c1a77b2e4d05af61c8390bb27de45a0f1c6e839d24b7a5c08e1f2aa91" +
  "0c4e7d1b6f83a25c9e0d4b7f1a86c3e5d92b04f7a1c8e6d3b5f09a2c7e4d1b8f6a3c5e0d9b2f7a4c1e8";
const LONG_HASH = "9f3c1a77b2e4d05af61c8390bb27de45a0f1c6e839d24b7a5c08e1f2";

interface Fixture {
  key: string;
  what: string;
  /** Plain text, as a user types it. */
  user: string;
  /** Markdown, as the model writes it. */
  ai: string;
  /** Long tokens are expected to break; ordinary prose is not. */
  midWordBreaksAllowed: boolean;
}

const FIXTURES: Fixture[] = [
  {
    key: "url-200",
    what: `a ${LONG_URL.length}-character URL`,
    user: `can you look at this ${LONG_URL} and tell me what you think`,
    ai: `Here is the booking link you asked about: ${LONG_URL} — it carries the campaign parameters.`,
    midWordBreaksAllowed: true,
  },
  {
    key: "url-opaque",
    what: `a ${OPAQUE_URL.length}-character URL with nothing in it to break on`,
    user: `here is the file ${OPAQUE_URL} have a look`,
    ai: `The file is at ${OPAQUE_URL} — it is a signed link, so it expires.`,
    midWordBreaksAllowed: true,
  },
  {
    key: "hash-60",
    what: "a 60-character unbroken hash",
    user: `the deploy is ${LONG_HASH} if that helps`,
    ai: `The deployment hash is ${LONG_HASH} and it matches the served asset.`,
    midWordBreaksAllowed: true,
  },
  {
    key: "md-link",
    what: "a long URL inside a markdown link with short text",
    // Plain text on the user side on purpose: the markdown link is the
    // model's, and the user's line must carry no long token, or "no word
    // broken" would be measuring the URL the user typed.
    user: "can you put the booking link in the draft please",
    ai: `You can [book a call](${LONG_URL}) whenever suits.`,
    midWordBreaksAllowed: false,
  },
  {
    key: "code",
    what: "a code block with long lines",
    user: "run the long command below",
    ai:
      "Run this:\n\n```bash\n" +
      "npx vercel deploy --prod --scope the-content-engine --build-env NEXT_PUBLIC_APP_URL=https://ai.thecontentengine.com --build-env ANALYZE=false --yes\n" +
      "```\n\nThen check the served asset.",
    midWordBreaksAllowed: false,
  },
  {
    key: "table",
    what: "a wide table",
    user: "show me the table",
    ai:
      "| Client | Commissioned | Delivered | Written off | Balance | Renewal | Owner |\n" +
      "| --- | --- | --- | --- | --- | --- | --- |\n" +
      "| Siemens Infrastructure Transition Monitor | 109.84 | 69.10 | 40.74 | 0.00 | 2027-01-01 | Chris |\n" +
      "| CPI Retired Content Units | 88.20 | 58.52 | 29.68 | 0.00 | 2026-12-01 | Chris |\n",
    midWordBreaksAllowed: false,
  },
  {
    key: "cjk",
    what: "CJK text",
    user: "请看这个链接并告诉我你的想法，这是我们下个季度的内容计划的第一稿，需要你的意见。",
    ai: "这是下个季度的内容计划的第一稿。我们会在下周确认最终版本，并在确认后发布到网站上。",
    midWordBreaksAllowed: true,
  },
  {
    key: "prose",
    what: "an ordinary paragraph that must not start breaking mid-word",
    user:
      "Could you take another look at the internationalisation of the onboarding sequence? " +
      "The Zurich team think the acknowledgement copy reads as unnecessarily bureaucratic.",
    ai:
      "The internationalisation work on the onboarding sequence is largely complete. " +
      "The acknowledgement copy is the outstanding piece, and the Zurich team are right that it reads bureaucratically.",
    midWordBreaksAllowed: false,
  },
];

/** The characters after which a break reads as deliberate. A line that ends
 *  on one of these looks like the URL was folded; a line that ends anywhere
 *  else looks like the URL was cut. */
const SEP = "/?#=&-_.";

/** The hostname inside OPAQUE_URL. A break inside it is the break that
 *  matters — it is the only part of a URL a reader can check before
 *  clicking — and a break at one of its own dots or hyphens is not one:
 *  "vercel-|storage.com" still reads as the host it is. */
const OPAQUE_HOST = OPAQUE_URL.replace(/^https?:\/\//, "").split("/")[0];

function inHostBreaks(l: any): number {
  if (!l) return 0;
  const start = l.text.indexOf(OPAQUE_HOST);
  if (start < 0) return 0;
  const end = start + OPAQUE_HOST.length - 1;
  let n = 0;
  for (let i = 0; i < l.breakAt.length; i++) {
    const at = l.breakAt[i];
    if (at < start || at >= end) continue;
    if (SEP.indexOf(l.breaks[i]) >= 0) continue;
    n++;
  }
  return n;
}

function fixtureIdx(key: string): number {
  for (let i = 0; i < FIXTURES.length; i++) if (FIXTURES[i].key === key) return i;
  console.log(`\n✗ cannot run: no "${key}" fixture.\n`);
  process.exit(1);
}
const codeFixtureIdx = fixtureIdx("code");

/* ─── Secondary surfaces ──────────────────────────────────────────────────── */

/** Every other place chat-like prose renders. Registered by the same
 *  extract-from-source rule: the class string comes out of the file, so this
 *  goes red if the wrap is dropped there. `flexRow` marks the ones that are
 *  themselves a flex item, which is where min-content width decides whether
 *  the element can shrink at all. */
interface Surface { label: string; file: string; re: RegExp; flexRow: boolean; }

const SURFACES: Surface[] = [
  { label: "optimiser discuss — user bubble", file: "components/optimizer/DiscussPanel.tsx",
    re: /<p className="(max-w-\[85%\] rounded-xl[^"]+)">/, flexRow: true },
  { label: "optimiser discuss — model reply", file: "components/optimizer/DiscussPanel.tsx",
    re: /<p className="(text-\[12\.5px\] leading-relaxed whitespace-pre-wrap[^"]*)">\{text\}<\/p>/, flexRow: false },
  { label: "optimiser discuss — draft block", file: "components/optimizer/DiscussPanel.tsx",
    re: /<p className="(px-2\.5 py-2 text-\[12\.5px\][^"]+)">\{body\}<\/p>/, flexRow: false },
  { label: "design chat — user bubble", file: "components/design-mode/DesignChat.tsx",
    re: /<div className="(max-w-\[85%\] rounded-2xl rounded-br-md[^"]+)">/, flexRow: true },
  { label: "design chat — model reply", file: "components/design-mode/DesignChat.tsx",
    re: /className="(ai-prose[^"]*)"/, flexRow: false },
  { label: "design rail — bubble", file: "components/design-mode/ai-rail/AIRailSide.tsx",
    re: /className="(rounded-2xl rounded-tl-md border[^"]+)"/, flexRow: false },
  { label: "notebook — saved clip", file: "components/notebook/NotebookPanel.tsx",
    re: /className="(flex-1 min-w-0 text-\[13px\][^"]+)"/, flexRow: true },
  { label: "optimiser score — drafted block", file: "components/optimizer/ScorePanel.tsx",
    re: /className="(px-2 py-1\.5 text-\[11\.5px\][^"]+)"/, flexRow: false },
  { label: "optimiser coverage — parametric answer", file: "components/optimizer/CoveragePanel.tsx",
    re: /className="(text-\[11\.5px\] text-muted-foreground\/80[^"]+)"/, flexRow: false },
  { label: "page-audit card — finding", file: "components/ai-writer/PageAuditCard.tsx",
    re: /<span className="(flex-1 min-w-0 break-anywhere)">\n              <span className="block text-\[12\.5px\] font-medium/, flexRow: true },
  { label: "content-score card — move", file: "components/ai-writer/ContentScoreCard.tsx",
    re: /<span className="(flex-1 min-w-0 break-anywhere)">/, flexRow: true },
  { label: "scheduled proposal — the prompt", file: "components/ai-writer/ScheduledProposalCard.tsx",
    re: /<p className="(text-xs text-muted-foreground\/80 mt-1\.5[^"]+)">\{proposal\.prompt\}<\/p>/, flexRow: false },
  { label: "memory manager — summary", file: "components/ai-writer/MemoryManager.tsx",
    re: /<p className="(text-sm leading-relaxed whitespace-pre-wrap[^"]*)">/, flexRow: false },
  { label: "promo drafts — draft body", file: "components/content/PromoDraftsSection.tsx",
    re: /<p className="(text-xs leading-relaxed text-foreground\/90[^"]+)">/, flexRow: false },
  { label: "post preview — LinkedIn", file: "components/post-detail/LinkedInPreview.tsx",
    re: /<p className="(text-sm leading-\[1\.4\][^"]+)">/, flexRow: false },
  { label: "post preview — X", file: "components/post-detail/TwitterPreview.tsx",
    re: /<p className="(text-\[15px\] leading-\[20px\][^"]+)">/, flexRow: false },
  // These two were missed by the first sweep and the audit that followed it
  // described them as structured values. They are free text — a client's
  // context and brief, which is exactly where a URL gets pasted.
  { label: "client context — linked meetings", file: "components/ai-writer/ClientContextDialog.tsx",
    re: /className="(rounded-md border bg-blue-50\/50[^"]+)"/, flexRow: false },
  { label: "client context — generated context", file: "components/ai-writer/ClientContextDialog.tsx",
    re: /className="(rounded-md border bg-muted\/30 p-4[^"]+)"/, flexRow: false },
];

/* ─── The page ────────────────────────────────────────────────────────────── */

interface Mutation {
  css?: (css: string) => string;
  cls?: (cls: string) => string;
  html?: (html: string) => string;
  /** The user's own message, as inner HTML. Separate from `html` because the
   *  two sides are rendered by different machinery — React nodes here, a
   *  sanitised string there — and a mutation usually means one of them. */
  user?: (text: string) => string;
}
const NONE: Mutation = {};

const apply = (f: ((s: string) => string) | undefined, s: string) => (f ? f(s) : s);

/** Undo exactly what this commit added to a class string — and nothing else.
 *  The assistant bubble already carried min-w-0 before it, so a mutation that
 *  stripped every min-w-0 would be testing a bug that never existed. */
function stripAdded(cl: string): string {
  let out = cl;
  if (out.indexOf("max-w-[85%]") === 0) out = out.split(" min-w-0").join("");
  return out.split(" overflow-x-hidden").join("").split(" break-anywhere").join("");
}

/** The assistant side, through the real pipeline. Sanitising happens in the
 *  page, with the real bundle — so <wbr> either survives DOMPurify or this
 *  check says so. */
function aiHtml(md: string, mut: Mutation): string {
  const parsed = parseSourcesFromContent(md);
  return apply(mut.html, formatMarkdown(parsed.cleanContent, parsed.sources));
}

/** The user side, through the real splitter. `<UserText>` maps these same
 *  pieces onto React nodes; this renders them as the markup React produces,
 *  so what the check measures is what the component paints. The escaping is
 *  React's job in the component and this function's job here — which is why
 *  every segment goes through escapeText and the href does too. */
function userHtml(text: string, mut: Mutation): string {
  if (mut.user) return mut.user(text);
  const pieces = splitLinkedText(text);
  let out = "";
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece.url === null) { out += escapeText(piece.segments[0]); continue; }
    out += `<a href="${escapeText(piece.url)}" target="_blank" rel="noopener noreferrer" class="${userLinkCls[0]}">`;
    for (let j = 0; j < piece.segments.length; j++) {
      if (j > 0) out += "<wbr>";
      out += escapeText(piece.segments[j]);
    }
    out += "</a>";
  }
  return out;
}

function harness(css: string, rowsHtml: string, aiRaw: string, mut: Mutation): string {
  const purify = readFileSync(join(root, "node_modules/dompurify/dist/purify.min.js"), "utf8");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<style>
  /* Harness only: the app shell is 100vh and the avatars are decorative. */
  html, body { margin: 0; padding: 0; }
  .h-shell { height: 100vh; display: flex; }
</style>
<script>${purify}</script>
</head><body>
<div class="h-shell">
  <aside class="hidden lg:block w-[260px] shrink-0"></aside>
  <div class="${apply(mut.cls, mainCls[0])}" data-probe="shell-main">
    <div class="${apply(mut.cls, chatViewCls[0])}" data-probe="chat-view">
      <div class="${apply(mut.cls, listCls[0])}" data-probe="message-list">
        <div class="${apply(mut.cls, columnCls[0])}" data-probe="column">
${rowsHtml}
        </div>
      </div>
    </div>
  </div>
</div>
<script>
  var raw = ${JSON.stringify(aiRaw)};
  document.getElementById("ai-slot").innerHTML =
    DOMPurify.sanitize(raw, { ADD_ATTR: [${addAttr[0]}] });
</script>
</body></html>`;
}

function conversationRows(userText: string, mut: Mutation): string {
  const row = (variant: string) => `${apply(mut.cls, rowCls[0])} ${apply(mut.cls, variant)}`;
  const bub = (variant: string) => `${apply(mut.cls, bubbleCls[0])} ${apply(mut.cls, variant)}`;
  return `
          <div class="${row(rowCls[1])}" data-probe="row-user">
            <div class="${bub(bubbleCls[1])}" data-probe="bubble-user">
              <div class="group/edit relative">
                <p class="${apply(mut.cls, proseCls[0])}" data-probe="prose-user">${userHtml(userText, mut)}</p>
              </div>
            </div>
            <div class="shrink-0 h-7 w-7 rounded-full"></div>
          </div>
          <div class="${row(rowCls[2])}" data-probe="row-ai">
            <div class="shrink-0 h-7 w-7 rounded-full"></div>
            <div class="${bub(bubbleCls[2])}" data-probe="bubble-ai">
              <div class="ai-response" id="ai-slot" data-probe="prose-ai"></div>
            </div>
          </div>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** How many lines the fenced block in a fixture is written with. Read out of
 *  the fixture rather than written down beside it, so the expectation cannot
 *  drift away from the thing being measured. */
function fencedLines(md: string): number {
  const m = /```\w*\n([\s\S]*?)```/.exec(md);
  if (!m) return 0;
  return m[1].replace(/\n$/, "").split("\n").length;
}

/* ─── Measuring ───────────────────────────────────────────────────────────── */

interface Box {
  probe: string;
  clientWidth: number;
  scrollWidth: number;
  over: number;
  overflowX: string;
  overflowWrap: string;
  wordBreak: string;
  minWidth: string;
  /** How far the box can actually be scrolled sideways. Only measured for the
   *  two frames that are supposed to scroll. */
  reach?: number;
  /** The height the horizontal scrollbar takes out of the box. 0 means the
   *  frame scrolls and nothing on screen says so. */
  bar?: number;
}

const MEASURE = `(() => {
  const boxes = [];
  const seen = document.querySelectorAll("[data-probe]");
  for (let i = 0; i < seen.length; i++) {
    const el = seen[i];
    const cs = getComputedStyle(el);
    boxes.push({
      probe: el.getAttribute("data-probe"),
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      over: el.scrollWidth - el.clientWidth,
      overflowX: cs.overflowX,
      overflowWrap: cs.overflowWrap,
      wordBreak: cs.wordBreak,
      minWidth: cs.minWidth,
    });
  }
  const extra = [["table-wrap", ".ai-table-wrap"], ["code-block", "pre.ai-code-block"]];
  for (let i = 0; i < extra.length; i++) {
    const el = document.querySelector(extra[i][1]);
    if (!el) continue;
    const cs = getComputedStyle(el);
    // Can the reader actually get to the end of the line? Asking the computed
    // overflow-x would only prove the stylesheet says what it says.
    el.scrollLeft = 1000000;
    const reach = el.scrollLeft;
    el.scrollLeft = 0;
    // What the scrollbar takes out of the box, borders discounted. An overlay
    // scrollbar takes nothing, which is the same as the frame saying nothing.
    const bw = parseFloat(cs.borderTopWidth || "0") + parseFloat(cs.borderBottomWidth || "0");
    const bar = Math.max(0, Math.round(el.offsetHeight - el.clientHeight - bw));
    boxes.push({
      probe: extra[i][0],
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      over: el.scrollWidth - el.clientWidth,
      overflowX: cs.overflowX,
      overflowWrap: cs.overflowWrap,
      wordBreak: cs.wordBreak,
      minWidth: cs.minWidth,
      reach: reach,
      bar: bar,
    });
  }
  const de = document.documentElement;
  boxes.push({
    probe: "document",
    clientWidth: de.clientWidth,
    scrollWidth: de.scrollWidth,
    over: de.scrollWidth - de.clientWidth,
    overflowX: getComputedStyle(de).overflowX,
    overflowWrap: "",
    wordBreak: "",
    minWidth: "",
  });
  return boxes;
})()`;

/** A word broken across two lines paints two rects. Counting them is how the
 *  check can tell `overflow-wrap: anywhere` (breaks only what cannot fit) from
 *  `word-break: break-all` (breaks ordinary words at the margin). */
const SPLIT_WORDS = `(() => {
  const out = {};
  const scopes = [["user", '[data-probe="prose-user"]'], ["ai", '[data-probe="prose-ai"]']];
  for (let s = 0; s < scopes.length; s++) {
    const host = document.querySelector(scopes[s][1]);
    let split = 0, total = 0, lines = 0;
    if (host) {
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
      const tops = {};
      while (walk.nextNode()) {
        const node = walk.currentNode;
        const text = node.nodeValue || "";
        const re = /[^\\s]+/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length < 2) continue;
          const r = document.createRange();
          r.setStart(node, m.index);
          r.setEnd(node, m.index + m[0].length);
          const rects = r.getClientRects();
          total++;
          if (rects.length > 1) split++;
          for (let k = 0; k < rects.length; k++) tops[Math.round(rects[k].top)] = 1;
        }
      }
      let n = 0;
      for (const key in tops) if (Object.prototype.hasOwnProperty.call(tops, key)) n++;
      lines = n;
    }
    out[scopes[s][0]] = { split: split, total: total, lines: lines };
  }
  return out;
})()`;

/** Where the browser actually broke the URL, and whether the link still reads
 *  as the URL it points at — on BOTH sides. The two sides render through
 *  different machinery, and the surface that produced the bug report is the
 *  user's own message, so measuring only the model's copy would have missed
 *  it: at one point the model's copy broke at its separators while the user's
 *  broke inside the hostname. */
const LINK = `(() => {
  /** Every line break inside \`el\`: the character it fell after, and that
   *  character's offset into the element's text. The offset is what lets the
   *  caller ask WHERE a break landed — inside the hostname, inside a
   *  percent-escape — rather than only which character it followed, which in
   *  a URL of hex digits answers nothing. */
  function breaksIn(el) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const breaks = [], breakAt = [];
    let prevTop = null, prevChar = "", prevPos = -1, pos = 0;
    while (walk.nextNode()) {
      const t = walk.currentNode;
      const v = t.nodeValue || "";
      for (let i = 0; i < v.length; i++, pos++) {
        const r = document.createRange();
        r.setStart(t, i); r.setEnd(t, i + 1);
        const rect = r.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (prevTop !== null && rect.top > prevTop + 1) { breaks.push(prevChar); breakAt.push(prevPos); }
        prevTop = rect.top; prevChar = v.charAt(i); prevPos = pos;
      }
    }
    return { breaks: breaks, breakAt: breakAt };
  }
  function measure(host) {
    const a = host ? host.querySelector("a.ai-link") : null;
    if (!a) return null;
    const b = breaksIn(a);
    // Whether it LOOKS like a link, asked of the rendering rather than of the
    // class list. .ai-link was scoped under .ai-response, so on the user's own
    // bubble the class matched no rule at all and a clickable URL painted as
    // ordinary body text — and Tailwind's preflight means there is no browser
    // default underneath to catch it.
    const cs = getComputedStyle(a);
    const parent = a.parentElement ? getComputedStyle(a.parentElement).color : "";
    return {
      href: a.getAttribute("href") || "", text: a.textContent || "",
      wbr: a.querySelectorAll("wbr").length, breaks: b.breaks, breakAt: b.breakAt,
      lines: b.breaks.length + 1,
      color: cs.color, parentColor: parent, decoration: cs.textDecorationLine
    };
  }
  /** Same question for the state in which the user's message carries no link
   *  at all: the line breaks are still there, there is just no anchor to hang
   *  them on. Without this a mutation that removes the link treatment would
   *  report "no link" and measure nothing. */
  function measurePlain(host) {
    if (!host) return null;
    const all = host.textContent || "";
    // Clipped to the longest token in the paragraph — the URL. The words
    // around it wrap at spaces, and counting those as "breaks in the link"
    // would let a mutation go red for a reason that has nothing to do with
    // the link.
    const re = /[^\\s]+/g;
    let m, best = "", bestAt = 0;
    while ((m = re.exec(all)) !== null) if (m[0].length > best.length) { best = m[0]; bestAt = m.index; }
    const b = breaksIn(host);
    const breaks = [], breakAt = [];
    for (let i = 0; i < b.breakAt.length; i++) {
      if (b.breakAt[i] >= bestAt && b.breakAt[i] < bestAt + best.length - 1) {
        breaks.push(b.breaks[i]);
        breakAt.push(b.breakAt[i] - bestAt);
      }
    }
    return { href: "", text: best, wbr: 0, breaks: breaks, breakAt: breakAt, lines: breaks.length + 1 };
  }
  const userHost = document.querySelector('[data-probe="prose-user"]');
  return {
    ai: measure(document.querySelector('[data-probe="prose-ai"]')),
    user: measure(userHost) || measurePlain(userHost),
    userLinked: !!(userHost && userHost.querySelector("a.ai-link"))
  };
})()`;

/** A <pre> is `white-space: pre`: the number of lines on screen must be the
 *  number of lines in the source, at every width. Counting the distinct tops
 *  of its text is the only way to ask that — a computed `overflow-wrap:
 *  normal` says the stylesheet is right and says nothing about <wbr>, which
 *  Chrome honours under `pre` and which folded a one-line command over three
 *  lines while its text stayed 94 characters long. */
const CODE_LINES = `(() => {
  const pre = document.querySelector("pre.ai-code-block");
  if (!pre) return null;
  const walk = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, null);
  const tops = [];
  while (walk.nextNode()) {
    const t = walk.currentNode;
    const v = t.nodeValue || "";
    for (let i = 0; i < v.length; i++) {
      const r = document.createRange();
      r.setStart(t, i); r.setEnd(t, i + 1);
      const rect = r.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      let seen = false;
      for (let k = 0; k < tops.length; k++) if (Math.abs(tops[k] - rect.top) < 1) seen = true;
      if (!seen) tops.push(rect.top);
    }
  }
  return { lines: tops.length, chars: (pre.textContent || "").length, links: pre.querySelectorAll("a").length };
})()`;

/* ─── Runner ──────────────────────────────────────────────────────────────── */

const WIDTHS = [1398, 1024, 768, 375];

/** Boxes that are ALLOWED to be wider than themselves: they own a horizontal
 *  scroller and the reader scrolls inside the frame. Everything else in the
 *  conversation must fit. */
const LOCAL_SCROLLERS = ["table-wrap", "code-block"];

function pick(boxes: Box[], probe: string): Box | null {
  for (let i = 0; i < boxes.length; i++) if (boxes[i].probe === probe) return boxes[i];
  return null;
}

function compileCss(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatwrap-"));
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

async function main() {
  const selfTest = process.argv.indexOf("--self-test") >= 0;
  const exe =
    process.env.CHROME_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(exe)) {
    // Not looking and finding nothing are different claims.
    console.log(`\n✗ cannot run: no Chrome at ${exe}. Set CHROME_EXECUTABLE_PATH.\n`);
    process.exit(1);
  }

  console.log("\n1. The markup and the stylesheet under test");
  assert(proseCls[0].length > 0, `the user bubble's paragraph: "${proseCls[0]}"`);
  assert(bubbleCls[1].length > 0, `the user bubble: "${bubbleCls[1]}"`);
  assert(listCls[0].length > 0, `the message list: "${listCls[0]}"`);
  const css = compileCss();
  assert(css.length > 50000, `app/globals.css compiled through the project's Tailwind (${Math.round(css.length / 1024)}KB)`);

  const showBefore = process.argv.indexOf("--before") >= 0;
  const puppeteer = (await import("puppeteer-core")).default as any;
  const browser = await puppeteer.launch({
    executablePath: exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: true,
  });

  type Run = { boxes: Box[]; words: any; link: any; code: any };
  const runFixture = async (fx: Fixture, width: number, mut: Mutation, cssIn: string): Promise<Run> => {
    const page = await browser.newPage();
    await page.setViewport({ width: width, height: 900 });
    await page.setContent(
      harness(cssIn, conversationRows(fx.user, mut), aiHtml(fx.ai, mut), mut),
      { waitUntil: "load" }
    );
    const boxes = (await page.evaluate(MEASURE)) as Box[];
    const words = await page.evaluate(SPLIT_WORDS);
    const link = await page.evaluate(LINK);
    const code = await page.evaluate(CODE_LINES);
    await page.close();
    return { boxes: boxes, words: words, link: link, code: code };
  };

  /** The control for the scrollbar INFO line in section 5: an ordinary
   *  overflowing div, with nothing of ours on it. If THIS reads 0 the browser
   *  is not drawing scrollbars at all, and no number taken from our own
   *  frames means anything. */
  const measurePlainScrollbar = async (): Promise<number> => {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0"><div id="d" style="width:200px;overflow-x:auto;white-space:pre">${"A".repeat(200)}</div></body></html>`,
      { waitUntil: "load" }
    );
    const n = (await page.evaluate(`(() => { const d = document.getElementById("d"); return d.offsetHeight - d.clientHeight; })()`)) as number;
    await page.close();
    return n;
  };

  /** The whole measurement, as one number per fixture per width: the worst
   *  overflow anywhere in the conversation that is not a local scroller. */
  const worstOverflow = (boxes: Box[]): { probe: string; over: number } => {
    let worst = { probe: "none", over: 0 };
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (LOCAL_SCROLLERS.indexOf(b.probe) >= 0) continue;
      if (b.over > worst.over) worst = { probe: b.probe, over: b.over };
    }
    return worst;
  };

  const UNFIXED: Mutation = {
    // HEAD~ exactly: no wrap rule anywhere, the bubble back on its
    // min-content floor, the list back to taking the overflow, the bare URL
    // back to its old break-all-and-hope rendering, and the user's own
    // message back to plain escaped text with no link in it at all.
    css: (c) => c.replace(/overflow-wrap:\s*anywhere/g, "overflow-wrap: normal"),
    cls: (cl) => stripAdded(cl),
    html: (h) => h.split("<wbr>").join("").split('class="ai-link"').join('class="ai-link break-all"'),
    user: escapeText,
  };

  try {
    if (showBefore) {
      console.log("\n1b. BEFORE — the same fixtures with the fix taken back out");
      const beforeCss = apply(UNFIXED.css, css);
      for (let f = 0; f < FIXTURES.length; f++) {
        const fx = FIXTURES[f];
        const rows: string[] = [];
        for (let w = 0; w < WIDTHS.length; w++) {
          const run = await runFixture(fx, WIDTHS[w], UNFIXED, beforeCss);
          const parts: string[] = [];
          for (let i = 0; i < run.boxes.length; i++) {
            const b = run.boxes[i];
            if (b.over > 0) parts.push(`${b.probe} +${b.over}`);
          }
          rows.push(`      ${String(WIDTHS[w])}px  ${parts.length ? parts.join(", ") : "nothing over"}`);
        }
        console.log(`    ${fx.what}`);
        for (let r = 0; r < rows.length; r++) console.log(rows[r]);
      }
    }

    console.log("\n2. Nothing in a conversation is wider than the conversation");
    const shipped: any = {};
    for (let f = 0; f < FIXTURES.length; f++) {
      const fx = FIXTURES[f];
      const perWidth: string[] = [];
      let bad = 0;
      let worstMsg = "";
      shipped[fx.key] = {};
      for (let w = 0; w < WIDTHS.length; w++) {
        const run = await runFixture(fx, WIDTHS[w], NONE, css);
        shipped[fx.key][WIDTHS[w]] = run;
        const worst = worstOverflow(run.boxes);
        perWidth.push(`${WIDTHS[w]}px:${worst.over}`);
        if (worst.over > 0) { bad++; worstMsg = `${worst.probe} over by ${worst.over}px at ${WIDTHS[w]}px`; }
      }
      assert(bad === 0, `${fx.what} — overflow ${perWidth.join("  ")}${bad ? `  ← ${worstMsg}` : ""}`);
    }

    console.log("\n3. The page never scrolls sideways either");
    for (let f = 0; f < FIXTURES.length; f++) {
      const fx = FIXTURES[f];
      let bad = 0;
      const per: string[] = [];
      for (let w = 0; w < WIDTHS.length; w++) {
        const doc = pick(shipped[fx.key][WIDTHS[w]].boxes, "document");
        const over = doc ? doc.over : -1;
        per.push(`${WIDTHS[w]}px:${over}`);
        if (over !== 0) bad++;
      }
      assert(bad === 0, `${fx.what} — document ${per.join("  ")}`);
    }

    console.log("\n4. Ordinary words are not broken");
    for (let f = 0; f < FIXTURES.length; f++) {
      const fx = FIXTURES[f];
      if (fx.midWordBreaksAllowed) continue;
      let bad = 0;
      const per: string[] = [];
      for (let w = 0; w < WIDTHS.length; w++) {
        const words = shipped[fx.key][WIDTHS[w]].words;
        per.push(`${WIDTHS[w]}px:${words.user.split}/${words.ai.split}`);
        if (words.user.split > 0 || words.ai.split > 0) bad++;
      }
      assert(bad === 0, `${fx.what} — words split across lines (user/model) ${per.join("  ")}`);
    }
    // ... and the fixture has to be wrapping at all, or the line above proves nothing.
    const proseAt375 = shipped["prose"][375].words;
    assert(proseAt375.user.lines >= 3 && proseAt375.ai.lines >= 3,
      `the ordinary paragraph does wrap at 375px (${proseAt375.user.lines} lines user, ${proseAt375.ai.lines} model), so "no word broken" is a real result`);

    console.log("\n5. Code and tables scroll in their own frame instead");
    const codeBox = pick(shipped["code"][375].boxes, "code-block");
    assert(!!codeBox && codeBox.over > 0, `at 375px the command is genuinely longer than its frame (${codeBox ? codeBox.over : 0}px beyond it)`);
    assert(!!codeBox && (codeBox.reach || 0) >= codeBox.over, `and the reader can scroll the frame to the end of it (${codeBox ? codeBox.reach : 0}px of ${codeBox ? codeBox.over : 0}) — an unscrollable frame hides the line rather than containing it`);
    assert(!!codeBox && codeBox.overflowWrap !== "anywhere", `the command's box is not set to wrap (overflow-wrap: ${codeBox ? codeBox.overflowWrap : "?"})`);
    // ...and that last assertion is not enough on its own, which is how the
    // <wbr> regression got past this check once: the box read `normal` and
    // reported a pass while the command was displayed over three lines.
    // Nothing but counting the lines on screen answers the question the
    // reader is actually asking, which is whether the command is one command.
    const codeSrcLines = fencedLines(FIXTURES[codeFixtureIdx].ai);
    assert(codeSrcLines > 0, `the code fixture's block is ${codeSrcLines} line(s) of source — the expectation comes out of the fixture`);
    let folded = 0;
    const foldPer: string[] = [];
    for (let w = 0; w < WIDTHS.length; w++) {
      const c = shipped["code"][WIDTHS[w]].code;
      foldPer.push(`${WIDTHS[w]}px:${c ? c.lines : "?"}`);
      if (!c || c.lines !== codeSrcLines) folded++;
    }
    assert(folded === 0, `the command is one line on screen because it is one line of source (${foldPer.join("  ")}, expected ${codeSrcLines})`);
    const codeShipped = shipped["code"][375].code;
    assert(!!codeShipped && codeShipped.links === 0, `and the URL inside it is an argument, not a link (${codeShipped ? codeShipped.links : "?"} anchors in the block)`);
    const tableBox = pick(shipped["table"][768].boxes, "table-wrap");
    assert(!!tableBox && tableBox.over > 0, `at 768px the table is genuinely wider than its frame (${tableBox ? tableBox.over : 0}px)`);
    assert(!!tableBox && (tableBox.reach || 0) >= tableBox.over, `and the reader can scroll it to the last column (${tableBox ? tableBox.reach : 0}px of ${tableBox ? tableBox.over : 0})`);
    // Reachable is not the same as discoverable, and this check CANNOT answer
    // the second one. Reported rather than asserted, because not looking and
    // finding nothing are different claims: headless Chrome hides scrollbars
    // in every mode it has, so a plain overflowing div measures 0 here too
    // (verified both ways). A 0 below is the harness, not the page.
    const plainBar = await measurePlainScrollbar();
    console.log(
      `  · INFO  scrollbar gutter — code ${codeBox ? codeBox.bar : "?"}px, table ${tableBox ? tableBox.bar : "?"}px, ` +
      `a plain overflow-x:auto div ${plainBar}px. Headless renders no scrollbars, so whether these frames ` +
      `announce themselves at rest is open and has to be looked at in a real window.`
    );

    console.log("\n6. The message list contains what is left rather than scrolling");
    const listBox = pick(shipped["table"][375].boxes, "message-list");
    // "hidden" is the computed value of overflow-x-hidden AND of
    // overflow-x-clip beside a scrolling axis, which is why the class says
    // hidden: the two are the same box here, and only one of them says so.
    assert(!!listBox && listBox.overflowX === "hidden", `the list's overflow-x is "${listBox ? listBox.overflowX : "absent"}" — a scrollbar here drags the whole conversation sideways to read one line`);
    assert(!!listBox && listBox.over === 0, `and with a wide table on screen at 375px it still has nothing to scroll (${listBox ? listBox.over : -1}px)`);

    console.log("\n7. A broken link is still a link — on both sides");
    const uglyBreaksIn = (l: any): number => {
      let n = 0;
      if (l) for (let i = 0; i < l.breaks.length; i++) if (SEP.indexOf(l.breaks[i]) < 0) n++;
      return n;
    };
    // Both sides, because the message that produced the bug report is the
    // user's own. It is the same URL in the same thread: if the model's copy
    // breaks at its separators and the paste it is quoting breaks inside the
    // hostname, the reader has been handed two different answers to "what am
    // I about to click".
    const sides = [["the model's copy", shipped["url-200"][375].link.ai], ["the user's own paste", shipped["url-200"][375].link.user]];
    for (let s = 0; s < sides.length; s++) {
      const who = sides[s][0] as string;
      const l = sides[s][1] as any;
      assert(!!l, `${who} — the bare URL renders as a link`);
      assert(!!l && l.href === LONG_URL, `${who} — the href is the URL untouched`);
      assert(!!l && l.text === LONG_URL, `${who} — and so is the text it reads as: <wbr> adds no character, so copying it still yields the URL`);
      assert(!!l && l.wbr > 0, `${who} — its break opportunities survive to the DOM (${l ? l.wbr : 0} of them)`);
      assert(!!l && l.lines >= 3, `${who} — at 375px it takes ${l ? l.lines : 0} lines, so where it breaks is a real question`);
      const n = uglyBreaksIn(l);
      assert(n === 0, `${who} — every line ends at a path separator, not mid-word (${l ? l.breaks.length : 0} breaks, ${n} of them mid-segment)`);
      // ...and it has to look like one. Being an <a> is not the same as
      // reading as a link: the class that styles one was scoped to the
      // model's container, so the user's own link painted as body text.
      // `|| ""` on purpose: with no anchor at all the measurement falls back
      // to plain text and carries no style, and this has to read as a red
      // line rather than as a crash in the check.
      assert(!!l && (l.decoration || "").indexOf("underline") >= 0, `${who} — it reads as a link, not as text (text-decoration: ${l ? l.decoration || "none — there is no link here" : "?"})`);
      assert(!!l && !!l.color && l.color !== l.parentColor, `${who} — in the link colour rather than the prose colour (${l ? l.color || "no link" : "?"} on ${l ? l.parentColor || "?" : "?"})`);
    }
    // The hostname is the one part of a URL a reader can check, so it gets
    // its own assertion rather than being one more break in the count above.
    const hostSides = [["the model's copy", shipped["url-opaque"][375].link.ai], ["the user's own paste", shipped["url-opaque"][375].link.user]];
    for (let s = 0; s < hostSides.length; s++) {
      const l = hostSides[s][1] as any;
      assert(!!l, `${hostSides[s][0]} — the opaque URL is measurable`);
      assert(inHostBreaks(l) === 0, `${hostSides[s][0]} — an opaque host is never split mid-label (${inHostBreaks(l)} of ${l ? l.breaks.length : 0} breaks land inside the hostname)`);
    }
    const mdLink = shipped["md-link"][375].link.ai;
    assert(!!mdLink && mdLink.text === "book a call", "a titled link still reads as its title, not its URL");
    assert(!!mdLink && mdLink.href === LONG_URL, "with the whole URL behind it");

    console.log("\n8. Every other surface that prints chat prose");
    for (let s = 0; s < SURFACES.length; s++) {
      const sf = SURFACES[s];
      const cls = captureOnce(sf.file, sf.re, sf.label)[0];
      const page = await browser.newPage();
      await page.setViewport({ width: 1024, height: 900 });
      const body = sf.flexRow
        ? `<div class="flex justify-end" style="width:320px"><p class="${cls}" data-probe="p">${escapeText(FIXTURES[0].user)}</p></div>`
        : `<div style="width:320px"><p class="${cls}" data-probe="p">${escapeText(FIXTURES[0].user)}</p></div>`;
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0}</style></head><body>${body}</body></html>`,
        { waitUntil: "load" }
      );
      const boxes = (await page.evaluate(MEASURE)) as Box[];
      await page.close();
      const p = pick(boxes, "p");
      assert(!!p && p.over === 0, `${sf.label} — ${p ? p.over : "?"}px over in a 320px panel`);
    }

    if (!selfTest) {
      console.log(`\n${failures === 0 ? "✓ chat wrapping verified" : `✗ ${failures} failed`}\n`);
      await browser.close();
      process.exit(failures === 0 ? 0 : 1);
    }

    /* ─── Self-test ───────────────────────────────────────────────────────── */

    console.log("\n9. Self-test — each mutation must turn this check red");
    const before = failures;

    const stripWrapRules = (c: string) =>
      c.replace(/overflow-wrap:\s*anywhere/g, "overflow-wrap: normal");
    const weakenWrap = (c: string) =>
      c.replace(/overflow-wrap:\s*anywhere/g, "overflow-wrap: break-word");
    const breakAll = (c: string) =>
      c.replace(/overflow-wrap:\s*anywhere/g, "word-break: break-all");
    const dropMinWidth = (cl: string) => (cl.indexOf("max-w-[85%]") === 0 ? cl.split(" min-w-0").join("") : cl);
    const dropClip = (cl: string) => cl.split(" overflow-x-hidden").join("");
    const dropWbr = (h: string) => h.split("<wbr>").join("");
    /** Put the link styling back under .ai-response, where it was. The model's
     *  copy keeps its colour and the user's own loses it: same class, same
     *  anchor, no rule. */
    const rescopeLink = (c: string) => c.split(".ai-link").join(".ai-response .ai-link");
    /** The regression this check shipped and did not catch: the bare-URL pass
     *  running over the whole string, <pre> included. Reproduced by doing to
     *  the finished HTML exactly what the unguarded pass did to it. */
    const autolinkInsidePre = (h: string) =>
      h.replace(/<pre[\s\S]*?<\/pre>/g, (block) =>
        block.replace(
          /(https?:\/\/[^\s<)\]"]+)/g,
          (_m, url) => `<a href="${url}" target="_blank" rel="noopener" class="ai-link">${urlPieces(url).join("<wbr>")}</a>`
        )
      );

    /** Each mutation declares WHICH detectors must fire. Comparing the fired
     *  set to the declared one catches a mutation that goes red for the wrong
     *  reason as well as one that does not go red at all — and it is what
     *  turned two of these from "killed" into the survivors recorded above. */
    interface Mut { name: string; mut: Mutation; kills: string[]; note: string; }
    const MUTATIONS: Mut[] = [
      {
        name: "the shipped bug: nothing may break a long token",
        mut: { css: stripWrapRules, cls: stripAdded, html: dropWbr },
        kills: ["overflow", "list"],
        note: "the reported defect, reproduced",
      },
      {
        name: "min-w-0 dropped from the user bubble",
        mut: { cls: dropMinWidth },
        kills: [],
        note: "SURVIVES: max-w-[85%] already clamps the flex automatic minimum size (css-flexbox-1 §4.5), so the floor min-w-0 removes was never reached. Kept as defence for a bubble that loses its cap, not as the fix",
      },
      {
        name: "overflow-wrap: break-word instead of anywhere",
        mut: { css: weakenWrap },
        kills: [],
        note: "SURVIVES every detector. In THIS markup both bubbles carry a max-width, so the one thing `anywhere` adds over `break-word` — a min-content width of one character — is never the deciding measurement. Kept because it is the spelling that holds when a bubble has no cap, and because the check cannot construct that case out of the real markup to prove it",
      },
      {
        name: "word-break: break-all instead of overflow-wrap: anywhere",
        mut: { css: breakAll },
        kills: ["words", "uglybreak", "hostsplit"],
        note: "the wrong fix: ordinary prose starts breaking at the margin, and it overrides the offered breaks rather than preferring them — 19 mid-segment breaks in one URL, and the opaque hostname split mid-label. The hostname detector was added for a different mutation and caught this one too, which is the argument for declaring the set rather than counting failures",
      },
      {
        name: "overflow-x dropped from .ai-code-block",
        mut: { css: (c) => c.replace(/(\.ai-code-block\s*\{[^}]*?)overflow-x:\s*auto;/, "$1") },
        kills: ["unreachable"],
        note: "does NOT push the conversation — .ai-code-wrap clips it — it silently truncates the command instead, which is why the detector is reachability and not overflow",
      },
      {
        name: "overflow-x dropped from .ai-table-wrap",
        mut: { css: (c) => c.replace(/(\.ai-table-wrap\s*\{[^}]*?)overflow-x:\s*auto;/, "$1") },
        kills: ["overflow", "list", "unreachable"],
        note: "nothing clips the table, so it pushes the whole conversation — and the columns past the edge cannot be reached either",
      },
      {
        name: "overflow-x-hidden removed from the message list",
        mut: { cls: dropClip },
        kills: [],
        note: "SURVIVES: with the prose fixed there is nothing left to overflow. The clip is a guard against the next unbreakable thing, not the fix",
      },
      {
        name: "<wbr> removed from bare URLs",
        mut: { html: dropWbr },
        kills: ["uglybreak"],
        note: "Chrome breaks after a slash by itself but not inside a percent-escape",
      },
      {
        name: "the bare-URL pass reaches inside <pre> again",
        mut: { html: autolinkInsidePre },
        kills: ["codefold"],
        note: "the regression this check shipped: <wbr> is a break opportunity under `white-space: pre` too, so a one-line command was DISPLAYED over three lines while its text stayed 94 characters. Nothing that reads a computed style can see it — which is why section 5 counts lines now, and why the computed-style assertion it sat behind was insufficient rather than wrong",
      },
      {
        name: "the link styling scoped back under .ai-response",
        mut: { css: rescopeLink },
        kills: ["unstyledlink"],
        note: "the user's bubble is not inside .ai-response, so the class matched no rule and the URL painted as body text — clickable, and indistinguishable from the sentence around it. No overflow detector can see this: the geometry is identical",
      },
      {
        name: "the user's own message loses its link treatment",
        mut: { user: escapeText },
        kills: ["uglybreak", "hostsplit"],
        note: "the surface the bug was reported from. The prose rule still wraps it, so nothing overflows and nothing scrolls — it just breaks wherever the line runs out, including inside the hostname, which is the one part of a URL a reader can check before clicking",
      },
    ];

    for (let m = 0; m < MUTATIONS.length; m++) {
      const mu = MUTATIONS[m];
      const mutCss = apply(mu.mut.css, css);
      let worstAny = 0;
      let splitAny = 0;
      let unreachable = 0;
      let listScrolls = 0;
      let uglyBreaks = 0;
      let hostSplits = 0;
      let codeFolds = 0;
      let unstyledLinks = 0;
      for (let f = 0; f < FIXTURES.length; f++) {
        const fx = FIXTURES[f];
        for (let w = 0; w < WIDTHS.length; w++) {
          const run = await runFixture(fx, WIDTHS[w], mu.mut, mutCss);
          const worst = worstOverflow(run.boxes);
          if (worst.over > worstAny) worstAny = worst.over;
          if (!fx.midWordBreaksAllowed && (run.words.user.split > 0 || run.words.ai.split > 0)) splitAny++;
          const lb = pick(run.boxes, "message-list");
          if (lb && lb.over > 0) listScrolls++;
          const frames = ["code-block", "table-wrap"];
          for (let i = 0; i < frames.length; i++) {
            const fb = pick(run.boxes, frames[i]);
            if (fb && fb.over > 0 && (fb.reach || 0) < fb.over) unreachable++;
          }
          // Both sides, every time. The model's copy of a URL and the user's
          // paste of the same URL are rendered by different machinery, and
          // for one commit they broke in different places.
          const both = run.link ? [run.link.ai, run.link.user] : [];
          for (let s = 0; s < both.length; s++) {
            if (!both[s]) continue;
            if (fx.key === "url-200") {
              for (let i = 0; i < both[s].breaks.length; i++) if (SEP.indexOf(both[s].breaks[i]) < 0) uglyBreaks++;
            }
            if (fx.key === "url-opaque") hostSplits += inHostBreaks(both[s]);
            if (both[s].decoration !== undefined &&
                (both[s].decoration.indexOf("underline") < 0 || both[s].color === both[s].parentColor)) unstyledLinks++;
          }
          if (fx.key === "code" && (!run.code || run.code.lines !== codeSrcLines)) codeFolds++;
        }
      }
      const fired: string[] = [];
      if (worstAny > 0) fired.push("overflow");
      if (splitAny > 0) fired.push("words");
      if (listScrolls > 0) fired.push("list");
      if (unreachable > 0) fired.push("unreachable");
      if (uglyBreaks > 0) fired.push("uglybreak");
      if (hostSplits > 0) fired.push("hostsplit");
      if (codeFolds > 0) fired.push("codefold");
      if (unstyledLinks > 0) fired.push("unstyledlink");
      const want = mu.kills.slice().sort().join(",");
      const got = fired.slice().sort().join(",");
      const detail = `worst overflow ${worstAny}px, ${splitAny} fixtures breaking words, list scrolled ${listScrolls}×, ${unreachable} frames unreachable, ${uglyBreaks} ugly URL breaks, ${hostSplits} hostname splits, ${codeFolds} folded commands, ${unstyledLinks} invisible links`;
      assert(
        want === got,
        `${mu.kills.length ? "KILLED" : "SURVIVED"} — ${mu.name} — fired [${got || "nothing"}], ${detail}\n      ${mu.note}`
      );
    }

    assert(failures === before, "every detector behaved as the mutation log records");
    console.log(`\n${failures === 0 ? "✓ chat wrapping verified, and the check itself is honest" : `✗ ${failures} failed`}\n`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    try { await browser.close(); } catch { /* already closed */ }
  }
}

main().catch((e) => {
  console.log("\n✗ cannot run:", e && e.message ? e.message : e, "\n");
  process.exit(1);
});
