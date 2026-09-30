"use client";

import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";

interface OnboardingHintProps {
  /** Storage key — once dismissed, this hint never shows again for the user. */
  id: string;
  title: string;
  body: React.ReactNode;
  /** Show only when this predicate is true (e.g. session is empty). */
  visible?: boolean;
}

/**
 * A discreet, dismissible onboarding tooltip card. Renders as a 280px-wide
 * block — drop it inside any container that knows where to put it (e.g. an
 * absolutely-positioned wrapper at top-right of the canvas).
 *
 * Local-storage backed: once a hint is dismissed it stays dismissed across
 * sessions. Per-user, but that's fine for onboarding.
 */
export function OnboardingHint({ id, title, body, visible = true }: OnboardingHintProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`design-onboarding:${id}`);
    setDismissed(stored === "1");
  }, [id]);

  if (dismissed !== false || !visible) return null;

  return (
    <div
      className="pointer-events-auto w-[280px] rounded-xl border bg-[hsl(var(--design-card))] p-3 shadow-xl"
      style={{
        borderColor: "hsl(var(--design-accent))",
        boxShadow: "var(--shadow-pop)",
      }}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: "hsl(var(--design-accent-soft))" }}
        >
          <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--design-accent))" }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold leading-tight">{title}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{body}</div>
        </div>
        <button
          onClick={() => {
            window.localStorage.setItem(`design-onboarding:${id}`, "1");
            setDismissed(true);
          }}
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
