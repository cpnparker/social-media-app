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
    contentPipeline: "summary",
    socialPresence: "summary",
    ideas: "summary",
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
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedApp, setSelectedApp] = useState("all");

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
      const res = await fetch(
        `/api/ai/usage?workspaceId=${workspaceId}&days=${usageDays}&app=${selectedApp}`
      );
      const data = await res.json();
      if (!data.error) setUsageData(data);
    } catch (err) {
      console.error("Failed to load usage:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [workspaceId, usageDays, selectedApp]);

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
      {/* ─── Your Personal Context (per-user, not workspace) ─── */}
      <Card className="border-0 shadow-sm bg-primary/[0.02]">
        <CardHeader className="pb-0">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Your Personal Context
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            This is your personal context — it&apos;s included in every AI conversation to personalise responses to you.
            Other workspace members have their own personal context.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              About You
            </label>
            <textarea
              value={personalContext}
              onChange={(e) => setPersonalContext(e.target.value)}
              placeholder="e.g. I'm a senior content strategist specialising in B2B technology. I prefer concise, data-driven writing with a professional tone..."
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground mt-1 text-right">
              {personalContext.length}/2000
            </p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Region
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Adapts AI spelling, grammar, cultural references, date formats, and conventions.
            </p>
            <div className="relative">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full sm:w-64 appearance-none rounded-lg border px-3 py-2 pr-8 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSavePreferences}
              disabled={prefsSaving}
            >
              {prefsSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              Save Personal Context
            </Button>
          </div>
        </CardContent>
      </Card>

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
              Select the default AI model for new conversations in EngineAI.
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
            EngineAI. Disabling a section reduces token usage and cost.
          </p>

          {[
            {
              key: "contracts" as const,
              label: "Contracts",
              description: "Contract details, CU budgets, and commissioned content under each contract",
            },
            {
              key: "contentPipeline" as const,
              label: "Content Pipeline",
              description: "Content production stats, individual items with briefs, audiences, and topics",
            },
            {
              key: "socialPresence" as const,
              label: "Social Presence",
              description: "Social media platform post counts and performance data",
            },
            {
              key: "ideas" as const,
              label: "Ideas",
              description: "Ideas with briefs, status breakdowns, topic tags, and commission dates",
            },
          ].map((item) => {
            const level = contextConfig[item.key];
            const isFull = level.startsWith("full");
            return (
              <div
                key={item.key}
                className="flex items-start gap-3 py-3 rounded-lg px-2 -mx-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium leading-tight">
                      {item.label}
                    </p>
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
                      : `Full detail (${level === "full-week" ? "7 days" : level === "full-month" ? "30 days" : "12 months"}) — ${item.description.toLowerCase()}`
                    }
                  </p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ─── Web Search Default ─── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Globe className="h-4 w-4 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Web Search</p>
              <p className="text-xs text-muted-foreground">
                Enable web search by default in new EngineAI conversations
              </p>
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

      {/* ─── Developer ─── */}
      <Card className="border-0 shadow-sm border-l-2 border-l-amber-400">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Bug className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Debug Mode</p>
              <p className="text-xs text-muted-foreground">
                Show the system prompt passed to the AI before each response in EngineAI
              </p>
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
                    const appName = (s as any).app || "engine";
                    const barColor = APP_COLORS[appName] || "bg-gray-500";
                    return (
                      <div key={`${appName}-${s.source}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {SOURCE_LABELS[s.source] || s.source}
                            </span>
                            {selectedApp === "all" && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                {APP_LABELS[appName] || appName}
                              </span>
                            )}
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
                              barColor
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
