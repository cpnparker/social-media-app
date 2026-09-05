"use client";

/**
 * Orac voice enrollment — teach the wake word YOUR voice.
 *
 * Flow: 3 takes of "Orac" → 1 decoy word (negative calibration) → auto
 * threshold from the measured similarity gap → LIVE TEST with a score meter
 * so the user sees real numbers before saving.
 *
 * Privacy: everything stays on this device. Only MFCC fingerprints are
 * stored (localStorage) — raw audio is discarded immediately after
 * feature extraction.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Check, RefreshCw, ShieldCheck, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { extractFeatures, dtwSimilarity, trimSilence, type WakeTemplate } from "@/lib/voice/mel";
import { saveEnrollment, MIN_THRESHOLD } from "@/lib/voice/wake-templates";
import type { WakeDetector } from "@/lib/voice/wake-detector";

const TAKES = 3;
const MIN_SECONDS = 0.3;
const MAX_SECONDS = 2.2;

type Step = "intro" | "takes" | "decoy" | "test";

interface WakeEnrollmentProps {
  open: boolean;
  /** saved=true → templates persisted and active */
  onClose: (saved: boolean) => void;
  detector: WakeDetector;
  /** Detector readiness — capture only works once it's listening */
  detectorReady: boolean;
}

export default function WakeEnrollment({ open, onClose, detector, detectorReady }: WakeEnrollmentProps) {
  const [step, setStep] = useState<Step>("intro");
  const [takes, setTakes] = useState<WakeTemplate[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [threshold, setThreshold] = useState(0.78);
  const [gapWarning, setGapWarning] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [heard, setHeard] = useState("");
  const [testHits, setTestHits] = useState(0);
  const decoyRef = useRef<WakeTemplate | null>(null);
  const cancelledRef = useRef(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      cancelledRef.current = false;
      setStep("intro");
      setTakes([]);
      setCapturing(false);
      setGapWarning(null);
      setLastScore(null);
      setHeard("");
      setTestHits(0);
      decoyRef.current = null;
    } else {
      cancelledRef.current = true;
    }
  }, [open]);

  // During the live test step, surface scores + heard text from the detector
  useEffect(() => {
    if (!open || step !== "test") return;
    detector.setTestMode(true);
    const origOpts = (detector as any).opts;
    const prevScore = origOpts.onMatchScore;
    const prevHeard = origOpts.onHeard;
    origOpts.onMatchScore = (score: number, thr: number) => {
      setLastScore(score);
      if (score >= thr) setTestHits((n) => n + 1);
      prevScore?.(score, thr);
    };
    origOpts.onHeard = (t: string) => {
      setHeard(t.slice(0, 60));
      prevHeard?.(t);
    };
    return () => {
      origOpts.onMatchScore = prevScore;
      origOpts.onHeard = prevHeard;
    };
  }, [open, step, detector]);

  const captureTake = useCallback(
    async (kind: "take" | "decoy") => {
      if (capturing || !detectorReady) return;
      setCapturing(true);
      try {
        const audio = await detector.captureUtterance();
        if (cancelledRef.current || !audio) return;
        // Trim silence BEFORE measuring/extracting — matching trims its
        // candidates the same way, so templates must be tight too.
        const trimmed = trimSilence(audio);
        const seconds = trimmed.length / 16000;
        if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
          toast.error(seconds < MIN_SECONDS ? "Too short — say it a touch slower" : "Too long — just the one word");
          return;
        }
        const features = extractFeatures(trimmed);
        if (features.frames < 12) {
          toast.error("Couldn't hear that clearly — try again");
          return;
        }
        if (kind === "decoy") {
          decoyRef.current = features;
          calibrate(takes, features);
        } else {
          const next = [...takes, features];
          setTakes(next);
          if (next.length >= TAKES) setStep("decoy");
        }
      } finally {
        setCapturing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capturing, detectorReady, takes, detector]
  );

  /** Threshold = midpoint of the measured gap between self-sims and the decoy. */
  const calibrate = (templates: WakeTemplate[], decoy: WakeTemplate) => {
    let minSelf = 1;
    for (let i = 0; i < templates.length; i++) {
      for (let j = 0; j < templates.length; j++) {
        if (i === j) continue;
        minSelf = Math.min(minSelf, dtwSimilarity(templates[i], templates[j]));
      }
    }
    let maxNeg = 0;
    for (const t of templates) maxNeg = Math.max(maxNeg, dtwSimilarity(t, decoy));

    // One decoy UNDERSAMPLES the negative world — ambient speech routinely
    // scores 0.57–0.65 against any template. The threshold therefore takes
    // the most conservative of: gap midpoint, decoy + margin, and the hard
    // floor. Better to miss occasionally than to fire on any sound.
    const gap = minSelf - maxNeg;
    let thr = Math.max((minSelf + maxNeg) / 2, maxNeg + 0.07, MIN_THRESHOLD);
    if (gap < 0.08 || thr > minSelf - 0.02) {
      thr = Math.max(minSelf - 0.03, MIN_THRESHOLD);
      setGapWarning(
        `Narrow margin (your "Orac" takes scored ${minSelf.toFixed(2)} vs ${maxNeg.toFixed(2)} for the other word). If it misses or false-wakes, redo enrollment — same pace and distance from the mic each take helps.`
      );
    } else {
      setGapWarning(null);
    }
    thr = Math.min(Math.max(thr, MIN_THRESHOLD), 0.92);
    setThreshold(thr);
    detector.setTemplates(templates, thr);
    setStep("test");
  };

  const handleSave = () => {
    if (!saveEnrollment(takes, threshold)) {
      toast.error("Couldn't save — browser storage may be full");
      return;
    }
    detector.setTemplates(takes, threshold);
    detector.setTestMode(false);
    onClose(true);
  };

  const handleRedo = () => {
    setTakes([]);
    decoyRef.current = null;
    setLastScore(null);
    setTestHits(0);
    setGapWarning(null);
    setStep("takes");
  };

  const scorePct = lastScore !== null ? Math.round(lastScore * 100) : null;
  const thrPct = Math.round(threshold * 100);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-emerald-500" />
            {step === "test" ? "Try it out" : "Teach Orac your voice"}
          </DialogTitle>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Orac learns the sound of <strong className="text-foreground">your</strong> voice saying its
              name — that&apos;s what makes detection reliable. You&apos;ll say{" "}
              <strong className="text-foreground">&ldquo;Orac&rdquo;</strong> three times, then one other
              word so it knows what <em>not</em> to react to.
            </p>
            <p className="text-xs flex items-start gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
              All of this stays on your device. Only acoustic fingerprints are kept — the audio itself
              is discarded immediately.
            </p>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => setStep("takes")} disabled={!detectorReady}>
                {detectorReady ? "Start" : <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Preparing…</>}
              </Button>
            </div>
          </div>
        )}

        {(step === "takes" || step === "decoy") && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <div
                className={cn(
                  "h-20 w-20 rounded-full flex items-center justify-center transition-all",
                  capturing ? "bg-emerald-500/20 scale-110" : "bg-muted"
                )}
              >
                <Mic className={cn("h-8 w-8", capturing ? "text-emerald-500 animate-pulse" : "text-muted-foreground")} />
              </div>
              <p className="text-lg font-semibold">
                {step === "takes" ? <>Say &ldquo;Orac&rdquo;</> : <>Now say a different word — try &ldquo;morning&rdquo;</>}
              </p>
              <p className="text-xs text-muted-foreground">
                {capturing ? "Listening — speak now" : "Press the button, then speak"}
              </p>
            </div>

            {/* Take progress */}
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: TAKES }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                    i < takes.length ? "bg-emerald-500 text-white border-emerald-500" : "text-muted-foreground"
                  )}
                >
                  {i < takes.length ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
              ))}
              <span className={cn(
                "h-6 px-2 rounded-full flex items-center text-[10px] font-bold border",
                step === "decoy" && decoyRef.current ? "bg-emerald-500 text-white border-emerald-500" : "text-muted-foreground"
              )}>
                decoy
              </span>
            </div>

            <div className="flex justify-center gap-2">
              <Button size="sm" onClick={() => captureTake(step === "decoy" ? "decoy" : "take")} disabled={capturing || !detectorReady}>
                {capturing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Mic className="h-3.5 w-3.5 mr-1.5" />}
                {capturing ? "Listening…" : step === "decoy" ? "Record decoy" : `Record take ${takes.length + 1}`}
              </Button>
              {takes.length > 0 && step === "takes" && (
                <Button size="sm" variant="ghost" onClick={() => setTakes(takes.slice(0, -1))} disabled={capturing}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Redo last
                </Button>
              )}
            </div>
          </div>
        )}

        {step === "test" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Say <strong className="text-foreground">&ldquo;Orac&rdquo;</strong> a few times — and a few
              other words. The bar shows the live match score; past the marker means it would wake.
            </p>

            {/* Live score meter */}
            <div className="space-y-1.5">
              <div className="relative h-5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-all duration-200",
                    scorePct !== null && scorePct >= thrPct ? "bg-emerald-500" : "bg-blue-400"
                  )}
                  style={{ width: `${scorePct ?? 0}%` }}
                />
                {/* Threshold marker */}
                <div className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${thrPct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>match: {scorePct !== null ? `${scorePct}%` : "—"}{heard ? ` · heard: “${heard}”` : ""}</span>
                <span>wakes at {thrPct}%</span>
              </div>
            </div>

            <div className={cn(
              "rounded-lg border px-3 py-2 text-sm text-center font-medium transition-colors",
              testHits > 0 ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            )}>
              {testHits > 0 ? `✓ Detected ${testHits} time${testHits === 1 ? "" : "s"}` : "No detections yet — try saying Orac"}
            </div>

            {gapWarning && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{gapWarning}</p>
            )}

            <div className="flex justify-between pt-1">
              <Button size="sm" variant="ghost" onClick={handleRedo}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Redo
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onClose(false)}>
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Save &amp; finish
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
