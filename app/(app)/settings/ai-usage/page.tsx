"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Check,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Info,
  ExternalLink,
  Search,
  Bug,
  Globe,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
  daily: Record<string, any>[];
  dailyModels?: string[];
  byModel: {
    model: string;
    cost: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  bySource: { source: string; app?: string; cost: number; calls: number }[];
  byApp?: { app: string; cost: number; calls: number; input: number; output: number }[];
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
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
  "claude-haiku-3-20240307": "Claude Haiku 3",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4.1": "GPT-4.1",
  "grok-4-1-fast-non-reasoning": "Grok 4 Fast",
  "grok-4-1-fast": "Grok 4 Fast",
  "grok-4": "Grok 4",
  "grok-3-mini": "Grok 3 Mini",
  "grok-3-fast": "Grok 3 Fast",
  "grok-3": "Grok 3 (Legacy)",
  "grok-imagine-image": "Grok Image",
  "dall-e-3": "DALL-E 3",
  "gemini-3-flash": "Gemini 3 Flash",
  "gemini-3.1-flash-lite": "Gemini 3.1 Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "mistral-large-latest": "Mistral Large",
};

const MODEL_COLORS: Record<string, string> = {
  "grok-4-1-fast-non-reasoning": "#3B82F6",
  "grok-3-fast": "#60A5FA",
  "grok-3-mini": "#93C5FD",
  "grok-imagine-image": "#818CF8",
  "claude-sonnet-4-6": "#F97316",
  "claude-sonnet-4-20250514": "#FB923C",
  "gpt-4o": "#10B981",
  "gpt-4o-mini": "#34D399",
  "dall-e-3": "#A78BFA",
  "gemini-3-flash": "#EC4899",
  "gemini-3.1-flash-lite": "#F472B6",
};
const DEFAULT_MODEL_COLORS = ["#6366F1", "#8B5CF6", "#06B6D4", "#14B8A6", "#F59E0B", "#EF4444", "#84CC16", "#E879F9"];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI (Grok)",
};

const SOURCE_LABELS: Record<string, string> = {
  // Engine
  engineai: "EngineAI",
  enginegpt: "EngineAI",
  engine: "Content Engine",
  api: "API",
  // MeetingBrain
  email: "Email Scanner",
  slack: "Slack Scanner",
  teams: "Teams Scanner",
  meeting: "Meeting Notes",
  "ms-email": "MS Email",
  "ms-calendar": "MS Calendar",
  dashboard: "Dashboard AI",
  chat: "Chat",
  action: "Action Items",
  project: "Project AI",
  // AuthorityOn
  scan: "Brand Scan",
  "brand-suggest": "Brand Setup",
  // RFP Tool
  "rfp-extract": "RFP Extract",
  "rfp-search": "RFP Search",
  "rfp-sections": "RFP Sections",
  "rfp-generate": "RFP Generate",
  "rfp-profile": "RFP Profile",
  // Background AI
  "memory-extract": "Memory Extract",
  "memory-extract-meeting": "Memory (Meeting)",
  "memory-extract-task": "Memory (Task)",
  "memory-consolidate": "Memory Consolidate",
  "summary-generate": "Summary Generate",
  "summary-update": "Summary Update",
  "client-context": "Client Context",
  // Post Actions
  "post-generate": "Post Generate",
  "post-rewrite": "Post Rewrite",
  "post-hashtags": "Post Hashtags",
  "post-adapt": "Post Adapt",
  "post-best-time": "Best Time",
  "post-insights": "Post Insights",
  "post-auto-tag": "Auto Tag",
  "post-score": "Idea Score",
  "post-ideas": "Idea Suggest",
  "post-promo": "Promo Drafts",
  "post-content": "Content Generate",
  "post-research": "Topic Research",
  "post-themes": "Theme Suggest",
  "post-fact-check": "Fact Check",
  "post-detect-ai": "AI Detection",
};

const APP_LABELS: Record<string, string> = {
  engine: "Engine",
  meetingbrain: "MeetingBrain",
  authorityon: "AuthorityOn",
};

const APP_COLORS: Record<string, string> = {
  engine: "bg-blue-500",
  meetingbrain: "bg-emerald-500",
  authorityon: "bg-amber-500",
};

/* ─── Product groupings for hierarchical source view ─── */

interface ProductGroup {
  label: string;
  color: string;
  sources: string[];
}

const PRODUCT_GROUPS: Record<string, ProductGroup> = {
  "engineai": { label: "EngineAI Conversations", color: "bg-blue-500", sources: ["engine", "enginegpt", "engineai", "api"] },
  "content-tools": { label: "Content Tools", color: "bg-violet-500", sources: ["post-generate", "post-rewrite", "post-hashtags", "post-adapt", "post-best-time", "post-insights", "post-auto-tag", "post-score", "post-ideas", "post-promo", "post-content", "post-research", "post-themes", "post-fact-check", "post-detect-ai"] },
  "rfp": { label: "RFP Tool", color: "bg-rose-500", sources: ["rfp-extract", "rfp-search", "rfp-sections", "rfp-generate", "rfp-profile"] },
  "background": { label: "Background AI", color: "bg-slate-400", sources: ["memory-extract", "memory-extract-meeting", "memory-extract-task", "memory-consolidate", "summary-generate", "summary-update", "client-context"] },
  "meetingbrain-product": { label: "MeetingBrain", color: "bg-emerald-500", sources: ["email", "slack", "teams", "meeting", "ms-email", "ms-calendar", "dashboard", "chat", "action", "project"] },
  "authorityon-product": { label: "AuthorityOn", color: "bg-amber-500", sources: ["scan", "brand-suggest"] },
};

/* ─────────────── Component ─────────────── */

export default function AIUsagePage() {
  const wsCtx = useWorkspaceSafe();
  const isOwnerOrAdmin = wsCtx?.selectedWorkspace?.role === "owner" || wsCtx?.selectedWorkspace?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Settings state
  const [aiModel, setAiModel] = useState("grok-4-1-fast");
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [contextConfig, setContextConfig] = useState<ContextConfig>({
    contracts: "summary",
    contentPipeline: "off",
    socialPresence: "summary",
    ideas: "off",
    webSearch: "on",
  });
  const [maxTokens, setMaxTokens] = useState(4096);
  const [debugMode, setDebugMode] = useState(false);
  const [cuDescription, setCuDescription] = useState("");
  const [cuDefinitions, setCuDefinitions] = useState<CUDefinition[]>([]);

  // Personal preferences state (per-user, not workspace)
  const [personalContext, setPersonalContext] = useState("");
  const [region, setRegion] = useState("Global");
  const [prefsSaving, setPrefsSaving] = useState(false);

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageDays, setUsageDays] = useState(1);
  const [usageLoading, setUsageLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedApp, setSelectedApp] = useState("all");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set(Object.keys(PRODUCT_GROUPS)));
  const [customDateRange, setCustomDateRange] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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
      if (data.debugMode !== undefined) setDebugMode(data.debugMode);
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
      let url = `/api/ai/usage?workspaceId=${workspaceId}&app=${selectedApp}`;
      if (customDateRange && startDate && endDate) {
        url += `&startDate=${startDate}&endDate=${endDate}`;
      } else {
        url += `&days=${usageDays}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (!data.error) setUsageData(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [workspaceId, usageDays, selectedApp, customDateRange, startDate, endDate]);

  // Fetch personal preferences
  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch("/api/me/preferences");
      const data = await res.json();
      if (data.personalContext) setPersonalContext(data.personalContext);
      if (data.region) setRegion(data.region);
    } catch (err) {
      console.error("Failed to load preferences:", err);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchPreferences();
  }, [fetchSettings, fetchPreferences]);

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
          debugMode,
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

  // Save personal preferences
  const handleSavePreferences = async () => {
    setPrefsSaving(true);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalContext: personalContext || null, region }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Personal context updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setPrefsSaving(false);
    }
  };

  // Update context config detail level
  const setConfigLevel = (key: keyof ContextConfig, level: DetailLevel) => {
    setContextConfig((prev) => ({ ...prev, [key]: level }));
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

  const REGION_OPTIONS = [
    "Global",
    "United Kingdom",
    "United States",
    "Australia",
    "Canada",
    "New Zealand",
    "Europe",
    "Asia Pacific",
    "Middle East & Africa",
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Settings sections moved to /settings/ai-context */}
      

      {/* ─── AI Usage Dashboard ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">AI Usage Dashboard</h2>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
              {[
                { label: "Today", value: 1 },
                { label: "7d", value: 7 },
                { label: "14d", value: 14 },
                { label: "30d", value: 30 },
                { label: "90d", value: 90 },
              ].map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setUsageDays(p.value); setCustomDateRange(false); }}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    !customDateRange && usageDays === p.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setCustomDateRange(true);
                  if (!startDate) {
                    const s = new Date();
                    s.setDate(s.getDate() - 30);
                    setStartDate(s.toISOString().split("T")[0]);
                    setEndDate(new Date().toISOString().split("T")[0]);
                  }
                }}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  customDateRange
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Custom
              </button>
            </div>
          </div>
        </div>

        {/* Custom date range picker */}
        {customDateRange && (
          <div className="flex items-center gap-2 mb-4">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {/* App selector tabs */}
        <div className="flex gap-0.5 bg-muted rounded-lg p-0.5 mb-4">
          {[
            { label: "All Apps", value: "all" },
            { label: "Engine", value: "engine" },
            { label: "MeetingBrain", value: "meetingbrain" },
            { label: "AuthorityOn", value: "authorityon" },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSelectedApp(tab.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-1 text-center",
                selectedApp === tab.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
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

            {/* Per-app breakdown (when "All Apps" is selected) */}
            {selectedApp === "all" && usageData.byApp && usageData.byApp.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {usageData.byApp.map((a) => (
                  <Card key={a.app} className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={cn("h-2 w-2 rounded-full", APP_COLORS[a.app] || "bg-gray-500")} />
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          {APP_LABELS[a.app] || a.app}
                        </span>
                      </div>
                      <p className="text-2xl font-bold">{formatCost(a.cost)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.calls} call{a.calls !== 1 ? "s" : ""} &middot;{" "}
                        {formatTokens(a.input + a.output)} tokens
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Daily Cost Chart — stacked by model */}
            {usageData.daily.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Daily Cost by Model
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]">
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
                          formatter={(value: any, name: any) => [
                            formatCost(Number(value)),
                            MODEL_LABELS[String(name)] || String(name),
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
                            fontSize: 11,
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--background))",
                          }}
                        />
                        <Legend
                          formatter={(value: string) => MODEL_LABELS[value] || value}
                          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                        />
                        {(usageData.dailyModels || []).map((model, i) => (
                          <Bar
                            key={model}
                            dataKey={model}
                            stackId="cost"
                            fill={MODEL_COLORS[model] || DEFAULT_MODEL_COLORS[i % DEFAULT_MODEL_COLORS.length]}
                            radius={i === (usageData.dailyModels?.length || 1) - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                            maxBarSize={40}
                          />
                        ))}
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

            {/* Cost by Product — hierarchical view with expandable functions */}
            {usageData.bySource.length > 0 && (() => {
              // Aggregate sources into product groups with model breakdown
              const sourceMap = new Map(usageData.bySource.map((s) => [`${(s as any).app || "engine"}::${s.source}`, s]));
              const productTotals = Object.entries(PRODUCT_GROUPS).map(([key, group]) => {
                let cost = 0, calls = 0;
                const productModels: Record<string, { cost: number; calls: number }> = {};
                const functions: { source: string; label: string; cost: number; calls: number; model: string }[] = [];
                for (const src of group.sources) {
                  for (const appKey of ["engine", "meetingbrain", "authorityon"]) {
                    const entry = sourceMap.get(`${appKey}::${src}`) as any;
                    if (entry) {
                      cost += entry.cost;
                      calls += entry.calls;
                      // Aggregate models at product level
                      const entryModels = entry.models || {};
                      for (const [m, v] of Object.entries(entryModels) as [string, { cost: number; calls: number }][]) {
                        if (!productModels[m]) productModels[m] = { cost: 0, calls: 0 };
                        productModels[m].cost += v.cost;
                        productModels[m].calls += v.calls;
                      }
                      // Determine primary model for this function
                      const modelEntries = Object.entries(entryModels) as [string, { cost: number; calls: number }][];
                      const primaryModel = modelEntries.length > 0
                        ? modelEntries.sort((a, b) => b[1].calls - a[1].calls)[0][0]
                        : "unknown";
                      const existing = functions.find((f) => f.source === src);
                      if (existing) {
                        existing.cost += entry.cost;
                        existing.calls += entry.calls;
                      } else {
                        functions.push({ source: src, label: SOURCE_LABELS[src] || src, cost: entry.cost, calls: entry.calls, model: primaryModel });
                      }
                    }
                  }
                }
                functions.sort((a, b) => b.cost - a.cost);
                const modelsSorted = Object.entries(productModels).sort((a, b) => b[1].cost - a[1].cost);
                return { key, ...group, cost, calls, functions, models: modelsSorted };
              }).filter((p) => p.cost > 0 || p.calls > 0).sort((a, b) => b.cost - a.cost);

              const maxProductCost = Math.max(...productTotals.map((p) => p.cost), 1);

              return (
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Cost by Product
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">Click a product to see function breakdown</p>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {productTotals.map((product) => {
                      const isExpanded = expandedProducts.has(product.key);
                      return (
                        <div key={product.key}>
                          <button
                            onClick={() => {
                              setExpandedProducts((prev) => {
                                const next = new Set(prev);
                                if (next.has(product.key)) next.delete(product.key);
                                else next.add(product.key);
                                return next;
                              });
                            }}
                            className="w-full text-left py-2 px-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <div className={cn("h-2 w-2 rounded-full", product.color)} />
                                <span className="text-sm font-medium">{product.label}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {product.calls} call{product.calls !== 1 ? "s" : ""}
                                </span>
                                {product.models.length > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                    {product.models.map(([m]) => MODEL_LABELS[m] || m).join(", ")}
                                  </span>
                                )}
                              </div>
                              <span className="text-sm font-semibold">{formatCost(product.cost)}</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden ml-[22px]" style={{ width: "calc(100% - 22px)" }}>
                              <div
                                className={cn("h-full rounded-full transition-all", product.color)}
                                style={{ width: `${(product.cost / maxProductCost) * 100}%` }}
                              />
                            </div>
                          </button>

                          {/* Expanded function breakdown with model info */}
                          {isExpanded && product.functions.length > 0 && (
                            <div className="ml-8 mb-2 border-l-2 border-muted pl-3">
                              {product.functions.map((fn) => (
                                <div key={fn.source} className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-medium truncate">{fn.label}</span>
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground font-mono shrink-0">
                                      {MODEL_LABELS[fn.model] || fn.model}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                      {fn.calls} call{fn.calls !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                  <span className="text-xs font-medium shrink-0 ml-2">{formatCost(fn.cost)}</span>
                                </div>
                              ))}
                              {/* Product model summary */}
                              {product.models.length > 1 && (
                                <div className="mt-2 pt-2 border-t border-muted/50">
                                  <p className="text-[10px] text-muted-foreground mb-1 font-medium">Model breakdown:</p>
                                  {product.models.map(([model, data]) => (
                                    <div key={model} className="flex items-center justify-between py-0.5">
                                      <span className="text-[10px] text-muted-foreground">{MODEL_LABELS[model] || model}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {(data as any).calls} calls &middot; {formatCost((data as any).cost)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Per-User Cost — only visible to workspace owners/admins */}
            {isOwnerOrAdmin && usageData.byUser.length > 0 && (
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
