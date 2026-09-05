"use client";

import { useCallback, useState } from "react";
import { upload as blobUpload } from "@vercel/blob/client";
import { FileText, AlertCircle, X } from "lucide-react";
import type { Attachment } from "@/lib/types/ai";

/**
 * File uploading for the chat composers — one implementation, two surfaces.
 *
 * WHY IT IS SHARED. This logic existed twice, byte for byte: once in
 * components/ai-writer/ChatInput.tsx (the in-conversation composer) and once
 * inline in app/engineai/page.tsx (the "What are you working on?" home
 * screen). Improving the upload UI in one of them left the other untouched,
 * and since the home screen is where a new chat with an attachment starts,
 * the change appeared to have done nothing at all. Duplicated UI does not
 * announce itself when it drifts; it just makes a fix look like it failed.
 *
 * PROGRESS IS REAL. @vercel/blob's client upload reports {loaded, total,
 * percentage} as bytes leave the browser. Nothing here animates to imply
 * movement that has not happened — a bar that invents progress is worse than
 * a spinner, because it makes a claim.
 */

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

export const isImage = (type: string) => (type || "").startsWith("image/");

/** A file between being chosen and being attached. */
export interface UploadJob {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Real proportion of bytes sent, 0-100. */
  progress: number;
  status: "queued" | "uploading" | "error";
  error?: string;
}

export function useFileUploads(onUploaded: (att: Attachment) => void) {
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  // Anything not yet failed still occupies the composer: send must not fire
  // while a file the user just chose is still on its way.
  const uploading = uploads.some((u) => u.status !== "error");

  const dismiss = useCallback(
    (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id)),
    []
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      // Everything chosen appears at once, oversized files already marked.
      // Skipping them silently behind a toast meant a five-file drop produced
      // four chips with nothing saying which was missing, or why.
      const jobs: UploadJob[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        status: file.size > MAX_FILE_SIZE ? "error" : "queued",
        error:
          file.size > MAX_FILE_SIZE
            ? `Too large (max ${formatSize(MAX_FILE_SIZE)})`
            : undefined,
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
            onUploadProgress: ({ percentage }) =>
              patch(job.id, { progress: Math.max(0, Math.min(100, percentage)) }),
          });

          // Private blobs: auth-gated proxy URL.
          onUploaded({
            url: `/api/media/file?path=${encodeURIComponent(blob.pathname)}`,
            name: file.name,
            type: file.type,
            size: file.size,
          });
          // Removed only after the finished chip exists, so the row never
          // flickers empty between the two.
          setUploads((prev) => prev.filter((u) => u.id !== job.id));
        } catch (err: any) {
          // Kept on screen as a failed chip rather than a toast that vanishes:
          // the user can see WHICH file failed and dismiss it deliberately.
          patch(job.id, { status: "error", error: err?.message || "Upload failed" });
        }
      }
    },
    [onUploaded]
  );

  return { uploads, uploading, uploadFiles, dismiss };
}

/** In-flight chips. The bar is the chip's own background filling left to
 *  right — it reads as the file arriving and costs no extra row in a composer
 *  that is already crowded. */
export function UploadChips({
  jobs,
  onDismiss,
}: {
  jobs: UploadJob[];
  onDismiss: (id: string) => void;
}) {
  if (!jobs.length) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
      {jobs.map((job) => {
        const failed = job.status === "error";
        return (
          <div
            key={job.id}
            className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs overflow-hidden ${
              // NOT text-destructive on bg-destructive/10: --destructive is a
              // DARK red in the dark theme, so that pairing renders dark red on
              // a near-black chip — measured 1.96:1, and 3.36:1 even in light.
              // Both fail WCAG AA at 12px. These measure 5.66:1 and 9.75:1.
              failed ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-muted"
            }`}
          >
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
              <span className="truncate max-w-[120px]" title={job.name}>
                {job.name}
              </span>
              <span className={failed ? "" : "text-muted-foreground"}>
                {failed
                  ? job.error
                  : job.status === "queued"
                    ? "Waiting"
                    : `${Math.round(job.progress)}%`}
              </span>
              {failed && (
                <button
                  onClick={() => onDismiss(job.id)}
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
  );
}
