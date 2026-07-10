"use client";

/**
 * EngineAI Live — second-screen meeting copilot (companion window).
 *
 * "An assistant, not a recorder": audio streams to STT and is never stored;
 * the transcript lives ONLY in this window's memory (mirrored to
 * sessionStorage as a crash buffer) and is discarded at meeting end after
 * the human-reviewed digest is saved. See the consent gate below — capture
 * cannot start without a logged attestation.
 *
 * Pipeline: getUserMedia (RAW — echoCancellation/noiseSuppression OFF, the
 * far side coming out of the speakers IS the signal) → AudioWorklet
 * (pcm16-worklet.js, render-thread = no background throttling) → 16kHz
 * PCM16 binary frames → AssemblyAI Universal-Streaming WS (browser-direct,
 * server-minted 60s token) → immutable turns → in-memory utterance store.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic, Pause, Play, Square, Radio, Loader2, AlertTriangle, Copy, Check,
  ExternalLink, Trash2, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/contexts/WorkspaceContext";
import { useCustomer } from "@/lib/contexts/CustomerContext";

/* ─────────────── Types & constants ─────────────── */

type Stage = "setup" | "live" | "review" | "saved";
type CaptureState = "idle" | "connecting" | "listening" | "paused" | "error";

interface Utterance {
  idx: number;
  speaker: string | null;
  text: string;
  tsStartMs: number;
  tsEndMs: number;
}

const CRASH_BUFFER_KEY = "engineai-live-crash-buffer";
const DEVICE_KEY = "engineai-live-mic-device";
const SESSION_CAP_MS = 3 * 60 * 60 * 1000; // 3h absolute cap
const STILL_HERE_PROMPT_MS = 2 * 60 * 60 * 1000; // 2h "still in a meeting?"
const CALENDAR_SNIPPET =
  "Note: this meeting uses a live transcription assistant (EngineAI Live) so we can skip note-taking. No audio is recorded and no transcript is kept — only a reviewed summary of decisions and action items. Happy to switch it off on request.";
const VERBAL_SNIPPET =
  "Quick note before we start — I use a live assistant that transcribes our conversation so I don't take notes. Nothing is recorded or kept, just the action items. All good?";

/* ─────────────── Page ─────────────── */

export default function MeetingLivePage() {
  const { selectedWorkspace } = useWorkspace();
  const { customers } = useCustomer();

  const [stage, setStage] = useState<Stage>("setup");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [micSilent, setMicSilent] = useState(false);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [partial, setPartial] = useState("");

  // Setup form
  const [clientId, setClientId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState<"client_checkin" | "sales" | "general">("general");
  const [attested, setAttested] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [starting, setStarting] = useState(false);

  // Review
  const [draftDigest, setDraftDigest] = useState<any>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Session refs (imperative pipeline state)
  const sessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const wakeLockRef = useRef<any>(null);
  const pausedRef = useRef(false);
  const closingRef = useRef(false);
  const startedAtRef = useRef(0);
  const pausedAccumRef = useRef(0); // ms spent paused (excluded from billed duration)
  const pausedSinceRef = useRef<number | null>(null);
  const utterancesRef = useRef<Utterance[]>([]);
  const utteranceIdxRef = useRef(0);
  const silentFramesRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const wakeBcRef = useRef<BroadcastChannel | null>(null);
  const capPromptedRef = useRef(false);

  // Optional ?client= prefill from the opener
  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("client");
      if (c) setClientId(c);
    } catch { /* noop */ }
  }, []);

  /* ─────────────── Device enumeration ─────────────── */

  useEffect(() => {
    (async () => {
      try {
        // Prime permission so labels populate
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        const mics = list
          .filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "communications")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
        setDevices(mics);
        const saved = localStorage.getItem(DEVICE_KEY);
        if (saved && mics.some((m) => m.deviceId === saved)) setDeviceId(saved);
        else if (mics[0]) setDeviceId(mics[0].deviceId);
      } catch {
        setStatusDetail("Microphone access is required for EngineAI Live");
      }
    })();
  }, []);

  /* ─────────────── Crash-buffer recovery ─────────────── */

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CRASH_BUFFER_KEY);
      if (raw) {
        const buf = JSON.parse(raw);
        if (buf?.utterances?.length > 2 && buf.sessionId) {
          utterancesRef.current = buf.utterances;
          utteranceIdxRef.current = buf.utterances.length;
          sessionIdRef.current = buf.sessionId;
          setUtterances(buf.utterances);
          setTitle(buf.title || "");
          setStage("review");
          setStatusDetail("Recovered from an interrupted session — review and save or discard.");
          void generateDigest(buf.sessionId, buf.utterances, buf.elapsedSeconds || 0);
        } else {
          sessionStorage.removeItem(CRASH_BUFFER_KEY);
        }
      }
    } catch {
      sessionStorage.removeItem(CRASH_BUFFER_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─────────────── Capture pipeline ─────────────── */

  const connectSTT = useCallback(async (sessionId: string): Promise<WebSocket> => {
    const tokRes = await fetch("/api/ai/meeting/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!tokRes.ok) {
      const err = await tokRes.json().catch(() => ({}));
      throw new Error(err.error || "Could not start live transcription");
    }
    const { token, wsUrl, sampleRate } = await tokRes.json();
    const ws = new WebSocket(
      `${wsUrl}?sample_rate=${sampleRate}&format_turns=true&token=${encodeURIComponent(token)}`
    );
    ws.binaryType = "arraybuffer";

    ws.onmessage = (evt) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
      } catch {
        return;
      }
      if (msg.type === "Turn") {
        const text = (msg.transcript || "").trim();
        if (!text) return;
        if (msg.end_of_turn) {
          setPartial("");
          const words = msg.words || [];
          const u: Utterance = {
            idx: utteranceIdxRef.current++,
            speaker: words[0]?.speaker ?? null,
            text,
            tsStartMs: words[0]?.start ?? Date.now() - startedAtRef.current,
            tsEndMs: words[words.length - 1]?.end ?? Date.now() - startedAtRef.current,
          };
          utterancesRef.current = [...utterancesRef.current, u];
          setUtterances(utterancesRef.current);
          // Crash buffer (local-only, cleared on end/discard)
          try {
            sessionStorage.setItem(
              CRASH_BUFFER_KEY,
              JSON.stringify({
                sessionId: sessionIdRef.current,
                title,
                utterances: utterancesRef.current.slice(-800),
                elapsedSeconds: Math.round((Date.now() - startedAtRef.current - pausedAccumRef.current) / 1000),
              })
            );
          } catch { /* quota — fine, best-effort */ }
        } else {
          setPartial(text.slice(-160));
        }
      }
    };

    ws.onclose = () => {
      if (closingRef.current || pausedRef.current) return;
      // Unexpected close mid-capture → re-mint + reconnect with backoff
      const attempt = reconnectAttemptsRef.current++;
      if (attempt >= 3) {
        setCaptureState("error");
        setStatusDetail("Lost connection to live transcription");
        return;
      }
      const delay = [500, 1000, 2000][attempt] || 2000;
      setTimeout(async () => {
        if (closingRef.current || !sessionIdRef.current) return;
        try {
          const next = await connectSTT(sessionIdRef.current);
          wsRef.current = next;
          reconnectAttemptsRef.current = 0;
          setCaptureState("listening");
          setStatusDetail("");
        } catch {
          setCaptureState("error");
          setStatusDetail("Lost connection to live transcription");
        }
      }, delay);
    };

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Transcription connection timed out")), 8000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error("Transcription connection failed")); };
    });
    return ws;
  }, [title]);

  const startCapture = useCallback(async (sessionId: string) => {
    setCaptureState("connecting");

    // RAW mic — echo cancellation would subtract the far side (the signal)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    streamRef.current = stream;

    const ctx = new AudioContext(); // native rate; worklet resamples to 16k
    ctxRef.current = ctx;
    await ctx.audioWorklet.addModule("/audio/pcm16-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm16-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    nodeRef.current = node;

    node.port.onmessage = (e) => {
      const { pcm, rms } = e.data as { pcm: Int16Array; rms: number };
      setLevel(Math.min(1, rms * 6));
      // Silent-mic diagnostic: pure digital zero = muted/dead device
      if (rms < 1e-5) {
        if (++silentFramesRef.current === 100) setMicSilent(true); // ~5s
      } else {
        silentFramesRef.current = 0;
        setMicSilent(false);
      }
      if (pausedRef.current) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm.buffer);
      }
    };
    source.connect(node);

    const ws = await connectSTT(sessionId);
    wsRef.current = ws;

    // Keep the screen awake for the meeting
    try {
      wakeLockRef.current = await (navigator as any).wakeLock?.request("screen");
    } catch { /* unsupported — fine */ }

    startedAtRef.current = Date.now();
    setCaptureState("listening");
  }, [connectSTT, deviceId]);

  const teardownCapture = useCallback((opts?: { keepState?: boolean }) => {
    closingRef.current = true;
    try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    try { nodeRef.current?.port.close(); nodeRef.current?.disconnect(); } catch { /* noop */ }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => { /* noop */ });
    ctxRef.current = null;
    try { wakeLockRef.current?.release(); } catch { /* noop */ }
    wakeLockRef.current = null;
    if (!opts?.keepState) setCaptureState("idle");
  }, []);

  // Re-acquire wakeLock when window becomes visible again
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === "visible" && captureState === "listening" && !wakeLockRef.current) {
        try { wakeLockRef.current = await (navigator as any).wakeLock?.request("screen"); } catch { /* noop */ }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [captureState]);

  /* ─────────────── Session lifecycle ─────────────── */

  const billedSeconds = useCallback(() => {
    const pausedNow = pausedSinceRef.current ? Date.now() - pausedSinceRef.current : 0;
    return Math.max(0, Math.round((Date.now() - startedAtRef.current - pausedAccumRef.current - pausedNow) / 1000));
  }, []);

  const handleStart = async () => {
    if (!selectedWorkspace) return;
    if (!attested) {
      toast.error("Please confirm participants have been informed");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/ai/meeting/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: selectedWorkspace.id,
          clientId: clientId || null,
          title: title || (clientId ? `Meeting — ${customers.find((c) => c.id === clientId)?.name || "client"}` : "Live meeting"),
          meetingType,
          consent: { attested: true, method: "verbal" },
          captureDevice: devices.find((d) => d.deviceId === deviceId)?.label || "default",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not start session");
      }
      const { sessionId, conversationId: convId } = await res.json();
      sessionIdRef.current = sessionId;
      setConversationId(convId);
      localStorage.setItem(DEVICE_KEY, deviceId);
      closingRef.current = false;
      pausedRef.current = false;
      pausedAccumRef.current = 0;
      utterancesRef.current = [];
      utteranceIdxRef.current = 0;
      setUtterances([]);
      await startCapture(sessionId);
      setStage("live");

      // Claim the wake-mode channel so Orac disarms (mic contention), and
      // announce ourselves on the meeting channel (single-session lock).
      try {
        wakeBcRef.current = new BroadcastChannel("engineai-wake");
        wakeBcRef.current.postMessage({ type: "claim", tab: `live-${sessionId}` });
        bcRef.current = new BroadcastChannel("engineai-meeting");
        bcRef.current.postMessage({ type: "session-started", sessionId });
      } catch { /* noop */ }
    } catch (err: any) {
      teardownCapture();
      toast.error(err.message || "Could not start EngineAI Live");
    } finally {
      setStarting(false);
    }
  };

  const togglePause = () => {
    if (captureState === "listening") {
      pausedRef.current = true;
      pausedSinceRef.current = Date.now();
      setCaptureState("paused");
      // Idle sockets bill — close after 60s paused; resume re-mints
      idleCloseTimerRef.current = setTimeout(() => {
        try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
        try { wsRef.current?.close(); } catch { /* noop */ }
        wsRef.current = null;
      }, 60_000);
    } else if (captureState === "paused") {
      if (idleCloseTimerRef.current) clearTimeout(idleCloseTimerRef.current);
      if (pausedSinceRef.current) {
        pausedAccumRef.current += Date.now() - pausedSinceRef.current;
        pausedSinceRef.current = null;
      }
      const resume = async () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          try {
            wsRef.current = await connectSTT(sessionIdRef.current!);
          } catch {
            setCaptureState("error");
            setStatusDetail("Could not resume transcription");
            return;
          }
        }
        pausedRef.current = false;
        setCaptureState("listening");
      };
      void resume();
    }
  };

  const generateDigest = async (sessionId: string, transcript: Utterance[], seconds: number) => {
    setDigestLoading(true);
    try {
      const res = await fetch("/api/ai/meeting/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          durationSeconds: seconds,
          transcript: transcript.map((u) => ({ speaker: u.speaker, text: u.text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.draftDigest) setDraftDigest(data.draftDigest);
      else if (!res.ok) toast.error(data.error || "Digest generation failed");
    } catch {
      toast.error("Digest generation failed");
    } finally {
      setDigestLoading(false);
    }
  };

  const handleEnd = async () => {
    const seconds = billedSeconds();
    teardownCapture({ keepState: true });
    setCaptureState("idle");
    setStage("review");
    try { bcRef.current?.postMessage({ type: "session-ended" }); } catch { /* noop */ }
    await generateDigest(sessionIdRef.current!, utterancesRef.current, seconds);
  };

  const handleSaveDigest = async () => {
    if (!sessionIdRef.current || !draftDigest?.summary) return;
    try {
      const res = await fetch("/api/ai/meeting/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, approveDigest: true, digest: draftDigest }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      // Discard the ephemeral transcript everywhere
      utterancesRef.current = [];
      setUtterances([]);
      sessionStorage.removeItem(CRASH_BUFFER_KEY);
      setStage("saved");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDiscard = async () => {
    if (!confirm("Discard everything from this meeting? Nothing will be saved.")) return;
    try {
      if (sessionIdRef.current) {
        await fetch("/api/ai/meeting/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, discard: true }),
        });
      }
    } catch { /* best-effort */ }
    utterancesRef.current = [];
    setUtterances([]);
    setDraftDigest(null);
    sessionStorage.removeItem(CRASH_BUFFER_KEY);
    teardownCapture();
    setStage("setup");
    setAttested(false);
    toast.success("Discarded — nothing was saved");
  };

  // Timer + session caps
  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      const runMs = Date.now() - startedAtRef.current;
      if (runMs > SESSION_CAP_MS) {
        void handleEnd();
      } else if (runMs > STILL_HERE_PROMPT_MS && !capPromptedRef.current) {
        capPromptedRef.current = true;
        toast("Still in a meeting? EngineAI Live has been running for 2 hours.", { duration: 30000 });
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Unload safety: terminate the socket; crash buffer already mirrors state
  useEffect(() => {
    const onUnload = () => {
      try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  useEffect(() => () => { teardownCapture(); bcRef.current?.close(); wakeBcRef.current?.close(); }, [teardownCapture]);

  /* ─────────────── Render ─────────────── */

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!selectedWorkspace) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading workspace…
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* ── Header: never scrolled away — the consent surface ── */}
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-card/60">
        <Radio className={cn("h-4 w-4", captureState === "listening" ? "text-amber-500 animate-pulse" : "text-muted-foreground/50")} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">
            {stage === "setup" ? "EngineAI Live" : title || "Live meeting"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {captureState === "listening" && <span className="text-amber-600 dark:text-amber-400 font-medium">Transcribing · nothing recorded</span>}
            {captureState === "paused" && <span className="text-muted-foreground font-medium">Paused — not listening</span>}
            {captureState === "connecting" && "Connecting…"}
            {captureState === "error" && <span className="text-red-500">{statusDetail || "Connection issue"}</span>}
            {captureState === "idle" && stage === "setup" && "An assistant, not a recorder"}
            {captureState === "idle" && stage !== "setup" && "Session ended"}
          </div>
        </div>
        {stage === "live" && (
          <>
            <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(elapsed)}</span>
            <button
              onClick={togglePause}
              className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-accent"
              title={captureState === "paused" ? "Resume" : "Pause (stops listening)"}
            >
              {captureState === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={handleEnd}
              className="h-8 px-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Square className="h-3 w-3" /> End
            </button>
          </>
        )}
      </header>

      {/* ── Mic level strip (live only) ── */}
      {stage === "live" && (
        <div className="shrink-0 h-1 bg-muted">
          <div
            className={cn("h-1 transition-[width] duration-100", micSilent ? "bg-red-500" : "bg-emerald-500")}
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      )}
      {stage === "live" && micSilent && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-[11px] bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3 w-3" /> Mic appears silent — check the input device / hardware mute
        </div>
      )}

      {/* ── Body ── */}
      <main className="flex-1 overflow-y-auto">
        {stage === "setup" && (
          <SetupScreen
            customers={customers}
            clientId={clientId} setClientId={setClientId}
            title={title} setTitle={setTitle}
            meetingType={meetingType} setMeetingType={setMeetingType}
            devices={devices} deviceId={deviceId} setDeviceId={setDeviceId}
            attested={attested} setAttested={setAttested}
            starting={starting}
            statusDetail={statusDetail}
            onStart={handleStart}
          />
        )}

        {stage === "live" && (
          <div className="p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Live transcript (in-memory only)</div>
            {utterances.length === 0 && !partial && (
              <p className="text-sm text-muted-foreground/70 pt-8 text-center">
                Listening… speech appears here as it&apos;s heard.
              </p>
            )}
            <div className="space-y-1.5">
              {utterances.slice(-50).map((u) => (
                <p key={u.idx} className="text-sm leading-snug">
                  {u.speaker && <span className="text-[10px] font-semibold text-muted-foreground mr-1.5 align-middle">{u.speaker}</span>}
                  {u.text}
                </p>
              ))}
              {partial && <p className="text-sm leading-snug text-muted-foreground/60 italic">{partial}</p>}
            </div>
            <TranscriptAutoScroll dep={utterances.length + partial.length} />
          </div>
        )}

        {stage === "review" && (
          <ReviewScreen
            digest={draftDigest}
            setDigest={setDraftDigest}
            loading={digestLoading}
            utteranceCount={utterances.length}
            onSave={handleSaveDigest}
            onDiscard={handleDiscard}
            onRetry={() => sessionIdRef.current && generateDigest(sessionIdRef.current, utterancesRef.current, billedSeconds())}
          />
        )}

        {stage === "saved" && (
          <div className="p-6 text-center space-y-4">
            <Check className="h-10 w-10 text-emerald-500 mx-auto" />
            <div>
              <div className="font-semibold">Digest saved to the meeting thread</div>
              <p className="text-sm text-muted-foreground mt-1">
                The transcript was not kept — only your reviewed summary.
              </p>
            </div>
            {conversationId && (
              <a
                href={`/?thread=${conversationId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Open thread <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <div>
              <button
                onClick={() => { setStage("setup"); setAttested(false); setDraftDigest(null); setUtterances([]); }}
                className="mt-2 text-sm px-4 py-2 rounded-lg border hover:bg-accent"
              >
                New session
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─────────────── Setup / consent screen ─────────────── */

function SetupScreen(props: {
  customers: { id: string; name: string }[];
  clientId: string; setClientId: (v: string) => void;
  title: string; setTitle: (v: string) => void;
  meetingType: "client_checkin" | "sales" | "general"; setMeetingType: (v: any) => void;
  devices: { deviceId: string; label: string }[];
  deviceId: string; setDeviceId: (v: string) => void;
  attested: boolean; setAttested: (v: boolean) => void;
  starting: boolean;
  statusDetail: string;
  onStart: () => void;
}) {
  const [copied, setCopied] = useState<"cal" | "verbal" | null>(null);
  const copy = (which: "cal" | "verbal", text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="p-4 space-y-4 max-w-md mx-auto">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Client (optional)</span>
          <select
            value={props.clientId}
            onChange={(e) => props.setClientId(e.target.value)}
            className="mt-1 w-full h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">— No client / internal —</option>
            {props.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Meeting title</span>
          <input
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
            placeholder="e.g. Hiscox monthly check-in"
            className="mt-1 w-full h-9 rounded-lg border bg-background px-2 text-sm"
          />
        </label>

        <div className="flex gap-2">
          {([
            ["client_checkin", "Check-in"],
            ["sales", "Sales / pitch"],
            ["general", "General"],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => props.setMeetingType(val)}
              className={cn(
                "flex-1 h-8 rounded-lg border text-xs font-medium",
                props.meetingType === val ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Mic className="h-3 w-3" /> Microphone
          </span>
          <select
            value={props.deviceId}
            onChange={(e) => props.setDeviceId(e.target.value)}
            className="mt-1 w-full h-9 rounded-lg border bg-background px-2 text-sm"
          >
            {props.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          <span className="block mt-1 text-[10px] text-muted-foreground/70">
            Tip: with a speakerphone (e.g. Jabra) or laptop speakers the far side is heard through this mic. Headphones will hide the other participants.
          </span>
        </label>
      </div>

      {/* Disclosure helpers */}
      <div className="rounded-xl border p-3 space-y-2 bg-card/50">
        <div className="text-xs font-semibold">Tell your participants</div>
        <button
          onClick={() => copy("verbal", VERBAL_SNIPPET)}
          className="w-full text-left text-[11px] leading-snug text-muted-foreground rounded-lg border p-2 hover:bg-accent flex items-start gap-2"
        >
          {copied === "verbal" ? <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" /> : <Copy className="h-3 w-3 mt-0.5 shrink-0" />}
          <span>&ldquo;{VERBAL_SNIPPET}&rdquo;</span>
        </button>
        <button
          onClick={() => copy("cal", CALENDAR_SNIPPET)}
          className="w-full text-left text-[11px] leading-snug text-muted-foreground rounded-lg border p-2 hover:bg-accent flex items-start gap-2"
        >
          {copied === "cal" ? <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" /> : <Copy className="h-3 w-3 mt-0.5 shrink-0" />}
          <span>Calendar note: &ldquo;{CALENDAR_SNIPPET}&rdquo;</span>
        </button>
      </div>

      {/* Attestation gate — Start is disabled until checked; logged server-side */}
      <div className="rounded-xl border-2 border-amber-500/40 p-3 bg-amber-500/5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.attested}
            onChange={(e) => props.setAttested(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-snug">
            I confirm every participant in this meeting has been informed that a live
            transcription assistant is in use, and consents. <strong>No audio is recorded
            and no transcript is kept</strong> — only a summary I review and approve.
          </span>
        </label>
      </div>

      {props.statusDetail && (
        <p className="text-xs text-red-500">{props.statusDetail}</p>
      )}

      <button
        onClick={props.onStart}
        disabled={!props.attested || props.starting || props.devices.length === 0}
        className={cn(
          "w-full h-10 rounded-xl font-medium text-sm flex items-center justify-center gap-2",
          props.attested && !props.starting
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        )}
      >
        {props.starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
        Start listening
      </button>
    </div>
  );
}

/* ─────────────── Review screen ─────────────── */

function ReviewScreen(props: {
  digest: any;
  setDigest: (d: any) => void;
  loading: boolean;
  utteranceCount: number;
  onSave: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const [emailCopied, setEmailCopied] = useState(false);
  const d = props.digest;

  return (
    <div className="p-4 space-y-4 max-w-md mx-auto">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" /> Review before saving
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        The transcript ({props.utteranceCount} utterances) was processed in memory and will not be kept.
        Only what you approve below is saved to the team-visible meeting thread.
      </p>

      {props.loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating digest…
        </div>
      )}

      {!props.loading && !d && (
        <div className="text-center py-4 space-y-2">
          <p className="text-sm text-muted-foreground">No digest was generated.</p>
          <button onClick={props.onRetry} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-accent">
            Retry
          </button>
        </div>
      )}

      {d && (
        <>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Summary <span className="opacity-60">(AI-generated — edit freely)</span></span>
            <textarea
              value={d.summary || ""}
              onChange={(e) => props.setDigest({ ...d, summary: e.target.value })}
              rows={6}
              className="mt-1 w-full rounded-lg border bg-background p-2 text-sm leading-snug"
            />
          </label>

          {Array.isArray(d.action_items) && d.action_items.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Action items</span>
              <ul className="mt-1 space-y-1">
                {d.action_items.map((a: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      defaultChecked
                      onChange={(e) => {
                        if (!e.target.checked) {
                          props.setDigest({ ...d, action_items: d.action_items.filter((_: any, j: number) => j !== i) });
                        }
                      }}
                      className="mt-1"
                    />
                    <span>{a.item || String(a)}{a.owner ? <span className="text-muted-foreground"> — {a.owner}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.followup_email && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Follow-up draft</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(d.followup_email);
                    setEmailCopied(true);
                    setTimeout(() => setEmailCopied(false), 1500);
                  }}
                  className="text-[11px] flex items-center gap-1 text-primary hover:underline"
                >
                  {emailCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy
                </button>
              </div>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-card/50 p-2 text-[11px] leading-snug max-h-40 overflow-y-auto">{d.followup_email}</pre>
            </div>
          )}
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={props.onSave}
          disabled={!d?.summary}
          className={cn(
            "flex-1 h-10 rounded-xl text-sm font-medium",
            d?.summary ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          Save digest to thread
        </button>
        <button
          onClick={props.onDiscard}
          className="h-10 px-3 rounded-xl border text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" /> Discard
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Auto-scroll helper ─────────────── */

function TranscriptAutoScroll({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dep]);
  return <div ref={ref} />;
}
