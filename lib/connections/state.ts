import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed OAuth state, shared by every connect flow EngineAI runs.
 *
 * The state carries the origin the flow started on and the user it was started
 * for, HMAC-signed with NEXTAUTH_SECRET. Binding the user id is the part that
 * matters: without it a callback URL could be completed in a different browser
 * session and attach one person's Google/Slack/Microsoft grant to whoever
 * happened to be signed in there.
 *
 * Same construction as the Xero connect flow already in this repo.
 */

export interface ConnectState {
  /** Engine user id the flow was started by. */
  u: number;
  /** Their email at start time, lowercased. */
  e: string;
  /** Origin the flow began on — the callback must be built from the same host,
   *  because providers compare redirect URIs as exact strings. */
  o: string;
  /** Millisecond timestamp, for expiry. */
  t: number;
}

export function signState(payload: ConnectState): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): ConnectState | null {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as ConnectState;
  } catch {
    return null;
  }
}

/** 10 minutes: generous for a consent screen, short enough that a callback URL
 *  sitting in browser history or a proxy log is not a standing credential. */
export const STATE_MAX_AGE_MS = 10 * 60_000;

export function stateIsStale(s: ConnectState): boolean {
  return typeof s.t === "number" && Date.now() - s.t > STATE_MAX_AGE_MS;
}
