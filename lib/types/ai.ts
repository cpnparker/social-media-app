export interface AIConversation {
  id: string;
  workspaceId: string;
  createdBy: number;
  createdByName?: string;
  title: string;
  visibility: "private" | "team";
  contentObjectId: number | null;
  contentTitle?: string;
  customerId: number | null;
  customerName?: string;
  model: string;
  messageCount?: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  url: string;
  name: string;
  type: string; // MIME type
  size: number;
}

export interface MemorySuggestion {
  content: string;
  category: "preference" | "fact" | "instruction" | "style" | "client_insight";
  confidence: number;
}

export interface AIMemory {
  id: string;
  workspaceId: string;
  userId: number | null;
  scope: "private" | "team";
  category: string;
  content: string;
  sourceConversationId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AIMessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[] | null;
  model: string | null;
  createdBy: number | null;
  createdByName?: string;
  createdAt: string;
}
