"use client";

/**
 * Scheduled prompts hub (Phase 1) — list, create, pause/resume, run-now,
 * delete, with per-task next-run + last-run status. The management hub ships
 * AT launch (both market leaders had to retrofit theirs under user pressure).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Pause, Trash2, Plus, ExternalLink, Clock, AlertTriangle, History, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Proven starting points — clicking one prefills the create form. */
const TEMPLATES: {
  label: string;
  title: string;
  prompt: string;
  cadence: "daily" | "weekdays" | "weekly" | "monthly";
  hour: number;
  dayOfWeek?: number;
}[] = [
  {
    label: "Monday Morning Operations Brief",
    title: "Monday Morning Operations Brief",
    prompt:
      "Give me a Monday operations brief: CU utilisation by contract (flag anything pacing over 80% or under 20%), the content pipeline summarised by client and status, contracts ending within 30 days, and this week's scheduled client meetings. Lead with the 3 things that most need attention.",
    cadence: "weekly", dayOfWeek: 1, hour: 8,
  },
  {
    label: "Daily Pipeline Digest",
    title: "Daily Pipeline Digest",
    prompt:
      "Summarise the content pipeline by client and status. Call out anything overdue or due within 2 days, and note what changed since yesterday.",
    cadence: "weekdays", hour: 8,
  },
  {
    label: "Contract Renewals Watch",
    title: "Contract Renewals Watch",
    prompt:
      "List all contracts ending within the next 60 days with CU utilisation and remaining units. Flag any contract pacing to over- or under-deliver and suggest one renewal talking point for each.",
    cadence: "monthly", hour: 9,
  },
  {
    label: "Friday Week Recap",
    title: "Friday Week Recap",
    prompt:
      "Recap the week: content units completed by client, social posts published with engagement highlights, and open tasks that slipped. Keep it to one screen.",
    cadence: "weekly", dayOfWeek: 5, hour: 16,
  },
];

interface ScheduledTask {
  id_prompt: string;
  name_title: string;
  document_prompt: string;
  type_schedule: string;
  config_schedule: any;
  schedule_label: string;
  date_next_run: string | null;
  flag_enabled: number;
  flag_email: number;
  id_conversation: string | null;
  units_consecutive_failures: number;
  recent_runs: { type_status: string; date_run: string; document_error: string | null }[];
}

const STATUS_DOT: Record<string, string> = {
  delivered: "bg-emerald-500",
  no_change: "bg-sky-400",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  running: "bg-blue-400 animate-pulse",
  skipped: "bg-muted-foreground/40",
};

export default function ScheduledPromptsDialog({
  workspaceId, open, onClose, prefill,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  /** Pre-fill the create form (the "Make recurring" path from an answer). */
  prefill?: { title?: string; prompt?: string } | null;
}) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  // Run history (expandable per row, fetched lazily and cached)
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [runsById, setRunsById] = useState<Record<string, any[] | "loading">>({});
  // Create form
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekdays" | "weekly" | "monthly">("weekdays");
  const [hour, setHour] = useState(8);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [email, setEmail] = useState(true);

  // "Make recurring" arrives with the prompt that produced the answer.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (open && prefill && (prefill.title || prefill.prompt)) {
      setShowForm(true);
      setTitle(prefill.title || "");
      setPrompt(prefill.prompt || "");
      prefillAppliedRef.current = true;
    }
    // Closing after a prefill clears the form so a later manual open
    // doesn't show a stale pre-filled draft.
    if (!open && prefillAppliedRef.current) {
      prefillAppliedRef.current = false;
      setShowForm(false);
      setTitle("");
      setPrompt("");
    }
  }, [open, prefill]);

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setTitle(t.title);
    setPrompt(t.prompt);
    setCadence(t.cadence);
    setHour(t.hour);
    if (t.dayOfWeek) setDayOfWeek(t.dayOfWeek);
  };

  const toggleHistory = async (id: string) => {
    if (historyId === id) { setHistoryId(null); return; }
    setHistoryId(id);
    if (!runsById[id]) {
      setRunsById((m) => ({ ...m, [id]: "loading" }));
      try {
        const res = await fetch(`/api/ai/scheduled/${id}`);
        const d = await res.json();
        setRunsById((m) => ({ ...m, [id]: res.ok ? d.runs || [] : [] }));
      } catch {
        setRunsById((m) => ({ ...m, [id]: [] }));
      }
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/scheduled?workspaceId=${workspaceId}`);
      const d = await res.json();
      if (res.ok) setTasks(d.tasks || []);
    } catch { /* transient */ }
    finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const create = async () => {
    if (!title.trim() || !prompt.trim()) { toast.error("Title and prompt are required"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/ai/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, title, prompt,
          typeSchedule: cadence,
          configSchedule: { hour, minute: 0, ...(cadence === "weekly" ? { dayOfWeek } : {}), tz: "Europe/Zurich" },
          emailEnabled: email,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Create failed");
      toast.success(`Scheduled — next run ${new Date(d.nextRun).toLocaleString()}`);
      setTitle(""); setPrompt(""); setShowForm(false);
      void load();
    } catch (e: any) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  const patch = async (id: string, body: any) => {
    const res = await fetch(`/api/ai/scheduled/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) void load(); else toast.error("Update failed");
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      const res = await fetch(`/api/ai/scheduled/${id}/run`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Run failed");
      toast.success("Run complete — result saved to the task's thread");
      if (d.conversationId) window.open(`/?thread=${d.conversationId}`, "_blank");
      // Drop the cached run history so an open panel shows the new run.
      setRunsById((m) => { const { [id]: _stale, ...rest } = m; return rest; });
      void load();
    } catch (e: any) { toast.error(e.message); }
    finally { setRunningId(null); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this scheduled prompt? Its thread and past results are kept.")) return;
    const res = await fetch(`/api/ai/scheduled/${id}`, { method: "DELETE" });
    if (res.ok) void load(); else toast.error("Delete failed");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Scheduled prompts</DialogTitle>
        </DialogHeader>

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 w-full p-3 rounded-xl border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Plus className="h-4 w-4" /> New scheduled prompt
          </button>
        )}

        {showForm && (
          <div className="rounded-xl border p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-0.5">
                <Sparkles className="h-3 w-3" /> Templates
              </span>
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t)}
                  className="text-[11px] px-2 py-1 rounded-full border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Title — e.g. Monday Morning Operations Brief"
              className="w-full h-9 rounded-lg border bg-background px-2.5 text-sm"
            />
            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
              placeholder="The prompt to run — e.g. Summarise CU utilisation by contract, the content pipeline by client, and anything ending within 30 days."
              className="w-full rounded-lg border bg-background p-2.5 text-sm leading-snug resize-y"
            />
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <select value={cadence} onChange={(e) => setCadence(e.target.value as any)} className="h-8 rounded-lg border bg-background px-2 text-sm">
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly (1st)</option>
              </select>
              {cadence === "weekly" && (
                <select value={dayOfWeek} onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))} className="h-8 rounded-lg border bg-background px-2 text-sm">
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
                    <option key={d} value={i + 1}>{d}</option>
                  ))}
                </select>
              )}
              <select value={hour} onChange={(e) => setHour(parseInt(e.target.value, 10))} className="h-8 rounded-lg border bg-background px-2 text-sm">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">Europe/Zurich</span>
              <label className="flex items-center gap-1.5 text-xs ml-auto">
                <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email me results
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="h-8 px-3 rounded-lg border text-sm hover:bg-accent">Cancel</button>
              <button
                onClick={create} disabled={creating}
                className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60 flex items-center gap-1.5"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Schedule
              </button>
            </div>
          </div>
        )}

        {loading && tasks.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
        )}
        {!loading && tasks.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No scheduled prompts yet. Try a weekday-morning operations brief — pipeline, CU utilisation, contracts ending soon.
          </p>
        )}

        <div className="space-y-2">
          {tasks.map((t) => {
            const lastRun = t.recent_runs?.[0];
            return (
              <div key={t.id_prompt} className={cn("rounded-xl border p-3", t.flag_enabled !== 1 && "opacity-70 bg-muted/30")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{t.name_title}</span>
                      {t.flag_enabled !== 1 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                          {t.units_consecutive_failures >= 2 ? "paused — failures" : "paused"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{t.document_prompt}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                      <span>{t.schedule_label}</span>
                      {t.flag_enabled === 1 && t.date_next_run && <span>next {new Date(t.date_next_run).toLocaleString()}</span>}
                      {lastRun && (
                        <span className="flex items-center gap-1" title={lastRun.document_error || lastRun.type_status}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[lastRun.type_status] || "bg-muted-foreground/40")} />
                          last: {lastRun.type_status}
                        </span>
                      )}
                      {t.units_consecutive_failures >= 2 && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleHistory(t.id_prompt)} title="Run history"
                      className={cn(
                        "p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground",
                        historyId === t.id_prompt && "bg-accent text-foreground"
                      )}>
                      <History className="h-3.5 w-3.5" />
                    </button>
                    {t.id_conversation && (
                      <a href={`/?thread=${t.id_conversation}`} target="_blank" rel="noreferrer" title="Open results thread"
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button onClick={() => runNow(t.id_prompt)} disabled={runningId === t.id_prompt} title="Run now"
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50">
                      {runningId === t.id_prompt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => patch(t.id_prompt, { enabled: t.flag_enabled !== 1 })} title={t.flag_enabled === 1 ? "Pause" : "Resume"}
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                      {t.flag_enabled === 1 ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                    </button>
                    <button onClick={() => remove(t.id_prompt)} title="Delete"
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {historyId === t.id_prompt && (
                  <div className="mt-2.5 pt-2.5 border-t">
                    {runsById[t.id_prompt] === "loading" && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading run history…
                      </div>
                    )}
                    {Array.isArray(runsById[t.id_prompt]) && (runsById[t.id_prompt] as any[]).length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">No runs yet — use ▶ Run now to try it.</p>
                    )}
                    {Array.isArray(runsById[t.id_prompt]) && (runsById[t.id_prompt] as any[]).length > 0 && (
                      <div className="space-y-1">
                        {(runsById[t.id_prompt] as any[]).map((r) => (
                          <div key={r.id_run} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[r.type_status] || "bg-muted-foreground/40")} />
                            <span className="w-32 shrink-0">
                              {r.date_run ? new Date(r.date_run).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </span>
                            <span className="w-20 shrink-0 capitalize">{r.type_status}</span>
                            <span className="w-14 shrink-0">{r.units_duration_ms ? `${Math.round(r.units_duration_ms / 1000)}s` : ""}</span>
                            {r.document_error ? (
                              <span className="truncate text-red-500/80" title={r.document_error}>{r.document_error}</span>
                            ) : (
                              <span className="truncate">{r.units_output ? `${r.units_output} tokens out` : ""}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
