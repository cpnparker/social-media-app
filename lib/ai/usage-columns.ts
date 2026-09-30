/**
 * A write that names a column the DEPLOYED schema does not have yet.
 *
 * The owner deploys the app and runs migrations separately, so there is a
 * window — sometimes a long one — where the code writes a column the table
 * lacks. PostgREST rejects that from its schema cache with PGRST204 and
 * Postgres with 42703, and both name the column, so the NAME is matched as well
 * as the code. A constraint failure, or a different column's error, must be
 * reported rather than swallowed as "the migration has not run".
 *
 * It matters here more than usual. A failed insert loses the WHOLE ai_usage
 * row, not just the new column, and that row is the measurement the column was
 * added to take: a turn is up to eight provider requests and this is the only
 * place the count is durable. Losing the row to protect a field that is itself
 * only there to measure would be an unusually complete own goal.
 *
 * Deliberately narrow in the other direction too. A predicate that answered
 * true for every error would turn a real failure — a null violation, a bad
 * workspace id — into a silent retry that drops the column and logs nothing,
 * which is the same class of fault as a check that asserts a line exists.
 */
export function isMissingColumnError(e: unknown, column: string): boolean {
  const err = e as { code?: string; message?: string } | null | undefined;
  if (!err || typeof err !== "object") return false;
  if (err.code !== "PGRST204" && err.code !== "42703") return false;
  return (err.message || "").indexOf(column) >= 0;
}
