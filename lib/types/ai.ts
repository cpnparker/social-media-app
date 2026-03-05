export interface AIConversation {
  id: string;
  workspaceId: string;
  createdBy: number;
  createdByName?: string;
  title: string;
  visibility: "private" | "team";
  contentObjectId: number | null;
  contentTitle?: string;
  model: string;
  messageCount?: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIMessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  createdBy: number | null;
  createdByName?: string;
  createdAt: string;
}
