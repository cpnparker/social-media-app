"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MousePointerClick,
  Bookmark,
  BarChart2,
  Users,
  Calendar,
  Clock,
  Edit,
  Repeat2,
  Send,
  CalendarDays,
  ListPlus,
  Globe,
  CheckCircle2,
  X,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Link from "next/link";

import PlatformPreview from "@/components/post-detail/PlatformPreview";
import PostAiInsights from "@/components/post-detail/PostAiInsights";
import {
  platformLabels,
  platformHexColors,
  statusStyles,
  formatNumber,
  formatFullDate,
} from "@/lib/platform-utils";

interface PlatformEntry {
  platform: string;
  accountId?: string | Record<string, any>;
  status?: string;
  publishedAt?: string;
  platformPostUrl?: string;
  analytics?: {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    clicks?: number;
    views?: number;
    engagementRate?: number;
  };
}

interface Post {
  _id: string;
  content: string;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt?: string;
  platforms?: PlatformEntry[];
  media?: Array<{ url: string; type?: string }>;
  mediaItems?: Array<{ url: string; type?: string }>;
  hashtags?: string[];
}

interface ConnectedAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

const platformMeta: Record<
  string,
  { name: string; color: string; icon: string }
> = {
  twitter: { name: "Twitter / X", color: "#1DA1F2", icon: "\u{1D54F}" },
  instagram: { name: "Instagram", color: "#E4405F", icon: "\u{1F4F7}" },
  facebook: { name: "Facebook", color: "#1877F2", icon: "f" },
  linkedin: { name: "LinkedIn", color: "#0A66C2", icon: "in" },
  tiktok: { name: "TikTok", color: "#000000", icon: "\u266A" },
  youtube: { name: "YouTube", color: "#FF0000", icon: "\u25B6" },
  pinterest: { name: "Pinterest", color: "#BD081C", icon: "P" },
  reddit: { name: "Reddit", color: "#FF4500", icon: "R" },
  bluesky: { name: "Bluesky", color: "#0085FF", icon: "\u{1F98B}" },
  threads: { name: "Threads", color: "#000000", icon: "@" },
  googlebusiness: { name: "Google Business", color: "#4285F4", icon: "G" },
  telegram: { name: "Telegram", color: "#26A5E4", icon: "\u2708" },
  snapchat: { name: "Snapchat", color: "#FFFC00", icon: "\u{1F47B}" },
};

/* ─── Compact analytics strip shown below each platform preview ─── */
function PlatformAnalyticsStrip({
  analytics,
  color,
}: {
  analytics: PlatformEntry["analytics"];
  color: string;
}) {
  const a = analytics || {};
  const metrics = [
    { icon: Eye, label: "Impressions", value: a.impressions },
    { icon: Users, label: "Reach", value: a.reach },
    { icon: Heart, label: "Likes", value: a.likes },
    { icon: MessageCircle, label: "Comments", value: a.comments },
    { icon: Share2, label: "Shares", value: a.shares },
    { icon: MousePointerClick, label: "Clicks", value: a.clicks },
    { icon: Bookmark, label: "Saves", value: a.saves },
  ].filter((m) => m.value !== undefined && (m.value || 0) > 0);

  if (metrics.length === 0) return null;

  const engagements =
    (a.likes || 0) +
    (a.comments || 0) +
    (a.shares || 0) +
    (a.saves || 0) +
    (a.clicks || 0);
  const engRate = a.impressions
    ? ((engagements / a.impressions) * 100).toFixed(1)
    : "0";

  return (
    <div className="px-4 pb-4">
      <div className="rounded-xl bg-muted/40 p-3 space-y-3">
        {/* Metric pills */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {metrics.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Icon className="h-3 w-3" />
              <span className="font-semibold text-foreground">
                {formatNumber(value || 0)}
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Engagement rate bar */}
        {a.impressions && a.impressions > 0 && (
          <div className="flex items-center gap-2.5">
            <TrendingUp className="h-3 w-3 text-muted-foreground shrink-0" />
            <div className="flex-1 h-1.5 rounded-full bg-background overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(parseFloat(engRate) * 10, 100)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span
              className="text-xs font-bold tabular-nums"
              style={{ color }}
            >
              {engRate}%
            </span>
            <span className="text-[10px] text-muted-foreground">
              engagement
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Replay state
  const [showReplayDialog, setShowReplayDialog] = useState(false);
  const [replayMode, setReplayMode] = useState<
    "now" | "schedule" | "queue"
  >("now");
  const [replayDate, setReplayDate] = useState("");
  const [replayTime, setReplayTime] = useState("");
  const [replayTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [replaying, setReplaying] = useState(false);
  const [replaySelectedAccounts, setReplaySelectedAccounts] = useState<
    string[]
  >([]);

  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [postRes, accountsRes] = await Promise.all([
        fetch(`/api/posts/${postId}`),
        fetch("/api/accounts"),
      ]);
      if (!postRes.ok) throw new Error("Failed to load post");
      const data = await postRes.json();
      setPost(data.post || data);

      const accountsData = await accountsRes.json();
      setAccounts(accountsData.accounts || []);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  // Pre-select replay accounts from original post platforms
  useEffect(() => {
    if (
      post?.platforms &&
      accounts.length > 0 &&
      replaySelectedAccounts.length === 0
    ) {
      const originalAccountIds: string[] = [];
      (post.platforms || []).forEach((entry) => {
        const accId =
          typeof entry.accountId === "object"
            ? (entry.accountId as any)?._id
            : entry.accountId;
        if (accId) originalAccountIds.push(accId);
      });
      const valid = originalAccountIds.filter((id) =>
        accounts.some((a) => a._id === id)
      );
      if (valid.length > 0) setReplaySelectedAccounts(valid);
    }
  }, [post, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const getAccountInfo = (entry: PlatformEntry) => {
    if (!entry.accountId)
      return { name: undefined, username: undefined, avatarUrl: undefined };
    const populatedAccount =
      typeof entry.accountId === "object"
        ? (entry.accountId as any)
        : null;
    let displayName: string | undefined;
    let username: string | undefined;
    let avatarUrl: string | undefined;

    if (populatedAccount) {
      displayName = populatedAccount.displayName;
      username = populatedAccount.username;
      avatarUrl =
        populatedAccount.profilePicture || populatedAccount.avatarUrl;
    } else {
      const account = accounts.find((a) => a._id === entry.accountId);
      if (!account)
        return {
          name: undefined,
          username: undefined,
          avatarUrl: undefined,
        };
      displayName = account.displayName;
      username = account.username;
      avatarUrl = account.avatarUrl;
    }

    const orgPattern = /^Organization \d+$/;
    if (displayName && orgPattern.test(displayName)) {
      displayName =
        username && !orgPattern.test(username) ? username : "LinkedIn Page";
    }
    if (username && orgPattern.test(username)) {
      username = undefined;
    }

    return {
      name: displayName || username || undefined,
      username: username || undefined,
      avatarUrl: avatarUrl || undefined,
    };
  };

  const handleReplay = async () => {
    if (replaySelectedAccounts.length === 0) {
      toast.error("Select at least one account");
      return;
    }
    if (replayMode === "schedule" && (!replayDate || !replayTime)) {
      toast.error("Please set a date and time");
      return;
    }

    setReplaying(true);
    try {
      const platformEntries = replaySelectedAccounts.map((accountId) => {
        const account = accounts.find((a) => a._id === accountId);
        return { platform: account?.platform, accountId: account?._id };
      });

      const body: any = {
        content: post?.content,
        platforms: platformEntries,
      };

      const originalMedia = (post?.mediaItems || post?.media || [])
        .map((m) => m.url)
        .filter(Boolean);
      if (originalMedia.length > 0) {
        body.mediaUrls = originalMedia;
      }

      if (replayMode === "now") {
        body.publishNow = true;
      } else if (replayMode === "schedule") {
        body.scheduledFor = `${replayDate}T${replayTime}:00`;
        body.timezone = replayTimezone;
      }

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to replay post");
      }

      const data = await res.json();
      const newPostId = data.post?._id || data._id;

      toast.success(
        replayMode === "now"
          ? "Post republished!"
          : replayMode === "schedule"
          ? "Post scheduled for replay!"
          : "Post added to queue!"
      );

      setShowReplayDialog(false);

      if (newPostId) {
        router.push(`/posts/${newPostId}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Replay failed");
    } finally {
      setReplaying(false);
    }
  };

  /* ─── Loading / Error ─── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg font-semibold mb-2">Post not found</p>
            <p className="text-sm text-muted-foreground">
              {error || "This post could not be loaded."}
            </p>
            <Link href="/queue">
              <Button variant="outline" className="mt-4">
                Back to Queue
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Computed values ─── */
  const totalAnalytics = (post.platforms || []).reduce(
    (acc, p) => {
      const a = p.analytics || {};
      return {
        impressions: acc.impressions + (a.impressions || 0),
        reach: acc.reach + (a.reach || 0),
        likes: acc.likes + (a.likes || 0),
        comments: acc.comments + (a.comments || 0),
        shares: acc.shares + (a.shares || 0),
        saves: acc.saves + (a.saves || 0),
        clicks: acc.clicks + (a.clicks || 0),
        views: acc.views + (a.views || 0),
      };
    },
    {
      impressions: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      clicks: 0,
      views: 0,
    }
  );

  const hasAnalytics =
    totalAnalytics.impressions > 0 ||
    totalAnalytics.likes > 0 ||
    totalAnalytics.comments > 0;

  const mediaUrls = (post.mediaItems || post.media || []).map((m) => m.url);
  const publishedAt =
    post.publishedAt ||
    (post.platforms || []).find((p) => p.publishedAt)?.publishedAt;

  const totalEngagements =
    totalAnalytics.likes +
    totalAnalytics.comments +
    totalAnalytics.shares +
    totalAnalytics.saves +
    totalAnalytics.clicks;
  const engagementRate =
    totalAnalytics.impressions > 0
      ? ((totalEngagements / totalAnalytics.impressions) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="h-9 w-9"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">
                Post Details
              </h1>
              <Badge
                variant="secondary"
                className={`${
                  statusStyles[post.status] || "bg-gray-500/10 text-gray-500"
                } border-0 font-medium capitalize`}
              >
                {post.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {post.platforms?.length || 0} platform
              {(post.platforms?.length || 0) !== 1 ? "s" : ""}
              {publishedAt &&
                ` \u00B7 Published ${formatFullDate(publishedAt)}`}
              {!publishedAt &&
                post.scheduledFor &&
                ` \u00B7 Scheduled for ${formatFullDate(post.scheduledFor)}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowReplayDialog(true)}
          >
            <Repeat2 className="h-4 w-4" />
            Replay
          </Button>
          <Link href={`/compose?edit=${post._id}`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      {/* ─── Main grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: post content + unified platform cards ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Post content — compact card */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>

              {post.hashtags && post.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {post.hashtags.map((tag, i) => (
                    <span
                      key={i}
                      className="text-xs text-blue-500 bg-blue-500/10 rounded-full px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {mediaUrls.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {mediaUrls.map((url, i) => (
                    <div
                      key={i}
                      className="aspect-video rounded-lg overflow-hidden bg-muted"
                    >
                      <img
                        src={url}
                        alt={`Media ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 pt-3 border-t text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Created{" "}
                  {formatFullDate(post.createdAt)}
                </div>
                {publishedAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Published{" "}
                    {formatFullDate(publishedAt)}
                  </div>
                )}
                {post.scheduledFor && !publishedAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Scheduled for{" "}
                    {formatFullDate(post.scheduledFor)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Unified Platform Cards: Preview + Analytics together ── */}
          {post.platforms && post.platforms.length > 0 && (
            <div className="space-y-5">
              {post.platforms.map((entry, i) => {
                const platform = entry.platform?.toLowerCase() || "";
                const color = platformHexColors[platform] || "#6b7280";
                const meta = platformMeta[platform];
                const accountInfo = getAccountInfo(entry);
                const isPublished =
                  entry.status === "success" || !!entry.publishedAt;
                const hasEntryAnalytics =
                  entry.analytics &&
                  ((entry.analytics.impressions || 0) > 0 ||
                    (entry.analytics.likes || 0) > 0 ||
                    (entry.analytics.comments || 0) > 0);

                return (
                  <Card
                    key={i}
                    className="border-0 shadow-sm overflow-hidden"
                  >
                    {/* Color strip at top */}
                    <div
                      className="h-1"
                      style={{ backgroundColor: color }}
                    />

                    {/* Platform header row */}
                    <div className="flex items-center justify-between px-4 pt-4 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                          style={{ backgroundColor: color }}
                        >
                          {meta?.icon || "?"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold">
                            {meta?.name || entry.platform}
                          </p>
                          {accountInfo.name && (
                            <p className="text-xs text-muted-foreground">
                              @
                              {accountInfo.username || accountInfo.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isPublished ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-500/10 text-green-600 border-0 text-[10px]"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-0.5" />{" "}
                            Live
                          </Badge>
                        ) : entry.status === "failed" ? (
                          <Badge
                            variant="secondary"
                            className="bg-red-500/10 text-red-600 border-0 text-[10px]"
                          >
                            <X className="h-3 w-3 mr-0.5" /> Failed
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/10 text-amber-600 border-0 text-[10px]"
                          >
                            <Clock className="h-3 w-3 mr-0.5" /> Pending
                          </Badge>
                        )}
                        {entry.platformPostUrl && (
                          <a
                            href={entry.platformPostUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Platform preview (visual mockup) */}
                    <div className="px-4 pb-3">
                      <PlatformPreview
                        content={post.content}
                        platformEntry={entry}
                        media={mediaUrls}
                        accountName={accountInfo.name}
                        accountUsername={accountInfo.username}
                        accountAvatarUrl={accountInfo.avatarUrl}
                      />
                    </div>

                    {/* Analytics strip directly below the preview */}
                    {hasEntryAnalytics ? (
                      <PlatformAnalyticsStrip
                        analytics={entry.analytics}
                        color={color}
                      />
                    ) : (
                      <div className="px-4 pb-4">
                        <div className="flex items-center gap-2 py-2.5 px-3 rounded-xl bg-muted/30 justify-center">
                          <BarChart2 className="h-3.5 w-3.5 text-muted-foreground/40" />
                          <p className="text-xs text-muted-foreground">
                            {isPublished
                              ? "Analytics loading..."
                              : "Analytics will appear after publishing"}
                          </p>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-6">
          {/* Replay CTA */}
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-500/5 via-violet-500/5 to-purple-500/5 ring-1 ring-blue-500/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Repeat2 className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Replay Post</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Republish to your networks
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-9"
                  onClick={() => {
                    setReplayMode("now");
                    setShowReplayDialog(true);
                  }}
                >
                  <Send className="h-3 w-3" />
                  Now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-9"
                  onClick={() => {
                    setReplayMode("schedule");
                    setShowReplayDialog(true);
                  }}
                >
                  <CalendarDays className="h-3 w-3" />
                  Schedule
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-9"
                  onClick={() => {
                    setReplayMode("queue");
                    setShowReplayDialog(true);
                  }}
                >
                  <ListPlus className="h-3 w-3" />
                  Queue
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Aggregated performance */}
          {hasAnalytics && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                  Total Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Engagement rate hero */}
                <div className="flex items-center gap-4 mb-4 p-3 rounded-xl bg-gradient-to-r from-blue-500/5 to-violet-500/5">
                  <div className="relative h-14 w-14 shrink-0">
                    <svg
                      className="h-14 w-14 -rotate-90"
                      viewBox="0 0 56 56"
                    >
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        className="text-muted/50"
                      />
                      <circle
                        cx="28"
                        cy="28"
                        r="24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        className="text-blue-500"
                        strokeDasharray={`${
                          (Math.min(parseFloat(engagementRate), 100) /
                            100) *
                          150.8
                        } 150.8`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-blue-600">
                        {engagementRate}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">
                      Engagement Rate
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(totalEngagements)} engagements from{" "}
                      {formatNumber(totalAnalytics.impressions)}{" "}
                      impressions
                    </p>
                  </div>
                </div>

                {/* Summary stat tiles */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      icon: Eye,
                      label: "Impressions",
                      value: totalAnalytics.impressions,
                      color: "text-blue-500",
                    },
                    {
                      icon: Users,
                      label: "Reach",
                      value: totalAnalytics.reach,
                      color: "text-cyan-500",
                    },
                    {
                      icon: Heart,
                      label: "Likes",
                      value: totalAnalytics.likes,
                      color: "text-pink-500",
                    },
                    {
                      icon: MessageCircle,
                      label: "Comments",
                      value: totalAnalytics.comments,
                      color: "text-amber-500",
                    },
                    {
                      icon: Share2,
                      label: "Shares",
                      value: totalAnalytics.shares,
                      color: "text-green-500",
                    },
                    {
                      icon: MousePointerClick,
                      label: "Clicks",
                      value: totalAnalytics.clicks,
                      color: "text-orange-500",
                    },
                  ]
                    .filter((s) => s.value > 0)
                    .map(({ icon: Icon, label, value, color }) => (
                      <div
                        key={label}
                        className="rounded-lg bg-muted/40 p-2.5 text-center"
                      >
                        <Icon
                          className={`h-3.5 w-3.5 mx-auto ${color} mb-1`}
                        />
                        <p className="text-base font-bold tabular-nums">
                          {formatNumber(value)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {label}
                        </p>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Insights */}
          <PostAiInsights
            content={post.content}
            platforms={post.platforms}
            analytics={totalAnalytics}
          />
        </div>
      </div>

      {/* ─── Replay Dialog ─── */}
      <Dialog open={showReplayDialog} onOpenChange={setShowReplayDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat2 className="h-5 w-5 text-blue-500" />
              Replay Post
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mode selection */}
            <div className="flex gap-2">
              {[
                {
                  key: "now" as const,
                  label: "Publish Now",
                  icon: Send,
                },
                {
                  key: "schedule" as const,
                  label: "Schedule",
                  icon: CalendarDays,
                },
                {
                  key: "queue" as const,
                  label: "Add to Queue",
                  icon: ListPlus,
                },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setReplayMode(key)}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-xs font-medium ${
                    replayMode === key
                      ? "border-blue-500/30 bg-blue-500/5 text-blue-700"
                      : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Schedule fields */}
            {replayMode === "schedule" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={replayDate}
                    onChange={(e) => setReplayDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Time</Label>
                  <Input
                    type="time"
                    value={replayTime}
                    onChange={(e) => setReplayTime(e.target.value)}
                  />
                </div>
                <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="h-3 w-3" /> {replayTimezone}
                </div>
              </div>
            )}

            {/* Account selection */}
            <div>
              <Label className="text-xs mb-2 block">Publish to</Label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {accounts.map((account) => {
                  const meta =
                    platformMeta[account.platform?.toLowerCase()];
                  const isSelected = replaySelectedAccounts.includes(
                    account._id
                  );
                  return (
                    <button
                      key={account._id}
                      onClick={() => {
                        setReplaySelectedAccounts((prev) =>
                          prev.includes(account._id)
                            ? prev.filter(
                                (id) => id !== account._id
                              )
                            : [...prev, account._id]
                        );
                      }}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all ${
                        isSelected
                          ? "bg-blue-500/10 ring-1 ring-blue-500/30"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className="h-6 w-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                        style={{
                          backgroundColor: meta?.color || "#6b7280",
                        }}
                      >
                        {meta?.icon || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {account.displayName || account.username}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {meta?.name || account.platform}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Post preview */}
            <div className="p-3 rounded-lg bg-muted/30 border border-dashed">
              <p className="text-xs text-muted-foreground mb-1 font-medium">
                Post content:
              </p>
              <p className="text-xs line-clamp-3">{post?.content}</p>
            </div>

            {/* Submit */}
            <Button
              className="w-full gap-2"
              onClick={handleReplay}
              disabled={
                replaying || replaySelectedAccounts.length === 0
              }
            >
              {replaying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : replayMode === "now" ? (
                <>
                  <Send className="h-4 w-4" /> Publish Now
                </>
              ) : replayMode === "schedule" ? (
                <>
                  <CalendarDays className="h-4 w-4" /> Schedule Post
                </>
              ) : (
                <>
                  <ListPlus className="h-4 w-4" /> Add to Queue
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
