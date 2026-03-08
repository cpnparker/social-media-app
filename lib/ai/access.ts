import { db } from "@/lib/db";
import { aiConversationShares } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type AccessResult =
  | { allowed: true; permission: "owner" | "view" | "collaborate" }
  | { allowed: false };

/**
 * Centralised access check for AI conversations.
 * Returns the user's permission level or denies access.
 */
export async function checkConversationAccess(
  conversationId: string,
  userId: number,
  conversation: { visibility: string; createdBy: number }
): Promise<AccessResult> {
  // Owner always has full access
  if (conversation.createdBy === userId) {
    return { allowed: true, permission: "owner" };
  }

  // Team conversations are accessible to all workspace members
  if (conversation.visibility === "team") {
    return { allowed: true, permission: "collaborate" };
  }

  // Private conversations — check shares table
  const [share] = await db
    .select({ permission: aiConversationShares.permission })
    .from(aiConversationShares)
    .where(
      and(
        eq(aiConversationShares.conversationId, conversationId),
        eq(aiConversationShares.userId, userId)
      )
    )
    .limit(1);

  if (share) {
    return {
      allowed: true,
      permission: share.permission as "view" | "collaborate",
    };
  }

  return { allowed: false };
}
