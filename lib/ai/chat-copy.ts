/**
 * Copying out of a reply: the two buttons formatMarkdown writes into the
 * HTML, and the one delegated click handler that serves both.
 *
 * Its own module, and DOM-only, for the same reason chat-markdown.ts is
 * React-free: scripts/verify-chat-copy.ts loads THIS file into a real Chrome,
 * clicks the button a user clicks and reads back what the clipboard received.
 * MessageBubble hands every click in a reply straight to handleResponseClick,
 * so there is no second copy of this logic for the check to drift away from.
 *
 * ── WHY A QUOTE BLOCK HAS ITS OWN BUTTON ────────────────────────────────────
 *
 * Chris asked for a LinkedIn reply and pasted his own draft back for a tidy
 * (thread 74a2b95f, 2026-09-23). The reply put the tidied message in a quote
 * block with commentary above and below — and the renderer had no quotes, so
 * every line of the draft began with a literal ">", on screen and on copy,
 * and the message's own Copy button took the commentary with it. The quote
 * block is now where a reply puts anything the user will send somewhere else,
 * and this is what gets it there in one click and nothing else.
 */
import { htmlToPlainText } from "@/lib/optimizer/export";

export interface DraftClip {
  /** What a plain field receives: a textarea, a terminal, a plain message box. */
  plain: string;
  /** What a rich editor receives: a mail composer, a chat composer, a doc. */
  html: string;
}

/**
 * The block as the two things a paste target reads.
 *
 * The HTML is REBUILT from the rendered block rather than lifted with
 * innerHTML, because innerHTML carries everything a paste target must not
 * get: the ai- classes, the citation chips, the target and rel on every link,
 * and — pasted into Gmail — the quote bar the block sits inside on screen. What
 * comes out is lines, <br>, lists, links and emphasis, bare.
 *
 * A paragraph is a <div> and the blank line between two of them is written
 * out as <div><br></div> — Gmail's own form — rather than left to a <p>'s
 * margin. Measured by pasting into a contenteditable under two stylesheets:
 * with the browser's default 1em margin every shape reads as paragraphs, but
 * with margins zeroed — Tailwind's preflight, and any composer that treats a
 * <p> as one line and writes a blank line as an empty one — bare <p>s pasted
 * as adjacent lines with no blank line anywhere, and a <p>
 * plus an empty <p> between gave a triple gap under the defaults. Only this
 * shape gave exactly one blank line under both.
 *
 * The plain half is the optimiser's block-aware converter over the same
 * blocks written as <p>, so the two halves cannot describe different text:
 * paragraphs one blank line apart, a single line break kept — "Cheers,\nChris"
 * stays two lines — and a link written out as "text (url)".
 */
export function draftClip(block: Element): DraftClip {
  const blocks = cleanBlocks(block);
  const html: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    html.push(b.indexOf("<p>") === 0 ? `<div>${b.slice(3, -4)}</div>` : b);
  }
  return { html: html.join("<div><br></div>"), plain: htmlToPlainText(blocks.join("")) };
}

/** Write both halves at once, so each paste target takes the one it reads.
 *  Resolves to "plain" when the browser would take only text — a browser
 *  without ClipboardItem, or one that refuses the rich write — so the button
 *  can say so rather than let the user paste believing the formatting came. */
export async function writeClip(clip: DraftClip): Promise<"rich" | "plain"> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([clip.html], { type: "text/html" }),
        "text/plain": new Blob([clip.plain], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  } catch {
    await navigator.clipboard.writeText(clip.plain);
    return "plain";
  }
}

/** Every click inside a rendered reply. The HTML is a sanitised string, so
 *  its buttons cannot carry React handlers; they carry a data attribute and
 *  the container delegates here.
 *
 *  Only a button formatMarkdown drew is obeyed, and only where it drew it.
 *  The reply's HTML is partly the model's, and the model writes what its
 *  sources tell it to: a span carrying data-quote-copy, laid invisibly over
 *  the page, made a click ANYWHERE copy the quote under it with the real
 *  button still reading "Copy" (found by a verifier, 2026-09-23). A clipboard
 *  the user did not knowingly fill is how a pasted command becomes someone
 *  else's command. So the target must be the exact button — its tag, its one
 *  class, its data attribute, its parent and its block — and it must be
 *  sitting in the reply, not lifted out of it. */
export function handleResponseClick(target: EventTarget | null): void {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return;
  const btn = el.closest("button");
  if (!btn || !inPlace(btn)) return;

  if (drawn(btn, "ai-code-copy", "data-code-copy", "ai-code-bar")) {
    const wrap = btn.parentElement!.parentElement;
    const code = wrap && wrap.className === "ai-code-wrap" ? wrap.querySelector(":scope > pre.ai-code-block > code") : null;
    if (!code) return;
    navigator.clipboard.writeText(seenText(code));
    flash(btn, "Copied");
    return;
  }

  if (drawn(btn, "ai-quote-copy", "data-quote-copy", "ai-quote-wrap")) {
    const block = btn.nextElementSibling;
    if (!block || block.tagName !== "BLOCKQUOTE" || block.className !== "ai-quote") return;
    writeClip(draftClip(block)).then(
      (how) => flash(btn, how === "rich" ? "Copied" : "Copied as text"),
      () => flash(btn, "Copy failed")
    );
  }
}

/** A copy button exactly as formatMarkdown writes it: nothing added to its
 *  class, inside the container it is written into. */
function drawn(btn: Element, cls: string, attr: string, parentCls: string): boolean {
  return btn.className === cls && btn.hasAttribute(attr) && !!btn.parentElement && btn.parentElement.className === parentCls;
}

/** The button is in the reply's own flow and can be seen: nothing between it
 *  and the reply is lifted out of the page or faded out. An overlay is either
 *  positioned out of flow or transparent, and a forged button inside one
 *  would otherwise pass every structural test above. */
function inPlace(btn: HTMLElement): boolean {
  for (let n: HTMLElement | null = btn; n && !n.classList.contains("ai-response"); n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position === "fixed" || cs.position === "absolute" || cs.position === "sticky") return false;
    if (cs.display === "none" || cs.visibility !== "visible" || parseFloat(cs.opacity) < 1) return false;
  }
  return true;
}

function flash(btn: Element, label: string): void {
  btn.textContent = label;
  setTimeout(() => { btn.textContent = "Copy"; }, 2000);
}

/* ─── Rebuilding the block as paste-ready HTML ────────────────────────────── */

const HEADING = /^H[1-6]$/;

/** Whether an element's text reaches the reader. What the button copies is
 *  what the block SHOWS: a copy that carries words the reader never saw is
 *  worse than one that drops a word, because the reader signs what they send.
 *  Measured before this existed (2026-09-23): "Please pay the invoice<span
 *  class="hidden"> to the NEW account …</span> at your convenience." read
 *  cleanly in the card and pasted with the new account in it.
 *
 *  Every way of hiding text that a class can reach: no box, not visible,
 *  transparent, lifted out of the flow (a screen-reader-only span is a
 *  1px absolutely placed box), a font too small to read, a fully
 *  transparent colour. Judged per element as the walk goes down, so a hidden element's
 *  whole subtree is skipped. display: contents has no box of its own and
 *  shows its children, so it is judged by them. */
function seen(e: Element): boolean {
  const cs = getComputedStyle(e);
  if (cs.display === "contents") return true;
  if (cs.display === "none" || cs.visibility !== "visible") return false;
  if (parseFloat(cs.opacity) < 0.05) return false;
  if (cs.position === "absolute" || cs.position === "fixed") return false;
  if (parseFloat(cs.fontSize) < 4) return false;
  return !/^(transparent|rgba\([^)]*,\s*0\))$/.test(cs.color);
}

/** An element's text, less whatever inside it is not seen. */
function seenText(el: Element): string {
  let out = "";
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) out += n.nodeValue || "";
    else if (n.nodeType === 1 && seen(n as Element)) out += seenText(n as Element);
  }
  return out;
}

/** A container's children as clean blocks, one string each. Inline content
 *  sitting directly in the container — which the list pass leaves behind for
 *  a paragraph that follows a list — is gathered into a paragraph of its own,
 *  its newlines kept as the line breaks the model wrote. */
function cleanBlocks(el: Element): string[] {
  const out: string[] = [];
  let loose = "";
  const flush = () => {
    const t = loose.replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, "");
    if (t) out.push(`<p>${t}</p>`);
    loose = "";
  };
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) {
      loose += escapeText(n.nodeValue || "").replace(/\n/g, "<br>");
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    const tag = e.tagName;
    if (tag === "BUTTON" || tag === "HR" || tag === "IMG" || !seen(e)) continue;
    if (tag === "P") {
      flush();
      const body = cleanInline(e).trim();
      if (body) out.push(`<p>${body}</p>`);
    } else if (HEADING.test(tag)) {
      flush();
      const t = tag.toLowerCase();
      out.push(`<${t}>${cleanInline(e).trim()}</${t}>`);
    } else if (tag === "UL" || tag === "OL") {
      flush();
      out.push(cleanList(e));
    } else if (tag === "PRE") {
      flush();
      out.push(`<pre>${escapeText(seenText(e))}</pre>`);
    } else if (tag === "TABLE") {
      flush();
      out.push(cleanTable(e));
    } else if (e.classList.contains("ai-code-bar")) {
      continue;
    } else if (e.classList.contains("ai-media-placeholder")) {
      // Where the user attaches the picture: back to the marker the model
      // wrote, not the glyph drawn in front of it.
      flush();
      const label = e.lastElementChild ? seenText(e.lastElementChild) : "";
      if (label) out.push(`<p>[${escapeText(label)}]</p>`);
    } else if (tag === "BLOCKQUOTE" || tag === "DIV") {
      // A quote inside the draft is flattened into it: pasted, a nested quote
      // bar is furniture the recipient did not ask for. A div is a container
      // the renderer made (a code frame, a table frame, a spacer).
      flush();
      const inner = cleanBlocks(e);
      for (let j = 0; j < inner.length; j++) out.push(inner[j]);
    } else {
      loose += cleanNode(e, true);
    }
  }
  flush();
  return out;
}

/** Inline content, bare. A citation chip is dropped: it is the reply's
 *  sourcing, not part of the message. A newline inside a paragraph is a space,
 *  because that is how it reads on screen; in `loose` text it is the line
 *  break the renderer failed to draw. */
function cleanInline(el: Element, loose = false): string {
  let out = "";
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) out += cleanNode(kids[i], loose);
  return out;
}

/** A list, numbered as the screen numbers it.
 *
 *  formatMarkdown splits one numbered list into several <ol>s wherever an
 *  item is followed by a sub-bullet or a paragraph, and keeps the numbering
 *  on screen with each item's value. Rebuilt as bare <li>s, every fragment
 *  restarted at 1: a six-step prompt with sub-bullets copied as 1, 2, 1, 2,
 *  1, 2 (stored message bbca2d2b, found by a verifier's pass over all 304
 *  quote blocks). So an <ol> carries its first number as start, and an item
 *  whose number breaks the run carries its own. */
function cleanList(list: Element): string {
  const t = list.tagName.toLowerCase();
  let items = "";
  let start = 0;
  let next = 1;
  const lis = list.children;
  for (let j = 0; j < lis.length; j++) {
    const li = lis[j];
    if (!seen(li)) continue;
    let mark = "";
    if (t === "ol") {
      const v = parseInt(li.getAttribute("value") || "", 10);
      const n = isNaN(v) ? next : v;
      if (start === 0) start = n;
      else if (n !== next) mark = ` value="${n}"`;
      next = n + 1;
    }
    items += `<li${mark}>${cleanInline(li).trim()}</li>`;
  }
  return t === "ol" && start !== 1 && start !== 0 ? `<ol start="${start}">${items}</ol>` : `<${t}>${items}</${t}>`;
}

/** One inline node, itself included — a link sitting loose in the block has
 *  to be judged as a link, or its citation chip rides along with it. */
function cleanNode(n: Node, loose: boolean): string {
  if (n.nodeType === 3) return escapeText(n.nodeValue || "").replace(/\n/g, loose ? "<br>" : " ");
  if (n.nodeType !== 1) return "";
  const e = n as Element;
  const tag = e.tagName;
  if (tag === "BR") return "<br>";
  if (tag === "WBR" || tag === "IMG" || tag === "BUTTON" || !seen(e)) return "";
  if (tag === "A") {
    if (e.classList.contains("ai-cite")) return "";
    const href = e.getAttribute("href") || "";
    const inner = cleanInline(e, loose);
    return /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeText(href)}">${inner}</a>` : inner;
  }
  if (tag === "STRONG" || tag === "B") return `<strong>${cleanInline(e, loose)}</strong>`;
  if (tag === "EM" || tag === "I") return `<em>${cleanInline(e, loose)}</em>`;
  return cleanInline(e, loose);
}

function cleanTable(table: Element): string {
  let rows = "";
  const trs = table.querySelectorAll("tr");
  for (let i = 0; i < trs.length; i++) {
    if (!seen(trs[i])) continue;
    let cells = "";
    const tds = trs[i].children;
    for (let j = 0; j < tds.length; j++) {
      if (!seen(tds[j])) continue;
      const t = tds[j].tagName === "TH" ? "th" : "td";
      cells += `<${t}>${cleanInline(tds[j]).trim()}</${t}>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  return `<table>${rows}</table>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
