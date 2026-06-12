"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Building2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";

/**
 * Single-select customer dropdown that mirrors / drives the global
 * CustomerContext selection. Drop into any operations-page filter row to
 * give users a visible, page-level customer filter alongside other
 * controls.
 *
 * Behaviour:
 *  - Reads `selectedCustomerId` from CustomerContext (so the TopBar
 *    selector and this widget stay in sync).
 *  - Writes through `setSelectedCustomerId` and also updates the
 *    `?client=` URL param so a refresh preserves the selection.
 *  - If the user can view all clients, an "All customers" option clears
 *    the filter. If the user is locked to a single customer, the widget
 *    renders as a disabled label.
 */
export function CustomerDropdownFilter({
  label = "Customer",
  minWidth = 200,
  className,
}: {
  label?: string;
  minWidth?: number;
  className?: string;
}) {
  const ctx = useCustomerSafe();
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

  const customers = useMemo(() => ctx?.customers ?? [], [ctx?.customers]);
  const selectedId = ctx?.selectedCustomerId ?? null;
  const canViewAll = ctx?.canViewAll ?? false;
  const isSingleCustomer = ctx?.isSingleCustomer ?? false;
  const selected = ctx?.selectedCustomer ?? null;

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return sortedCustomers;
    const q = search.toLowerCase();
    return sortedCustomers.filter((c) => c.name.toLowerCase().includes(q));
  }, [sortedCustomers, search]);

  const setSelected = (id: string | null) => {
    if (!ctx) return;
    ctx.setSelectedCustomerId(id);
    // Keep the URL in sync so refresh / share preserves selection
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("client", id);
      else url.searchParams.delete("client");
      window.history.replaceState({}, "", url.toString());
    }
    setOpen(false);
    setSearch("");
  };

  if (!ctx) return null;

  const summary = selected ? selected.name : canViewAll ? "All customers" : "Select customer";

  return (
    <div ref={ref} className={cn("relative", className)}>
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
        {label}
      </label>
      <button
        type="button"
        onClick={() => !isSingleCustomer && setOpen((o) => !o)}
        disabled={isSingleCustomer}
        style={{ minWidth }}
        className={cn(
          "h-8 w-full px-2.5 inline-flex items-center justify-between gap-2 rounded-md border border-input bg-background text-xs transition-colors",
          isSingleCustomer ? "cursor-default opacity-80" : "hover:bg-muted/50 cursor-pointer"
        )}
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className={cn("truncate", !selected && !canViewAll && "text-muted-foreground")}>
            {summary}
          </span>
        </span>
        {!isSingleCustomer && (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[280px] rounded-md border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                placeholder="Search customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="h-7 w-full text-xs pl-6 pr-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {canViewAll && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 cursor-pointer text-left",
                  !selectedId && "font-medium"
                )}
              >
                <span className="truncate">All customers</span>
                {!selectedId && <Check className="h-3 w-3 text-foreground shrink-0" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">No matches.</p>
            ) : (
              filtered.map((c) => {
                const checked = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 cursor-pointer text-left",
                      checked && "bg-blue-500/8"
                    )}
                  >
                    <span className={cn("truncate", checked && "font-medium text-blue-600")}>
                      {c.name}
                    </span>
                    {checked && <Check className="h-3 w-3 text-blue-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
