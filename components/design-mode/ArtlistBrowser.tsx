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
      <div className="border-b p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          <Film className="h-3 w-3" />
          Artlist · Artgrid stock footage
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); search(); }}
          className="flex gap-1.5"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="cinematic drone shot of mountains…"
              className="w-full rounded border bg-background px-7 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {error && (
          <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
        )}
        {!error && !loading && items.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Search Artlist&apos;s catalogue for licensed stock footage.<br />
            Click a result to add it to your canvas.
          </div>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="group flex gap-2 rounded border p-2 hover:border-primary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="h-16 w-24 flex-shrink-0 rounded object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.durationSec}s · {item.orientation}
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="mt-1 truncate text-[10px] text-muted-foreground">
                      {item.tags.slice(0, 3).join(" · ")}
                    </div>
                  )}
                </div>
                {onLicense && (
                  <button
                    onClick={() => onLicense(item)}
                    className="self-center rounded p-1.5 text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                    title="License & add to canvas"
                  >
                    <Plus className="h-4 w-4" />
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
