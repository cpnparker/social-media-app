/**
 * MFCC features + subsequence-DTW for on-device wake-word template matching.
 *
 * Self-contained DSP (no model inference): features for a 1s utterance take
 * single-digit milliseconds, so matching runs on every detection window.
 * Templates and candidates both pass through this exact pipeline, so the
 * features only need to be consistent, not Whisper-identical.
 *
 * Feature choice validated empirically (synthetic words, browser): MFCC
 * (DCT-decorrelated log-mel, c0 dropped) + delta features → same-word
 * similarity ~0.87 incl. ±20% time stretch vs ≤0.65 for different words and
 * noise. Plain CMVN mel separated by only ~0.1.
 */

const SR = 16000;
const N_FFT = 512; // 400-sample (25ms) Hann window zero-padded to 512
const WIN = 400;
const HOP = 160; // 10ms
const BINS = 40; // mel filterbank size
const FMIN = 50;
const FMAX = 7600;
const NCEP = 20; // cepstral coefficients kept (c1..c20; c0 dropped)

export interface WakeTemplate {
  /** Frame-major features: data[t * bins + b] — MFCC + deltas, CMVN'd */
  data: Float32Array;
  frames: number;
  bins: number;
}

/* ── FFT (iterative radix-2, complex in-place) ── */

const BITREV = new Uint16Array(N_FFT);
const COS = new Float32Array(N_FFT / 2);
const SIN = new Float32Array(N_FFT / 2);
const HANN = new Float32Array(WIN);
{
  const bits = Math.log2(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    BITREV[i] = r;
  }
  for (let i = 0; i < N_FFT / 2; i++) {
    COS[i] = Math.cos((-2 * Math.PI * i) / N_FFT);
    SIN[i] = Math.sin((-2 * Math.PI * i) / N_FFT);
  }
  for (let i = 0; i < WIN; i++) {
    HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  }
}

function fftPower(re: Float32Array, im: Float32Array, out: Float32Array) {
  for (let i = 0; i < N_FFT; i++) {
    const j = BITREV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let base = 0; base < N_FFT; base += size) {
      for (let k = 0; k < half; k++) {
        const tw = k * step;
        const oR = re[base + half + k] * COS[tw] - im[base + half + k] * SIN[tw];
        const oI = re[base + half + k] * SIN[tw] + im[base + half + k] * COS[tw];
        re[base + half + k] = re[base + k] - oR;
        im[base + half + k] = im[base + k] - oI;
        re[base + k] += oR;
        im[base + k] += oI;
      }
    }
  }
  for (let k = 0; k <= N_FFT / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
}

/* ── Mel filterbank (sparse triangles, HTK mel scale) ── */

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

interface Filter { start: number; weights: Float32Array }
const FILTERS: Filter[] = (() => {
  const nBins = N_FFT / 2 + 1;
  const melPts = new Float32Array(BINS + 2);
  const mLo = hzToMel(FMIN), mHi = hzToMel(FMAX);
  for (let i = 0; i < BINS + 2; i++) melPts[i] = mLo + ((mHi - mLo) * i) / (BINS + 1);
  const binOf = (m: number) => Math.floor(((N_FFT + 1) * melToHz(m)) / SR);
  const filters: Filter[] = [];
  for (let b = 0; b < BINS; b++) {
    const lo = binOf(melPts[b]), mid = binOf(melPts[b + 1]), hi = Math.min(binOf(melPts[b + 2]), nBins - 1);
    const start = Math.max(lo, 0);
    const weights = new Float32Array(Math.max(hi - start + 1, 1));
    for (let k = start; k <= hi; k++) {
      weights[k - start] = k < mid
        ? (mid === lo ? 1 : (k - lo) / (mid - lo))
        : (hi === mid ? 1 : (hi - k) / (hi - mid));
    }
    filters.push({ start, weights });
  }
  return filters;
})();

/* ── DCT-II matrix for MFCC (c0 dropped — it's just energy) ── */

const DCT = (() => {
  const m = new Float32Array(NCEP * BINS);
  for (let c = 1; c <= NCEP; c++) {
    for (let b = 0; b < BINS; b++) {
      m[(c - 1) * BINS + b] = Math.cos((Math.PI * c * (b + 0.5)) / BINS) * Math.sqrt(2 / BINS);
    }
  }
  return m;
})();

/** 16kHz mono Float32 → CMVN'd MFCC+delta features, frame-major. */
export function extractFeatures(audio: Float32Array): WakeTemplate {
  const frames = Math.max(0, Math.floor((audio.length - WIN) / HOP) + 1);
  const logmel = new Float32Array(frames * BINS);
  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  const power = new Float32Array(N_FFT / 2 + 1);

  for (let t = 0; t < frames; t++) {
    re.fill(0); im.fill(0);
    const off = t * HOP;
    for (let i = 0; i < WIN; i++) re[i] = audio[off + i] * HANN[i];
    fftPower(re, im, power);
    for (let b = 0; b < BINS; b++) {
      const f = FILTERS[b];
      let sum = 0;
      for (let k = 0; k < f.weights.length; k++) sum += power[f.start + k] * f.weights[k];
      logmel[t * BINS + b] = Math.log10(Math.max(sum, 1e-10));
    }
  }

  // DCT → cepstra
  const cep = new Float32Array(frames * NCEP);
  for (let t = 0; t < frames; t++) {
    for (let c = 0; c < NCEP; c++) {
      let s = 0;
      for (let b = 0; b < BINS; b++) s += DCT[c * BINS + b] * logmel[t * BINS + b];
      cep[t * NCEP + c] = s;
    }
  }

  // CMVN per coefficient (gain/mic invariance)
  for (let c = 0; c < NCEP; c++) {
    let mean = 0;
    for (let t = 0; t < frames; t++) mean += cep[t * NCEP + c];
    mean /= Math.max(frames, 1);
    let varSum = 0;
    for (let t = 0; t < frames; t++) {
      const d = cep[t * NCEP + c] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / Math.max(frames, 1)) + 1e-5;
    for (let t = 0; t < frames; t++) cep[t * NCEP + c] = (cep[t * NCEP + c] - mean) / std;
  }

  // Append deltas → 2*NCEP dims per frame
  const D = NCEP * 2;
  const data = new Float32Array(frames * D);
  for (let t = 0; t < frames; t++) {
    const tp = Math.min(t + 1, frames - 1), tm = Math.max(t - 1, 0);
    for (let c = 0; c < NCEP; c++) {
      data[t * D + c] = cep[t * NCEP + c];
      data[t * D + NCEP + c] = cep[tp * NCEP + c] - cep[tm * NCEP + c];
    }
  }

  return { data, frames, bins: D };
}

/* ── Subsequence DTW similarity ── */

function frameNorms(m: WakeTemplate): Float32Array {
  const norms = new Float32Array(m.frames);
  for (let t = 0; t < m.frames; t++) {
    let s = 0;
    for (let b = 0; b < m.bins; b++) {
      const v = m.data[t * m.bins + b];
      s += v * v;
    }
    norms[t] = Math.sqrt(s) + 1e-9;
  }
  return norms;
}

/**
 * Similarity of `template` appearing ANYWHERE inside `candidate`
 * (subsequence DTW, cosine local distance). Returns 0..1; self-match ≈ 1.
 */
export function dtwSimilarity(template: WakeTemplate, candidate: WakeTemplate): number {
  const T = template.frames, C = candidate.frames, D = template.bins;
  if (T < 8 || C < T * 0.5) return 0;
  const tn = frameNorms(template), cn = frameNorms(candidate);

  const cost = (i: number, j: number) => {
    let dot = 0;
    const ti = i * D, cj = j * D;
    for (let b = 0; b < D; b++) dot += template.data[ti + b] * candidate.data[cj + b];
    return 1 - dot / (tn[i] * cn[j]); // 0 (identical) .. 2 (opposite)
  };

  // Two-row DP; free start/end along the candidate axis.
  let prev = new Float32Array(C);
  let curr = new Float32Array(C);
  for (let j = 0; j < C; j++) prev[j] = cost(0, j);
  for (let i = 1; i < T; i++) {
    curr[0] = cost(i, 0) + prev[0];
    for (let j = 1; j < C; j++) {
      curr[j] = cost(i, j) + Math.min(prev[j], prev[j - 1], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  let minCost = Infinity;
  for (let j = 0; j < C; j++) if (prev[j] < minCost) minCost = prev[j];
  const avg = minCost / T;
  return Math.max(0, 1 - avg / 2);
}

/**
 * Energy-trim leading/trailing silence (with padding). CRITICAL for
 * matching: CMVN statistics are computed over the window, so a candidate
 * that is mostly silence normalises very differently from a tight template —
 * costing 10+ similarity points. Trim BOTH templates and candidates.
 */
export function trimSilence(audio: Float32Array, padMs = 80): Float32Array {
  const F = 320; // 20ms frames
  const n = Math.floor(audio.length / F);
  if (n === 0) return audio;
  const rms = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < F; j++) {
      const v = audio[i * F + j];
      s += v * v;
    }
    rms[i] = Math.sqrt(s / F);
    if (rms[i] > peak) peak = rms[i];
  }
  const thr = Math.max(peak * 0.12, 0.004);
  let a = 0;
  while (a < n && rms[a] < thr) a++;
  let b = n - 1;
  while (b > a && rms[b] < thr) b--;
  if (a >= b) return audio;
  const pad = Math.round((padMs / 1000) * SR);
  const start = Math.max(0, a * F - pad);
  const end = Math.min(audio.length, (b + 1) * F + pad);
  return audio.slice(start, end);
}

/* ── (De)serialisation for localStorage ── */

export function serializeTemplate(t: WakeTemplate): { frames: number; bins: number; b64: string } {
  const bytes = new Uint8Array(t.data.buffer.slice(0));
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return { frames: t.frames, bins: t.bins, b64: btoa(bin) };
}

export function deserializeTemplate(s: { frames: number; bins: number; b64: string }): WakeTemplate {
  const bin = atob(s.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: new Float32Array(bytes.buffer), frames: s.frames, bins: s.bins };
}
