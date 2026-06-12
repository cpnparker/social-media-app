"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Compact multi-select dropdown used in Operations filter bars.
 * - Shows "All" / "None" / "N of M" summary on the trigger button
 * - Built-in search, select-all, clear
 * - Closes on outside click
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel = "All",
  minWidth = 140,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allSelected = options.length > 0 && selected.size === options.length;
  const noneSelected = selected.size === 0;
  const summary = allSelected ? allLabel : noneSelected ? "None" : `${selected.size} of ${options.length}`;

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next);
  };
  const selectAll = () => onChange(new Set(options.map((o) => o.value)));
  const selectNone = () => onChange(new Set());

  return (
    <div ref={ref} className="relative">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ minWidth }}
        className="h-8 w-full px-2.5 inline-flex items-center justify-between gap-2 rounded-md border border-input bg-background text-xs hover:bg-muted/50 transition-colors"
      >
        <span className={cn("truncate", noneSelected && "text-muted-foreground")}>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[260px] rounded-md border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 w-full text-xs pl-6 pr-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[10px]">
              <button onClick={selectAll} className="text-muted-foreground hover:text-foreground">Select all</button>
              <button onClick={selectNone} className="text-muted-foreground hover:text-foreground">Clear</button>
            </div>
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">No matches.</p>
            ) : (
              filtered.map((opt) => {
                const checked = selected.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt.value)}
                      className="rounded border-muted-foreground/30 h-3.5 w-3.5"
                    />
                    <span className="flex-1 truncate">{opt.label}</span>
                    {opt.count != null && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{opt.count}</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
