"use client";

/**
 * Searchable client picker.
 *
 * Two variants from one component:
 *  - default: labelled field on the Live setup screen.
 *  - compact: pill in the in-meeting header, where a native <select> of 100+
 *    clients meant scrolling A-to-M while the call moved on — and rendered
 *    every client name into the DOM, so copying the feed swept up the list.
 *
 * Enter picks the top match and Escape backs out without rebinding, because
 * this is used mid-conversation.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ClientPicker({
  customers, clientId, onChange, compact = false, allowClear = true,
}: {
  customers: { id: string; name: string }[];
  clientId: string;
  onChange: (id: string) => void;
  /** Header variant: no label, pill-sized, dropdown wider than the input.
   *  Used mid-call, where a native <select> of 100+ names means scrolling
   *  A→M while the conversation moves on. */
  compact?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = [...customers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  const filtered = query.trim()
    ? sorted.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : sorted;
  const selectedName = customers.find((c) => c.id === clientId)?.name;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className={compact ? "relative" : "block"} ref={boxRef}>
      {!compact && (
        <span className="text-xs font-medium text-muted-foreground">Client <span className="opacity-60 font-normal">(optional)</span></span>
      )}
      <div className={compact ? "relative" : "relative mt-1"}>
        <input
          ref={inputRef}
          value={open ? query : selectedName || ""}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onKeyDown={(e) => {
            // Mid-call speed: Enter takes the top match, Escape backs out
            // without changing the binding.
            if (e.key === "Enter" && open && filtered.length > 0) {
              e.preventDefault();
              onChange(filtered[0].id);
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              inputRef.current?.blur();
            }
          }}
          placeholder={selectedName || (compact ? "Client…" : "Search clients…")}
          className={cn(
            "border bg-background",
            compact
              ? "h-7 w-[140px] rounded-full pl-2.5 pr-5 text-[11px] text-muted-foreground focus:w-[190px] transition-[width]"
              : "w-full h-9 rounded-lg px-2 text-sm"
          )}
          title={compact ? "Active client briefing — switch any time; Live also follows the conversation" : undefined}
        />
        {allowClear && clientId && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onChange(""); setQuery(""); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-xs"
            title="Clear"
          >✕</button>
        )}
        {open && (
          <div className={cn(
            "absolute z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover shadow-lg",
            compact ? "right-0 w-[240px]" : "w-full"
          )}>
            {allowClear && (
              <button
                onMouseDown={(e) => { e.preventDefault(); onChange(""); setOpen(false); }}
                className="w-full text-left px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >— No client / internal —</button>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => { e.preventDefault(); onChange(c.id); setOpen(false); }}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 text-sm hover:bg-accent truncate",
                  c.id === clientId && "bg-accent/50 font-medium"
                )}
              >{c.name}</button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-sm text-muted-foreground/60">No match</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
