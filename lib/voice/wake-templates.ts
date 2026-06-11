/**
 * Persistence for enrolled Orac voice templates (localStorage).
 * Only MFCC fingerprints are stored — never raw audio.
 */

import { serializeTemplate, deserializeTemplate, type WakeTemplate } from "./mel";

const KEY = "engineai-orac-voice-v1";

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
      threshold: typeof parsed.threshold === "number" ? parsed.threshold : 0.78,
      templates: parsed.templates.map(deserializeTemplate),
    };
  } catch {
    return null;
  }
}

export function clearEnrollment() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
