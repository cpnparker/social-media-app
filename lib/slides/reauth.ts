/**
 * Which slide failures are a connection the user can fix, and which are faults.
 *
 * Shared by the chat layer and the capability endpoint so the two cannot
 * disagree about what deserves a reconnect button. A genuine API fault must
 * never render as "reconnect Google" — that sends the user round a loop that
 * cannot help them.
 */
import type { SlidesAuthFailure } from "@/lib/slides/token";

export const GOOGLE_CONNECT_URL = "/api/connections/google/start";

/** `refresh_failed` counts: a revoked or expired grant is fixed by reconnecting.
 *  `not_configured` does not — that is a deployment problem, not the user's, and
 *  neither does `unavailable`, which means we could not reach the grant store:
 *  reconnecting a working account cannot fix a database blip. */
const FIXABLE: SlidesAuthFailure[] = ["needs_reconnect", "not_connected", "refresh_failed"];

/** Not fixable by reconnecting, but not the end of the road either.
 *
 *  `unavailable` used to end the conversation: a sentence saying "try again in
 *  a moment" and nothing to press. A real user sat in that state for a day —
 *  the underlying fault meant "later" was never going to work, and because the
 *  message was prose rather than a control, nothing brought her back. Whatever
 *  the cause, the user should always be left holding an action. */
const RETRYABLE: SlidesAuthFailure[] = ["unavailable"];

export function isReconnectable(reason?: string | null): reason is SlidesAuthFailure {
  return !!reason && FIXABLE.includes(reason as SlidesAuthFailure);
}

export function isRetryable(reason?: string | null): reason is SlidesAuthFailure {
  return !!reason && RETRYABLE.includes(reason as SlidesAuthFailure);
}

/** Every failure the user can do something about — the ones that get a card
 *  rather than a toast. Kept as one function so the chat path and the publish
 *  button cannot disagree about which failures are actionable. */
export function isActionable(reason?: string | null): boolean {
  return isReconnectable(reason) || isRetryable(reason);
}

/** Label for the button. "Reconnect" is wrong for someone who never connected. */
export function reconnectLabel(reason?: string | null): string {
  return reason === "not_connected" ? "Connect Google" : "Reconnect Google";
}
