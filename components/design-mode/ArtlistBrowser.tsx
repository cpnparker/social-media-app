"use client";

import { useState, useCallback } from "react";
import { Search, Loader2, Film, Plus } from "lucide-react";

interface ArtlistItem {
  id: string;
  title: string;
  previewUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  orientation: string;
  tags?: string[];
}

interface ArtlistBrowserProps {
  /** Called when the user clicks "Add to canvas" on a result. The parent should
   *  trigger the license flow via the AI tool (best UX) or a server endpoint. */
  onLicense?: (item: ArtlistItem) => void;
}

export function ArtlistBrowser({ onLicense }: ArtlistBrowserProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArtlistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/design/artlist?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setItems(json.items || []);
    } catch (err: any) {
      setError(err?.message || "Search failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] p-3.5">
        <div className="mb-2 flex items-center gap-1.5">
          <Film className="h-3 w-3 text-[hsl(var(--design-accent))]" />
          <span className="section-label">Artlist · Artgrid</span>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); search(); }}
          className="flex gap-1.5"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="cinematic drone shot of mountains…"
              className="w-full rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-card))] py-1.5 pl-8 pr-3 text-[12px] focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-full bg-[hsl(var(--design-accent))] px-3 py-1.5 text-[11px] font-medium text-white shadow-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="rounded-lg border border-[hsl(var(--design-danger))]/30 bg-[hsl(var(--design-danger))]/5 p-2.5 text-[11px] text-[hsl(var(--design-danger))]">
            {error}
          </div>
        )}
        {!error && !loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Film className="h-6 w-6 text-muted-foreground/40" />
            <div className="text-[12px] font-medium text-muted-foreground">No results yet</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              Search Artlist&apos;s catalogue for licensed stock footage. Click a result to add it to your canvas.
            </div>
          </div>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="design-card design-tile group flex gap-2.5 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="h-14 w-20 flex-shrink-0 rounded object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium leading-tight">{item.title}</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="editorial-numeric text-sm leading-none text-foreground">{item.durationSec}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">s</span>
                    <span className="text-[10px] text-muted-foreground">· {item.orientation}</span>
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="mt-1 truncate text-[10px] text-muted-foreground/80">
                      {item.tags.slice(0, 3).join(" · ")}
                    </div>
                  )}
                </div>
                {onLicense && (
                  <button
                    onClick={() => onLicense(item)}
                    className="self-center rounded-full bg-[hsl(var(--design-accent-soft))] p-1.5 text-[hsl(var(--design-accent))] hover:bg-[hsl(var(--design-accent))] hover:text-white"
                    title="License & add to canvas"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
