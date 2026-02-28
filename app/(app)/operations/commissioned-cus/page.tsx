"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Loader2,
  Search,
  CheckCircle2,
  CalendarIcon,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";

const typeColors: Record<string, string> = {
  article: "bg-blue-500/10 text-blue-500",
  video: "bg-red-500/10 text-red-500",
  graphic: "bg-pink-500/10 text-pink-500",
  thread: "bg-violet-500/10 text-violet-500",
  newsletter: "bg-amber-500/10 text-amber-500",
  podcast: "bg-green-500/10 text-green-500",
  other: "bg-gray-500/10 text-gray-500",
};

const statusColors: Record<string, string> = {
  todo: "bg-gray-500/10 text-gray-500",
  in_progress: "bg-blue-500/10 text-blue-500",
  review: "bg-amber-500/10 text-amber-500",
  done: "bg-green-500/10 text-green-500",
};

const statusLabels: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

interface ContentObject {
  id: string;
  workingTitle: string;
  finalTitle: string | null;
  contentType: string;
  contentUnits: number | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
  totalTasks: number;
  doneTasks: number;
}

interface ProductionTask {
  id: string;
  contentObjectId: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  dueDate: string | null;
  completedAt: string | null;
}

export default function CommissionedCUsPage() {
  const router = useRouter();

  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [contentObjects, setContentObjects] = useState<ContentObject[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, contentRes, customersRes] = await Promise.all([
        fetch("/api/production-tasks?limit=500"),
        fetch("/api/content-objects?limit=500"),
        fetch("/api/customers?status=active&limit=200"),
      ]);

      const tasksData = await tasksRes.json();
      const contentData = await contentRes.json();
      const customersData = await customersRes.json();

      setTasks(tasksData.tasks || []);
      setContentObjects(contentData.contentObjects || []);
      setCustomers(customersData.customers || []);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build lookup maps
  const contentMap = new Map<string, ContentObject>();
  for (const co of contentObjects) {
    contentMap.set(co.id, co);
  }

  // Only include tasks whose content object has content units (CU values)
  let filtered = tasks.filter((task) => {
    const co = contentMap.get(task.contentObjectId);
    return co && co.contentUnits !== null && co.contentUnits > 0;
  });

  // Filter by date range on task createdAt
  if (dateRange?.from) {
    const from = startOfDay(dateRange.from);
    const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    filtered = filtered.filter((task) => {
      const taskDate = new Date(task.createdAt);
      return isWithinInterval(taskDate, { start: from, end: to });
    });
  }

  // Filter by customer
  if (customerFilter) {
    const customerContentIds = new Set(
      contentObjects
        .filter((co) => co.customerId === customerFilter)
        .map((co) => co.id)
    );
    filtered = filtered.filter((task) =>
      customerContentIds.has(task.contentObjectId)
    );
  }

  // Filter by search
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((task) => {
      const co = contentMap.get(task.contentObjectId);
      const title = co?.finalTitle || co?.workingTitle || "";
      return (
        task.title.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q)
      );
    });
  }

  // Sort by createdAt descending (newest first)
  filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Compute summary stats
  const totalCUs = filtered.reduce((sum, task) => {
    const co = contentMap.get(task.contentObjectId);
    return sum + (co?.contentUnits || 0);
  }, 0);
  const uniqueContentIds = new Set(filtered.map((t) => t.contentObjectId));
  const doneTasks = filtered.filter((t) => t.status === "done").length;

  const clearDateRange = () => {
    setDateRange(undefined);
  };

  const dateRangeLabel =
    dateRange?.from && dateRange?.to
      ? `${format(dateRange.from, "MMM d, yyyy")} – ${format(dateRange.to, "MMM d, yyyy")}`
      : dateRange?.from
        ? format(dateRange.from, "MMM d, yyyy")
        : "Filter by date created";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="h-6 w-6 text-emerald-500" />
          Commissioned Content Units
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Production tasks for commissioned content with content unit values
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date Range Picker */}
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-9 justify-start text-left font-normal",
                !dateRange?.from && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              <span className="truncate">{dateRangeLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(range) => {
                setDateRange(range);
                if (range?.from && range?.to) {
                  setCalendarOpen(false);
                }
              }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {dateRange?.from && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearDateRange}
            className="h-9 px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear dates
          </Button>
        )}

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Customer filter */}
        {customers.length > 0 && (
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">All Customers</option>
            {customers.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">Tasks</p>
            <p className="text-2xl font-bold mt-1">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Content Items
            </p>
            <p className="text-2xl font-bold mt-1">{uniqueContentIds.size}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Total CUs
            </p>
            <p className="text-2xl font-bold mt-1">{totalCUs.toFixed(1)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Completed
            </p>
            <p className="text-2xl font-bold mt-1">
              {doneTasks}
              <span className="text-sm font-normal text-muted-foreground">
                /{filtered.length}
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No tasks found</p>
            <p className="text-sm text-muted-foreground">
              {dateRange?.from
                ? "Try adjusting your date range or filters"
                : "No production tasks with content unit values yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Task
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Content
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Customer
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    CU
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const co = contentMap.get(task.contentObjectId);
                  const contentTitle =
                    co?.finalTitle || co?.workingTitle || "Untitled";
                  return (
                    <tr
                      key={task.id}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() =>
                        router.push(`/content/${task.contentObjectId}`)
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-xs">
                          {task.title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {contentTitle}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {co?.customerName ? (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5 font-medium">
                            {co.customerName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            typeColors[co?.contentType || ""] || ""
                          )}
                        >
                          {co?.contentType || "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-medium">
                        {co?.contentUnits
                          ? Number(co.contentUnits).toFixed(1)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px]",
                            statusColors[task.status] || ""
                          )}
                        >
                          {statusLabels[task.status] || task.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(task.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
