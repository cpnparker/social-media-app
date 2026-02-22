"use client";

import { useState } from "react";
import {
  Sparkles,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PostAiInsightsProps {
  content: string;
  platforms?: Array<{ platform: string }>;
  analytics?: Record<string, any>;
}

interface AiInsight {
  type: "positive" | "negative" | "tip";
  title: string;
  detail: string;
}

interface AiInsightsData {
  headline: string;
  insights: AiInsight[];
  recommendation: string;
}

export default function PostAiInsights({
  content,
  platforms,
  analytics,
}: PostAiInsightsProps) {
  const [insights, setInsights] = useState<AiInsightsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "insights",
          analyticsData: {
            postContent: content,
            platforms: platforms?.map((p) => p.platform) || [],
            ...analytics,
          },
        }),
      });
      const data = await res.json();
      setInsights(data);
    } catch (err) {
      console.error("AI insights error:", err);
    } finally {
      setLoading(false);
    }
  };

  const insightIcon = (type: string) => {
    switch (type) {
      case "positive":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
      case "negative":
        return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
      case "tip":
        return <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
      default:
        return <Lightbulb className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />;
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          AI Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!insights && !loading && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Get AI-powered analysis of this post&apos;s performance and
              actionable recommendations.
            </p>
            <Button
              onClick={fetchInsights}
              className="gap-2 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600"
            >
              <Sparkles className="h-4 w-4" />
              Analyze Post
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-violet-500 mr-2" />
            <span className="text-sm text-muted-foreground">
              Analyzing post...
            </span>
          </div>
        )}

        {insights && !loading && (
          <div className="space-y-4">
            {/* Headline */}
            {insights.headline && (
              <p className="text-sm font-semibold text-center py-1 px-3 rounded-lg bg-violet-500/5 text-violet-700 dark:text-violet-300">
                {insights.headline}
              </p>
            )}

            {/* Insights list */}
            {insights.insights?.length > 0 && (
              <div className="space-y-2.5">
                {insights.insights.map((insight, i) => (
                  <div key={i} className="flex gap-2.5">
                    {insightIcon(insight.type)}
                    <div>
                      <p className="text-sm font-medium">{insight.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {insight.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendation */}
            {insights.recommendation && (
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                  Recommendation
                </p>
                <p className="text-sm text-muted-foreground">
                  {insights.recommendation}
                </p>
              </div>
            )}

            {/* Re-analyze */}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchInsights}
              className="w-full text-muted-foreground"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Re-analyze
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
