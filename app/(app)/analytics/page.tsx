"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye,
  Heart,
  MousePointerClick,
  Users,
  Download,
  RefreshCw,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  MessageCircle,
  Share2,
  Bookmark,
  Clock,
  Calendar,
  TrendingUp,
  FileText,
  ExternalLink,
  BarChart3,
  Sparkles,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { platformLabels, platformHexColors } from "@/lib/platform-utils";
import { ChevronDown, X, Filter } from "lucide-react";

interface AnalyticsData {
  overview: {
    totalPosts: number;
    publishedPosts: number;
    scheduledPosts: number;
  };
  totals: {
    impressions: number;
    engagements: number;
    reach: number;
    clicks: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
    profileVisits: number;
    engagementRate: number;
    totalPosts: number;
    publishedPosts: number;
  };
  daily: Array<{
    date: string;
    impressions: number;
    engagements: number;
    reach: number;
    clicks: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }>;
  platforms: Array<{
    platform: string;
    name: string;
    impressions: number;
    engagements: number;
    posts: number;
    color: string;
  }>;
  topPosts: Array<{
    id: string;
    content: string;
    platform: string;
    publishedAt: string;
    impressions: number;
    engagements: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: string;
    thumbnailUrl?: string;
    platformPostUrl?: string;
  }>;
  bestTimes: Array<{
    day: string;
    hour: string;
    score: number;
  }>;
  accounts: Array<{
    platform: string;
    username: string;
  }>;
}

const periods = [
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

const platformIcons: Record<string, string> = {
  instagram: "📷",
  twitter: "𝕏",
  facebook: "f",
  linkedin: "in",
  tiktok: "♪",
  youtube: "▶",
  pinterest: "P",
  reddit: "R",
  bluesky: "🦋",
  threads: "@",
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toLocaleString();
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatChartDate(dateStr: any): string {
  const d = new Date(String(dateStr));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30");
  const [chartMetric, setChartMetric] = useState<
    "impressions" | "engagements" | "reach" | "clicks"
  >("impressions");
  const [exporting, setExporting] = useState(false);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  // Filter state
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);

  // Customer context for scoping accounts
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;

  // Customer-linked accounts (fetched from Supabase)
  const [customerAccounts, setCustomerAccounts] = useState<
    Array<{ id: string; lateAccountId: string; platform: string; displayName: string }>
  >([]);

  // Fetch customer-linked accounts when customer changes
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerAccounts([]);
      setSelectedAccountIds([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/customer-accounts?customerId=${selectedCustomerId}`);
        if (res.ok) {
          const json = await res.json();
          setCustomerAccounts(json.accounts || []);
        }
      } catch (e) {
        console.error("Failed to fetch customer accounts:", e);
      }
    })();
  }, [selectedCustomerId]);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });

      // Auto-scope to customer accounts when a customer is selected
      if (selectedCustomerId && customerAccounts.length > 0) {
        const custAccountIds = customerAccounts.map((a) => a.lateAccountId).filter(Boolean);
        // If user has also manually selected specific accounts, intersect
        if (selectedAccountIds.length > 0) {
          params.set("accountIds", selectedAccountIds.join(","));
        } else {
          params.set("accountIds", custAccountIds.join(","));
        }
      } else if (selectedCustomerId && customerAccounts.length === 0) {
        // Customer has no linked accounts — show nothing, not everything
        setData(null);
        setLoading(false);
        return;
      } else if (selectedAccountIds.length > 0) {
        params.set("accountIds", selectedAccountIds.join(","));
      }

      if (selectedPlatforms.length > 0) {
        params.set("platforms", selectedPlatforms.join(","));
      }
      const res = await fetch(`/api/analytics?${params.toString()}`);
      const json = await res.json();
      if (json.data) {
        setData(json.data);
      } else if (json.error) {
        toast.error("Failed to load analytics: " + json.error);
      }
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
      toast.error("Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }, [period, selectedAccountIds, selectedPlatforms, selectedCustomerId, customerAccounts]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Available platforms for filtering
  const availablePlatforms = useMemo(() => {
    const platforms: { key: string; label: string; color: string }[] = [
      { key: "twitter", label: "Twitter / X", color: "#1DA1F2" },
      { key: "instagram", label: "Instagram", color: "#E4405F" },
      { key: "facebook", label: "Facebook", color: "#1877F2" },
      { key: "linkedin", label: "LinkedIn", color: "#0A66C2" },
      { key: "tiktok", label: "TikTok", color: "#000000" },
      { key: "youtube", label: "YouTube", color: "#FF0000" },
      { key: "bluesky", label: "Bluesky", color: "#0085FF" },
    ];
    return platforms;
  }, []);

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId]
    );
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  };

  const clearFilters = () => {
    setSelectedAccountIds([]);
    setSelectedPlatforms([]);
  };

  const hasFilters = selectedAccountIds.length > 0 || selectedPlatforms.length > 0;

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-filter-dropdown]")) {
        setAccountDropdownOpen(false);
        setPlatformDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/analytics/export?period=${period}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-${period}d-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Analytics exported successfully");
    } catch (err) {
      toast.error("Failed to export analytics");
    } finally {
      setExporting(false);
    }
  };

  const fetchAiInsights = async () => {
    if (!data) return;
    setLoadingInsights(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "insights",
          analyticsData: {
            period: `${period} days`,
            totals: data.totals,
            platforms: data.platforms,
            topPosts: data.topPosts?.slice(0, 5).map((p) => ({
              content: p.content?.substring(0, 100),
              platform: p.platform,
              impressions: p.impressions,
              engagements: p.engagements,
              engagementRate: p.engagementRate,
            })),
            bestTimes: data.bestTimes,
          },
        }),
      });
      const result = await res.json();
      setAiInsights(result);
    } catch {
      toast.error("Failed to generate insights");
    } finally {
      setLoadingInsights(false);
    }
  };

  const kpis = useMemo(() => {
    if (!data?.totals) return [];
    const t = data.totals;
    return [
      {
        label: "Total Impressions",
        value: formatNumber(t.impressions),
        icon: Eye,
        color: "text-blue-500",
        bg: "bg-blue-500/10",
      },
      {
        label: "Engagements",
        value: formatNumber(t.engagements),
        icon: Heart,
        color: "text-pink-500",
        bg: "bg-pink-500/10",
      },
      {
        label: "Engagement Rate",
        value: t.engagementRate + "%",
        icon: TrendingUp,
        color: "text-emerald-500",
        bg: "bg-emerald-500/10",
      },
      {
        label: "Total Reach",
        value: formatNumber(t.reach),
        icon: Users,
        color: "text-violet-500",
        bg: "bg-violet-500/10",
      },
      {
        label: "Link Clicks",
        value: formatNumber(t.clicks),
        icon: MousePointerClick,
        color: "text-amber-500",
        bg: "bg-amber-500/10",
      },
      {
        label: "Posts Published",
        value: formatNumber(t.publishedPosts || t.totalPosts || 0),
        icon: FileText,
        color: "text-cyan-500",
        bg: "bg-cyan-500/10",
      },
    ];
  }, [data]);

  const chartMetrics = [
    { key: "impressions" as const, label: "Impressions", color: "#3b82f6" },
    { key: "engagements" as const, label: "Engagements", color: "#ec4899" },
    { key: "reach" as const, label: "Reach", color: "#8b5cf6" },
    { key: "clicks" as const, label: "Clicks", color: "#f59e0b" },
  ];

  const activeChartColor =
    chartMetrics.find((m) => m.key === chartMetric)?.color || "#3b82f6";

  const engagementBreakdown = useMemo(() => {
    if (!data?.totals) return [];
    return [
      { name: "Likes", value: data.totals.likes, color: "#ec4899" },
      { name: "Comments", value: data.totals.comments, color: "#3b82f6" },
      { name: "Shares", value: data.totals.shares, color: "#8b5cf6" },
      { name: "Saves", value: data.totals.saves, color: "#f59e0b" },
    ];
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Track performance metrics across all your platforms
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track performance metrics across all your platforms
          </p>
        </div>
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-14 w-14 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <BarChart3 className="h-6 w-6 text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Unable to load analytics</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Could not fetch analytics data. Please check your API connection and try again.
            </p>
            <Button onClick={fetchAnalytics} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track performance metrics across all your platforms
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href="/analytics/growth">
              <TrendingUp className="h-4 w-4" />
              Growth Insights
            </a>
          </Button>
          {/* Period Selector */}
          <div className="flex items-center bg-muted/50 rounded-lg p-1">
            {periods.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  period === p.value
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="gap-2"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchAnalytics} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span className="font-medium">Filters:</span>
        </div>

        {/* Accounts filter — scoped to customer-linked accounts */}
        {customerAccounts.length > 0 && (
          <div className="relative" data-filter-dropdown>
            <button
              onClick={() => {
                setAccountDropdownOpen(!accountDropdownOpen);
                setPlatformDropdownOpen(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                selectedAccountIds.length > 0
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-600"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Accounts
              {selectedAccountIds.length > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px] bg-blue-500 text-white">
                  {selectedAccountIds.length}
                </Badge>
              )}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {accountDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto p-1">
                  {customerAccounts.map((acc) => {
                    const platform = acc.platform?.toLowerCase();
                    const color = platformHexColors[platform] || "#6b7280";
                    const isSelected = selectedAccountIds.includes(acc.lateAccountId);
                    return (
                      <button
                        key={acc.id}
                        onClick={() => toggleAccount(acc.lateAccountId)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                          isSelected
                            ? "bg-blue-500/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="flex-1 text-left truncate">
                          {acc.displayName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {platformLabels[platform] || acc.platform}
                        </span>
                        {isSelected && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t p-2">
                  <button
                    onClick={() => {
                      setSelectedAccountIds([]);
                      setAccountDropdownOpen(false);
                    }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Platform filter */}
        <div className="relative" data-filter-dropdown>
          <button
            onClick={() => {
              setPlatformDropdownOpen(!platformDropdownOpen);
              setAccountDropdownOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              selectedPlatforms.length > 0
                ? "bg-violet-500/10 border-violet-500/30 text-violet-600"
                : "bg-background border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Platforms
            {selectedPlatforms.length > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px] bg-violet-500 text-white">
                {selectedPlatforms.length}
              </Badge>
            )}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {platformDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover shadow-lg overflow-hidden">
              <div className="p-1">
                {availablePlatforms.map((plat) => {
                  const isSelected = selectedPlatforms.includes(plat.key);
                  return (
                    <button
                      key={plat.key}
                      onClick={() => togglePlatform(plat.key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        isSelected
                          ? "bg-violet-500/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: plat.color }}
                      />
                      <span className="flex-1 text-left">{plat.label}</span>
                      {isSelected && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="border-t p-2">
                <button
                  onClick={() => {
                    setSelectedPlatforms([]);
                    setPlatformDropdownOpen(false);
                  }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Clear all filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`h-9 w-9 rounded-lg ${kpi.bg} flex items-center justify-center`}
                >
                  <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                </div>
              </div>
              <p className="text-xl font-bold">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Chart + Engagement Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend Chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Performance Trend
              </CardTitle>
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                {chartMetrics.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setChartMetric(m.key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      chartMetric === m.key
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {data.daily && data.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart
                  data={data.daily}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={activeChartColor} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={activeChartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatChartDate}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                    interval={Math.max(
                      Math.floor((data.daily.length - 1) / 6),
                      1
                    )}
                  />
                  <YAxis
                    tickFormatter={(v) => formatNumber(v)}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatChartDate}
                    formatter={(value: any) => [
                      formatNumber(Number(value) || 0),
                      chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1),
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey={chartMetric}
                    stroke={activeChartColor}
                    strokeWidth={2}
                    fill="url(#chartGradient)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                No daily data available for this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Engagement Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Engagement Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {engagementBreakdown.some((e) => e.value > 0) ? (
              <>
                <div className="flex items-center justify-center py-2">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={engagementBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {engagementBreakdown.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: "8px",
                          border: "none",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                          fontSize: "12px",
                        }}
                        formatter={(value: any) => [formatNumber(Number(value) || 0)]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {engagementBreakdown.map((item) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{item.name}</p>
                        <p className="text-sm font-semibold">
                          {formatNumber(item.value)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Heart className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No engagement data yet
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Platform Comparison + Best Times */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Platform Comparison */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Platform Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.platforms && data.platforms.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={data.platforms}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    barGap={4}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => formatNumber(v)}
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        backgroundColor: "hsl(var(--card))",
                        color: "hsl(var(--foreground))",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                        fontSize: "12px",
                      }}
                      formatter={(value: any) => [formatNumber(Number(value) || 0)]}
                    />
                    <Bar
                      dataKey="impressions"
                      name="Impressions"
                      radius={[4, 4, 0, 0]}
                    >
                      {data.platforms.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.8} />
                      ))}
                    </Bar>
                    <Bar
                      dataKey="engagements"
                      name="Engagements"
                      radius={[4, 4, 0, 0]}
                    >
                      {data.platforms.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.4} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {/* Platform stat cards */}
                <div
                  className={`grid gap-3 mt-4 pt-4 border-t`}
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(data.platforms.length, 5)}, minmax(0, 1fr))`,
                  }}
                >
                  {data.platforms.slice(0, 5).map((p) => (
                    <div key={p.platform} className="text-center">
                      <div
                        className="h-8 w-8 rounded-lg mx-auto flex items-center justify-center text-xs font-bold mb-1.5"
                        style={{
                          backgroundColor: p.color + "15",
                          color: p.color,
                        }}
                      >
                        {platformIcons[p.platform] || "?"}
                      </div>
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.posts} {p.posts === 1 ? "post" : "posts"}
                      </p>
                      <p className="text-xs font-medium text-muted-foreground mt-0.5">
                        {formatNumber(p.impressions)} impr.
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                No platform data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Best Time to Post */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">
                Best Time to Post
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2.5">
              {data.bestTimes?.map((bt) => (
                <div key={bt.day} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">
                    {bt.day}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${bt.score}%`,
                          backgroundColor:
                            bt.score >= 90
                              ? "#10b981"
                              : bt.score >= 80
                              ? "#3b82f6"
                              : bt.score >= 60
                              ? "#94a3b8"
                              : "#d1d5db",
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium w-16 text-right">
                      {bt.hour}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Based on last {period} days of data</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-muted-foreground">Optimal</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-xs text-muted-foreground">Good</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-slate-400" />
                  <span className="text-xs text-muted-foreground">Average</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Performing Posts */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Top Performing Posts
            </CardTitle>
            <Badge variant="secondary" className="font-normal text-xs">
              Last {period} days
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {data.topPosts && data.topPosts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left text-xs font-medium text-muted-foreground py-3 pr-4">
                      Post
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground py-3 px-3">
                      Platform
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground py-3 px-3">
                      Impressions
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground py-3 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <Heart className="h-3 w-3" /> Likes
                      </div>
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground py-3 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <MessageCircle className="h-3 w-3" /> Comments
                      </div>
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground py-3 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <Share2 className="h-3 w-3" /> Shares
                      </div>
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground py-3 pl-3">
                      Eng. Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPosts.map((post) => {
                    const pColor =
                      data.platforms.find((p) => p.platform === post.platform)
                        ?.color || "#6b7280";
                    return (
                      <tr
                        key={post.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => window.location.href = `/posts/${post.id}`}
                      >
                        <td className="py-3 pr-4">
                          <div className="max-w-[300px]">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate flex-1">
                                {post.content}
                              </p>
                              {post.platformPostUrl && (
                                <a
                                  href={post.platformPostUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground shrink-0"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(post.publishedAt)}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-xs font-bold"
                            style={{
                              backgroundColor: pColor + "15",
                              color: pColor,
                            }}
                          >
                            {platformIcons[post.platform] || "?"}
                          </div>
                        </td>
                        <td className="text-right text-sm font-medium py-3 px-3">
                          {formatNumber(post.impressions)}
                        </td>
                        <td className="text-right text-sm py-3 px-3">
                          {formatNumber(post.likes)}
                        </td>
                        <td className="text-right text-sm py-3 px-3">
                          {formatNumber(post.comments)}
                        </td>
                        <td className="text-right text-sm py-3 px-3">
                          {formatNumber(post.shares)}
                        </td>
                        <td className="text-right py-3 pl-3">
                          <Badge
                            variant="secondary"
                            className={`font-medium text-xs ${
                              parseFloat(post.engagementRate) >= 7
                                ? "bg-emerald-500/10 text-emerald-600"
                                : parseFloat(post.engagementRate) >= 5
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {post.engagementRate}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No post data available for this period
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" />
              AI Insights
            </CardTitle>
            <Button
              onClick={fetchAiInsights}
              disabled={loadingInsights || !data}
              size="sm"
              className="gap-2 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white"
            >
              {loadingInsights ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiInsights ? "Refresh Insights" : "Analyze Performance"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!aiInsights && !loadingInsights && (
            <div className="text-center py-8">
              <div className="h-14 w-14 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="h-6 w-6 text-violet-500" />
              </div>
              <p className="text-sm text-muted-foreground">
                Click &quot;Analyze Performance&quot; to get AI-powered insights about your content strategy
              </p>
            </div>
          )}
          {loadingInsights && (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Analyzing your performance data...
              </p>
            </div>
          )}
          {aiInsights && !loadingInsights && (
            <div className="space-y-4">
              {aiInsights.headline && (
                <div className="p-3 rounded-lg bg-gradient-to-r from-violet-500/5 to-blue-500/5 border border-violet-500/10">
                  <p className="text-sm font-semibold">{aiInsights.headline}</p>
                </div>
              )}
              {aiInsights.insights?.map((insight: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      insight.type === "positive"
                        ? "bg-emerald-500/10"
                        : insight.type === "negative"
                        ? "bg-red-500/10"
                        : "bg-amber-500/10"
                    }`}
                  >
                    {insight.type === "positive" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : insight.type === "negative" ? (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    ) : (
                      <Lightbulb className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {insight.detail}
                    </p>
                  </div>
                </div>
              ))}
              {aiInsights.recommendation && (
                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                  <p className="text-xs font-medium text-blue-600 mb-1 flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Recommendation
                  </p>
                  <p className="text-sm">{aiInsights.recommendation}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                <Heart className="h-5 w-5 text-pink-500" />
              </div>
              <div>
                <p className="text-lg font-bold">
                  {formatNumber(data.totals?.likes || 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Likes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-lg font-bold">
                  {formatNumber(data.totals?.comments || 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Comments</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Share2 className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <p className="text-lg font-bold">
                  {formatNumber(data.totals?.shares || 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Shares</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Bookmark className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-lg font-bold">
                  {formatNumber(data.totals?.saves || 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Saves</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
