/**
 * EngineAI Live — PCM16 capture worklet.
 *
 * Runs on the real-time audio render thread, so it is NOT throttled in
 * background tabs/windows (the reason ScriptProcessorNode is banned here —
 * see lib/voice/oww-detector.ts for the documented burst-throttling lesson).
 *
 * Input:  mono audio at the AudioContext's NATIVE sample rate (Safari ignores
 *         the 16k sampleRate hint, so we never assume 16k — we resample).
 * Output: port.postMessage({ pcm: Int16Array (transferred), rms: number })
 *         in ~50ms frames of 16 kHz PCM16 — the shape AssemblyAI
 *         Universal-Streaming expects as binary WS frames.
 */

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 800; // 50ms @ 16kHz

class Pcm16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // `sampleRate` is a worklet global
    this.inBuf = new Float32Array(0);
    this.outBuf = new Int16Array(FRAME_SAMPLES);
    this.outLen = 0;
    this.srcPos = 0; // fractional read position into inBuf for resampling
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const chunk = input[0]; // mono (channelCount: 1 upstream)

    // Append to the rolling input buffer
    const merged = new Float32Array(this.inBuf.length + chunk.length);
    merged.set(this.inBuf, 0);
    merged.set(chunk, this.inBuf.length);
    this.inBuf = merged;

    // Linear resample native-rate → 16k (same math as resampleLinear in
    // lib/voice/oww-detector.ts, streamed incrementally)
    while (this.srcPos + this.ratio < this.inBuf.length) {
      const i0 = Math.floor(this.srcPos);
      const frac = this.srcPos - i0;
      const s = this.inBuf[i0] + (this.inBuf[i0 + 1] - this.inBuf[i0]) * frac;
      // Float32 [-1,1] → Int16 (clamp math from VoiceDock's float32ToBase64Pcm16)
      const clamped = Math.max(-1, Math.min(1, s));
      this.outBuf[this.outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this.srcPos += this.ratio;

      if (this.outLen === FRAME_SAMPLES) {
        // RMS for the level meter + silent-mic diagnostic (hardware-muted
        // speakerphones read exactly 0 — see trackMicHealth lesson)
        let sum = 0;
        for (let i = 0; i < FRAME_SAMPLES; i++) {
          const v = this.outBuf[i] / 0x8000;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / FRAME_SAMPLES);
        const out = this.outBuf;
        this.port.postMessage({ pcm: out, rms }, [out.buffer]);
        this.outBuf = new Int16Array(FRAME_SAMPLES);
        this.outLen = 0;
      }
    }

    // Drop consumed input, keep the fractional tail
    const keepFrom = Math.floor(this.srcPos);
    if (keepFrom > 0) {
      this.inBuf = this.inBuf.slice(keepFrom);
      this.srcPos -= keepFrom;
    }
    // Safety: never let the buffer grow unbounded (e.g. if output is stalled)
    if (this.inBuf.length > sampleRate * 10) {
      this.inBuf = new Float32Array(0);
      this.srcPos = 0;
    }
    return true;
  }
}

registerProcessor("pcm16-worklet", Pcm16Worklet);
