"use client";

/**
 * EngineAI Voice — full-screen immersive voice conversation.
 *
 * Browser ↔ xAI Grok Voice Agent API (OpenAI Realtime-spec) over WebSocket
 * with an ephemeral token. Audio is PCM16 @ 24kHz both directions.
 *
 * Naturalness engineering:
 * - Mic uses browser echo cancellation + noise suppression so the model never
 *   hears itself — the mic stays HOT the entire session (full duplex).
 * - server_vad turn detection: the model decides when you've finished a thought.
 * - Hard barge-in: the moment your speech is detected, all locally queued
 *   playback is flushed (<50ms) — it stops talking like a person would.
 * - Tool calls run server-side; the model speaks an acknowledgment first so
 *   silence never feels dead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Database, Brain, ListChecks, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type VoiceStatus = "connecting" | "listening" | "thinking" | "speaking" | "error";

interface VoiceOverlayProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  workspaceId: string;
  customerId?: string | null;
  /** Called after transcript turns are persisted so the chat thread can refresh */
  onTranscriptSaved?: () => void;
}

const TOOL_LABELS: Record<string, { label: string; Icon: typeof Database }> = {
  query_engine: { label: "Checking the Engine", Icon: Database },
  lookup_client_context: { label: "Pulling client profile", Icon: Database },
  search_memory: { label: "Searching memories", Icon: Brain },
  query_meetingbrain: { label: "Checking meetings", Icon: ListChecks },
  query_slack: { label: "Checking Slack", Icon: MessageSquare },
  consult_analyst: { label: "Consulting the analyst", Icon: Sparkles },
};

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function float32ToBase64Pcm16(f32: Float32Array): string {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

export default function VoiceOverlay({
  open,
  onClose,
  conversationId,
  workspaceId,
  customerId,
  onTranscriptSaved,
}: VoiceOverlayProps) {
  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [muted, setMuted] = useState(false);
  const [caption, setCaption] = useState("");
  const [userCaption, setUserCaption] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playCursorRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef(false);
  const statusRef = useRef<VoiceStatus>("connecting");
  const turnsRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const savedCountRef = useRef(0);
  const sessionStartRef = useRef(0);
  const pendingToolsRef = useRef(0);
  const closingRef = useRef(false);
  const rafRef = useRef<number>(0);

  const setStatusBoth = (s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  /** Hard barge-in: kill all queued/playing assistant audio immediately. */
  const flushPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    activeSourcesRef.current.clear();
    if (audioCtxRef.current) playCursorRef.current = audioCtxRef.current.currentTime;
  }, []);

  const persistTranscript = useCallback(
    async (final: boolean) => {
      const unsaved = turnsRef.current.slice(savedCountRef.current);
      if (unsaved.length === 0 && !final) return;
      const durationSeconds = final
        ? Math.round((Date.now() - sessionStartRef.current) / 1000)
        : undefined;
      if (unsaved.length === 0 && !durationSeconds) return;
      savedCountRef.current = turnsRef.current.length;
      try {
        await fetch("/api/ai/voice/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, turns: unsaved, durationSeconds }),
          keepalive: final,
        });
        if (unsaved.length > 0) onTranscriptSaved?.();
      } catch {
        // best-effort; turns stay in turnsRef for the next flush
        savedCountRef.current -= unsaved.length;
      }
    },
    [conversationId, onTranscriptSaved]
  );

  const teardown = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(rafRef.current);
    persistTranscript(true);
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    flushPlayback();
    try { processorRef.current?.disconnect(); } catch { /* noop */ }
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* noop */ });
    audioCtxRef.current = null;
  }, [flushPlayback, persistTranscript]);

  // ── Session lifecycle ──
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    turnsRef.current = [];
    savedCountRef.current = 0;
    sessionStartRef.current = Date.now();
    setCaption("");
    setUserCaption("");
    setElapsed(0);
    setMuted(false);
    mutedRef.current = false;
    setStatusBoth("connecting");

    let cancelled = false;

    (async () => {
      try {
        // 1. Mint session config + ephemeral token
        const res = await fetch("/api/ai/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, conversationId, customerId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Session failed (${res.status})`);
        }
        const cfg = await res.json();
        if (cancelled) return;

        // 2. Mic with echo cancellation — the key to full duplex
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        micStreamRef.current = stream;

        const ctx = new AudioContext({ sampleRate: cfg.sampleRate || 24000 });
        audioCtxRef.current = ctx;
        playCursorRef.current = ctx.currentTime;

        // 3. WebSocket with ephemeral token as subprotocol
        const ws = new WebSocket(cfg.wsUrl, [`xai-client-secret.${cfg.token}`]);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          ws.send(
            JSON.stringify({
              type: "session.update",
              session: {
                instructions: cfg.instructions,
                voice: cfg.voice,
                tools: cfg.tools,
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.8,
                  silence_duration_ms: 600,
                  prefix_padding_ms: 333,
                },
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: ctx.sampleRate },
                    // Pin transcription to English — without this the model
                    // auto-detects and can lock onto the wrong language.
                    transcription: { language_hint: "en" },
                  },
                  output: { format: { type: "audio/pcm", rate: ctx.sampleRate } },
                },
              },
            })
          );

          // 4. Mic capture → PCM16 base64 frames
          const source = ctx.createMediaStreamSource(stream);
          micSourceRef.current = source;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyserRef.current = analyser;
          source.connect(analyser);
          const processor = ctx.createScriptProcessor(2048, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
            const f32 = e.inputBuffer.getChannelData(0);
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: float32ToBase64Pcm16(f32),
              })
            );
          };
          source.connect(processor);
          processor.connect(ctx.destination); // required for onaudioprocess to fire; outputs silence

          setStatusBoth("listening");

          // Orb level animation
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (closingRef.current) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
            setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        };

        ws.onmessage = async (evt) => {
          let msg: any;
          try { msg = JSON.parse(evt.data); } catch { return; }

          switch (msg.type) {
            // ── assistant audio out ──
            case "response.output_audio.delta":
            case "response.audio.delta": {
              const audioCtx = audioCtxRef.current;
              if (!audioCtx || !msg.delta) break;
              const i16 = base64ToInt16(msg.delta);
              const f32 = new Float32Array(i16.length);
              for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
              const buf = audioCtx.createBuffer(1, f32.length, audioCtx.sampleRate);
              buf.getChannelData(0).set(f32);
              const src = audioCtx.createBufferSource();
              src.buffer = buf;
              src.connect(audioCtx.destination);
              const startAt = Math.max(playCursorRef.current, audioCtx.currentTime + 0.02);
              src.start(startAt);
              playCursorRef.current = startAt + buf.duration;
              activeSourcesRef.current.add(src);
              src.onended = () => {
                activeSourcesRef.current.delete(src);
                // Queue drained and no new audio → back to listening
                if (
                  activeSourcesRef.current.size === 0 &&
                  statusRef.current === "speaking" &&
                  pendingToolsRef.current === 0
                ) {
                  setStatusBoth("listening");
                }
              };
              if (statusRef.current !== "speaking") setStatusBoth("speaking");
              break;
            }

            // ── BARGE-IN: user started talking ──
            case "input_audio_buffer.speech_started":
            case "conversation.interrupted": {
              flushPlayback();
              setCaption("");
              setStatusBoth("listening");
              break;
            }

            case "input_audio_buffer.speech_stopped": {
              if (statusRef.current === "listening") setStatusBoth("thinking");
              break;
            }

            // ── live captions ──
            case "response.output_audio_transcript.delta":
            case "response.audio_transcript.delta": {
              if (msg.delta) setCaption((prev) => (prev + msg.delta).slice(-280));
              break;
            }
            case "response.output_audio_transcript.done":
            case "response.audio_transcript.done": {
              if (msg.transcript) {
                turnsRef.current.push({ role: "assistant", content: msg.transcript });
                if (turnsRef.current.length - savedCountRef.current >= 4) persistTranscript(false);
              }
              break;
            }
            case "conversation.item.input_audio_transcription.updated": {
              // xAI cumulative transcript with corrections
              const t = msg.transcript ?? msg.delta ?? "";
              if (t) setUserCaption(String(t).slice(-200));
              break;
            }
            case "conversation.item.input_audio_transcription.completed": {
              const t = msg.transcript || "";
              if (t.trim()) {
                turnsRef.current.push({ role: "user", content: t.trim() });
                setUserCaption("");
              }
              break;
            }

            // ── tool calls ──
            case "response.function_call_arguments.done": {
              const { name, call_id } = msg;
              pendingToolsRef.current += 1;
              setActiveTool(name);
              try {
                const toolRes = await fetch("/api/ai/voice/tools", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ conversationId, name, arguments: msg.arguments }),
                });
                const { output } = await toolRes.json();
                wsRef.current?.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id, output: output || "Tool returned no output." },
                  })
                );
              } catch (err: any) {
                wsRef.current?.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id, output: `Tool failed: ${err.message}` },
                  })
                );
              } finally {
                pendingToolsRef.current -= 1;
                if (pendingToolsRef.current === 0) {
                  setActiveTool(null);
                  wsRef.current?.send(JSON.stringify({ type: "response.create" }));
                }
              }
              break;
            }

            case "response.done": {
              if (activeSourcesRef.current.size === 0 && pendingToolsRef.current === 0 && statusRef.current !== "listening") {
                setStatusBoth("listening");
              }
              break;
            }

            case "error": {
              console.error("[Voice] Server error:", msg.error);
              const detail = msg.error?.message || "Voice session error";
              // Non-fatal errors (e.g. truncation race) shouldn't kill the call
              if (msg.error?.type === "invalid_request_error") break;
              toast.error(detail);
              break;
            }
          }
        };

        ws.onerror = () => {
          if (!closingRef.current) {
            setStatusBoth("error");
            toast.error("Voice connection error");
          }
        };
        ws.onclose = () => {
          if (!closingRef.current && statusRef.current !== "error") {
            // Session ended server-side (token/idle limits) — close gracefully
            teardown();
            onClose();
          }
        };
      } catch (err: any) {
        console.error("[Voice] Start failed:", err);
        setStatusBoth("error");
        toast.error(
          err?.name === "NotAllowedError"
            ? "Microphone access denied — allow the mic to use voice mode"
            : err.message || "Could not start voice session"
        );
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId, workspaceId, customerId]);

  const handleEnd = () => {
    teardown();
    onClose();
  };

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  };

  if (!open) return null;

  const tool = activeTool ? TOOL_LABELS[activeTool] : null;
  const orbScale = 1 + (status === "listening" ? level * 0.35 : status === "speaking" ? 0.15 + level * 0.1 : 0);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-[#0c0f17]/[0.97] backdrop-blur-xl text-white">
      {/* Top bar */}
      <div className="w-full flex items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <span className={cn("h-2 w-2 rounded-full", status === "error" ? "bg-red-500" : "bg-emerald-400 animate-pulse")} />
          {status === "connecting" && "Connecting…"}
          {status === "listening" && "Listening"}
          {status === "thinking" && "Thinking"}
          {status === "speaking" && "Speaking"}
          {status === "error" && "Connection issue"}
          <span className="text-white/30 ml-2">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        </div>
        <button
          onClick={handleEnd}
          className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          aria-label="End voice session"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Orb */}
      <div className="flex flex-col items-center gap-8">
        <div className="relative h-44 w-44 flex items-center justify-center">
          {/* Halo */}
          <div
            className={cn(
              "absolute inset-0 rounded-full blur-2xl transition-colors duration-500",
              status === "speaking" && "bg-violet-500/40",
              status === "listening" && "bg-emerald-500/30",
              status === "thinking" && "bg-blue-500/30 animate-pulse",
              status === "connecting" && "bg-white/10 animate-pulse",
              status === "error" && "bg-red-500/30"
            )}
            style={{ transform: `scale(${orbScale * 1.15})` }}
          />
          {/* Core */}
          <div
            className={cn(
              "relative h-32 w-32 rounded-full transition-all duration-150 ease-out",
              "bg-gradient-to-br shadow-2xl",
              status === "speaking" && "from-violet-400 to-fuchsia-600",
              status === "listening" && "from-emerald-300 to-teal-600",
              status === "thinking" && "from-blue-300 to-indigo-600",
              status === "connecting" && "from-slate-400 to-slate-700",
              status === "error" && "from-red-400 to-rose-700"
            )}
            style={{ transform: `scale(${orbScale})` }}
          >
            {status === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-white/80" />
              </div>
            )}
          </div>
        </div>

        {/* Tool activity chip */}
        <div className="h-8">
          {tool && (
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-sm text-white/80">
              <tool.Icon className="h-3.5 w-3.5 animate-pulse" />
              {tool.label}…
            </div>
          )}
        </div>
      </div>

      {/* Captions + controls */}
      <div className="w-full flex flex-col items-center gap-6 pb-10 px-6">
        <div className="min-h-[3.5rem] max-w-xl text-center">
          {userCaption && (
            <p className="text-sm text-emerald-300/80 mb-1">{userCaption}</p>
          )}
          {caption && (
            <p className="text-base text-white/85 leading-relaxed">{caption}</p>
          )}
          {!caption && !userCaption && status === "listening" && (
            <p className="text-sm text-white/30">Just talk — interrupt me any time.</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleMute}
            className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center transition-colors",
              muted ? "bg-amber-500/90 hover:bg-amber-500" : "bg-white/10 hover:bg-white/20"
            )}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            onClick={handleEnd}
            className="h-14 px-7 rounded-full bg-red-500/90 hover:bg-red-500 flex items-center gap-2 font-medium transition-colors"
            aria-label="End conversation"
          >
            <X className="h-5 w-5" />
            End
          </button>
        </div>
      </div>
    </div>
  );
}
