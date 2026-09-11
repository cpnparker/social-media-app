import { supabase } from "@/lib/supabase";

/**
 * Looking a user up by email address, correctly.
 *
 * Two things make this a shared helper rather than an inline `.eq()`:
 *
 * 1. `eq` is case-sensitive, and 87 of 712 live rows have uppercase in
 *    email_user (Claire@thecontentengine.com, Harry.S.Leff@marsh.com). Every
 *    `.eq("email_user", …)` against the lowercase form returned zero rows —
 *    silently, as "no such user".
 * 2. We cannot fix that with `ilike` alone: ILIKE treats `_` as a
 *    single-character wildcard, and four production users have underscores in
 *    their address (…@genevaassociation.org). Verified live:
 *    ilike('chri_@thecontentengine.com') matches chris@thecontentengine.com.
 *    On the sign-in path that is an account-takeover primitive, not a typo.
 *
 * So `ilike` is only ever a coarse pre-filter and emailsMatch does the real
 * comparison. Never resolve an identity from the ilike result alone.
 */

/**
 * Rows the coarse `ilike` filter may return before we match exactly in JS.
 *
 * Must be > 1. Ten is ample: over-matching only happens for addresses
 * containing `_`, and the widened pattern still pins every other character
 * and the whole domain.
 */
const MATCH_LIMIT = 10;

export function normaliseEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Exact, case-insensitive email equality. */
export function emailsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normaliseEmail(a);
  return na.length > 0 && na === normaliseEmail(b);
}

/**
 * Find the live (non-deleted) user whose email is `email`, ignoring case.
 * Returns null when there is no such user.
 *
 * `columns` is passed through to `.select()`; email_user is always fetched
 * alongside it because the exact comparison needs it.
 *
 * Throws on a query error. A failed lookup is not an absent user, and
 * conflating the two is how a real user gets a second account created for
 * them or loses their access flags.
 */
export async function findUserByEmail<T = any>(
  email: string | null | undefined,
  columns: string = "id_user,email_user"
): Promise<T | null> {
  const wanted = normaliseEmail(email);
  if (!wanted) return null;

  const select =
    columns.trim() === "*" || /\bemail_user\b/.test(columns)
      ? columns
      : `${columns},email_user`;

  const { data, error } = await supabase
    .from("users")
    .select(select)
    .ilike("email_user", wanted)
    .is("date_deleted", null)
    .limit(MATCH_LIMIT);

  if (error) {
    throw new Error(`User lookup by email failed: ${error.message}`);
  }
  if (!data?.length) return null;

  const match = (data as any[]).find((row) => emailsMatch(row.email_user, wanted));
  return (match as T) ?? null;
}

/** Convenience for the many call sites that only need the id. */
export async function findUserIdByEmail(
  email: string | null | undefined
): Promise<number | null> {
  const user = await findUserByEmail<{ id_user: number }>(email, "id_user");
  return user ? user.id_user : null;
}
