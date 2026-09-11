import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";

/**
 * May this user write to the deck stored on this message?
 *
 * Both slide routes address `ai_messages` by a client-supplied message id, and
 * both did it with the service-role client — which exists to bypass RLS, so
 * there was no database backstop underneath. Being signed in as ANYONE was
 * enough to overwrite the deck on ANYONE's message: replace the slides, point
 * the images at a URL you control, or stamp a `published` link at a deck in
 * your own Drive onto someone else's thread. Message ids are not secret; every
 * participant in a shared conversation is handed them by the read API.
 *
 * A read-only share is not write access either. Someone given "view" on a
 * conversation can see the draft, and that is the whole of what view means.
 */
export type DraftAccess =
  | { ok: true; draft: any }
  | { ok: false; status: number; error: string };

export async function draftWriteAccess(
  messageId: string,
  userId: number
): Promise<DraftAccess> {
  const { data: message } = await intelligenceDb
    .from("ai_messages")
    .select("id_message, id_conversation, slides_draft")
    .eq("id_message", messageId)
    .maybeSingle();

  // Same answer for "no such message" and "not yours": a 403 here would confirm
  // that a guessed id exists and carries a deck.
  if (!message) return { ok: false, status: 404, error: "No draft on that message" };

  const { data: conversation } = await intelligenceDb
    .from("ai_conversations")
    .select("id_conversation, type_visibility, user_created, id_workspace")
    .eq("id_conversation", message.id_conversation)
    .maybeSingle();
  if (!conversation) return { ok: false, status: 404, error: "No draft on that message" };

  const access = await checkConversationAccess(conversation.id_conversation, userId, {
    visibility: conversation.type_visibility,
    userCreated: conversation.user_created,
    workspaceId: conversation.id_workspace,
  });
  if (!access.allowed) return { ok: false, status: 404, error: "No draft on that message" };
  if (access.permission === "view") {
    return { ok: false, status: 403, error: "You have view-only access to this conversation" };
  }

  const draft = (message as any).slides_draft;
  if (!draft) return { ok: false, status: 404, error: "No draft on that message" };
  return { ok: true, draft };
}
