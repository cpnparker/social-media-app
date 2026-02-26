/**
 * Shared content type utilities.
 *
 * All visual metadata for content types lives here so every page
 * (dashboard, content list, editorial calendar, commission module, etc.)
 * stays in sync.
 *
 * The actual list of *active* content types comes from the Supabase
 * `types_content` table via `GET /api/content-types`.  The colour / icon
 * maps below are look-up tables keyed by the lowercase `key_type` value
 * stored in that table.  Unknown keys gracefully fall back to "other".
 */

// ── Tailwind class-based colours (badges, pills) ──────────────────────
export const typeColors: Record<string, string> = {
  article: "bg-blue-500/10 text-blue-500",
  blog: "bg-indigo-500/10 text-indigo-500",
  video: "bg-red-500/10 text-red-500",
  animation: "bg-orange-500/10 text-orange-500",
  graphic: "bg-pink-500/10 text-pink-500",
  visual: "bg-pink-500/10 text-pink-500",
  visuals: "bg-pink-500/10 text-pink-500",
  social: "bg-sky-500/10 text-sky-500",
  thread: "bg-violet-500/10 text-violet-500",
  newsletter: "bg-amber-500/10 text-amber-500",
  podcast: "bg-green-500/10 text-green-500",
  other: "bg-gray-500/10 text-gray-500",
};

// ── Hex colours (calendar events, charts) ─────────────────────────────
export const typeHexColors: Record<string, string> = {
  article: "#3b82f6",
  blog: "#6366f1",
  video: "#ef4444",
  animation: "#f97316",
  graphic: "#ec4899",
  visual: "#ec4899",
  visuals: "#ec4899",
  social: "#0ea5e9",
  thread: "#8b5cf6",
  newsletter: "#f59e0b",
  podcast: "#22c55e",
  other: "#6b7280",
};

// ── Calendar-specific colour objects (bg, border, display text) ───────
export const typeCalendarColors: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  article: { bg: "#3b82f6", border: "#2563eb", text: "Article" },
  blog: { bg: "#6366f1", border: "#4f46e5", text: "Blog" },
  video: { bg: "#ef4444", border: "#dc2626", text: "Video" },
  animation: { bg: "#f97316", border: "#ea580c", text: "Animation" },
  graphic: { bg: "#ec4899", border: "#db2777", text: "Graphic" },
  visual: { bg: "#ec4899", border: "#db2777", text: "Visual" },
  visuals: { bg: "#ec4899", border: "#db2777", text: "Visuals" },
  social: { bg: "#0ea5e9", border: "#0284c7", text: "Social" },
  thread: { bg: "#8b5cf6", border: "#7c3aed", text: "Thread" },
  newsletter: { bg: "#f59e0b", border: "#d97706", text: "Newsletter" },
  podcast: { bg: "#22c55e", border: "#16a34a", text: "Podcast" },
  other: { bg: "#6b7280", border: "#4b5563", text: "Other" },
};

// ── Icons (used in commission picker, etc.) ───────────────────────────
export const typeIcons: Record<string, string> = {
  article: "📝",
  blog: "✍️",
  video: "🎬",
  animation: "🎞️",
  graphic: "🎨",
  visual: "🖼️",
  visuals: "🖼️",
  social: "📱",
  thread: "🧵",
  newsletter: "📧",
  podcast: "🎙️",
  other: "📋",
};

// ── Helpers ────────────────────────────────────────────────────────────

/** Return the Tailwind badge colour for a content type (lowercase key). */
export function getTypeColor(key: string | null | undefined): string {
  return typeColors[(key || "").toLowerCase()] || typeColors.other;
}

/** Return the hex colour for a content type (lowercase key). */
export function getTypeHex(key: string | null | undefined): string {
  return typeHexColors[(key || "").toLowerCase()] || typeHexColors.other;
}

/** Return calendar colour object for a content type. */
export function getTypeCalendarColor(
  key: string | null | undefined
): { bg: string; border: string; text: string } {
  return (
    typeCalendarColors[(key || "").toLowerCase()] || typeCalendarColors.other
  );
}

/** Return the emoji icon for a content type. */
export function getTypeIcon(key: string | null | undefined): string {
  return typeIcons[(key || "").toLowerCase()] || typeIcons.other;
}
