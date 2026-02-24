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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";

const statusColors: Record<string, string> = {
  submitted: "bg-blue-500/10 text-blue-500",
  commissioned: "bg-green-500/10 text-green-500",
  rejected: "bg-red-500/10 text-red-500",
};

const statusLabels: Record<string, string> = {
  all: "All",
  submitted: "New",
  commissioned: "Commissioned",
  rejected: "Spiked",
};

const statusTabs = ["all", "submitted", "commissioned", "rejected"];

// Map sidebar URL params to DB status values
const sidebarStatusMap: Record<string, string> = {
  new: "submitted",
  commissioned: "commissioned",
  spiked: "rejected",
};

function IdeasPageContent() {
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
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");

  // Sync URL param changes (e.g. sidebar click while on ideas page)
  useEffect(() => {
    const newTab = statusParam ? (sidebarStatusMap[statusParam] || statusParam) : "all";
    setActiveTab(newTab);
  }, [statusParam]);

  // Fetch customers for filter dropdown
  useEffect(() => {
    fetch("/api/customers?status=active&limit=200")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers || []))
      .catch(() => {});
  }, []);

  const fetchIdeas = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/ideas?sortBy=${sortBy}&limit=100`;
      if (activeTab !== "all") url += `&status=${activeTab}`;
      if (customerFilter) url += `&customerId=${customerFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      setIdeas(data.ideas || []);
    } catch (err) {
      console.error("Failed to fetch ideas:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, sortBy, customerFilter]);

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

      // Create each suggestion as a new idea
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
          <Link href="/ideas/new">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              New Idea
            </Button>
          </Link>
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
                const reverseMap: Record<string, string> = { submitted: "new", commissioned: "commissioned", rejected: "spiked" };
                const urlStatus = reverseMap[tab];
                router.replace(tab === "all" ? "/ideas" : `/ideas?status=${urlStatus || tab}`, { scroll: false });
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {statusLabels[tab] || tab}
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

        {customers.length > 0 && (
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">All Customers</option>
            {customers.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

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
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Lightbulb className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No ideas yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Start capturing content ideas or let AI suggest some
            </p>
            <div className="flex gap-2">
              <Link href="/ideas/new">
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Idea
                </Button>
              </Link>
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
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((idea) => (
            <Card
              key={idea.id}
              className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/ideas/${idea.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-sm line-clamp-2">
                    {idea.title}
                  </h3>
                  <Badge
                    variant="secondary"
                    className={`${statusColors[idea.status] || ""} border-0 shrink-0 text-[11px]`}
                  >
                    {statusLabels[idea.status] || idea.status}
                  </Badge>
                </div>

                {idea.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                    {idea.description}
                  </p>
                )}

                {/* Tags: Topics, Campaigns, Events */}
                {(idea.topicTags?.length > 0 || idea.strategicTags?.length > 0 || idea.eventTags?.length > 0) && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(idea.topicTags || []).slice(0, 3).map((tag: string) => (
                      <span
                        key={`t-${tag}`}
                        className="text-[10px] bg-blue-500/10 text-blue-600 rounded-full px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                    {(idea.strategicTags || []).slice(0, 2).map((tag: string) => (
                      <span
                        key={`c-${tag}`}
                        className="text-[10px] bg-purple-500/10 text-purple-600 rounded-full px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                    {(idea.eventTags || []).slice(0, 2).map((tag: string) => (
                      <span
                        key={`e-${tag}`}
                        className="text-[10px] bg-amber-500/10 text-amber-600 rounded-full px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Customer badge */}
                {idea.customerId && (() => {
                  const cust = customers.find((c: any) => c.id === idea.customerId);
                  return cust ? (
                    <div className="mb-3">
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-600 rounded-full px-2 py-0.5 font-medium">
                        {cust.name}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* Score + date */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {idea.predictedEngagementScore ? (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      <span className="font-medium">
                        {Math.round(idea.predictedEngagementScore)}
                      </span>
                    </div>
                  ) : (
                    <span>Unscored</span>
                  )}
                  <span>
                    {new Date(idea.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IdeasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <IdeasPageContent />
    </Suspense>
  );
}
