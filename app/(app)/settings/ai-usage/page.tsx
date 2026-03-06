"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Check,
  Sparkles,
  ChevronDown,
  Info,
  ExternalLink,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ─────────────── Types ─────────────── */

interface AIModel {
  id: string;
  label: string;
  provider: string;
}

interface CUDefinition {
  format: string;
  category: string;
  units: number;
}

interface ContextConfig {
  contracts: boolean;
  contentPipeline: boolean;
  socialPresence: boolean;
  ideas: boolean;
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

/** Convert tenths-of-cents to display dollars */
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
  "grok-4-1-fast": "Grok 4 Fast",
  "grok-3-mini": "Grok 3 Mini",
  "grok-3": "Grok 3 (Legacy)",
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  xai: "xAI (Grok)",
};

const SOURCE_LABELS: Record<string, string> = {
  enginegpt: "EngineGPT",
  engine: "Content Engine",
  api: "API",
};

/* ─────────────── Component ─────────────── */

export default function AIUsagePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Settings state
  const [aiModel, setAiModel] = useState("grok-4-1-fast");
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [contextConfig, setContextConfig] = useState<ContextConfig>({
    contracts: true,
    contentPipeline: true,
    socialPresence: true,
    ideas: true,
  });
  const [maxTokens, setMaxTokens] = useState(4096);
  const [cuDescription, setCuDescription] = useState("");
  const [cuDefinitions, setCuDefinitions] = useState<CUDefinition[]>([]);

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  // Fetch workspace ID
  useEffect(() => {
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d) => {
        if (d.workspace?.id) setWorkspaceId(d.workspace.id);
      })
      .catch(() => {});
  }, []);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/settings?workspaceId=${workspaceId}`);
      const data = await res.json();
      if (data.currentModel) setAiModel(data.currentModel);
      if (data.availableModels) setAvailableModels(data.availableModels);
      if (data.contextConfig) setContextConfig(data.contextConfig);
      if (data.maxTokens) setMaxTokens(data.maxTokens);
      if (data.cuDescription) setCuDescription(data.cuDescription);
      if (data.cuDefinitions) setCuDefinitions(data.cuDefinitions);
    } catch (err) {
      console.error("Failed to load AI settings:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Fetch usage
  const fetchUsage = useCallback(async () => {
    if (!workspaceId) return;
    setUsageLoading(true);
    try {
      const res = await fetch(
        `/api/ai/usage?workspaceId=${workspaceId}&days=${usageDays}`
      );
      const data = await res.json();
      if (!data.error) setUsageData(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [workspaceId, usageDays]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Save handler
  const handleSave = async () => {
    if (!workspaceId) return;
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
          cuDescription: cuDescription || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      toast.success("AI settings updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Toggle context config
  const toggleConfig = (key: keyof ContextConfig) => {
    setContextConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Usage summary cards
  const summaryCards = usageData
    ? [
        {
          label: "Today",
          data: usageData.summary.today,
          color: "emerald",
          bg: "bg-emerald-500/10",
          text: "text-emerald-600",
        },
        {
          label: "This Week",
          data: usageData.summary.week,
          color: "blue",
          bg: "bg-blue-500/10",
          text: "text-blue-600",
        },
        {
          label: "This Month",
          data: usageData.summary.month,
          color: "purple",
          bg: "bg-purple-500/10",
          text: "text-purple-600",
        },
      ]
    : [];

  // Max cost for progress bars
  const maxModelCost = Math.max(
    ...(usageData?.byModel.map((m) => m.cost) || [1]),
    1
  );
  const maxSourceCost = Math.max(
    ...(usageData?.bySource.map((s) => s.cost) || [1]),
    1
  );

  // Grouped CU definitions by category
  const cuByCategory: Record<string, CUDefinition[]> = {};
  cuDefinitions.forEach((d) => {
    const cat = d.category || "Other";
    if (!cuByCategory[cat]) cuByCategory[cat] = [];
    cuByCategory[cat].push(d);
  });

  // Filter users
  const filteredUsers = (usageData?.byUser || []).filter((u) =>
    userSearch
      ? u.userName.toLowerCase().includes(userSearch.toLowerCase())
      : true
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ─── Section A: Default AI Model ─── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Default AI Model
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Model
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Select the default AI model for new conversations in EngineGPT.
            </p>
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
            <p className="text-xs text-muted-foreground mb-2">
              Maximum number of tokens the AI can generate per response. Higher values allow longer responses but cost more.
            </p>
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

      {/* ─── Section B: Context Controls ─── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">AI Context Controls</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-1">
          <p className="text-xs text-muted-foreground mb-4">
            Control what customer data is included in the AI context when using
            EngineGPT. Disabling a section reduces token usage and cost.
          </p>

          {[
            {
              key: "contracts" as const,
              label: "Contracts",
              description:
                "Include client contract details, CU budgets, dates, and remaining units",
            },
            {
              key: "contentPipeline" as const,
              label: "Content Pipeline",
              description:
                "Include content production stats, type breakdowns, and recent in-production titles",
            },
            {
              key: "socialPresence" as const,
              label: "Social Presence",
              description:
                "Include social media platform post counts and performance data",
            },
            {
              key: "ideas" as const,
              label: "Ideas",
              description:
                "Include recent ideas, status breakdowns, and weekly submission counts",
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-3 py-3 cursor-pointer hover:bg-muted/50 rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="pt-0.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={contextConfig[item.key]}
                  onClick={() => toggleConfig(item.key)}
                  className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center transition-colors shrink-0",
                    contextConfig[item.key]
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-input bg-background"
                  )}
                >
                  {contextConfig[item.key] && (
                    <Check className="h-3 w-3" />
                  )}
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.description}
                </p>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* ─── Section C: Content Engine Context ─── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Content Engine Context</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-5">
          {/* CU System Description */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Content Unit System Description
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Custom description injected into the AI system prompt to explain
              your content unit system. Leave blank to use the auto-generated
              definitions below.
            </p>
            <textarea
              value={cuDescription}
              onChange={(e) => setCuDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[80px] placeholder:text-muted-foreground"
              placeholder="e.g. Our content unit (CU) system measures work output. 1 CU = approximately 1 hour of production work..."
            />
          </div>

          <Separator />

          {/* CU Definitions table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Format Types &amp; CU Values
              </label>
              <a
                href="/settings/content-units"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Edit Definitions
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              These values are automatically included in the AI context so the
              model understands your content measurement system.
            </p>

            {cuDefinitions.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-4 text-center">
                No CU definitions configured yet.
              </p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Format
                      </th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Category
                      </th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        CU Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cuByCategory).map(([cat, defs]) =>
                      defs.map((d, i) => (
                        <tr
                          key={`${cat}-${d.format}`}
                          className="border-t border-border/50"
                        >
                          <td className="px-3 py-2 text-sm">{d.format}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {cat}
                          </td>
                          <td className="px-3 py-2 text-sm text-right font-medium">
                            {d.units}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2"
          size="sm"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>

      <Separator className="my-2" />

      {/* ─── Section D: Usage Dashboard ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">AI Usage Dashboard</h2>
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
            No usage data available yet. AI usage will appear here after
            conversations are processed.
          </p>
        ) : (
          <div className="space-y-5">
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
                    <p className="text-2xl font-bold">
                      {formatCost(card.data.cost)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {card.data.calls} call{card.data.calls !== 1 ? "s" : ""}{" "}
                      &middot; {formatTokens(card.data.input + card.data.output)}{" "}
                      tokens
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Daily Cost Chart */}
            {usageData.daily.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Daily Cost
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={usageData.daily}
                        margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="hsl(var(--border))"
                        />
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
                          formatter={(value: any) => [
                            formatCost(Number(value)),
                            "Cost",
                          ]}
                          labelFormatter={(label: any) => {
                            const d = new Date(String(label) + "T00:00:00");
                            return d.toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            });
                          }}
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--background))",
                          }}
                        />
                        <Bar
                          dataKey="cost"
                          fill="hsl(var(--primary))"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={40}
                        />
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
                  <CardTitle className="text-sm font-medium">
                    Cost by Model
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {usageData.byModel.map((m) => (
                    <div key={m.model}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {MODEL_LABELS[m.model] || m.model}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {m.calls} call{m.calls !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="text-sm font-semibold">
                          {formatCost(m.cost)}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${(m.cost / maxModelCost) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="flex gap-4 mt-1">
                        <span className="text-[10px] text-muted-foreground">
                          Input: {formatTokens(m.inputTokens)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Output: {formatTokens(m.outputTokens)}
                        </span>
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
                  <CardTitle className="text-sm font-medium">
                    Cost by Source
                  </CardTitle>
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
                            <span className="text-sm font-medium">
                              {SOURCE_LABELS[s.source] || s.source}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {s.calls} call{s.calls !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <span className="text-sm font-semibold">
                            {formatCost(s.cost)}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              sourceColors[s.source] || "bg-gray-500"
                            )}
                            style={{
                              width: `${(s.cost / maxSourceCost) * 100}%`,
                            }}
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
                    <CardTitle className="text-sm font-medium">
                      Per-User Cost
                    </CardTitle>
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
                          <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            User
                          </th>
                          <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Cost
                          </th>
                          <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Calls
                          </th>
                          <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                            Input
                          </th>
                          <th className="text-right px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                            Output
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr
                            key={u.userId}
                            className="border-t border-border/50"
                          >
                            <td className="px-3 py-2 text-sm font-medium">
                              {u.userName}
                            </td>
                            <td className="px-3 py-2 text-sm text-right">
                              {formatCost(u.cost)}
                            </td>
                            <td className="px-3 py-2 text-sm text-right text-muted-foreground">
                              {u.calls}
                            </td>
                            <td className="px-3 py-2 text-xs text-right text-muted-foreground hidden sm:table-cell">
                              {formatTokens(u.inputTokens)}
                            </td>
                            <td className="px-3 py-2 text-xs text-right text-muted-foreground hidden sm:table-cell">
                              {formatTokens(u.outputTokens)}
                            </td>
                          </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-3 py-6 text-center text-sm text-muted-foreground"
                            >
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
          </div>
        )}
      </div>
    </div>
  );
}
