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
import { Send, Loader2, Paperclip, X, FileText, Upload } from "lucide-react";
import { upload as blobUpload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Attachment } from "@/lib/types/ai";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Slot rendered inside the input container, bottom-left (for context controls) */
  bottomSlot?: ReactNode;
}

export interface ChatInputHandle {
  uploadFiles: (files: File[]) => Promise<void>;
}

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ onSend, disabled, placeholder = "Type your message...", bottomSlot }, ref) {
    const [value, setValue] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
      []
    );
    const [uploading, setUploading] = useState(false);
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
    // to bypass serverless function body size limits
    const uploadFiles = useCallback(async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} is too large. Maximum size is 20MB.`);
          continue;
        }
        try {
          const blob = await blobUpload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/media/upload",
          });

          setPendingAttachments((prev) => [
            ...prev,
            {
              url: blob.url,
              name: file.name,
              type: file.type,
              size: file.size,
            },
          ]);
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }

      setUploading(false);
    }, []);

    // Expose uploadFiles to parent via ref
    useImperativeHandle(ref, () => ({ uploadFiles }), [uploadFiles]);

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

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

    const isImage = (type: string) => type.startsWith("image/");

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

        {/* Attachment preview strip */}
        {pendingAttachments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap max-w-4xl mx-auto mb-2 px-1">
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
        <div className="max-w-4xl mx-auto rounded-xl border bg-background focus-within:ring-1 focus-within:ring-foreground/15 focus-within:border-foreground/20 transition-shadow">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-base focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
                className="h-8 w-8 text-muted-foreground/50 hover:text-foreground"
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
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.txt,.csv,.md"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }
);

export default ChatInput;
