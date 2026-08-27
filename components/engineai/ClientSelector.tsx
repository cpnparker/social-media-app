"use client";

/**
 * The client selector — ONE component, two places.
 *
 * It began as markup inside EngineAISidebar. The Optimiser and the Writer then
 * needed the same control on their first screen, because the client is not a
 * cosmetic label there: a piece imported with no client has no brand names, and
 * with no brand names its own figures read as unsourced statistics. On a real
 * Amrize document that produced "Figure with no source" over the sentence "the
 * Amrize mix was 35% less carbon intensive", which names the company in the
 * same breath as the number. Selecting the client removes that finding.
 *
 * So this is extracted rather than reimplemented. Two selectors that must look
 * and behave identically are one component or they are a divergence waiting to
 * happen — and the request was explicitly that the new one MATCH the nav's.
 *
 * `tone` changes the TRIGGER only. The sidebar sits on a dark rail and needs
 * white-on-translucent; a page sits on the app background and needs a border
 * and foreground text. The popover is deliberately identical in both: it is the
 * same list, the same search, the same "General" row, and a reader who has used
 * one has used the other.
 */

import { useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { cn } from "@/lib/utils";

export type ClientSelectorTone = "sidebar" | "surface";

export default function ClientSelector({
  tone = "surface",
  className,
  align = "start",
}: {
  tone?: ClientSelectorTone;
  className?: string;
  align?: "start" | "end" | "center";
}) {
  const customerCtx = useCustomerSafe();
  const customers = customerCtx?.customers || [];
  const selectedCustomer = customerCtx?.selectedCustomer;
  const canViewAll = customerCtx?.canViewAll ?? false;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // SORTED BY NAME, as the sidebar's list was. Dropping this in the extraction
  // would have been an invisible regression: the list still renders, still
  // filters, and is simply in whatever order the API returned.
  const filtered = useMemo(
    () =>
      (query
        ? customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        : customers
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [customers, query]
  );

  // Nothing to choose between: render nothing rather than a control that opens
  // an empty list. Matches the sidebar's own `customers.length > 0` guard, and
  // moving that guard INTO the component is why both call sites stay simple.
  if (customers.length === 0) return null;

  const sidebar = tone === "sidebar";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors text-left",
            sidebar
              ? "bg-white/[0.06] hover:bg-white/10"
              : "border bg-background hover:bg-muted",
            className
          )}
        >
          <Building2
            className={cn("h-3.5 w-3.5 shrink-0", sidebar ? "text-white/40" : "text-muted-foreground")}
          />
          <span
            className={cn(
              "flex-1 truncate text-[13px] font-medium",
              sidebar ? "text-white/80" : "text-foreground"
            )}
          >
            {selectedCustomer?.name || "General"}
          </span>
          <ChevronsUpDown
            className={cn("h-3 w-3 shrink-0", sidebar ? "text-white/40" : "text-muted-foreground")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} side="bottom" className="w-[256px] p-0">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            placeholder="Search clients..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="ml-1 h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="max-h-[240px] overflow-y-auto p-1">
          {canViewAll && !query && (
            <button
              type="button"
              onClick={() => {
                customerCtx?.setSelectedCustomerId(null);
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                !selectedCustomer && "bg-accent"
              )}
            >
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1">General</span>
              {!selectedCustomer && <Check className="h-4 w-4 text-primary shrink-0" />}
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No clients found</p>
          ) : (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  customerCtx?.setSelectedCustomerId(c.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                  selectedCustomer?.id === c.id && "bg-accent"
                )}
              >
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logoUrl} alt="" className="h-4 w-4 rounded object-cover shrink-0" />
                ) : (
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 truncate">{c.name}</span>
                {selectedCustomer?.id === c.id && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
