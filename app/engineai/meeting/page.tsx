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
  ExternalLink, Trash2, FileText, ArrowRightCircle, Search, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ClientPicker } from "@/components/meeting/ClientPicker";
import { useWorkspace } from "@/lib/contexts/WorkspaceContext";
import { useCustomer } from "@/lib/contexts/CustomerContext";
import { TriggerEngine, type LiveCard } from "@/lib/meeting/trigger-engine";
import { resolveClientFromText } from "@/lib/meeting/client-match";
import { MeetingCard } from "@/components/meeting-mode/MeetingCard";

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
// v2: key bumped 2026-07-20 to invalidate remembered PRE-FIX device choices —
// many users had the Jabra saved from before we learned speakerphone DSP
// cancels the far side. New explicit selections (post-warning) persist again.
const DEVICE_KEY = "engineai-live-mic-device-v2";

/** Speakerphones/headsets with onboard DSP (Jabra, Poly…) run HARDWARE echo
 *  cancellation: everything played through their own speaker — i.e. the
 *  meeting's far side — is subtracted from their own mic feed. Chrome's
 *  echoCancellation:false can't reach that DSP, so capturing from these
 *  devices only ever hears the local speaker. */
const CONFERENCE_MIC_RE = /jabra|poly[ _-]|plantronic|anker|emeet|owl labs|speak ?\d|evolve|airpod|headset|earbud|buds\b|arctis|wh-10|wf-10/i;
const BUILTIN_MIC_RE = /built-in|macbook|internal/i;
const SESSION_CAP_MS = 3 * 60 * 60 * 1000; // 3h absolute cap
const STILL_HERE_PROMPT_MS = 2 * 60 * 60 * 1000; // 2h "still in a meeting?"
// Ambient auto-lookup loop — fills quiet stretches where no keyword fired.
const AMBIENT_INTERVAL_MS = 20_000; // how often we consider sweeping
const AMBIENT_QUIET_MS = 25_000; // only sweep if nothing surfaced for this long
const AMBIENT_MIN_NEW_UTTS = 1; // …and at least this many new utterances since last sweep
const QUESTION_SWEEP_COOLDOWN_MS = 6_000; // min gap between question-triggered sweeps (they run in parallel now)

/** DATA-question detector for the immediate-lookup fast path. Real meetings
 *  are full of interpersonal/rhetorical questions ("what would you change?",
 *  "is that right?") — Jess's 1:1 turned every one of those into a forced
 *  sweep and a wall of repeated cards. Only fire when the question is about
 *  something the workspace can actually answer. */
const DATA_HINT = /\b(unit|units|cu|cus|contract|contracts|pipeline|budget|budgets|commission|commissioned|spend|cost|costs|price|pricing|rate|rates|revenue|remaining|deadline|deadlines|due|task|tasks|action items?|agreed|deliver(ed|ables)?|produced|published|renewal|renews?|utili[sz]ation|invoice[sd]?|retainer|scope)\b/;
// Event/date questions ("when is the next COP meeting?") deserve an immediate
// lookup too — the answer comes from the world_context web path, not Engine data.
const EVENT_HINT = /\b(when|what date|which date|where)\b[\s\S]*\b(next|upcoming|this year|meeting|meetings|summit|conference|event|events|cop\s?\d*|week|deadline|launch|held)\b|\b(next|upcoming)\b[\s\S]*\b(meeting|summit|conference|event|cop\b|week)\b/;
function isDataQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 8) return false;
  const interrogative = /\?\s*$/.test(t)
    || /^(what|how|when|where|who|why|which|can|could|do|does|did|is|are|was|were|have|has|will|would|should|tell me|remind me|give me)\b/.test(t);
  return interrogative && (DATA_HINT.test(t) || EVENT_HINT.test(t));
}
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

  // Cards
  const [deckCards, setDeckCards] = useState<LiveCard[]>([]);
  const [liveCards, setLiveCards] = useState<LiveCard[]>([]);
  const [pinnedCards, setPinnedCards] = useState<LiveCard[]>([]);
  const [drawerCards, setDrawerCards] = useState<LiveCard[]>([]);
  const [feedbacks, setFeedbacks] = useState<Record<string, number>>({});
  const [railCards, setRailCards] = useState<LiveCard[]>([]); // always-on client context
  const [railOpen, setRailOpen] = useState(true);
  // Full-transcript overlay (the old bottom tabs are gone — one feed instead)
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const engineRef = useRef<TriggerEngine | null>(null);

  // Setup form
  const [clientId, setClientId] = useState<string>("");
  const [title, setTitle] = useState("");
  // Meeting type is DYNAMIC: the classifier reads the conversation itself
  // (internal 1:1 vs client vs sales) — nobody has to declare it upfront.
  const [context, setContext] = useState(""); // prospect name, socials, reports, events…
  const [linkedChat, setLinkedChat] = useState<{ id: string; title: string; msgCount: number; fileCount: number } | null>(null);
  const linkedContextRef = useRef(""); // derived text context from the source chat
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { clientIdRef.current = clientId; }, [clientId]);
  // Kept in a ref so enrichCard (a stable callback) can name the client without
  // re-creating and going stale in the trigger-engine handlers.
  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);

  /** User context + linked-chat context, combined for digest/handoff. */
  const combinedContext = useCallback(() => {
    return [contextRef.current, linkedContextRef.current].filter((s) => s && s.trim()).join("\n\n") || undefined;
  }, []);
  const [attested, setAttested] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  // Meeting-tab audio mixed into the capture (the reliable path when the call
  // plays through a speakerphone/headset whose mic cancels the far side).
  const [tabAudioOn, setTabAudioOn] = useState(false);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const tabSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
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
  const contextRef = useRef("");
  const clientIdRef = useRef("");
  const mbMeetingIdRef = useRef<string | null>(null); // set when launched from meetingbrain.ai (?mb=)
  const silentFramesRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const wakeBcRef = useRef<BroadcastChannel | null>(null);
  const capPromptedRef = useRef(false);
  // Ambient auto-lookup loop
  const lastSurfaceAtRef = useRef(0); // last time a card entered the Now zone
  const lastAutoSweepCountRef = useRef(0);
  // Lookup concurrency: question-triggered sweeps run in PARALLEL (cap 3) so a
  // second question never gets silently dropped while a slow web-grounded
  // lookup is in flight; timer sweeps stay single-flight. Each in-flight
  // lookup shows a shimmer placeholder at the top of the feed.
  const activeSweepsRef = useRef(0);
  const [pendingLookups, setPendingLookups] = useState<{ id: string; label: string }[]>([]);
  const lastQuestionSweepAtRef = useRef(0);
  // Per-card cooldown for auto-surfaced cards (kind+receipt key → lastShownAt).
  // Applies to forced sweeps too — Jess's 1:1 got the same units card 5× when
  // forced sweeps bypassed dedup.
  // Content-aware card dedup: a card whose DATA hasn't changed never
  // resurfaces this session (the old 5-min cooldown let identical
  // "commissioned this month" cards repeat 3× in one call); changed data may
  // resurface after a short flicker guard.
  const autoShownRef = useRef<Map<string, { at: number; content: string }>>(new Map());
  // Most recent client mentioned by name in the transcript (any meeting type) —
  // lets the lookup answer with a CLIENT-SCOPED snapshot instead of a
  // workspace-wide dump when e.g. UBS comes up in an internal 1:1.
  const lastMentionedClientRef = useRef<{ id: string; name: string; at: number } | null>(null);
  // Latest sweep fn, reachable from the STT onmessage closure (created once at
  // session start, so it can't capture the useCallback directly).
  const runAmbientSweepRef = useRef<(force?: boolean) => void>(() => {});
  // Latest-ref so the STT closure (defined earlier) can auto-bind.
  const bindClientRef = useRef<(id: string, name: string) => void>(() => {});
  // Follow-the-conversation switching: first strong mention of a DIFFERENT
  // client offers a one-tap switch; a second within the window switches
  // automatically (multi-client weekly connects move fast).
  const pendingSwitchRef = useRef<{ id: string; firstAt: number } | null>(null);
  // Per-client briefing cache (cards + T1 trigger lexicons) so switching back
  // and forth between clients is instant.
  const deckCacheRef = useRef<Map<string, { deck: LiveCard[]; rail: LiveCard[]; specs: any[]; rawCards: any[] }>>(new Map());

  // Optional ?client= / ?thread= prefill from the opener. ?thread loads the
  // source EngineAI chat (messages + shared file names + summary) as context
  // for this meeting — so Live from a chat continues that chat's thread.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const c = sp.get("client");
      if (c) setClientId(c);
      const thread = sp.get("thread");
      if (thread) void loadLinkedChat(thread);
      const mb = sp.get("mb"); // launched from meetingbrain.ai's meeting panel
      if (mb) void loadMbMeeting(mb);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLinkedChat = async (threadId: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${threadId}`);
      if (!res.ok) return;
      const data = await res.json();
      const conv = data.conversation || {};
      const messages: any[] = data.messages || [];
      const fileNames = new Set<string>();
      for (const m of messages) {
        for (const a of m.attachments || []) if (a?.name) fileNames.add(a.name);
      }
      const parts: string[] = [`## Linked EngineAI chat: "${conv.title || conv.name_conversation || "Conversation"}"`];
      if (conv.summary || conv.document_summary) parts.push(`Summary: ${(conv.summary || conv.document_summary).slice(0, 1500)}`);
      if (fileNames.size) parts.push(`Files shared in the chat: ${Array.from(fileNames).slice(0, 20).join(", ")}`);
      parts.push("Conversation so far:");
      for (const m of messages.slice(-24)) {
        const role = m.role === "assistant" ? "assistant" : "user";
        const text = String(m.content || "").replace(/\s+/g, " ").trim();
        if (text) parts.push(`[${role}] ${text.slice(0, 800)}`);
      }
      linkedContextRef.current = parts.join("\n").slice(0, 8000);
      setLinkedChat({
        id: threadId,
        title: conv.title || conv.name_conversation || "Conversation",
        msgCount: messages.length,
        fileCount: fileNames.size,
      });
    } catch { /* best-effort — the meeting works without it */ }
  };

  /** Launched from meetingbrain.ai — load the meeting's context (title,
   *  attendees, notes, open next steps) into the setup form. Only the meeting
   *  id crossed the URL; details come from the user-scoped RPC. */
  const loadMbMeeting = async (meetingId: string) => {
    try {
      const res = await fetch(`/api/ai/meeting/mb-context?meetingId=${encodeURIComponent(meetingId)}`);
      if (!res.ok) { toast.error("Could not load the meeting from MeetingBrain"); return; }
      const { meeting } = await res.json();
      if (!meeting) return;
      mbMeetingIdRef.current = meetingId;
      if (meeting.title) setTitle(String(meeting.title).slice(0, 120));
      const attendees = Array.isArray(meeting.attendees)
        ? meeting.attendees.map((a: any) => (typeof a === "string" ? a : a?.name || a?.email || "")).filter(Boolean).join(", ")
        : typeof meeting.attendees === "string" ? meeting.attendees : "";
      const parts = [`## MeetingBrain meeting: "${meeting.title || "Meeting"}"${meeting.date ? ` (${meeting.date})` : ""}`];
      if (attendees) parts.push(`Attendees: ${attendees.slice(0, 500)}`);
      if (meeting.key_topics) {
        const topics = Array.isArray(meeting.key_topics) ? meeting.key_topics.join(", ") : String(meeting.key_topics);
        parts.push(`Key topics: ${topics.slice(0, 400)}`);
      }
      if (meeting.summary) parts.push(`Notes: ${meeting.summary}`);
      if (meeting.next_steps) parts.push(`Open next steps: ${meeting.next_steps}`);
      setContext(parts.join("\n"));
      // Best-effort client preselect from title + attendees — the picker stays
      // fully editable, so a miss just means the user picks manually.
      if (!clientIdRef.current) {
        const match = resolveClientFromText(`${meeting.title || ""} ${attendees}`, customersRef.current);
        if (match) setClientId(match.id);
      }
      toast.success("Meeting context loaded from MeetingBrain");
    } catch {
      toast.error("Could not load the meeting from MeetingBrain");
    }
  };

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
        else {
          // Default AWAY from speakerphones/headsets: their hardware AEC
          // cancels the meeting's far side out of their own mic feed.
          const builtin = mics.find((m) => BUILTIN_MIC_RE.test(m.label));
          const nonConference = mics.find((m) => !CONFERENCE_MIC_RE.test(m.label));
          const pick = builtin || nonConference || mics[0];
          if (pick) setDeviceId(pick.deviceId);
        }
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
          setContext(buf.context || "");
          if (buf.clientId) setClientId(buf.clientId);
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
          // Feed the trigger engine (T1 regex + T2 batching)
          engineRef.current?.ingest(u.idx, u.text);
          // Track client-name mentions (any meeting type) so lookups can scope
          // to the client being DISCUSSED. Binding is SILENT and reactive —
          // never a question chip. Strong evidence (real name spoken) binds or
          // switches automatically (toast = feedback, not a question); weak
          // evidence only feeds lastMentionedClientRef, which the reactive
          // lookup already uses to surface mentioned-client snapshot cards.
          {
            const match = resolveClientFromText(u.text, customersRef.current);
            if (match) {
              lastMentionedClientRef.current = { id: match.id, name: match.name, at: Date.now() };
              const bound = clientIdRef.current;
              if (!bound && match.strong) {
                // The client's actual name was spoken — bind automatically.
                void bindClientRef.current(match.id, match.name);
              } else if (bound && bound !== match.id && match.strong) {
                // Conversation moved to another client: a second strong mention
                // within 3 minutes follows the conversation. A single passing
                // comparison ("unlike Hiscox…") never switches — its snapshot
                // still surfaces reactively via lastMentionedClientRef.
                const pending = pendingSwitchRef.current;
                if (pending && pending.id === match.id && Date.now() - pending.firstAt < 180_000) {
                  void bindClientRef.current(match.id, match.name);
                } else {
                  pendingSwitchRef.current = { id: match.id, firstAt: Date.now() };
                }
              }
            }
          }
          // A direct DATA question deserves an immediate lookup — don't make
          // it wait for the ambient timer's quiet/new-utterance gates.
          if (isDataQuestion(u.text) && Date.now() - lastQuestionSweepAtRef.current > QUESTION_SWEEP_COOLDOWN_MS) {
            lastQuestionSweepAtRef.current = Date.now();
            runAmbientSweepRef.current(true);
          }
          // Crash buffer (local-only, cleared on end/discard)
          try {
            sessionStorage.setItem(
              CRASH_BUFFER_KEY,
              JSON.stringify({
                sessionId: sessionIdRef.current,
                title,
                context: contextRef.current,
                clientId: clientIdRef.current,
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

  const stopTabAudio = useCallback(() => {
    try { tabSourceRef.current?.disconnect(); } catch { /* noop */ }
    tabStreamRef.current?.getTracks().forEach((t) => t.stop());
    tabSourceRef.current = null;
    tabStreamRef.current = null;
    setTabAudioOn(false);
  }, []);

  /** Mix the meeting tab's audio into the capture. The AudioWorklet input sums
   *  every connected source, so mic + tab arrive as one mono stream. */
  const addTabAudio = useCallback(async () => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    if (!ctx || !node) return;
    try {
      const disp: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true, // Chrome requires a video surface in the picker
        audio: { echoCancellation: false, noiseSuppression: false },
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      });
      const audioTracks = disp.getAudioTracks();
      if (!audioTracks.length) {
        disp.getTracks().forEach((t) => t.stop());
        toast.error("No audio was shared — pick the MEETING TAB and tick 'Also share tab audio'");
        return;
      }
      disp.getVideoTracks().forEach((t) => t.stop()); // audio is all we need
      const audioStream = new MediaStream(audioTracks);
      const src = ctx.createMediaStreamSource(audioStream);
      src.connect(node);
      tabStreamRef.current = audioStream;
      tabSourceRef.current = src;
      setTabAudioOn(true);
      // User pressed the browser's own "Stop sharing" bar
      audioTracks[0].addEventListener("ended", () => {
        try { tabSourceRef.current?.disconnect(); } catch { /* noop */ }
        tabSourceRef.current = null;
        tabStreamRef.current = null;
        setTabAudioOn(false);
      });
    } catch (e: any) {
      if (e?.name !== "NotAllowedError") toast.error(`Tab audio failed: ${e?.message || e}`);
    }
  }, []);

  const teardownCapture = useCallback((opts?: { keepState?: boolean }) => {
    closingRef.current = true;
    try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    try { nodeRef.current?.port.close(); nodeRef.current?.disconnect(); } catch { /* noop */ }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { tabSourceRef.current?.disconnect(); } catch { /* noop */ }
    tabStreamRef.current?.getTracks().forEach((t) => t.stop());
    tabSourceRef.current = null;
    tabStreamRef.current = null;
    setTabAudioOn(false);
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

  /* ─────────────── Card lifecycle ─────────────── */

  /** Patch a card's insight wherever it currently lives. */
  const setCardInsight = useCallback((localId: string, insight: string) => {
    if (!insight) return;
    const patch = (list: LiveCard[]) => list.map((c) => (c.localId === localId ? { ...c, insight } : c));
    setLiveCards(patch); setPinnedCards(patch); setDrawerCards(patch); setRailCards(patch);
  }, []);

  /** Ask the lookup engine for a natural, conversation-aware framing of a card.
   *  Feeds it the transcript tail, client name and any linked-chat context so the
   *  sentence says why the number matters right now — including "gap" cards
   *  (e.g. no contract on file), which are exactly where framing adds value. */
  const enrichCard = useCallback((card: LiveCard) => {
    if (!sessionIdRef.current) return;
    const clientName = customersRef.current.find((c) => c.id === clientIdRef.current)?.name || "";
    const tail = utterancesRef.current.slice(-6).map((u) => u.text).filter(Boolean);
    fetch("/api/ai/meeting/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        enrich: {
          kind: card.kind,
          data: card.body,
          utterance: card.triggerText || "",
          tail,
          clientName,
          // User-entered context + linked chat + (if launched from
          // MeetingBrain) the meeting's title/attendees/notes.
          linkedContext: combinedContext() || "",
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.insight) setCardInsight(card.localId, d.insight); })
      .catch(() => {});
  }, [setCardInsight, combinedContext]);

  const handleCardFired = useCallback((card: LiveCard) => {
    setLiveCards((prev) => [card, ...prev].slice(0, 6));
    lastSurfaceAtRef.current = Date.now();
    if (!card.insight) enrichCard(card); // lookup/auto cards already carry one
    // Auto-expire to the drawer after 50s unless pinned — a second-screen is
    // glanced at intermittently, so 20s routinely expired before it was read.
    setTimeout(() => {
      setLiveCards((prev) => {
        const still = prev.find((c) => c.localId === card.localId);
        if (!still) return prev; // already dismissed/pinned
        engineRef.current?.report(card, "expired");
        setDrawerCards((d) => [{ ...card, state: "drawer" as const }, ...d].slice(0, 40));
        return prev.filter((c) => c.localId !== card.localId);
      });
    }, 50_000);
  }, []);

  const handleCardDrawerOnly = useCallback((card: LiveCard) => {
    setDrawerCards((prev) => [card, ...prev].slice(0, 40));
    enrichCard(card);
  }, [enrichCard]);

  /** Compile (or recompile) the pre-meeting deck and seed the context rail. */
  const compileDeck = useCallback(async (sessionId: string) => {
    try {
      const dres = await fetch("/api/ai/meeting/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await dres.json().catch(() => ({}));
      if (!dres.ok) return;
      const deck: LiveCard[] = (d.cards || []).map((c: any) => ({
        localId: `deck-${c.key}`,
        dbId: c.id,
        kind: c.kind,
        source: "deck" as const,
        title: c.title,
        body: c.body,
        receipt: c.receipt,
        firedAt: Date.now(),
        state: "drawer" as const,
      }));
      setDeckCards(deck);
      // Seed the always-on context rail with the highest-value briefing cards
      // (contract → last meeting → pipeline) so useful client context is visible
      // from the start, without waiting for a spoken trigger.
      const RANK: Record<string, number> = { deck_contract: 0, deck_last_meeting: 1, deck_pipeline: 2 };
      const rail = [...deck]
        .sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))
        .slice(0, 3)
        .map((c) => ({ ...c, localId: `rail-${c.kind}`, state: "drawer" as const }));
      setRailCards(rail);
      const specs = d.triggerSpecs || [];
      const rawCards = (d.cards || []).map((c: any) => ({
        id: c.id, kind: c.kind, key: c.key, title: c.title, body: c.body, receipt: c.receipt,
      }));
      if (clientIdRef.current) deckCacheRef.current.set(clientIdRef.current, { deck, rail, specs, rawCards });
      rail.forEach((c) => enrichCard(c)); // one natural line per rail card
      engineRef.current?.load(specs, rawCards);
    } catch { /* deck is best-effort; live capture still works */ }
  }, [enrichCard]);

  /** Bind a client to the live session (spoken-name auto-bind or the header
   *  dropdown), persist it, then load the deck so the rail/lookup/triggers
   *  scope to them. Silent by design — the toast is feedback, not a question. */
  const bindClient = useCallback(async (id: string, name: string) => {
    if (clientIdRef.current === id) return;
    pendingSwitchRef.current = null;
    const prev = clientIdRef.current;
    if (prev) {
      // Snapshot the outgoing client's briefing (keep its compiled trigger
      // specs from compile time) so switching BACK is instant.
      const prevEntry = deckCacheRef.current.get(prev);
      deckCacheRef.current.set(prev, {
        specs: prevEntry?.specs ?? [],
        rawCards: prevEntry?.rawCards ?? [],
        deck: deckCardsRef.current,
        rail: railCardsRef.current,
      });
    }
    clientIdRef.current = id;
    setClientId(id);
    try {
      await fetch("/api/ai/meeting/bind-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, clientId: id }),
      });
    } catch { /* best-effort */ }
    const cached = deckCacheRef.current.get(id);
    if (cached) {
      setDeckCards(cached.deck);
      setRailCards(cached.rail);
      engineRef.current?.load(cached.specs, cached.rawCards); // T1 lexicons must follow the client
      toast.success(`Switched to ${name}`);
      return;
    }
    if (sessionIdRef.current) await compileDeck(sessionIdRef.current);
    toast.success(prev ? `Switched to ${name}` : `Now tracking ${name}`);
  }, [compileDeck]);
  useEffect(() => {
    bindClientRef.current = (id: string, name: string) => { void bindClient(id, name); };
  }, [bindClient]);
  // State mirrors for the snapshot above (callbacks must not close over stale arrays)
  const deckCardsRef = useRef<LiveCard[]>([]);
  useEffect(() => { deckCardsRef.current = deckCards; }, [deckCards]);
  const railCardsRef = useRef<LiveCard[]>([]);
  useEffect(() => { railCardsRef.current = railCards; }, [railCards]);

  // Manual "look up the last point" — the safety net when a live trigger missed.
  const [lookingUp, setLookingUp] = useState(false);
  const handleManualLookup = useCallback(async () => {
    if (!sessionIdRef.current || lookingUp) return;
    const tail = utterancesRef.current.slice(-4).map((u) => u.text).filter(Boolean);
    if (tail.length === 0) { toast("Nothing has been said yet to look up."); return; }
    setLookingUp(true);
    const placeholderId = `pl-manual-${Date.now()}`;
    setPendingLookups((p) => [...p, { id: placeholderId, label: tail[tail.length - 1]?.slice(0, 90) || "the last point" }]);
    try {
      const res = await fetch("/api/ai/meeting/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, utterances: tail, context: combinedContext() }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.card) {
        const card: LiveCard = {
          localId: `lookup-${Date.now()}`,
          dbId: d.card.id || null,
          kind: d.card.kind,
          source: "manual",
          title: d.card.title,
          body: d.card.body,
          receipt: d.card.receipt,
          insight: d.card.insight,
          firedAt: Date.now(),
          state: "pinned", // manual lookups pin so they don't vanish
        };
        setPinnedCards((prev) => [card, ...prev]);
        lastSurfaceAtRef.current = Date.now();
      } else {
        toast(d?.note || "Nothing relevant found for the last point.");
      }
    } catch {
      toast.error("Lookup failed");
    } finally {
      setLookingUp(false);
      setPendingLookups((p) => p.filter((x) => x.id !== placeholderId));
    }
  }, [lookingUp, combinedContext]);

  // Ambient auto-lookup — during quiet stretches (nothing surfaced for a while)
  // run the full multi-category LOOKUP over the transcript tail so useful
  // context surfaces even when no keyword fired (the off-script "nothing came
  // up" case). One grok-4-1-fast call, gated on quiet + new speech + a repeat
  // guard so it can't get noisy or expensive.
  const runAmbientSweep = useCallback(async (force = false) => {
    if (!sessionIdRef.current || pausedRef.current) return;
    // Question sweeps run in parallel (cap 3); timer sweeps stay single-flight.
    if (activeSweepsRef.current >= (force ? 3 : 1)) return;
    if (!force) {
      // Timer path: only sweep quiet stretches with new speech. A forced
      // (question-triggered) sweep skips both gates — the user just asked.
      if (Date.now() - lastSurfaceAtRef.current < AMBIENT_QUIET_MS) return; // something surfaced recently
      const count = utterancesRef.current.length;
      if (count - lastAutoSweepCountRef.current < AMBIENT_MIN_NEW_UTTS) return; // nothing new said
    }
    lastAutoSweepCountRef.current = utterancesRef.current.length;
    const tail = utterancesRef.current.slice(-6).map((u) => u.text).filter(Boolean);
    if (tail.length === 0) return;
    activeSweepsRef.current++;
    // Immediate feedback: a shimmer placeholder while the lookup runs — for
    // forced sweeps always (the user just asked), for timer sweeps too (cheap
    // honesty about background work).
    const placeholderId = `pl-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setPendingLookups((p) => [...p, { id: placeholderId, label: tail[tail.length - 1]?.slice(0, 90) || "the last point" }]);
    try {
      // Scope hint: a client mentioned by name in the last ~90s lets the
      // server answer with THAT client's snapshot instead of workspace-wide.
      const mention = lastMentionedClientRef.current;
      const clientHint = mention && Date.now() - mention.at < 90_000 ? { id: mention.id, name: mention.name } : undefined;
      // Tell the classifier what's already on screen so it picks something NEW
      // (or none) instead of re-surfacing the same category every sweep.
      const recentKinds = Array.from(autoShownRef.current.entries())
        .filter(([, v]) => Date.now() - v.at < 10 * 60_000)
        .map(([k]) => k.split(":")[0]);
      const res = await fetch("/api/ai/meeting/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, utterances: tail, auto: true, context: combinedContext(), clientHint, recentKinds }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.card) {
        // Per-card cooldown (kind+receipt, 5 min) — applies to forced sweeps
        // too, so repeated questions can't wall the screen with duplicates.
        const key = `${d.card.kind}:${d.card.receipt?.label || d.card.receipt?.meeting_title || ""}`;
        const content = `${d.card.title}|${d.card.insight || ""}|${JSON.stringify(d.card.body || {})}`;
        const prev = autoShownRef.current.get(key);
        // Show only when the card is new for this session OR its data actually
        // changed (60s flicker guard). Identical data never repeats.
        if (!prev || (prev.content !== content && Date.now() - prev.at > 60_000)) {
          autoShownRef.current.set(key, { at: Date.now(), content });
          handleCardFired({
            localId: `auto-${Date.now()}`,
            dbId: d.card.id || null,
            kind: d.card.kind,
            source: "auto",
            title: d.card.title,
            body: d.card.body,
            receipt: d.card.receipt,
            insight: d.card.insight,
            firedAt: Date.now(),
            state: "live",
          });
        }
      }
    } catch { /* transient — try again next tick */ }
    finally {
      activeSweepsRef.current--;
      setPendingLookups((p) => p.filter((x) => x.id !== placeholderId));
    }
  }, [handleCardFired, combinedContext]);

  const pinCard = (card: LiveCard) => {
    engineRef.current?.report(card, "pinned");
    setPinnedCards((prev) => (prev.some((c) => c.localId === card.localId) ? prev : [{ ...card, state: "pinned" }, ...prev]));
    setLiveCards((prev) => prev.filter((c) => c.localId !== card.localId));
    setDrawerCards((prev) => prev.filter((c) => c.localId !== card.localId));
  };

  const dismissCard = (card: LiveCard, from: "live" | "pinned" | "drawer") => {
    engineRef.current?.report(card, "dismissed");
    if (from === "live") setLiveCards((prev) => prev.filter((c) => c.localId !== card.localId));
    if (from === "pinned") setPinnedCards((prev) => prev.filter((c) => c.localId !== card.localId));
    if (from === "drawer") setDrawerCards((prev) => prev.filter((c) => c.localId !== card.localId));
  };

  const rateCard = (card: LiveCard, v: number) => {
    engineRef.current?.report(card, "feedback", v);
    setFeedbacks((prev) => ({ ...prev, [card.localId]: v }));
  };

  const pinDeckCard = (card: LiveCard) => {
    setPinnedCards((prev) => (prev.some((c) => c.localId === card.localId) ? prev : [{ ...card, state: "pinned" }, ...prev]));
  };

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
          mbMeetingId: mbMeetingIdRef.current || undefined,
          title: title || (clientId ? `Meeting — ${customers.find((c) => c.id === clientId)?.name || "client"}` : "Live meeting"),
          meetingType: "general",
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
      setLiveCards([]); setPinnedCards([]); setDrawerCards([]); setDeckCards([]); setRailCards([]); setFeedbacks({});
      lastSurfaceAtRef.current = Date.now();
      lastAutoSweepCountRef.current = 0;
      autoShownRef.current.clear();
      lastMentionedClientRef.current = null;
      pendingSwitchRef.current = null;
      setPendingLookups([]);
      activeSweepsRef.current = 0;
      deckCacheRef.current = new Map();

      // Spin up the trigger engine + compile the pre-meeting deck (parallel
      // with capture start — the deck lands within ~1s and cards can fire).
      const engine = new TriggerEngine(sessionId, handleCardFired, handleCardDrawerOnly);
      engineRef.current = engine;
      void compileDeck(sessionId);

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
          context: combinedContext(),
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

  const [handingOff, setHandingOff] = useState(false);

  const handleContinueInEngineAI = async () => {
    if (!sessionIdRef.current) return;
    setHandingOff(true);
    try {
      const res = await fetch("/api/ai/meeting/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          context: combinedContext(),
          digest: draftDigest || undefined,
          transcript: utterancesRef.current.map((u) => ({ speaker: u.speaker, text: u.text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.conversationId) throw new Error(data.error || "Handoff failed");
      // The transcript now lives in a conversation the user chose to keep —
      // clear the ephemeral copies here.
      utterancesRef.current = [];
      setUtterances([]);
      sessionStorage.removeItem(CRASH_BUFFER_KEY);
      setStage("saved");
      // Open the working conversation in the main EngineAI surface
      window.open(`/?thread=${data.conversationId}`, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Could not continue in EngineAI");
    } finally {
      setHandingOff(false);
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

  // Ambient auto-lookup loop (live only)
  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => { void runAmbientSweep(); }, AMBIENT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [stage, runAmbientSweep]);

  // Keep the STT-closure-reachable ref pointing at the latest sweep
  useEffect(() => {
    runAmbientSweepRef.current = (force?: boolean) => { void runAmbientSweep(force); };
  }, [runAmbientSweep]);

  // Unload safety: terminate the socket; crash buffer already mirrors state
  useEffect(() => {
    const onUnload = () => {
      try { wsRef.current?.send(JSON.stringify({ type: "Terminate" })); } catch { /* noop */ }
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  useEffect(() => () => { teardownCapture(); engineRef.current?.destroy(); bcRef.current?.close(); wakeBcRef.current?.close(); }, [teardownCapture]);

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
            {/* Searchable, not a native <select>: mid-call you need the right
                client in a couple of keystrokes, and a 100-option select also
                rendered every client name into the DOM (which is why copying
                the feed used to sweep up the whole client list). */}
            <ClientPicker
              compact
              customers={customers}
              clientId={clientId}
              onChange={(id) => {
                if (!id) return; // no unbinding mid-meeting — pick another client instead
                const c = customers.find((x) => x.id === id);
                if (c) void bindClient(c.id, c.name);
              }}
              allowClear={false}
            />
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
      {stage === "live" && !tabAudioOn && CONFERENCE_MIC_RE.test(devices.find((d) => d.deviceId === deviceId)?.label || "") && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="min-w-0">
            This mic&apos;s own echo cancellation removes the meeting&apos;s far side — you&apos;ll only capture yourself.
            Switch to the laptop mic, or
          </span>
          <button onClick={addTabAudio} className="shrink-0 underline font-medium hover:opacity-80">
            capture the meeting tab&apos;s audio
          </button>
        </div>
      )}
      {stage === "live" && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b bg-background">
          {tabAudioOn ? (
            <>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Meeting tab audio captured
              </span>
              <button onClick={stopTabAudio} className="underline hover:text-foreground">stop</button>
            </>
          ) : (
            <button onClick={addTabAudio} className="underline hover:text-foreground" title="Share the meeting tab (tick 'Also share tab audio') so the far side is transcribed even with a headset or speakerphone">
              + Add meeting tab audio (headset/speakerphone users)
            </button>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <main className={cn("flex-1 min-h-0", stage === "live" ? "overflow-hidden" : "overflow-y-auto")}>
        {stage === "setup" && (
          <SetupScreen
            customers={customers}
            clientId={clientId} setClientId={setClientId}
            title={title} setTitle={setTitle}
            context={context} setContext={setContext}
            linkedChat={linkedChat} onUnlinkChat={() => { linkedContextRef.current = ""; setLinkedChat(null); }}
            devices={devices} deviceId={deviceId} setDeviceId={setDeviceId}
            attested={attested} setAttested={setAttested}
            starting={starting}
            statusDetail={statusDetail}
            onStart={handleStart}
          />
        )}

        {stage === "live" && (
          <div className="flex flex-col h-full min-h-0">
            {/* ── FEED — every insight in ONE stream: pinned stick on top, then
                   newest-first. Briefing (deck) cards seed the feed at bind so
                   the window is never empty; surfaced cards push them down and
                   nothing ever vanishes into a hidden tab. ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-2">
              {pendingLookups.map((p) => (
                <div key={p.id} className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5 flex items-center gap-2.5 animate-pulse">
                  <Search className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-foreground/70">Looking up…</div>
                    <div className="text-[11px] text-muted-foreground/60 truncate">&ldquo;{p.label}&rdquo;</div>
                  </div>
                </div>
              ))}
              {pinnedCards.map((c) => (
                <MeetingCard key={c.localId} card={c} onDismiss={() => dismissCard(c, "pinned")}
                  onFeedback={(v) => rateCard(c, v)} feedback={feedbacks[c.localId] ?? null} />
              ))}
              {(() => {
                const railKinds = new Set(railCards.map((r) => r.kind));
                const feed = [...liveCards, ...drawerCards, ...deckCards.filter((c) => !railKinds.has(c.kind))]
                  .filter((c, i, a) => a.findIndex((x) => x.localId === c.localId) === i)
                  .sort((a, b) => (b.firedAt || 0) - (a.firedAt || 0));
                if (pinnedCards.length === 0 && feed.length === 0 && pendingLookups.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center text-center h-full py-8 px-4">
                      <div className="h-9 w-9 rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
                        <Radio className="h-4 w-4 text-amber-500/70" />
                      </div>
                      <p className="text-[13px] font-medium text-foreground/80">Listening for the moments that matter</p>
                      <p className="text-[11px] mt-1 leading-snug text-muted-foreground/60 max-w-[15rem]">
                        {clientId
                          ? "Compiling the client briefing — insights land here as the conversation flows."
                          : "Name a client and their briefing loads automatically; insights, commitments and event background land here as they come up."}
                      </p>
                    </div>
                  );
                }
                return feed.map((c) =>
                  c.source === "deck" ? (
                    <MeetingCard key={c.localId} card={c} onPin={() => pinDeckCard(c)} />
                  ) : (
                    <MeetingCard key={c.localId} card={c}
                      onPin={() => pinCard(c)}
                      onDismiss={() => dismissCard(c, c.state === "drawer" ? "drawer" : "live")}
                      onFeedback={(v) => rateCard(c, v)} feedback={feedbacks[c.localId] ?? null} />
                  )
                );
              })()}
            </div>

            {/* ── CONTEXT RAIL — always-on client facts (collapsible) ── */}
            {railCards.length > 0 && (
              <div className="shrink-0 border-t bg-muted/30">
                <button
                  onClick={() => setRailOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-2.5 py-1 text-[10px] uppercase tracking-wide font-medium text-muted-foreground/70 hover:text-foreground"
                >
                  <span>On this client</span>
                  {railOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                </button>
                {railOpen && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {railCards.map((c) => (
                      <MeetingCard key={c.localId} card={c} variant="rail" />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Live transcript TICKER — the "it's hearing me" trust signal,
                   one glanceable strip; tap for the full transcript ── */}
            <button
              onClick={() => setTranscriptOpen(true)}
              className="shrink-0 border-t px-2.5 py-1.5 text-left bg-card/40 hover:bg-card/70 transition-colors"
              title="Open the full transcript"
            >
              <div className="flex items-center gap-1.5">
                <Mic className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[11px] text-muted-foreground/80 truncate leading-snug flex-1">
                  {partial || utterances[utterances.length - 1]?.text || "Listening…"}
                </span>
                <ChevronUp className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              </div>
            </button>
            {transcriptOpen && (
              <div className="fixed inset-0 z-50 bg-background flex flex-col">
                <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
                  <span className="text-sm font-semibold">Transcript <span className="text-[11px] font-normal text-muted-foreground">· ephemeral, nothing recorded</span></span>
                  <button onClick={() => setTranscriptOpen(false)}
                    className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-accent">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <TranscriptPane utterances={utterances} partial={partial} />
                </div>
              </div>
            )}

            {/* ── Manual safety net: force a lookup on the last thing said ── */}
            <div className="shrink-0 border-t p-2 bg-card/60">
              <button
                onClick={handleManualLookup}
                disabled={lookingUp}
                className="w-full h-9 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {lookingUp ? "Looking it up…" : "Look up the last point"}
              </button>
            </div>
          </div>
        )}

        {stage === "review" && (
          <ReviewScreen
            digest={draftDigest}
            setDigest={setDraftDigest}
            loading={digestLoading}
            utteranceCount={utterances.length}
            hasClient={!!clientId}
            handingOff={handingOff}
            onContinue={handleContinueInEngineAI}
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

/* ─────────────── Client picker (alphabetical + live search) ─────────────── */


/* ─────────────── Setup / consent screen ─────────────── */

function SetupScreen(props: {
  customers: { id: string; name: string }[];
  clientId: string; setClientId: (v: string) => void;
  title: string; setTitle: (v: string) => void;
  context: string; setContext: (v: string) => void;
  linkedChat: { id: string; title: string; msgCount: number; fileCount: number } | null;
  onUnlinkChat: () => void;
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
        <ClientPicker
          customers={props.customers}
          clientId={props.clientId}
          onChange={props.setClientId}
        />

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Meeting title</span>
          <input
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
            placeholder="e.g. Hiscox monthly check-in"
            className="mt-1 w-full h-9 rounded-lg border bg-background px-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Context <span className="opacity-60 font-normal">(optional)</span></span>
          <textarea
            value={props.context}
            onChange={(e) => props.setContext(e.target.value)}
            rows={3}
            placeholder="Prospect name, their social channels, recent reports / events, anything useful to have on hand…"
            className="mt-1 w-full rounded-lg border bg-background p-2 text-sm leading-snug resize-y"
          />
          <span className="block mt-1 text-[10px] text-muted-foreground/70">
            Fed into the meeting summary and carried through if you continue in EngineAI afterward.
          </span>
        </label>

        {props.linkedChat && (
          <div className="rounded-lg border bg-primary/5 border-primary/30 p-2 flex items-start gap-2">
            <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate">Linked chat: {props.linkedChat.title}</div>
              <div className="text-[10px] text-muted-foreground">
                {props.linkedChat.msgCount} message{props.linkedChat.msgCount !== 1 ? "s" : ""}
                {props.linkedChat.fileCount > 0 ? ` · ${props.linkedChat.fileCount} file${props.linkedChat.fileCount !== 1 ? "s" : ""}` : ""} loaded as context
              </div>
            </div>
            <button onClick={props.onUnlinkChat} className="text-muted-foreground/50 hover:text-foreground text-xs" title="Remove linked chat">✕</button>
          </div>
        )}

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
          {CONFERENCE_MIC_RE.test(props.devices.find((d) => d.deviceId === props.deviceId)?.label || "") ? (
            <span className="mt-1 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
              <span>
                This looks like a speakerphone/headset. Its built-in echo cancellation removes the meeting&apos;s
                far side from its own mic — EngineAI would only hear YOU. Pick the laptop&apos;s built-in
                microphone here (keep using the {props.devices.find((d) => d.deviceId === props.deviceId)?.label?.split(" ")[0] || "device"} for
                the call itself), or use &quot;Add meeting tab audio&quot; once live.
              </span>
            </span>
          ) : (
            <span className="block mt-1 text-[10px] text-muted-foreground/70">
              Tip: use the LAPTOP mic here even when a speakerphone runs the call — it hears both you and the
              far side from the speaker. Speakerphone/headset mics cancel the far side out (hardware echo
              cancellation). Wearing headphones? Use &quot;Add meeting tab audio&quot; once live.
            </span>
          )}
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
  hasClient: boolean;
  handingOff: boolean;
  onContinue: () => void;
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

      <div className="space-y-2 pt-1">
        {/* Primary: carry everything into a working EngineAI conversation */}
        <button
          onClick={props.onContinue}
          disabled={props.handingOff}
          className="w-full h-11 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {props.handingOff ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightCircle className="h-4 w-4" />}
          Continue in EngineAI{props.hasClient ? " (linked to client)" : ""}
        </button>
        <p className="text-[11px] text-muted-foreground -mt-1 text-center">
          Opens a new chat with the transcript, summary, actions &amp; context — carry on drafting follow-ups there.
        </p>

        <div className="flex gap-2">
          <button
            onClick={props.onSave}
            disabled={!d?.summary}
            className={cn(
              "flex-1 h-9 rounded-xl text-sm font-medium border",
              d?.summary ? "hover:bg-accent" : "text-muted-foreground cursor-not-allowed"
            )}
            title="Save just the summary to the meeting thread — transcript not kept"
          >
            Save summary only
          </button>
          <button
            onClick={props.onDiscard}
            className="h-9 px-3 rounded-xl border text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Transcript pane (own scroll, contained) ─────────────── */

function TranscriptPane({ utterances, partial }: { utterances: Utterance[]; partial: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Scroll only when a *finalised* utterance lands — not on every interim
  // partial. This keeps the pane from thrashing, and it now scrolls only
  // itself (it used to share the card viewport and scroll cards off-screen).
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [utterances.length]);
  return (
    <div ref={ref} className="h-full overflow-y-auto px-2.5 pb-2 pt-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/50 mb-1">In-memory only · not recorded</div>
      {utterances.length === 0 && !partial && (
        <p className="text-[13px] text-muted-foreground/50 py-4 text-center">Transcript appears here as people speak.</p>
      )}
      {utterances.slice(-40).map((u) => (
        <p key={u.idx} className="text-[13px] leading-snug text-muted-foreground mb-0.5">
          {u.speaker && <span className="text-[10px] font-semibold mr-1 align-middle text-muted-foreground/60">{u.speaker}</span>}
          {u.text}
        </p>
      ))}
      {partial && <p className="text-[13px] leading-snug text-muted-foreground/40 italic">{partial}</p>}
    </div>
  );
}
