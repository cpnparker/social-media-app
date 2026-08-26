/**
 * The AI Writer.
 *
 * You arrive with a commission, a brief, or nothing, and produce text with
 * EngineAI beside you. Distinct from the Optimiser, which assesses text that
 * already exists — see the Surface type for why they were one surface until
 * 2026-08-26 and why that was wrong.
 *
 * Same component, because the document, the editor and the anchoring path are
 * genuinely shared; only the job differs.
 */
import { OptimizerSurface } from "../optimizer/page";

export default function WriterPage() {
  return <OptimizerSurface surface="writer" />;
}
