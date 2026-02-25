"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  RefreshCw,
  Plus,
  Clock,
  Megaphone,
  FileText,
  ExternalLink,
  Send,
  Calendar,
  Search,
  X,
  ArrowUpDown,
  Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import Link from "next/link";
import {
  platformLabels,
  platformHexColors,
} from "@/lib/platform-utils";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";

interface SocialPromo {
  id: string;
  contentId: string | null;
  customerId: string | null;
  customerName: string | null;
  contentTitle: string | null;
  contentType: string | null;
  name: string;
  network: string;
  platform: string;
  accountName: string | null;
  distributionId: string | null;
  type: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
}

const statusStyles: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-600",
  scheduled: "bg-blue-500/10 text-blue-600",
  draft: "bg-gray-500/10 text-gray-500",
  failed: "bg-red-500/10 text-red-600",
  cancelled: "bg-gray-500/10 text-gray-400",
};

function formatFullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AllSocialPromosPage() {
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;

  const [promos, setPromos] = useState<SocialPromo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (networkFilter !== "all") params.set("network", networkFilter);

      const res = await fetch(`/api/social-promos?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPromos(data.promos || []);
        setTotal(data.total ?? 0);
      } else {
        toast.error("Failed to load social promos");
      }
    } catch (err) {
      console.error("Failed to fetch social promos:", err);
      toast.error("Failed to load social promos");
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId, statusFilter, networkFilter, offset]);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, networkFilter, selectedCustomerId]);

  // Derive unique networks and types
  const availableNetworks = useMemo(() => {
    const set = new Set<string>();
    for (const promo of promos) {
      if (promo.network) set.add(promo.network.toLowerCase());
    }
    return Array.from(set).sort();
  }, [promos]);

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const promo of promos) {
      if (promo.type) set.add(promo.type);
    }
    return Array.from(set).sort();
  }, [promos]);

  // Client-side filtering (search + type + sort)
  const filteredPromos = useMemo(() => {
    let result = promos;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.contentTitle || "").toLowerCase().includes(q) ||
          (p.accountName || "").toLowerCase().includes(q) ||
          (p.customerName || "").toLowerCase().includes(q)
      );
    }

    if (typeFilter !== "all") {
      result = result.filter((p) => p.type === typeFilter);
    }

    if (sortBy === "oldest") {
      result = [...result].reverse();
    }

    return result;
  }, [promos, searchQuery, typeFilter, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const published = promos.filter((p) => p.status === "published").length;
    const scheduled = promos.filter((p) => p.status === "scheduled").length;
    const draft = promos.filter((p) => p.status === "draft").length;
    return { published, scheduled, draft, total };
  }, [promos, total]);

  const hasMore = offset + limit < total;
  const hasPrev = offset > 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">All Social Promos</h1>
          <p className="text-muted-foreground mt-1">
            Complete list of all social media promotions
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPromos} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" className="gap-2 bg-blue-500 hover:bg-blue-600" asChild>
            <Link href="/compose">
              <Plus className="h-4 w-4" />
              New Post
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Promos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-emerald-600">{stats.published}</p>
            <p className="text-xs text-muted-foreground">Published</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-blue-600">{stats.scheduled}</p>
            <p className="text-xs text-muted-foreground">Scheduled</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-gray-500">{stats.draft}</p>
            <p className="text-xs text-muted-foreground">Drafts</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search promos by name, content, account..."
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

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter pills */}
          {["all", "draft", "scheduled", "published"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className={
                statusFilter === s
                  ? "bg-blue-500 hover:bg-blue-600 capitalize"
                  : "capitalize"
              }
            >
              {s}
            </Button>
          ))}

          <div className="h-6 w-px bg-border mx-1" />

          {/* Network/platform filter */}
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All platforms</option>
            {availableNetworks.map((n) => (
              <option key={n} value={n}>
                {platformLabels[n] || n}
              </option>
            ))}
          </select>

          {/* Type filter */}
          {availableTypes.length > 1 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All types</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          {/* Sort */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSortBy((prev) => (prev === "newest" ? "oldest" : "newest"))
            }
            className="gap-1.5"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortBy === "newest" ? "Newest first" : "Oldest first"}
          </Button>
        </div>

        {/* Active filter count */}
        {(statusFilter !== "all" ||
          networkFilter !== "all" ||
          typeFilter !== "all" ||
          searchQuery) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {filteredPromos.length} of {total} promos
            </span>
            <button
              onClick={() => {
                setStatusFilter("all");
                setNetworkFilter("all");
                setTypeFilter("all");
                setSearchQuery("");
              }}
              className="text-blue-500 hover:text-blue-600 underline"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Promos list */}
      {loading ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : filteredPromos.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Megaphone className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No social promos found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {statusFilter === "all" &&
              networkFilter === "all" &&
              !searchQuery
                ? "No social promotions have been created for this customer yet."
                : "No promos match the current filters. Try adjusting your search."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredPromos.map((promo) => {
            const networkLower = promo.network?.toLowerCase();
            const color = platformHexColors[networkLower] || "#6b7280";
            return (
              <Card
                key={promo.id}
                className="border-0 shadow-sm hover:shadow-md transition-shadow"
              >
                <CardContent className="flex items-start gap-4 py-4">
                  {/* Platform pill */}
                  <div className="flex flex-col items-center gap-1.5 pt-0.5 shrink-0 min-w-[100px]">
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: color }}
                    >
                      {platformLabels[networkLower] || promo.network}
                    </span>
                    {promo.accountName && (
                      <span className="text-[10px] text-muted-foreground text-center truncate max-w-[100px]">
                        {promo.accountName}
                      </span>
                    )}
                    {promo.type && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {promo.type}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-relaxed line-clamp-2">
                      {promo.name || "No caption"}
                    </p>
                    {promo.contentTitle && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">
                          {promo.contentTitle}
                        </span>
                        {promo.contentType && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1 py-0 font-normal"
                          >
                            {promo.contentType}
                          </Badge>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      {promo.publishedAt && (
                        <span className="flex items-center gap-1">
                          <Send className="h-3 w-3" />
                          Published {formatFullDate(promo.publishedAt)}
                        </span>
                      )}
                      {!promo.publishedAt && promo.scheduledAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Scheduled {formatFullDate(promo.scheduledAt)}
                        </span>
                      )}
                      {!promo.publishedAt &&
                        !promo.scheduledAt &&
                        promo.createdAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Created {formatFullDate(promo.createdAt)}
                          </span>
                        )}
                      {promo.customerName && (
                        <span className="text-muted-foreground/60">
                          {promo.customerName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status + actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge
                      variant="secondary"
                      className={`${
                        statusStyles[promo.status] || statusStyles.draft
                      } border-0 font-medium capitalize`}
                    >
                      {promo.status}
                    </Badge>
                    {promo.contentId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                      >
                        <Link href={`/content/${promo.contentId}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between py-2">
          <p className="text-sm text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
