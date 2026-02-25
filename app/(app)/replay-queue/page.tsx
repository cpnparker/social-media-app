"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCcw,
  Loader2,
  TrendingUp,
  Calendar,
  BarChart2,
  Send,
  Search,
  X,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";

interface Recommendation {
  contentObjectId: string;
  workingTitle: string;
  contentType: string | null;
  lastPostedDate: string | null;
  daysSinceLastPost: number;
  historicalEngagement: number;
  replayCount: number;
  score: number;
  totalImpressions: number;
  linkedPostCount: number;
}

export default function ReplayQueuePage() {
  const router = useRouter();
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "engagement" | "impressions" | "days">("score");
  const [minScore, setMinScore] = useState<number>(0);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const custParam = selectedCustomerId ? `?customerId=${selectedCustomerId}` : "";
      const res = await fetch(`/api/replay-recommendations${custParam}`);
      const data = await res.json();
      setRecommendations(data.recommendations || []);
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // Filtered + sorted recommendations
  const filtered = useMemo(() => {
    let result = recommendations;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) =>
        (r.workingTitle || "").toLowerCase().includes(q)
      );
    }

    // Min score filter
    if (minScore > 0) {
      result = result.filter((r) => r.score >= minScore);
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "engagement":
          return b.historicalEngagement - a.historicalEngagement;
        case "impressions":
          return b.totalImpressions - a.totalImpressions;
        case "days":
          return b.daysSinceLastPost - a.daysSinceLastPost;
        case "score":
        default:
          return b.score - a.score;
      }
    });

    return result;
  }, [recommendations, searchQuery, sortBy, minScore]);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RefreshCcw className="h-6 w-6 text-green-500" />
            Replay Social Media
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Published content ranked by engagement score for re-posting
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRecommendations} disabled={loading} className="gap-2">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      {recommendations.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search content titles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sort options */}
            <span className="text-xs text-muted-foreground">Sort by:</span>
            {(
              [
                { key: "score", label: "Replay Score" },
                { key: "engagement", label: "Engagement" },
                { key: "impressions", label: "Impressions" },
                { key: "days", label: "Days Since Post" },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.key}
                variant={sortBy === opt.key ? "default" : "outline"}
                size="sm"
                onClick={() => setSortBy(opt.key)}
                className={sortBy === opt.key ? "bg-blue-500 hover:bg-blue-600" : ""}
              >
                {opt.label}
              </Button>
            ))}

            <div className="h-6 w-px bg-border mx-1" />

            {/* Min score filter */}
            <span className="text-xs text-muted-foreground">Min score:</span>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value={0}>Any</option>
              <option value={10}>10+</option>
              <option value={50}>50+</option>
              <option value={100}>100+</option>
              <option value={500}>500+</option>
            </select>

            {(searchQuery || minScore > 0) && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setMinScore(0);
                }}
                className="text-xs text-blue-500 hover:text-blue-600 underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {(searchQuery || minScore > 0) && (
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {recommendations.length} recommendations
            </p>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <RefreshCcw className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">
              {recommendations.length === 0
                ? "No replay recommendations"
                : "No matches"}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {recommendations.length === 0
                ? "Published content that hasn\u2019t been re-posted in 14+ days will appear here."
                : "Try adjusting your search or filters."}
            </p>
            {recommendations.length === 0 && (
              <Link href="/content">
                <Button variant="outline" size="sm">
                  Go to Content
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec, i) => (
            <Card key={rec.contentObjectId} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Rank */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                    {i + 1}
                  </div>

                  {/* Content info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/content/${rec.contentObjectId}`}
                          className="text-sm font-semibold hover:underline"
                        >
                          {rec.workingTitle}
                        </Link>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {rec.contentType && (
                            <Badge variant="secondary" className="text-[10px] capitalize">
                              {rec.contentType}
                            </Badge>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Last posted {rec.daysSinceLastPost}d ago
                          </span>
                          <span className="flex items-center gap-1">
                            <RefreshCcw className="h-3 w-3" />
                            {rec.replayCount} replays
                          </span>
                          <span className="flex items-center gap-1">
                            <Send className="h-3 w-3" />
                            {rec.linkedPostCount} posts
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 text-sm font-bold">
                          <TrendingUp className="h-4 w-4 text-green-500" />
                          {rec.score}
                        </div>
                        <p className="text-[10px] text-muted-foreground">replay score</p>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <BarChart2 className="h-3 w-3" />
                        {rec.totalImpressions.toLocaleString()} impressions
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <TrendingUp className="h-3 w-3" />
                        {rec.historicalEngagement.toLocaleString()} engagements
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <Link href={`/compose?contentObjectId=${rec.contentObjectId}`}>
                    <Button size="sm" variant="outline" className="gap-2 shrink-0">
                      <RefreshCcw className="h-3.5 w-3.5" />
                      Replay
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
