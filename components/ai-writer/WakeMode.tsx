"use client";

/**
 * Wake Phrase Mode — "Hey Engine".
 *
 * A self-contained floating control (bottom-right) that arms hands-free
 * voice activation:
 *
 *   disarmed → armed (LOCAL-ONLY wake listening, zero upload) → engaged
 *   (voice session) → auto-rearm when the session ends.
 *
 * Privacy: detection runs fully on-device (see lib/voice/wake-detector.ts).
 * First arm shows a consent modal stating exactly what is local vs uploaded.
 * Multi-tab safe: a BroadcastChannel lock ensures only one tab arms.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WakeDetector, type WakeDetectorState } from "@/lib/voice/wake-detector";

const PREF_KEY = "engineai-wake-armed";
const CONSENT_KEY = "engineai-wake-consent";

interface WakeModeProps {
  /** Called when the wake phrase fires — open the voice session. */
  onWake: () => void;
  /** True while a voice session is active — detection pauses, then rearms. */
  engaged: boolean;
}

export default function WakeMode({ onWake, engaged }: WakeModeProps) {
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<WakeDetectorState>("stopped");
  const [progress, setProgress] = useState(0);
  const [consentOpen, setConsentOpen] = useState(false);
  const [justWoke, setJustWoke] = useState(false);
  const [heard, setHeard] = useState("");
  const heardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectorRef = useRef<WakeDetector | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const armedRef = useRef(false);
  const engagedRef = useRef(false);
  engagedRef.current = engaged;

  const getDetector = useCallback(() => {
    if (!detectorRef.current) {
      detectorRef.current = new WakeDetector({
        onWake: () => {
          if (engagedRef.current) return;
          // Chime — two quick rising tones, then hand off to the session
          try {
            const ctx = new AudioContext();
            const beep = (freq: number, at: number) => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.frequency.value = freq;
              osc.type = "sine";
              gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
              gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
              osc.connect(gain).connect(ctx.destination);
              osc.start(ctx.currentTime + at);
              osc.stop(ctx.currentTime + at + 0.2);
            };
            beep(660, 0);
            beep(990, 0.12);
            setTimeout(() => ctx.close().catch(() => undefined), 600);
          } catch { /* chime is best-effort */ }
          setJustWoke(true);
          setTimeout(() => setJustWoke(false), 1500);
          // Pause local listening while the cloud session runs
          detectorRef.current?.stop();
          onWake();
        },
        onStateChange: (s, detail) => {
          setState(s);
          if (s === "error" && detail) toast.error(detail);
        },
        onProgress: setProgress,
        // Show what the local model heard — builds trust ("it IS listening")
        // and makes mis-transcriptions visible. Stays on-device.
        onHeard: (text) => {
          setHeard(text.slice(0, 60));
          if (heardTimerRef.current) clearTimeout(heardTimerRef.current);
          heardTimerRef.current = setTimeout(() => setHeard(""), 4000);
        },
      });
    }
    return detectorRef.current;
  }, [onWake]);

  const disarm = useCallback((persist = true) => {
    armedRef.current = false;
    setArmed(false);
    detectorRef.current?.stop();
    if (persist) try { localStorage.setItem(PREF_KEY, "0"); } catch { /* noop */ }
  }, []);

  const arm = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    try { localStorage.setItem(PREF_KEY, "1"); } catch { /* noop */ }
    // Claim the multi-tab lock — other tabs disarm
    channelRef.current?.postMessage({ type: "claim", tab: tabIdRef.current });
    if (!engagedRef.current) getDetector().start();
  }, [getDetector]);

  const handleToggle = () => {
    if (armed) {
      disarm();
      return;
    }
    let consented = false;
    try { consented = localStorage.getItem(CONSENT_KEY) === "1"; } catch { /* noop */ }
    if (!consented) setConsentOpen(true);
    else arm();
  };

  const handleConsent = () => {
    try { localStorage.setItem(CONSENT_KEY, "1"); } catch { /* noop */ }
    setConsentOpen(false);
    arm();
  };

  // Pause while engaged; rearm when the session ends
  useEffect(() => {
    if (!armedRef.current) return;
    if (engaged) {
      detectorRef.current?.stop();
    } else {
      getDetector().start();
    }
  }, [engaged, getDetector]);

  // Multi-tab lock + restore persisted preference
  useEffect(() => {
    const ch = new BroadcastChannel("engineai-wake");
    channelRef.current = ch;
    ch.onmessage = (e) => {
      if (e.data?.type === "claim" && e.data.tab !== tabIdRef.current && armedRef.current) {
        disarm(false); // another tab took over; don't clear the preference
        toast.info("Hey Engine moved to your other tab");
      }
    };
    let saved = false;
    try { saved = localStorage.getItem(PREF_KEY) === "1"; } catch { /* noop */ }
    if (saved) {
      // Re-arm silently on load (consent was already given to persist=1)
      armedRef.current = true;
      setArmed(true);
      ch.postMessage({ type: "claim", tab: tabIdRef.current });
      if (!engagedRef.current) getDetector().start();
    }
    return () => {
      detectorRef.current?.stop();
      ch.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listening = armed && state === "listening" && !engaged;
  const loading = armed && state === "loading";

  return (
    <>
      {/* Floating arm control — bottom-right, out of the chat's way */}
      <div className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-1.5">
        {/* Transient "heard:" readout — local-only diagnostics */}
        {listening && heard && (
          <div className="rounded-full bg-background/90 backdrop-blur border px-3 py-1 text-[11px] text-muted-foreground shadow-sm max-w-[260px] truncate">
            heard: &ldquo;{heard}&rdquo;
          </div>
        )}
        <button
          onClick={handleToggle}
          title={
            armed
              ? "Hey Engine is on — listening locally. Click to turn off."
              : 'Enable "Hey Engine" hands-free voice'
          }
          className={cn(
            "group flex items-center gap-2 rounded-full border shadow-lg pl-2.5 pr-3 py-2 text-xs font-medium transition-all",
            justWoke
              ? "bg-emerald-500 text-white border-emerald-400 scale-105"
              : listening
                ? "bg-background/95 backdrop-blur border-emerald-500/40 text-foreground"
                : loading
                  ? "bg-background/95 backdrop-blur text-muted-foreground"
                  : "bg-background/80 backdrop-blur text-muted-foreground/60 hover:text-foreground hover:border-foreground/20"
          )}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress > 0 && progress < 1
                ? `Preparing… ${Math.round(progress * 100)}%`
                : "Preparing…"}
            </>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5">
                {listening && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                )}
                <span
                  className={cn(
                    "relative inline-flex h-2.5 w-2.5 rounded-full",
                    justWoke ? "bg-white" : listening ? "bg-emerald-500" : engaged && armed ? "bg-violet-500" : "bg-muted-foreground/30"
                  )}
                />
              </span>
              <AudioLines className="h-3.5 w-3.5" />
              {justWoke ? "Yes?" : armed ? (engaged ? "In conversation" : "Hey Engine") : "Hey Engine — off"}
            </>
          )}
        </button>
      </div>

      {/* First-use consent — exactly what's local vs uploaded */}
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Enable &ldquo;Hey Engine&rdquo;
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              With this on, EngineAI listens for the phrase{" "}
              <strong className="text-foreground">&ldquo;Hey Engine&rdquo;</strong> so you can start a
              voice conversation hands-free.
            </p>
            <div className="rounded-lg border p-3 space-y-2 text-xs">
              <p className="flex gap-2">
                <span className="text-emerald-500 font-bold shrink-0">On this device</span>
                Listening happens entirely in your browser. Audio is checked for the wake
                phrase by a local model and immediately discarded — nothing is recorded,
                stored, or uploaded.
              </p>
              <p className="flex gap-2">
                <span className="text-violet-500 font-bold shrink-0">After you wake it</span>
                You&apos;ll hear a chime, then a normal voice conversation starts (audio streams
                to the AI, transcript saves to your chat). End it by saying
                &ldquo;OK, thanks&rdquo; — it goes back to local-only listening.
              </p>
            </div>
            <p className="text-xs">
              A pulsing indicator stays visible whenever listening is on. First use downloads
              a small speech model (~40&nbsp;MB, kept offline). Turn it off any time by
              clicking the indicator.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setConsentOpen(false)}>
              <X className="h-3.5 w-3.5 mr-1" />
              Not now
            </Button>
            <Button size="sm" onClick={handleConsent} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Enable
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
