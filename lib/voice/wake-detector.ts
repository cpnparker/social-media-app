/**
 * On-device wake phrase detection — "Hey Engine".
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

export type WakeDetectorState = "loading" | "listening" | "stopped" | "error";

interface WakeDetectorOptions {
  onWake: () => void;
  onStateChange?: (state: WakeDetectorState, detail?: string) => void;
  /** 0..1 — model download progress during "loading" */
  onProgress?: (pct: number) => void;
  /** Every locally-transcribed utterance (for the UI "heard:" readout — stays on-device) */
  onHeard?: (text: string) => void;
}

// Fast path: common direct transcriptions of the phrase.
const WAKE_RE = /\b(hey|hay|hei|hi|he|a)[\s,.!]*(engine|enjin|engin|njin)\b/i;

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

/** Wake match: regex fast-path, then fuzzy — whisper-tiny mangles the phrase
 *  in creative ways ("Hey, Engin.", "hey and gin"). Requires BOTH a greeting
 *  token and an engine-like token, so "engine" alone never triggers. */
export function isWakePhrase(text: string): boolean {
  if (WAKE_RE.test(text)) return true;
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const engineIdx = toks.findIndex((t) => t.length >= 5 && t[0] === "e" && lev(t, "engine") <= 2);
  if (engineIdx <= 0) return false;
  // Greeting must be IMMEDIATELY before the engine token — "we need a new
  // engine for the pipeline" must not wake.
  const before = toks[engineIdx - 1];
  const GREETINGS = ["hey", "hay", "hei", "hi", "he", "a", "hate", "they"];
  return GREETINGS.includes(before) || lev(before, "hey") <= 1;
}

const SAMPLE_RATE = 16000; // Whisper-native
const SPEECH_RMS = 0.008; // energy gate (AGC mics can run quiet)
const MIN_SPEECH_MS = 300; // ignore coughs/clicks
const MAX_CHUNK_MS = 3000; // wake phrase fits comfortably
const TRAIL_SILENCE_MS = 450; // end-of-utterance

export class WakeDetector {
  private opts: WakeDetectorOptions;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private asr: any = null;
  private buffer: Float32Array[] = [];
  private bufferedMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private inSpeech = false;
  private transcribing = false;
  private stopped = true;

  constructor(opts: WakeDetectorOptions) {
    this.opts = opts;
  }

  async start() {
    this.stopped = false;
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
        // trips ORT's QDQ loader ("Missing required scale ..."). Fall back
        // to full fp32 if the quantized decoder still fails to load.
        const dtypeConfigs: any[] = [
          { encoder_model: "fp32", decoder_model_merged: "q4" },
          "fp32",
        ];
        let lastErr: unknown;
        for (const dtype of dtypeConfigs) {
          try {
            this.asr = await pipeline(
              "automatic-speech-recognition",
              "onnx-community/whisper-tiny.en",
              { dtype, progress_callback } as any
            );
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
      if (this.stopped) return;

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (this.stopped) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
      const frameMs = (2048 / SAMPLE_RATE) * 1000;

      this.processor.onaudioprocess = (e) => {
        if (this.stopped || this.transcribing) return;
        const f32 = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
        const rms = Math.sqrt(sum / f32.length);
        const isSpeech = rms > SPEECH_RMS;

        if (isSpeech) {
          this.inSpeech = true;
          this.speechMs += frameMs;
          this.silenceMs = 0;
        } else if (this.inSpeech) {
          this.silenceMs += frameMs;
        }

        if (this.inSpeech) {
          // Copy — the engine reuses the underlying buffer between callbacks.
          this.buffer.push(new Float32Array(f32));
          this.bufferedMs += frameMs;
        }

        const utteranceEnded = this.inSpeech && this.silenceMs >= TRAIL_SILENCE_MS;
        const chunkFull = this.bufferedMs >= MAX_CHUNK_MS;
        if (utteranceEnded || chunkFull) {
          const hadRealSpeech = this.speechMs >= MIN_SPEECH_MS;
          const chunk = hadRealSpeech ? this.drainBuffer() : null;
          this.resetVad();
          if (chunk) this.transcribe(chunk);
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

  private resetVad() {
    this.buffer = [];
    this.bufferedMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.inSpeech = false;
  }

  private async transcribe(chunk: Float32Array) {
    this.transcribing = true;
    try {
      // No language option — whisper-tiny.en is English-only and rejects it.
      const out = await this.asr(chunk);
      const text: string = (out?.text || "").trim();
      // Local-only diagnostics: what the detector heard never leaves the device.
      if (text) {
        console.debug(`[WakeDetector] heard: "${text}"`);
        this.opts.onHeard?.(text);
      }
      if (text && isWakePhrase(text)) {
        this.opts.onWake();
      }
    } catch (err: any) {
      console.debug("[WakeDetector] transcription failed:", err?.message || err);
    } finally {
      this.transcribing = false;
    }
  }

  /** Fully stop: release mic, keep the loaded model for instant re-arm. */
  stop() {
    this.stopped = true;
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => { /* noop */ });
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.resetVad();
    this.opts.onStateChange?.("stopped");
  }
}
