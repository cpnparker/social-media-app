"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Clock,
  Calendar,
  CalendarDays,
  BellOff,
  Zap,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Check,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Frequency = "off" | "realtime" | "daily" | "weekly";

interface NotificationSetting {
  id_setting?: string;
  flag_enabled: number;
  units_min_relevance: number;
  type_frequency: Frequency;
  units_digest_day: number;
  user_target?: number;
  userName?: string;
  userEmail?: string;
  workspaceRole?: string;
}

interface SavedSearchSchedule {
  id: string;
  name: string;
  scheduled: boolean;
  schedule: string | null;
  config: any;
  lastRun: string | null;
  nextRun: string | null;
}

const RELEVANCE_OPTIONS = [50, 60, 70, 80, 90];
const DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const FREQUENCY_OPTIONS: { value: Frequency; label: string; icon: any; description: string }[] = [
  { value: "off", label: "Off", icon: BellOff, description: "No notifications" },
  { value: "realtime", label: "Real-time", icon: Zap, description: "As new RFPs are found" },
  { value: "daily", label: "Daily", icon: Calendar, description: "Sent daily at 07:00 UTC" },
  { value: "weekly", label: "Weekly", icon: CalendarDays, description: "Sent weekly on your chosen day" },
];

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function formatNextRun(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "Overdue";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `in ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  return `in ${diffDays}d`;
}

function frequencySummary(freq: Frequency, day?: number): string {
  switch (freq) {
    case "off": return "Off";
    case "realtime": return "Real-time";
    case "daily": return "Daily digest";
    case "weekly": return `Weekly (${DAY_OPTIONS.find((d) => d.value === day)?.label || "Mon"})`;
  }
}

export function NotificationSettingsDialog({
  open,
  onOpenChange,
  workspaceId,
  userRole,
  onManageScans,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  userRole?: string;
  onManageScans?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Own settings
  const [frequency, setFrequency] = useState<Frequency>("off");
  const [minRelevance, setMinRelevance] = useState(70);
  const [digestDay, setDigestDay] = useState(1);

  // Team settings (admin/owner only)
  const [team, setTeam] = useState<NotificationSetting[]>([]);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editFrequency, setEditFrequency] = useState<Frequency>("off");
  const [editRelevance, setEditRelevance] = useState(70);
  const [editDay, setEditDay] = useState(1);
  const [savingTeam, setSavingTeam] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);

  // Scan schedules
  const [savedSearches, setSavedSearches] = useState<SavedSearchSchedule[]>([]);

  const isAdmin = userRole === "owner" || userRole === "admin";

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    setEditingUserId(null);

    fetch(`/api/rfp/notification-settings?workspaceId=${workspaceId}&includeAll=true`)
      .then((res) => res.json())
      .then((data) => {
        if (data.own) {
          setFrequency(data.own.type_frequency || (data.own.flag_enabled === 1 ? "realtime" : "off"));
          setMinRelevance(data.own.units_min_relevance || 70);
          setDigestDay(data.own.units_digest_day || 1);
        }
        if (data.team) {
          setTeam(data.team);
        }
        if (data.savedSearches) {
          setSavedSearches(data.savedSearches);
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
          frequency,
          minRelevance,
          digestDay,
        }),
      });
      if (res.ok) {
        toast.success("Notification settings saved");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const startEditingMember = (member: NotificationSetting) => {
    setEditingUserId(member.user_target!);
    setEditFrequency(member.type_frequency || "off");
    setEditRelevance(member.units_min_relevance || 70);
    setEditDay(member.units_digest_day || 1);
  };

  const handleSaveTeamMember = async () => {
    if (!workspaceId || editingUserId === null) return;
    setSavingTeam(true);
    try {
      const res = await fetch("/api/rfp/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          targetUserId: editingUserId,
          frequency: editFrequency,
          minRelevance: editRelevance,
          digestDay: editDay,
        }),
      });
      if (res.ok) {
        toast.success("Team member settings saved");
        // Update local state
        setTeam((prev) =>
          prev.map((m) =>
            m.user_target === editingUserId
              ? {
                  ...m,
                  type_frequency: editFrequency,
                  flag_enabled: editFrequency !== "off" ? 1 : 0,
                  units_min_relevance: editRelevance,
                  units_digest_day: editDay,
                }
              : m
          )
        );
        setEditingUserId(null);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingTeam(false);
    }
  };

  const handleToggleMember = async (member: NotificationSetting) => {
    if (!workspaceId || !member.user_target) return;
    const newFreq: Frequency = member.type_frequency === "off" ? "realtime" : "off";
    setTogglingUserId(member.user_target);
    try {
      const res = await fetch("/api/rfp/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          targetUserId: member.user_target,
          frequency: newFreq,
          minRelevance: member.units_min_relevance || 70,
          digestDay: member.units_digest_day || 1,
        }),
      });
      if (res.ok) {
        setTeam((prev) =>
          prev.map((m) =>
            m.user_target === member.user_target
              ? { ...m, type_frequency: newFreq, flag_enabled: newFreq !== "off" ? 1 : 0 }
              : m
          )
        );
        toast.success(
          newFreq === "off"
            ? `Notifications off for ${member.userName || "user"}`
            : `Notifications on for ${member.userName || "user"}`
        );
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setTogglingUserId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-4 sm:p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Notification Settings</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* ─── Section 1: Your Notifications ─── */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Your Notifications
              </h3>

              {/* Frequency selector */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  How often do you want to receive RFP notifications?
                </p>
                <div className="grid grid-cols-4 gap-1 bg-muted/50 rounded-lg p-0.5">
                  {FREQUENCY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setFrequency(opt.value)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[11px] font-medium transition-colors",
                          frequency === opt.value
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.description}
                </p>
              </div>

              {/* Relevance threshold (shown when not off) */}
              {frequency !== "off" && (
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

              {/* Day picker (shown when weekly) */}
              {frequency === "weekly" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Which day?
                  </p>
                  <div className="flex gap-1">
                    {DAY_OPTIONS.map((day) => (
                      <button
                        key={day.value}
                        onClick={() => setDigestDay(day.value)}
                        className={cn(
                          "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border",
                          digestDay === day.value
                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                            : "border-transparent text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
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

            {/* ─── Section 2: Scan Schedules ─── */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Scan Schedules
                </h3>
                {onManageScans && (
                  <button
                    onClick={() => { onManageScans(); onOpenChange(false); }}
                    className="text-[11px] text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 font-medium"
                  >
                    Edit schedules →
                  </button>
                )}
              </div>
              {savedSearches.length > 0 ? (
                <div className="space-y-2">
                  {savedSearches
                    .filter((s) => s.scheduled)
                    .map((search) => (
                      <div
                        key={search.id}
                        className="flex items-center justify-between gap-2 text-xs bg-muted/30 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{search.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {search.schedule === "daily" ? "Daily" : search.schedule === "weekly" ? "Weekly" : search.schedule || "Custom"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>{formatRelativeTime(search.lastRun)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <RefreshCw className="h-3 w-3" />
                            <span>{formatNextRun(search.nextRun)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  {savedSearches.filter((s) => s.scheduled).length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">
                      No scheduled scans.{" "}
                      {onManageScans ? (
                        <button
                          onClick={() => { onManageScans(); onOpenChange(false); }}
                          className="text-cyan-500 hover:underline"
                        >
                          Set up a schedule
                        </button>
                      ) : (
                        "Enable a schedule from the Saved Searches section."
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">
                  No saved searches yet. Create and schedule searches from the Discover tab.
                </p>
              )}
            </div>

            {/* ─── Section 3: Team Notifications (admin/owner only) ─── */}
            {isAdmin && (
              <div className="border-t pt-4">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Team Notifications
                </h3>
                {team.length > 0 ? (
                  <div className="space-y-1">
                    {team.map((member) => {
                      const isEditing = editingUserId === member.user_target;
                      return (
                        <div
                          key={member.user_target}
                          className={cn(
                            "rounded-lg transition-colors",
                            isEditing ? "bg-muted/50 p-3" : "px-3 py-2 hover:bg-muted/30"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium truncate">
                                  {member.userName || "Unknown"}
                                </p>
                                {member.workspaceRole && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0">
                                    {member.workspaceRole}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {member.userEmail}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!isEditing && (
                                <>
                                  <span
                                    className={cn(
                                      "text-[11px] font-medium",
                                      member.type_frequency !== "off"
                                        ? "text-emerald-600"
                                        : "text-muted-foreground"
                                    )}
                                  >
                                    {frequencySummary(member.type_frequency, member.units_digest_day)}
                                  </span>
                                  {member.type_frequency !== "off" && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                      {member.units_min_relevance}%+
                                    </Badge>
                                  )}
                                  {/* Quick on/off toggle */}
                                  <button
                                    onClick={() => handleToggleMember(member)}
                                    disabled={togglingUserId === member.user_target}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                                      member.type_frequency !== "off"
                                        ? "bg-emerald-500"
                                        : "bg-muted-foreground/30"
                                    )}
                                    title={member.type_frequency !== "off" ? "Turn off notifications" : "Turn on notifications"}
                                  >
                                    {togglingUserId === member.user_target ? (
                                      <Loader2 className="h-3 w-3 animate-spin text-white absolute left-1/2 -translate-x-1/2" />
                                    ) : (
                                      <span
                                        className={cn(
                                          "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                                          member.type_frequency !== "off" ? "translate-x-[18px]" : "translate-x-[3px]"
                                        )}
                                      />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => startEditingMember(member)}
                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    title="Edit notification details"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                              {isEditing && (
                                <button
                                  onClick={() => setEditingUserId(null)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Inline edit controls */}
                          {isEditing && (
                            <div className="mt-3 space-y-3">
                              {/* Frequency */}
                              <div className="grid grid-cols-4 gap-1 bg-muted/50 rounded-lg p-0.5">
                                {FREQUENCY_OPTIONS.map((opt) => {
                                  const Icon = opt.icon;
                                  return (
                                    <button
                                      key={opt.value}
                                      onClick={() => setEditFrequency(opt.value)}
                                      className={cn(
                                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors",
                                        editFrequency === opt.value
                                          ? "bg-background text-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      )}
                                    >
                                      <Icon className="h-3 w-3" />
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Relevance (when not off) */}
                              {editFrequency !== "off" && (
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1">
                                    Min. relevance
                                  </p>
                                  <div className="flex gap-1">
                                    {RELEVANCE_OPTIONS.map((score) => (
                                      <button
                                        key={score}
                                        onClick={() => setEditRelevance(score)}
                                        className={cn(
                                          "px-2 py-1 rounded text-[10px] font-medium border transition-colors",
                                          editRelevance === score
                                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                                            : "border-transparent text-muted-foreground hover:bg-muted"
                                        )}
                                      >
                                        {score}%+
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Day picker (when weekly) */}
                              {editFrequency === "weekly" && (
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1">
                                    Digest day
                                  </p>
                                  <div className="flex gap-1">
                                    {DAY_OPTIONS.map((day) => (
                                      <button
                                        key={day.value}
                                        onClick={() => setEditDay(day.value)}
                                        className={cn(
                                          "px-2 py-1 rounded text-[10px] font-medium border transition-colors",
                                          editDay === day.value
                                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                                            : "border-transparent text-muted-foreground hover:bg-muted"
                                        )}
                                      >
                                        {day.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Save/Cancel */}
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="text-[11px] h-7"
                                  onClick={handleSaveTeamMember}
                                  disabled={savingTeam}
                                >
                                  {savingTeam ? (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  ) : (
                                    <Check className="h-3 w-3 mr-1" />
                                  )}
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-[11px] h-7"
                                  onClick={() => setEditingUserId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    No team members with RFP access.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
