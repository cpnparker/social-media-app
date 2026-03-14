"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Check, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AIRole } from "@/lib/types/ai";

/* ─────────────── Types ─────────────── */

interface PersonaliseDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = "context" | "roles";

/* ─────────────── Main Dialog ─────────────── */

export default function PersonaliseDialog({
  workspaceId,
  open,
  onClose,
}: PersonaliseDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("context");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-lg font-semibold">
            Personalise
          </DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-0.5 bg-muted rounded-lg p-0.5 mx-6 mt-3 w-fit">
          {(
            [
              { key: "context" as Tab, label: "Context" },
              { key: "roles" as Tab, label: "Roles" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "context" && <ContextTab />}
          {activeTab === "roles" && (
            <PersonalRolesTab workspaceId={workspaceId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════
   CONTEXT TAB
   ═══════════════════════════════════════════════════ */

function ContextTab() {
  const [personalContext, setPersonalContext] = useState("");
  const [savedContext, setSavedContext] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isDirty = personalContext !== savedContext;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/preferences");
        if (!res.ok) throw new Error("Failed to load preferences");
        const data = await res.json();
        const ctx = data.personalContext || "";
        setPersonalContext(ctx);
        setSavedContext(ctx);
      } catch {
        toast.error("Failed to load personal context");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalContext }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedContext(personalContext);
      toast.success("Personal context saved");
    } catch {
      toast.error("Failed to save personal context");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add personal context that will be included in all your AI conversations.
        This helps the AI understand your role, preferences, and how you like to
        work.
      </p>

      <textarea
        value={personalContext}
        onChange={(e) => setPersonalContext(e.target.value)}
        placeholder="e.g. I'm the Head of Content. I prefer British English. I like concise, punchy copy..."
        className="w-full h-40 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
      />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || saving} size="sm">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Save className="h-4 w-4 mr-1.5" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PERSONAL ROLES TAB
   ═══════════════════════════════════════════════════ */

function PersonalRolesTab({ workspaceId }: { workspaceId: string }) {
  const [roles, setRoles] = useState<AIRole[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isDirty =
    JSON.stringify([...selectedIds].sort()) !==
    JSON.stringify([...savedIds].sort());

  useEffect(() => {
    (async () => {
      try {
        // Fetch roles and preferences in parallel
        const [rolesRes, prefsRes] = await Promise.all([
          fetch(`/api/ai/roles?workspaceId=${workspaceId}`),
          fetch("/api/me/preferences"),
        ]);

        if (!rolesRes.ok) throw new Error("Failed to load roles");
        if (!prefsRes.ok) throw new Error("Failed to load preferences");

        const rolesData = await rolesRes.json();
        const prefsData = await prefsRes.json();

        const activeRoles: AIRole[] = (rolesData.roles || []).filter(
          (r: AIRole) => r.isActive
        );
        setRoles(activeRoles);

        // Prune any stale IDs that no longer exist as active roles
        const activeRoleIds = new Set(activeRoles.map((r) => r.id));
        const validSelectedIds = (prefsData.selectedRoleIds || []).filter(
          (id: string) => activeRoleIds.has(id)
        );
        setSelectedIds(validSelectedIds);
        setSavedIds(validSelectedIds);
      } catch {
        toast.error("Failed to load roles");
      } finally {
        setLoading(false);
      }
    })();
  }, [workspaceId]);

  const toggleRole = useCallback((roleId: string) => {
    setSelectedIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedRoleIds: selectedIds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedIds([...selectedIds]);
      toast.success("Selected roles saved");
    } catch {
      toast.error("Failed to save selected roles");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No roles have been configured for this workspace yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select roles to always include as background expertise in your AI
        conversations. These work alongside any per-message role you choose.
      </p>

      <div className="space-y-2">
        {roles.map((role) => {
          const isSelected = selectedIds.includes(role.id);
          return (
            <button
              key={role.id}
              onClick={() => toggleRole(role.id)}
              className={cn(
                "w-full flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                isSelected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <span className="text-xl mt-0.5 shrink-0">{role.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{role.name}</div>
                {role.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {role.description}
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "shrink-0 mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30"
                )}
              >
                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || saving} size="sm">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Save className="h-4 w-4 mr-1.5" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
