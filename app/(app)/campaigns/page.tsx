"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import {
  Flag,
  Loader2,
  Search,
  FileText,
  Send,
  CheckCircle2,
  Clock,
  ArrowRight,
  Megaphone,
  TrendingUp,
  PenSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface CampaignData {
  name: string;
  content: any[];
  posts: any[];
  tasks: any[];
  contentStatuses: Record<string, number>;
  postStatuses: Record<string, number>;
  taskStatuses: Record<string, number>;
}

const contentStatusIcons: Record<string, { icon: string; color: string }> = {
  published: { icon: "✅", color: "text-green-600" },
  approved: { icon: "✅", color: "text-emerald-600" },
  review: { icon: "🔍", color: "text-amber-600" },
  in_production: { icon: "🔄", color: "text-blue-600" },
  draft: { icon: "📝", color: "text-gray-500" },
};

const campaignColors = [
  "from-blue-500 to-indigo-500",
  "from-violet-500 to-purple-500",
  "from-pink-500 to-rose-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
  "from-cyan-500 to-blue-500",
];

export default function CampaignsPage() {
  const router = useRouter();
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      // If customer selected, get their linked accounts for scoping posts
      let accountIdsParam = "";
      const custParam = selectedCustomerId ? `&customerId=${selectedCustomerId}` : "";
      if (selectedCustomerId) {
        try {
          const acctRes = await fetch(`/api/customer-accounts?customerId=${selectedCustomerId}`);
          if (acctRes.ok) {
            const acctData = await acctRes.json();
            const ids = (acctData.accounts || []).map((a: any) => a.lateAccountId).filter(Boolean);
            if (ids.length > 0) {
              accountIdsParam = `&accountIds=${ids.join(",")}`;
            }
          }
        } catch (e) {
          console.error("Failed to fetch customer accounts:", e);
        }
      }

      const [contentRes, postsRes, tasksRes] = await Promise.all([
        fetch(`/api/content-objects?limit=500${custParam}`),
        fetch(`/api/posts?limit=500${accountIdsParam}`),
        fetch(`/api/production-tasks?limit=500${custParam}`),
      ]);

      const contentData = await contentRes.json();
      const postsData = await postsRes.json();
      const tasksData = await tasksRes.json();

      const contentObjects = contentData.contentObjects || [];
      const posts = postsData.posts || [];
      const tasks = tasksData.tasks || [];

      // Build campaign map from strategic tags
      const campaignMap = new Map<string, CampaignData>();

      // Group content by strategic tags
      contentObjects.forEach((obj: any) => {
        const tags = obj.strategicTags || [];
        tags.forEach((tag: string) => {
          if (!campaignMap.has(tag)) {
            campaignMap.set(tag, {
              name: tag,
              content: [],
              posts: [],
              tasks: [],
              contentStatuses: {},
              postStatuses: {},
              taskStatuses: {},
            });
          }
          const campaign = campaignMap.get(tag)!;
          campaign.content.push(obj);
          const status = obj.status || "draft";
          campaign.contentStatuses[status] = (campaign.contentStatuses[status] || 0) + 1;
        });
      });

      // Link posts to campaigns via their content objects
      const contentByCampaign = new Map<string, Set<string>>();
      campaignMap.forEach((campaign, tag) => {
        const contentIds = new Set(campaign.content.map((c: any) => c.id));
        contentByCampaign.set(tag, contentIds);
      });

      posts.forEach((post: any) => {
        // Check if post's content object belongs to any campaign
        campaignMap.forEach((campaign, tag) => {
          const contentIds = contentByCampaign.get(tag);
          if (contentIds && post.contentObjectId && contentIds.has(post.contentObjectId)) {
            campaign.posts.push(post);
            const status = post.status || "draft";
            campaign.postStatuses[status] = (campaign.postStatuses[status] || 0) + 1;
          }
        });
      });

      // Link tasks to campaigns
      tasks.forEach((task: any) => {
        campaignMap.forEach((campaign, tag) => {
          const contentIds = contentByCampaign.get(tag);
          if (contentIds && task.contentObjectId && contentIds.has(task.contentObjectId)) {
            campaign.tasks.push(task);
            const status = task.status || "todo";
            campaign.taskStatuses[status] = (campaign.taskStatuses[status] || 0) + 1;
          }
        });
      });

      // Sort by total items
      const sorted = Array.from(campaignMap.values())
        .filter((c) => c.content.length > 0 || c.posts.length > 0)
        .sort((a, b) => (b.content.length + b.posts.length) - (a.content.length + a.posts.length));

      setCampaigns(sorted);
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const filtered = search
    ? campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : campaigns;

  const totalContent = campaigns.reduce((sum, c) => sum + c.content.length, 0);
  const totalPosts = campaigns.reduce((sum, c) => sum + c.posts.length, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-pink-500" />
            Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track content and social posts grouped by campaign
          </p>
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
              <Flag className="h-5 w-5 text-pink-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{campaigns.length}</p>
              <p className="text-xs text-muted-foreground">Active Campaigns</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalContent}</p>
              <p className="text-xs text-muted-foreground">Content Pieces</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Send className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalPosts}</p>
              <p className="text-xs text-muted-foreground">Social Posts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Flag className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add strategic tags to your content to group them into campaigns
            </p>
            <Link href="/content">
              <Button size="sm" className="gap-2">
                <FileText className="h-4 w-4" />
                Go to Content
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filtered.map((campaign, idx) => {
            const totalItems = campaign.content.length + campaign.posts.length;
            const doneItems =
              (campaign.contentStatuses["published"] || 0) +
              (campaign.contentStatuses["approved"] || 0) +
              (campaign.postStatuses["published"] || 0);
            const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
            const colorClass = campaignColors[idx % campaignColors.length];

            return (
              <Card key={campaign.name} className="border-0 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                {/* Campaign header stripe */}
                <div className={cn("h-1.5 bg-gradient-to-r", colorClass)} />

                <CardContent className="p-5 space-y-4">
                  {/* Title + progress */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-base capitalize">{campaign.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {totalItems} items · {progress}% complete
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-0 text-[10px]",
                        progress === 100
                          ? "bg-green-500/10 text-green-600"
                          : progress > 0
                            ? "bg-blue-500/10 text-blue-600"
                            : "bg-gray-500/10 text-gray-500"
                      )}
                    >
                      {progress === 100 ? "Complete" : progress > 0 ? "In Progress" : "Not Started"}
                    </Badge>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r transition-all", colorClass)}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  {/* Content pieces */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      Content Pieces ({campaign.content.length})
                    </p>
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                      {campaign.content.map((obj: any) => {
                        const statusInfo = contentStatusIcons[obj.status] || { icon: "📄", color: "text-gray-500" };
                        return (
                          <div
                            key={obj.id}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1 -mx-2 transition-colors"
                            onClick={() => router.push(`/content/${obj.id}`)}
                          >
                            <span>{statusInfo.icon}</span>
                            <span className="truncate flex-1">
                              {obj.finalTitle || obj.workingTitle || "Untitled"}
                            </span>
                            <Badge variant="secondary" className="border-0 text-[9px] capitalize bg-muted">
                              {obj.contentType}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Social posts summary */}
                  {campaign.posts.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5" />
                        Social Posts ({campaign.posts.length})
                      </p>
                      <div className="flex items-center gap-3 text-xs">
                        {(campaign.postStatuses["published"] || 0) > 0 && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            {campaign.postStatuses["published"]} published
                          </span>
                        )}
                        {(campaign.postStatuses["scheduled"] || 0) > 0 && (
                          <span className="flex items-center gap-1 text-blue-600">
                            <Clock className="h-3 w-3" />
                            {campaign.postStatuses["scheduled"]} scheduled
                          </span>
                        )}
                        {(campaign.postStatuses["draft"] || 0) > 0 && (
                          <span className="flex items-center gap-1 text-gray-500">
                            <PenSquare className="h-3 w-3" />
                            {campaign.postStatuses["draft"]} drafts
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Task summary */}
                  {campaign.tasks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5" />
                        Tasks ({campaign.tasks.length})
                      </p>
                      <div className="flex items-center gap-3 text-xs">
                        {(campaign.taskStatuses["done"] || 0) > 0 && (
                          <span className="text-green-600">
                            ✅ {campaign.taskStatuses["done"]} done
                          </span>
                        )}
                        {(campaign.taskStatuses["in_progress"] || 0) > 0 && (
                          <span className="text-blue-600">
                            🔄 {campaign.taskStatuses["in_progress"]} in progress
                          </span>
                        )}
                        {(campaign.taskStatuses["todo"] || 0) > 0 && (
                          <span className="text-gray-500">
                            📋 {campaign.taskStatuses["todo"]} to do
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Link href={`/content?search=${encodeURIComponent(campaign.name)}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
                        View Content <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                    <Link href="/compose" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
                        View Posts <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
