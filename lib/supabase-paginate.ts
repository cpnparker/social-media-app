// Fetch a COMPLETE result set from Supabase/PostgREST by paginating with
// .range(), instead of relying on a single response.
//
// Why this exists: a single PostgREST response is bounded by the server's
// `db-max-rows` setting, and any explicit `.limit(n)` hard-caps the result.
// Several operations routes used `.limit(5000)` on the big task views and
// silently dropped every row beyond 5000 (e.g. a one-year view of
// app_tasks_content is ~15k rows), which understated the CU totals.
//
// IMPORTANT: pass a builder that orders by a UNIQUE column (e.g. id_task).
// .range() pagination over a non-unique sort (date_created/date_deadline have
// large clusters of identical values) has no stable order across pages, so
// rows get duplicated or skipped at page boundaries.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: (start: number, end: number) => PromiseLike<{ data: any[] | null; error: any }>,
  pageSize = 1000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  let start = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  for (;;) {
    const { data, error } = await buildQuery(start, start + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    start += pageSize;
  }
  return all;
}
