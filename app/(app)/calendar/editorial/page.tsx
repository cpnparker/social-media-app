"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  Views,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addMinutes } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import {
  CalendarDays,
  Loader2,
  FileText,
  Plus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  CheckSquare,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { typeCalendarColors as typeColors } from "@/lib/content-type-utils";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

const statusLabels: Record<string, string> = {
  draft: "Draft",
  in_production: "In Production",
  review: "Review",
  approved: "Approved",
  published: "Published",
};

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: "content" | "task";
  contentType?: string;
  status: string;
  sourceId: string;
  description?: string;
}

// Mini event component
function MiniEventComponent({ event }: { event: CalendarEvent }) {
  const color = event.contentType ? typeColors[event.contentType] : typeColors["other"];
  const isTask = event.type === "task";

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-tight font-medium truncate"
      style={{
        backgroundColor: isTask ? "transparent" : `${color.bg}20`,
        color: color.bg,
        borderLeft: `2px solid ${color.bg}`,
        borderStyle: isTask ? "dashed" : "solid",
      }}
    >
      {isTask && <CheckSquare className="h-2.5 w-2.5 shrink-0" />}
      <span className="truncate">{event.title}</span>
    </div>
  );
}

export default function EditorialCalendarPage() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"month" | "week">("month");
  const [date, setDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [contentRes, tasksRes] = await Promise.all([
        fetch("/api/content-objects?limit=500"),
        fetch("/api/production-tasks?limit=500"),
      ]);

      const contentData = await contentRes.json();
      const tasksData = await tasksRes.json();

      const calEvents: CalendarEvent[] = [];

      // Content objects with dates
      for (const obj of contentData.contentObjects || []) {
        const title = obj.finalTitle || obj.workingTitle || "Untitled";

        // Use dueDate or updatedAt as the event date
        const dateStr = obj.dueDate || obj.publishDate || obj.updatedAt;
        if (dateStr) {
          const start = new Date(dateStr);
          calEvents.push({
            id: `content-${obj.id}`,
            title,
            start,
            end: addMinutes(start, 60),
            type: "content",
            contentType: obj.contentType || "other",
            status: obj.status || "draft",
            sourceId: obj.id,
            description: obj.body ? obj.body.substring(0, 150) : undefined,
          });
        }
      }

      // Production tasks with due dates
      for (const task of tasksData.tasks || []) {
        if (task.dueDate) {
          const start = new Date(task.dueDate);
          calEvents.push({
            id: `task-${task.id}`,
            title: task.title || "Untitled Task",
            start,
            end: addMinutes(start, 30),
            type: "task",
            contentType: undefined,
            status: task.status || "todo",
            sourceId: task.contentObjectId || task.id,
          });
        }
      }

      setEvents(calEvents);
    } catch (err) {
      console.error("Failed to fetch events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    return { style: { padding: 0, background: "transparent", border: "none" } };
  }, []);

  const handleNavigate = useCallback((newDate: Date) => setDate(newDate), []);
  const handleView = useCallback((newView: any) => setView(newView), []);

  // Custom toolbar
  const CustomToolbar = useCallback(({ label, onNavigate }: any) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{label}</h2>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onNavigate("PREV")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onNavigate("NEXT")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  ), []);

  const components = useMemo(() => ({
    event: MiniEventComponent,
    toolbar: CustomToolbar,
  }), [CustomToolbar]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-emerald-500" />
            Editorial Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Content planning and production schedule at a glance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setView("month")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "month"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "week"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Week
            </button>
          </div>
          <Link href="/ideas/new">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Content
            </Button>
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(typeColors).filter(([k]) => k !== "other").map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: val.bg }} />
            <span className="text-xs text-muted-foreground">{val.text}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm border-2 border-dashed border-gray-400" />
          <span className="text-xs text-muted-foreground">Tasks</span>
        </div>
      </div>

      {/* Calendar */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <style jsx global>{`
              .rbc-calendar { font-family: inherit; }
              .rbc-header { padding: 8px 4px; font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground)); border-bottom: 1px solid hsl(var(--border)); background: transparent; }
              .rbc-month-view { border: 1px solid hsl(var(--border)); border-radius: 8px; overflow: hidden; }
              .rbc-month-row { border-color: hsl(var(--border)); }
              .rbc-day-bg { background: transparent; }
              .rbc-day-bg + .rbc-day-bg { border-left: 1px solid hsl(var(--border)); }
              .rbc-off-range-bg { background: hsl(var(--muted) / 0.3); }
              .rbc-today { background: hsl(var(--primary) / 0.05) !important; }
              .rbc-date-cell { padding: 4px 6px; font-size: 12px; color: hsl(var(--foreground)); }
              .rbc-date-cell.rbc-now { font-weight: 700; color: hsl(var(--primary)); }
              .rbc-event { margin: 1px 2px; }
              .rbc-event:focus { outline: none; }
              .rbc-event-content { font-size: 10px; }
              .rbc-row-segment { padding: 0 2px 1px; }
              .rbc-show-more { font-size: 10px; color: hsl(var(--primary)); font-weight: 600; padding: 2px 6px; }
              .rbc-time-view { border: 1px solid hsl(var(--border)); border-radius: 8px; overflow: hidden; }
              .rbc-time-header { border-bottom: 1px solid hsl(var(--border)); }
              .rbc-time-content { border-top: none; }
              .rbc-timeslot-group { border-bottom: 1px solid hsl(var(--border) / 0.5); }
              .rbc-time-slot { font-size: 11px; color: hsl(var(--muted-foreground)); }
              .rbc-current-time-indicator { background-color: hsl(var(--primary)); }
            `}</style>

            <BigCalendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              view={view}
              views={[Views.MONTH, Views.WEEK]}
              date={date}
              onNavigate={handleNavigate}
              onView={handleView}
              onSelectEvent={(event: CalendarEvent) => setSelectedEvent(event)}
              eventPropGetter={eventPropGetter}
              components={components}
              style={{ height: view === "month" ? 700 : 600 }}
              popup
            />
          </CardContent>
        </Card>
      )}

      {/* Event detail dialog */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedEvent(null)}>
          <Card className="w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg">{selectedEvent.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedEvent.start.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSelectedEvent(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {selectedEvent.type === "content" && selectedEvent.contentType && (
                  <Badge
                    variant="secondary"
                    className="border-0 text-xs text-white"
                    style={{ backgroundColor: typeColors[selectedEvent.contentType]?.bg || "#6b7280" }}
                  >
                    {typeColors[selectedEvent.contentType]?.text || selectedEvent.contentType}
                  </Badge>
                )}
                {selectedEvent.type === "task" && (
                  <Badge variant="secondary" className="border-0 text-xs bg-amber-500/10 text-amber-600">
                    Production Task
                  </Badge>
                )}
                <Badge variant="secondary" className="border-0 text-xs capitalize bg-muted">
                  {statusLabels[selectedEvent.status] || selectedEvent.status}
                </Badge>
              </div>

              {selectedEvent.description && (
                <p className="text-sm text-muted-foreground line-clamp-3">{selectedEvent.description}</p>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  className="gap-2 flex-1"
                  onClick={() => {
                    router.push(`/content/${selectedEvent.sourceId}`);
                    setSelectedEvent(null);
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                  View Details
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedEvent(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
