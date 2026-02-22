"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ListOrdered,
  Loader2,
  RefreshCw,
  Eye,
  RotateCcw,
  Copy,
  Trash2,
  MoreHorizontal,
  Clock,
  Plus,
  CalendarDays,
  GripVertical,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Post {
  _id: string;
  content: string;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  platforms?: Array<{
    platform: string;
    accountId?: string;
    status?: string;
  }>;
}

interface QueueSlot {
  _id?: string;
  day: string;
  time: string;
}

const platformColors: Record<string, string> = {
  twitter: "bg-sky-500",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  facebook: "bg-blue-600",
  linkedin: "bg-blue-700",
  tiktok: "bg-gray-900",
  youtube: "bg-red-500",
  pinterest: "bg-red-600",
  reddit: "bg-orange-500",
  bluesky: "bg-blue-500",
  threads: "bg-gray-800",
  googlebusiness: "bg-blue-500",
  telegram: "bg-cyan-500",
  snapchat: "bg-yellow-400",
};

const statusStyles: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-600",
  scheduled: "bg-blue-500/10 text-blue-600",
  draft: "bg-gray-500/10 text-gray-500",
  failed: "bg-red-500/10 text-red-600",
  cancelled: "bg-gray-500/10 text-gray-400",
};

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const defaultSlots: QueueSlot[] = [
  { day: "Monday", time: "09:00" },
  { day: "Monday", time: "13:00" },
  { day: "Wednesday", time: "09:00" },
  { day: "Wednesday", time: "17:00" },
  { day: "Friday", time: "09:00" },
  { day: "Friday", time: "13:00" },
];

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 0) {
    // Future date
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function QueuePage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("posts");
  const [statusFilter, setStatusFilter] = useState("all");
  const [queueSlots, setQueueSlots] = useState<QueueSlot[]>(defaultSlots);
  const router = useRouter();

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const res = await fetch(`/api/posts?limit=50${statusParam}`);
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleDelete = async (postId: string) => {
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Post deleted");
        fetchPosts();
      } else {
        toast.error("Failed to delete post");
      }
    } catch {
      toast.error("Something went wrong");
    }
  };

  const addSlot = (day: string) => {
    setQueueSlots((prev) => [...prev, { day, time: "12:00" }]);
    toast.success(`Added time slot for ${day}`);
  };

  const removeSlot = (index: number) => {
    setQueueSlots((prev) => prev.filter((_, i) => i !== index));
    toast.success("Time slot removed");
  };

  const slotsByDay = days.map((day) => ({
    day,
    slots: queueSlots
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.day === day)
      .sort((a, b) => a.time.localeCompare(b.time)),
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Queue & Posts</h1>
          <p className="text-muted-foreground mt-1">
            Manage your post queue time slots and view all posts
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPosts} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href="/compose">
            <Button size="sm" className="gap-2 bg-blue-500 hover:bg-blue-600">
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="posts" className="gap-2">
            <ListOrdered className="h-4 w-4" />
            Posts
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            <Clock className="h-4 w-4" />
            Queue Slots
          </TabsTrigger>
        </TabsList>

        {/* Posts tab */}
        <TabsContent value="posts" className="mt-4 space-y-4">
          {/* Status filter pills */}
          <div className="flex gap-2">
            {["all", "draft", "scheduled", "published", "failed"].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className={statusFilter === s ? "bg-blue-500 hover:bg-blue-600 capitalize" : "capitalize"}
              >
                {s}
              </Button>
            ))}
          </div>

          {loading ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : posts.length === 0 ? (
            <Card className="border-dashed border-2 border-muted-foreground/20">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <ListOrdered className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No posts yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {statusFilter === "all"
                    ? "Create your first post to get started."
                    : `No ${statusFilter} posts found.`}
                </p>
                <Link href="/compose">
                  <Button className="mt-4 bg-blue-500 hover:bg-blue-600">
                    Create a post
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <Card key={post._id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/posts/${post._id}`)}>
                  <CardContent className="flex items-start gap-4 py-4">
                    <div className="flex -space-x-1.5 pt-1 shrink-0">
                      {(post.platforms || []).slice(0, 3).map((p, i) => (
                        <div
                          key={i}
                          className={`h-7 w-7 rounded-full ${
                            platformColors[p.platform?.toLowerCase()] || "bg-gray-400"
                          } border-2 border-background`}
                        />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed line-clamp-2">{post.content}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {post.scheduledFor
                          ? `Scheduled for ${formatDate(post.scheduledFor)}`
                          : post.publishedAt
                          ? `Published ${formatDate(post.publishedAt)}`
                          : `Created ${formatDate(post.createdAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge
                        variant="secondary"
                        className={`${statusStyles[post.status] || statusStyles.draft} border-0 font-medium capitalize`}
                      >
                        {post.status}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2" onClick={(e) => { e.stopPropagation(); router.push(`/posts/${post._id}`); }}>
                            <Eye className="h-4 w-4" /> View details
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2">
                            <Copy className="h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                          {post.status === "failed" && (
                            <DropdownMenuItem className="gap-2">
                              <RotateCcw className="h-4 w-4" /> Retry
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="gap-2 text-destructive focus:text-destructive"
                            onClick={() => handleDelete(post._id)}
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Queue slots tab */}
        <TabsContent value="queue" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 mb-4">
              <CalendarDays className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">How queue slots work</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Define recurring weekly time slots. When you add a post to the queue,
                  it will automatically be scheduled for the next available slot.
                </p>
              </div>
            </div>

            {slotsByDay.map(({ day, slots }) => (
              <Card key={day} className="border-0 shadow-sm">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">{day}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addSlot(day)}
                      className="gap-1.5 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add slot
                    </Button>
                  </div>
                  {slots.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      No time slots — posts won&apos;t be queued on this day
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {slots.map((slot) => (
                        <div
                          key={slot.index}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 group"
                        >
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium tabular-nums">
                            {slot.time}
                          </span>
                          <button
                            onClick={() => removeSlot(slot.index)}
                            className="ml-1 h-5 w-5 rounded-full flex items-center justify-center hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
