"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Lightbulb,
  Plus,
  Loader2,
  Search,
  ArrowUpDown,
  Sparkles,
  TrendingUp,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { cn } from "@/lib/utils";

// Status config with dot colors and labels — using DB values
const statusConfig: Record<string, { dot: string; label: string; accent: string }> = {
  new: { dot: "bg-blue-500", label: "New", accent: "border-l-blue-500" },
  commissioned: { dot: "bg-emerald-500", label: "Commissioned", accent: "border-l-emerald-500" },
  spiked: { dot: "bg-red-400", label: "Spiked", accent: "border-l-red-400" },
};

const statusTabs = ["all", "new", "commissioned", "spiked"];
const statusTabLabels: Record<string, string> = {
  all: "All",
  new: "New",
  commissioned: "Commissioned",
  spiked: "Spiked",
};

// Map sidebar URL params to internal tab values
const sidebarStatusMap: Record<string, string> = {
  new: "new",
  commissioned: "commissioned",
  spiked: "spiked",
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function IdeaCard({ idea }: { idea: any }) {
  const router = useRouter();
  const [imgError, setImgError] = useState(false);
  const status = statusConfig[idea.status] || statusConfig.new;
  const hasImage = !!idea.imageUrl && !imgError;
  const customerName = idea.customerName || null;
  const score = idea.predictedEngagementScore;
  const scoreColor = score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-red-400";

  const allTags = [
    ...(idea.topicTags || []).map((t: string) => ({ label: t, color: "bg-blue-500/10 text-blue-600" })),
    ...(idea.strategicTags || []).map((t: string) => ({ label: t, color: "bg-purple-500/10 text-purple-600" })),
    ...(idea.eventTags || []).map((t: string) => ({ label: t, color: "bg-amber-500/10 text-amber-600" })),
  ];
  const visibleTags = allTags.slice(0, 3);
  const overflowCount = allTags.length - 3;

  if (hasImage) {
    return (
      <div
        onClick={() => router.push(`/ideas/${idea.id}`)}
        className="group cursor-pointer rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 border border-border/40"
      >
        {/* Image */}
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          <img
            src={idea.imageUrl}
            alt={idea.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          {/* Status dot */}
          <div className="absolute top-3 right-3">
            <div className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white/30", status.dot)} />
          </div>
          {/* Title on image */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="font-semibold text-white text-sm leading-snug line-clamp-2 drop-shadow-sm">
              {idea.title}
            </h3>
          </div>
        </div>

        {/* Card body */}
        <div className="p-4 space-y-3">
          {idea.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {idea.description}
            </p>
          )}

          {/* Tags */}
          {visibleTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {visibleTags.map((tag, i) => (
                <span
                  key={`${tag.label}-${i}`}
                  className={cn("text-[10px] rounded-full px-2 py-0.5 font-medium", tag.color)}
                >
                  {tag.label}
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="text-[10px] text-muted-foreground px-1 py-0.5">
                  +{overflowCount}
                </span>
              )}
            </div>
          )}

          {/* Footer: customer, score, date */}
          <div className="flex items-center justify-between pt-1 border-t border-border/40">
            <div className="flex items-center gap-2 min-w-0">
              {customerName && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 rounded-full px-2 py-0.5 font-medium truncate max-w-[120px]">
                  {customerName}
                </span>
              )}
              {score && (
                <span className={cn("text-[11px] font-semibold tabular-nums flex items-center gap-0.5", scoreColor)}>
                  <TrendingUp className="h-3 w-3" />
                  {Math.round(score)}
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo(idea.createdAt)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Text-only card (no image)
  return (
    <div
      onClick={() => router.push(`/ideas/${idea.id}`)}
      className={cn(
        "group cursor-pointer rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 border border-border/40 border-l-[3px]",
        status.accent
      )}
    >
      <div className="p-5 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-foreground transition-colors">
              {idea.title}
            </h3>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] border-0 shrink-0 font-medium",
              idea.status === "new" && "bg-blue-500/10 text-blue-600",
              idea.status === "commissioned" && "bg-emerald-500/10 text-emerald-600",
              idea.status === "spiked" && "bg-red-500/10 text-red-500"
            )}
          >
            {status.label}
          </Badge>
        </div>

        {idea.description && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {idea.description}
          </p>
        )}

        {/* Tags */}
        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((tag, i) => (
              <span
                key={`${tag.label}-${i}`}
                className={cn("text-[10px] rounded-full px-2 py-0.5 font-medium", tag.color)}
              >
                {tag.label}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] text-muted-foreground px-1 py-0.5">
                +{overflowCount}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            {customerName && (
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 rounded-full px-2 py-0.5 font-medium truncate max-w-[120px]">
                {customerName}
              </span>
            )}
            {score ? (
              <span className={cn("text-[11px] font-semibold tabular-nums flex items-center gap-0.5", scoreColor)}>
                <TrendingUp className="h-3 w-3" />
                {Math.round(score)}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/60 italic">Unscored</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
            <Clock className="h-2.5 w-2.5" />
            {timeAgo(idea.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function IdeaCardSkeleton({ hasImage }: { hasImage: boolean }) {
  if (hasImage) {
    return (
      <div className="rounded-xl bg-card overflow-hidden shadow-sm border border-border/40">
        <Skeleton className="aspect-[16/10] w-full rounded-none" />
        <div className="p-4 space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-1">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="flex justify-between pt-1 border-t border-border/40">
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card overflow-hidden shadow-sm border border-border/40 border-l-[3px] border-l-muted">
      <div className="p-5 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <div className="flex gap-1">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <div className="flex justify-between pt-2 border-t border-border/40">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}

function IdeasPageContent() {
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;
  const customerLoading = customerCtx?.loading ?? true;

  const router = useRouter();
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status");
  const initialTab = statusParam ? (sidebarStatusMap[statusParam] || statusParam) : "all";

  const [ideas, setIdeas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sortBy, setSortBy] = useState("date");
  const [search, setSearch] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  // Sync URL param changes (e.g. sidebar click while on ideas page)
  useEffect(() => {
    const newTab = statusParam ? (sidebarStatusMap[statusParam] || statusParam) : "all";
    setActiveTab(newTab);
  }, [statusParam]);

  const fetchIdeas = useCallback(async () => {
    if (customerLoading) return;
    setLoading(true);
    try {
      let url = `/api/ideas?sortBy=${sortBy}&limit=100`;
      if (activeTab !== "all") url += `&status=${activeTab}`;
      if (selectedCustomerId) url += `&customerId=${selectedCustomerId}`;
      const res = await fetch(url);
      const data = await res.json();
      setIdeas(data.ideas || []);
    } catch (err) {
      console.error("Failed to fetch ideas:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, sortBy, selectedCustomerId, customerLoading]);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  const handleSuggestIdeas = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest-ideas",
          recentTopics: ideas.slice(0, 10).map((i) => i.title),
        }),
      });
      const data = await res.json();

      for (const suggestion of data.suggestions || []) {
        await fetch("/api/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: suggestion.title,
            description: suggestion.description,
            topicTags: suggestion.topicTags || [],
            sourceType: "internal",
          }),
        });
      }
      fetchIdeas();
    } catch (err) {
      console.error("Failed to suggest ideas:", err);
    } finally {
      setSuggesting(false);
    }
  };

  const filtered = search
    ? ideas.filter(
        (i) =>
          i.title.toLowerCase().includes(search.toLowerCase()) ||
          (i.description || "").toLowerCase().includes(search.toLowerCase()) ||
          (i.topicTags || []).some((t: string) =>
            t.toLowerCase().includes(search.toLowerCase())
          )
      )
    : ideas;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Ideas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Capture, score, and commission content ideas
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSuggestIdeas}
            disabled={suggesting}
            className="gap-2"
          >
            {suggesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            AI Suggest
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link href="/ideas/new">
              <Plus className="h-4 w-4" />
              New Idea
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {statusTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                router.replace(
                  tab === "all" ? "/ideas" : `/ideas?status=${tab}`,
                  { scroll: false }
                );
              }}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {statusTabLabels[tab] || tab}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ideas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortBy(sortBy === "date" ? "score" : "date")}
          className="gap-2"
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortBy === "date" ? "By Date" : "By Score"}
        </Button>
      </div>

      {/* Ideas Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Skeleton cards — mix of image and text variants */}
          <IdeaCardSkeleton hasImage={true} />
          <IdeaCardSkeleton hasImage={false} />
          <IdeaCardSkeleton hasImage={true} />
          <IdeaCardSkeleton hasImage={false} />
          <IdeaCardSkeleton hasImage={false} />
          <IdeaCardSkeleton hasImage={true} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center mb-6">
            <Lightbulb className="h-10 w-10 text-amber-500/60" />
          </div>
          <p className="text-lg font-semibold mb-2">No ideas yet</p>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Start capturing content ideas or let AI suggest some for you
          </p>
          <div className="flex gap-3">
            <Button asChild size="sm" className="gap-2">
              <Link href="/ideas/new">
                <Plus className="h-4 w-4" />
                Create Idea
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSuggestIdeas}
              disabled={suggesting}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              AI Suggest
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IdeasPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-56 mt-2" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <IdeaCardSkeleton hasImage={true} />
          <IdeaCardSkeleton hasImage={false} />
          <IdeaCardSkeleton hasImage={true} />
        </div>
      </div>
    }>
      <IdeasPageContent />
    </Suspense>
  );
}
