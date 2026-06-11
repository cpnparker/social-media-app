"use client";

/**
 * openWakeWord streaming engine — frame-level "Orac" detection.
 *
 * Activates automatically when the trained model files exist (see
 * scripts/wake-training/): public/models/orac.onnx + melspectrogram.onnx +
 * embedding_model.onnx (~3MB total). Replaces the Whisper-based detector:
 * no transcription, no VAD chunking, no interim/final races — a tiny
 * classifier scores every 80ms frame, exactly like commercial wake words.
 *
 * Pipeline (openWakeWord standard):
 *   16kHz audio → 1280-sample chunks → melspectrogram.onnx → mel frames
 *   (scaled x/10+2) → embedding_model.onnx over a sliding 76-frame window
 *   (step 8) → 96-d embeddings → orac.onnx over the last 16 embeddings →
 *   wake probability.
 *
 * PRIVACY: identical to before — everything runs on-device; nothing leaves
 * the machine until the wake fires.
 */

export type OwwState = "loading" | "listening" | "stopped" | "error";

/** Tune here first: raise → fewer false wakes; lower → fewer misses. */
export const WAKE_SCORE_THRESHOLD = 0.5;

const SAMPLE_RATE = 16000;
const CHUNK = 1280; // 80ms
const MEL_BINS = 32;
const MEL_WINDOW = 76; // mel frames per embedding (~775ms)
const MEL_STEP = 8; // mel frames between embeddings (80ms)
const EMB_DIM = 96;
const EMB_WINDOW = 16; // embeddings per classification (~1.28s)
const REFRACTORY_MS = 2000; // ignore re-triggers right after a wake
const START_COOLDOWN_MS = 1000;
// Command capture after wake ("Orac, what meetings…")
const COMMAND_MAX_MS = 7000;
const COMMAND_TRAIL_SILENCE_MS = 700;
const COMMAND_RMS = 0.008;

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const MODELS_BASE = "/models/";
// Bump on every model retrain/redeploy — busts browser/CDN caches of the
// .onnx files (a stale cached model fails session creation with
// "protobuf parsing failed").
const MODELS_VERSION = "2";
const modelUrl = (name: string) => `${MODELS_BASE}${name}?v=${MODELS_VERSION}`;

interface OwwDetectorOptions {
  /** getCommandAudio resolves with 16kHz audio spoken after the wake word
   *  (null if the user said nothing) — flush it into the voice session. */
  onWake: (getCommandAudio: () => Promise<Float32Array | null>) => void;
  onStateChange?: (state: OwwState, detail?: string) => void;
  onProgress?: (pct: number) => void;
  onMatchScore?: (score: number, threshold: number) => void;
}

/** Are the trained model files deployed? Decides which engine WakeMode uses. */
export async function owwModelsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(modelUrl("orac.onnx"), { method: "HEAD" });
    // A redirect or an HTML content-type means a router/middleware swallowed
    // the path — the file isn't truly being served; fall back to whisper.
    const type = res.headers.get("content-type") || "";
    return res.ok && !res.redirected && !type.includes("text/html");
  } catch {
    return false;
  }
}

/** Linear resampler (16k → AudioContext rates) for command-audio flushing. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const outLen = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(outLen);
  const ratio = (input.length - 1) / Math.max(outLen - 1, 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

export class OwwWakeDetector {
  private opts: OwwDetectorOptions;
  private ort: any = null;
  private melSession: any = null;
  private embSession: any = null;
  private clsSession: any = null;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private allStreams = new Set<MediaStream>();

  private sampleQueue: Float32Array[] = [];
  private queuedSamples = 0;
  private melBuffer: number[][] = []; // rolling mel frames
  private embBuffer: Float32Array[] = []; // rolling embeddings
  private rawRing: Float32Array[] = []; // last ~1s raw audio (command lead-in)
  private rawRingSamples = 0;

  private running = false;
  private stopped = true;
  private gen = 0;
  private inferring = false;
  private lastWakeAt = 0;
  private cooldownUntil = 0;

  // Post-wake command capture
  private stopAfterCapture = false;
  private capturingCommand = false;
  private commandChunks: Float32Array[] = [];
  private commandSilenceMs = 0;
  private commandStartedAt = 0;
  private commandResolve: ((audio: Float32Array | null) => void) | null = null;

  constructor(opts: OwwDetectorOptions) {
    this.opts = opts;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.cooldownUntil = Date.now() + START_COOLDOWN_MS;
    const gen = ++this.gen;
    this.opts.onStateChange?.("loading");
    try {
      if (!this.ort) {
        const mod: any = await import(/* webpackIgnore: true */ `${ORT_CDN}ort.min.mjs`);
        this.ort = mod.default ?? mod;
        this.ort.env.wasm.wasmPaths = ORT_CDN;
        this.ort.env.wasm.numThreads = 1; // no cross-origin isolation needed
      }
      if (this.stopped || gen !== this.gen) return;

      const load = async (name: string, idx: number, total: number) => {
        const sess = await this.ort.InferenceSession.create(modelUrl(name), {
          executionProviders: ["wasm"],
        });
        this.opts.onProgress?.((idx + 1) / total);
        return sess;
      };
      if (!this.melSession) this.melSession = await load("melspectrogram.onnx", 0, 3);
      if (this.stopped || gen !== this.gen) return;
      if (!this.embSession) this.embSession = await load("embedding_model.onnx", 1, 3);
      if (this.stopped || gen !== this.gen) return;
      if (!this.clsSession) this.clsSession = await load("orac.onnx", 2, 3);
      if (this.stopped || gen !== this.gen) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.allStreams.add(stream);
      if (this.stopped || gen !== this.gen) {
        stream.getTracks().forEach((t) => t.stop());
        this.allStreams.delete(stream);
        return;
      }
      this.stream = stream;

      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.source = this.ctx.createMediaStreamSource(stream);
      this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (e) => {
        if (this.stopped) return;
        const f32 = new Float32Array(e.inputBuffer.getChannelData(0));
        this.ingest(f32);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.ctx.destination);
      this.opts.onStateChange?.("listening");
    } catch (err: any) {
      this.opts.onStateChange?.("error", err?.message || "Wake engine failed to start");
      this.stop();
    }
  }

  private ingest(samples: Float32Array) {
    // Command capture takes the raw feed directly
    if (this.capturingCommand) {
      this.commandChunks.push(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const frameMs = (samples.length / SAMPLE_RATE) * 1000;
      this.commandSilenceMs = rms > COMMAND_RMS ? 0 : this.commandSilenceMs + frameMs;
      const elapsed = Date.now() - this.commandStartedAt;
      if (this.commandSilenceMs >= COMMAND_TRAIL_SILENCE_MS || elapsed >= COMMAND_MAX_MS) {
        this.finishCommandCapture();
      }
      return;
    }

    // Rolling raw ring (~1s) so the command lead-in isn't lost
    this.rawRing.push(samples);
    this.rawRingSamples += samples.length;
    while (this.rawRingSamples > SAMPLE_RATE && this.rawRing.length > 1) {
      this.rawRingSamples -= this.rawRing[0].length;
      this.rawRing.shift();
    }

    // Re-chunk to 1280-sample frames for the model pipeline
    this.sampleQueue.push(samples);
    this.queuedSamples += samples.length;
    while (this.queuedSamples >= CHUNK) {
      const chunk = new Float32Array(CHUNK);
      let filled = 0;
      while (filled < CHUNK) {
        const head = this.sampleQueue[0];
        const take = Math.min(CHUNK - filled, head.length);
        chunk.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) this.sampleQueue.shift();
        else this.sampleQueue[0] = head.subarray(take);
      }
      this.queuedSamples -= CHUNK;
      void this.processChunk(chunk);
    }
  }

  private async processChunk(chunk: Float32Array) {
    if (this.inferring || this.stopped) return; // drop frame under load — fine at 80ms cadence
    this.inferring = true;
    try {
      // 1. melspectrogram
      const melOut = await this.melSession.run({
        [this.melSession.inputNames[0]]: new this.ort.Tensor("float32", chunk, [1, CHUNK]),
      });
      const mel = melOut[this.melSession.outputNames[0]];
      const melData: Float32Array = mel.data;
      const frames = melData.length / MEL_BINS;
      for (let f = 0; f < frames; f++) {
        const row = new Array(MEL_BINS);
        for (let b = 0; b < MEL_BINS; b++) row[b] = melData[f * MEL_BINS + b] / 10 + 2; // oWW scaling
        this.melBuffer.push(row);
      }
      const maxMel = MEL_WINDOW + MEL_STEP * 40;
      if (this.melBuffer.length > maxMel) this.melBuffer.splice(0, this.melBuffer.length - maxMel);

      // 2. embeddings over sliding mel windows: one new embedding every
      //    MEL_STEP fresh mel frames once MEL_WINDOW frames are buffered.
      this.melSinceEmb += frames;
      while (
        this.melBuffer.length >= MEL_WINDOW &&
        (this.embBuffer.length === 0 || this.melSinceEmb >= MEL_STEP)
      ) {
        const windowFrames = this.melBuffer.slice(this.melBuffer.length - MEL_WINDOW);
        const flat = new Float32Array(MEL_WINDOW * MEL_BINS);
        for (let f = 0; f < MEL_WINDOW; f++) {
          for (let b = 0; b < MEL_BINS; b++) flat[f * MEL_BINS + b] = windowFrames[f][b];
        }
        const embOut = await this.embSession.run({
          [this.embSession.inputNames[0]]: new this.ort.Tensor("float32", flat, [1, MEL_WINDOW, MEL_BINS, 1]),
        });
        const emb: Float32Array = embOut[this.embSession.outputNames[0]].data;
        this.embBuffer.push(new Float32Array(emb.subarray(0, EMB_DIM)));
        if (this.embBuffer.length > EMB_WINDOW) this.embBuffer.shift();
        this.melSinceEmb = Math.max(0, this.melSinceEmb - MEL_STEP);
        if (this.embBuffer.length > 0 && this.melSinceEmb < MEL_STEP) break;
      }

      // 3. classify when we have a full context window
      if (this.embBuffer.length === EMB_WINDOW) {
        const flat = new Float32Array(EMB_WINDOW * EMB_DIM);
        for (let i = 0; i < EMB_WINDOW; i++) flat.set(this.embBuffer[i], i * EMB_DIM);
        const clsOut = await this.clsSession.run({
          [this.clsSession.inputNames[0]]: new this.ort.Tensor("float32", flat, [1, EMB_WINDOW, EMB_DIM]),
        });
        const score: number = clsOut[this.clsSession.outputNames[0]].data[0];
        this.opts.onMatchScore?.(score, WAKE_SCORE_THRESHOLD);
        const now = Date.now();
        if (
          score >= WAKE_SCORE_THRESHOLD &&
          now >= this.cooldownUntil &&
          now - this.lastWakeAt > REFRACTORY_MS
        ) {
          this.lastWakeAt = now;
          this.beginCommandCapture();
        }
      }
    } catch (err: any) {
      console.debug("[OwwDetector] inference error:", err?.message || err);
    } finally {
      this.inferring = false;
    }
  }
  private melSinceEmb = 0;

  /** Wake fired: notify immediately (chime + session connect start) while
   *  continuing to capture the spoken command in parallel. */
  private beginCommandCapture() {
    this.capturingCommand = true;
    this.commandChunks = [...this.rawRing.slice(-3)]; // ~250ms lead-in
    this.commandSilenceMs = 0;
    this.commandStartedAt = Date.now();
    const promise = new Promise<Float32Array | null>((resolve) => {
      this.commandResolve = resolve;
    });
    this.opts.onWake(() => promise);
  }

  private finishCommandCapture() {
    this.capturingCommand = false;
    const total = this.commandChunks.reduce((s, c) => s + c.length, 0);
    let audio: Float32Array | null = null;
    // Require ≥400ms beyond the lead-in to count as a command
    if (total > SAMPLE_RATE * 0.65) {
      audio = new Float32Array(total);
      let off = 0;
      for (const c of this.commandChunks) {
        audio.set(c, off);
        off += c.length;
      }
    }
    this.commandChunks = [];
    this.commandResolve?.(audio);
    this.commandResolve = null;
    if (this.stopAfterCapture) {
      this.stopAfterCapture = false;
      this.stop();
    }
  }

  stop() {
    // A wake just fired and the command is still being spoken — finish the
    // capture first (≤7s), then complete the stop. Stopping now would hand
    // the session a truncated command.
    if (this.capturingCommand) {
      this.stopAfterCapture = true;
      return;
    }
    this.stopped = true;
    this.running = false;
    this.gen++;
    this.commandResolve?.(null);
    this.commandResolve = null;
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    this.allStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.allStreams.clear();
    this.stream = null;
    this.ctx?.close().catch(() => { /* noop */ });
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.sampleQueue = [];
    this.queuedSamples = 0;
    this.melBuffer = [];
    this.embBuffer = [];
    this.rawRing = [];
    this.rawRingSamples = 0;
    this.opts.onStateChange?.("stopped");
  }
}
