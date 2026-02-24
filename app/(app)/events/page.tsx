"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Loader2,
  Clock,
  AlertTriangle,
  Send,
  FileText,
  CheckSquare,
  ArrowRight,
  CalendarCheck,
  Milestone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface TimelineEvent {
  id: string;
  title: string;
  date: Date;
  type: "content_deadline" | "post_scheduled" | "task_due" | "content_publish";
  status: string;
  contentType?: string;
  linkedId?: string;
  linkedTitle?: string;
  isOverdue: boolean;
  priority?: string;
}

const typeConfig: Record<string, { label: string; color: string; border: string; icon: any }> = {
  content_deadline: { label: "Content Deadline", color: "bg-red-500/10 text-red-600", border: "border-l-red-500", icon: FileText },
  post_scheduled: { label: "Post Scheduled", color: "bg-blue-500/10 text-blue-600", border: "border-l-blue-500", icon: Send },
  task_due: { label: "Task Due", color: "bg-amber-500/10 text-amber-600", border: "border-l-amber-500", icon: CheckSquare },
  content_publish: { label: "Publish Date", color: "bg-green-500/10 text-green-600", border: "border-l-green-500", icon: CalendarCheck },
};

const timeRanges = [
  { label: "7 Days", value: 7 },
  { label: "30 Days", value: 30 },
  { label: "90 Days", value: 90 },
];

function formatRelativeDay(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;

  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [contentRes, postsRes, tasksRes] = await Promise.all([
        fetch("/api/content-objects?limit=500"),
        fetch("/api/posts?limit=500"),
        fetch("/api/production-tasks?limit=500"),
      ]);

      const contentData = await contentRes.json();
      const postsData = await postsRes.json();
      const tasksData = await tasksRes.json();

      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + range);
      const pastCutoff = new Date();
      pastCutoff.setDate(pastCutoff.getDate() - 7); // Show 7 days of overdue

      const timeline: TimelineEvent[] = [];

      // Content deadlines & publish dates
      for (const obj of contentData.contentObjects || []) {
        if (obj.dueDate) {
          const date = new Date(obj.dueDate);
          if (date >= pastCutoff && date <= cutoff) {
            timeline.push({
              id: `content-deadline-${obj.id}`,
              title: obj.finalTitle || obj.workingTitle || "Untitled Content",
              date,
              type: "content_deadline",
              status: obj.status || "draft",
              contentType: obj.contentType,
              linkedId: obj.id,
              isOverdue: date < now && obj.status !== "published",
            });
          }
        }
        if (obj.publishDate) {
          const date = new Date(obj.publishDate);
          if (date >= pastCutoff && date <= cutoff) {
            timeline.push({
              id: `content-publish-${obj.id}`,
              title: obj.finalTitle || obj.workingTitle || "Untitled Content",
              date,
              type: "content_publish",
              status: obj.status || "draft",
              contentType: obj.contentType,
              linkedId: obj.id,
              isOverdue: false,
            });
          }
        }
      }

      // Scheduled posts
      for (const post of postsData.posts || []) {
        if (post.scheduledFor) {
          const date = new Date(post.scheduledFor);
          if (date >= pastCutoff && date <= cutoff) {
            timeline.push({
              id: `post-${post.id}`,
              title: (post.content || "").substring(0, 80) || "Social Post",
              date,
              type: "post_scheduled",
              status: post.status || "draft",
              linkedId: post.id,
              isOverdue: date < now && post.status === "scheduled",
            });
          }
        }
      }

      // Task due dates
      for (const task of tasksData.tasks || []) {
        if (task.dueDate) {
          const date = new Date(task.dueDate);
          if (date >= pastCutoff && date <= cutoff) {
            timeline.push({
              id: `task-${task.id}`,
              title: task.title || "Untitled Task",
              date,
              type: "task_due",
              status: task.status || "todo",
              priority: task.priority,
              linkedId: task.contentObjectId,
              isOverdue: date < now && task.status !== "done",
            });
          }
        }
      }

      // Sort by date
      timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
      setEvents(timeline);
    } catch (err) {
      console.error("Failed to fetch events:", err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Group events by day
  const groupedByDay = new Map<string, TimelineEvent[]>();
  events.forEach((event) => {
    const dayKey = event.date.toISOString().split("T")[0];
    if (!groupedByDay.has(dayKey)) groupedByDay.set(dayKey, []);
    groupedByDay.get(dayKey)!.push(event);
  });

  const now = new Date();
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  const overdueCount = events.filter((e) => e.isOverdue).length;
  const dueThisWeek = events.filter((e) => e.date >= now && e.date <= weekFromNow).length;
  const scheduledPosts = events.filter((e) => e.type === "post_scheduled" && e.date >= now).length;
  const nextMilestone = events.find((e) => e.date >= now && (e.type === "content_deadline" || e.type === "content_publish"));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-orange-500" />
            Events & Deadlines
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upcoming milestones, deadlines, and scheduled content
          </p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {timeRanges.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                range === r.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{dueThisWeek}</p>
              <p className="text-xs text-muted-foreground">Due This Week</p>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("border-0 shadow-sm", overdueCount > 0 && "ring-1 ring-red-200")}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{overdueCount}</p>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Send className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{scheduledPosts}</p>
              <p className="text-xs text-muted-foreground">Scheduled Posts</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Milestone className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-bold truncate max-w-[120px]">
                {nextMilestone ? formatRelativeDay(nextMilestone.date) : "None"}
              </p>
              <p className="text-xs text-muted-foreground">Next Milestone</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No upcoming events</p>
            <p className="text-sm text-muted-foreground mb-4">
              Set deadlines on content and schedule posts to see your timeline
            </p>
            <div className="flex gap-2">
              <Link href="/content">
                <Button size="sm" variant="outline" className="gap-2">
                  <FileText className="h-4 w-4" /> Content
                </Button>
              </Link>
              <Link href="/compose">
                <Button size="sm" className="gap-2">
                  <Send className="h-4 w-4" /> Compose Post
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(groupedByDay.entries()).map(([dayKey, dayEvents]) => {
            const dayDate = new Date(dayKey + "T12:00:00");
            const relLabel = formatRelativeDay(dayDate);
            const isToday = relLabel === "Today";
            const isPast = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

            return (
              <div key={dayKey}>
                {/* Day header */}
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className={cn(
                      "text-xs font-semibold tracking-wide px-2.5 py-1 rounded-full",
                      isToday
                        ? "bg-blue-500 text-white"
                        : isPast
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {relLabel}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>

                {/* Day events */}
                <div className="space-y-2 ml-2">
                  {dayEvents.map((event) => {
                    const config = typeConfig[event.type];
                    const Icon = config.icon;
                    return (
                      <Card
                        key={event.id}
                        className={cn(
                          "border-0 shadow-sm border-l-[3px] cursor-pointer hover:shadow-md transition-shadow",
                          config.border,
                          event.isOverdue && "bg-red-50/50 dark:bg-red-950/20"
                        )}
                        onClick={() => {
                          if (event.type === "post_scheduled") router.push(`/posts/${event.linkedId}`);
                          else if (event.linkedId) router.push(`/content/${event.linkedId}`);
                        }}
                      >
                        <CardContent className="p-4 flex items-start gap-3">
                          <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", config.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-medium truncate">{event.title}</p>
                              {event.isOverdue && (
                                <Badge variant="secondary" className="bg-red-500/10 text-red-600 border-0 text-[10px] shrink-0">
                                  Overdue
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <Badge variant="secondary" className={cn("border-0 text-[10px]", config.color)}>
                                {config.label}
                              </Badge>
                              {event.contentType && (
                                <span className="capitalize">{event.contentType}</span>
                              )}
                              {event.priority && (
                                <span className="capitalize">{event.priority} priority</span>
                              )}
                              <span>{formatTime(event.date)}</span>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-1" />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
