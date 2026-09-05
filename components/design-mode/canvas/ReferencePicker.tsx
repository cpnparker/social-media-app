"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Upload, ImageIcon, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";

interface ReferencePickerProps {
  /** All shots in the session — used to harvest already-generated images as candidate references. */
  shots: DesignShot[];
  /** Don't show shots from the current shot as candidates. */
  excludeShotId?: string | null;
  onUpload: (file: File) => void;
  onPickAsset: (assetId: string, blobUrl: string) => void;
}

/**
 * The Inspector's References "+" button. Click opens a popover with two paths:
 *   - Upload an image file
 *   - Pick an existing canvas asset (any image from any prior shot version
 *     in this session — useful for character/style consistency).
 */
export function ReferencePicker({ shots, excludeShotId, onUpload, onPickAsset }: ReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "canvas">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset tab when opening
  useEffect(() => {
    if (open) setTab("upload");
  }, [open]);

  // Gather every still image asset from other shots' versions
  const candidates = useCallback(() => {
    const items: Array<{ assetId: string; assetUrl: string; shotIdx: number; shotTitle: string; vIdx: number }> = [];
    for (const s of shots) {
      if (s.id === excludeShotId) continue;
      for (const v of s.versions) {
        if (v.assetType === "image" && v.assetUrl && v.assetId) {
          items.push({
            assetId: v.assetId,
            assetUrl: v.assetUrl,
            shotIdx: s.idx,
            shotTitle: s.title,
            vIdx: v.idx,
          });
        }
      }
    }
    return items.reverse(); // newest first
  }, [shots, excludeShotId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex aspect-square items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:text-[hsl(var(--design-accent))] hover:border-[hsl(var(--design-accent))]"
          style={{ borderColor: "hsl(var(--design-border-strong))" }}
          title="Add reference"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="design-mode w-80 p-0">
        <div className="flex border-b" style={{ borderColor: "hsl(var(--design-border))" }}>
          <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
            <Upload className="mr-1 h-3 w-3" /> Upload
          </TabButton>
          <TabButton active={tab === "canvas"} onClick={() => setTab("canvas")}>
            <FolderOpen className="mr-1 h-3 w-3" /> Pick from canvas
          </TabButton>
        </div>

        {tab === "upload" ? (
          <div className="p-4 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  onUpload(f);
                  setOpen(false);
                }
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed p-6 text-[11.5px] text-muted-foreground transition-colors hover:border-[hsl(var(--design-accent))] hover:text-[hsl(var(--design-accent))]"
              style={{ borderColor: "hsl(var(--design-border-strong))" }}
            >
              <Upload className="h-5 w-5" />
              <span className="font-medium">Choose a file</span>
              <span className="text-[10px] text-muted-foreground">PNG / JPG, up to 12MB</span>
            </button>
          </div>
        ) : (
          <div className="max-h-[280px] overflow-y-auto p-2">
            {candidates().length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center text-[11px] text-muted-foreground">
                <ImageIcon className="h-4 w-4 opacity-50" />
                <span>No other generated images in this session yet.</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {candidates().map((c) => (
                  <button
                    key={`${c.assetId}-${c.vIdx}`}
                    onClick={() => {
                      onPickAsset(c.assetId, c.assetUrl);
                      setOpen(false);
                    }}
                    className="design-tile group relative aspect-square overflow-hidden rounded-md border"
                    style={{ borderColor: "hsl(var(--design-border))" }}
                    title={`S${String(c.shotIdx).padStart(2, "0")} ${c.shotTitle} · v${c.vIdx}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.assetUrl} alt={c.shotTitle} className="h-full w-full object-cover" loading="lazy" />
                    <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-[9px] text-white/95">
                      S{String(c.shotIdx).padStart(2, "0")} · v{c.vIdx}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 inline-flex items-center justify-center px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider transition-colors",
        active
          ? "border-b-2 border-[hsl(var(--design-accent))] text-[hsl(var(--design-accent))]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
