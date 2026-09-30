import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { isOpenWork } from "@/lib/workload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/operations/team-workload?userIds=43,164&excludeClients=2
//
// Every task currently on the selected people's plates — open, not spiked,
// assigned (see isOpenWork in lib/workload.ts) — content AND social-promo,
// regardless of date. The Workload view buckets them by deadline client-side,
// because "this week" depends on today in the workspace timezone.
//
// Unlike /team-production this is deliberately NOT bounded by a date range:
// a task with no deadline, or one that went overdue months ago, is still
// someone's work today, and hiding it is how a manager misses it.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const userIdList = (searchParams.get("userIds") || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  const excludedIds = new Set(
    (searchParams.get("excludeClients") || "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n))
  );

  if (userIdList.length === 0) return NextResponse.json({ tasks: [] });

  try {
    // Only date_completed is filtered in SQL: PostgREST's neq drops NULLs, so
    // "not spiked" is applied in JS through the one shared predicate. Ids go
    // in batches of 50, as in /team-production — All Staff is ~730 ids, too
    // many for one query string.
    const build = (view: string, ids: number[]) => (start: number, end: number) =>
      supabase
        .from(view)
        .select("*")
        .in("id_user_assignee", ids)
        .is("date_completed", null)
        .order("id_task", { ascending: true })
        .range(start, end);

    const batches: number[][] = [];
    for (let i = 0; i < userIdList.length; i += 50) batches.push(userIdList.slice(i, i + 50));
    const results = await Promise.all(
      batches.map((ids) =>
        Promise.all([fetchAllRows(build("app_tasks_content", ids)), fetchAllRows(build("app_tasks_social", ids))])
      )
    );
    const contentRows = results.flatMap((r) => r[0]);
    const socialRows = results.flatMap((r) => r[1]);

    const keep = (t: { id_task: number | null; id_client: number | null } & Parameters<typeof isOpenWork>[0]) =>
      t.id_task != null && isOpenWork(t) && !(t.id_client != null && excludedIds.has(t.id_client));
    const content = contentRows.filter(keep);
    const social = socialRows.filter(keep);

    // Retool's "Created" column is the CONTENT's creation date, not the task's:
    // a revision step opened today on a brief from August reads as August.
    const contentIds = Array.from(
      new Set([...content, ...social].map((t) => t.id_content).filter(Boolean))
    ) as number[];
    const contentCreated: Record<number, string | null> = {};
    const lookups: Promise<void>[] = [];
    for (let i = 0; i < contentIds.length; i += 200) {
      const slice = contentIds.slice(i, i + 200);
      lookups.push(
        (async () => {
          const { data, error } = await supabase
            .from("app_content")
            .select("id_content, date_created")
            .in("id_content", slice);
          if (error) throw error;
          for (const c of data || []) contentCreated[c.id_content] = c.date_created || null;
        })()
      );
    }
    await Promise.all(lookups);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toRow = (t: any, source: "content" | "social") => ({
      taskId: `${source}-${t.id_task}`,
      source,
      contentId: t.id_content ? String(t.id_content) : null,
      socialId: source === "social" && t.id_social ? String(t.id_social) : null,
      taskTitle: t.type_task || "Task",
      taskCUs: Number(t.units_content) || 0,
      deadline: t.date_deadline ? String(t.date_deadline).slice(0, 10) : null,
      // The Engine marks the step being worked on now; a task that is not
      // current is queued behind an earlier step on the same content.
      active: String(t.flag_task_current) === "1",
      contentCreatedAt: (t.id_content && contentCreated[t.id_content]) || null,
      contentTitle:
        source === "social"
          ? t.name_content || t.name_social || "Social promo"
          : t.name_content || "Untitled",
      contentType: source === "social" ? "social promo" : t.type_content || "unknown",
      network: source === "social" ? t.network || null : null,
      customerId: t.id_client ? String(t.id_client) : null,
      customerName: t.name_client || "Unknown",
      internal: t.id_client === 1,
      assigneeId: String(t.id_user_assignee),
      assigneeName: t.name_user_assignee || "Unknown",
    });

    const tasks = [
      ...content.map((t) => toRow(t, "content")),
      ...social.map((t) => toRow(t, "social")),
    ];
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Team workload GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
