"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isUsableRange, settleAction } from "@/lib/date-utils";

/**
 * The date range a page should actually query, given what is in its inputs.
 *
 * A native date input fires onChange on every segment typed, so the raw
 * values pass through garbage years, half-typed days and reversed ranges on
 * the way to what the user meant (see isCompleteDate). Fetching on each one
 * sent a dozen queries per range, and whichever answered LAST was drawn —
 * usually an all-time one, because those are the slowest.
 *
 * So the range only moves to values that make a usable range, and only once
 * typing has paused for `delayMs`. A change to BOTH ends in one render is a
 * preset or Clear, never typing (typing edits one field), and applies at once.
 * While the inputs hold something unusable the last good range stays, and
 * once they have held it for a moment `invalid` says so — the page is then
 * showing a range other than the one in the boxes, and should say which.
 *
 * Attach `fromRef` / `toRef` to the inputs: a half-typed field reads "", the
 * same as an emptied one, and only the element itself can tell them apart.
 * The element is read when the values change rather than remembered from its
 * last onChange, because a preset fills the box without firing one.
 */
export function useSettledDateRange(
  from: string,
  to: string,
  { delayMs = 400, requireBoth = false }: { delayMs?: number; requireBoth?: boolean } = {}
) {
  const [range, setRange] = useState(() =>
    isUsableRange(from, to, requireBoth) ? { from, to } : { from: "", to: "" }
  );
  const [invalid, setInvalid] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  // delayMs and requireBoth are fixed per page, so they are read once.
  const settler = useRef<RangeSettler | null>(null);
  if (!settler.current) {
    settler.current = createRangeSettler({
      delayMs,
      requireBoth,
      initial: { from, to },
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      onApply: (next) => setRange((r) => (r.from === next.from && r.to === next.to ? r : next)),
      onInvalid: setInvalid,
    });
  }

  useEffect(() => {
    const partial = !!(fromRef.current?.validity.badInput || toRef.current?.validity.badInput);
    settler.current!.update(from, to, partial);
  }, [from, to]);
  useEffect(() => () => settler.current?.dispose(), []);

  return { from: range.from, to: range.to, invalid, fromRef, toRef };
}

export type RangeSettler = ReturnType<typeof createRangeSettler>;

/**
 * The hook's timing, without React, so the check can drive the real thing on
 * a fake clock. `update` is called with the inputs after every change; one
 * pending timer at most, replaced by every update.
 */
export function createRangeSettler(opts: {
  delayMs: number;
  requireBoth: boolean;
  initial: { from: string; to: string };
  schedule: (fn: () => void, ms: number) => () => void;
  onApply: (range: { from: string; to: string }) => void;
  onInvalid: (invalid: boolean) => void;
  /** The decision; replaceable only so the check can hand it a broken one. */
  decide?: typeof settleAction;
}) {
  const decide = opts.decide ?? settleAction;
  let prev = { ...opts.initial };
  let cancel: (() => void) | null = null;
  const clear = () => {
    cancel?.();
    cancel = null;
  };
  return {
    update(from: string, to: string, partial: boolean) {
      clear();
      const action = decide(prev, from, to, opts.requireBoth, partial);
      prev = { from, to };
      if (action === "hold") {
        // Every keystroke in a year passes through unusable values, so only
        // report it once the inputs have STAYED unusable — otherwise the note
        // flickers on and off while someone types.
        cancel = opts.schedule(() => opts.onInvalid(true), opts.delayMs * 2);
        return;
      }
      opts.onInvalid(false);
      if (action === "apply") {
        opts.onApply({ from, to });
        return;
      }
      cancel = opts.schedule(() => opts.onApply({ from, to }), opts.delayMs);
    },
    dispose: clear,
  };
}

/**
 * Only the newest request may write state. Starting a request aborts the one
 * before it; `isCurrent()` is false for any request that has been superseded,
 * aborted, or outlived the component. Check it after every await and before
 * clearing a loading flag.
 */
export function createLatestRequest() {
  let seq = 0;
  let ctrl: AbortController | null = null;
  return {
    begin() {
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      const mine = ++seq;
      return { signal: c.signal, isCurrent: () => mine === seq && !c.signal.aborted };
    },
    abort() {
      ctrl?.abort();
    },
  };
}

export function useLatestRequest() {
  const latest = useRef<ReturnType<typeof createLatestRequest> | null>(null);
  if (!latest.current) latest.current = createLatestRequest();
  useEffect(() => () => latest.current?.abort(), []);
  return useCallback(() => latest.current!.begin(), []);
}
