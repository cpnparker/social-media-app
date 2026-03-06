"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from "react";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import {
  Sparkles,
  Send,
  ChevronDown,
  Lock,
  Users,
  Loader2,
  Search,
  Paperclip,
  X,
  FileText,
  Building2,
  Plus,
  Menu,
  LogOut,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AI_MODELS, DEFAULT_MODEL, getModelLabel } from "@/lib/ai/models";
import ChatPanel from "@/components/ai-writer/ChatPanel";
import { signOut } from "next-auth/react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customerId = customerCtx?.selectedCustomerId || null;
  const customers = customerCtx?.customers || [];
  const selectedCustomer = customerCtx?.selectedCustomer;
  const canViewAll = customerCtx?.canViewAll ?? false;

  // Fetch user info for sidebar
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.name) setUserName(d.user.name);
        if (d.user?.email) setUserEmail(d.user.email);
      })
      .catch(() => {});
  }, []);

  const userInitials = userName
    ? userName
        .split(" ")
        .map((w: string) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

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

  const handleNewChat = () => {
    setSelectedId(null);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    setSidebarOpen(false);
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

  // Select thread + switch customer dropdown + close mobile sidebar
  const handleSelectThread = (conv: AIConversation) => {
    if (conv.customerId && customerCtx) {
      const custId = String(conv.customerId);
      if (customerCtx.selectedCustomerId !== custId) {
        customerCtx.setSelectedCustomerId(custId);
      }
    }
    setSelectedId(conv.id);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    setSidebarOpen(false);
  };

  return (
    <>
      {/* ─── Mobile overlay backdrop ─── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col",
          "bg-[#2e3440] text-white",
          "transform transition-transform duration-300 ease-in-out",
          "lg:static lg:z-auto lg:translate-x-0 lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Top section */}
        <div className="shrink-0 p-3 space-y-3">
          {/* Logo + New Chat */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold tracking-tight">
                EngineGPT
              </span>
            </div>
            <button
              onClick={handleNewChat}
              className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
            <input
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 rounded-lg bg-white/10 border-0 pl-8 pr-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>

          {/* Private / Team tabs */}
          <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => setTab("private")}
              className={cn(
                "flex-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                tab === "private"
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/70"
              )}
            >
              <Lock className="h-3 w-3 inline mr-1 -mt-0.5" />
              Private
            </button>
            <button
              onClick={() => setTab("team")}
              className={cn(
                "flex-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                tab === "team"
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/70"
              )}
            >
              <Users className="h-3 w-3 inline mr-1 -mt-0.5" />
              Team
            </button>
          </div>
        </div>

        {/* Scrollable conversation list */}
        <div className="flex-1 overflow-y-auto px-2 py-1 scrollbar-hide">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-white/40" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 px-3">
              <p className="text-xs text-white/40">
                {searchQuery
                  ? "No chats match your search"
                  : "No conversations yet"}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectThread(conv)}
                  className={cn(
                    "w-full text-left rounded-lg px-3 py-2.5 transition-colors group",
                    selectedId === conv.id
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm truncate flex-1">{conv.title}</p>
                    <span className="text-[10px] text-white/30 shrink-0">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>
                  {conv.customerName && (
                    <p className="text-[11px] text-white/40 truncate mt-0.5">
                      {conv.customerName}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-white/10 p-3 space-y-1">
          {/* Client dropdown */}
          {customers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-white/10 transition-colors text-left">
                  <Building2 className="h-3.5 w-3.5 text-white/50 shrink-0" />
                  <span className="flex-1 truncate text-white/70 text-xs">
                    {selectedCustomer?.name || "All Clients"}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 text-white/40 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                {canViewAll && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        customerCtx?.setSelectedCustomerId(null)
                      }
                      className="gap-2"
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">All Clients</span>
                      {!selectedCustomer && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {customers.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() =>
                      customerCtx?.setSelectedCustomerId(c.id)
                    }
                    className="gap-2"
                  >
                    {c.logoUrl ? (
                      <img
                        src={c.logoUrl}
                        alt=""
                        className="h-4 w-4 rounded object-cover"
                      />
                    ) : (
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{c.name}</span>
                    {selectedCustomer?.id === c.id && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/10 transition-colors text-left">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-blue-500/30 text-blue-200 text-[10px] font-semibold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">
                    {userName || "User"}
                  </p>
                  {userEmail && (
                    <p className="text-[10px] text-white/40 truncate">
                      {userEmail}
                    </p>
                  )}
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{userName || "User"}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-destructive focus:text-destructive gap-2"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ─── Main content area ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header with hamburger */}
        <div className="lg:hidden shrink-0 flex items-center gap-2 h-12 px-3 border-b bg-background">
          <button
            onClick={() => setSidebarOpen(true)}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">EngineGPT</span>
          </div>
        </div>

        {selectedId ? (
          /* ─── Chat view ─── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <ChatPanel
              key={selectedId}
              conversationId={selectedId}
              onConversationDeleted={handleConversationDeleted}
              onConversationUpdated={handleConversationUpdated}
              initialMessage={initialMessage}
              initialAttachments={initialAttachments}
            />
          </div>
        ) : (
          /* ─── Home view (centered input) ─── */
          <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="flex-1 flex flex-col items-center justify-center px-4 pb-24">
              {/* Icon */}
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
                What are you working on?
              </h1>
              <p className="text-base text-muted-foreground mb-10 max-w-md text-center">
                Brainstorm ideas, draft content, refine messaging, and more.
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
                        <span className="truncate max-w-[120px]">
                          {att.name}
                        </span>
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
                              <span className="text-primary text-xs">
                                &#10003;
                              </span>
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
          </div>
        )}
      </div>
    </>
  );
}
