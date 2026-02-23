"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  Views,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addMinutes } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
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
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  FileText,
  Lightbulb,
  BarChart3,
  CheckCircle2,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Link from "next/link";
import { cn } from "@/lib/utils";

import "react-big-calendar/lib/css/react-big-calendar.css";

import {
  platformHexColors,
  platformLabels,
  statusStyles,
  statusHexColors,
  formatNumber,
  formatDate,
  formatFullDate,
} from "@/lib/platform-utils";

// ────────────────────────────────────────────────
// Calendar localiser (same as calendar page)
// ────────────────────────────────────────────────
const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

// ────────────────────────────────────────────────
// Content type colour map (from content page)
// ────────────────────────────────────────────────
const typeColors: Record<string, string> = {
  article: "bg-blue-500/10 text-blue-500",
  video: "bg-red-500/10 text-red-500",
  graphic: "bg-pink-500/10 text-pink-500",
  thread: "bg-violet-500/10 text-violet-500",
  newsletter: "bg-amber-500/10 text-amber-500",
  podcast: "bg-green-500/10 text-green-500",
  other: "bg-gray-500/10 text-gray-500",
};

const typeHexColors: Record<string, string> = {
  article: "#3b82f6",
  video: "#ef4444",
  graphic: "#ec4899",
  thread: "#8b5cf6",
  newsletter: "#f59e0b",
  podcast: "#22c55e",
  other: "#6b7280",
};

// ────────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────────
interface AnalyticsData {
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
  platforms: Array<{
    platform: string;
    name: string;
    color: string;
    impressions: number;
    engagements: number;
    posts: number;
  }>;
}

interface Post {
  _id: string;
  content: string;
  status: string;
  platform?: string;
  platforms?: Array<{
    platform: string;
    status?: string;
    publishedAt?: string;
    analytics?: {
      impressions?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      saves?: number;
    };
  }>;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt?: string;
}

interface ContentObject {
  id: string;
  contentType: string;
  workingTitle?: string;
  finalTitle?: string;
  status?: string;
  totalTasks: number;
  doneTasks: number;
  updatedAt: string;
  createdAt: string;
}

interface Idea {
  id: string;
  title: string;
  status: string;
  topicTags?: string[];
  predictedEngagementScore?: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  itemType: "post" | "content";
  platform?: string;
  contentType?: string;
  status: string;
  resource: any;
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
function deriveStatus(totalTasks: number, doneTasks: number) {
  if (totalTasks === 0)
    return { label: "No Tasks", color: "bg-muted text-muted-foreground" };
  if (doneTasks === totalTasks)
    return { label: "Complete", color: "bg-green-500/10 text-green-600" };
  if (doneTasks > 0)
    return { label: "In Progress", color: "bg-blue-500/10 text-blue-600" };
  return { label: "Not Started", color: "bg-gray-500/10 text-gray-500" };
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    published: "bg-emerald-500/10 text-emerald-600",
    scheduled: "bg-blue-500/10 text-blue-600",
    draft: "bg-gray-500/10 text-gray-500",
    failed: "bg-red-500/10 text-red-600",
  };
  return (
    <Badge
      variant="secondary"
      className={`${styles[status] || "bg-gray-500/10 text-gray-500"} border-0 font-medium capitalize text-[10px]`}
    >
      {status}
    </Badge>
  );
}

function getPostPlatforms(post: Post): string[] {
  if (post.platforms && post.platforms.length > 0) {
    return post.platforms.map((p) => p.platform?.toLowerCase());
  }
  if (post.platform) return [post.platform.toLowerCase()];
  return [];
}

// ────────────────────────────────────────────────
// Calendar event component
// ────────────────────────────────────────────────
function MiniEventComponent({ event }: { event: CalendarEvent }) {
  let color: string;
  let dashed = false;

  if (event.itemType === "post") {
    color = platformHexColors[event.platform?.toLowerCase() || ""] || statusHexColors[event.status] || "#3b82f6";
  } else {
    color = typeHexColors[event.contentType || "other"] || "#6b7280";
    dashed = true;
  }

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-px rounded text-[11px] font-medium truncate cursor-pointer"
      style={{
        backgroundColor: `${color}15`,
        color: color,
        borderLeft: `3px ${dashed ? "dashed" : "solid"} ${color}`,
      }}
    >
      <span className="truncate">{event.title}</span>
    </div>
  );
}

// ────────────────────────────────────────────────
// KPI Card Skeleton
// ────────────────────────────────────────────────
function KPICardSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-12 w-12 rounded-xl" />
        </div>
      </CardContent>
    </Card>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────
// Main Dashboard
// ────────────────────────────────────────────────
export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<Post[]>([]);
  const [contentObjects, setContentObjects] = useState<ContentObject[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  // Calendar state
  const [currentDate, setCurrentDate] = useState(new Date());

  // Event dialog state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, allPostsRes, recentPostsRes, scheduledRes, contentRes, ideasRes] =
        await Promise.all([
          fetch("/api/analytics?period=30"),
          fetch("/api/posts?limit=100"),
          fetch("/api/posts?limit=5"),
          fetch("/api/posts?status=scheduled&limit=5"),
          fetch("/api/content-objects?limit=20"),
          fetch("/api/ideas?limit=10&sortBy=score"),
        ]);

      const [analyticsData, allPostsData, recentPostsData, scheduledData, contentData, ideasData] =
        await Promise.all([
          analyticsRes.json(),
          allPostsRes.json(),
          recentPostsRes.json(),
          scheduledRes.json(),
          contentRes.json(),
          ideasRes.json(),
        ]);

      if (analyticsData.data) setAnalytics(analyticsData.data);
      setAllPosts(allPostsData.posts || []);
      setRecentPosts(recentPostsData.posts || []);
      setScheduledPosts(scheduledData.posts || []);
      setContentObjects(contentData.contentObjects || []);
      setIdeas(ideasData.ideas || []);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // ──────── Calendar events ────────
  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const postEvents = allPosts
      .filter((p) => p.scheduledFor || p.publishedAt)
      .map((post) => {
        const dateStr = post.scheduledFor || post.publishedAt || post.createdAt || "";
        const date = new Date(dateStr);
        return {
          id: post._id,
          title: post.content?.substring(0, 40) || "Untitled post",
          start: date,
          end: addMinutes(date, 30),
          itemType: "post" as const,
          platform: post.platforms?.[0]?.platform?.toLowerCase(),
          status: post.status,
          resource: post,
        };
      });

    const contentEvents = contentObjects.map((co) => {
      const date = new Date(co.updatedAt || co.createdAt);
      return {
        id: co.id,
        title: co.workingTitle || co.finalTitle || "Untitled content",
        start: date,
        end: addMinutes(date, 30),
        itemType: "content" as const,
        contentType: co.contentType,
        status: co.status || "draft",
        resource: co,
      };
    });

    return [...postEvents, ...contentEvents];
  }, [allPosts, contentObjects]);

  // ──────── Calendar toolbar (compact) ────────
  const MiniToolbar = ({ label, onNavigate }: any) => (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onNavigate("PREV")}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onNavigate("NEXT")}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  // ──────── KPI stats ────────
  const totals = analytics?.totals;

  const kpis = [
    {
      title: "Total Impressions",
      value: totals ? formatNumber(totals.impressions) : "\u2014",
      icon: Eye,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-500",
    },
    {
      title: "Engagements",
      value: totals ? formatNumber(totals.engagements) : "\u2014",
      icon: Heart,
      iconBg: "bg-rose-500/10",
      iconColor: "text-rose-500",
    },
    {
      title: "Published Posts",
      value: totals ? totals.publishedPosts.toString() : "\u2014",
      icon: TrendingUp,
      iconBg: "bg-violet-500/10",
      iconColor: "text-violet-500",
    },
    {
      title: "Engagement Rate",
      value: totals ? `${totals.engagementRate}%` : "\u2014",
      icon: Users,
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-500",
    },
  ];

  // ──────── Platform performance ────────
  const platformData = analytics?.platforms || [];
  const maxImpressions = Math.max(...platformData.map((p) => p.impressions), 1);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ────── Header ────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Your content and social media command centre
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDashboardData}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            className="gap-2 bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20"
            asChild
          >
            <Link href="/compose">
              <PenSquare className="h-4 w-4" />
              New Post
            </Link>
          </Button>
        </div>
      </div>

      {/* ────── Row 1: KPI Cards ────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <KPICardSkeleton key={i} />)
          : kpis.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <Card
                  key={kpi.title}
                  className="border-0 shadow-sm hover:shadow-md transition-shadow"
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground font-medium">
                          {kpi.title}
                        </p>
                        <p className="text-3xl font-bold tracking-tight">
                          {kpi.value}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last 30 days
                        </p>
                      </div>
                      <div
                        className={`h-12 w-12 rounded-xl flex items-center justify-center ${kpi.iconBg}`}
                      >
                        <Icon className={`h-6 w-6 ${kpi.iconColor}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* ────── Row 2: Calendar + Quick Actions / Upcoming ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Calendar */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                Activity Calendar
              </CardTitle>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-4 rounded-sm bg-blue-500/30 border-l-[3px] border-blue-500" />
                  Posts
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-4 rounded-sm bg-violet-500/30 border-l-[3px] border-dashed border-violet-500" />
                  Content
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="dashboard-calendar-wrapper">
                <BigCalendar
                  localizer={localizer}
                  events={calendarEvents}
                  startAccessor="start"
                  endAccessor="end"
                  date={currentDate}
                  view={Views.MONTH}
                  views={[Views.MONTH]}
                  onNavigate={(date) => setCurrentDate(date)}
                  onSelectEvent={(event: any) => {
                    setSelectedEvent(event);
                    setDialogOpen(true);
                  }}
                  components={{
                    toolbar: MiniToolbar,
                    event: MiniEventComponent as any,
                  }}
                  style={{ height: 380 }}
                  popup
                  eventPropGetter={() => ({
                    style: {
                      backgroundColor: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    },
                  })}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right sidebar: Quick Actions + Upcoming */}
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { href: "/compose", icon: PenSquare, label: "Compose a post", color: "text-blue-500" },
                { href: "/calendar", icon: Calendar, label: "View calendar", color: "text-violet-500" },
                { href: "/accounts", icon: Zap, label: "Connect account", color: "text-amber-500" },
                { href: "/inbox", icon: MessageCircle, label: "Check inbox", color: "text-emerald-500" },
              ].map((action) => (
                <Button
                  key={action.href}
                  variant="outline"
                  className="w-full justify-start gap-3 h-11"
                  asChild
                >
                  <Link href={action.href}>
                    <action.icon className={`h-4 w-4 ${action.color}`} />
                    {action.label}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Upcoming Posts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ListSkeleton rows={3} />
              ) : scheduledPosts.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    No upcoming posts scheduled
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href="/compose">Schedule a post</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {scheduledPosts.slice(0, 3).map((post) => {
                    const platforms = getPostPlatforms(post);
                    return (
                      <Link
                        key={post._id}
                        href={`/posts/${post._id}`}
                        className="flex items-start gap-3 rounded-lg hover:bg-muted/50 p-2 -mx-2 transition-colors"
                      >
                        <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                          <Calendar className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {post.content || "(No content)"}
                          </p>
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            <span className="text-xs text-muted-foreground">
                              {post.scheduledFor
                                ? formatDate(post.scheduledFor)
                                : "Scheduled"}
                            </span>
                            {platforms.length > 0 && (
                              <>
                                <span className="text-xs text-muted-foreground">
                                  &middot;
                                </span>
                                {platforms.slice(0, 2).map((platform, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                                    style={{
                                      backgroundColor:
                                        platformHexColors[platform] || "#6b7280",
                                    }}
                                  >
                                    {platformLabels[platform] || platform}
                                  </span>
                                ))}
                              </>
                            )}
                          </div>
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

      {/* ────── Row 3: Content Pipeline / Recent Posts / Top Ideas ────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Content Pipeline */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              Content Pipeline
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground gap-1 h-7"
              asChild
            >
              <Link href="/content">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton rows={5} />
            ) : contentObjects.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No content items yet
                </p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/content">Get started</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {contentObjects.slice(0, 5).map((item) => {
                  const total = Number(item.totalTasks) || 0;
                  const done = Number(item.doneTasks) || 0;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const status = deriveStatus(total, done);

                  return (
                    <Link
                      key={item.id}
                      href={`/content/${item.id}`}
                      className="block rounded-lg hover:bg-muted/50 p-2.5 -mx-1 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize shrink-0 mt-0.5",
                            typeColors[item.contentType] || typeColors.other
                          )}
                        >
                          {item.contentType}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-1">
                            {item.finalTitle || item.workingTitle || "Untitled"}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            {total > 0 ? (
                              <>
                                <div className="h-1.5 flex-1 max-w-[80px] rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all",
                                      pct === 100 ? "bg-green-500" : "bg-blue-500"
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {done}/{total}
                                </span>
                                {pct === 100 && (
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                {status.label}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Posts */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PenSquare className="h-4 w-4 text-violet-500" />
              Recent Posts
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground gap-1 h-7"
              asChild
            >
              <Link href="/queue">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton rows={5} />
            ) : recentPosts.length === 0 ? (
              <div className="text-center py-8">
                <PenSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No posts yet</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/compose">Create your first post</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {recentPosts.map((post) => {
                  const platforms = getPostPlatforms(post);
                  const dateStr =
                    post.publishedAt || post.scheduledFor || post.createdAt || "";
                  const totalImpressions =
                    (post.platforms || []).reduce(
                      (acc, p) => acc + (p.analytics?.impressions || 0),
                      0
                    );

                  return (
                    <Link
                      key={post._id}
                      href={`/posts/${post._id}`}
                      className="flex items-start gap-2.5 py-2.5 px-2 -mx-1 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {platforms.slice(0, 2).map((platform, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                              style={{
                                backgroundColor:
                                  platformHexColors[platform] || "#6b7280",
                              }}
                            >
                              {platformLabels[platform] || platform}
                            </span>
                          ))}
                          {platforms.length > 2 && (
                            <span className="text-[9px] text-muted-foreground">
                              +{platforms.length - 2}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-2">
                          {post.content || "(No content)"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground">
                            {dateStr ? formatDate(dateStr) : "\u2014"}
                          </span>
                          {totalImpressions > 0 && (
                            <>
                              <span className="text-muted-foreground">&middot;</span>
                              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                                <Eye className="h-3 w-3" />
                                {formatNumber(totalImpressions)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {getStatusBadge(post.status)}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Ideas */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Top Ideas
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground gap-1 h-7"
              asChild
            >
              <Link href="/ideas">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton rows={5} />
            ) : ideas.length === 0 ? (
              <div className="text-center py-8">
                <Lightbulb className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No ideas yet</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/ideas/new">Submit an idea</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {ideas.slice(0, 5).map((idea) => {
                  const ideaStatusStyles: Record<string, string> = {
                    submitted: "bg-blue-500/10 text-blue-500",
                    shortlisted: "bg-violet-500/10 text-violet-500",
                    commissioned: "bg-emerald-500/10 text-emerald-600",
                    rejected: "bg-red-500/10 text-red-500",
                  };

                  return (
                    <Link
                      key={idea.id}
                      href={`/ideas`}
                      className="block py-2.5 px-2 -mx-1 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-1">
                            {idea.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <Badge
                              variant="secondary"
                              className={`${ideaStatusStyles[idea.status] || "bg-gray-500/10 text-gray-500"} border-0 text-[10px] capitalize`}
                            >
                              {idea.status}
                            </Badge>
                            {idea.topicTags?.slice(0, 2).map((tag, i) => (
                              <span
                                key={i}
                                className="text-[10px] text-blue-500 bg-blue-500/10 rounded-full px-1.5 py-px"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        {idea.predictedEngagementScore != null &&
                          idea.predictedEngagementScore > 0 && (
                            <div className="flex items-center gap-1 shrink-0 text-emerald-600">
                              <TrendingUp className="h-3 w-3" />
                              <span className="text-xs font-semibold">
                                {Math.round(idea.predictedEngagementScore)}
                              </span>
                            </div>
                          )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ────── Row 4: Platform Performance ────── */}
      {!loading && platformData.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Platform Performance
            </CardTitle>
            <Badge variant="secondary" className="border-0 text-xs font-medium">
              Last 30 days
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {platformData.map((platform) => {
                const barWidth = Math.max(
                  (platform.impressions / maxImpressions) * 100,
                  2
                );
                return (
                  <div key={platform.platform} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: platform.color }}
                        />
                        <span className="text-sm font-medium">
                          {platform.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          {formatNumber(platform.impressions)} impressions
                        </span>
                        <span>{platform.posts} posts</span>
                        <span>
                          {formatNumber(platform.engagements)} engagements
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: platform.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ────── Calendar Event Dialog ────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          {selectedEvent && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base">
                    {selectedEvent.itemType === "post"
                      ? "Post Preview"
                      : "Content Item"}
                  </DialogTitle>
                  {selectedEvent.itemType === "post" ? (
                    <Badge
                      variant="secondary"
                      className={`${statusStyles[selectedEvent.status] || "bg-gray-500/10 text-gray-500"} border-0 font-medium capitalize text-xs`}
                    >
                      {selectedEvent.status}
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-0 text-[10px] capitalize",
                        typeColors[selectedEvent.contentType || "other"] ||
                          typeColors.other
                      )}
                    >
                      {selectedEvent.contentType || "Content"}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="flex items-center gap-1.5 text-xs">
                  <Clock className="h-3 w-3" />
                  {format(selectedEvent.start, "EEEE, MMMM d, yyyy 'at' h:mm a")}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-2">
                <p className="text-sm leading-relaxed line-clamp-6">
                  {selectedEvent.itemType === "post"
                    ? selectedEvent.resource?.content
                    : selectedEvent.resource?.workingTitle ||
                      selectedEvent.resource?.finalTitle}
                </p>
              </div>

              {/* Platform badges for posts */}
              {selectedEvent.itemType === "post" &&
                selectedEvent.resource?.platforms?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedEvent.resource.platforms.map(
                      (p: any, i: number) => {
                        const platform = p.platform?.toLowerCase();
                        const color =
                          platformHexColors[platform] || "#6b7280";
                        const label =
                          platformLabels[platform] || p.platform;
                        return (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: `${color}15`,
                              color: color,
                            }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            {label}
                          </span>
                        );
                      }
                    )}
                  </div>
                )}

              {/* Content type + progress for content items */}
              {selectedEvent.itemType === "content" && (() => {
                const co = selectedEvent.resource;
                const total = Number(co.totalTasks) || 0;
                const done = Number(co.doneTasks) || 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                if (total === 0) return null;
                return (
                  <div className="flex items-center gap-2 mt-2 py-2 px-3 rounded-lg bg-muted/50">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          pct === 100 ? "bg-green-500" : "bg-blue-500"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">
                      {done}/{total} tasks
                    </span>
                    {pct === 100 && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2 mt-2">
                <Link
                  href={
                    selectedEvent.itemType === "post"
                      ? `/posts/${selectedEvent.id}`
                      : `/content/${selectedEvent.id}`
                  }
                  className="flex-1"
                >
                  <Button className="w-full gap-2 bg-blue-500 hover:bg-blue-600">
                    <ExternalLink className="h-4 w-4" />
                    View Details
                  </Button>
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ────── Calendar Styles ────── */}
      <style jsx global>{`
        .dashboard-calendar-wrapper .rbc-header {
          padding: 6px 4px;
          font-size: 11px;
          font-weight: 600;
          color: hsl(var(--muted-foreground));
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid hsl(var(--border));
        }
        .dashboard-calendar-wrapper .rbc-month-view {
          border: 1px solid hsl(var(--border));
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .dashboard-calendar-wrapper .rbc-day-bg {
          transition: background-color 0.15s;
        }
        .dashboard-calendar-wrapper .rbc-day-bg:hover {
          background-color: hsl(var(--muted) / 0.5);
        }
        .dashboard-calendar-wrapper .rbc-day-bg + .rbc-day-bg,
        .dashboard-calendar-wrapper .rbc-month-row + .rbc-month-row {
          border-color: hsl(var(--border));
        }
        .dashboard-calendar-wrapper .rbc-off-range-bg {
          background-color: hsl(var(--muted) / 0.3);
        }
        .dashboard-calendar-wrapper .rbc-today {
          background-color: hsl(220 90% 56% / 0.04);
        }
        .dashboard-calendar-wrapper .rbc-date-cell {
          padding: 2px 6px;
          font-size: 11px;
          font-weight: 500;
        }
        .dashboard-calendar-wrapper .rbc-date-cell.rbc-now {
          font-weight: 700;
          color: hsl(220 90% 56%);
        }
        .dashboard-calendar-wrapper .rbc-event {
          margin: 1px 3px;
          cursor: pointer;
        }
        .dashboard-calendar-wrapper .rbc-event:focus {
          outline: none;
        }
        .dashboard-calendar-wrapper .rbc-show-more {
          font-size: 10px;
          font-weight: 600;
          color: hsl(220 90% 56%);
          padding: 1px 6px;
        }
        .dashboard-calendar-wrapper .rbc-header + .rbc-header {
          border-color: hsl(var(--border));
        }
        .dashboard-calendar-wrapper .rbc-row-segment {
          padding: 0 1px;
        }
      `}</style>
    </div>
  );
}
