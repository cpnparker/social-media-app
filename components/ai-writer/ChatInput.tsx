"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Send, Loader2, Paperclip, X, FileText, Upload, Square, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upload as blobUpload } from "@vercel/blob/client";
import type { Attachment } from "@/lib/types/ai";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/** Module scope, not the component body: uploadFiles is a useCallback created
 *  on the first render and would otherwise close over a binding declared
 *  further down it. That happens to work — the call comes after render — but it
 *  is a trip hazard, and neither of these depends on the component. */
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const isImage = (type: string) => type.startsWith("image/");

/** A file between being chosen and being attached. `progress` is the real
 *  proportion of bytes sent, reported by the blob client. */
interface UploadJob {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: "queued" | "uploading" | "error";
  error?: string;
}

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  /** Slot rendered inside the input container, bottom-left (for context controls) */
  bottomSlot?: ReactNode;
  /** Slot rendered bottom-right, just before the send button (e.g. voice mode) */
  endSlot?: ReactNode;
}

export interface ChatInputHandle {
  uploadFiles: (files: File[]) => Promise<void>;
  /** Put text in the box WITHOUT sending — the notebook's "ask about this"
   *  seeds a question for the user to finish. Distinct from ChatPanel's
   *  initialMessage, which auto-sends. */
  seedText: (text: string) => void;
}

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ onSend, onStop, disabled, isStreaming, placeholder = "Type your message...", bottomSlot, endSlot }, ref) {
    const [value, setValue] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
      []
    );
    /**
     * Files in flight, shown from the moment they are chosen.
     *
     * The old UI was a single boolean driving a spinner on the paperclip: no
     * filename, no size, no proportion, and the chip only appeared once the
     * upload had already finished. Against a 50MB limit that is a long blind
     * wait in which nothing distinguishes "still going" from "stuck", and a
     * failure surfaced as a toast that then vanished.
     *
     * Progress here is REAL — @vercel/blob's client upload reports
     * {loaded,total,percentage} as the bytes actually leave. Nothing is
     * animated to look like movement it hasn't made; a fake bar is worse than
     * a spinner, because it claims something.
     */
    const [uploads, setUploads] = useState<UploadJob[]>([]);
    // Anything not yet failed still occupies the input: the send button must
    // not fire while a file the user just chose is still on its way.
    const uploading = uploads.some((u) => u.status !== "error");
    const [isDragging, setIsDragging] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);

    // Auto-resize textarea
    useEffect(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 200) + "px";
      }
    }, [value]);

    // Shared file upload logic — uses client-side Vercel Blob upload
    // to bypass serverless function body size limits (4.5MB).
    // Files stream directly to blob storage; the server just issues a token.
    const uploadFiles = useCallback(async (files: File[]) => {
      if (!files.length) return;

      // Everything the user picked appears at once, the oversized ones already
      // marked as rejected. Silently skipping them — the old behaviour behind a
      // toast — meant a five-file drop could yield four chips with nothing
      // saying which one was missing or why.
      const jobs: UploadJob[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        status: file.size > MAX_FILE_SIZE ? "error" : "queued",
        error: file.size > MAX_FILE_SIZE ? `Too large (max ${formatSize(MAX_FILE_SIZE)})` : undefined,
      }));
      setUploads((prev) => [...prev, ...jobs]);

      const patch = (id: string, next: Partial<UploadJob>) =>
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...next } : u)));

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const job = jobs[i];
        if (job.status === "error") continue;

        patch(job.id, { status: "uploading" });
        try {
          const blob = await blobUpload(file.name, file, {
            access: "private",
            handleUploadUrl: "/api/media/upload",
            // The bar moves because bytes moved, not because time passed.
            onUploadProgress: ({ percentage }) =>
              patch(job.id, { progress: Math.max(0, Math.min(100, percentage)) }),
          });

          // Private blobs: use auth-gated proxy URL
          const url = `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;

          setPendingAttachments((prev) => [
            ...prev,
            { url, name: file.name, type: file.type, size: file.size },
          ]);
          // Only now does the in-flight chip give way to the finished one, so
          // the row never flickers empty between the two.
          setUploads((prev) => prev.filter((u) => u.id !== job.id));
        } catch (err: any) {
          // Kept on screen as a failed chip rather than announced in a toast
          // that disappears. The user can see WHICH file failed, and dismiss it.
          patch(job.id, {
            status: "error",
            error: err?.message || "Upload failed",
          });
        }
      }
    }, []);

    // Expose uploadFiles + seedText to parent via ref
    const seedText = useCallback((text: string) => {
      // Append rather than replace: seeding must never eat something the user
      // was midway through typing.
      setValue((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      });
    }, []);
    useImperativeHandle(ref, () => ({ uploadFiles, seedText }), [uploadFiles, seedText]);

    const handleSubmit = () => {
      const trimmed = value.trim();
      if ((!trimmed && pendingAttachments.length === 0) || disabled || uploading)
        return;
      onSend(
        trimmed,
        pendingAttachments.length > 0 ? pendingAttachments : undefined
      );
      setValue("");
      setPendingAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    const handleFileSelect = async (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const files = e.target.files;
      if (!files?.length) return;
      await uploadFiles(Array.from(files));
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    // Drag & drop handlers
    const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setIsDragging(true);
      }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    }, []);

    const handleDrop = useCallback(
      async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          await uploadFiles(files);
        }
      },
      [uploadFiles]
    );

    const removeAttachment = (index: number) => {
      setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
    };


    return (
      <div
        className="bg-background px-2 sm:px-3 pb-2 sm:pb-3 pt-1.5 relative safe-bottom"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-1 z-10 flex items-center justify-center bg-foreground/[0.03] border-2 border-dashed border-foreground/20 rounded-lg">
            <div className="flex flex-col items-center gap-1.5 text-foreground/50">
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">Drop files here</span>
            </div>
          </div>
        )}

        {/* In-flight uploads — shown from the moment the file is chosen, so the
            wait is legible: which file, how big, how far, and what failed. */}
        {uploads.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap max-w-[46rem] mx-auto mb-2 px-1">
            {uploads.map((job) => {
              const failed = job.status === "error";
              return (
                <div
                  key={job.id}
                  className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs overflow-hidden ${
                    // NOT text-destructive on bg-destructive/10: --destructive is
                    // a DARK red in the dark theme, so that pairing renders dark
                    // red text on a near-black chip — measured at 1.96:1, and
                    // 3.36:1 even in light mode. Both fail WCAG AA for 12px text.
                    // These fixed reds measure 5.66:1 light and 9.75:1 dark.
                    failed ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-muted"
                  }`}
                >
                  {/* The bar is the chip's own background filling left to right,
                      rather than a separate track — it reads as the file
                      arriving, and needs no extra row in a crowded input. */}
                  {!failed && (
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/20 transition-[width] duration-200 ease-out"
                      style={{ width: `${job.progress}%` }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-center gap-1.5">
                    {failed ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate max-w-[120px]" title={job.name}>{job.name}</span>
                    <span className={failed ? "" : "text-muted-foreground"}>
                      {failed
                        ? job.error
                        : job.status === "queued"
                          ? "Waiting"
                          : `${Math.round(job.progress)}%`}
                    </span>
                    {failed && (
                      <button
                        onClick={() => setUploads((prev) => prev.filter((u) => u.id !== job.id))}
                        className="h-4 w-4 rounded-full hover:bg-background/50 flex items-center justify-center shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                        aria-label={`Dismiss ${job.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <span className="sr-only" role="status">
                    {failed
                      ? `${job.name} failed to upload: ${job.error}`
                      : `Uploading ${job.name}, ${Math.round(job.progress)} percent`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Attachment preview strip */}
        {pendingAttachments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap max-w-[46rem] mx-auto mb-2 px-1">
            {pendingAttachments.map((att, i) => (
              <div
                key={`${att.name}-${i}`}
                className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5 text-xs group"
              >
                {isImage(att.type) ? (
                  <img
                    src={att.url}
                    alt={att.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="truncate max-w-[120px]">{att.name}</span>
                <span className="text-muted-foreground">
                  {formatSize(att.size)}
                </span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="h-4 w-4 rounded-full hover:bg-background flex items-center justify-center shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input container — unified border wrapping textarea + toolbar */}
        <div className="max-w-[46rem] mx-auto rounded-2xl border border-foreground/10 bg-background shadow-sm focus-within:ring-2 focus-within:ring-foreground/20 focus-within:shadow-md transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2.5 text-[16px] focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
            style={{ minHeight: "40px", maxHeight: "200px" }}
          />
          {/* Toolbar row — attach, context slot, send */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Attach file"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
              </Button>
              {bottomSlot}
            </div>
            <div className="flex items-center gap-1">
            {endSlot}
            {isStreaming && onStop ? (
              <Button
                size="icon"
                onClick={onStop}
                className="h-8 w-8 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/80"
                title="Stop generating"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={
                  disabled ||
                  uploading ||
                  (!value.trim() && pendingAttachments.length === 0)
                }
                className="h-8 w-8 rounded-lg bg-foreground text-background hover:bg-foreground/80"
              >
                {disabled ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            </div>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.rtf,.json,.xml,.tsv,.html,.txt,.csv,.md"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }
);

export default ChatInput;
