/**
 * Maps database column names (Ed's DDL) → frontend-friendly camelCase names.
 *
 * The Supabase intelligence schema uses column names like `id_conversation`,
 * `type_visibility`, `name_model`, etc. but the frontend TypeScript interfaces
 * (AIConversation, AIMessageRow, AIMemory, AIRole, etc.) use camelCase.
 *
 * These mappers sit in the API layer to keep DB queries using real column names
 * and frontend code using the TypeScript interfaces.
 */

// ── Conversation (ai_conversations) ──

export function mapConversation(row: any) {
  if (!row) return row;
  return {
    id: row.id_conversation,
    workspaceId: row.id_workspace,
    createdBy: row.user_created,
    title: row.name_conversation,
    visibility: row.type_visibility,
    contentObjectId: row.id_content,
    customerId: row.id_client,
    model: row.name_model,
    isIncognito: !!row.flag_incognito,
    createdAt: row.date_created,
    updatedAt: row.date_updated,
  };
}

// ── Message (ai_messages) ──

export function mapMessage(row: any) {
  if (!row) return row;
  return {
    id: row.id_message,
    conversationId: row.id_conversation,
    role: row.role_message,
    content: row.document_message,
    attachments: row.attachments ?? null,
    model: row.name_model ?? null,
    createdBy: row.user_created ?? null,
    createdAt: row.date_created,
  };
}

// ── Memory (ai_memories) ──

export function mapMemory(row: any) {
  if (!row) return row;
  return {
    id: row.id_memory,
    workspaceId: row.id_workspace,
    userId: row.user_memory ?? null,
    scope: row.type_scope,
    category: row.type_category,
    content: row.information_content,
    sourceConversationId: row.id_conversation_source ?? null,
    isActive: row.flag_active === 1,
    createdAt: row.date_created,
    updatedAt: row.date_updated,
  };
}

// ── Role (ai_roles) ──

export function mapRole(row: any) {
  if (!row) return row;
  return {
    id: row.id_role,
    workspaceId: row.id_workspace,
    name: row.name_role,
    description: row.information_description,
    instructions: row.information_instructions,
    icon: row.name_icon,
    isDefault: row.flag_default === 1,
    isActive: row.flag_active === 1,
    sortOrder: row.order_sort,
    createdAt: row.date_created,
    updatedAt: row.date_updated,
  };
}

// ── Share (ai_shares / ai_conversation_shares) ──

export function mapShare(row: any) {
  if (!row) return row;
  return {
    id: row.id_share,
    conversationId: row.id_conversation,
    userId: row.user_recipient,
    permission: row.type_permission,
    sharedBy: row.user_shared,
    createdAt: row.date_created,
  };
}
