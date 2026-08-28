"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { decideExternalContent, selectionAfterExternalContent } from "@/lib/editor/external-content";
import StarterKit from "@tiptap/starter-kit";
// Tables are not in StarterKit, and their absence was not cosmetic. Tiptap
// DISCARDS markup its schema cannot represent, so an imported Google Doc built
// on a table template lost that structure the moment it hit the editor — and
// the editor's text then no longer matched the text the optimiser's judge had
// been given, so every finding failed to anchor and was dropped as unlocatable.
// The writer saw "nothing outstanding" on a draft scoring 37/100.
//
// The invariant this restores is the important part: whatever is stored must
// round-trip through the editor unchanged, or anchoring silently returns
// nothing and looks like an empty result rather than a broken one.
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
// Images are not in StarterKit either, and their absence fails the same silent
// way tables did: ProseMirror DROPS a node type it has no schema for, so an
// uploaded document's figures vanish between import and editor with nothing
// logged. The optimiser scores what is in the editor, so a dropped image is
// also an image the alt-text criteria can never see.
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useCallback } from "react";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Undo,
  Redo,
  Minus,
  Quote,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  /**
   * Hands the editor instance to the parent once it exists.
   *
   * Needed for streaming: appending generated text has to go through
   * `insertContentAt`, because feeding each chunk back through `content` calls
   * `setContent`, which replaces the whole document — resetting the caret on
   * every chunk, destroying the undo stack, and reparsing half-formed HTML like
   * `<h2>Why This Ma` into a different shape on every frame.
   *
   * The parent must ALSO stop updating `content` while streaming, or the
   * effect below will fire a `setContent` and wipe the inserted nodes.
   */
  onReady?: (editor: Editor) => void;
  /** Debounce for onChange in ms. Streaming callers want this shorter than the 2s default. */
  debounceMs?: number;
  /**
   * Extra Tiptap extensions, appended to the base set.
   *
   * MUST be referentially stable — useEditor does not rebuild on a changed
   * extension array, so an inline literal here would be silently ignored on
   * every render after the first. Define it as a module constant.
   */
  extraExtensions?: any[];
}

export default function TiptapEditor({
  content,
  onChange,
  placeholder = "Start writing...",
  editable = true,
  onReady,
  debounceMs = 2000,
  extraExtensions,
}: TiptapEditorProps) {
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  // Refs so the unmount cleanup can flush without re-registering on every
  // render (which would defeat the point of an unmount-only effect).
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /**
   * The last HTML this editor reported upward.
   *
   * The parent stores it and hands it straight back as `content`, so without a
   * record of what we sent there is no way to tell our own text returning late
   * from a genuinely new document arriving. See lib/editor/external-content.ts:
   * treating the first as the second is what threw the caret to the end of the
   * document whenever a writer resumed typing just after a debounce fired.
   */
  const lastEmittedRef = useRef<string | null>(null);
  const emit = (html: string) => {
    lastEmittedRef.current = html;
    onChangeRef.current(html);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TableKit.configure({ table: { resizable: false } }),
      // inline:false — figures are block-level in an article. allowBase64 stays
      // OFF: uploaded images live in blob storage and are referenced by URL,
      // and a base64 image would ride the draft body through every autosave.
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
      ...(extraExtensions || []),
    ],
    content,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px] px-4 py-3",
      },
    },
    onUpdate: ({ editor }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        emit(editor.getHTML());
      }, debounceMs);
    },
    onBlur: ({ editor }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      emit(editor.getHTML());
    },
  });

  // Update content when it changes EXTERNALLY — which is not the same thing as
  // when it differs. See lib/editor/external-content.ts for the race and the
  // production measurement behind this.
  useEffect(() => {
    if (!editor) return;
    const decision = decideExternalContent(content, lastEmittedRef.current, editor.getHTML());
    if (!decision.apply) return;

    const hadFocus = editor.isFocused;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(content, { emitUpdate: false });
    // A writer whose caret was in this editor keeps it. setContent rebuilds the
    // document, so the position has to be re-applied and clamped: the new
    // document can be shorter than the old offset.
    const keep = selectionAfterExternalContent({ from, to }, editor.state.doc.content.size, hadFocus);
    if (keep) editor.commands.setTextSelection(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    editorRef.current = editor || null;
    if (editor && onReady) onReady(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // On unmount, FLUSH the pending save — do not cancel it.
  //
  // The first version cleared the timer, which discarded up to a full debounce
  // window of the writer's typing whenever they navigated away or the editor
  // unmounted. Losing someone's words is a worse failure than a late write, and
  // it is invisible: the text was on screen a moment ago and is simply gone.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (editorRef.current) {
          lastEmittedRef.current = editorRef.current.getHTML();
          onChangeRef.current(lastEmittedRef.current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!editor) return null;

  const ToolbarButton = ({
    onClick,
    isActive,
    children,
    title,
  }: {
    onClick: () => void;
    isActive?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded hover:bg-muted transition-colors",
        isActive && "bg-muted text-foreground"
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Toolbar */}
      {editable && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30 flex-wrap">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="Ordered List"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive("codeBlock")}
            title="Code Block"
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo"
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo"
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}
