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
  // Share-awareness fields (optional, populated by API)
  sharedWithMe?: boolean;
  myPermission?: "owner" | "view" | "collaborate";
  sharedByName?: string;
  shareCount?: number;
  // Conversation summary (thread memory)
  summary?: string | null;
}

export interface AIConversationShare {
  id: string;
  conversationId: string;
  userId: number;
  userName?: string;
  userEmail?: string;
  permission: "view" | "collaborate";
  sharedBy: number;
  createdAt: string;
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
  // V2: reinforcement, decay & source tracking
  strength: number; // 0.0-1.0, base strength (boosted on reinforcement)
  reinforcedCount: number; // times confirmed by similar new info
  lastAccessedAt: string; // last retrieval or reinforcement (drives decay)
  source: "explicit" | "inferred" | "meeting"; // user-created vs AI-extracted vs meeting-sourced
}

export interface AIRole {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  instructions: string;
  icon: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
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
  status?: "pending" | "complete" | "failed";
}
