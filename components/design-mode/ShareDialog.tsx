"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Lock, Mail, X, Eye, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Share {
  id: string;
  userId: number;
  userName: string;
  userEmail: string | null;
  permission: "view" | "collaborate";
  createdAt: string;
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** When the user toggles team-visibility via this dialog. */
  onMakeTeam?: () => void;
}

/**
 * Owner-only dialog: invite specific colleagues to a private session by email,
 * or flip the session to Team visibility. Mirrors the v1 chat share UX.
 */
export function ShareDialog({ open, onClose, sessionId, onMakeTeam }: ShareDialogProps) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "collaborate">("collaborate");
  const [submitting, setSubmitting] = useState(false);

  const loadShares = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/design/sessions/${sessionId}/shares`);
      if (res.ok) {
        const j = await res.json();
        setShares(j.shares || []);
      }
    } catch { /* non-fatal */ }
  }, [sessionId]);

  useEffect(() => {
    if (open) {
      setShares(null);
      loadShares();
    }
  }, [open, loadShares]);

  async function invite() {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/design/sessions/${sessionId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: email.trim(), permission }),
      });
      const text = await res.text();
      if (!res.ok) {
        const j = JSON.parse(text || "{}");
        toast.error(j?.error || `Couldn't share (${res.status})`);
        return;
      }
      toast.success(`Shared with ${email.trim()}`);
      setEmail("");
      loadShares();
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(shareId: string) {
    const res = await fetch(`/api/design/sessions/${sessionId}/shares?shareId=${shareId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Share revoked");
      loadShares();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="design-mode max-w-md" style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}>
        <DialogHeader>
          <DialogTitle className="editorial-display text-lg">Share this session</DialogTitle>
        </DialogHeader>

        {/* Quick switch to team */}
        {onMakeTeam && (
          <div className="rounded-lg border bg-[hsl(var(--design-bg-elev))] p-3"
               style={{ borderColor: "hsl(var(--design-border))" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                  <Users className="h-3.5 w-3.5 text-purple-600" /> Make it team-visible
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Every member of the workspace can open and edit. Skips the invite step entirely.
                </p>
              </div>
              <button
                onClick={() => { onMakeTeam(); onClose(); }}
                className="rounded-md border bg-[hsl(var(--design-bg))] px-2.5 py-1 text-[11.5px] font-medium hover:border-purple-300 hover:bg-purple-50"
                style={{ borderColor: "hsl(var(--design-border))" }}
              >
                Switch to Team
              </button>
            </div>
          </div>
        )}

        {/* Invite by email */}
        <form
          onSubmit={(e) => { e.preventDefault(); invite(); }}
          className="space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Lock className="h-3 w-3" /> Or share privately
          </div>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Mail className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@workspace.com"
                className="w-full rounded-md border bg-[hsl(var(--design-bg-elev))] py-1.5 pl-8 pr-3 text-[12.5px] focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
                style={{ borderColor: "hsl(var(--design-border))" }}
              />
            </div>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value as "view" | "collaborate")}
              className="rounded-md border bg-[hsl(var(--design-bg-elev))] px-2 py-1.5 text-[11.5px]"
              style={{ borderColor: "hsl(var(--design-border))" }}
            >
              <option value="collaborate">Can edit</option>
              <option value="view">View only</option>
            </select>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="rounded-md bg-[hsl(var(--design-accent))] px-3 py-1.5 text-[12px] font-medium text-white shadow-sm disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Invite"}
            </button>
          </div>
        </form>

        {/* Existing shares */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Shared with
          </div>
          {shares === null ? (
            <div className="text-[11px] text-muted-foreground">Loading…</div>
          ) : shares.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground"
                 style={{ borderColor: "hsl(var(--design-border))" }}>
              No one yet. Invite a colleague above.
            </div>
          ) : (
            <ul className="space-y-1">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    style={{ borderColor: "hsl(var(--design-border))" }}>
                  <div
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                    style={{ background: "hsl(var(--design-accent))" }}
                  >
                    {(s.userName || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium">{s.userName}</div>
                    {s.userEmail && <div className="truncate text-[10px] text-muted-foreground">{s.userEmail}</div>}
                  </div>
                  <span className={cn(
                    "pill",
                    s.permission === "view" ? "pill-neutral" : "pill-accent",
                  )}>
                    {s.permission === "view" ? <><Eye className="h-3 w-3" /> View</> : <><Pencil className="h-3 w-3" /> Edit</>}
                  </span>
                  <button
                    onClick={() => revoke(s.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-[hsl(var(--design-danger))]"
                    title="Revoke"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
