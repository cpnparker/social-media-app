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
 *  `not_configured` does not — that is a deployment problem, not the user's. */
const FIXABLE: SlidesAuthFailure[] = ["needs_reconnect", "not_connected", "refresh_failed"];

export function isReconnectable(reason?: string | null): reason is SlidesAuthFailure {
  return !!reason && FIXABLE.includes(reason as SlidesAuthFailure);
}

/** Label for the button. "Reconnect" is wrong for someone who never connected. */
export function reconnectLabel(reason?: string | null): string {
  return reason === "not_connected" ? "Connect Google" : "Reconnect Google";
}
