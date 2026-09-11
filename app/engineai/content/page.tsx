/**
 * Everything written or assessed in this workspace.
 *
 * Its own route rather than a parameter on either tool, because it belongs to
 * neither: both surfaces link to it, and "N more…" in the rail needs somewhere
 * to go that is not a create screen.
 */
import { OptimizerSurface } from "../optimizer/page";

export default function ContentListPage() {
  return <OptimizerSurface surface="content" />;
}
