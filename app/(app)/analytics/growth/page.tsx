"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  BarChart2,
  Calendar,
  Info,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  platformLabels,
  platformHexColors,
  formatNumber,
} from "@/lib/platform-utils";

interface AccountPerf {
  accountId: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  impressions: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  posts: number;
  engagementRate: number;
}

interface MonthlyData {
  month: string;
  impressions: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  posts: number;
}

interface WeeklyData {
  week: string;
  impressions: number;
  engagements: number;
  posts: number;
}

interface GrowthData {
  accounts: Array<{
    _id: string;
    platform: string;
    displayName: string;
    username: string;
  }>;
  monthly: MonthlyData[];
  weekly: WeeklyData[];
  accountPerformance: AccountPerf[];
  summary: {
    totalPosts: number;
    totalImpressions: number;
    totalEngagements: number;
    overallEngagementRate: number;
    earliestDate: string | null;
    latestDate: string | null;
    dataRangeDays: number;
  };
  followerStatsAvailable: boolean;
}

function formatMonth(m: string) {
  const [year, month] = m.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatWeek(w: string) {
  const date = new Date(w);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Simple bar chart component
function BarChart({
  data,
  labelKey,
  valueKey,
  formatLabel,
  color = "#3b82f6",
  height = 160,
}: {
  data: any[];
  labelKey: string;
  valueKey: string;
  formatLabel: (v: string) => string;
  color?: string;
  height?: number;
}) {
  const maxVal = Math.max(...data.map((d) => d[valueKey] || 0), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((item, i) => {
        const val = item[valueKey] || 0;
        const barHeight = maxVal > 0 ? (val / maxVal) * (height - 24) : 0;
        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1 group relative"
          >
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-foreground text-background text-[10px] px-2 py-1 rounded whitespace-nowrap">
              {formatNumber(val)}
            </div>
            {/* Bar */}
            <div
              className="w-full rounded-t transition-all hover:opacity-80"
              style={{
                height: Math.max(barHeight, 2),
                backgroundColor: color,
                opacity: val === 0 ? 0.15 : 0.7 + (val / maxVal) * 0.3,
              }}
            />
            {/* Label — show every other for space */}
            {(i % 2 === 0 || data.length <= 6) && (
              <span className="text-[9px] text-muted-foreground truncate max-w-full">
                {formatLabel(item[labelKey])}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function GrowthPage() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = selectedAccountId
        ? `?accountId=${selectedAccountId}`
        : "";
      const res = await fetch(`/api/analytics/growth${params}`);
      if (!res.ok) throw new Error("Failed to load data");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Button variant="ghost" size="sm" className="gap-2" asChild>
          <Link href="/analytics">
            <ArrowLeft className="h-4 w-4" />
            Back to Analytics
          </Link>
        </Button>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold mb-2">Error loading data</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, monthly, weekly, accountPerformance } = data;

  // Find months with data for trend calculation
  const monthsWithData = monthly.filter((m) => m.posts > 0);
  const recentMonth = monthsWithData[monthsWithData.length - 1];
  const prevMonth = monthsWithData[monthsWithData.length - 2];

  const impressionsTrend =
    recentMonth && prevMonth && prevMonth.impressions > 0
      ? parseFloat(
          (
            ((recentMonth.impressions - prevMonth.impressions) /
              prevMonth.impressions) *
            100
          ).toFixed(1)
        )
      : null;

  const engagementsTrend =
    recentMonth && prevMonth && prevMonth.engagements > 0
      ? parseFloat(
          (
            ((recentMonth.engagements - prevMonth.engagements) /
              prevMonth.engagements) *
            100
          ).toFixed(1)
        )
      : null;

  const selectedAccount = selectedAccountId
    ? data.accounts.find((a) => a._id === selectedAccountId)
    : null;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
            <Link href="/analytics">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Account Growth & Insights
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {summary.dataRangeDays > 0
                ? `${summary.dataRangeDays} days of data available (since ${new Date(summary.earliestDate!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`
                : "No historical data yet"}
            </p>
          </div>
        </div>

        {/* Account filter */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
            className="gap-2"
          >
            {selectedAccount ? (
              <>
                <div
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor:
                      platformHexColors[selectedAccount.platform] || "#6b7280",
                  }}
                />
                <span className="truncate max-w-[120px]">
                  {selectedAccount.displayName}
                </span>
              </>
            ) : (
              "All Accounts"
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
          {accountDropdownOpen && (
            <div className="absolute top-full mt-1 right-0 z-50 bg-background border rounded-lg shadow-lg py-1 min-w-[220px]">
              <button
                onClick={() => {
                  setSelectedAccountId("");
                  setAccountDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                <div className="h-3 w-3 rounded-full bg-gray-400" />
                <span>All Accounts</span>
                {!selectedAccountId && (
                  <svg
                    className="h-3.5 w-3.5 ml-auto text-blue-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
              {data.accounts.map((acc) => (
                <button
                  key={acc._id}
                  onClick={() => {
                    setSelectedAccountId(acc._id);
                    setAccountDropdownOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        platformHexColors[acc.platform] || "#6b7280",
                    }}
                  />
                  <span className="flex-1 text-left truncate">
                    {acc.displayName || acc.username}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {platformLabels[acc.platform] || acc.platform}
                  </span>
                  {selectedAccountId === acc._id && (
                    <svg
                      className="h-3.5 w-3.5 text-blue-500 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Total Posts
                </p>
                <p className="text-2xl font-bold mt-1">
                  {summary.totalPosts}
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Total Impressions
                </p>
                <p className="text-2xl font-bold mt-1">
                  {formatNumber(summary.totalImpressions)}
                </p>
                {impressionsTrend !== null && (
                  <div
                    className={`flex items-center gap-0.5 text-[11px] mt-1 ${
                      impressionsTrend >= 0 ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {impressionsTrend >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {Math.abs(impressionsTrend)}% vs prev month
                  </div>
                )}
              </div>
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Eye className="h-4 w-4 text-violet-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Total Engagements
                </p>
                <p className="text-2xl font-bold mt-1">
                  {formatNumber(summary.totalEngagements)}
                </p>
                {engagementsTrend !== null && (
                  <div
                    className={`flex items-center gap-0.5 text-[11px] mt-1 ${
                      engagementsTrend >= 0
                        ? "text-emerald-600"
                        : "text-red-500"
                    }`}
                  >
                    {engagementsTrend >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {Math.abs(engagementsTrend)}% vs prev month
                  </div>
                )}
              </div>
              <div className="h-9 w-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <Heart className="h-4 w-4 text-rose-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Engagement Rate
                </p>
                <p className="text-2xl font-bold mt-1">
                  {summary.overallEngagementRate}%
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <BarChart2 className="h-4 w-4 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly impressions */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Eye className="h-4 w-4 text-violet-500" />
              Monthly Impressions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={monthly}
              labelKey="month"
              valueKey="impressions"
              formatLabel={formatMonth}
              color="#8b5cf6"
            />
          </CardContent>
        </Card>

        {/* Monthly engagements */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              Monthly Engagements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={monthly}
              labelKey="month"
              valueKey="engagements"
              formatLabel={formatMonth}
              color="#f43f5e"
            />
          </CardContent>
        </Card>

        {/* Weekly posting frequency */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-500" />
              Weekly Post Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={weekly}
              labelKey="week"
              valueKey="posts"
              formatLabel={formatWeek}
              color="#3b82f6"
            />
          </CardContent>
        </Card>

        {/* Monthly engagement breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Share2 className="h-4 w-4 text-emerald-500" />
              Monthly Views
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={monthly}
              labelKey="month"
              valueKey="views"
              formatLabel={formatMonth}
              color="#10b981"
            />
          </CardContent>
        </Card>
      </div>

      {/* Per-account performance table */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Account Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accountPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No account data available
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 font-medium text-right">Posts</th>
                    <th className="pb-3 font-medium text-right">
                      Impressions
                    </th>
                    <th className="pb-3 font-medium text-right">Likes</th>
                    <th className="pb-3 font-medium text-right">Comments</th>
                    <th className="pb-3 font-medium text-right">Shares</th>
                    <th className="pb-3 font-medium text-right">Eng. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {accountPerformance.map((acct) => {
                    let displayName = acct.displayName;
                    if (/^Organization \d+$/.test(displayName)) {
                      displayName = acct.username || displayName;
                    }
                    return (
                      <tr
                        key={acct.accountId}
                        className="border-b last:border-0"
                      >
                        <td className="py-3">
                          <div className="flex items-center gap-2.5">
                            {acct.avatarUrl ? (
                              <img
                                src={acct.avatarUrl}
                                alt={displayName}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                style={{
                                  backgroundColor:
                                    platformHexColors[acct.platform] ||
                                    "#6b7280",
                                }}
                              >
                                {displayName.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-sm">
                                {displayName}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {platformLabels[acct.platform] || acct.platform}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {acct.posts}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatNumber(acct.impressions)}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatNumber(acct.likes)}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatNumber(acct.comments)}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatNumber(acct.shares)}
                        </td>
                        <td className="py-3 text-right">
                          <Badge
                            variant="secondary"
                            className={`${
                              acct.engagementRate >= 5
                                ? "bg-emerald-500/10 text-emerald-600"
                                : acct.engagementRate >= 2
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-gray-500/10 text-gray-500"
                            } border-0 font-medium text-xs`}
                          >
                            {acct.engagementRate}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Follower tracking note */}
      {!data.followerStatsAvailable && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
          <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">
              Follower tracking available with Late Analytics Add-on
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enable the analytics add-on in your Late dashboard to track
              follower count history, page growth/decline trends, and audience
              demographics over time. Currently showing post-level engagement
              data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
