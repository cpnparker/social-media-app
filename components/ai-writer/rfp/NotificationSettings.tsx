"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NotificationSetting {
  id_setting?: string;
  flag_enabled: number;
  units_min_relevance: number;
  user_target?: number;
  userName?: string;
  userEmail?: string;
}

const RELEVANCE_OPTIONS = [50, 60, 70, 80, 90];

export function NotificationSettingsDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [minRelevance, setMinRelevance] = useState(70);
  const [team, setTeam] = useState<NotificationSetting[]>([]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);

    fetch(`/api/rfp/notification-settings?workspaceId=${workspaceId}&includeAll=true`)
      .then((res) => res.json())
      .then((data) => {
        if (data.own) {
          setEnabled(data.own.flag_enabled === 1);
          setMinRelevance(data.own.units_min_relevance || 70);
        }
        if (data.team) {
          setTeam(data.team);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, workspaceId]);

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rfp/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          enabled,
          minRelevance,
        }),
      });
      if (res.ok) {
        toast.success("Notification settings saved");
        onOpenChange(false);
      }
    } catch (err) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">Notification Settings</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Own settings */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Your Notifications
              </h3>

              {/* Enable/disable */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Email notifications for scheduled scans
                </p>
                <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5 w-fit">
                  <button
                    onClick={() => setEnabled(true)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      enabled
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Enabled
                  </button>
                  <button
                    onClick={() => setEnabled(false)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      !enabled
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Disabled
                  </button>
                </div>
              </div>

              {/* Relevance threshold */}
              {enabled && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Minimum relevance score
                  </p>
                  <div className="flex gap-1">
                    {RELEVANCE_OPTIONS.map((score) => (
                      <button
                        key={score}
                        onClick={() => setMinRelevance(score)}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
                          minRelevance === score
                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                            : "border-transparent text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {score}%+
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Only notify for RFPs scoring above this threshold
                  </p>
                </div>
              )}

              <Button
                size="sm"
                className="text-xs"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                ) : null}
                Save Settings
              </Button>
            </div>

            {/* Team status (admin/owner only) */}
            {team.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Team Status
                </h3>
                <div className="space-y-2">
                  {team.map((member) => (
                    <div
                      key={member.user_target}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{member.userName || "Unknown"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {member.userEmail}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {member.flag_enabled === 1 ? (
                          <>
                            <span className="text-emerald-600 font-medium">Enabled</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {member.units_min_relevance}%+
                            </Badge>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Disabled</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
