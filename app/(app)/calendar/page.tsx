"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  Views,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  PenSquare,
  CalendarDays,
  RefreshCw,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Link from "next/link";

import "react-big-calendar/lib/css/react-big-calendar.css";

import {
  platformHexColors,
  platformLabels,
  statusHexColors,
  statusStyles,
  formatNumber,
  formatFullDate,
} from "@/lib/platform-utils";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

interface Post {
  _id: string;
  content: string;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  platforms?: Array<{
    platform: string;
    analytics?: {
      impressions?: number;
      likes?: number;
      comments?: number;
    };
  }>;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  status: string;
  platforms: string[];
  resource: Post;
}

function EventComponent({ event }: { event: CalendarEvent }) {
  const primary = event.platforms[0]?.toLowerCase();
  const color =
    platformHexColors[primary] || statusHexColors[event.status] || "#3b82f6";

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium truncate"
      style={{
        backgroundColor: `${color}18`,
        color: color,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <span className="truncate">{event.title}</span>
    </div>
  );
}

export default function CalendarPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<string>(Views.MONTH);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Modal state
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/posts?limit=100");
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const events: CalendarEvent[] = useMemo(
    () =>
      posts
        .filter((p) => p.scheduledFor || p.publishedAt)
        .map((post) => {
          const date = new Date(
            post.scheduledFor || post.publishedAt || post.createdAt
          );
          return {
            id: post._id,
            title: post.content?.substring(0, 60) || "Untitled post",
            start: date,
            end: new Date(date.getTime() + 30 * 60000),
            status: post.status,
            platforms: (post.platforms || []).map((p) => p.platform),
            resource: post,
          };
        }),
    [posts]
  );

  const handleNavigate = (date: Date) => setCurrentDate(date);
  const handleViewChange = (view: string) => setCurrentView(view);

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedPost(event.resource);
    setModalOpen(true);
  };

  // Compute quick stats for modal
  const getPostStats = (post: Post) => {
    const totals = { impressions: 0, likes: 0, comments: 0 };
    (post.platforms || []).forEach((p) => {
      const a = p.analytics;
      if (a) {
        totals.impressions += a.impressions || 0;
        totals.likes += a.likes || 0;
        totals.comments += a.comments || 0;
      }
    });
    return totals;
  };

  const CustomToolbar = ({ label, onNavigate, onView, view }: any) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onNavigate("PREV")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onNavigate("NEXT")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <h2 className="text-lg font-semibold ml-2">{label}</h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-muted rounded-lg p-0.5">
          {[
            { key: Views.MONTH, label: "Month" },
            { key: Views.WEEK, label: "Week" },
            { key: Views.DAY, label: "Day" },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => onView(v.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Content Calendar
          </h1>
          <p className="text-muted-foreground mt-1">
            Visualise and manage your scheduled content
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPosts}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href="/compose">
            <Button
              size="sm"
              className="gap-2 bg-blue-500 hover:bg-blue-600"
            >
              <PenSquare className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4">
        {[
          { label: "Published", color: "#10b981" },
          { label: "Scheduled", color: "#3b82f6" },
          { label: "Draft", color: "#9ca3af" },
          { label: "Failed", color: "#ef4444" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="calendar-wrapper">
              <BigCalendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                date={currentDate}
                view={currentView as any}
                onNavigate={handleNavigate}
                onView={handleViewChange}
                onSelectEvent={handleSelectEvent}
                components={{
                  toolbar: CustomToolbar,
                  event: EventComponent as any,
                }}
                style={{ height: 680 }}
                popup
                selectable
                eventPropGetter={() => ({
                  style: {
                    backgroundColor: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  },
                })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Preview Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          {selectedPost && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base">Post Preview</DialogTitle>
                  <Badge
                    variant="secondary"
                    className={`${
                      statusStyles[selectedPost.status] ||
                      "bg-gray-500/10 text-gray-500"
                    } border-0 font-medium capitalize text-xs`}
                  >
                    {selectedPost.status}
                  </Badge>
                </div>
                <DialogDescription className="flex items-center gap-1.5 text-xs">
                  <Clock className="h-3 w-3" />
                  {selectedPost.publishedAt
                    ? formatFullDate(selectedPost.publishedAt)
                    : selectedPost.scheduledFor
                    ? `Scheduled for ${formatFullDate(selectedPost.scheduledFor)}`
                    : formatFullDate(selectedPost.createdAt)}
                </DialogDescription>
              </DialogHeader>

              {/* Content */}
              <div className="mt-2">
                <p className="text-sm leading-relaxed line-clamp-6">
                  {selectedPost.content}
                </p>
              </div>

              {/* Platform badges */}
              {selectedPost.platforms &&
                selectedPost.platforms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedPost.platforms.map((p, i) => {
                      const platform = p.platform?.toLowerCase();
                      const color =
                        platformHexColors[platform] || "#6b7280";
                      const label =
                        platformLabels[platform] || p.platform;
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium"
                          style={{
                            backgroundColor: `${color}15`,
                            color: color,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}

              {/* Quick stats */}
              {(() => {
                const stats = getPostStats(selectedPost);
                const hasStats =
                  stats.impressions > 0 ||
                  stats.likes > 0 ||
                  stats.comments > 0;
                if (!hasStats) return null;

                return (
                  <div className="flex gap-4 mt-2 py-2 px-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="font-medium">
                        {formatNumber(stats.impressions)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Heart className="h-3.5 w-3.5" />
                      <span className="font-medium">
                        {formatNumber(stats.likes)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span className="font-medium">
                        {formatNumber(stats.comments)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2 mt-2">
                <Link href={`/posts/${selectedPost._id}`} className="flex-1">
                  <Button className="w-full gap-2 bg-blue-500 hover:bg-blue-600">
                    <ExternalLink className="h-4 w-4" />
                    View Full Details
                  </Button>
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        .calendar-wrapper .rbc-header {
          padding: 10px 4px;
          font-size: 12px;
          font-weight: 600;
          color: hsl(var(--muted-foreground));
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid hsl(var(--border));
        }
        .calendar-wrapper .rbc-month-view,
        .calendar-wrapper .rbc-time-view {
          border: 1px solid hsl(var(--border));
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .calendar-wrapper .rbc-day-bg {
          transition: background-color 0.15s;
        }
        .calendar-wrapper .rbc-day-bg:hover {
          background-color: hsl(var(--muted) / 0.5);
        }
        .calendar-wrapper .rbc-day-bg + .rbc-day-bg,
        .calendar-wrapper .rbc-month-row + .rbc-month-row {
          border-color: hsl(var(--border));
        }
        .calendar-wrapper .rbc-off-range-bg {
          background-color: hsl(var(--muted) / 0.3);
        }
        .calendar-wrapper .rbc-today {
          background-color: hsl(220 90% 56% / 0.04);
        }
        .calendar-wrapper .rbc-date-cell {
          padding: 4px 8px;
          font-size: 13px;
          font-weight: 500;
        }
        .calendar-wrapper .rbc-date-cell.rbc-now {
          font-weight: 700;
          color: hsl(220 90% 56%);
        }
        .calendar-wrapper .rbc-event {
          margin: 1px 4px;
          cursor: pointer;
        }
        .calendar-wrapper .rbc-event:focus {
          outline: none;
        }
        .calendar-wrapper .rbc-show-more {
          font-size: 11px;
          font-weight: 600;
          color: hsl(220 90% 56%);
          padding: 2px 8px;
        }
        .calendar-wrapper .rbc-time-header,
        .calendar-wrapper .rbc-time-content {
          border-color: hsl(var(--border));
        }
        .calendar-wrapper .rbc-timeslot-group {
          border-color: hsl(var(--border));
          min-height: 60px;
        }
        .calendar-wrapper .rbc-time-slot {
          font-size: 11px;
          color: hsl(var(--muted-foreground));
        }
        .calendar-wrapper .rbc-current-time-indicator {
          background-color: hsl(220 90% 56%);
          height: 2px;
        }
        .calendar-wrapper .rbc-header + .rbc-header {
          border-color: hsl(var(--border));
        }
      `}</style>
    </div>
  );
}
