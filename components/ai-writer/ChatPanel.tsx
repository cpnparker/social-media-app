"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock,
  Users,
  MoreHorizontal,
  Trash2,
  Pencil,
  Globe,
  ArrowLeft,
  Building2,
  Link2,
  Bug,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getModelLabel } from "@/lib/ai/models";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import type { AIConversation, AIMessageRow, Attachment } from "@/lib/types/ai";

interface ChatPanelProps {
  conversationId: string;
  onConversationDeleted?: () => void;
  onConversationUpdated?: (conv: AIConversation) => void;
  onBack?: () => void;
  initialMessage?: string;
  initialAttachments?: Attachment[];
  contextConfig?: { contracts: boolean; contentPipeline: boolean; socialPresence: boolean; ideas?: boolean };
  debugMode?: boolean;
  onCopyLink?: () => void;
}

export default function ChatPanel({
  conversationId,
  onConversationDeleted,
  onConversationUpdated,
  onBack,
  initialMessage,
  initialAttachments,
  contextConfig,
  debugMode,
  onCopyLink,
}: ChatPanelProps) {
  const [conversation, setConversation] = useState<AIConversation | null>(null);
  const [messages, setMessages] = useState<AIMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [debugContext, setDebugContext] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessageSent = useRef(false);

  // Fetch conversation and messages
  const fetchConversation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  // Auto-send initial message (quick-send from home page)
  useEffect(() => {
    if ((initialMessage || initialAttachments?.length) && conversation && !initialMessageSent.current && !loading) {
      initialMessageSent.current = true;
      handleSend(initialMessage || "", initialAttachments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, initialAttachments, conversation, loading]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Send message with streaming
  const handleSend = async (content: string, attachments?: Attachment[]) => {
    if (!conversation) return;

    // Optimistically add user message
    const tempUserMsg: AIMessageRow = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId,
      role: "user",
      content,
      attachments: attachments || null,
      model: null,
      createdBy: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsStreaming(true);
    setStreamingContent("");
    setDebugContext(null);
    setDebugExpanded(false);

    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, attachments, contextConfig, debugMode }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send message");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.debugContext) {
              setDebugContext(parsed.debugContext);
            } else if (parsed.token) {
              fullText += parsed.token;
              setStreamingContent(fullText);
            }
            if (parsed.error) {
              console.error("Stream error:", parsed.error);
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      // Add assistant message to state
      if (fullText) {
        const assistantMsg: AIMessageRow = {
          id: `assistant-${Date.now()}`,
          conversationId: conversationId,
          role: "assistant",
          content: fullText,
          model: conversation.model,
          createdBy: null,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      // Update conversation title if it changed (auto-title on first message)
      if (messages.filter((m) => m.role === "user").length === 0) {
        // Refetch to get updated title
        const convRes = await fetch(`/api/ai/conversations/${conversationId}`);
        if (convRes.ok) {
          const convData = await convRes.json();
          setConversation(convData.conversation);
          onConversationUpdated?.(convData.conversation);
        }
      }
    } catch (err: any) {
      console.error("Send error:", err);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  // Update title
  const handleSaveTitle = async () => {
    if (!titleDraft.trim() || !conversation) return;
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversation(data.conversation);
        onConversationUpdated?.(data.conversation);
      }
    } catch {}
    setEditingTitle(false);
  };

  // Toggle visibility
  const handleToggleVisibility = async () => {
    if (!conversation) return;
    const newVis = conversation.visibility === "private" ? "team" : "private";
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: newVis }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversation(data.conversation);
        onConversationUpdated?.(data.conversation);
      }
    } catch {}
  };

  // Delete conversation
  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete conversation");
        return;
      }
      onConversationDeleted?.();
    } catch (err) {
      toast.error("Failed to delete conversation");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Conversation not found
      </div>
    );
  }

  const modelLabel = getModelLabel(conversation.model);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-3 md:px-4 py-2.5 flex items-center gap-2 md:gap-3 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-primary outline-none w-full"
            />
          ) : (
            <button
              onClick={() => {
                setTitleDraft(conversation.title);
                setEditingTitle(true);
              }}
              className="text-sm font-semibold truncate hover:underline text-left"
            >
              {conversation.title}
            </button>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="outline"
              className="text-xs md:text-[10px] px-2 md:px-1.5 py-0.5 md:py-0 h-5 md:h-4 gap-1"
            >
              {conversation.visibility === "private" ? (
                <Lock className="h-2.5 w-2.5" />
              ) : (
                <Users className="h-2.5 w-2.5" />
              )}
              {conversation.visibility === "private" ? "Private" : "Team"}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs md:text-[10px] px-2 md:px-1.5 py-0.5 md:py-0 h-5 md:h-4"
            >
              {modelLabel}
            </Badge>
            {conversation.customerName && (
              <Badge
                variant="outline"
                className="text-xs md:text-[10px] px-2 md:px-1.5 py-0.5 md:py-0 h-5 md:h-4 gap-1 text-muted-foreground"
              >
                <Building2 className="h-2.5 w-2.5" />
                {conversation.customerName}
              </Badge>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 md:h-8 md:w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setTitleDraft(conversation.title);
                setEditingTitle(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            {onCopyLink && (
              <DropdownMenuItem onClick={onCopyLink}>
                <Link2 className="h-3.5 w-3.5 mr-2" />
                Copy link
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleToggleVisibility}>
              {conversation.visibility === "private" ? (
                <>
                  <Globe className="h-3.5 w-3.5 mr-2" />
                  Make Team
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 mr-2" />
                  Make Private
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteConfirmOpen(true)}
              className="text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete confirmation dialog */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{conversation.title}&rdquo; and all its messages. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full px-4 sm:px-8 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-2xl">✨</span>
            </div>
            <h3 className="text-base font-semibold mb-1">
              Start a conversation
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ask me to help you brainstorm ideas, draft content, refine
              messaging, or anything content-related.
            </p>
          </div>
        ) : (
          <div className="py-4 space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                model={msg.model}
                attachments={msg.attachments}
              />
            ))}
            {/* Debug context preview */}
            {debugContext && (
              <div className="mx-4 sm:mx-8 my-2">
                <button
                  onClick={() => setDebugExpanded(!debugExpanded)}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                >
                  <Bug className="h-3.5 w-3.5" />
                  System Prompt
                  <span className="text-[10px] text-muted-foreground font-normal">
                    ({Math.round(debugContext.length / 4).toLocaleString()} est. tokens)
                  </span>
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${debugExpanded ? "rotate-90" : ""}`}
                  />
                </button>
                {debugExpanded && (
                  <pre className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-[11px] leading-relaxed text-amber-900 dark:text-amber-100 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono">
                    {debugContext}
                  </pre>
                )}
              </div>
            )}
            {isStreaming && streamingContent && (
              <MessageBubble
                role="assistant"
                content={streamingContent}
                model={conversation.model}
                isStreaming
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isStreaming}
        placeholder={
          messages.length === 0
            ? "What would you like to work on?"
            : "Type your message..."
        }
      />
    </div>
  );
}
