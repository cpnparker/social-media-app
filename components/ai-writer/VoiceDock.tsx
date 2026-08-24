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
import {
  HARD_END_RE, BARE_STOP_RE, IDLE_WARN_MS, IDLE_END_MS,
  toolLabel, toolArgsPhrase,
} from "@/lib/ai/voice-session";

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
  /** What the user said after the wake word ("Orac, what meetings…") —
   *  answered immediately instead of greeting. */
  initialCommand?: string;
  /** Raw post-wake command audio (16kHz) from the trained wake engine —
   *  flushed into the session so the server transcribes it directly. */
  initialAudioPromise?: () => Promise<Float32Array | null>;
  /** Nothing is persisted from an incognito thread — the badge says so, up
   *  front, rather than letting the user discover it from an empty thread. */
  incognito?: boolean;
}

/** Alexa-style follow-up window: after Orac finishes speaking, the session
 *  stays open this long for a follow-up question, then closes and rearms. */
const FOLLOWUP_WINDOW_MS = 8_000;

/** ICONS only — the label text lives in lib/ai/voice-session.ts, where it can
 *  be tested and where a missing entry falls back instead of rendering blank. */
const TOOL_ICONS: Record<string, typeof Database> = {
  query_engine: Database,
  lookup_client_context: Database,
  search_memory: Brain,
  query_meetingbrain: ListChecks,
  query_slack: MessageSquare,
  consult_analyst: Sparkles,
};

/** Absolute inactivity backstop for WAKE sessions (separate from the ordinary
 *  idle timeout, which lives in lib/ai/voice-session.ts). */
const SILENCE_END_MS = 60_000;

/** Seconds a tool has been running. `_tick` is unused on purpose: passing the
 *  session clock re-renders this once a second without a second timer. */
function toolSecs(at: number, _tick: number): number {
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

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
  initialCommand,
  initialAudioPromise,
  incognito,
}: VoiceDockProps) {
  const [status, setStatus] = useState<VoiceStatus>("connecting");

  /**
   * Tools in flight, as a LIST. setActiveTool(name) overwrote, so a turn that
   * called two tools showed only whichever landed last — while the pending
   * counter correctly tracked both. Parallel calls are normal here.
   */
  const [tools, setTools] = useState<{ id: string; name: string; args: string; at: number }[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  /** The thread turns are being written to, or null when nothing is persisted
   *  (incognito). Returned by the session route and previously discarded. */
  const savingTo = incognito ? null : "thread";
  /** The live transcript, kept as TWO rows. One caption slot meant the user's
   *  words and the assistant's overwrote each other. */
  const [userSaid, setUserSaid] = useState("");
  const [botSaid, setBotSaid] = useState("");
  /** Seconds until an idle session closes itself, or null when not idling. */
  const [idleIn, setIdleIn] = useState<number | null>(null);

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
  // One response at a time: the speech-to-speech model renders its VOICE per
  // response, so creating a tool-continuation response while the previous one
  // is still streaming produces a second, differently-rendered speaker midway
  // through what the user hears as ONE reply (the "voice changes mid-reply"
  // bug). Track the active response and queue creates until response.done.
  const responseActiveRef = useRef(false);
  const pendingResponseCreateRef = useRef(false);
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
  /** Latest teardown, so the pagehide listener — registered once — always
   *  calls the current one rather than the closure it was created with. */
  const teardownRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number>(0);
  /** Drives the wake-session closers independently of rAF — see shouldClose. */
  const idleTimerRef = useRef<number | null>(null);
  // Graceful ending: set when the model calls end_conversation — the session
  // closes once its sign-off audio finishes playing.
  const endingRef = useRef(false);
  const lastUserSpeechRef = useRef(0);
  /** Wake sessions: deadline for a follow-up after Orac finishes speaking. */
  const followUpDeadlineRef = useRef<number | null>(null);
  /**
   * Bumped on every barge-in. A tool call captures it when it starts and
   * compares on resolve: if the user interrupted while the tool was in flight,
   * the turn it belonged to is over and its continuation must not be created.
   *
   * Without this, barge-in cleared the QUEUED continuation but not the
   * in-flight one — the tool resolved seconds later, found responseActiveRef
   * false, and sent response.create while the user was still mid-sentence.
   * Server VAD then created a response for that utterance too: two overlapping
   * responses, which is precisely the split render that changes voice mid-reply.
   * The slower the tool the wider the window, and query_xero fetching a
   * spreadsheet is the slowest on this surface.
   */
  const turnEpochRef = useRef(0);
  /**
   * Holds the live mic OFF until the wake engine's captured command has been
   * flushed into the session.
   *
   * On the trained-wake path the same sentence otherwise reaches the server
   * twice: the session mic starts appending at session.updated while the wake
   * engine is still capturing, so a truncated live tail arrives first and the
   * full buffer arrives after. Server VAD closes a turn on each and creates a
   * response for BOTH — two concurrent responses, which is the split render
   * that changes voice mid-reply. Neither responseActiveRef nor the turn epoch
   * catches it, because the client created neither response.
   */
  const micHoldRef = useRef(false);
  /**
   * Identifies the CURRENT session. Bumped on every connect.
   *
   * VoiceDock stays mounted across sessions, so wsRef and the counters below
   * are shared by all of them. A tool call still in flight when a session tears
   * down would otherwise resolve into whatever socket wsRef points at NEXT:
   * submitting a function_call_output whose call_id does not exist there, then
   * creating a response for it — concurrently with the new session's own
   * greeting. Two responses on turn one, from a conversation that already
   * ended.
   *
   * Every post-await send is therefore conditional on still being the session
   * that started the call.
   */
  const sessionSeqRef = useRef(0);
  /**
   * Outstanding tool calls PER TURN, rather than one counter for the session.
   *
   * A single counter handed the continuation decision to whichever call
   * finished last, regardless of which turn owned it. With two tools straddling
   * a barge-in, the live turn's tool would resolve first and be skipped for not
   * being last, and the stale one would resolve last and be skipped for being
   * the wrong epoch — so no continuation was ever created and the answer was
   * silently dropped.
   */
  const pendingByEpochRef = useRef<Map<number, number>>(new Map());
  /** The opening response (command answer or greeting) is sent exactly once,
   *  AFTER session.updated — sending before the config landed made the
   *  greeting speak in xAI's default voice ("two voices" bug). */
  const initialSentRef = useRef(false);

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

  /** Create a response only when none is active — queue otherwise. Overlapping
   *  responses are what split one spoken reply across two per-response voice
   *  renders (the mid-reply voice change). Confirmed active by
   *  response.created; flushed by response.done. */
  const requestResponse = useCallback(() => {
    if (responseActiveRef.current) {
      pendingResponseCreateRef.current = true;
      return;
    }
    responseActiveRef.current = true; // optimistic — closes the double-create race
    wsRef.current?.send(JSON.stringify({ type: "response.create" }));
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
      // Optimistic, so a second flush mid-request cannot send the same turns
      // twice — but reverted below on anything that is not a confirmed save.
      pending.forEach((i) => { i.saved = true; });
      try {
        const res = await fetch("/api/ai/voice/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            turns: pending.map(({ role, content }) => ({ role, content: content.trim() })),
            durationSeconds,
          }),
          keepalive: final,
        });
        // A NON-OK RESPONSE IS NOT A THROW. Only a network failure reaches the
        // catch, so a 403 from the view-only guard or a 500 from the insert
        // resolved normally and left every turn flagged saved — the whole
        // conversation dropped with no toast, no retry and no trace. That is
        // the defect this branch exists for.
        if (!res.ok) {
          pending.forEach((i) => { i.saved = false; });
          console.error("[Voice] Transcript save failed:", res.status);
          toast.error(
            res.status === 403
              ? "You have view-only access to this thread — the voice turns were not saved"
              : "Voice turns could not be saved to the thread"
          );
          return;
        }
        // The server DELIBERATELY discards in an incognito thread and reports
        // saved: 0. That is not a failure, but it is not a save either: firing
        // onTranscriptSaved would tell the thread to refetch turns that were
        // never written, so the user watches an empty thread being told it
        // filled. The persistence badge is what tells them, up front.
        const body = await res.json().catch(() => null);
        const wrote = typeof body?.saved === "number" ? body.saved : pending.length;
        if (pending.length > 0 && wrote > 0) onTranscriptSaved?.();
      } catch {
        pending.forEach((i) => { i.saved = false; });
      }
    },
    [conversationId, onTranscriptSaved]
  );

  /**
   * Closing the tab, or backgrounding it on iOS, must still flush.
   *
   * durationSeconds is only sent on the FINAL flush, which also writes the
   * ai_usage row — so an unloaded tab lost the last exchange and the billing
   * record together, and the keepalive flag was set on precisely the request
   * that never fired.
   *
   * pagehide rather than beforeunload: beforeunload does not fire reliably on
   * mobile Safari, and the sibling meeting surface already ships exactly this
   * pattern. Voice simply was not using it.
   */
  useEffect(() => {
    const onHide = () => { teardownRef.current?.(); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const teardown = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(rafRef.current);
    if (idleTimerRef.current !== null) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
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

  useEffect(() => { teardownRef.current = teardown; }, [teardown]);

  // ── Session lifecycle ──
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    pausedRef.current = false;
    endingRef.current = false;
    followUpDeadlineRef.current = null;
    initialSentRef.current = false;
    itemsRef.current = [];
    activeUserItemRef.current = null;
    utteranceCounterRef.current = 0;
    sessionStartRef.current = Date.now();
    lastUserSpeechRef.current = Date.now();
    setUserSaid(""); setBotSaid("");
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
        // Claim the session identity here, beside the socket it names, so an
        // in-flight tool call from a previous session can tell that its turn —
        // and its socket — are gone.
        sessionSeqRef.current += 1;

        // Opening turn: answer the wake-command immediately ("Orac, what
        // meetings have I had today") or give the short wake greeting.
        const sendInitial = async () => {
          if (initialSentRef.current || ws.readyState !== WebSocket.OPEN) return;
          initialSentRef.current = true;
          // Trained wake engine: flush the raw post-wake command audio into
          // the session — server-grade STT hears the command directly.
          if (initialAudioPromise) {
            const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
            const audio = await Promise.race([initialAudioPromise(), timeout]);
            // Released on EVERY path out of here, including the early returns
            // and the timeout — a hold that leaks leaves the session deaf,
            // which is worse than the double-send it prevents.
            const releaseMic = () => { micHoldRef.current = false; };
            if (closingRef.current || ws.readyState !== WebSocket.OPEN) { releaseMic(); return; }
            if (audio && audio.length > 0) {
              const rate = audioCtxRef.current?.sampleRate || 24000;
              const { resampleLinear } = await import("@/lib/voice/oww-detector");
              const resampled = resampleLinear(audio, 16000, rate);
              // Send in ~100ms chunks; server VAD ends the turn on the
              // trailing silence and responds.
              const CH = Math.round(rate / 10);
              for (let off = 0; off < resampled.length; off += CH) {
                ws.send(
                  JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: float32ToBase64Pcm16(resampled.subarray(off, Math.min(off + CH, resampled.length))),
                  })
                );
              }
              setStatusBoth("thinking");
              // Release only AFTER the whole buffer is queued, so no live
              // fragment can interleave with the flushed command.
              releaseMic();
              return;
            }
            releaseMic();
            // No command captured — fall through to the greeting
          }
          if (initialCommand) {
            upsertItem("u-init", "user", initialCommand);
            ws.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text: initialCommand }],
                },
              })
            );
            // Arm the guard BEFORE sending, not when the server acks. The
            // queue in requestResponse() checks responseActiveRef, and between
            // this send and response.created arriving it was false — so a tool
            // result or VAD turn landing in that window sent a SECOND
            // response.create. Two overlapping responses = two renders = the
            // voice changing mid-reply.
            responseActiveRef.current = true;
            ws.send(JSON.stringify({ type: "response.create" }));
            setStatusBoth("thinking");
          } else if (wakeSession) {
            // Same reason as above — armed before the send, not on the ack.
            responseActiveRef.current = true;
            ws.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  // NOTE: response-level instructions REPLACE the session
                  // instructions for this turn — restate the rules that must
                  // hold for every spoken turn (English, consistent voice).
                  instructions:
                    "The user just woke you with the wake phrase. Say ONLY a very short, warm prompt like \"Yes?\" or \"I'm listening — what's up?\". Nothing else. Speak English, in your natural default voice — exactly the same voice as the rest of the conversation.",
                },
              })
            );
          }
        };

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
                  // 0.6 (was 0.8): with AEC now cancelling Orac's own voice
                  // from the mic, a lower threshold makes barge-in catch the
                  // user's interruptions promptly without self-triggering.
                  threshold: 0.6,
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

          // Arm the hold BEFORE the processor exists, so not a single live
          // frame can reach the server ahead of the flushed wake command.
          micHoldRef.current = !!initialAudioPromise;
          // Per-session state, reset on connect. VoiceDock stays mounted
          // across sessions, so a counter left non-zero by a previous
          // session's abandoned tool call would wedge this one's
          // continuations permanently.
          pendingToolsRef.current = 0;
          pendingByEpochRef.current = new Map();
          turnEpochRef.current = 0;

          const source = ctx.createMediaStreamSource(stream);
          micSourceRef.current = source;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const processor = ctx.createScriptProcessor(2048, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            // micHoldRef: on the wake path the captured command has not been
            // flushed yet, and appending live audio now would deliver the same
            // sentence twice. Dropped rather than queued on purpose — this is
            // the tail of audio the wake engine already holds in full.
            if (pausedRef.current || micHoldRef.current || ws.readyState !== WebSocket.OPEN) return;
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

          // Opening response — command answer or greeting — sent ONCE after
          // session.updated confirms our instructions are active. The voice
          // itself is baked into the session at token-mint time, so even the
          // fallback path can no longer speak in a different voice; the
          // fallback only exists in case session.updated never arrives.
          setTimeout(sendInitial, 2500);

          const data = new Uint8Array(analyser.frequencyBinCount);

          /**
           * Should this wake session close now?
           *
           * Lives OUTSIDE the animation frame because browsers stop rAF in a
           * hidden tab. Both closers used to run only inside the tick, so
           * switching tabs left the session open with the microphone streaming
           * to xAI indefinitely — while the consent copy says it returns to
           * local-only listening. Driven by an interval as well, which
           * browsers throttle but do not stop.
           */
          const shouldClose = () => {
            if (closingRef.current || pausedRef.current) return false;
            if (statusRef.current !== "listening") return false;
            // Ordinary sessions: warn, then close. Only silence counts — the
            // status is "listening" here, so nothing is being said or fetched.
            if (!wakeSession) {
              const idleFor = Date.now() - lastUserSpeechRef.current;
              if (idleFor > IDLE_END_MS) return true;
              setIdleIn(idleFor > IDLE_WARN_MS ? Math.ceil((IDLE_END_MS - idleFor) / 1000) : null);
              return false;
            }
            // Alexa-style follow-up window after Orac finishes speaking.
            if (followUpDeadlineRef.current !== null && Date.now() > followUpDeadlineRef.current) return true;
            // Absolute backstop, so a missed sign-off cannot leave it running.
            return Date.now() - lastUserSpeechRef.current > SILENCE_END_MS;
          };
          const closeIfIdle = () => {
            if (!shouldClose()) return false;
            teardown();
            onClose();
            return true;
          };
          idleTimerRef.current = window.setInterval(() => {
            // The session timer lives here as well as in the rAF tick, for the
            // same reason the closers do: browsers stop rAF in a hidden tab,
            // so the clock froze while the session — and the bill — ran on.
            if (!closingRef.current) setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
            closeIfIdle();
          }, 1000);

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
            if (closeIfIdle()) return;
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        };

        ws.onmessage = async (evt) => {
          let msg: any;
          try { msg = JSON.parse(evt.data); } catch { return; }

          switch (msg.type) {
            case "session.updated": {
              // Voice/instructions confirmed active — safe to speak now
              sendInitial();
              break;
            }
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
              // Barge-in cancels the active response server-side; drop any
              // queued continuation too — the model will pick up the pending
              // tool output on its next (VAD-triggered) turn.
              responseActiveRef.current = false;
              pendingResponseCreateRef.current = false;
              // Retire this turn: any tool still in flight belongs to it, and
              // its result must not create a response over the new utterance.
              turnEpochRef.current += 1;
              // Speaking again cancels a pending goodbye. end_conversation set
              // endingRef when the user said "thanks, that's all"; if they then
              // interrupt with one more question, they get their answer and the
              // session was killed the moment its audio drained — closing on an
              // intent they had already abandoned.
              endingRef.current = false;
              // New utterance starting — give id-less transcription events a
              // fresh fallback key so utterances never merge into each other.
              utteranceCounterRef.current += 1;
              flushPlayback();
              setUserSaid(""); setBotSaid("");
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
                setBotSaid((prev) => (prev + msg.delta).slice(-160));
                // The assistant speaking is activity too. Without this a long
                // answer counts toward the idle clock and the session could
                // close while it was still talking.
                lastUserSpeechRef.current = Date.now();
                setIdleIn(null);
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
              if (!pausedRef.current) { setUserSaid(t.slice(-160)); setBotSaid(""); }
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
                requestResponse();
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
              setTools((t) => t.concat([{ id: String(call_id), name, args: toolArgsPhrase(msg.arguments), at: Date.now() }]));
              // Both captured BEFORE the await: which turn asked for this, and
              // which session. Everything after the await is checked against
              // them, because both can change while a fetch is in flight.
              const toolEpoch = turnEpochRef.current;
              const toolSession = sessionSeqRef.current;
              const toolWs = ws;
              pendingByEpochRef.current.set(toolEpoch, (pendingByEpochRef.current.get(toolEpoch) || 0) + 1);
              let toolOutput: string;
              try {
                const toolRes = await fetch("/api/ai/voice/tools", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ conversationId, name, arguments: msg.arguments }),
                });
                // A non-2xx was destructured as {output: undefined} and reached
                // the model as "Tool returned no output." — indistinguishable
                // from an empty result, so a 403 read as "there is no data".
                if (!toolRes.ok) {
                  const body = await toolRes.text().catch(() => "");
                  let detail = body.slice(0, 300);
                  try { detail = JSON.parse(body)?.error || detail; } catch { /* not JSON */ }
                  toolOutput =
                    `The ${name} tool could not run (HTTP ${toolRes.status}): ${detail || "no detail"}. ` +
                    `Tell the user briefly that this could not be checked — do NOT answer from other data ` +
                    `and do NOT say the information does not exist.`;
                } else {
                  const parsed = await toolRes.json().catch(() => null);
                  toolOutput =
                    parsed && typeof parsed.output === "string" && parsed.output
                      ? parsed.output
                      : `The ${name} tool returned nothing usable. Say you could not retrieve it; do NOT invent a figure.`;
                }
              } catch (err: any) {
                toolOutput = `Tool failed: ${err?.message || err}. Say you could not retrieve it; do NOT invent a figure.`;
              } finally {
                const left = (pendingByEpochRef.current.get(toolEpoch) || 1) - 1;
                if (left > 0) pendingByEpochRef.current.set(toolEpoch, left);
                else pendingByEpochRef.current.delete(toolEpoch);
                pendingToolsRef.current = Math.max(0, pendingToolsRef.current - 1);
                setTools((t) => t.filter((x) => x.id !== String(call_id)));
              }

              // The session that started this call must still be the live one.
              // Otherwise the output would land in the NEXT session's socket,
              // under a call_id that does not exist there, and the continuation
              // below would speak an answer belonging to a finished conversation
              // over the new session's greeting.
              if (toolSession !== sessionSeqRef.current || closingRef.current || toolWs.readyState !== WebSocket.OPEN) {
                break;
              }

              toolWs.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: { type: "function_call_output", call_id, output: toolOutput },
                })
              );

              // Continue only the turn this tool belongs to, and only once its
              // OWN outstanding calls are done. A barged-in turn still submits
              // its output above — the model picks it up on the next VAD turn,
              // as the barge-in handler intends — but must not create a
              // response over the new utterance.
              if (toolEpoch === turnEpochRef.current && !pendingByEpochRef.current.has(toolEpoch)) {
                requestResponse();
              }
              break;
            }

            case "response.created": {
              responseActiveRef.current = true;
              break;
            }

            case "response.done": {
              responseActiveRef.current = false;
              // A continuation was queued while this response streamed (tool
              // result mid-speech) — create it now that the previous render
              // finished, so the reply stays ONE voice, back to back.
              if (pendingResponseCreateRef.current && !closingRef.current) {
                pendingResponseCreateRef.current = false;
                responseActiveRef.current = true;
                wsRef.current?.send(JSON.stringify({ type: "response.create" }));
                break; // stay in "thinking" — more speech incoming
              }
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
            // TEAR DOWN, do not just paint it red. onerror used to set the
            // state and stop, and onclose then skipped teardown BECAUSE the
            // state was error — so nothing stopped the microphone and nothing
            // saved the transcript. Pause is disabled in this state, so the
            // only way out was Stop, which nothing told the user to press.
            //
            // teardown() is idempotent (closingRef) and it is the only caller
            // of persistTranscript(true) and the only place mic tracks stop.
            // onClose() is NOT called: the dock stays up showing the error, so
            // the failure is visible rather than a session that silently
            // vanished mid-sentence.
            teardown();
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
      setUserSaid(""); setBotSaid("");
      setStatusBoth("paused");
      // Persist whatever we have so the thread is current while paused
      persistTranscript(false);
    }
  };

  if (!open) return null;

  // Icon from the known map where there is one, generic elsewhere. The LABEL
  // always resolves via toolLabel(), so a tool can never be in flight unnamed.
  const ToolIcon = (tools.length && TOOL_ICONS[tools[0].name]) || Database;
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

        {/* Status / transcript / tools */}
        <div className="min-w-0 max-w-[44vw] sm:max-w-xs">
          {/* A polite live region. There was not one aria-live in this file, so
              a screen-reader user got no state at all. */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="flex items-center gap-2 text-[11px] text-white/50 leading-tight"
          >
            <span>{STATUS_TEXT[status]}</span>
            <span className="text-white/30 tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
            {/* WHERE THE TURNS ARE GOING, said up front. A user with Incognito
                selected was watching a verbatim transcript being written to a
                thread they believed was private. */}
            {savingTo === null ? (
              <span className="text-amber-300/80 shrink-0">Not saved</span>
            ) : (
              <span className="text-emerald-300/70 truncate">Saving to thread</span>
            )}
          </div>

          {/* Tools in flight, with their own elapsed. A dead pause is the one
              thing voice can no longer explain out loud. */}
          {tools.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {tools.map((t) => (
                <div key={t.id} className="flex items-center gap-1.5 text-[11px] text-white/60 leading-tight">
                  <ToolIcon className="h-3 w-3 shrink-0 animate-pulse" />
                  <span className="truncate">
                    {toolLabel(t.name)}{t.args ? " \u00b7 " + t.args : ""}
                  </span>
                  <span className="text-white/30 tabular-nums shrink-0">{toolSecs(t.at, elapsed)}s</span>
                </div>
              ))}
            </div>
          )}

          {/* TWO ATTRIBUTED ROWS, never one. A single caption slot meant the
              user's words and the assistant's overwrote each other, so neither
              could be read back. */}
          {paused ? (
            <p className="text-[13px] text-white/85 truncate leading-tight">Paused \u2014 resume when you are ready</p>
          ) : idleIn !== null ? (
            <p className="text-[13px] text-amber-300/90 truncate leading-tight">
              Still there? Ending in {idleIn}s \u2014 just speak to stay
            </p>
          ) : userSaid || botSaid ? (
            <div className="leading-tight">
              {userSaid && (
                <p className="text-[12px] text-white/45 truncate">
                  <span className="text-white/30">You </span>{userSaid}
                </p>
              )}
              {botSaid && <p className="text-[13px] text-white/85 truncate">{botSaid}</p>}
            </div>
          ) : (
            <p className="text-[13px] text-white/85 truncate leading-tight">
              {status === "listening" ? "Just talk \u2014 interrupt me any time" : " "}
            </p>
          )}
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
