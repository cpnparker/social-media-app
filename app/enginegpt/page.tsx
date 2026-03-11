"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
  type KeyboardEvent,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import {
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
  ArrowLeft,
  Link2,
  Upload,
  Sun,
  Moon,
  Monitor,
  Globe,
  ScrollText,
  Newspaper,
  Share2,
  Lightbulb,
  Brain,
  ListChecks,
  EyeOff,
  UserPlus,
  Settings,
  Sparkles,
  Pin,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSubdomainUrl } from "@/lib/subdomain";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AI_MODELS, DEFAULT_MODEL, getModelLabel } from "@/lib/ai/models";
import ChatPanel from "@/components/ai-writer/ChatPanel";
import MemoryManager from "@/components/ai-writer/MemoryManager";
import AdminDialog from "@/components/ai-writer/AdminDialog";
import PersonaliseDialog from "@/components/ai-writer/PersonaliseDialog";
import { signOut } from "next-auth/react";
import { SectionRailDesktop, SectionRailMobile, useRailItems } from "@/components/layout/SectionRail";
import { upload as blobUpload } from "@vercel/blob/client";
import type { AIConversation, Attachment } from "@/lib/types/ai";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export default function EngineGPTPage() {
  return (
    <Suspense>
      <EngineGPTContent />
    </Suspense>
  );
}

function EngineGPTContent() {
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const isAdmin = wsCtx?.selectedWorkspace?.accessAdmin ?? false;
  const customerCtx = useCustomerSafe();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Read initial thread ID from URL (?thread=xxx)
  const urlThreadRef = useRef<string | null>(
    searchParams.get("thread")
  );

  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    urlThreadRef.current
  );
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
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [contextConfig, setContextConfig] = useState({
    contracts: "summary" as string,
    contentPipeline: "summary" as string,
    socialPresence: "summary" as string,
    ideas: "summary" as string,
    webSearch: "on" as string,
    memory: "on" as string,
    meetingBrain: "on" as string,
  });
  const [debugMode, setDebugMode] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [personaliseDialogOpen, setPersonaliseDialogOpen] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [isHomeDragging, setIsHomeDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingThreadRef = useRef<string | null>(null);
  const incognitoConvoRef = useRef<string | null>(null);
  const homeDragCounterRef = useRef(0);

  // Pinning / favourites state
  const [pinnedConvIds, setPinnedConvIds] = useState<Set<string>>(new Set());
  const [pinnedClientIds, setPinnedClientIds] = useState<Set<number>>(new Set());

  // Area access for icon rail (shared component)
  const { visibleCount } = useRailItems();
  const showRail = visibleCount > 1;

  const customerId = customerCtx?.selectedCustomerId || null;
  const customers = customerCtx?.customers || [];
  const selectedCustomer = customerCtx?.selectedCustomer;
  const canViewAll = customerCtx?.canViewAll ?? false;

  // Filter clients by search query
  const filteredClients = (
    clientSearchQuery
      ? customers.filter((c) =>
          c.name.toLowerCase().includes(clientSearchQuery.toLowerCase())
        )
      : customers
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Prevent hydration mismatch for theme icon
  useEffect(() => setMounted(true), []);

  // Reset to General (no customer) every time EngineGPT opens
  // — but NOT when arriving via a thread URL (?thread=xxx) since
  //   that would change customerId → recreate fetchConversations →
  //   re-fire the conversation effect after urlThreadRef is consumed,
  //   clearing the selected thread.
  useEffect(() => {
    if (customerCtx?.setSelectedCustomerId && !urlThreadRef.current) {
      customerCtx.setSelectedCustomerId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch user info for sidebar
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.name) setUserName(d.user.name);
        if (d.user?.email) setUserEmail(d.user.email);
      })
      .catch(() => {});
    // Fetch pin preferences
    fetch("/api/me/preferences")
      .then((r) => r.json())
      .then((d) => {
        if (d.pinnedConversationIds?.length) setPinnedConvIds(new Set(d.pinnedConversationIds));
        if (d.pinnedClientIds?.length) setPinnedClientIds(new Set(d.pinnedClientIds));
      })
      .catch(() => {});
  }, []);

  // Fetch workspace AI settings (default model + context config)
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/ai/settings?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.currentModel) setSelectedModel(data.currentModel);
        if (data.contextConfig) setContextConfig(data.contextConfig);
        if (data.debugMode) setDebugMode(data.debugMode);
      })
      .catch(() => {});
  }, [workspaceId]);

  // Fetch memory count for sidebar badge
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/ai/memories?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => setMemoryCount(data.memories?.length || 0))
      .catch(() => {});
  }, [workspaceId]);

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
    // Don't reset selectedId on initial load if we have a URL thread
    if (urlThreadRef.current) {
      urlThreadRef.current = null; // Consumed — future customer changes reset normally
    } else if (pendingThreadRef.current) {
      // Don't reset — we're switching customer context for a thread selection
      const threadId = pendingThreadRef.current;
      pendingThreadRef.current = null;
      setSelectedId(threadId);
    } else {
      setSelectedId(null);
    }
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    fetchConversations();
  }, [fetchConversations]);

  // Sync selectedId ↔ URL ?thread= param
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) {
      url.searchParams.set("thread", selectedId);
    } else {
      url.searchParams.delete("thread");
    }
    window.history.replaceState({}, "", url.toString());
  }, [selectedId]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [homeInput]);

  // Shared file upload logic — uses client-side Vercel Blob upload
  // to bypass serverless function body size limits
  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is too large. Maximum size is 20MB.`);
        continue;
      }
      try {
        const blob = await blobUpload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/media/upload",
        });

        setPendingAttachments((prev) => [
          ...prev,
          {
            url: blob.url,
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
  }, []);

  // File input handler
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Home input drag & drop handlers
  const handleHomeDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    homeDragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsHomeDragging(true);
    }
  }, []);

  const handleHomeDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    homeDragCounterRef.current--;
    if (homeDragCounterRef.current === 0) {
      setIsHomeDragging(false);
    }
  }, []);

  const handleHomeDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleHomeDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    homeDragCounterRef.current = 0;
    setIsHomeDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  }, [uploadFiles]);

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
          isIncognito: incognitoMode,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to create conversation");
        return;
      }
      const data = await res.json();
      const newConv = data.conversation;
      // Don't add incognito conversations to sidebar
      if (incognitoMode) {
        incognitoConvoRef.current = newConv.id;
      } else {
        setConversations((prev) => [newConv, ...prev]);
      }
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
    cleanupIncognito(selectedId);
    setConversations((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
  };

  // Clean up incognito conversation (fire-and-forget delete)
  const cleanupIncognito = useCallback((convId: string | null) => {
    if (convId && incognitoConvoRef.current === convId) {
      fetch(`/api/ai/conversations/${convId}`, { method: "DELETE" }).catch(() => {});
      incognitoConvoRef.current = null;
    }
  }, []);

  const handleNewChat = () => {
    cleanupIncognito(selectedId);
    setSelectedId(null);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    setSidebarOpen(false);
  };

  const handleBack = () => {
    cleanupIncognito(selectedId);
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
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesTitle = c.title.toLowerCase().includes(q);
      const matchesClient = c.customerName?.toLowerCase().includes(q);
      if (!matchesTitle && !matchesClient) return false;
    }
    return true;
  });

  // How many conversations to show per client group before "more"
  const GROUP_PREVIEW_LIMIT = 5;

  // Group conversations by client (only when not searching)
  const sortedGroups = (() => {
    if (searchQuery) return null; // flat results when searching

    const clientMap = new Map<string, { clientId: number | null; conversations: AIConversation[] }>();
    for (const conv of filtered) {
      const key = conv.customerName || "General";
      if (!clientMap.has(key)) clientMap.set(key, { clientId: conv.customerId, conversations: [] });
      clientMap.get(key)!.conversations.push(conv);
    }

    const groups = Array.from(clientMap.entries())
      .map(([name, data]) => ({ key: name, clientId: data.clientId, clientName: name, conversations: data.conversations, totalCount: data.conversations.length }))
      .sort((a, b) => {
        const aPinned = a.clientId !== null && pinnedClientIds.has(a.clientId);
        const bPinned = b.clientId !== null && pinnedClientIds.has(b.clientId);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        if (a.key === "General") return -1;
        if (b.key === "General") return 1;
        return a.key.localeCompare(b.key);
      });

    // Within each group, pinned conversations first, then by date
    for (const group of groups) {
      group.conversations.sort((a, b) => {
        const aPinned = pinnedConvIds.has(a.id);
        const bPinned = pinnedConvIds.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    // When showing all clients (no filter), limit each group to preview count
    const isUnfiltered = !customerId;
    if (isUnfiltered) {
      for (const group of groups) {
        if (group.conversations.length > GROUP_PREVIEW_LIMIT) {
          group.conversations = group.conversations.slice(0, GROUP_PREVIEW_LIMIT);
        }
      }
    }

    return groups;
  })();

  // Pin/unpin handlers
  const togglePinConversation = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    const next = new Set(pinnedConvIds);
    if (next.has(convId)) next.delete(convId); else next.add(convId);
    setPinnedConvIds(next);
    fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedConversationIds: Array.from(next) }),
    }).catch(() => {});
  };

  const togglePinClient = async (e: React.MouseEvent, clientId: number | null) => {
    e.stopPropagation();
    if (clientId === null) return; // Can't pin "General"
    const next = new Set(pinnedClientIds);
    if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
    setPinnedClientIds(next);
    fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedClientIds: Array.from(next) }),
    }).catch(() => {});
  };

  // Select thread + switch customer dropdown + close mobile sidebar
  const handleSelectThread = (conv: AIConversation) => {
    if (conv.customerId && customerCtx) {
      const custId = String(conv.customerId);
      if (customerCtx.selectedCustomerId !== custId) {
        // Store pending thread so useEffect doesn't reset selectedId
        pendingThreadRef.current = conv.id;
        customerCtx.setSelectedCustomerId(custId);
      }
    }
    setSelectedId(conv.id);
    setInitialMessage(undefined);
    setInitialAttachments(undefined);
    setSidebarOpen(false);
  };

  // Get the currently selected conversation object
  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

  return (
    <>
      {/* ─── Mobile overlay backdrop ─── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar (rail + panel) ─── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] flex",
          "transform transition-transform duration-300 ease-in-out",
          "lg:static lg:z-auto lg:translate-x-0 lg:shrink-0",
          showRail && "lg:w-[308px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ═══════ Icon Rail (desktop only) ═══════ */}
        {showRail && (
          <div className="hidden lg:flex flex-col items-center w-12 bg-[#2e3440] py-3 shrink-0">
            {/* Logo */}
            <a href={getSubdomainUrl("engine", "/dashboard")} className="mb-4">
              <div className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
                <img
                  src="/assets/logo_engine_icon.svg"
                  alt="Home"
                  width={24}
                  height={24}
                  className="h-6 w-6 brightness-0 invert"
                />
              </div>
            </a>

            {/* Area icons */}
            <SectionRailDesktop currentArea="enginegpt" />

            <div className="flex-1" />

            {/* User avatar at bottom of rail */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/10 transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-blue-500/30 text-blue-200 text-[10px] font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-56 ml-1">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{userName || "User"}</p>
                  <p className="text-xs text-muted-foreground">{userEmail || ""}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setPersonaliseDialogOpen(true)}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Personalise
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMemoryManagerOpen(true)}
                  className="gap-2"
                >
                  <Brain className="h-4 w-4" />
                  Memories
                  {memoryCount > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{memoryCount}</span>
                  )}
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => setAdminDialogOpen(true)}
                    className="gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Administration
                  </DropdownMenuItem>
                )}
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
        )}

        {/* ═══════ Sidebar Panel ═══════ */}
        <div className="flex-1 flex flex-col bg-[#3b4252] text-white border-r border-white/[0.06] overflow-hidden">
          {/* ── Mobile area switcher ── */}
          {showRail && (
            <SectionRailMobile currentArea="enginegpt" />
          )}

          {/* Top section */}
          <div className="shrink-0 p-3 space-y-3">
            {/* Logo + New Chat */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  customerCtx?.setSelectedCustomerId(null);
                  handleNewChat();
                }}
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
              >
                {!showRail && (
                  <img
                    src="/assets/logo_engine_icon.svg"
                    alt="EngineGPT"
                    className="h-7 w-7 brightness-0 invert"
                  />
                )}
                <span className="text-[13px] font-bold tracking-tight text-white">
                  EngineGPT
                </span>
              </button>
              <button
                onClick={handleNewChat}
                className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors text-white"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Client selector (searchable popover) */}
            {customers.length > 0 && (
              <Popover
                open={clientPopoverOpen}
                onOpenChange={(open) => {
                  setClientPopoverOpen(open);
                  if (!open) setClientSearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <button className="w-full flex items-center gap-2 rounded-lg bg-white/[0.06] hover:bg-white/10 px-2.5 py-2 transition-colors text-left">
                    <Building2 className="h-3.5 w-3.5 text-white/40 shrink-0" />
                    <span className="flex-1 truncate text-white/80 text-[13px] font-medium">
                      {selectedCustomer?.name || "General"}
                    </span>
                    <ChevronsUpDown className="h-3 w-3 text-white/40 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="bottom" className="w-[256px] p-0">
                  <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      placeholder="Search clients..."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {clientSearchQuery && (
                      <button
                        onClick={() => setClientSearchQuery("")}
                        className="ml-1 h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-[240px] overflow-y-auto p-1">
                    {canViewAll && !clientSearchQuery && (
                      <button
                        onClick={() => {
                          customerCtx?.setSelectedCustomerId(null);
                          setClientPopoverOpen(false);
                          setClientSearchQuery("");
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                          !selectedCustomer && "bg-accent"
                        )}
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1">General</span>
                        {!selectedCustomer && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                    )}
                    {filteredClients.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No clients found
                      </p>
                    ) : (
                      filteredClients.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            customerCtx?.setSelectedCustomerId(c.id);
                            setClientPopoverOpen(false);
                            setClientSearchQuery("");
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                            selectedCustomer?.id === c.id && "bg-accent"
                          )}
                        >
                          {c.logoUrl ? (
                            <img
                              src={c.logoUrl}
                              alt=""
                              className="h-4 w-4 rounded object-cover shrink-0"
                            />
                          ) : (
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 truncate">{c.name}</span>
                          {selectedCustomer?.id === c.id && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Search chats */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
              <input
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] pl-8 pr-3 text-[13px] text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Private / Team tabs */}
            <div className="flex gap-0.5 bg-white/10 rounded-lg p-0.5">
              <button
                onClick={() => setTab("private")}
                className={cn(
                  "flex-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-all",
                  tab === "private"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <Lock className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                Private
              </button>
              <button
                onClick={() => setTab("team")}
                className={cn(
                  "flex-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-all",
                  tab === "team"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <Users className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
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
                <p className="text-[13px] text-white/50">
                  {searchQuery
                    ? "No chats match your search"
                    : "No conversations yet"}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedGroups ? (
                  /* ─── Grouped by client ─── */
                  sortedGroups.map((group) => (
                    <div key={group.key}>
                      {/* Group heading */}
                      <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider truncate">
                          {group.clientName}
                        </p>
                        {group.clientId !== null && (
                          <button
                            onClick={(e) => togglePinClient(e, group.clientId)}
                            className="opacity-0 group-hover:opacity-100 hover:!opacity-100 focus:opacity-100 p-0.5 rounded transition-opacity"
                            title={pinnedClientIds.has(group.clientId!) ? "Unpin group" : "Pin group"}
                          >
                            <Pin
                              className={cn(
                                "h-3 w-3 transition-colors",
                                pinnedClientIds.has(group.clientId!)
                                  ? "text-yellow-400 fill-yellow-400"
                                  : "text-white/30 hover:text-white/60"
                              )}
                            />
                          </button>
                        )}
                      </div>
                      {/* Conversations in this group */}
                      {group.conversations.map((conv) => (
                        <button
                          key={conv.id}
                          onClick={() => handleSelectThread(conv)}
                          className={cn(
                            "w-full text-left rounded-lg px-2.5 py-2 transition-colors group/conv",
                            selectedId === conv.id
                              ? "bg-white/15 text-white"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[13px] font-medium truncate flex-1">{conv.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => togglePinConversation(e, conv.id)}
                                className={cn(
                                  "p-0.5 rounded transition-opacity",
                                  pinnedConvIds.has(conv.id)
                                    ? "opacity-100"
                                    : "opacity-0 group-hover/conv:opacity-100"
                                )}
                                title={pinnedConvIds.has(conv.id) ? "Unpin" : "Pin"}
                              >
                                <Pin
                                  className={cn(
                                    "h-3 w-3 transition-colors",
                                    pinnedConvIds.has(conv.id)
                                      ? "text-yellow-400 fill-yellow-400"
                                      : "text-white/30 hover:text-white/60"
                                  )}
                                />
                              </button>
                              <span className="text-[11px] text-white/40">
                                {timeAgo(conv.updatedAt)}
                              </span>
                            </div>
                          </div>
                          {conv.sharedWithMe && conv.sharedByName && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <UserPlus className="h-3 w-3 text-white/30 shrink-0" />
                              <p className="text-[11px] text-white/40 truncate">
                                Shared by {conv.sharedByName}
                              </p>
                            </div>
                          )}
                        </button>
                      ))}
                      {/* "more" link when group has been truncated */}
                      {!customerId && group.totalCount > GROUP_PREVIEW_LIMIT && (
                        <button
                          onClick={() => {
                            if (group.clientId !== null) {
                              customerCtx?.setSelectedCustomerId(String(group.clientId));
                            } else {
                              // "General" — use special sentinel so API filters to id_client IS NULL
                              customerCtx?.setSelectedCustomerId("general");
                            }
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/60 transition-colors"
                        >
                          {group.totalCount - GROUP_PREVIEW_LIMIT} more...
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  /* ─── Flat list (search results) ─── */
                  filtered.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => handleSelectThread(conv)}
                      className={cn(
                        "w-full text-left rounded-lg px-2.5 py-2 transition-colors group",
                        selectedId === conv.id
                          ? "bg-white/15 text-white"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium truncate flex-1">{conv.title}</p>
                        <span className="text-[11px] text-white/40 shrink-0">
                          {timeAgo(conv.updatedAt)}
                        </span>
                      </div>
                      {conv.sharedWithMe && conv.sharedByName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <UserPlus className="h-3 w-3 text-white/30 shrink-0" />
                          <p className="text-[11px] text-white/40 truncate">
                            Shared by {conv.sharedByName}
                          </p>
                        </div>
                      )}
                      {conv.customerName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3 text-white/30 shrink-0" />
                          <p className="text-[11px] text-white/40 truncate">
                            {conv.customerName}
                          </p>
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bottom section — user profile (hidden on desktop when rail is showing, since rail has its own avatar) */}
          <div className={cn("shrink-0 border-t border-white/[0.08] p-3", showRail && "lg:hidden")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/10 transition-colors text-left">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-blue-500/30 text-blue-200 text-[10px] font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white truncate">
                      {userName || "User"}
                    </p>
                    {userEmail && (
                      <p className="text-[10px] text-white/50 truncate">
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
                  onClick={() => setPersonaliseDialogOpen(true)}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Personalise
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMemoryManagerOpen(true)}
                  className="gap-2"
                >
                  <Brain className="h-4 w-4" />
                  Memories
                  {memoryCount > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{memoryCount}</span>
                  )}
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => setAdminDialogOpen(true)}
                    className="gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Administration
                  </DropdownMenuItem>
                )}
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
        </div>
      </aside>

      {/* ─── Main content area ─── */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header — home screen only (chat view uses ChatPanel header) */}
        {!selectedId && (
          <div className="lg:hidden shrink-0 flex items-center gap-2 h-12 px-3 border-b bg-background">
            <button
              onClick={() => setSidebarOpen(true)}
              className="h-10 w-10 -ml-1 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <img
                src="/assets/logo_engine_icon.svg"
                alt="EngineGPT"
                className="h-5 w-5 dark:brightness-0 dark:invert"
              />
              <span className="text-sm font-bold">EngineGPT</span>
            </div>
            <div className="flex-1" />
            {customers.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border bg-background hover:bg-muted px-2.5 py-1.5 text-[13px] transition-colors text-left shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[120px]">
                      {selectedCustomer?.name || "General"}
                    </span>
                    <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" className="w-[260px] p-0">
                  <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      placeholder="Search clients..."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className="flex h-10 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {clientSearchQuery && (
                      <button
                        onClick={() => setClientSearchQuery("")}
                        className="ml-1 h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-[280px] overflow-y-auto p-1">
                    {canViewAll && !clientSearchQuery && (
                      <button
                        onClick={() => {
                          customerCtx?.setSelectedCustomerId(null);
                          setClientSearchQuery("");
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors text-left",
                          !selectedCustomer && "bg-accent"
                        )}
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1">General</span>
                        {!selectedCustomer && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    )}
                    {filteredClients.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No clients found</p>
                    ) : (
                      filteredClients.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            customerCtx?.setSelectedCustomerId(c.id);
                            setClientSearchQuery("");
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors text-left",
                            selectedCustomer?.id === c.id && "bg-accent"
                          )}
                        >
                          {c.logoUrl ? (
                            <img src={c.logoUrl} alt="" className="h-4 w-4 rounded object-cover shrink-0" />
                          ) : (
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 truncate">{c.name}</span>
                          {selectedCustomer?.id === c.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}

        {/* Desktop top bar — client picker + theme toggle */}
        <div className="hidden lg:flex items-center gap-3 px-4 pt-2.5 pb-1 shrink-0">
          <div className="flex-1" />
          {customers.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg border bg-background hover:bg-muted px-3 py-1.5 text-[13px] transition-colors text-left">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate max-w-[180px]">
                    {selectedCustomer?.name || "General"}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-[280px] p-0">
                <div className="flex items-center border-b px-3">
                  <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    placeholder="Search clients..."
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    className="flex h-10 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {clientSearchQuery && (
                    <button
                      onClick={() => setClientSearchQuery("")}
                      className="ml-1 h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="max-h-[280px] overflow-y-auto p-1">
                  {canViewAll && !clientSearchQuery && (
                    <button
                      onClick={() => {
                        customerCtx?.setSelectedCustomerId(null);
                        setClientSearchQuery("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors text-left",
                        !selectedCustomer && "bg-accent"
                      )}
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1">General</span>
                      {!selectedCustomer && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  )}
                  {filteredClients.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No clients found
                    </p>
                  ) : (
                    filteredClients.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          customerCtx?.setSelectedCustomerId(c.id);
                          setClientSearchQuery("");
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors text-left",
                          selectedCustomer?.id === c.id && "bg-accent"
                        )}
                      >
                        {c.logoUrl ? (
                          <img
                            src={c.logoUrl}
                            alt=""
                            className="h-4 w-4 rounded object-cover shrink-0"
                          />
                        ) : (
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="flex-1 truncate">{c.name}</span>
                        {selectedCustomer?.id === c.id && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full border bg-background hover:bg-muted flex items-center justify-center transition-colors">
                {mounted ? (
                  resolvedTheme === "dark" ? (
                    <Moon className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Sun className="h-3.5 w-3.5 text-muted-foreground" />
                  )
                ) : (
                  <div className="h-3.5 w-3.5" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2 text-sm">
                <Sun className="h-4 w-4" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2 text-sm">
                <Moon className="h-4 w-4" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2 text-sm">
                <Monitor className="h-4 w-4" />
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {selectedId ? (
          /* ─── Chat view ─── */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ChatPanel
              key={selectedId}
              conversationId={selectedId}
              onConversationDeleted={handleConversationDeleted}
              onConversationUpdated={handleConversationUpdated}
              onBack={handleBack}
              onMenuClick={() => setSidebarOpen(true)}
              initialMessage={initialMessage}
              initialAttachments={initialAttachments}
              contextConfig={{ ...contextConfig, incognito: incognitoMode ? "on" : "off" }}
              debugMode={debugMode}
              customers={customers.map((c) => ({ id: String(c.id), name: c.name, logoUrl: c.logoUrl || undefined }))}
              selectedCustomer={selectedCustomer ? { id: String(selectedCustomer.id), name: selectedCustomer.name } : null}
              onCustomerChange={(id) => customerCtx?.setSelectedCustomerId(id)}
              onCopyLink={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("thread", selectedId!);
                navigator.clipboard.writeText(url.toString());
                toast.success("Thread link copied to clipboard");
              }}
              isAdmin={isAdmin}
            />
          </div>
        ) : (
          /* ─── Home view (centered input) ─── */
          <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="flex-1 flex flex-col items-center justify-center px-4 pb-24">
              {/* Icon */}
              <div className="h-16 w-16 rounded-2xl bg-[#023250]/10 dark:bg-white/10 flex items-center justify-center mb-6">
                <img
                  src="/assets/logo_engine_icon.svg"
                  alt="EngineGPT"
                  className="h-10 w-10 dark:brightness-0 dark:invert"
                />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
                What are you working on?
              </h1>
              <p className="text-base text-muted-foreground mb-10 max-w-md text-center">
                Brainstorm ideas, draft content, refine messaging, and more.
              </p>

              {/* Input area */}
              <div
                className="w-full max-w-2xl"
                onDragEnter={handleHomeDragEnter}
                onDragLeave={handleHomeDragLeave}
                onDragOver={handleHomeDragOver}
                onDrop={handleHomeDrop}
              >
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

                <div className="relative rounded-2xl border bg-background shadow-md focus-within:ring-1 focus-within:ring-foreground/15 focus-within:border-foreground/20 transition-all">
                  {/* Drag overlay */}
                  {isHomeDragging && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-foreground/[0.03] border-2 border-dashed border-foreground/20 rounded-2xl">
                      <div className="flex flex-col items-center gap-2 text-foreground/50">
                        <Upload className="h-8 w-8" />
                        <span className="text-sm font-medium">Drop files here</span>
                      </div>
                    </div>
                  )}

                  <textarea
                    ref={textareaRef}
                    value={homeInput}
                    onChange={(e) => setHomeInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything..."
                    disabled={sending}
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 py-3 sm:px-5 sm:py-4 text-base focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
                    style={{ minHeight: "48px", maxHeight: "160px" }}
                  />

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.txt,.csv,.md"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {/* Bottom button bar */}
                  <div className="flex px-3 pb-3 items-center gap-1 sm:gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                      className="h-9 w-9 sm:h-8 sm:w-8 p-0 text-muted-foreground hover:text-foreground"
                      title="Attach file"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 sm:h-3.5 sm:w-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      )}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-9 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs px-2 sm:px-2.5",
                            incognitoMode
                              ? "text-amber-500 hover:text-amber-400"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {incognitoMode ? (
                            <EyeOff className="h-3 w-3" />
                          ) : tab === "private" ? (
                            <Lock className="h-3 w-3" />
                          ) : (
                            <Users className="h-3 w-3" />
                          )}
                          {incognitoMode ? "Incognito" : tab === "private" ? "Private" : "Team"}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        <DropdownMenuItem
                          onClick={() => { setTab("private"); setIncognitoMode(false); }}
                          className={cn("gap-2 text-sm", !incognitoMode && tab === "private" && "bg-muted font-medium")}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Private
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { setTab("team"); setIncognitoMode(false); }}
                          className={cn("gap-2 text-sm", !incognitoMode && tab === "team" && "bg-muted font-medium")}
                        >
                          <Users className="h-3.5 w-3.5" />
                          Team
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setIncognitoMode(true);
                            setTab("private");
                            toast.info("Incognito — chat won't be saved and memories are disabled");
                          }}
                          className={cn("gap-2 text-sm", incognitoMode && "bg-muted font-medium text-amber-500")}
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Incognito
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="flex-1" />

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-muted-foreground hover:text-foreground px-2 sm:px-2.5"
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

                    <Button
                      size="icon"
                      onClick={handleQuickSend}
                      disabled={
                        sending ||
                        uploading ||
                        (!homeInput.trim() && pendingAttachments.length === 0)
                      }
                      className="h-9 w-9 shrink-0 rounded-xl bg-foreground text-background hover:bg-foreground/80"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                </div>

                <p className="text-[11px] text-muted-foreground text-center mt-2.5 hidden sm:block">
                  Press Enter to send, Shift+Enter for new line
                </p>

                {/* Context & web search controls */}
                <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
                  {[
                    { key: "contracts" as const, label: "Contracts", Icon: ScrollText, color: "text-amber-400" },
                    { key: "contentPipeline" as const, label: "Content", Icon: Newspaper, color: "text-blue-400" },
                    { key: "socialPresence" as const, label: "Social", Icon: Share2, color: "text-violet-400" },
                    { key: "ideas" as const, label: "Ideas", Icon: Lightbulb, color: "text-yellow-400" },
                  ].map((item) => {
                    const level = contextConfig[item.key];
                    const isOn = level !== "off";
                    const isFull = level.startsWith("full");
                    // Cycle: off → summary → full-month → off
                    const nextLevel = level === "off" ? "summary" : level === "summary" ? "full-month" : "off";
                    const fullLabel = level === "full-week" ? "7d" : level === "full-month" ? "30d" : level === "full-year" ? "1y" : "";
                    return (
                      <button
                        key={item.key}
                        onClick={() =>
                          setContextConfig((prev) => ({
                            ...prev,
                            [item.key]: nextLevel,
                          }))
                        }
                        title={`${item.label}: ${level === "off" ? "Off" : level === "summary" ? "Summary" : `Full Detail (${fullLabel})`} — click to cycle`}
                        className={cn(
                          "flex items-center gap-1.5 sm:gap-1 px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg sm:rounded-md text-[11px] sm:text-[10px] transition-all",
                          isOn
                            ? "text-foreground/80 hover:text-foreground"
                            : "text-muted-foreground/40 hover:text-muted-foreground/60"
                        )}
                      >
                        <item.Icon className={cn(
                          "h-3 w-3 sm:h-2.5 sm:w-2.5 transition-colors",
                          isOn
                            ? item.color
                            : "text-muted-foreground/30"
                        )} />
                        {item.label}
                        {isFull && (
                          <span className="text-[9px] text-muted-foreground/50">{fullLabel}</span>
                        )}
                      </button>
                    );
                  })}
                  <div className="w-px h-4 sm:h-3 bg-border mx-0.5" />
                  <button
                    onClick={() => {
                      const turningOn = contextConfig.webSearch !== "on";
                      setContextConfig((prev) => ({
                        ...prev,
                        webSearch: turningOn ? "on" : "off",
                      }));
                      // Web search works with Claude and Grok — switch if using an unsupported model
                      const webModels = ["claude-sonnet-4-6", "grok-4-1-fast", "grok-3-mini"];
                      if (turningOn && !webModels.includes(selectedModel)) {
                        setSelectedModel("grok-4-1-fast");
                        toast.info("Switched to Grok 4 Fast — web search requires Grok or Claude");
                      }
                    }}
                    title={`Web Search: ${contextConfig.webSearch === "on" ? "On — AI can search the web" : "Off"} — click to toggle`}
                    className={cn(
                      "flex items-center gap-1.5 sm:gap-1 px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg sm:rounded-md text-[11px] sm:text-[10px] transition-all",
                      contextConfig.webSearch === "on"
                        ? "text-foreground/80 hover:text-foreground"
                        : "text-muted-foreground/40 hover:text-muted-foreground/60"
                    )}
                  >
                    <Globe className={cn(
                      "h-3 w-3 sm:h-2.5 sm:w-2.5 transition-colors",
                      contextConfig.webSearch === "on" ? "text-emerald-400" : "text-muted-foreground/30"
                    )} />
                    Web
                  </button>
                  <button
                    onClick={() =>
                      setContextConfig((prev) => ({
                        ...prev,
                        memory: prev.memory === "on" ? "off" : "on",
                      }))
                    }
                    title={`Memory: ${contextConfig.memory === "on" ? "On — AI remembers context" : "Off"} — click to toggle`}
                    className={cn(
                      "flex items-center gap-1.5 sm:gap-1 px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg sm:rounded-md text-[11px] sm:text-[10px] transition-all",
                      contextConfig.memory === "on"
                        ? "text-foreground/80 hover:text-foreground"
                        : "text-muted-foreground/40 hover:text-muted-foreground/60"
                    )}
                  >
                    <Brain className={cn(
                      "h-3 w-3 sm:h-2.5 sm:w-2.5 transition-colors",
                      contextConfig.memory === "on" ? "text-pink-400" : "text-muted-foreground/30"
                    )} />
                    Memory
                  </button>
                  {tab !== "team" && (
                    <button
                      onClick={() =>
                        setContextConfig((prev) => ({
                          ...prev,
                          meetingBrain: prev.meetingBrain === "on" ? "off" : "on",
                        }))
                      }
                      title={`MeetingBrain: ${contextConfig.meetingBrain === "on" ? "On — includes your tasks & meetings" : "Off"} — click to toggle`}
                      className={cn(
                        "flex items-center gap-1.5 sm:gap-1 px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg sm:rounded-md text-[11px] sm:text-[10px] transition-all",
                        contextConfig.meetingBrain === "on"
                          ? "text-foreground/80 hover:text-foreground"
                          : "text-muted-foreground/40 hover:text-muted-foreground/60"
                      )}
                    >
                      <ListChecks className={cn(
                        "h-3 w-3 sm:h-2.5 sm:w-2.5 transition-colors",
                        contextConfig.meetingBrain === "on" ? "text-teal-400" : "text-muted-foreground/30"
                      )} />
                      MeetingBrain
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Memory Manager Sheet */}
      {workspaceId && (
        <MemoryManager
          workspaceId={workspaceId}
          open={memoryManagerOpen}
          onClose={() => {
            setMemoryManagerOpen(false);
            // Refresh count
            fetch(`/api/ai/memories?workspaceId=${workspaceId}`)
              .then((r) => r.json())
              .then((data) => setMemoryCount(data.memories?.length || 0))
              .catch(() => {});
          }}
        />
      )}
      {/* Personalise Dialog */}
      {workspaceId && (
        <PersonaliseDialog
          workspaceId={workspaceId}
          open={personaliseDialogOpen}
          onClose={() => setPersonaliseDialogOpen(false)}
        />
      )}
      {/* Administration Dialog */}
      {workspaceId && (
        <AdminDialog
          workspaceId={workspaceId}
          open={adminDialogOpen}
          onClose={() => setAdminDialogOpen(false)}
        />
      )}
    </>
  );
}
