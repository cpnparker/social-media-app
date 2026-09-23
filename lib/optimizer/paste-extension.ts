/**
 * The paste box's one door: every paste and every drop goes through
 * classifyPaste, the same conversion the import route runs, and the result is
 * inserted into a real editor that the writer can then trim without losing
 * anything.
 *
 * WHY THE BOX IS AN EDITOR NOW. The box was a <textarea>, and a textarea can
 * only hold text — so the clipboard's HTML was kept beside it and used only
 * while the textarea still EQUALLED the clipboard's text/plain. That rule lost
 * the structure two ways, both measured in Chrome against the real component
 * on 2026-09-23:
 *
 *   - with no edit at all, on every paste whose text/plain uses \r\n or a lone
 *     \r (Chrome on Windows writes CRLF for any copied web page; Word and
 *     Outlook on Windows do the same), because the textarea normalises line
 *     endings in its value and DataTransfer.getData does not;
 *   - on any edit whatsoever — trimming the title off the top, deleting a
 *     stray line, pasting a second time — because the HTML could not follow
 *     an edit made to text.
 *
 * The only signal either time was grey hint text reading "plain text".
 *
 * The alternatives, and why not them:
 *   - normalise the line endings and keep the equality rule: fixes the first
 *     bullet and leaves the second exactly as it was. A writer trimming a
 *     title is the ordinary case, not an edge.
 *   - map textarea edits back onto the HTML (diff the text, delete the
 *     matching range from the markup): a text offset has no exact home in
 *     markup, and a mapping that is right most of the time fails silently —
 *     the failure this whole change exists to remove.
 *   - import on paste and do the trimming in the studio: the editor is real,
 *     but a session is minted for every accidental or partial paste, two
 *     pastes can no longer be combined before importing, and the screen
 *     jumps away mid-gesture.
 *   - a bare contenteditable holding the sanitised HTML: the browser writes
 *     its own markup as the writer edits (divs, styled spans) and nothing
 *     renders it with the editor's schema, so what the writer sees is not
 *     what the studio will hold.
 *
 * So the box is the studio's own editor (components/content/TiptapEditor,
 * same extensions, same schema) with this plugin in front of its paste
 * handling. What the writer sees in the box is what the import stores; the
 * headings are visible AS headings before they press Open; and an edit is an
 * edit to structured content, which is the only kind that cannot lose it.
 *
 * SANITISATION IS NOT WEAKENED. ProseMirror's own paste parser is never given
 * the clipboard's HTML to insert: handlePaste converts it through
 * sanitizeImportedHtml (via classifyPaste → toEditorHtml) and hands ProseMirror
 * only that output, so the whitelist that guarded the import route is the only
 * door into the box too — and the route runs it again on what the box sends.
 * transformPastedHTML is a backstop for the one path handlePaste cannot see: a
 * browser with no clipboardData, where ProseMirror captures the paste through
 * the DOM.
 *
 * WHERE A PASTE LANDS is ProseMirror's decision, not ours. The first version
 * inserted the converted HTML with insertContent, which places whole CLOSED
 * blocks — so every paste was at least a paragraph. "brand-new " pasted after
 * "The north pier was " split the sentence into three paragraphs; a plain
 * question pasted over a selected H2's text turned the heading into a
 * paragraph (6 headings → 5); one word pasted over "customs" inside an H2
 * split it into "What stone was used to build the old " / harbour / " house?"
 * (6 → 7). Measured in Chrome against the real box, 2026-09-23. Headings not
 * surviving "paste into a selection" is the incident's failure in miniature.
 * The converted HTML is now handed back to ProseMirror's OWN paste pipeline
 * (view.pasteHTML), which parses it in the context of the selection and opens
 * the slice as far as it will go — so a one-paragraph paste joins the line it
 * lands in, a heading keeps its type when its whole text is replaced (it is
 * `defining`), and a multi-block paste still arrives as blocks. That call
 * re-enters handlePaste with the slice ProseMirror built, and the inner pass
 * dispatches it with the record; the outer pass never inserts anything.
 *
 * THE RECORD IS PART OF THE DOCUMENT. Whether this box's content could have
 * carried the source's headings is an attribute of the doc node, written by
 * the SAME transaction that inserts the paste (a DocAttrStep). It lived beside
 * the editor in React state first, set only on paste transactions — and undo
 * and redo carry no such marker, so an undo that brought a plain paste back
 * brought it back without its record: no warning, no claim, and the studio
 * said "0 of 0 headings are question-shaped", the incident's exact output.
 * A step in the transaction is undone and redone WITH the content, by
 * prosemirror-history, because it is the same history event. Emptying the box
 * clears the record in an appended transaction, which history groups with the
 * edit that emptied it — so undoing the delete restores both.
 */

import { Extension, getHTMLFromFragment, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { classifyPaste, normaliseStructureUnseen, promoteLineToHeading, type HeadingOffer, type PasteResult, type StructureUnseenReason } from "./import-structure";
import { sanitizeImportedHtml } from "./import-html";

/** The doc attribute holding the box's record. */
export const PASTE_RECORD_ATTR = "structureUnseen";

/** The box's record: why its content could not have carried the source's
 *  headings, or null. Read from the document, which is the only place it is
 *  kept — see THE RECORD IS PART OF THE DOCUMENT above. */
export function pasteRecordOf(doc: PMNode): StructureUnseenReason | null {
  return normaliseStructureUnseen(doc.attrs ? doc.attrs[PASTE_RECORD_ATTR] : null);
}

/** Holds nothing a writer could import: no word, no figure. */
function holdsNothing(doc: PMNode): boolean {
  let found = false;
  doc.descendants((n) => {
    if (found) return false;
    if (n.isText ? !!(n.text || "").trim() : n.isLeaf && n.type.name !== "hardBreak") found = true;
    return !found;
  });
  return !found;
}

export const ImportPaste = Extension.create({
  name: "optimizerImportPaste",

  addGlobalAttributes() {
    return [{
      types: ["doc"],
      attributes: { [PASTE_RECORD_ATTR]: { default: null, rendered: false } },
    }];
  },

  addProseMirrorPlugins() {
    /**
     * Set only while this plugin has re-entered ProseMirror's paste pipeline
     * with its own conversion: the inner handlePaste consumes it and inserts
     * the slice ProseMirror built. Cleared in a finally, so a paste another
     * plugin claims in the inner pass (a URL over a selection, cells into a
     * table) cannot leave it armed for the next one.
     */
    let inner: { res: PasteResult; replacesAll: boolean } | null = null;

    const insert = (view: EditorView, res: PasteResult, replacesAll: boolean): void => {
      if (!res.html && res.inline === null) return;
      inner = { res, replacesAll };
      try {
        if (res.inline !== null) view.pasteText(res.inline);
        else view.pasteHTML(res.html);
      } finally {
        inner = null;
      }
    };

    return [
      new Plugin({
        key: new PluginKey("optimizerImportPaste"),
        props: {
          handlePaste(view, event, slice) {
            if (inner) {
              // THE INNER PASS. `slice` is ProseMirror's parse of OUR
              // conversion, in the selection's context. Inserted exactly as
              // ProseMirror's doPaste inserts one, with the record written in
              // the same transaction. No uiEvent: Tiptap's paste rules would
              // rewrite the one door's output (asterisks into italics) after
              // the fact.
              const { res, replacesAll } = inner;
              inner = null;
              const cur = pasteRecordOf(view.state.doc);
              const next = replacesAll ? res.structureUnseen : cur || res.structureUnseen;
              const single = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;
              const tr = single
                ? view.state.tr.replaceSelectionWith(single, res.inline !== null)
                : view.state.tr.replaceSelection(slice);
              if (next !== cur) tr.setDocAttribute(PASTE_RECORD_ATTR, next);
              view.dispatch(tr.scrollIntoView().setMeta("paste", true));
              return true;
            }
            const cd = event.clipboardData;
            if (!cd) return false;
            const { from, to } = view.state.selection;
            const size = view.state.doc.content.size;
            // A paste over everything (an empty box, or the whole document
            // selected) starts the record again; a paste added to what is
            // there keeps whatever an earlier one lost.
            const replacesAll = holdsNothing(view.state.doc) || (from <= 1 && to >= size - 1);
            insert(view, classifyPaste({ html: cd.getData("text/html"), text: cd.getData("text/plain") }), replacesAll);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            // A drag INSIDE the box is ProseMirror moving its own nodes.
            if (moved) return false;
            const dt = event.dataTransfer;
            if (!dt) return false;
            const html = dt.getData("text/html");
            const text = dt.getData("text/plain");
            if (!html && !text) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at) return false;
            event.preventDefault();
            // A drop is a paste at the drop point: the same door, the same
            // placement rules. Moving the caret is a selection-only
            // transaction, which history does not record.
            const replacesAll = holdsNothing(view.state.doc);
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
            insert(view, classifyPaste({ html, text }), replacesAll);
            view.focus();
            return true;
          },
          transformPastedHTML(html) {
            return sanitizeImportedHtml(html);
          },
        },
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged)) return null;
          if (pasteRecordOf(state.doc) === null || !holdsNothing(state.doc)) return null;
          return state.tr.setDocAttribute(PASTE_RECORD_ATTR, null);
        },
      }),
    ];
  },
});

/**
 * Accept one offered question heading, in the studio's editor.
 *
 * Replaces ONLY the paragraph holding the line, never the document. The
 * studio's judge findings are decorations mapped through each transaction
 * (lib/optimizer/highlight-plugin.ts); a whole-document setContent collapses
 * every mapped range, so accepting one heading would have orphaned every
 * finding already paid for. A replacement scoped to one block maps everything
 * outside it untouched, and it is one step on the undo stack.
 *
 * The paragraph is serialised with the editor's own schema and handed to the
 * same pure promoteLineToHeading the offer was computed with, so the line is
 * matched by exactly the rule that found it. False when the line is no longer
 * in the document — the draft moves between offering and clicking.
 */
export function applyHeadingOffer(editor: Editor, offer: HeadingOffer): boolean {
  let target: { from: number; to: number; html: string } | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (target || node.type.name !== "paragraph") return;
    const next = promoteLineToHeading(getHTMLFromFragment(Fragment.from(node), editor.schema), offer);
    if (next) target = { from: offset, to: offset + node.nodeSize, html: next };
  });
  if (!target) return false;
  const t: { from: number; to: number; html: string } = target;
  return editor.chain().insertContentAt({ from: t.from, to: t.to }, t.html).run();
}
