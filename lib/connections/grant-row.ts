/**
 * Which stored Google grant a reconnect should overwrite.
 *
 * A user can hold more than one `provider: "google"` row. MeetingBrain's
 * NextAuth sign-in keys its row by the numeric Google subject; EngineAI's own
 * connect flow keys its own by email address; neither recognises the other, so
 * connecting through both leaves two rows describing one Google account.
 *
 * The connect callback used to write the fresh grant onto ALL of them at once.
 * That sets the same `provider_account_id` on two rows, and the table carries a
 * unique constraint on (provider, provider_account_id), so the write failed:
 *
 *     duplicate key value violates unique constraint
 *     "account_provider_provider_account_id_key"
 *
 * which the user saw as "something went wrong" on the final page of Google's
 * consent flow. The same duplicate also broke slide export. So the one action
 * offered to fix the export was itself blocked by the cause of the export
 * failure, and there was no way out from inside the product.
 *
 * Picking one row by identity removes the collision by construction rather than
 * by hoping the duplicate never happens.
 */

import type { AccountRow } from "@/lib/slides/token";

type Row = AccountRow & { provider_account_id?: string | null };

export function chooseGrantRow(rows: Row[] | null | undefined, incomingAccountId: string): Row | null {
  const all = (rows || []).filter(Boolean);
  if (!all.length) return null;

  // The row that already IS this Google account. Updating it cannot collide,
  // because the value it would be given is the one it already holds.
  const exact = all.find((r) => r.provider_account_id === incomingAccountId);
  if (exact) return exact;

  // No row claims this account id, so the id is free and any single row may
  // take it. Prefer the one a reader would have picked anyway — same ranking as
  // the export path — so a reconnect refreshes the grant actually in use rather
  // than a stale sibling that then loses the coin-flip.
  let best = all[0];
  for (let i = 1; i < all.length; i++) {
    const r = all[i];
    const score = (x: Row) => (x.refresh_token ? 2 : 0) + (x.access_token ? 1 : 0);
    const d = score(r) - score(best);
    if (d > 0 || (d === 0 && (r.expires_at || 0) > (best.expires_at || 0))) best = r;
  }
  return best;
}
