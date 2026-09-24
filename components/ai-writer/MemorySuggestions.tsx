"use client";

import { useState } from "react";
import { Brain, X, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { MemorySuggestion } from "@/lib/types/ai";

interface MemorySuggestionsProps {
  suggestions: MemorySuggestion[];
  conversationId: string;
  conversationVisibility: "private" | "team";
  workspaceId: string;
  onDismiss: () => void;
  onSaved: () => void;
}

export default function MemorySuggestions({
  suggestions,
  conversationId,
  conversationVisibility,
  workspaceId,
  onDismiss,
  onSaved,
}: MemorySuggestionsProps) {
  const [checked, setChecked] = useState<Set<number>>(
    new Set(suggestions.map((_, i) => i))
  );
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSave = async () => {
    const toSave = suggestions.filter((_, i) => checked.has(i));
    if (toSave.length === 0) {
      onDismiss();
      return;
    }

    setSaving(true);
    try {
      let saved = 0;
      for (const s of toSave) {
        const res = await fetch("/api/ai/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            content: s.content,
            category: s.category,
            scope: conversationVisibility === "private" ? "private" : "team",
            sourceConversationId: conversationId,
          }),
        });
        if (res.ok) saved++;
      }
      toast.success(`${saved} memor${saved === 1 ? "y" : "ies"} saved`);
      onSaved();
    } catch (err) {
      toast.error("Failed to save memories");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex justify-start px-3 md:px-4 mb-1 animate-in fade-in duration-500">
      <div className="max-w-[min(520px,85%)]">
        {/* Collapsed: slim inline bar */}
        {!expanded ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 hover:bg-muted/50 pl-2 pr-2.5 py-1 transition-colors"
            >
              <Brain className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-muted-foreground/60 font-medium">
                {suggestions.length} {suggestions.length === 1 ? "memory" : "memories"} found
              </span>
              <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/40" />
            </button>
            <button
              onClick={onDismiss}
              className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          /* Expanded: lightweight list */
          <div className="rounded-lg border border-border/30 bg-muted/20 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-medium">
                <Brain className="h-3 w-3" />
                <span>Remember these?</span>
              </div>
              <button
                onClick={onDismiss}
                className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Items */}
            <div className="px-1.5 pb-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/40 transition-colors"
                >
                  <div
                    className={`mt-[3px] h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                      checked.has(i)
                        ? "bg-foreground/70 border-foreground/70 text-background"
                        : "border-muted-foreground/20"
                    }`}
                  >
                    {checked.has(i) && <Check className="h-2 w-2" strokeWidth={3} />}
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground/80 flex-1 min-w-0">
                    {s.content}
                  </p>
                </button>
              ))}
            </div>

            {/* Actions — minimal, right-aligned text buttons */}
            <div className="flex items-center justify-end gap-3 px-3 py-1.5 border-t border-border/20">
              <button
                onClick={onDismiss}
                className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={handleSave}
                disabled={saving || checked.size === 0}
                className="text-[11px] font-medium text-foreground/50 hover:text-foreground/80 disabled:opacity-30 transition-colors"
              >
                {saving ? "Saving..." : `Save ${checked.size}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
