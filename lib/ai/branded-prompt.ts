/**
 * buildBrandedImagePrompt — wraps a user-supplied image / video prompt with
 * the selected client's visual identity rules. Used by Design mode to ground
 * generation in the client's brand.
 *
 * Design choices:
 *   - The user prompt is always the primary instruction. Brand rules are
 *     appended as additional guidance, not prepended (which can dilute the
 *     creative direction).
 *   - We use a clear "STYLE GUIDANCE" header so models like DALL-E parse it
 *     as a stylistic frame rather than literal subject matter.
 *   - DON'Ts are converted to negative phrasing the model understands.
 *   - Output stays under DALL-E 3's ~1000-character soft limit; we truncate
 *     gracefully.
 */

export interface VisualIdentity {
  primary_colors?: string[];
  secondary_colors?: string[];
  typography?: { headline?: string; body?: string };
  tone_visual?: string[];
  do?: string[];
  dont?: string[];
  logo_urls?: string[];
  reference_image_urls?: string[];
}

export interface BrandContext {
  clientName?: string;
  /** Free-text brand summary from ai_client_context.document_context. */
  documentContext?: string | null;
  /** Structured rules from ai_client_context.visual_identity. */
  visualIdentity?: VisualIdentity | null;
}

const MAX_PROMPT_CHARS = 950; // DALL-E 3 hard limit is 1000; leave headroom.

/** Apply brand context to a raw user prompt. Returns the prompt unchanged if no context. */
export function buildBrandedImagePrompt(
  userPrompt: string,
  brand: BrandContext | null | undefined,
  options: { includeDocumentContext?: boolean } = {}
): string {
  if (!brand) return userPrompt;
  if (!brand.visualIdentity && !brand.documentContext) return userPrompt;

  const parts: string[] = [userPrompt.trim()];
  const v = brand.visualIdentity || {};
  const guidance: string[] = [];

  if (v.tone_visual && v.tone_visual.length > 0) {
    guidance.push(`Visual tone: ${v.tone_visual.slice(0, 4).join(", ")}.`);
  }

  if (v.primary_colors && v.primary_colors.length > 0) {
    const palette = [...(v.primary_colors || []), ...(v.secondary_colors || [])].slice(0, 6);
    guidance.push(`Use the brand palette: ${palette.join(", ")}.`);
  }

  if (v.typography?.headline || v.typography?.body) {
    const fonts = [v.typography?.headline, v.typography?.body].filter(Boolean).join(" / ");
    if (fonts) guidance.push(`Typography references (if rendering text): ${fonts}.`);
  }

  if (v.do && v.do.length > 0) {
    guidance.push(`Do: ${v.do.slice(0, 3).join("; ")}.`);
  }

  if (v.dont && v.dont.length > 0) {
    guidance.push(`Avoid: ${v.dont.slice(0, 3).join("; ")}.`);
  }

  // Light prose fallback if visual_identity hasn't been extracted yet.
  if (guidance.length === 0 && options.includeDocumentContext && brand.documentContext) {
    const snippet = brand.documentContext.slice(0, 300).replace(/\s+/g, " ").trim();
    if (snippet) guidance.push(`Brand context: ${snippet}.`);
  }

  if (guidance.length === 0) return userPrompt;

  const clientLabel = brand.clientName ? ` for ${brand.clientName}` : "";
  parts.push(`\n\nSTYLE GUIDANCE${clientLabel}: ${guidance.join(" ")}`);

  const combined = parts.join("");
  if (combined.length <= MAX_PROMPT_CHARS) return combined;

  // Truncate guidance — keep user prompt intact, drop guidance words from the end.
  const keep = combined.slice(0, MAX_PROMPT_CHARS - 3) + "...";
  return keep;
}

/** Lightweight "did the brand actually augment this?" check for logging. */
export function brandPromptApplied(original: string, augmented: string): boolean {
  return augmented.length > original.length && augmented.includes("STYLE GUIDANCE");
}
