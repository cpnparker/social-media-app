export interface AIConversation {
  id: string;
  workspace_id: string;
  created_by: number;
  created_by_name?: string;
  title: string;
  visibility: "private" | "team";
  content_object_id: number | null;
  content_title?: string;
  model: string;
  message_count?: number;
  last_message_preview?: string;
  created_at: string;
  updated_at: string;
}

export interface AIMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  created_by: number | null;
  created_by_name?: string;
  created_at: string;
}
