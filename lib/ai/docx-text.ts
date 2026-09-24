/**
 * A Word document as the text a model reads — WITH ITS LINKS.
 *
 * THE INCIDENT, 2026-09-23 (thread 3ec51a09). An article attached to the chat
 * as a .docx was scored against a checklist whose eleventh point is internal
 * links, and the model marked it "no internal links" — while the article's
 * product name linked to its product page three times. The messages route
 * extracted the attachment with mammoth.extractRawText, which keeps a link's
 * words and throws its target away, so the model was handed prose with every
 * link already removed and scored exactly what it was given.
 *
 * WHAT CHANGES, AND WHAT DOES NOT. A link to a page — http, https or mailto —
 * reads "words (target)", the way a person would quote it. Everything else is
 * extractRawText's output TO THE BYTE: the walk below is mammoth's own
 * convertElementToRawText (lib/raw-text.js, 1.11.0) with one case added, so a
 * document with no links produces exactly the text it always did, and the
 * cached extraction of every attachment already stored stays what it is.
 * That matters beyond tidiness: extracted text is cached in
 * ai_messages.attachments and re-sent on every turn of the conversation, as
 * part of the prompt cache's prefix (scripts/verify-prompt-cache.ts). A
 * format change for plain documents would spend a full-price turn on every
 * conversation that has one, for nothing.
 *
 * NOT ADDED: a link with no target outside the document — a table of
 * contents entry, a bookmark (`anchor`) — which Word writes for every heading
 * of a long report and which would bury the text in "#_Toc…"; a link whose
 * words already ARE its target; and a link with no words (an image). Word
 * splits one link into several runs whenever the formatting inside it changes
 * — and a link written as a HYPERLINK field arrives as a link element inside
 * EACH run it spans — so consecutive words under one target are one link, and
 * the target is written once, after the last of them.
 *
 * THE DOCUMENT TREE IS mammoth's, got through its PUBLIC transformDocument
 * hook rather than a deep import: convertToHtml reads the file exactly as
 * extractRawText does (docx-reader.read — the options it adds concern only
 * externally linked images), hands the tree to transformDocument, and the
 * hook takes a copy and returns the document with its body emptied, so the
 * HTML conversion that follows has nothing to convert and no image is
 * base64-encoded for nothing. Proven on a real .docx built in memory
 * (scripts/verify-chat-attachments.ts, section 7e), because a mock of mammoth
 * would prove only the mock.
 */

type Element = { type: string; value?: string; children?: Element[]; href?: string; anchor?: string };

/** A target worth writing beside a link's words. */
function outsideTarget(el: Element): string {
  const href = String(el.href || "").trim();
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : "";
}

/** The same target, the same way a reader would see it: case, a trailing
 *  slash, a scheme and a mailto: prefix aside. */
function sameAddress(words: string, href: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^mailto:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return norm(words) === norm(href);
}

/** mammoth's convertElementToRawText, as a list of pieces each carrying the
 *  target of the link it sits in ("" outside one). Concatenated, the pieces
 *  are convertElementToRawText's output exactly. */
function pieces(element: Element, href: string, out: { text: string; href: string }[]): void {
  if (element.type === "text") { out.push({ text: element.value || "", href }); return; }
  if (element.type === "tab") { out.push({ text: "\t", href }); return; }
  // A w:hyperlink is one element around its runs; a HYPERLINK field is a
  // link element INSIDE each run it spans. Both carry the target down.
  const inner = element.type === "hyperlink" ? outsideTarget(element) || href : href;
  const kids = element.children || [];
  for (let i = 0; i < kids.length; i++) pieces(kids[i], inner, out);
  if (element.type === "paragraph") out.push({ text: "\n\n", href: "" });
}

/** The pieces as text: each run of pieces under ONE target is one link —
 *  however many runs Word cut it into, by either route — and its target is
 *  written once, after its words and inside any trailing space. */
function toText(root: Element): string {
  const ps: { text: string; href: string }[] = [];
  pieces(root, "", ps);
  let body = "";
  for (let i = 0; i < ps.length; i++) {
    const href = ps[i].href;
    if (!href) { body += ps[i].text; continue; }
    let words = ps[i].text;
    while (i + 1 < ps.length && ps[i + 1].href === href) { i += 1; words += ps[i].text; }
    const bare = words.replace(/\s+$/, "");
    if (!bare.trim() || sameAddress(bare, href)) { body += words; continue; }
    body += `${bare} (${href})${words.slice(bare.length)}`;
  }
  return body;
}

/**
 * The text of a .docx, links kept as "words (target)". Trimmed, as the route
 * always trimmed extractRawText's value; an empty document is "".
 */
export async function docxToText(buffer: Buffer): Promise<string> {
  const mammothModule: any = await import("mammoth");
  const mammoth = mammothModule.default ?? mammothModule;
  let tree: Element | null = null;
  await mammoth.convertToHtml({ buffer }, {
    transformDocument: (doc: Element) => {
      tree = doc;
      return { ...doc, children: [] };
    },
  });
  return tree ? toText(tree).trim() : "";
}
