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
}

// Accept common mistranscriptions of the phrase. Requires the bigram —
// "engine" alone in conversation must NOT trigger.
const WAKE_RE = /\b(hey|hay|hei|hi|a)[\s,.!]*(engine|enjin|engin|njin)\b/i;

const SAMPLE_RATE = 16000; // Whisper-native
const SPEECH_RMS = 0.015; // energy gate
const MIN_SPEECH_MS = 400; // ignore coughs/clicks
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
        this.asr = await pipeline(
          "automatic-speech-recognition",
          "onnx-community/whisper-tiny.en",
          {
            dtype: "q8",
            progress_callback: (p: any) => {
              if (p?.status === "progress" && p?.total) {
                this.opts.onProgress?.(Math.min(1, p.loaded / p.total));
              }
            },
          } as any
        );
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
      const out = await this.asr(chunk, { language: "en" });
      const text: string = (out?.text || "").trim();
      if (text && WAKE_RE.test(text)) {
        this.opts.onWake();
      }
    } catch {
      // Local-only failure; keep listening
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
