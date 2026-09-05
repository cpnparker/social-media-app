"use client";

/**
 * The app's error boundary, and specifically a cure for the stale-tab crash.
 *
 * Next.js splits the client into content-hashed chunks and the CDN stops
 * serving the old ones after a deploy. A tab left open across a deploy is
 * therefore holding a build id that no longer exists: the moment it navigates
 * to a route whose chunk it has not already downloaded, the fetch 404s and
 * React unwinds to the root with "Application error: a client-side exception
 * has occurred". Nothing about the user's data is wrong and nothing on the
 * server failed — the founder hit this after an upload that had already
 * SUCCEEDED, with the session sitting in the database, which is the worst
 * version of it because the work looks lost and is not.
 *
 * There was no boundary here at all, so that message was the whole experience:
 * no explanation, no button, no way back except knowing to hard-refresh.
 *
 * A chunk failure is reloaded ONCE, automatically, because the fix is always
 * the same and asking someone to perform it is asking them to know why. The
 * once is enforced through sessionStorage with a timestamp: a genuine
 * server-side fault can also produce a chunk-shaped error, and a boundary that
 * reloads on every mount would put the tab in a refresh loop that is far worse
 * than the error it is treating.
 */

import { useEffect } from "react";

const RETRY_KEY = "engineai:chunk-reload-at";
const RETRY_WINDOW_MS = 30_000;

function looksLikeStaleBuild(error: Error): boolean {
  const name = String((error as any)?.name || "");
  const msg = String(error?.message || "");
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = looksLikeStaleBuild(error);

  useEffect(() => {
    if (!stale) return;
    try {
      const last = Number(window.sessionStorage.getItem(RETRY_KEY) || 0);
      if (Date.now() - last < RETRY_WINDOW_MS) return; // already tried; do not loop
      window.sessionStorage.setItem(RETRY_KEY, String(Date.now()));
      window.location.reload();
    } catch {
      /* private mode with no sessionStorage: fall through to the button */
    }
  }, [stale]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md flex flex-col gap-3 text-center">
        <h2 className="text-[17px] font-bold tracking-tight">
          {stale ? "Reloading — the app updated" : "Something broke on this page"}
        </h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {stale ? (
            <>
              A new version shipped while this tab was open, so it was holding code that no longer
              exists. Nothing you did was lost — anything already saved is safe. This should reload
              on its own.
            </>
          ) : (
            <>
              This page hit an error it could not recover from. Your saved work is unaffected.
            </>
          )}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => { try { window.sessionStorage.removeItem(RETRY_KEY); } catch {} window.location.reload(); }}
            className="text-[13px] font-medium rounded-lg bg-primary text-primary-foreground px-3.5 py-2"
          >
            Reload the page
          </button>
          <button
            onClick={reset}
            className="text-[13px] font-medium rounded-lg border px-3.5 py-2"
          >
            Try again
          </button>
        </div>
        {error?.digest && (
          <p className="text-[11px] text-muted-foreground/70">Reference {error.digest}</p>
        )}
      </div>
    </div>
  );
}
