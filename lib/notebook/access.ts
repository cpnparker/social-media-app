/**
 * Notebook read/write authorisation.
 *
 * ONE definition of "who can see this entry", used by the list API, the
 * search_notebook tool and the AI composer. The recurring lesson in this
 * codebase is that a gate applied at only some readers is not a gate
 * (see the memory-injection branch that read raw type_visibility while the
 * tool layer used the computed audience) — so every reader calls in here.
 *
 * THE RULE
 *   A notebook is readable by its owner, and by any workspace member when it
 *   is team-visible.
 *   An ENTRY inside a readable notebook is visible to someone other than its
 *   author only when ALL of:
 *     - the notebook is team-visible, AND
 *     - flag_private_source = 0  (the stamped floor), AND
 *     - the source thread, IF it still exists, is team-visible (the live check)
 *
 * The stamped flag and the live lookup do different jobs and both are needed:
 * the flag survives deletion of the source thread (id_conversation is SET NULL,
 * which a live-only check would misread as "no source, therefore shareable"),
 * and the live lookup demotes captures from a thread that was later switched
 * back to private.
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";

export interface NotebookRow {
  id_notebook: string;
  id_workspace: string;
  user_created: number;
  type_visibility: "private" | "team";
}

export interface EntryRow {
  id_entry: string;
  id_notebook: string;
  user_created: number;
  id_conversation: string | null;
  flag_private_source: number;
  [k: string]: unknown;
}

/** Can this user open the notebook at all? */
export function canReadNotebook(nb: NotebookRow | null | undefined, userId: number, workspaceId: string): boolean {
  if (!nb) return false;
  if (nb.id_workspace !== workspaceId) return false;
  if (nb.user_created === userId) return true;
  return nb.type_visibility === "team";
}

/** Only the owner may rename, share, archive or delete a notebook. */
export function canWriteNotebook(nb: NotebookRow | null | undefined, userId: number, workspaceId: string): boolean {
  return !!nb && nb.id_workspace === workspaceId && nb.user_created === userId;
}

/**
 * Resolve the live visibility of every source thread referenced by these
 * entries, in ONE query rather than per entry.
 * Returns a map of conversationId → "private" | "team". A thread that has been
 * deleted is simply absent, and the caller treats absence as private.
 */
export async function loadSourceVisibility(entries: Pick<EntryRow, "id_conversation">[]): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(entries.map((e) => e.id_conversation).filter((x): x is string => !!x))
  );
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await intelligenceDb
    .from("ai_conversations")
    .select("id_conversation, type_visibility")
    .in("id_conversation", ids);
  for (const row of data || []) out.set(row.id_conversation, row.type_visibility);
  return out;
}

/**
 * Filter entries to those `userId` may read, given the notebook they live in
 * and the source-visibility map from loadSourceVisibility().
 *
 * FAILS CLOSED: an entry whose source thread cannot be resolved is treated as
 * private, so it stays with its author.
 */
export function visibleEntries<T extends EntryRow>(
  entries: T[],
  notebook: NotebookRow,
  userId: number,
  sourceVisibility: Map<string, string>
): T[] {
  return entries.filter((e) => {
    if (e.user_created === userId) return true; // your own capture, always
    if (notebook.type_visibility !== "team") return false;
    if (e.flag_private_source === 1) return false; // stamped floor
    if (e.id_conversation) {
      // Absent = thread deleted or unreadable → treat as private.
      return sourceVisibility.get(e.id_conversation) === "team";
    }
    // No source thread and not stamped private: an authored-in-place note.
    return true;
  });
}

/**
 * Decide the flag_private_source stamp for a NEW entry captured from a thread.
 * Anything that cannot be positively confirmed team-visible is stamped private.
 */
export async function stampPrivateSource(
  conversationId: string | null | undefined,
  workspaceId: string,
  userId: number
): Promise<{ flag: 0 | 1; sourceTitle: string | null; conversationId: string | null }> {
  if (!conversationId) return { flag: 1, sourceTitle: null, conversationId: null };

  const { data: conv } = await intelligenceDb
    .from("ai_conversations")
    .select("id_conversation, type_visibility, id_workspace, user_created, name_conversation, id_client")
    .eq("id_conversation", conversationId)
    .maybeSingle();

  // Same authorisation shape as the memories POST: the referenced object must
  // exist, be in this workspace, and be readable by this caller. A caller can
  // otherwise name any conversation id and have it count as provenance.
  const sameWorkspace = !!conv && conv.id_workspace === workspaceId;
  const readable =
    sameWorkspace && (conv!.user_created === userId || conv!.type_visibility === "team");
  if (!conv || !sameWorkspace || !readable) {
    console.warn(`[Notebook] user ${userId} referenced an unreadable source conversation — capturing without provenance`);
    return { flag: 1, sourceTitle: null, conversationId: null };
  }

  return {
    flag: conv.type_visibility === "team" ? 0 : 1,
    sourceTitle: (conv.name_conversation as string | null) || null,
    conversationId: conv.id_conversation,
  };
}
