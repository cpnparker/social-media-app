"use client";

/**
 * What you can do with a passage, at the passage.
 *
 * The studio's actions all lived in the right-hand rail, which meant improving
 * a sentence you were looking at required leaving it: switch tab, find the
 * conversation, describe the sentence in words, wait. This is the same set of
 * actions, offered where the writer already is.
 *
 * ── EVERY ACTION GOES THROUGH THE CONVERSATION ──────────────────────────────
 *
 * None of these call a model directly, and that is deliberate. A rewrite fired
 * off on its own would be a second, silent path to the same work — with its own
 * spend, its own prompt, and no record. Routed through Discuss instead, every
 * one of them lands in the thread: the writer sees what was asked, can disagree
 * with the answer, and the next question still has the argument behind it. It
 * also means each reply comes back anchored, so "Replace that passage" already
 * works on it.
 *
 * ── WHY THESE FOUR ──────────────────────────────────────────────────────────
 *
 * They are the three things the rubric complains about most, plus a way in to
 * the conversation. Tighten (sentence-length-norm, ai-tell-guard), Make
 * specific (unverifiable-superlatives, promotional-claims, stat-source-
 * adjacency) and Rewrite are what the model itself kept recommending on real
 * drafts. A menu of eight would be a menu nobody reads.
 */

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { BookA, MessageSquare, PenLine, Scissors, Target } from "lucide-react";
import { isSingleWord, sentenceAround, occurrenceIndex, buildThesaurusAsk } from "@/lib/optimizer/thesaurus";

interface Props {
  editor: Editor | null;
  /** Send a question to the conversation, which is where every action lands. */
  onAsk: (text: string) => void;
  /** Open the conversation with this passage loaded, and ask nothing yet. */
  onDiscuss: () => void;
  /** False while a draft is streaming in — the text is moving under the cursor. */
  enabled: boolean;
}

/**
 * The instruction sent for each action.
 *
 * Each one asks for the passage in an anchor block and the replacement in a
 * draft block, so what comes back is applicable IN PLACE rather than being one
 * more paragraph of advice to retype.
 */
function instruction(kind: "rewrite" | "tighten" | "specific", passage: string): string {
  const tail =
    `\n\n"${passage}"\n\n` +
    `Put the passage in an anchor block and the replacement in a draft block, so I can apply it in place. ` +
    `If you think it should not change, say so instead of rewriting it.`;
  if (kind === "tighten") {
    return `Tighten this passage. Same meaning, fewer words, and keep the specifics.${tail}`;
  }
  if (kind === "specific") {
    return (
      `Make this passage specific. Replace anything asserted with something verifiable — a number, ` +
      `a named source, a date, a place — using facts already present in the draft or the background ` +
      `material. Do NOT invent a figure: if the claim needs one you do not have, say what is needed ` +
      `rather than making it up.${tail}`
    );
  }
  return `Rewrite this passage so it is stronger, and tell me what you changed and why.${tail}`;
}

/**
 * Positioned by hand rather than through Tiptap's BubbleMenu.
 *
 * BubbleMenu did not mount at all here — no element, hidden or otherwise — and
 * two rounds of guessing at a v3 API that is barely documented is worse value
 * than forty lines that do exactly what is needed. coordsAtPos returns VIEWPORT
 * coordinates, so the toolbar is position:fixed and needs no assumptions about
 * which ancestor is the offset parent.
 */
export default function SelectionActions({ editor, onAsk, onDiscuss, enabled }: Props) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    if (!editor || !enabled) { setBox(null); return; }
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) { setBox(null); return; }
    // A selection with no words in it — an image, a rule — has nothing to
    // rewrite. The same predicate the Apply button had to learn.
    if (!editor.state.doc.textBetween(from, to, "\n").trim()) { setBox(null); return; }
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const left = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
      setBox({ top: Math.min(start.top, end.top), left });
    } catch {
      setBox(null);
    }
  }, [editor, enabled]);

  useEffect(() => {
    if (!editor) return;
    // selectionUpdate covers keyboard and programmatic changes; transaction
    // covers the rest, since a drag ends without necessarily firing the first.
    editor.on("selectionUpdate", recompute);
    editor.on("transaction", recompute);
    editor.on("blur", recompute);
    const onScroll = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    recompute();
    return () => {
      editor.off("selectionUpdate", recompute);
      editor.off("transaction", recompute);
      editor.off("blur", recompute);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [editor, recompute]);

  if (!editor || !box) return null;

  const passage = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n").trim();
  };

  /**
   * Whether the writer has one word selected.
   *
   * Recomputed on the same events as the toolbar's position, because the label
   * on the button changes with it: a button that says Rewrite and asks for
   * synonyms is a worse lie than one that says neither.
   */
  const oneWord = isSingleWord(passage());

  const act = (kind: "rewrite" | "tighten" | "specific") => {
    const p = passage();
    if (!p) return;

    // A single word is not a passage to rewrite, it is a word to look up.
    // "Rewrite this passage so it is stronger" with one word attached is not a
    // question anyone means to ask.
    if (kind === "rewrite" && isSingleWord(p)) {
      const $from = editor.state.selection.$from;
      // The block's own text and the offset inside it, so the sentence search
      // cannot wander into the paragraph above.
      const para = $from.parent.textContent || "";
      const at = $from.parentOffset;
      const sentence = sentenceAround(para, at) || p;
      onAsk(
        buildThesaurusAsk({
          word: p,
          sentence,
          occurrence: occurrenceIndex(sentence, p, Math.max(0, at - para.indexOf(sentence))),
        })
      );
      return;
    }
    onAsk(instruction(kind, p));
  };

  const Item = ({
    onClick,
    title,
    icon,
    label,
    muted,
  }: { onClick: () => void; title: string; icon: React.ReactNode; label: string; muted?: boolean }) => (
    <button
      // onMouseDown, not onClick: a click steals focus from the editor first,
      // which collapses the selection — and every action here is about the
      // selection. preventDefault keeps it intact.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-muted " +
        (muted ? "text-muted-foreground hover:text-foreground" : "")
      }
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg"
      style={{ top: Math.max(8, box.top - 44), left: box.left, transform: "translateX(-50%)" }}
      role="toolbar"
      aria-label="Actions for the selected passage"
    >
      <Item
        onClick={() => act("rewrite")}
        title={oneWord ? "Alternatives for this word, in this sentence" : "Rewrite this passage with AI"}
        icon={oneWord ? <BookA className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
        label={oneWord ? "Alternatives" : "Rewrite"}
      />
      {/* Both are about a passage. On one word, Tighten has nothing to shorten
          and Make specific has nothing to verify, so offering them is offering
          two buttons that come back saying there was nothing to do. */}
      {!oneWord && (
        <>
          <Item onClick={() => act("tighten")} title="Same meaning, fewer words" icon={<Scissors className="h-3 w-3" />} label="Tighten" />
          <Item onClick={() => act("specific")} title="Replace what is asserted with something verifiable" icon={<Target className="h-3 w-3" />} label="Make specific" />
        </>
      )}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <Item onClick={onDiscuss} title="Open the conversation with this passage" icon={<MessageSquare className="h-3 w-3" />} label="Ask" muted />
    </div>
  );
}
