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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  accountId?: string;
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
  hashtags?: string[];
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postId}`);
      if (!res.ok) throw new Error("Failed to load post");
      const data = await res.json();
      // The Late API may return the post directly or inside a wrapper
      setPost(data.post || data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

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
          <ArrowLeft className="h-4 w-4" />
          Back
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

  // Aggregate analytics across all platforms
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

  const mediaUrls = (post.media || []).map((m) => m.url);

  const statItems = [
    { icon: Eye, label: "Impressions", value: totalAnalytics.impressions },
    { icon: Users, label: "Reach", value: totalAnalytics.reach },
    { icon: Heart, label: "Likes", value: totalAnalytics.likes },
    { icon: MessageCircle, label: "Comments", value: totalAnalytics.comments },
    { icon: Share2, label: "Shares", value: totalAnalytics.shares },
    { icon: Bookmark, label: "Saves", value: totalAnalytics.saves },
    { icon: MousePointerClick, label: "Clicks", value: totalAnalytics.clicks },
    { icon: BarChart2, label: "Views", value: totalAnalytics.views },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
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
              <h1 className="text-xl font-bold tracking-tight">Post Details</h1>
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
              {post.publishedAt &&
                ` \u00B7 Published ${formatFullDate(post.publishedAt)}`}
              {!post.publishedAt &&
                post.scheduledFor &&
                ` \u00B7 Scheduled for ${formatFullDate(post.scheduledFor)}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/compose?edit=${post._id}`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — content + previews */}
        <div className="lg:col-span-2 space-y-6">
          {/* Post content card */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Post Content
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>

              {/* Hashtags */}
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

              {/* Media */}
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

              {/* Dates */}
              <Separator className="my-4" />
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Created {formatFullDate(post.createdAt)}
                </div>
                {post.publishedAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Published {formatFullDate(post.publishedAt)}
                  </div>
                )}
                {post.scheduledFor && !post.publishedAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Scheduled for {formatFullDate(post.scheduledFor)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Platform previews */}
          {post.platforms && post.platforms.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Platform Previews
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {post.platforms.map((entry, i) => (
                    <PlatformPreview
                      key={i}
                      content={post.content}
                      platformEntry={entry}
                      media={mediaUrls}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — analytics + AI */}
        <div className="space-y-6">
          {/* Aggregated stats */}
          {hasAnalytics && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {statItems.map(({ icon: Icon, label, value }) => (
                    <div
                      key={label}
                      className="rounded-lg bg-muted/50 p-3 text-center"
                    >
                      <Icon className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                      <p className="text-lg font-bold">
                        {formatNumber(value)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-platform breakdown */}
          {post.platforms && post.platforms.length > 1 && hasAnalytics && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Platform Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {post.platforms.map((entry, i) => {
                  const a = entry.analytics;
                  if (!a) return null;
                  const platform = entry.platform?.toLowerCase() || "";
                  const label =
                    platformLabels[platform] || entry.platform || "Unknown";
                  const color = platformHexColors[platform] || "#6b7280";

                  return (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm font-medium">{label}</span>
                        {entry.platformPostUrl && (
                          <a
                            href={entry.platformPostUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          { l: "Impr.", v: a.impressions },
                          { l: "Likes", v: a.likes },
                          { l: "Comments", v: a.comments },
                          { l: "Shares", v: a.shares },
                          { l: "Reach", v: a.reach },
                          {
                            l: "Eng. Rate",
                            v: a.engagementRate,
                            fmt: (v: number) => `${v}%`,
                          },
                        ]
                          .filter((s) => s.v !== undefined && s.v > 0)
                          .map((s) => (
                            <div
                              key={s.l}
                              className="rounded bg-muted/50 px-2 py-1.5"
                            >
                              <p className="text-sm font-semibold">
                                {s.fmt
                                  ? s.fmt(s.v!)
                                  : formatNumber(s.v || 0)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {s.l}
                              </p>
                            </div>
                          ))}
                      </div>
                      {i < (post.platforms?.length || 0) - 1 && (
                        <Separator className="mt-3" />
                      )}
                    </div>
                  );
                })}
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
    </div>
  );
}
