"use client";

/**
 * EngineAI Live — Phase 0 capture-validation spike.
 *
 * Purpose: answer the #1 build risk BEFORE the real feature is trusted —
 * does the chosen mic hear the FAR SIDE of a call? (Speakerphones like the
 * Jabra run hardware echo-cancellation and may subtract the far-side audio
 * they play from their own mic feed.)
 *
 * Test matrix (run during a real Meet/Teams call, or with a second device
 * playing speech):
 *   A. Jabra mic + Jabra speaker      ← the at-risk config
 *   B. Laptop mic + Jabra speaker     ← fallback 1
 *   C. Laptop mic + laptop speaker    ← control
 * Pass: far-side utterances appear in the live transcript with usable
 * accuracy. Whichever config wins becomes the device-picker default.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CaptureSpikePage() {
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [level, setLevel] = useState(0);
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        const mics = list
          .filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "communications")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
        setDevices(mics);
        if (mics[0]) setDeviceId(mics[0].deviceId);
      } catch {
        setError("Mic permission is required");
      }
    })();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    try { nodeRef.current?.disconnect(); } catch { /* noop */ }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => { /* noop */ });
    ctxRef.current = null;
    setRunning(false);
  };

  const start = async () => {
    setError("");
    setFinals([]);
    setPartial("");
    setConnecting(true);
    try {
      const tokRes = await fetch("/api/ai/meeting/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spike: true }),
      });
      if (!tokRes.ok) {
        const err = await tokRes.json().catch(() => ({}));
        throw new Error(err.error || `Token mint failed (${tokRes.status})`);
      }
      const { token, wsUrl, sampleRate } = await tokRes.json();

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

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio/pcm16-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm16-worklet", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      nodeRef.current = node;

      const ws = new WebSocket(
        `${wsUrl}?sample_rate=${sampleRate}&format_turns=true&token=${encodeURIComponent(token)}`
      );
      ws.binaryType = "arraybuffer";
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
          if (msg.type === "Turn") {
            const text = (msg.transcript || "").trim();
            if (!text) return;
            if (msg.end_of_turn) {
              setPartial("");
              setFinals((prev) => [...prev.slice(-30), text]);
            } else {
              setPartial(text.slice(-160));
            }
          }
        } catch { /* noop */ }
      };
      ws.onclose = () => setRunning(false);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("STT connection timed out")), 8000);
        ws.onopen = () => { clearTimeout(t); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("STT connection failed")); };
      });
      wsRef.current = ws;

      node.port.onmessage = (e) => {
        const { pcm, rms } = e.data as { pcm: Int16Array; rms: number };
        setLevel(Math.min(1, rms * 6));
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer);
      };
      source.connect(node);
      setRunning(true);
    } catch (err: any) {
      setError(err.message || "Spike failed to start");
      stop();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-semibold">EngineAI Live — capture spike</h1>
      <p className="text-xs text-muted-foreground leading-snug">
        Validates far-side capture per mic. Run during a real call (or play speech from another
        device) and check whether the OTHER person&apos;s words appear below. Test each mic; the winner
        becomes the default. Raw capture (no echo cancellation) — exactly what the real feature uses.
      </p>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Mic className="h-3 w-3" /> Microphone</span>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={running}
          className="mt-1 w-full h-9 rounded-lg border bg-background px-2 text-sm"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </label>

      <div className="h-2 rounded bg-muted overflow-hidden">
        <div className="h-2 bg-emerald-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>

      <button
        onClick={running ? stop : start}
        disabled={connecting || devices.length === 0}
        className={cn(
          "w-full h-10 rounded-xl text-sm font-medium flex items-center justify-center gap-2",
          running ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"
        )}
      >
        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {running ? "Stop" : "Start test"}
      </button>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="rounded-xl border p-3 min-h-40 space-y-1.5">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Live transcript</div>
        {finals.map((t, i) => (
          <p key={i} className="text-sm leading-snug">{t}</p>
        ))}
        {partial && <p className="text-sm leading-snug text-muted-foreground/60 italic">{partial}</p>}
        {finals.length === 0 && !partial && (
          <p className="text-sm text-muted-foreground/50">Nothing yet…</p>
        )}
      </div>
    </div>
  );
}
