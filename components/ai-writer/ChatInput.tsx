"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Send, Loader2, Paperclip, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Attachment } from "@/lib/types/ai";

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = "Type your message...",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((!trimmed && pendingAttachments.length === 0) || disabled || uploading) return;
    onSend(trimmed, pendingAttachments.length > 0 ? pendingAttachments : undefined);
    setValue("");
    setPendingAttachments([]);
    // Reset height
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || `Failed to upload ${file.name}`);
          continue;
        }

        const data = await res.json();
        setPendingAttachments((prev) => [
          ...prev,
          {
            url: data.url,
            name: file.name,
            type: file.type,
            size: file.size,
          },
        ]);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    setUploading(false);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
    <div className="border-t bg-background p-2 sm:p-3">
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
              <span className="text-muted-foreground">{formatSize(att.size)}</span>
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

      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        {/* Attach button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="shrink-0 h-11 w-11 text-muted-foreground hover:text-foreground"
          title="Attach file"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.txt,.csv,.md"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
            style={{ minHeight: "44px", maxHeight: "200px" }}
          />
        </div>
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={disabled || uploading || (!value.trim() && pendingAttachments.length === 0)}
          className="shrink-0 h-11 w-11"
        >
          {disabled ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="text-xs md:text-[10px] text-muted-foreground text-center mt-1.5 hidden sm:block">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
