"use client";

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import {
  Sparkles,
  Send,
  ChevronDown,
  Lock,
  Users,
  MessageSquare,
  Loader2,
  Search,
  Paperclip,
  X,
  FileText,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AI_MODELS, DEFAULT_MODEL, getModelLabel } from "@/lib/ai/models";
import ChatPanel from "@/components/ai-writer/ChatPanel";
import type { AIConversation, Attachment } from "@/lib/types/ai";

export default function EngineGPTPage() {
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const customerCtx = useCustomerSafe();

  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [tab, setTab] = useState<"private" | "team">("private");
  const [homeInput, setHomeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>();
  const [initialAttachments, setInitialAttachments] = useState<
    Attachment[] | undefined
  >();
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customerId = customerCtx?.selectedCustomerId || null;

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
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    fetchConversations();
  }, [fetchConversations]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [homeInput]);

  // File upload handler
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || `Failed to upload ${file.name}`);
          continue;
        }

        const data = await res.json();
        setPendingAttachments((prev) => [
          ...prev,
          {
            url: data.url,
            name: file.name,
            type: file.type,
            size: file.size,
          },
        ]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Quick-send: create conversation + pass initial message to ChatPanel
  const handleQuickSend = async () => {
    const content = homeInput.trim();
    if (
      (!content && pendingAttachments.length === 0) ||
      !workspaceId ||
      sending
    )
      return;

    setSending(true);
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          visibility: tab,
          model: selectedModel,
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
      setInitialMessage(content || undefined);
      setInitialAttachments(
        pendingAttachments.length > 0 ? pendingAttachments : undefined
      );
      setSelectedId(newConv.id);
      setHomeInput("");
      setPendingAttachments([]);
    } catch (err) {
      console.error("Failed to create conversation:", err);
      toast.error("Failed to create conversation");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleQuickSend();
    }
  };

  // Handle conversation updates
  const handleConversationUpdated = (updated: AIConversation) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  const handleConversationDeleted = () => {
    setConversations((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
  };

  const handleBack = () => {
    setSelectedId(null);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    fetchConversations();
  };

  // Time formatting
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
  };

  // Filter conversations
  const filtered = conversations.filter((c) => {
    if (tab === "private" && c.visibility !== "private") return false;
    if (tab === "team" && c.visibility !== "team") return false;
    if (
      searchQuery &&
      !c.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  // Switch customer dropdown when selecting a thread with a customerId
  const handleSelectThread = (conv: AIConversation) => {
    if (conv.customerId && customerCtx) {
      const custId = String(conv.customerId);
      if (customerCtx.selectedCustomerId !== custId) {
        customerCtx.setSelectedCustomerId(custId);
      }
    }
    setSelectedId(conv.id);
  };

  // ─── Chat view ───
  if (selectedId) {
    return (
      <div className="h-full flex flex-col">
        <ChatPanel
          key={selectedId}
          conversationId={selectedId}
          onConversationDeleted={handleConversationDeleted}
          onConversationUpdated={handleConversationUpdated}
          onBack={handleBack}
          initialMessage={initialMessage}
          initialAttachments={initialAttachments}
        />
      </div>
    );
  }

  // ─── Home view ───
  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col">
        {/* Hero + Input */}
        <div className="flex flex-col items-center pt-16 sm:pt-24 pb-10 px-4">
          {/* Icon */}
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            EngineGPT
          </h1>
          <p className="text-base text-muted-foreground mb-10 max-w-md text-center">
            Your AI-powered content assistant. Brainstorm ideas, draft content,
            refine messaging, and more.
          </p>

          {/* Input area */}
          <div className="w-full max-w-2xl">
            {/* Attachment preview strip */}
            {pendingAttachments.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
                {pendingAttachments.map((att, i) => (
                  <div
                    key={`${att.name}-${i}`}
                    className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5 text-xs group"
                  >
                    {att.type.startsWith("image/") ? (
                      <img
                        src={att.url}
                        alt={att.name}
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate max-w-[120px]">{att.name}</span>
                    <span className="text-muted-foreground">
                      {formatSize(att.size)}
                    </span>
                    <button
                      onClick={() => removeAttachment(i)}
                      className="h-4 w-4 rounded-full hover:bg-background flex items-center justify-center shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative rounded-2xl border bg-background shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
              <textarea
                ref={textareaRef}
                value={homeInput}
                onChange={(e) => setHomeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                disabled={sending}
                rows={1}
                className="w-full resize-none bg-transparent pl-5 pr-40 py-4 text-sm focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
                style={{ minHeight: "56px", maxHeight: "160px" }}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
                {/* Attach button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || uploading}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  title="Attach file"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.txt,.csv,.md"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {/* Model picker */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5"
                    >
                      {getModelLabel(selectedModel)}
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {AI_MODELS.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => setSelectedModel(m.id)}
                        className={cn(
                          "text-sm",
                          selectedModel === m.id && "bg-muted font-medium"
                        )}
                      >
                        <span className="flex-1">{m.label}</span>
                        {selectedModel === m.id && (
                          <span className="text-primary text-xs">&#10003;</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Send button */}
                <Button
                  size="icon"
                  onClick={handleQuickSend}
                  disabled={
                    sending ||
                    uploading ||
                    (!homeInput.trim() && pendingAttachments.length === 0)
                  }
                  className="h-9 w-9 shrink-0 rounded-xl"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center mt-2.5">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>

        {/* Thread section */}
        <div className="w-full max-w-2xl mx-auto px-4 pb-8 flex-1">
          {/* Tab bar + search */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={() => setTab("private")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  tab === "private"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Lock className="h-3 w-3 inline-block mr-1.5 -mt-0.5" />
                My threads
              </button>
              <button
                onClick={() => setTab("team")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  tab === "team"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="h-3 w-3 inline-block mr-1.5 -mt-0.5" />
                Shared threads
              </button>
            </div>

            {/* Search */}
            <div className="flex-1 relative max-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Thread list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No threads yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery
                  ? "No threads match your search"
                  : "Type a message above to start your first conversation"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectThread(conv)}
                  className="w-full text-left rounded-xl border bg-background hover:bg-muted/50 transition-colors p-4 group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold truncate">
                          {conv.title}
                        </span>
                        {conv.customerName && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 shrink-0 gap-1 text-muted-foreground"
                          >
                            <Building2 className="h-2.5 w-2.5" />
                            {conv.customerName}
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                        >
                          {getModelLabel(conv.model)}
                        </Badge>
                      </div>
                      {conv.lastMessagePreview && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {conv.lastMessagePreview}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {conv.visibility === "team" && (
                        <Users className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(conv.updatedAt)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
