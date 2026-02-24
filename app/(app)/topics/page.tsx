"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Tag,
  Loader2,
  Search,
  Lightbulb,
  FileText,
  TrendingUp,
  ArrowRight,
  BarChart3,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface TopicData {
  name: string;
  ideas: any[];
  content: any[];
  ideaStatuses: Record<string, number>;
  contentStatuses: Record<string, number>;
}

const statusDots: Record<string, string> = {
  submitted: "bg-blue-500",
  shortlisted: "bg-amber-500",
  commissioned: "bg-green-500",
  rejected: "bg-red-400",
};

const contentStatusDots: Record<string, string> = {
  draft: "bg-gray-400",
  in_production: "bg-blue-500",
  review: "bg-amber-500",
  approved: "bg-emerald-500",
  published: "bg-green-600",
};

export default function TopicsPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    try {
      const [ideasRes, contentRes] = await Promise.all([
        fetch("/api/ideas?limit=500"),
        fetch("/api/content-objects?limit=500"),
      ]);
      const ideasData = await ideasRes.json();
      const contentData = await contentRes.json();

      const ideas = ideasData.ideas || [];
      const contentObjects = contentData.contentObjects || [];

      // Aggregate unique topic tags
      const topicMap = new Map<string, TopicData>();

      ideas.forEach((idea: any) => {
        (idea.topicTags || []).forEach((tag: string) => {
          if (!topicMap.has(tag)) {
            topicMap.set(tag, {
              name: tag,
              ideas: [],
              content: [],
              ideaStatuses: {},
              contentStatuses: {},
            });
          }
          const topic = topicMap.get(tag)!;
          topic.ideas.push(idea);
          topic.ideaStatuses[idea.status] = (topic.ideaStatuses[idea.status] || 0) + 1;
        });
      });

      contentObjects.forEach((obj: any) => {
        // Check topicTags on content or match via linked idea
        const tags = obj.topicTags || [];
        const matchedIdea = ideas.find((i: any) => i.id === obj.ideaId);
        const allTags = [...tags, ...(matchedIdea?.topicTags || [])];
        const uniqueTags = Array.from(new Set(allTags));

        uniqueTags.forEach((tag: string) => {
          if (!topicMap.has(tag)) {
            topicMap.set(tag, {
              name: tag,
              ideas: [],
              content: [],
              ideaStatuses: {},
              contentStatuses: {},
            });
          }
          const topic = topicMap.get(tag)!;
          if (!topic.content.find((c: any) => c.id === obj.id)) {
            topic.content.push(obj);
            const status = obj.status || "draft";
            topic.contentStatuses[status] = (topic.contentStatuses[status] || 0) + 1;
          }
        });
      });

      // Sort by total items (most active first)
      const sorted = Array.from(topicMap.values()).sort(
        (a, b) => (b.ideas.length + b.content.length) - (a.ideas.length + a.content.length)
      );

      setTopics(sorted);
    } catch (err) {
      console.error("Failed to fetch topics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const filtered = search
    ? topics.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : topics;

  const activeTopics = topics.filter((t) =>
    Object.keys(t.contentStatuses).some((s) => s === "in_production" || s === "review")
  );
  const needsContent = topics.filter((t) => t.content.length === 0 && t.ideas.length > 0);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Tag className="h-6 w-6 text-indigo-500" />
            Topics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track content themes across your ideas and production pipeline
          </p>
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search topics..."
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
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
              <Layers className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{topics.length}</p>
              <p className="text-xs text-muted-foreground">Total Topics</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeTopics.length}</p>
              <p className="text-xs text-muted-foreground">Active Topics</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Lightbulb className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{needsContent.length}</p>
              <p className="text-xs text-muted-foreground">Need Content</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Topics Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Tag className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No topics found</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add topic tags to your ideas to organize your content strategy
            </p>
            <Link href="/ideas/new">
              <Button size="sm" className="gap-2">
                <Lightbulb className="h-4 w-4" />
                Create an Idea
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((topic) => {
            const totalContent = topic.content.length;
            const publishedContent = topic.contentStatuses["published"] || 0;
            const progressPct = totalContent > 0 ? Math.round((publishedContent / totalContent) * 100) : 0;

            return (
              <Card
                key={topic.name}
                className="border-0 shadow-sm hover:shadow-md transition-shadow"
              >
                <CardContent className="p-5 space-y-4">
                  {/* Topic name */}
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-base capitalize">{topic.name}</h3>
                    <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-500 border-0 text-[10px]">
                      {topic.ideas.length + topic.content.length} items
                    </Badge>
                  </div>

                  {/* Ideas breakdown */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                      <span className="font-medium">{topic.ideas.length} Ideas</span>
                    </div>
                    {Object.entries(topic.ideaStatuses).length > 0 && (
                      <div className="flex items-center gap-2 ml-5.5">
                        {Object.entries(topic.ideaStatuses).map(([status, count]) => (
                          <span key={status} className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${statusDots[status] || "bg-gray-400"}`} />
                            {count} {status}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Content breakdown */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-3.5 w-3.5 text-blue-500" />
                      <span className="font-medium">{topic.content.length} Content</span>
                    </div>
                    {Object.entries(topic.contentStatuses).length > 0 && (
                      <div className="flex items-center gap-2 ml-5.5 flex-wrap">
                        {Object.entries(topic.contentStatuses).map(([status, count]) => (
                          <span key={status} className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${contentStatusDots[status] || "bg-gray-400"}`} />
                            {count} {status.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  {totalContent > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Published</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Link href={`/ideas?search=${encodeURIComponent(topic.name)}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
                        View Ideas <ArrowRight className="h-3 w-3" />
                      </Button>
                    </Link>
                    <Link href={`/content?search=${encodeURIComponent(topic.name)}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
                        View Content <ArrowRight className="h-3 w-3" />
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
