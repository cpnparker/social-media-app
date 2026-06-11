"use client";

/**
 * EngineAI Voice — compact docked voice session, integrated into the chat.
 *
 * Replaces the original full-screen overlay: the conversation thread stays
 * visible and fills with the live transcript while you talk. Renders as a
 * floating pill just above the chat input.
 *
 * Controls: Pause/Resume (stops mic + playback, session stays alive), End.
 *
 * Transport: browser ↔ xAI Grok Voice Agent API (OpenAI Realtime-spec) over
 * WebSocket with an ephemeral token. PCM16 @ 24kHz both directions.
 * Naturalness: browser echo cancellation (full-duplex mic), server_vad smart
 * turn detection, hard barge-in (queued playback flushed when you speak).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Square, Database, Brain, ListChecks, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type VoiceStatus = "connecting" | "listening" | "thinking" | "speaking" | "paused" | "error";

interface VoiceDockProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  workspaceId: string;
  customerId?: string | null;
  /** Called whenever transcript turns were persisted — lets the thread refresh live */
  onTranscriptSaved?: () => void;
  /** Wake-phrase sessions: greet immediately with a short "Yes?" so the user
   *  knows it's live, and auto-end after prolonged silence. */
  wakeSession?: boolean;
}

/** Spoken hard-stop phrases — immediate end, no model round-trip. */
const HARD_END_RE = /\b(stop listening|end (the )?(conversation|chat|session)|that('|')?s all,? thanks?)\b/i;
/** Bare voice commands (whole utterance) that end the session — Alexa-style. */
const BARE_STOP_RE = /^\s*(orac[,!.]?\s*)?(stop|cancel|never ?mind|go to sleep|shut up|that('|')?s (all|enough))[.!?]?\s*$/i;
/** Absolute inactivity backstop for wake sessions. */
const SILENCE_END_MS = 60_000;
/** Alexa-style follow-up window: after Orac finishes speaking, the session
 *  stays open this long for a follow-up question, then closes and rearms. */
const FOLLOWUP_WINDOW_MS = 8_000;

const TOOL_LABELS: Record<string, { label: string; Icon: typeof Database }> = {
  query_engine: { label: "Checking the Engine", Icon: Database },
  lookup_client_context: { label: "Pulling client profile", Icon: Database },
  search_memory: { label: "Searching memories", Icon: Brain },
  query_meetingbrain: { label: "Checking meetings", Icon: ListChecks },
  query_slack: { label: "Checking Slack", Icon: MessageSquare },
  consult_analyst: { label: "Consulting the analyst", Icon: Sparkles },
};

const STATUS_TEXT: Record<VoiceStatus, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Paused",
  error: "Connection issue",
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

export default function VoiceDock({
  open,
  onClose,
  conversationId,
  workspaceId,
  customerId,
  onTranscriptSaved,
  wakeSession,
}: VoiceDockProps) {
  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [caption, setCaption] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Playback is routed through an <audio> element: Chrome's echo cancellation
  // only includes MEDIA ELEMENT output in its reference signal — raw WebAudio
  // destination output is NOT cancelled from the mic, so on speakers the
  // assistant heard itself and barged in on its own replies.
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const elementOutOkRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playCursorRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const pausedRef = useRef(false);
  const statusRef = useRef<VoiceStatus>("connecting");
  const prePauseStatusRef = useRef<VoiceStatus>("listening");
  // Transcript items keyed by the realtime API's item_id. xAI re-emits the
  // CUMULATIVE transcription of the same utterance as it refines ("So" →
  // "So can you tell me" → …), so turns must be upserted by id, never
  // appended per event — appending is what spammed partials into the thread.
  const itemsRef = useRef<{ id: string; role: "user" | "assistant"; content: string; saved: boolean }[]>([]);
  const activeUserItemRef = useRef<string | null>(null);
  const utteranceCounterRef = useRef(0);
  const sessionStartRef = useRef(0);
  const pendingToolsRef = useRef(0);
  const closingRef = useRef(false);
  const rafRef = useRef<number>(0);
  // Graceful ending: set when the model calls end_conversation — the session
  // closes once its sign-off audio finishes playing.
  const endingRef = useRef(false);
  const lastUserSpeechRef = useRef(0);
  /** Wake sessions: deadline for a follow-up after Orac finishes speaking. */
  const followUpDeadlineRef = useRef<number | null>(null);

  const setStatusBoth = (s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  /** Hard barge-in / pause: kill all queued assistant audio immediately. */
  const flushPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    activeSourcesRef.current.clear();
    if (audioCtxRef.current) playCursorRef.current = audioCtxRef.current.currentTime;
  }, []);

  /** Upsert a transcript item. User items also merge prefix-refinements in
   *  case the API assigns a fresh id to a re-emission of the same utterance. */
  const upsertItem = useCallback((id: string, role: "user" | "assistant", content: string) => {
    const items = itemsRef.current;
    let item = items.find((i) => i.id === id);
    if (!item && role === "user") {
      item = items.find(
        (i) =>
          i.role === "user" &&
          !i.saved &&
          (content.startsWith(i.content) || i.content.startsWith(content))
      );
    }
    if (item) {
      if (!item.saved) item.content = content;
    } else {
      items.push({ id, role, content, saved: false });
    }
  }, []);

  const persistTranscript = useCallback(
    async (final: boolean) => {
      // The user item still being refined is held back until the assistant
      // responds (or the session ends) — persisting earlier is what created
      // duplicate partial messages.
      const pending = itemsRef.current.filter(
        (i) =>
          !i.saved &&
          i.content.trim() &&
          (final || i.role === "assistant" || i.id !== activeUserItemRef.current)
      );
      const durationSeconds = final
        ? Math.round((Date.now() - sessionStartRef.current) / 1000)
        : undefined;
      if (pending.length === 0 && !durationSeconds) return;
      pending.forEach((i) => { i.saved = true; });
      try {
        await fetch("/api/ai/voice/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            turns: pending.map(({ role, content }) => ({ role, content: content.trim() })),
            durationSeconds,
          }),
          keepalive: final,
        });
        if (pending.length > 0) onTranscriptSaved?.();
      } catch {
        pending.forEach((i) => { i.saved = false; });
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
    try {
      audioElRef.current?.pause();
      if (audioElRef.current) audioElRef.current.srcObject = null;
    } catch { /* noop */ }
    audioElRef.current = null;
    mediaDestRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* noop */ });
    audioCtxRef.current = null;
  }, [flushPlayback, persistTranscript]);

  // ── Session lifecycle ──
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    pausedRef.current = false;
    endingRef.current = false;
    followUpDeadlineRef.current = null;
    itemsRef.current = [];
    activeUserItemRef.current = null;
    utteranceCounterRef.current = 0;
    sessionStartRef.current = Date.now();
    lastUserSpeechRef.current = Date.now();
    setCaption("");
    setElapsed(0);
    setStatusBoth("connecting");

    let cancelled = false;

    (async () => {
      try {
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

        // Mic with echo cancellation — the key to full duplex
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

        // Echo-cancellable playback path (see refs above). If autoplay is
        // blocked we fall back to direct WebAudio output — audible, but AEC
        // won't cancel it (headphones recommended in that case).
        const mediaDest = ctx.createMediaStreamDestination();
        mediaDestRef.current = mediaDest;
        const audioEl = new Audio();
        audioEl.srcObject = mediaDest.stream;
        audioElRef.current = audioEl;
        elementOutOkRef.current = false;
        audioEl
          .play()
          .then(() => { elementOutOkRef.current = true; })
          .catch(() => {
            console.warn("[Voice] Element playback blocked — falling back to direct output (no AEC)");
            elementOutOkRef.current = false;
          });

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

          const source = ctx.createMediaStreamSource(stream);
          micSourceRef.current = source;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const processor = ctx.createScriptProcessor(2048, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            if (pausedRef.current || ws.readyState !== WebSocket.OPEN) return;
            const f32 = e.inputBuffer.getChannelData(0);
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: float32ToBase64Pcm16(f32),
              })
            );
          };
          source.connect(processor);
          processor.connect(ctx.destination); // required for onaudioprocess; outputs silence

          setStatusBoth("listening");

          // Wake-phrase sessions: greet immediately so the user knows it's live
          if (wakeSession) {
            ws.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  instructions:
                    "The user just woke you with the wake phrase. Say ONLY a very short, warm prompt like \"Yes?\" or \"I'm listening — what's up?\". Nothing else.",
                },
              })
            );
          }

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
            // Wake sessions: Alexa-style follow-up window — close shortly
            // after Orac finishes speaking unless the user follows up.
            if (
              wakeSession &&
              !pausedRef.current &&
              statusRef.current === "listening" &&
              followUpDeadlineRef.current !== null &&
              Date.now() > followUpDeadlineRef.current
            ) {
              teardown();
              onClose();
              return;
            }
            // Absolute inactivity backstop so a missed sign-off can't leave
            // the meter running.
            if (
              wakeSession &&
              !pausedRef.current &&
              statusRef.current === "listening" &&
              Date.now() - lastUserSpeechRef.current > SILENCE_END_MS
            ) {
              teardown();
              onClose();
              return;
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        };

        ws.onmessage = async (evt) => {
          let msg: any;
          try { msg = JSON.parse(evt.data); } catch { return; }

          switch (msg.type) {
            case "response.output_audio.delta":
            case "response.audio.delta": {
              // Drop assistant audio entirely while paused
              if (pausedRef.current) break;
              followUpDeadlineRef.current = null; // Orac is speaking
              const audioCtx = audioCtxRef.current;
              if (!audioCtx || !msg.delta) break;
              const i16 = base64ToInt16(msg.delta);
              const f32 = new Float32Array(i16.length);
              for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
              const buf = audioCtx.createBuffer(1, f32.length, audioCtx.sampleRate);
              buf.getChannelData(0).set(f32);
              const src = audioCtx.createBufferSource();
              src.buffer = buf;
              // Echo-cancellable element path when available, else direct
              src.connect(
                elementOutOkRef.current && mediaDestRef.current
                  ? mediaDestRef.current
                  : audioCtx.destination
              );
              const startAt = Math.max(playCursorRef.current, audioCtx.currentTime + 0.02);
              src.start(startAt);
              playCursorRef.current = startAt + buf.duration;
              activeSourcesRef.current.add(src);
              src.onended = () => {
                activeSourcesRef.current.delete(src);
                if (activeSourcesRef.current.size === 0 && endingRef.current) {
                  // Sign-off finished playing — close gracefully
                  teardown();
                  onClose();
                  return;
                }
                if (
                  activeSourcesRef.current.size === 0 &&
                  statusRef.current === "speaking" &&
                  pendingToolsRef.current === 0
                ) {
                  setStatusBoth("listening");
                  // Alexa-style: Orac finished its answer — keep a short
                  // follow-up window, then close and return to wake listening.
                  if (wakeSession) followUpDeadlineRef.current = Date.now() + FOLLOWUP_WINDOW_MS;
                }
              };
              if (statusRef.current !== "speaking" && statusRef.current !== "paused") {
                setStatusBoth("speaking");
              }
              break;
            }

            case "input_audio_buffer.speech_started":
            case "conversation.interrupted": {
              if (pausedRef.current) break;
              lastUserSpeechRef.current = Date.now();
              followUpDeadlineRef.current = null; // follow-up arrived — stay engaged
              // New utterance starting — give id-less transcription events a
              // fresh fallback key so utterances never merge into each other.
              utteranceCounterRef.current += 1;
              flushPlayback();
              setCaption("");
              setStatusBoth("listening");
              break;
            }

            case "input_audio_buffer.speech_stopped": {
              if (statusRef.current === "listening") setStatusBoth("thinking");
              break;
            }

            case "response.output_audio_transcript.delta":
            case "response.audio_transcript.delta": {
              if (msg.delta && !pausedRef.current) {
                setCaption((prev) => (prev + msg.delta).slice(-160));
              }
              break;
            }
            case "response.output_audio_transcript.done":
            case "response.audio_transcript.done": {
              if (msg.transcript) {
                const id = msg.item_id || msg.response_id || `a-${itemsRef.current.length}`;
                upsertItem(id, "assistant", msg.transcript);
                // The assistant replied — the user's utterance is final now.
                activeUserItemRef.current = null;
                persistTranscript(false);
              }
              break;
            }
            case "conversation.item.input_audio_transcription.updated":
            case "conversation.item.input_audio_transcription.completed": {
              // xAI sends the CUMULATIVE transcript for the same utterance,
              // possibly multiple times with corrections — upsert, never append.
              const t = String(msg.transcript ?? msg.delta ?? "").trim();
              if (!t) break;
              const id = msg.item_id || `u-${utteranceCounterRef.current}`;
              activeUserItemRef.current = id;
              upsertItem(id, "user", t);
              if (!pausedRef.current) setCaption(t.slice(-160));
              lastUserSpeechRef.current = Date.now();
              // Hard-stop — immediate end, no model round-trip. Either a stop
              // phrase anywhere, or an Alexa-style bare command ("stop",
              // "cancel", "go to sleep") as the WHOLE utterance.
              // (teardown persists the final transcript + usage)
              if (
                msg.type === "conversation.item.input_audio_transcription.completed" &&
                (HARD_END_RE.test(t) || BARE_STOP_RE.test(t))
              ) {
                teardown();
                onClose();
                return;
              }
              break;
            }

            case "response.function_call_arguments.done": {
              const { name, call_id } = msg;
              followUpDeadlineRef.current = null; // tool work in progress
              // end_conversation is handled entirely client-side: confirm the
              // call, let the model speak ONE short sign-off, then the
              // playback-drained handler closes the session.
              if (name === "end_conversation") {
                endingRef.current = true;
                wsRef.current?.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id, output: "Conversation ending — say one short, warm sign-off now." },
                  })
                );
                wsRef.current?.send(JSON.stringify({ type: "response.create" }));
                // Safety net: if no sign-off audio arrives, close anyway
                setTimeout(() => {
                  if (!closingRef.current && endingRef.current && activeSourcesRef.current.size === 0) {
                    teardown();
                    onClose();
                  }
                }, 6000);
                break;
              }
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
              if (
                activeSourcesRef.current.size === 0 &&
                pendingToolsRef.current === 0 &&
                statusRef.current !== "listening" &&
                statusRef.current !== "paused"
              ) {
                setStatusBoth("listening");
                if (wakeSession) followUpDeadlineRef.current = Date.now() + FOLLOWUP_WINDOW_MS;
              }
              break;
            }

            case "error": {
              console.error("[Voice] Server error:", msg.error);
              if (msg.error?.type === "invalid_request_error") break;
              toast.error(msg.error?.message || "Voice session error");
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

  const togglePause = () => {
    if (statusRef.current === "connecting" || statusRef.current === "error") return;
    if (pausedRef.current) {
      // Resume — back to listening; the session stayed alive throughout
      pausedRef.current = false;
      setStatusBoth(prePauseStatusRef.current === "paused" ? "listening" : "listening");
    } else {
      prePauseStatusRef.current = statusRef.current;
      pausedRef.current = true;
      flushPlayback();
      setCaption("");
      setStatusBoth("paused");
      // Persist whatever we have so the thread is current while paused
      persistTranscript(false);
    }
  };

  if (!open) return null;

  const tool = activeTool ? TOOL_LABELS[activeTool] : null;
  const paused = status === "paused";
  const orbScale =
    1 + (status === "listening" ? level * 0.5 : status === "speaking" ? 0.2 + level * 0.15 : 0);

  return (
    <div className="fixed bottom-24 sm:bottom-28 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
      <div className="flex items-center gap-3 rounded-full bg-[#11141d] text-white border border-white/10 shadow-2xl pl-3 pr-2 py-2">
        {/* Orb */}
        <div className="relative h-8 w-8 shrink-0 flex items-center justify-center">
          <div
            className={cn(
              "absolute inset-0 rounded-full blur-md transition-colors duration-300",
              status === "speaking" && "bg-violet-500/50",
              status === "listening" && "bg-emerald-500/40",
              status === "thinking" && "bg-blue-500/40 animate-pulse",
              status === "connecting" && "bg-white/10 animate-pulse",
              paused && "bg-amber-500/40",
              status === "error" && "bg-red-500/40"
            )}
            style={{ transform: `scale(${orbScale * 1.2})` }}
          />
          <div
            className={cn(
              "relative h-6 w-6 rounded-full bg-gradient-to-br transition-all duration-150 ease-out",
              status === "speaking" && "from-violet-400 to-fuchsia-600",
              status === "listening" && "from-emerald-300 to-teal-600",
              status === "thinking" && "from-blue-300 to-indigo-600",
              status === "connecting" && "from-slate-400 to-slate-700",
              paused && "from-amber-300 to-orange-600",
              status === "error" && "from-red-400 to-rose-700"
            )}
            style={{ transform: `scale(${orbScale})` }}
          >
            {status === "connecting" && (
              <Loader2 className="h-6 w-6 animate-spin text-white/80 p-1" />
            )}
          </div>
        </div>

        {/* Status / caption / tool */}
        <div className="min-w-0 max-w-[44vw] sm:max-w-xs">
          <div className="flex items-center gap-2 text-[11px] text-white/50 leading-tight">
            <span>{STATUS_TEXT[status]}</span>
            <span className="text-white/30">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
            {tool && (
              <span className="flex items-center gap-1 text-white/60">
                <tool.Icon className="h-3 w-3 animate-pulse" />
                {tool.label}…
              </span>
            )}
          </div>
          <p className="text-[13px] text-white/85 truncate leading-tight">
            {paused
              ? "Paused — resume when you're ready"
              : caption || (status === "listening" ? "Just talk — interrupt me any time" : " ")}
          </p>
        </div>

        {/* Controls — Stop is the primary action (ends the conversation;
            wake mode returns to local-only listening). Pause is secondary. */}
        <button
          onClick={togglePause}
          disabled={status === "connecting" || status === "error"}
          className={cn(
            "h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40",
            paused ? "bg-emerald-500/90 hover:bg-emerald-500" : "bg-white/5 hover:bg-white/15 text-white/70"
          )}
          aria-label={paused ? "Resume conversation" : "Pause conversation (keeps it open)"}
          title={paused ? "Resume" : "Pause (keeps the conversation open)"}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button
          onClick={handleEnd}
          className="h-9 shrink-0 px-4 rounded-full bg-red-500/90 hover:bg-red-500 flex items-center gap-1.5 font-medium text-sm transition-colors"
          aria-label="Stop and end the conversation"
          title="Stop — ends the conversation"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          Stop
        </button>
      </div>
    </div>
  );
}
