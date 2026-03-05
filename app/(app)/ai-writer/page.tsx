"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import ConversationList from "@/components/ai-writer/ConversationList";
import ChatPanel from "@/components/ai-writer/ChatPanel";
import type { AIConversation } from "@/lib/types/ai";

export default function AIWriterPage() {
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const customerCtx = useCustomerSafe();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("conversation") || null
  );
  const [loading, setLoading] = useState(true);

  // Use URL param if provided, otherwise use the selected customer from context
  const customerId = searchParams.get("customerId") || customerCtx?.selectedCustomerId || null;

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      let url = `/api/ai/conversations?workspaceId=${workspaceId}`;
      if (customerId) url += `&customerId=${customerId}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, customerId]);

  useEffect(() => {
    setSelectedId(null);
    fetchConversations();
  }, [fetchConversations]);

  // Auto-handle contentObjectId param
  useEffect(() => {
    const contentObjectId = searchParams.get("contentObjectId");
    if (contentObjectId && workspaceId && conversations.length > 0) {
      // Check if a team conversation already exists for this content
      const existing = conversations.find(
        (c) =>
          c.contentObjectId === parseInt(contentObjectId, 10) &&
          c.visibility === "team"
      );
      if (existing) {
        setSelectedId(existing.id);
      }
    }
  }, [searchParams, conversations, workspaceId]);

  // Create new conversation
  const handleNewConversation = async (visibility: "private" | "team") => {
    if (!workspaceId) {
      toast.error("No workspace selected");
      return;
    }
    try {
      const contentObjectId = searchParams.get("contentObjectId");
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          visibility,
          contentObjectId: contentObjectId || undefined,
          customerId: customerId || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to create conversation");
        return;
      }
      const data = await res.json();
      const newConv = data.conversation;
      setConversations((prev) => [newConv, ...prev]);
      setSelectedId(newConv.id);
      // Clear contentObjectId from URL
      if (contentObjectId) {
        router.replace("/ai-writer");
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
      toast.error("Failed to create conversation");
    }
  };

  // Handle conversation updates (title change, visibility change)
  const handleConversationUpdated = (updated: AIConversation) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  // Handle conversation deletion
  const handleConversationDeleted = () => {
    setConversations((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
  };

  return (
    <div className="flex h-[calc(100vh-57px)] -m-4 sm:-m-6">
      {/* Left panel — Conversation list */}
      <div className="w-80 border-r flex flex-col bg-background shrink-0">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewConversation={handleNewConversation}
          loading={loading}
        />
      </div>

      {/* Right panel — Chat or empty state */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedId ? (
          <ChatPanel
            key={selectedId}
            conversationId={selectedId}
            onConversationDeleted={handleConversationDeleted}
            onConversationUpdated={handleConversationUpdated}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">EngineGPT</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Your AI-powered content assistant. Start a conversation to
              brainstorm ideas, draft content, refine messaging, and more.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleNewConversation("private")}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                New Private Chat
              </button>
              <button
                onClick={() => handleNewConversation("team")}
                className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
              >
                New Team Chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
