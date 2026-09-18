"use client";

import ConnectionsPanel from "@/components/connections/ConnectionsPanel";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";

/**
 * Settings → Connections (Engine app).
 *
 * A thin mount of the shared panel — the same component backs the Connections
 * tab inside EngineAI's Personalise modal, so the two cannot drift the way the
 * context-detail setting has between /settings/ai-context and the admin modal.
 *
 * The permission half is keyed on (id_workspace, user_target) and the chat gate
 * resolves it from conversation.id_workspace, so this reads the SELECTED
 * workspace rather than whichever the API returns first.
 */
export default function ConnectionsSettingsPage() {
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id ? String(wsCtx.selectedWorkspace.id) : null;

  return <ConnectionsPanel workspaceId={workspaceId} />;
}
