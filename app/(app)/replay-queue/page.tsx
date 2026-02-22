"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCcw,
  Loader2,
  TrendingUp,
  Calendar,
  BarChart2,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function ReplayQueuePage() {
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/replay-recommendations");
      const data = await res.json();
      setRecommendations(data.recommendations || []);
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RefreshCcw className="h-6 w-6 text-green-500" />
            Replay Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evergreen content recommended for re-posting based on performance
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRecommendations} disabled={loading} className="gap-2">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : recommendations.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <RefreshCcw className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No replay recommendations</p>
            <p className="text-sm text-muted-foreground mb-4">
              Mark content as &quot;evergreen&quot; to see replay suggestions here.
              Content must have been posted at least 14 days ago.
            </p>
            <Link href="/content">
              <Button variant="outline" size="sm">
                Go to Content
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec, i) => (
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
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {rec.contentType}
                          </Badge>
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
