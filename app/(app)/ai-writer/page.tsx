"use client";

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [tab, setTab] = useState<"private" | "team">("private");
  const [homeInput, setHomeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const customerId =
    searchParams.get("customerId") || customerCtx?.selectedCustomerId || null;

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
    fetchConversations();
  }, [fetchConversations]);

  // Auto-handle contentObjectId param
  useEffect(() => {
    const contentObjectId = searchParams.get("contentObjectId");
    if (contentObjectId && workspaceId && conversations.length > 0) {
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

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [homeInput]);

  // Quick-send: create conversation + pass initial message to ChatPanel
  const handleQuickSend = async () => {
    const content = homeInput.trim();
    if (!content || !workspaceId || sending) return;

    setSending(true);
    try {
      const contentObjectId = searchParams.get("contentObjectId");
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          visibility: tab,
          model: selectedModel,
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
      setInitialMessage(content);
      setSelectedId(newConv.id);
      setHomeInput("");
      if (contentObjectId) {
        router.replace("/ai-writer");
      }
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
  };

  const handleBack = () => {
    setSelectedId(null);
    setInitialMessage(undefined);
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
    if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    return true;
  });

  // ─── Chat view ───
  if (selectedId) {
    return (
      <div className="h-[calc(100vh-57px)] -m-4 sm:-m-6 flex flex-col">
        <ChatPanel
          key={selectedId}
          conversationId={selectedId}
          onConversationDeleted={handleConversationDeleted}
          onConversationUpdated={handleConversationUpdated}
          onBack={handleBack}
          initialMessage={initialMessage}
        />
      </div>
    );
  }

  // ─── Home view (Perplexity-style) ───
  return (
    <div className="h-[calc(100vh-57px)] -m-4 sm:-m-6 flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col">
        {/* Hero + Input */}
        <div className="flex flex-col items-center pt-12 sm:pt-20 pb-8 px-4">
          {/* Logo */}
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">
            EngineGPT
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            Your AI-powered content assistant
          </p>

          {/* Input area */}
          <div className="w-full max-w-2xl">
            <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
              <textarea
                ref={textareaRef}
                value={homeInput}
                onChange={(e) => setHomeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                disabled={sending}
                rows={1}
                className="w-full resize-none bg-transparent pl-4 pr-28 py-3.5 text-sm focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
                style={{ minHeight: "48px", maxHeight: "160px" }}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
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
                  disabled={sending || !homeInput.trim()}
                  className="h-8 w-8 shrink-0"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
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
                  onClick={() => setSelectedId(conv.id)}
                  className="w-full text-left rounded-lg border bg-background hover:bg-muted/50 transition-colors p-4 group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold truncate">
                          {conv.title}
                        </span>
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
