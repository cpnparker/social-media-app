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
  Menu,
  Upload,
  ScrollText,
  Newspaper,
  Share2,
  Lightbulb,
  SlidersHorizontal,
  Check,
  Brain,
  ListChecks,
  UserPlus,
  ChevronsUpDown,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import ChatInput, { type ChatInputHandle } from "./ChatInput";
import ShareDialog from "./ShareDialog";
import type { AIConversation, AIMessageRow, Attachment } from "@/lib/types/ai";

interface CustomerOption {
  id: string;
  name: string;
  logoUrl?: string;
}

interface ChatPanelProps {
  conversationId: string;
  onConversationDeleted?: () => void;
  onConversationUpdated?: (conv: AIConversation) => void;
  onBack?: () => void;
  initialMessage?: string;
  initialAttachments?: Attachment[];
  contextConfig?: { contracts: string; contentPipeline: string; socialPresence: string; ideas: string; incognito?: string; webSearch?: string; memory?: string; meetingBrain?: string; imageGeneration?: string };
  debugMode?: boolean;
  onCopyLink?: () => void;
  onMenuClick?: () => void;
  customers?: CustomerOption[];
  selectedCustomer?: { id: string; name: string } | null;
  onCustomerChange?: (customerId: string | null) => void;
  isAdmin?: boolean;
}

type ContextConfig = { contracts: string; contentPipeline: string; socialPresence: string; ideas: string; incognito?: string; webSearch: string; memory: string; meetingBrain: string; imageGeneration: string };

export default function ChatPanel({
  conversationId,
  onConversationDeleted,
  onConversationUpdated,
  onBack,
  initialMessage,
  initialAttachments,
  contextConfig: initialContextConfig,
  debugMode,
  onCopyLink,
  onMenuClick,
  customers,
  selectedCustomer,
  onCustomerChange,
  isAdmin,
}: ChatPanelProps) {
  const [conversation, setConversation] = useState<AIConversation | null>(null);
  const [messages, setMessages] = useState<AIMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [debugContext, setDebugContext] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [localContextConfig, setLocalContextConfig] = useState<ContextConfig>({
    contracts: initialContextConfig?.contracts || "summary",
    contentPipeline: initialContextConfig?.contentPipeline || "summary",
    socialPresence: initialContextConfig?.socialPresence || "summary",
    ideas: initialContextConfig?.ideas || "summary",
    incognito: initialContextConfig?.incognito,
    webSearch: initialContextConfig?.webSearch || "on",
    memory: initialContextConfig?.memory || "on",
    meetingBrain: initialContextConfig?.meetingBrain || "on",
    imageGeneration: initialContextConfig?.imageGeneration || "on",
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [myPermission, setMyPermission] = useState<"owner" | "view" | "collaborate">("owner");
  const canManage = myPermission === "owner" || !!isAdmin;
  const [shares, setShares] = useState<{ userId: number; userName: string | null; permission: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessageSent = useRef(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Fetch conversation and messages
  const fetchConversation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages || []);
      if (data.conversation.myPermission) setMyPermission(data.conversation.myPermission);
      if (data.conversation.shares) setShares(data.conversation.shares);
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
          body: JSON.stringify({ content, attachments, contextConfig: localContextConfig, debugMode }),
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
            } else if (parsed.searching) {
              setIsSearchingWeb(true);
            } else if (parsed.generating_image) {
              setIsGeneratingImage(true);
            } else if (parsed.image_ready) {
              setIsGeneratingImage(false);
              // Embed image markdown into the streamed content
              // Use safe alt text — the raw prompt can contain quotes/parens
              // that break markdown and HTML attribute parsing
              fullText += `\n\n![Generated image](${parsed.image_ready.url})\n\n`;
              setStreamingContent(fullText);
            } else if (parsed.image_error) {
              setIsGeneratingImage(false);
              toast.error(`Image generation failed: ${parsed.image_error}`);
            } else if (parsed.token) {
              // First token means search/image gen is done (if it was active)
              setIsSearchingWeb(false);
              setIsGeneratingImage(false);
              fullText += parsed.token;
              setStreamingContent(fullText);
            }
            if (parsed.error) {
              console.error("Stream error:", parsed.error);
              toast.error(parsed.error);
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
      toast.error(err?.message || "Failed to send message");
    } finally {
      setIsStreaming(false);
      setIsSearchingWeb(false);
      setIsGeneratingImage(false);
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

  // Drag & drop handlers for full-panel drop zone
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      chatInputRef.current?.uploadFiles(files);
    }
  }, []);

  // Minimal header shown during loading / error — keeps hamburger + back always accessible
  if (loading || !conversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-3 md:px-4 py-2 md:py-2.5 flex items-center gap-2 md:gap-3 shrink-0">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="lg:hidden shrink-0 h-10 w-10 -ml-1 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              className="lg:hidden shrink-0 h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {loading && (
            <span className="text-sm text-muted-foreground">Loading…</span>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center">
          {loading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          ) : (
            <p className="text-muted-foreground">Conversation not found</p>
          )}
        </div>
      </div>
    );
  }

  const modelLabel = getModelLabel(conversation.model);

  return (
    <div
      className="flex flex-col flex-1 min-h-0 relative overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
    >
      {/* Full-panel drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-foreground/20 bg-foreground/[0.03]">
            <Upload className="h-10 w-10 text-foreground/50" />
            <p className="text-sm font-semibold text-foreground/70">Drop files to upload</p>
            <p className="text-xs text-muted-foreground">Images, PDFs, documents, and more</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b px-3 md:px-4 py-2 md:py-2.5 flex items-center gap-2 md:gap-3 shrink-0 bg-background">
        {/* Mobile sidebar toggle — top left */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="lg:hidden shrink-0 h-10 w-10 -ml-1 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          {editingTitle && canManage ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-foreground/30 outline-none w-full"
            />
          ) : (
            <button
              onClick={() => {
                if (!canManage) return;
                setTitleDraft(conversation.title);
                setEditingTitle(true);
              }}
              className={cn(
                "text-sm font-semibold truncate text-left",
                canManage && "hover:underline cursor-pointer"
              )}
            >
              {conversation.title}
            </button>
          )}
          {/* Mobile subtitle — compact single line */}
          <p className="md:hidden text-[11px] text-muted-foreground truncate mt-0.5">
            {conversation.visibility === "private" ? "Private" : "Team"}
            {" · "}
            {modelLabel}
            {conversation.customerName && ` · ${conversation.customerName}`}
          </p>
          {/* Desktop badges row */}
          <div className="hidden md:flex items-center gap-2 mt-0.5 overflow-hidden max-h-5">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 gap-1"
            >
              {conversation.visibility === "private" ? (
                <Lock className="h-2.5 w-2.5" />
              ) : (
                <Users className="h-2.5 w-2.5" />
              )}
              {conversation.visibility === "private" ? "Private" : "Team"}
            </Badge>
            {myPermission === "view" && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 gap-1 text-muted-foreground"
              >
                View only
              </Badge>
            )}
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4"
            >
              {modelLabel}
            </Badge>
            {conversation.customerName && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 gap-1 text-muted-foreground"
              >
                <Building2 className="h-2.5 w-2.5" />
                {conversation.customerName}
              </Badge>
            )}
            {/* Avatar stack for shared users */}
            {shares.length > 0 && (
              <button
                onClick={() => canManage && setShareDialogOpen(true)}
                className={cn(
                  "flex items-center -space-x-1.5 ml-1",
                  canManage && "cursor-pointer hover:opacity-80"
                )}
                title={`Shared with ${shares.length} ${shares.length === 1 ? "person" : "people"}`}
              >
                {shares.slice(0, 3).map((s) => (
                  <div
                    key={s.userId}
                    className="h-5 w-5 rounded-full bg-foreground/[0.08] border-2 border-background flex items-center justify-center text-[8px] font-semibold text-muted-foreground"
                  >
                    {s.userName ? s.userName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) : "?"}
                  </div>
                ))}
                {shares.length > 3 && (
                  <div className="h-5 w-5 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[8px] text-muted-foreground font-medium">
                    +{shares.length - 3}
                  </div>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Desktop customer dropdown (mobile shows client in subtitle text) */}
        {customers && customers.length > 0 && onCustomerChange && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="hidden lg:flex items-center gap-1 rounded-lg border bg-background hover:bg-muted px-2 py-1 text-[12px] transition-colors shrink-0">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[120px]">
                  {selectedCustomer?.name || "General"}
                </span>
                <ChevronsUpDown className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-[240px] p-0">
              <div className="max-h-[280px] overflow-y-auto py-1">
                <button
                  onClick={() => onCustomerChange(null)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left",
                    !selectedCustomer && "bg-accent"
                  )}
                >
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1">General</span>
                  {!selectedCustomer && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
                {customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onCustomerChange(c.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left",
                      selectedCustomer?.id === c.id && "bg-accent"
                    )}
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{c.name}</span>
                    {selectedCustomer?.id === c.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 md:h-8 md:w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!canManage}
              onClick={() => {
                if (!canManage) return;
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
            {conversation.visibility === "private" && (
              <DropdownMenuItem
                disabled={!canManage}
                onClick={() => {
                  if (!canManage) return;
                  setShareDialogOpen(true);
                }}
              >
                <UserPlus className="h-3.5 w-3.5 mr-2" />
                Share
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!canManage}
              onClick={() => {
                if (!canManage) return;
                handleToggleVisibility();
              }}
            >
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
              disabled={!canManage}
              onClick={() => {
                if (!canManage) return;
                setDeleteConfirmOpen(true);
              }}
              className={canManage ? "text-destructive" : ""}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
            {!canManage && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Only the thread owner can manage this conversation
                </div>
              </>
            )}
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

        {/* Share dialog */}
        {conversation && (
          <ShareDialog
            open={shareDialogOpen}
            onOpenChange={setShareDialogOpen}
            conversationId={conversationId}
            conversationTitle={conversation.title}
            workspaceId={conversation.workspaceId}
            onSharesChanged={() => fetchConversation()}
          />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full px-4 sm:px-8 text-center">
            <div className="h-12 w-12 rounded-full bg-foreground/[0.05] flex items-center justify-center mb-4">
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
                userName={msg.createdByName}
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
            {isStreaming && isSearchingWeb && !streamingContent && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Searching the web…</span>
                </div>
              </div>
            )}
            {isStreaming && isGeneratingImage && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Generating image…</span>
                </div>
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
      <div className="border-t bg-background">
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          disabled={isStreaming || myPermission === "view"}
          bottomSlot={
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-muted/50 transition-colors">
                  <SlidersHorizontal className="h-2.5 w-2.5" />
                  <span className="hidden sm:inline">Context</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-[200px] p-1.5">
                <div className="space-y-0.5">
                  {[
                    { key: "contracts" as const, label: "Contracts", Icon: ScrollText },
                    { key: "contentPipeline" as const, label: "Content", Icon: Newspaper },
                    { key: "socialPresence" as const, label: "Social", Icon: Share2 },
                    { key: "ideas" as const, label: "Ideas", Icon: Lightbulb },
                  ].map((item) => {
                    const level = localContextConfig[item.key];
                    const isOn = level !== "off";
                    const isFull = level.startsWith("full");
                    const nextLevel = level === "off" ? "summary" : level === "summary" ? "full-month" : "off";
                    const levelLabel = level === "off" ? "Off" : level === "summary" ? "Summary" : "Full";
                    return (
                      <button
                        key={item.key}
                        onClick={() =>
                          setLocalContextConfig((prev) => ({
                            ...prev,
                            [item.key]: nextLevel,
                          }))
                        }
                        className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                      >
                        <item.Icon className={cn(
                          "h-3 w-3 shrink-0",
                          isOn ? "text-foreground/60" : "text-muted-foreground/50"
                        )} />
                        <span className={cn(
                          "flex-1",
                          isOn ? "text-foreground/80" : "text-muted-foreground/50"
                        )}>
                          {item.label}
                        </span>
                        <span className={cn(
                          "text-[9px] font-medium",
                          isOn ? "text-muted-foreground/60" : "text-muted-foreground/50"
                        )}>
                          {levelLabel}
                        </span>
                        {isOn && (
                          <Check className="h-3 w-3 text-foreground/50 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                  <div className="h-px bg-border/40 my-1" />
                  <button
                    onClick={() =>
                      setLocalContextConfig((prev) => ({
                        ...prev,
                        webSearch: prev.webSearch === "on" ? "off" : "on",
                      }))
                    }
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                  >
                    <Globe className={cn(
                      "h-3 w-3 shrink-0",
                      localContextConfig.webSearch === "on" ? "text-foreground/60" : "text-muted-foreground/50"
                    )} />
                    <span className={cn(
                      "flex-1",
                      localContextConfig.webSearch === "on" ? "text-foreground/80" : "text-muted-foreground/50"
                    )}>
                      Web Search
                    </span>
                    {localContextConfig.webSearch === "on" && (
                      <Check className="h-3 w-3 text-foreground/50 shrink-0" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      setLocalContextConfig((prev) => ({
                        ...prev,
                        memory: prev.memory === "on" ? "off" : "on",
                      }))
                    }
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                  >
                    <Brain className={cn(
                      "h-3 w-3 shrink-0",
                      localContextConfig.memory === "on" ? "text-foreground/60" : "text-muted-foreground/50"
                    )} />
                    <span className={cn(
                      "flex-1",
                      localContextConfig.memory === "on" ? "text-foreground/80" : "text-muted-foreground/50"
                    )}>
                      Memory
                    </span>
                    {localContextConfig.memory === "on" && (
                      <Check className="h-3 w-3 text-foreground/50 shrink-0" />
                    )}
                  </button>
                  {conversation?.visibility !== "team" && (
                    <button
                      onClick={() =>
                        setLocalContextConfig((prev) => ({
                          ...prev,
                          meetingBrain: prev.meetingBrain === "on" ? "off" : "on",
                        }))
                      }
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                    >
                      <ListChecks className={cn(
                        "h-3 w-3 shrink-0",
                        localContextConfig.meetingBrain === "on" ? "text-foreground/60" : "text-muted-foreground/50"
                      )} />
                      <span className={cn(
                        "flex-1",
                        localContextConfig.meetingBrain === "on" ? "text-foreground/80" : "text-muted-foreground/50"
                      )}>
                        MeetingBrain
                      </span>
                      {localContextConfig.meetingBrain === "on" && (
                        <Check className="h-3 w-3 text-foreground/50 shrink-0" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setLocalContextConfig((prev) => ({
                        ...prev,
                        imageGeneration: prev.imageGeneration === "on" ? "off" : "on",
                      }))
                    }
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                  >
                    <ImageIcon className={cn(
                      "h-3 w-3 shrink-0",
                      localContextConfig.imageGeneration === "on" ? "text-violet-400" : "text-muted-foreground/50"
                    )} />
                    <span className={cn(
                      "flex-1",
                      localContextConfig.imageGeneration === "on" ? "text-foreground/80" : "text-muted-foreground/50"
                    )}>
                      Image
                    </span>
                    {localContextConfig.imageGeneration === "on" && (
                      <Check className="h-3 w-3 text-foreground/50 shrink-0" />
                    )}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          }
          placeholder={
            myPermission === "view"
              ? "You have view-only access"
              : messages.length === 0
                ? "What would you like to work on?"
                : "Type your message..."
          }
        />
      </div>
    </div>
  );
}
