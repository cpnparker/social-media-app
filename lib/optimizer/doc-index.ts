/**
 * Mapping plain-text offsets to ProseMirror positions.
 *
 * anchors.ts locates a finding by offset into a plain string. The editor needs
 * a ProseMirror position. These are NOT the same number and never differ by a
 * constant: block open/close tokens consume positions, whitespace is collapsed
 * in the plain text but not in the document, and some document content
 * contributes no plain text at all.
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT is not a crash. Treating a
 * text offset as a position, or mis-handling one construct, produces a
 * highlight that lands a few characters off — often exactly one, dropping a
 * sentence's final period. Apply then rewrites the sentence and eats its
 * punctuation. Nothing throws, nothing looks wrong in the panel, and the
 * writer's text is quietly damaged.
 *
 * THE CORRESPONDENCE IS ASSERTED, NOT ASSUMED. `text` here must be
 * byte-identical to `ParsedDraft.text` for the same document, because that is
 * the string anchors.ts searched. Two separate implementations reconstructing
 * "the plain text of this document" will drift the moment one of them is
 * edited — and this already happened once: the parser was changed to
 * substitute a space for a tag rather than nothing, which silently invalidated
 * every assumption a hand-verified index would have been built on. So
 * scripts/verify-optimizer-doc-index.ts asserts equality directly, and that
 * assertion is the only thing keeping the two in step.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

/** One run of text: its ProseMirror range and its plain-text range. */
export interface TextSpan {
  from: number;
  to: number;
  textStart: number;
  textEnd: number;
}

export interface DocIndex {
  /** Byte-identical to ParsedDraft.text for the same document. */
  text: string;
  /** Ascending, non-overlapping, ordered by textStart. */
  spans: TextSpan[];
}

/**
 * Node types whose text parse.ts removes before it builds any block, so it must
 * not appear here either. A fenced code sample full of "%" and "according to"
 * would otherwise fabricate statistics — and, worse, shift every offset after
 * it.
 */
const OPAQUE_BLOCK_TYPES: { [k: string]: boolean } = { codeBlock: true };

/** Node types that open a new plain-text block (joined by a blank line). */
const BLOCK_TYPES: { [k: string]: boolean } = {
  paragraph: true, heading: true, listItem: true, blockquote: true,
  tableRow: true, horizontalRule: false,
};

export function buildDocIndex(doc: PMNode): DocIndex {
  interface Run { from: number; to: number; text: string }
  const blocks: Run[][] = [];
  let current: Run[] | null = null;
  let inOpaque = 0;

  const openBlock = () => {
    if (current && current.length > 0) blocks.push(current);
    current = [];
  };

  doc.descendants((node, pos) => {
    const typeName = node.type.name;

    if (OPAQUE_BLOCK_TYPES[typeName]) {
      inOpaque++;
      // Returning false skips the subtree, but descendants() gives no exit
      // hook, so the counter is decremented immediately — safe because the
      // subtree is never visited.
      inOpaque--;
      return false;
    }
    if (inOpaque > 0) return false;

    // A container that holds other blocks (bulletList, orderedList, table)
    // does not itself open one; its children do.
    if (BLOCK_TYPES[typeName]) {
      // A listItem wrapping a paragraph must not open twice. Only open when
      // this node has inline content directly, or is a leaf-ish container whose
      // first child is inline.
      const firstChild = node.childCount > 0 ? node.child(0) : null;
      const holdsInline = node.inlineContent || (firstChild != null && firstChild.isText);
      if (holdsInline) openBlock();
      else if (typeName === "listItem" || typeName === "blockquote" || typeName === "tableRow") {
        // Containers whose CHILD paragraphs would otherwise each open a block:
        // parse.ts folds those into one block (the container-precedence rule),
        // so open here and let the children append.
        openBlock();
        return true;
      }
      return true;
    }

    if (node.isText && node.text) {
      if (!current) openBlock();
      (current as Run[]).push({ from: pos, to: pos + node.nodeSize, text: node.text });
      return false;
    }

    if (typeName === "hardBreak") {
      // parse.ts substitutes a SPACE for every tag, so a <br> contributes one.
      // It was previously the empty string, which glued "one" and "two" into
      // "onetwo" — see the note in parse.ts stripTags.
      if (!current) openBlock();
      (current as Run[]).push({ from: pos, to: pos + node.nodeSize, text: " " });
      return false;
    }

    return true;
  });
  if (current && (current as Run[]).length > 0) blocks.push(current as Run[]);

  // Assemble, reproducing stripTags: collapse whitespace runs, trim each block,
  // join blocks with a blank line, drop blocks that are empty after trimming.
  let text = "";
  const spans: TextSpan[] = [];

  for (let b = 0; b < blocks.length; b++) {
    const runs = blocks[b];
    const pieces: { from: number; to: number; text: string }[] = [];
    let raw = "";
    for (let r = 0; r < runs.length; r++) raw += runs[r].text;
    if (!raw.replace(/\s+/g, " ").trim()) continue;

    if (text.length > 0) text += "\n\n";

    // Walk the block's characters once, emitting the collapsed form and
    // recording where each surviving character came from.
    let lastWasSpace = true; // leading whitespace is trimmed
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      let spanStart = -1;
      let spanFrom = -1;
      for (let i = 0; i < run.text.length; i++) {
        const ch = run.text[i];
        const isSpace = /\s/.test(ch);
        if (isSpace) {
          if (lastWasSpace) continue;
          if (spanStart >= 0) {
            spans.push({ from: spanFrom, to: run.from + i, textStart: spanStart, textEnd: text.length });
            spanStart = -1;
          }
          text += " ";
          lastWasSpace = true;
          continue;
        }
        if (spanStart < 0) { spanStart = text.length; spanFrom = run.from + i; }
        text += ch;
        lastWasSpace = false;
      }
      if (spanStart >= 0) {
        spans.push({ from: spanFrom, to: run.to, textStart: spanStart, textEnd: text.length });
      }
      void pieces;
    }
    // Trailing whitespace inside a block is trimmed by stripTags.
    while (text.length > 0 && text[text.length - 1] === " ") text = text.slice(0, -1);
  }

  return { text, spans };
}

/**
 * Convert a plain-text offset range to a ProseMirror range.
 *
 * Returns null rather than a best guess when the range cannot be resolved. A
 * null loses a highlight; a guess rewrites the wrong text.
 */
export function textRangeToPos(index: DocIndex, textStart: number, textEnd: number): { from: number; to: number } | null {
  if (textEnd <= textStart) return null;
  let from = -1;
  let to = -1;

  for (let i = 0; i < index.spans.length; i++) {
    const s = index.spans[i];
    if (from < 0 && textStart >= s.textStart && textStart < s.textEnd) {
      from = s.from + (textStart - s.textStart);
    }
    if (textEnd > s.textStart && textEnd <= s.textEnd) {
      to = s.from + (textEnd - s.textStart);
    }
    if (from >= 0 && to >= 0) break;
  }

  if (from < 0 || to < 0 || to <= from) return null;
  return { from, to };
}
