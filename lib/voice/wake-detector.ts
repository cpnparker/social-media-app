/**
 * On-device wake phrase detection — "Orac" (also accepts "Hey Orac").
 *
 * PRIVACY: everything in this file runs locally in the browser. Audio is
 * captured into a short rolling buffer, transcribed by a local Whisper-tiny
 * model (transformers.js / WASM, cached in IndexedDB after first download),
 * and discarded. Nothing — audio, transcripts, or events — leaves the
 * machine until the wake phrase fires.
 *
 * Pipeline: mic @16kHz → energy VAD (near-zero CPU in silence) → on speech,
 * accumulate up to ~3s → local ASR on the chunk → phrase match → onWake().
 *
 * The detector is interface-shaped so a dedicated trained wake-word model
 * (openWakeWord/Porcupine ONNX) can replace the ASR layer later without
 * touching callers.
 */

import { extractFeatures, dtwSimilarity, trimSilence, type WakeTemplate } from "./mel";
import { saveEnrollment } from "./wake-templates";

export type WakeDetectorState = "loading" | "listening" | "stopped" | "error";

interface WakeDetectorOptions {
  /** command = what the user said AFTER the wake word ("Orac, what meetings
   *  have I had today" → "what meetings have I had today") so the session
   *  can answer immediately instead of greeting. */
  onWake: (command?: string) => void;
  onStateChange?: (state: WakeDetectorState, detail?: string) => void;
  /** 0..1 — model download progress during "loading" */
  onProgress?: (pct: number) => void;
  /** Every locally-transcribed utterance (for the UI "heard:" readout — stays on-device) */
  onHeard?: (text: string) => void;
  /** Template-match score per analysed window (drives the enrollment test meter) */
  onMatchScore?: (score: number, threshold: number) => void;
}

/** Tiny Levenshtein for wake-word fuzzy matching (short words only). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

/** Whisper renders "Orac" several ways — single-token variants… */
const ORAC_TOKENS = ["orac", "orack", "orak", "oracc", "orach", "auroch", "aurac", "aurack"];
/** …or split into two tokens ("Oh rack", "Or ack"). */
const ORAC_FIRST = ["oh", "o", "or", "aw", "ore", "oar", "your"];
const ORAC_SECOND = ["rack", "rac", "rak", "wrack", "ack", "rock"];

/** Looser Orac-ish check used ONLY to confirm a gray-zone acoustic match —
 *  both signals together justify a wake that neither alone would.
 *  MUST start with "or"/"aur": plain first-letter matching let "okay"
 *  (lev 2 from orac, whisper's favourite noise hallucination) confirm any
 *  ambient sound that scored 0.6 — the random-wake bug. */
function oracIsh(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length >= 4 && (t.startsWith("or") || t.startsWith("aur")) && lev(t, "orac") <= 2) return true;
    if (i > 0 && ORAC_SECOND.includes(t) && ORAC_FIRST.includes(toks[i - 1])) return true;
  }
  return false;
}

/** Extract the spoken command following the wake word. If no wake token is
 *  found in the text but the acoustic match fired (assumeLeadingWake), the
 *  first word is treated as the (mis-transcribed) wake word. Returns
 *  undefined when the utterance was just the wake word alone. */
function stripWakeCommand(text: string, assumeLeadingWake: boolean): string | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");
  let idx = -1;
  for (let i = 0; i < words.length && i < 4; i++) {
    const t = norm(words[i]);
    if (t.length >= 4 && (t.startsWith("or") || t.startsWith("aur")) && lev(t, "orac") <= 2) { idx = i; break; }
    if (ORAC_TOKENS.includes(t)) { idx = i; break; }
    if (i + 1 < words.length && ORAC_FIRST.includes(t) && ORAC_SECOND.includes(norm(words[i + 1]))) { idx = i + 1; break; }
  }
  if (idx === -1) {
    if (!assumeLeadingWake) return undefined;
    idx = 0; // acoustic wake fired; first word is the mangled "Orac"
  }
  const rest = words.slice(idx + 1).join(" ").replace(/^[,.!?\s]+/, "").trim();
  return rest.split(/\s+/).filter(Boolean).length >= 2 ? rest : undefined;
}

/** Wake match for "Orac" (with or without a leading "hey").
 *  Deliberately does NOT match "Oracle" (a real word that appears in tech
 *  conversation) — lev<=1 against "orac" excludes it. */
export function isWakePhrase(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length >= 4 && (ORAC_TOKENS.includes(t) || lev(t, "orac") <= 1)) return true;
    if (i > 0 && ORAC_SECOND.includes(t) && ORAC_FIRST.includes(toks[i - 1])) return true;
  }
  return false;
}

const SAMPLE_RATE = 16000; // Whisper-native
const SPEECH_RMS = 0.008; // energy gate (AGC mics can run quiet)
const MIN_SPEECH_MS = 300; // ignore coughs/clicks
const MAX_CHUNK_MS = 3000; // wake phrase fits comfortably
const TRAIL_SILENCE_MS = 350; // end-of-utterance (snappier than the old 450)
const PRE_ROLL_FRAMES = 3; // ~384ms kept before speech onset — the energy
// gate detects speech a beat late, so without this the leading syllable
// ("O-" of "Orac") is clipped from the chunk and transcription misses it.
// Sliding-window detection: with WebGPU inference at ~500ms we can decode
// DURING speech instead of waiting for the utterance to end — faster wake
// and multiple chances to catch the phrase.
const DECODE_EVERY_MS = 800;
const MIN_SPEECH_FOR_INTERIM_MS = 500;
/** Template matching only applies to the START of an utterance (wake words
 *  lead: "Orac" or "Orac, what's my pipeline"). Subsequence DTW searched
 *  across whole sentences finds an "Orac-shaped" half-second in any
 *  conversation — that's how "any sound triggers it" happened. */
const MAX_WAKE_UTTERANCE_MS = 1600;
const WAKE_PREFIX_SAMPLES = Math.round(1.6 * SAMPLE_RATE);
/** Ignore matches briefly after (re)start — trailing room audio right after
 *  a conversation closes must not instantly re-wake. */
const START_COOLDOWN_MS = 1200;
/** Gray zone: template score below threshold but well above the noise floor.
 *  Alone it does NOT wake — but combined with an Orac-ish word in the local
 *  transcript of the same utterance, it does. Catches session drift (real
 *  "Orac" scoring slightly low on a different day/mic distance). */
const GRAY_MIN = 0.6;
const GRAY_WINDOW_MS = 2500;
/** Max stored templates: the enrolled takes plus utterances learned from
 *  confirmed wakes — the set adapts to real usage across sessions. */
const MAX_TEMPLATES = 6;
const WINDOW_SAMPLES = Math.round(2.4 * SAMPLE_RATE); // interim decode window

const BASE_MODEL = "onnx-community/whisper-base.en"; // WebGPU: bigger + still fast
const TINY_MODEL = "onnx-community/whisper-tiny.en"; // WASM fallback

export class WakeDetector {
  private opts: WakeDetectorOptions;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private asr: any = null;
  private buffer: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private bufferedMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private inSpeech = false;
  private transcribing = false;
  private stopped = true;
  private lastDecodeAt = 0;
  private lastHeard = "";
  private woke = false;
  private cooldownUntil = 0;
  private grayUntil = 0;
  private grayAudio: Float32Array | null = null;
  /** Interim acoustic hit — wake fires at utterance END so the full spoken
   *  command ("Orac, what meetings…") is captured and forwarded. */
  private pendingWake = false;
  /** Final acoustic hit — transcribe() fires the wake with the command. */
  private wakeViaTemplate = false;
  /** Enrolled voice templates (MFCC features). When present, template
   *  matching is the PRIMARY wake signal; ASR text match stays as backup. */
  private templates: WakeTemplate[] = [];
  private threshold = 0.78;
  /** Test mode: report scores/heard text but never fire onWake. */
  private testMode = false;
  /** Enrollment capture: next finished utterance is delivered here raw. */
  private captureResolve: ((audio: Float32Array | null) => void) | null = null;
  /** True from start() until stop() — makes start() idempotent. */
  private running = false;
  /** Bumped by stop() to cancel starts that are mid-await. */
  private gen = 0;
  /** EVERY mic stream ever acquired — stop() kills them all. A start/stop
   *  race must never be able to leak a live microphone. */
  private allStreams = new Set<MediaStream>();

  constructor(opts: WakeDetectorOptions) {
    this.opts = opts;
  }

  /** Install enrolled voice templates + calibrated wake threshold. */
  setTemplates(templates: WakeTemplate[], threshold: number) {
    this.templates = templates;
    this.threshold = threshold;
  }

  /** Test mode: full detection runs (scores, heard text) but onWake never fires. */
  setTestMode(on: boolean) {
    this.testMode = on;
    if (!on) this.woke = false;
  }

  /** Enrollment: resolves with the next finished utterance's raw 16kHz audio
   *  (null if the detector stops first). Detection is suspended meanwhile. */
  captureUtterance(): Promise<Float32Array | null> {
    return new Promise((resolve) => {
      this.captureResolve?.(null); // supersede any previous request
      this.captureResolve = resolve;
    });
  }

  private fireWake(command?: string) {
    if (this.testMode || this.woke) return;
    if (Date.now() < this.cooldownUntil) return; // post-start settle window
    this.woke = true; // single-fire across interim + final decodes
    this.pendingWake = false;
    this.wakeViaTemplate = false;
    this.opts.onWake(command);
  }

  /** Template match on an audio window (silence-trimmed); reports + returns
   *  the best score. Sets up the gray-zone window for text confirmation. */
  private matchTemplates(audio: Float32Array): number {
    if (this.templates.length === 0) return 0;
    const trimmed = trimSilence(audio);
    const cand = extractFeatures(trimmed);
    let best = 0;
    for (const t of this.templates) {
      const s = dtwSimilarity(t, cand);
      if (s > best) best = s;
    }
    this.opts.onMatchScore?.(best, this.threshold);
    // NOTE: no firing here — the caller decides. Wakes are deferred to
    // utterance end so the spoken command after "Orac" travels with them.
    // No learning from score-only matches either: a false positive would
    // poison the template set (learning needs text evidence; see transcribe).
    if (best < this.threshold && best >= GRAY_MIN) {
      this.grayUntil = Date.now() + GRAY_WINDOW_MS;
      this.grayAudio = trimmed;
    }
    return best;
  }

  /** Add a TEXT-CONFIRMED wake utterance as a template — the set learns the
   *  user's voice across sessions/mics instead of degrading. */
  private maybeLearn(trimmedAudio: Float32Array, score: number) {
    if (this.testMode || this.templates.length >= MAX_TEMPLATES) return;
    // Strong matches add little; learn from the informative band.
    if (score > this.threshold + 0.12) return;
    try {
      const features = extractFeatures(trimmedAudio);
      if (features.frames < 12) return;
      this.templates = [...this.templates, features];
      saveEnrollment(this.templates, this.threshold);
      console.debug(`[WakeDetector] learned template #${this.templates.length} (score ${score.toFixed(2)})`);
    } catch { /* learning is best-effort */ }
  }

  async start() {
    // Idempotent: callers (React effects re-running, rapid toggles) must not
    // be able to stack concurrent starts — that's how mic streams leak.
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.woke = false;
    this.lastHeard = "";
    this.cooldownUntil = Date.now() + START_COOLDOWN_MS;
    this.grayUntil = 0;
    this.grayAudio = null;
    this.pendingWake = false;
    this.wakeViaTemplate = false;
    const gen = ++this.gen;
    this.opts.onStateChange?.("loading");
    try {
      // Lazy-load the ASR model (~40MB once, then IndexedDB-cached).
      // transformers.js is loaded from CDN at runtime with webpackIgnore:
      // bundling it breaks the Next build (its ONNX runtime bundles use
      // import.meta in ways webpack can't parse), and it's browser-only.
      // The URL constant keeps TypeScript happy (Promise<any>) and webpack
      // out of the module graph entirely.
      if (!this.asr) {
        const TRANSFORMERS_CDN =
          "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";
        const mod: any = await import(/* webpackIgnore: true */ TRANSFORMERS_CDN);
        const { pipeline } = mod;
        const progress_callback = (p: any) => {
          if (p?.status === "progress" && p?.total) {
            this.opts.onProgress?.(Math.min(1, p.loaded / p.total));
          }
        };
        // fp32 encoder + q4 decoder is the configuration the official
        // transformers.js whisper examples use — the q8 merged decoder
        // trips ORT's QDQ loader ("Missing required scale ...").
        // WebGPU runs whisper-base.en (~half the error rate of tiny) at
        // ~500ms/decode — verified in-browser. WASM falls back to tiny.
        const dtype = { encoder_model: "fp32", decoder_model_merged: "q4" };
        const gpu = (navigator as any).gpu;
        const hasWebGPU = !!gpu && !!(await gpu.requestAdapter?.().catch(() => null));
        const attempts: { model: string; opts: any }[] = [
          ...(hasWebGPU ? [{ model: BASE_MODEL, opts: { device: "webgpu", dtype, progress_callback } }] : []),
          { model: TINY_MODEL, opts: { dtype, progress_callback } },
          { model: TINY_MODEL, opts: { dtype: "fp32", progress_callback } },
        ];
        let lastErr: unknown;
        for (const a of attempts) {
          try {
            this.asr = await pipeline("automatic-speech-recognition", a.model, a.opts);
            console.debug(`[WakeDetector] engine: ${a.model} (${a.opts.device || "wasm"})`);
            break;
          } catch (err) {
            lastErr = err;
            this.asr = null;
          }
        }
        if (!this.asr) throw lastErr;
        // Warm up WASM + session so the FIRST real utterance isn't dropped
        // behind a multi-second cold inference (audio is gated while
        // transcribing). ~2s once, then inference is fast.
        try {
          await this.asr(new Float32Array(8000));
        } catch { /* warmup is best-effort */ }
      }
      if (this.stopped || gen !== this.gen) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      // Register BEFORE any further await/assignment — stop() must always
      // be able to find and kill this stream, even mid-race.
      this.allStreams.add(stream);
      if (this.stopped || gen !== this.gen) {
        stream.getTracks().forEach((t) => t.stop());
        this.allStreams.delete(stream);
        return;
      }
      this.stream = stream;

      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
      const frameMs = (2048 / SAMPLE_RATE) * 1000;

      this.processor.onaudioprocess = (e) => {
        // Keep CAPTURING during transcription — only starting a new decode is
        // gated. (The old early-return dropped mid-utterance audio.)
        if (this.stopped) return;
        const f32 = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
        const rms = Math.sqrt(sum / f32.length);
        const isSpeech = rms > SPEECH_RMS;

        if (isSpeech && !this.inSpeech) {
          // Speech onset — seed the capture with the pre-roll so the leading
          // syllable isn't clipped by the energy gate's detection lag.
          this.buffer.push(...this.preRoll);
          this.bufferedMs += this.preRoll.length * frameMs;
          this.preRoll = [];
        }

        if (isSpeech) {
          this.inSpeech = true;
          this.speechMs += frameMs;
          this.silenceMs = 0;
        } else if (this.inSpeech) {
          this.silenceMs += frameMs;
        } else {
          // Idle — maintain a short rolling pre-roll window.
          // Copy: the engine reuses the underlying buffer between callbacks.
          this.preRoll.push(new Float32Array(f32));
          if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
        }

        if (this.inSpeech) {
          this.buffer.push(new Float32Array(f32));
          this.bufferedMs += frameMs;
        }

        const utteranceEnded = this.inSpeech && this.silenceMs >= TRAIL_SILENCE_MS;
        const chunkFull = this.bufferedMs >= MAX_CHUNK_MS;
        if (utteranceEnded || chunkFull) {
          const hadRealSpeech = this.speechMs >= MIN_SPEECH_MS;
          const chunk = hadRealSpeech ? this.drainBuffer() : null;
          this.resetVad();
          if (chunk && this.captureResolve) {
            // Enrollment capture: deliver raw audio instead of detecting
            const resolve = this.captureResolve;
            this.captureResolve = null;
            resolve(chunk);
          } else if (chunk) {
            // Template match on the utterance PREFIX only (wake words lead;
            // matching whole sentences false-fires) + ASR text as backup.
            const prefix = chunk.length > WAKE_PREFIX_SAMPLES ? chunk.slice(0, WAKE_PREFIX_SAMPLES) : chunk;
            const score = this.matchTemplates(prefix);
            if (score >= this.threshold || this.pendingWake) {
              this.wakeViaTemplate = true;
              this.pendingWake = false;
            }
            if (!this.transcribing) {
              this.transcribe(chunk, true); // fires the wake with the command
            } else if (this.wakeViaTemplate) {
              // Decoder busy with an interim window — fire without a command
              // rather than lose the wake.
              this.fireWake();
            }
          }
        } else if (
          // Sliding window WHILE speech continues — faster trigger and
          // multiple chances to catch the phrase.
          !this.captureResolve &&
          this.inSpeech &&
          this.speechMs >= MIN_SPEECH_FOR_INTERIM_MS &&
          Date.now() - this.lastDecodeAt >= DECODE_EVERY_MS
        ) {
          this.lastDecodeAt = Date.now();
          const win = this.tailWindow();
          // Interim template match only EARLY in the utterance — once it's
          // clearly a sentence, only the prefix/final paths may match. A hit
          // here DEFERS to utterance end so the full command is captured.
          if (this.speechMs <= MAX_WAKE_UTTERANCE_MS && this.matchTemplates(win) >= this.threshold) {
            this.pendingWake = true;
          }
          if (!this.transcribing) this.transcribe(win, false);
        }
        // Hard cap on idle buffer growth (shouldn't happen, but be safe)
        if (this.bufferedMs > MAX_CHUNK_MS * 2) this.resetVad();
      };

      this.source.connect(this.processor);
      this.processor.connect(this.ctx.destination); // silent output; required for callbacks
      this.opts.onStateChange?.("listening");
    } catch (err: any) {
      this.opts.onStateChange?.("error", err?.message || "Wake detection failed to start");
      this.stop();
    }
  }

  private drainBuffer(): Float32Array {
    const total = this.buffer.reduce((s, b) => s + b.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const b of this.buffer) {
      out.set(b, off);
      off += b.length;
    }
    return out;
  }

  /** Last ~2.4s of the live buffer (buffer left intact) — for interim decodes. */
  private tailWindow(): Float32Array {
    const full = this.drainBuffer();
    return full.length > WINDOW_SAMPLES ? full.slice(full.length - WINDOW_SAMPLES) : full;
  }

  private resetVad() {
    this.buffer = [];
    this.preRoll = [];
    this.bufferedMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.inSpeech = false;
  }

  private async transcribe(chunk: Float32Array, isFinal: boolean) {
    this.transcribing = true;
    this.lastDecodeAt = Date.now();
    try {
      // No language option — the .en models are English-only and reject it.
      const out = await this.asr(chunk);
      if (this.stopped || this.woke) return;
      const text: string = (out?.text || "").trim();
      // Local-only diagnostics: what the detector heard never leaves the device.
      if (text && text !== this.lastHeard) {
        this.lastHeard = text;
        console.debug(`[WakeDetector] heard: "${text}"`);
        this.opts.onHeard?.(text);
      }
      const textWake = !!text && isWakePhrase(text);
      // Gray-zone ensemble: acoustic score just below threshold AND an
      // Orac-ish word in the transcript — together, wake.
      const grayWake = !!text && this.grayUntil > Date.now() && oracIsh(text);
      if (textWake || grayWake || (isFinal && this.wakeViaTemplate)) {
        if ((textWake || grayWake) && this.grayAudio) this.maybeLearn(this.grayAudio, this.threshold);
        if (grayWake) this.grayUntil = 0;
        if (isFinal) {
          // Forward what was said after the wake word so the session answers
          // immediately instead of greeting.
          const command = text ? stripWakeCommand(text, this.wakeViaTemplate && !textWake) : undefined;
          this.fireWake(command);
        } else {
          this.pendingWake = true; // defer to utterance end for the command
        }
      }
    } catch (err: any) {
      console.debug("[WakeDetector] transcription failed:", err?.message || err);
      // Don't lose an acoustically-confirmed wake to a decode error
      if (isFinal && this.wakeViaTemplate) this.fireWake();
    } finally {
      this.transcribing = false;
    }
  }

  /** Fully stop: release mic, keep the loaded model for instant re-arm. */
  stop() {
    this.stopped = true;
    this.running = false;
    this.gen++; // cancels any start() that's mid-await
    this.captureResolve?.(null);
    this.captureResolve = null;
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    // Kill EVERY stream ever acquired, not just the current reference —
    // a leaked live mic after "off" is a privacy failure, never acceptable.
    this.allStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.allStreams.clear();
    this.stream = null;
    this.ctx?.close().catch(() => { /* noop */ });
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.resetVad();
    this.opts.onStateChange?.("stopped");
  }
}
