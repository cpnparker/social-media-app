"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Check,
  Sparkles,
  ChevronDown,
  ExternalLink,
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

/* ─────────────── Helpers ─────────────── */

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI (Grok)",
};

/* ─────────────── Component ─────────────── */

export default function AIContextPage() {
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

  // Grouped CU definitions by category
  const cuByCategory: Record<string, CUDefinition[]> = {};
  cuDefinitions.forEach((d) => {
    const cat = d.category || "Other";
    if (!cuByCategory[cat]) cuByCategory[cat] = [];
    cuByCategory[cat].push(d);
  });

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
    </div>
  );
}
