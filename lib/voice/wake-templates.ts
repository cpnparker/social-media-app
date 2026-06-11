/**
 * Persistence for enrolled Orac voice templates (localStorage).
 * Only MFCC fingerprints are stored — never raw audio.
 */

import { serializeTemplate, deserializeTemplate, type WakeTemplate } from "./mel";

const KEY = "engineai-orac-voice-v1";

/** Hard floor for the wake threshold. Empirically, UNRELATED speech and
 *  noise score 0.57–0.65 against any template (DTW best-path inflation) —
 *  a threshold inside that band fires on any sound. */
export const MIN_THRESHOLD = 0.72;

export interface StoredEnrollment {
  threshold: number;
  templates: WakeTemplate[];
}

export function saveEnrollment(templates: WakeTemplate[], threshold: number): boolean {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, threshold, templates: templates.map(serializeTemplate) })
    );
    return true;
  } catch {
    return false;
  }
}

export function loadEnrollment(): StoredEnrollment | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.templates) || !parsed.templates.length) return null;
    return {
      // Floor applied at load too — repairs enrollments saved before the
      // calibration fix without forcing a re-enrollment.
      threshold: Math.max(typeof parsed.threshold === "number" ? parsed.threshold : 0.78, MIN_THRESHOLD),
      templates: parsed.templates.map(deserializeTemplate),
    };
  } catch {
    return null;
  }
}

export function clearEnrollment() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
