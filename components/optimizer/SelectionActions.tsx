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

import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { MessageSquare, PenLine, Scissors, Target } from "lucide-react";

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

export default function SelectionActions({ editor, onAsk, onDiscuss, enabled }: Props) {
  if (!editor) return null;

  const passage = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n").trim();
  };

  const act = (kind: "rewrite" | "tighten" | "specific") => {
    const p = passage();
    if (!p) return;
    onAsk(instruction(kind, p));
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed, from, to }) => {
        // Not while a draft is streaming: the text is moving under the cursor,
        // and a toolbar over words about to be replaced invites acting on
        // something that will not be there.
        if (!enabled) return false;
        if (from === to) return false;
        // A selection with no words in it — an image, a rule — has nothing to
        // rewrite. Same predicate the Apply button learned to respect.
        return ed.state.doc.textBetween(from, to, "\n").trim().length > 0;
      }}
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg"
    >
      <button
        onClick={() => act("rewrite")}
        title="Rewrite this passage with AI"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-muted"
      >
        <PenLine className="h-3 w-3" />
        Rewrite
      </button>
      <button
        onClick={() => act("tighten")}
        title="Same meaning, fewer words"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-muted"
      >
        <Scissors className="h-3 w-3" />
        Tighten
      </button>
      <button
        onClick={() => act("specific")}
        title="Replace what is asserted with something verifiable"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium hover:bg-muted"
      >
        <Target className="h-3 w-3" />
        Make specific
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        onClick={onDiscuss}
        title="Open the conversation with this passage"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MessageSquare className="h-3 w-3" />
        Ask
      </button>
    </BubbleMenu>
  );
}
