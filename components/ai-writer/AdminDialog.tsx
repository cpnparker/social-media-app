"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  Bug,
  Globe,
  Plus,
  Pencil,
  Trash2,
  X,
  Sparkles,
  Save,
  RotateCcw,
  Lightbulb,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { categorizeContentType, CATEGORY_ORDER, CATEGORY_ICONS } from "@/lib/content-type-utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AIRole } from "@/lib/types/ai";

/* ─────────────── Types ─────────────── */

interface AIModel {
  id: string;
  label: string;
  provider: string;
}

interface CUDefinition {
  id: string;
  format: string;
  category: string;
  categoryName: string;
  units: number;
  description: string;
}

type DetailLevel = "off" | "summary" | "full-week" | "full-month" | "full-year";

interface ContextConfig {
  contracts: DetailLevel;
  contentPipeline: DetailLevel;
  socialPresence: DetailLevel;
  ideas: DetailLevel;
  webSearch?: "on" | "off";
}

interface UsageSummaryPeriod {
  cost: number;
  calls: number;
  input: number;
  output: number;
}

interface UsageData {
  summary: {
    today: UsageSummaryPeriod;
    week: UsageSummaryPeriod;
    month: UsageSummaryPeriod;
  };
  daily: { date: string; cost: number; calls: number }[];
  byModel: {
    model: string;
    cost: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  bySource: { source: string; cost: number; calls: number }[];
  byUser: {
    userId: number;
    userName: string;
    cost: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
}

/* ─────────────── Helpers ─────────────── */

function formatCost(tenths: number): string {
  const dollars = tenths / 1000;
  if (dollars < 0.01 && dollars > 0) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "grok-4-1-fast": "Grok 4 Fast",
  "grok-3-mini": "Grok 3 Mini",
  "grok-3": "Grok 3 (Legacy)",
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI (Grok)",
};

const SOURCE_LABELS: Record<string, string> = {
  enginegpt: "EngineGPT",
  engine: "Content Engine",
  api: "API",
};

interface AdminDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = "usage" | "context" | "roles" | "formats";

export default function AdminDialog({ workspaceId, open, onClose }: AdminDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("usage");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-lg font-semibold">Administration</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-0.5 bg-muted rounded-lg p-0.5 mx-6 mt-3 w-fit">
          {([
            { key: "usage" as Tab, label: "Usage" },
            { key: "context" as Tab, label: "Context" },
            { key: "formats" as Tab, label: "Formats" },
            { key: "roles" as Tab, label: "Roles" },
          ]).map((t) => (
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
          {activeTab === "usage" && <UsageTab workspaceId={workspaceId} />}
          {activeTab === "context" && <ContextTab workspaceId={workspaceId} />}
          {activeTab === "formats" && <FormatsTab workspaceId={workspaceId} />}
          {activeTab === "roles" && <RolesTab workspaceId={workspaceId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════
   USAGE TAB
   ═══════════════════════════════════════════════════ */

function UsageTab({ workspaceId }: { workspaceId: string }) {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/ai/usage?workspaceId=${workspaceId}&days=${usageDays}`);
      const data = await res.json();
      if (!data.error) setUsageData(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [workspaceId, usageDays]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const summaryCards = usageData
    ? [
        { label: "Today", data: usageData.summary.today, color: "emerald" },
        { label: "This Week", data: usageData.summary.week, color: "blue" },
        { label: "This Month", data: usageData.summary.month, color: "purple" },
      ]
    : [];

  const maxModelCost = Math.max(...(usageData?.byModel.map((m) => m.cost) || [1]), 1);
  const maxSourceCost = Math.max(...(usageData?.bySource.map((s) => s.cost) || [1]), 1);

  const filteredUsers = (usageData?.byUser || []).filter((u) =>
    userSearch ? u.userName.toLowerCase().includes(userSearch.toLowerCase()) : true
  );

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI Usage Dashboard</h3>
        <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
          {[
            { label: "7d", value: 7 },
            { label: "14d", value: 14 },
            { label: "30d", value: 30 },
          ].map((p) => (
            <button
              key={p.value}
              onClick={() => setUsageDays(p.value)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                usageDays === p.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {usageLoading && !usageData ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !usageData ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No usage data available yet.
        </p>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {summaryCards.map((card) => (
              <Card key={card.label} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        card.color === "emerald" && "bg-emerald-500",
                        card.color === "blue" && "bg-blue-500",
                        card.color === "purple" && "bg-purple-500"
                      )}
                    />
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {card.label}
                    </span>
                  </div>
                  <p className="text-2xl font-bold">{formatCost(card.data.cost)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {card.data.calls} call{card.data.calls !== 1 ? "s" : ""} &middot;{" "}
                    {formatTokens(card.data.input + card.data.output)} tokens
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Daily Cost Chart */}
          {usageData.daily.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Daily Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usageData.daily} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: string) => {
                          const d = new Date(v + "T00:00:00");
                          return `${d.getDate()}/${d.getMonth() + 1}`;
                        }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: number) => formatCost(v)}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <Tooltip
                        formatter={(value: any) => [formatCost(Number(value)), "Cost"]}
                        labelFormatter={(label: any) => {
                          const d = new Date(String(label) + "T00:00:00");
                          return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                        }}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid hsl(var(--border))",
                          background: "hsl(var(--background))",
                        }}
                      />
                      <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cost by Model */}
          {usageData.byModel.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cost by Model</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {usageData.byModel.map((m) => (
                  <div key={m.model}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{MODEL_LABELS[m.model] || m.model}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {m.calls} call{m.calls !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span className="text-sm font-semibold">{formatCost(m.cost)}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(m.cost / maxModelCost) * 100}%` }}
                      />
                    </div>
                    <div className="flex gap-4 mt-1">
                      <span className="text-[10px] text-muted-foreground">Input: {formatTokens(m.inputTokens)}</span>
                      <span className="text-[10px] text-muted-foreground">Output: {formatTokens(m.outputTokens)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Cost by Source */}
          {usageData.bySource.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cost by Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {usageData.bySource.map((s) => {
                  const sourceColors: Record<string, string> = {
                    enginegpt: "bg-blue-500",
                    engine: "bg-violet-500",
                    api: "bg-amber-500",
                  };
                  return (
                    <div key={s.source}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{SOURCE_LABELS[s.source] || s.source}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.calls} call{s.calls !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="text-sm font-semibold">{formatCost(s.cost)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", sourceColors[s.source] || "bg-gray-500")}
                          style={{ width: `${(s.cost / maxSourceCost) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Per-User Cost */}
          {usageData.byUser.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Per-User Cost</CardTitle>
                  {usageData.byUser.length > 5 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Search users..."
                        className="h-7 rounded-md border border-input bg-background pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring w-40"
                      />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">User</th>
                        <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Cost</th>
                        <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Calls</th>
                        <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Input</th>
                        <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.userId} className="border-t border-border/50">
                          <td className="px-3 py-2 text-sm font-medium">{u.userName}</td>
                          <td className="px-3 py-2 text-sm text-right">{formatCost(u.cost)}</td>
                          <td className="px-3 py-2 text-sm text-right text-muted-foreground">{u.calls}</td>
                          <td className="px-3 py-2 text-xs text-right text-muted-foreground hidden sm:table-cell">{formatTokens(u.inputTokens)}</td>
                          <td className="px-3 py-2 text-xs text-right text-muted-foreground hidden sm:table-cell">{formatTokens(u.outputTokens)}</td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            No users found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CONTEXT TAB
   ═══════════════════════════════════════════════════ */

function ContextTab({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [aiModel, setAiModel] = useState("grok-4-1-fast");
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [contextConfig, setContextConfig] = useState<ContextConfig>({
    contracts: "summary",
    contentPipeline: "summary",
    socialPresence: "summary",
    ideas: "summary",
    webSearch: "on",
  });
  const [maxTokens, setMaxTokens] = useState(4096);
  const [debugMode, setDebugMode] = useState(false);
  const [cuDescription, setCuDescription] = useState("");
  const [cuDefinitions, setCuDefinitions] = useState<CUDefinition[]>([]);
  const [formatDescriptions, setFormatDescriptions] = useState<Record<string, string>>({});

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/settings?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.currentModel) setAiModel(data.currentModel);
      if (data.availableModels) setAvailableModels(data.availableModels);
      if (data.contextConfig) setContextConfig(data.contextConfig);
      if (data.maxTokens) setMaxTokens(data.maxTokens);
      if (data.debugMode !== undefined) setDebugMode(data.debugMode);
      if (data.cuDescription) setCuDescription(data.cuDescription);
      if (data.cuDefinitions) {
        setCuDefinitions(data.cuDefinitions);
        // Initialize format descriptions from API response
        const descs: Record<string, string> = {};
        data.cuDefinitions.forEach((d: CUDefinition) => {
          if (d.description) descs[d.id] = d.description;
        });
        setFormatDescriptions(descs);
      }
    } catch (err) {
      console.error("Failed to load AI settings:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const setConfigLevel = (key: keyof ContextConfig, level: DetailLevel) => {
    setContextConfig((prev) => ({ ...prev, [key]: level }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          model: aiModel,
          contextConfig,
          maxTokens,
          debugMode,
          cuDescription: cuDescription || null,
          formatDescriptions,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Model & Tokens */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Default AI Model
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Model
            </label>
            <div className="relative max-w-md">
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm appearance-none cursor-pointer pr-8 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {availableModels.length > 0 ? (
                  availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} — {PROVIDER_LABELS[model.provider] || model.provider}
                    </option>
                  ))
                ) : (
                  <option value="grok-4-1-fast">Grok 4 Fast — xAI</option>
                )}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <Separator />

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Max Response Tokens
            </label>
            <div className="relative max-w-md">
              <select
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm appearance-none cursor-pointer pr-8 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={2048}>2,048 tokens</option>
                <option value={4096}>4,096 tokens (default)</option>
                <option value={8192}>8,192 tokens</option>
                <option value={16384}>16,384 tokens</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Context Controls */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">AI Context Controls</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-1">
          <p className="text-xs text-muted-foreground mb-4">
            Control what customer data is included in the AI context.
          </p>
          {[
            { key: "contracts" as const, label: "Contracts", description: "Contract details, CU budgets, and commissioned content" },
            { key: "contentPipeline" as const, label: "Content Pipeline", description: "Content production stats, items with briefs and topics" },
            { key: "socialPresence" as const, label: "Social Presence", description: "Social media platform post counts and performance" },
            { key: "ideas" as const, label: "Ideas", description: "Ideas with briefs, status breakdowns, and topic tags" },
          ].map((item) => {
            const level = contextConfig[item.key];
            const isFull = typeof level === "string" && level.startsWith("full");
            return (
              <div key={item.key} className="flex items-start gap-3 py-3 rounded-lg px-2 -mx-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium leading-tight">{item.label}</p>
                    <div className="relative">
                      <select
                        value={level}
                        onChange={(e) => setConfigLevel(item.key, e.target.value as DetailLevel)}
                        className={cn(
                          "h-7 rounded-md border px-2 pr-7 text-xs font-medium appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring",
                          level === "off"
                            ? "bg-muted text-muted-foreground border-input"
                            : isFull
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "bg-background text-foreground border-input"
                        )}
                      >
                        <option value="off">Off</option>
                        <option value="summary">Summary</option>
                        <option value="full-week">Full: Last Week</option>
                        <option value="full-month">Full: Last Month</option>
                        <option value="full-year">Full: Last Year</option>
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {level === "off"
                      ? `${item.label} excluded from AI context`
                      : level === "summary"
                      ? `Compact overview — ${item.description.split(",")[0].toLowerCase()}`
                      : `Full detail (${level === "full-week" ? "7 days" : level === "full-month" ? "30 days" : "12 months"}) — ${item.description.toLowerCase()}`}
                  </p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Web Search */}
      <Card className="border-0 shadow-sm">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Globe className="h-4 w-4 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Web Search</p>
              <p className="text-xs text-muted-foreground">Enable web search by default</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={contextConfig.webSearch === "on"}
            onClick={() =>
              setContextConfig((prev) => ({
                ...prev,
                webSearch: prev.webSearch === "on" ? "off" : "on",
              }))
            }
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              contextConfig.webSearch === "on" ? "bg-emerald-500" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${
                contextConfig.webSearch === "on" ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </CardContent>
      </Card>

      {/* CU System Description */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Content Unit System Description</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground mb-2">
            Custom description injected into the AI system prompt to explain your content unit system.
          </p>
          <textarea
            value={cuDescription}
            onChange={(e) => setCuDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[60px] placeholder:text-muted-foreground"
            placeholder="e.g. Our content unit (CU) system measures work output. 1 CU = approximately 1 hour..."
          />
        </CardContent>
      </Card>

      {/* Debug Mode */}
      <Card className="border-0 shadow-sm border-l-2 border-l-amber-400">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Bug className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Debug Mode</p>
              <p className="text-xs text-muted-foreground">Show system prompt before each AI response</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={debugMode}
            onClick={() => setDebugMode(!debugMode)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              debugMode ? "bg-amber-500" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${
                debugMode ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3 pb-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FORMATS TAB
   ═══════════════════════════════════════════════════ */

// ── Content type instruction categories & defaults ──

const INSTRUCTION_CATEGORIES = [
  { key: "written", label: "Written", icon: "✍️" },
  { key: "video", label: "Video", icon: "🎬" },
  { key: "visual", label: "Visual", icon: "🎨" },
  { key: "strategy", label: "Strategy", icon: "⚙️" },
];

const DEFAULT_TYPE_INSTRUCTIONS: Record<string, string> = {
  written: `When drafting or reviewing written content:
- Produce publication-ready copy that matches the brief's tone, audience, and word count targets
- Structure with a compelling headline, strong opening hook, well-organised body sections, and clear conclusion
- Prioritise clarity, readability, and natural flow — avoid jargon unless the audience expects it
- Include SEO-friendly headings and subheadings where appropriate
- Ensure every piece has a clear purpose and call-to-action aligned with the client's objectives
- Reference the content brief, audience profile, and topic tags to tailor messaging
- When suggesting improvements, provide specific rewrites rather than generic feedback`,

  video: `When drafting or reviewing video content:
- Write scripts in a clear format: scene descriptions, spoken dialogue/narration, on-screen text, and visual direction
- Structure with a strong hook (first 3 seconds), engaging body, and clear call-to-action
- Include duration guidance aligned with the CU allocation and platform requirements
- Consider platform-specific best practices (YouTube: longer form with chapters; Instagram/TikTok: vertical, punchy; LinkedIn: professional, insight-driven)
- Specify B-roll suggestions, graphics overlays, and transition notes where relevant
- For interview-based content, prepare key questions and suggested talking points
- Flag any production requirements: locations, talent, equipment, or assets needed`,

  visual: `When drafting or reviewing visual content:
- Provide clear creative direction: mood, colour palette, composition, and visual hierarchy
- Specify text overlay copy, font guidance, and content hierarchy for multi-text layouts
- Include platform-optimised dimensions and format specifications
- For carousel/collection content, outline the narrative sequence and per-slide messaging
- Reference brand guidelines and visual identity when available
- Suggest data visualisation approaches for infographic content — charts, icons, stats callouts
- Consider accessibility: contrast ratios, text readability, alt-text suggestions`,

  strategy: `When reviewing or developing strategy content, provide thorough, comprehensive analysis — not surface-level observations. Structure responses to cover:

1. **Executive Assessment** — Overall quality, completeness, and strategic coherence
2. **Objectives & Audience** — Are goals explicit, measurable, and audience-specific? If missing, propose them
3. **Content & Depth** — Evaluate substance: data usage, insights quality, visual/infographic opportunities, and whether analysis goes beyond surface level
4. **Output Roadmap** — Map findings to concrete content units (articles, carousels, video scripts) with CU allocations where relevant
5. **Distribution & Metrics** — Recommend channels, engagement benchmarks, and KPIs tied to strategy goals
6. **Risks & Next Steps** — Flag gaps, assumptions, or risks and provide actionable next steps

Be specific and reference actual content. Give detailed, publication-quality recommendations — not generic advice. If a strategy is thin, fill in the gaps with substantive suggestions.`,
};

function FormatsTab({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [definitions, setDefinitions] = useState<CUDefinition[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Format descriptions from Neon
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [savedDescriptions, setSavedDescriptions] = useState<Record<string, string>>({});

  // Content type instructions (keyed by category: written, video, visual, strategy)
  const [typeInstructions, setTypeInstructions] = useState<Record<string, string>>({});
  const [expandedTypeKey, setExpandedTypeKey] = useState<string | null>(null);
  const [savingTypeKeys, setSavingTypeKeys] = useState<Set<string>>(new Set());
  const [savedTypeKeys, setSavedTypeKeys] = useState<Set<string>>(new Set());

  // Per-format state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Debounce timers
  const [debounceTimers] = useState<Map<string, NodeJS.Timeout>>(new Map());

  // Fetch definitions + descriptions
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/settings?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      const defs: CUDefinition[] = (data.cuDefinitions || []).map((d: any) => ({
        id: d.id,
        format: d.format,
        category: d.category || "other",
        categoryName: d.categoryName || "",
        units: d.units,
        description: d.description || "",
      }));
      setDefinitions(defs);

      const descs: Record<string, string> = {};
      defs.forEach((d) => { if (d.description) descs[d.id] = d.description; });
      setDescriptions(descs);
      setSavedDescriptions(descs);

      // Type instructions (keyed by category: written, video, visual, strategy)
      const existingInstructions: Record<string, string> = data.typeInstructions || {};
      setTypeInstructions(existingInstructions);

      // Auto-populate defaults if no instructions exist yet
      const hasAny = Object.values(existingInstructions).some((v) => v?.trim());
      if (!hasAny) {
        const defaults = DEFAULT_TYPE_INSTRUCTIONS;
        setTypeInstructions(defaults);
        // Save defaults to DB
        fetch("/api/ai/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, typeInstructions: defaults }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to load format data:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      debounceTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [debounceTimers]);

  // Auto-save with debounce
  const autoSave = useCallback(async (defId: string, value: string) => {
    setSavingIds((prev) => new Set(prev).add(defId));
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, formatDescriptions: { [defId]: value } }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedDescriptions((prev) => ({ ...prev, [defId]: value }));
      setSavedIds((prev) => new Set(prev).add(defId));
      setTimeout(() => setSavedIds((prev) => { const n = new Set(prev); n.delete(defId); return n; }), 2000);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingIds((prev) => { const n = new Set(prev); n.delete(defId); return n; });
    }
  }, [workspaceId]);

  // Handle textarea change with debounced auto-save
  const handleChange = useCallback((defId: string, value: string) => {
    setDescriptions((prev) => ({ ...prev, [defId]: value }));

    // Clear existing timer for this format
    const existing = debounceTimers.get(defId);
    if (existing) clearTimeout(existing);

    // Set new debounce timer (800ms after last keystroke)
    const timer = setTimeout(() => {
      autoSave(defId, value);
      debounceTimers.delete(defId);
    }, 800);
    debounceTimers.set(defId, timer);
  }, [autoSave, debounceTimers]);

  // Clear a format description
  const clearDescription = useCallback(async (defId: string) => {
    // Cancel any pending debounce
    const existing = debounceTimers.get(defId);
    if (existing) { clearTimeout(existing); debounceTimers.delete(defId); }

    setSavingIds((prev) => new Set(prev).add(defId));
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, formatDescriptions: { [defId]: "" } }),
      });
      if (!res.ok) throw new Error("Failed to clear");
      setDescriptions((prev) => { const c = { ...prev }; delete c[defId]; return c; });
      setSavedDescriptions((prev) => { const c = { ...prev }; delete c[defId]; return c; });
      toast.success("Prompt cleared");
    } catch {
      toast.error("Failed to clear prompt");
    } finally {
      setSavingIds((prev) => { const n = new Set(prev); n.delete(defId); return n; });
    }
  }, [workspaceId, debounceTimers]);

  // Auto-save type instructions with debounce
  const autoSaveType = useCallback(async (key: string, value: string) => {
    setSavingTypeKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, typeInstructions: { [key]: value } }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedTypeKeys((prev) => new Set(prev).add(key));
      setTimeout(() => setSavedTypeKeys((prev) => { const n = new Set(prev); n.delete(key); return n; }), 2000);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingTypeKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [workspaceId]);

  const handleTypeChange = useCallback((key: string, value: string) => {
    setTypeInstructions((prev) => ({ ...prev, [key]: value }));
    const timerId = `type:${key}`;
    const existing = debounceTimers.get(timerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      autoSaveType(key, value);
      debounceTimers.delete(timerId);
    }, 800);
    debounceTimers.set(timerId, timer);
  }, [autoSaveType, debounceTimers]);

  // Map definitions to standard categories (Written, Video, Visual, Strategy)
  const getCategory = (def: CUDefinition) => categorizeContentType(def.category || "other");

  // Get available categories in standard order
  const availableCategories = CATEGORY_ORDER.filter((cat) =>
    definitions.some((d) => getCategory(d) === cat)
  );

  // Filter definitions by active tab
  const filteredDefs = activeFilter
    ? definitions.filter((d) => getCategory(d) === activeFilter)
    : definitions;

  // Group filtered definitions by standard category
  const grouped = CATEGORY_ORDER.reduce<Record<string, CUDefinition[]>>((acc, cat) => {
    const matching = filteredDefs.filter((d) => getCategory(d) === cat);
    if (matching.length > 0) acc[cat] = matching;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Content Type Instructions ── */}
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Content Type Instructions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI instructions per content category — applied when working with that type of content, or when detected in general chats.
          </p>
        </div>
        <div className="space-y-1">
          {INSTRUCTION_CATEGORIES.map((cat) => {
            const key = cat.key;
            const isExpanded = expandedTypeKey === key;
            const currentInstr = typeInstructions[key] || "";
            const hasInstr = !!currentInstr.trim();
            const isSaving = savingTypeKeys.has(key);
            const justSaved = savedTypeKeys.has(key);
            const hasDefault = DEFAULT_TYPE_INSTRUCTIONS[key]?.trim();
            const isDefault = hasInstr && currentInstr.trim() === DEFAULT_TYPE_INSTRUCTIONS[key]?.trim();

            return (
              <div key={key} className="border rounded-lg">
                <button
                  onClick={() => setExpandedTypeKey(isExpanded ? null : key)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-lg"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-base shrink-0">{cat.icon}</span>
                  <span className="text-sm font-medium truncate flex-1">{cat.label}</span>
                  {isSaving && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                  )}
                  {justSaved && !isSaving && (
                    <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                  )}
                  {hasInstr && !isSaving && !justSaved && (
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0",
                      isDefault
                        ? "text-emerald-600 bg-emerald-500/10"
                        : "text-blue-600 bg-blue-500/10"
                    )}>
                      {isDefault ? "Default" : "Custom"}
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t">
                    <div className="pt-2.5">
                      <textarea
                        value={currentInstr}
                        onChange={(e) => handleTypeChange(key, e.target.value)}
                        placeholder={`Instructions for ${cat.label} content — e.g., analysis depth, structure, tone, specific frameworks to apply...`}
                        rows={10}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring font-mono leading-relaxed"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[11px] text-muted-foreground">
                          Applied when users work with {cat.label} content, or when &quot;{cat.label.toLowerCase()}&quot; is mentioned in general chats.
                        </p>
                        <div className="flex items-center gap-1.5">
                          {hasDefault && !isDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const defaultVal = DEFAULT_TYPE_INSTRUCTIONS[key];
                                handleTypeChange(key, defaultVal);
                              }}
                              className="gap-1.5 h-7 text-xs text-muted-foreground"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Reset
                            </Button>
                          )}
                          {hasInstr && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTypeChange(key, "")}
                              disabled={isSaving}
                              className="gap-1.5 h-7 text-xs text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Format Descriptions ── */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Format Descriptions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI prompts per content format — included as context when EngineGPT works with that format.
          </p>
        </div>

      {/* Content type filter tabs */}
      {availableCategories.length > 1 && (
        <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveFilter(null)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              activeFilter === null
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                activeFilter === cat
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {CATEGORY_ICONS[cat] || "📋"} {cat}
            </button>
          ))}
        </div>
      )}

      {filteredDefs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No formats defined</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([category, defs]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {CATEGORY_ICONS[category] || "📋"} {category}
              </h4>
              <div className="space-y-1">
                {defs.map((def) => {
                  const isExpanded = expandedId === def.id;
                  const currentPrompt = descriptions[def.id] || "";
                  const hasPrompt = !!currentPrompt.trim();
                  const isSaving = savingIds.has(def.id);
                  const justSaved = savedIds.has(def.id);

                  return (
                    <div key={def.id} className="border rounded-lg">
                      {/* Header */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : def.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-lg"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium truncate flex-1">{def.format}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">{def.units} CU</span>
                        {isSaving && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {justSaved && !isSaving && (
                          <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                        )}
                        {hasPrompt && !isSaving && !justSaved && (
                          <span className="text-[10px] font-medium text-violet-600 bg-violet-500/10 px-1.5 py-0.5 rounded shrink-0">
                            Custom
                          </span>
                        )}
                      </button>

                      {/* Editor */}
                      {isExpanded && (
                        <div className="px-3 pb-3 border-t">
                          <div className="pt-2.5">
                            <textarea
                              value={currentPrompt}
                              onChange={(e) => handleChange(def.id, e.target.value)}
                              placeholder={`Describe how ${def.format} content should be written, structured, or approached...`}
                              rows={6}
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring font-mono leading-relaxed"
                            />

                            <div className="flex items-center justify-between mt-2">
                              {/* Variable hints */}
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Lightbulb className="h-3 w-3 text-amber-500 shrink-0" />
                                <code className="bg-muted px-1 rounded">{"{content_type}"}</code>
                                <code className="bg-muted px-1 rounded">{"{title}"}</code>
                                <code className="bg-muted px-1 rounded">{"{brief}"}</code>
                                <code className="bg-muted px-1 rounded">{"{topics}"}</code>
                                <code className="bg-muted px-1 rounded">{"{customer}"}</code>
                              </div>

                              {/* Clear button */}
                              {hasPrompt && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => clearDescription(def.id)}
                                  disabled={isSaving}
                                  className="gap-1.5 h-7 text-xs text-muted-foreground hover:text-destructive"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Clear
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ROLES TAB
   ═══════════════════════════════════════════════════ */

function RolesTab({ workspaceId }: { workspaceId: string }) {
  const [roles, setRoles] = useState<AIRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState<AIRole | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // New/edit form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formIcon, setFormIcon] = useState("🤖");
  const [formSaving, setFormSaving] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/roles?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.roles) setRoles(data.roles);
    } catch (err) {
      console.error("Failed to load roles:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormInstructions("");
    setFormIcon("🤖");
    setEditingRole(null);
    setShowNewForm(false);
  };

  const startEdit = (role: AIRole) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormDescription(role.description);
    setFormInstructions(role.instructions);
    setFormIcon(role.icon);
    setShowNewForm(false);
  };

  const startNew = () => {
    resetForm();
    setShowNewForm(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formDescription.trim() || !formInstructions.trim()) {
      toast.error("All fields are required");
      return;
    }
    setFormSaving(true);
    try {
      if (editingRole) {
        // Update
        const res = await fetch("/api/ai/roles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roleId: editingRole.id,
            name: formName,
            description: formDescription,
            instructions: formInstructions,
            icon: formIcon,
          }),
        });
        if (!res.ok) throw new Error("Failed to update role");
        toast.success("Role updated");
      } else {
        // Create
        const res = await fetch("/api/ai/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            name: formName,
            description: formDescription,
            instructions: formInstructions,
            icon: formIcon,
          }),
        });
        if (!res.ok) throw new Error("Failed to create role");
        toast.success("Role created");
      }
      resetForm();
      fetchRoles();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/ai/roles?roleId=${deleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete role");
      toast.success("Role deleted");
      setDeleteId(null);
      fetchRoles();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (role: AIRole) => {
    try {
      await fetch("/api/ai/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: role.id, isActive: !role.isActive }),
      });
      setRoles((prev) =>
        prev.map((r) => (r.id === role.id ? { ...r, isActive: !r.isActive } : r))
      );
    } catch {
      toast.error("Failed to update role");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isFormOpen = showNewForm || editingRole !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">AI Roles</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure AI personas that modify how EngineGPT responds.
          </p>
        </div>
        {!isFormOpen && (
          <Button onClick={startNew} size="sm" variant="outline" className="gap-1.5 h-8">
            <Plus className="h-3.5 w-3.5" />
            Add Role
          </Button>
        )}
      </div>

      {/* New/Edit form */}
      {isFormOpen && (
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{editingRole ? "Edit Role" : "New Role"}</p>
              <button onClick={resetForm} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Icon
                </label>
                <input
                  value={formIcon}
                  onChange={(e) => setFormIcon(e.target.value)}
                  className="w-12 h-9 rounded-md border border-input bg-background text-center text-lg focus:outline-none focus:ring-1 focus:ring-ring"
                  maxLength={2}
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Name
                </label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="e.g. Research Analyst"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Description
              </label>
              <input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="One-line summary of this role"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Instructions
              </label>
              <p className="text-[11px] text-muted-foreground mb-1">
                System prompt instructions that define this persona&apos;s expertise and behavior.
              </p>
              <textarea
                value={formInstructions}
                onChange={(e) => setFormInstructions(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[80px] placeholder:text-muted-foreground"
                placeholder="You are a... Focus on... When asked about..."
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={formSaving} size="sm" className="gap-1.5">
                {formSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editingRole ? "Save Changes" : "Create Role"}
              </Button>
              <Button onClick={resetForm} variant="ghost" size="sm">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Role list */}
      <div className="space-y-2">
        {roles.map((role) => (
          <div
            key={role.id}
            className={cn(
              "border rounded-lg p-3 transition-colors",
              !role.isActive && "opacity-50"
            )}
          >
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5">{role.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{role.name}</p>
                  {role.isDefault && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(role)}
                  className={cn(
                    "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    role.isActive ? "bg-emerald-500" : "bg-muted"
                  )}
                  title={role.isActive ? "Active" : "Inactive"}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transform transition-transform",
                      role.isActive ? "translate-x-3" : "translate-x-0"
                    )}
                  />
                </button>
                <button
                  onClick={() => startEdit(role)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDeleteId(role.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {roles.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No roles configured yet.
        </p>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this role. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
