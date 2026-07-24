"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  X,
  Lock,
  UserPlus,
  ChevronDown,
  Loader2,
  Link2,
  Check,
  Bell,
  BellOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AIConversationShare } from "@/lib/types/ai";

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
  workspaceId: string;
  onSharesChanged?: () => void;
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getAvatarColor(userId: number): string {
  const shades = [0.06, 0.08, 0.1, 0.07, 0.09, 0.05];
  return `bg-foreground/[${shades[userId % shades.length].toFixed(2)}] text-muted-foreground`;
}

export default function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
  workspaceId,
  onSharesChanged,
}: ShareDialogProps) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [shares, setShares] = useState<AIConversationShare[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);

  // Fetch workspace members (cached once)
  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace-members");
      const data = await res.json();
      if (data.members) {
        setMembers(
          data.members
            .filter((m: any) => m.accessEngineGpt === true)
            .map((m: any) => ({
              id: String(m.id),
              name: m.name || m.email,
              email: m.email,
              role: m.role || "member",
            }))
        );
      }
    } catch {
      // Silently fail — search will just be empty
    }
  }, []);

  // Fetch current shares
  const fetchShares = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/shares`
      );
      const data = await res.json();
      if (data.shares) setShares(data.shares);
    } catch {
      toast.error("Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (open) {
      fetchMembers();
      fetchShares();
      setSearchQuery("");
      setLinkCopied(false);
    }
  }, [open, fetchMembers, fetchShares]);

  // Filter search results: exclude already-shared users
  const sharedUserIds = new Set(shares.map((s) => String(s.userId)));
  const searchResults = searchQuery.trim()
    ? members.filter((m) => {
        if (sharedUserIds.has(m.id)) return false;
        const q = searchQuery.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q)
        );
      })
    : [];

  // Add a share
  const handleAddShare = async (member: WorkspaceMember) => {
    setAdding(parseInt(member.id, 10));
    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/shares`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: parseInt(member.id, 10),
            permission: "view",
            notify: notifyEnabled,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to share");
        return;
      }
      setShares((prev) => [...prev, data.share]);
      setSearchQuery("");
      if (notifyEnabled) {
        toast.success(`Shared with ${member.name} — notification sent`);
      } else {
        toast.success(`Shared with ${member.name}`);
      }
      onSharesChanged?.();
    } catch {
      toast.error("Failed to share");
    } finally {
      setAdding(null);
    }
  };

  // Update permission
  const handleUpdatePermission = async (
    shareId: string,
    permission: "view" | "collaborate"
  ) => {
    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/shares`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shareId, permission }),
        }
      );
      if (!res.ok) {
        toast.error("Failed to update permission");
        return;
      }
      setShares((prev) =>
        prev.map((s) => (s.id === shareId ? { ...s, permission } : s))
      );
    } catch {
      toast.error("Failed to update permission");
    }
  };

  // Remove a share
  const handleRemoveShare = async (shareId: string, userName?: string) => {
    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/shares?shareId=${shareId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        toast.error("Failed to remove");
        return;
      }
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast.success(`Removed ${userName || "user"}`);
      onSharesChanged?.();
    } catch {
      toast.error("Failed to remove");
    }
  };

  // Copy thread URL
  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("thread", conversationId);
    navigator.clipboard.writeText(url.toString());
    setLinkCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            Share conversation
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {conversationTitle}
          </p>
        </DialogHeader>

        {/* Search input */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Add people by name or email..."
              className="w-full h-9 rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/15 focus:border-foreground/20 placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="mt-1.5 border rounded-lg divide-y max-h-[180px] overflow-y-auto">
              {searchResults.slice(0, 8).map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleAddShare(member)}
                  disabled={adding === parseInt(member.id, 10)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                >
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
                      getAvatarColor(parseInt(member.id, 10))
                    )}
                  >
                    {getInitials(member.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {member.email}
                    </p>
                  </div>
                  {adding === parseInt(member.id, 10) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          {searchQuery.trim() && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              No matching team members
            </p>
          )}
        </div>

        {/* Notify toggle */}
        <div className="px-5 pb-3">
          <button
            onClick={() => setNotifyEnabled(!notifyEnabled)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <div
              className={cn(
                "h-4 w-8 rounded-full transition-colors relative",
                notifyEnabled ? "bg-foreground" : "bg-foreground/20"
              )}
            >
              <div
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all",
                  notifyEnabled ? "left-[18px]" : "left-0.5"
                )}
              />
            </div>
            <span className="text-xs">
              Notify people when added
            </span>
          </button>
        </div>

        {/* People with access */}
        <div className="border-t px-5 py-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            People with access
          </p>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {/* Owner — always first */}
              <div className="flex items-center gap-3 py-2 px-1 rounded-md">
                <div className="h-7 w-7 rounded-full bg-foreground/[0.08] flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                  You
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">You</p>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium px-2">
                  Owner
                </span>
              </div>

              {/* Shared users */}
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center gap-3 py-2 px-1 rounded-md group"
                >
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
                      getAvatarColor(share.userId)
                    )}
                  >
                    {getInitials(share.userName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {share.userName || share.userEmail || "Unknown"}
                    </p>
                    {share.userEmail && share.userName && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {share.userEmail}
                      </p>
                    )}
                  </div>

                  {/* Permission dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors shrink-0">
                        {share.permission === "collaborate"
                          ? "Can edit"
                          : "Can view"}
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem
                        onClick={() =>
                          handleUpdatePermission(share.id, "view")
                        }
                        className={cn(
                          "text-xs",
                          share.permission === "view" && "font-medium"
                        )}
                      >
                        Can view
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleUpdatePermission(share.id, "collaborate")
                        }
                        className={cn(
                          "text-xs",
                          share.permission === "collaborate" && "font-medium"
                        )}
                      >
                        Can edit
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Remove button */}
                  <button
                    onClick={() =>
                      handleRemoveShare(share.id, share.userName || undefined)
                    }
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded-md hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {shares.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3 italic">
                  Not shared with anyone yet
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer — privacy note + copy link */}
        <div className="border-t px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground min-w-0">
            <Lock className="h-3 w-3 shrink-0" />
            <p className="text-[11px] truncate">
              Only people added can access
            </p>
          </div>
          <button
            onClick={handleCopyLink}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all shrink-0",
              linkCopied
                ? "text-foreground bg-foreground/[0.05] border-foreground/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted border-border"
            )}
          >
            {linkCopied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Link2 className="h-3 w-3" />
                Copy link
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
