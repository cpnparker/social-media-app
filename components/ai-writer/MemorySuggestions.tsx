"use client";

import { useState } from "react";
import { Brain, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const CATEGORY_LABELS: Record<string, string> = {
  preference: "Preference",
  fact: "Fact",
  instruction: "Instruction",
  style: "Style",
  client_insight: "Client Insight",
};

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
    <div className="mx-3 md:mx-4 mb-2 animate-in slide-in-from-bottom-2 duration-300">
      <div className="rounded-xl border border-primary/10 bg-primary/[0.02] px-4 py-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-primary/80">
            <Brain className="h-3.5 w-3.5" />
            <span>Memories detected</span>
          </div>
          <button
            onClick={onDismiss}
            className="h-5 w-5 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Suggestions */}
        <div className="space-y-1.5">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => toggle(i)}
              className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/50 transition-colors group"
            >
              <div
                className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  checked.has(i)
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/30"
                }`}
              >
                {checked.has(i) && <Check className="h-2.5 w-2.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">{s.content}</p>
                <Badge
                  variant="outline"
                  className="mt-1 text-[9px] px-1.5 py-0 h-4"
                >
                  {CATEGORY_LABELS[s.category] || s.category}
                </Badge>
              </div>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-3 pt-2.5 border-t border-primary/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="h-7 text-xs text-muted-foreground"
          >
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || checked.size === 0}
            className="h-7 text-xs gap-1.5"
          >
            <Brain className="h-3 w-3" />
            {saving ? "Saving..." : `Save ${checked.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
