"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  Heart,
  MessageCircle,
  Users,
  TrendingUp,
  Calendar,
  PenSquare,
  Zap,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface DashboardData {
  totals: {
    impressions: number;
    engagements: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
    engagementRate: number;
    totalPosts: number;
    publishedPosts: number;
  };
}

interface Post {
  _id: string;
  content: string;
  status: string;
  platform?: string;
  platforms?: Array<{ platform: string; status?: string }>;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt?: string;
  analytics?: {
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
  };
}

const platformColors: Record<string, string> = {
  twitter: "bg-sky-500",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  facebook: "bg-blue-600",
  linkedin: "bg-blue-700",
  tiktok: "bg-gray-900",
  youtube: "bg-red-500",
  bluesky: "bg-blue-500",
  threads: "bg-gray-800",
};

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 0) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case "published":
      return (
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-emerald-600 border-0 font-medium"
        >
          Published
        </Badge>
      );
    case "scheduled":
      return (
        <Badge
          variant="secondary"
          className="bg-blue-500/10 text-blue-600 border-0 font-medium"
        >
          Scheduled
        </Badge>
      );
    case "draft":
      return (
        <Badge
          variant="secondary"
          className="bg-gray-500/10 text-gray-500 border-0 font-medium"
        >
          Draft
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="secondary"
          className="bg-red-500/10 text-red-600 border-0 font-medium"
        >
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="border-0 font-medium capitalize">
          {status}
        </Badge>
      );
  }
}

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<DashboardData | null>(null);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, postsRes, scheduledRes] = await Promise.all([
        fetch("/api/analytics?period=30"),
        fetch("/api/posts?limit=5"),
        fetch("/api/posts?status=scheduled&limit=5"),
      ]);

      const analyticsData = await analyticsRes.json();
      const postsData = await postsRes.json();
      const scheduledData = await scheduledRes.json();

      if (analyticsData.data) {
        setAnalytics(analyticsData.data);
      }

      // Posts come back as {posts: [...], pagination: {...}} from the Late API
      setRecentPosts(postsData.posts || []);
      setScheduledPosts(scheduledData.posts || []);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const totals = analytics?.totals;

  const stats = [
    {
      title: "Total Impressions",
      value: totals ? formatNumber(totals.impressions) : "—",
      icon: Eye,
      color: "blue",
    },
    {
      title: "Engagements",
      value: totals ? formatNumber(totals.engagements) : "—",
      icon: Heart,
      color: "rose",
    },
    {
      title: "Published Posts",
      value: totals ? totals.publishedPosts.toString() : "—",
      icon: TrendingUp,
      color: "violet",
    },
    {
      title: "Engagement Rate",
      value: totals ? `${totals.engagementRate}%` : "—",
      icon: Users,
      color: "amber",
    },
  ];

  // Get platform info from a post (single platform or platforms array)
  const getPostPlatforms = (post: Post): string[] => {
    if (post.platforms && post.platforms.length > 0) {
      return post.platforms.map((p) => p.platform?.toLowerCase());
    }
    if (post.platform) {
      return [post.platform.toLowerCase()];
    }
    return [];
  };

  const getPostEngagements = (post: Post): number => {
    const a = post.analytics || {};
    return (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your social media performance
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={fetchDashboardData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href="/compose">
            <Button className="gap-2 bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20">
              <PenSquare className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.title}
              className="border-0 shadow-sm hover:shadow-md transition-shadow"
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground font-medium">
                      {stat.title}
                    </p>
                    <p className="text-3xl font-bold tracking-tight">
                      {stat.value}
                    </p>
                    <p className="text-xs text-muted-foreground">Last 30 days</p>
                  </div>
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                      stat.color === "blue"
                        ? "bg-blue-500/10"
                        : stat.color === "rose"
                        ? "bg-rose-500/10"
                        : stat.color === "violet"
                        ? "bg-violet-500/10"
                        : "bg-amber-500/10"
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 ${
                        stat.color === "blue"
                          ? "text-blue-500"
                          : stat.color === "rose"
                          ? "text-rose-500"
                          : stat.color === "violet"
                          ? "text-violet-500"
                          : "text-amber-500"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Posts */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold">
              Recent Posts
            </CardTitle>
            <Link href="/queue">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentPosts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No posts yet</p>
                <Link href="/compose">
                  <Button variant="outline" size="sm" className="mt-3">
                    Create your first post
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {recentPosts.map((post) => {
                  const platforms = getPostPlatforms(post);
                  const dateStr =
                    post.publishedAt || post.scheduledFor || post.createdAt || "";
                  const engagements = getPostEngagements(post);
                  const impressions = post.analytics?.impressions || 0;

                  return (
                    <Link
                      key={post._id}
                      href={`/posts/${post._id}`}
                      className="flex items-center gap-4 py-3.5 px-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                    >
                      {/* Platform dots */}
                      <div className="flex -space-x-1.5">
                        {platforms.length > 0 ? (
                          platforms.slice(0, 3).map((platform, i) => (
                            <div
                              key={i}
                              className={`h-6 w-6 rounded-full ${
                                platformColors[platform] || "bg-gray-400"
                              } border-2 border-background`}
                            />
                          ))
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-gray-400 border-2 border-background" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-foreground">
                          {post.content || "(No content)"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {dateStr ? formatDate(dateStr) : "—"}
                        </p>
                      </div>

                      {/* Metrics */}
                      <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5" />
                          <span>{impressions > 0 ? formatNumber(impressions) : "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Heart className="h-3.5 w-3.5" />
                          <span>{engagements > 0 ? formatNumber(engagements) : "—"}</span>
                        </div>
                      </div>

                      {/* Status */}
                      {getStatusBadge(post.status)}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions & Upcoming */}
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/compose" className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 h-11"
                >
                  <PenSquare className="h-4 w-4 text-blue-500" />
                  Compose a post
                </Button>
              </Link>
              <Link href="/calendar" className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 h-11"
                >
                  <Calendar className="h-4 w-4 text-violet-500" />
                  View calendar
                </Button>
              </Link>
              <Link href="/accounts" className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 h-11"
                >
                  <Zap className="h-4 w-4 text-amber-500" />
                  Connect account
                </Button>
              </Link>
              <Link href="/inbox" className="block">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 h-11"
                >
                  <MessageCircle className="h-4 w-4 text-emerald-500" />
                  Check inbox
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">
                Upcoming Posts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scheduledPosts.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    No upcoming posts scheduled
                  </p>
                  <Link href="/compose">
                    <Button variant="outline" size="sm" className="mt-3">
                      Schedule a post
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {scheduledPosts.map((post) => {
                    const platforms = getPostPlatforms(post);
                    return (
                      <Link key={post._id} href={`/posts/${post._id}`} className="flex items-start gap-3 rounded-lg hover:bg-muted/50 p-2 -mx-2 transition-colors">
                        <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                          <Calendar className="h-5 w-5 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {post.content || "(No content)"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {post.scheduledFor
                              ? formatDate(post.scheduledFor)
                              : "Scheduled"}
                            {platforms.length > 0 &&
                              ` \u00B7 ${platforms.length} ${
                                platforms.length === 1 ? "platform" : "platforms"
                              }`}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
