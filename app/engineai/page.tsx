"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
  type KeyboardEvent,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import EngineAISidebar from "@/components/engineai/EngineAISidebar";
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
  PenLine,
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
  ImageIcon,
  ShieldCheck,
  BookOpen,
  Trash2,
  Pencil,
  AudioLines,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AI_MODELS, DEFAULT_MODEL, getModelLabel } from "@/lib/ai/models";
import ChatPanel from "@/components/ai-writer/ChatPanel";
import VoiceDock from "@/components/ai-writer/VoiceDock";
import WakeMode, { type WakeModeHandle } from "@/components/ai-writer/WakeMode";
import MemoryManager from "@/components/ai-writer/MemoryManager";
import ScheduledPromptsDialog from "@/components/ai-writer/ScheduledPromptsDialog";
import { Clock, Download } from "lucide-react";
import AdminDialog from "@/components/ai-writer/AdminDialog";
import PersonaliseDialog from "@/components/ai-writer/PersonaliseDialog";
import ClientContextDialog from "@/components/ai-writer/ClientContextDialog";
import { useInstallPrompt } from "@/lib/use-install-prompt";
import NotebookPanel from "@/components/notebook/NotebookPanel";
import { signOut } from "next-auth/react";
import { SectionRailDesktop, SectionRailMobile, useRailItems } from "@/components/layout/SectionRail";
import type { AIConversation, Attachment } from "@/lib/types/ai";
import { useFileUploads, UploadChips, MAX_FILE_SIZE } from "@/components/ai-writer/use-file-uploads";


interface OptimizerArticle {
  id: string;
  title: string;
  status: string;
  visibility: string;
  source: string;
  clientId: number | null;
  updatedAt: string;
}

export default function EngineAIPage() {
  return (
    <Suspense>
      <EngineAIContent />
    </Suspense>
  );
}

function EngineAIContent() {
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
  /**
   * WHICH LIST YOU ARE LOOKING AT. A filter, nothing more.
   *
   * This used to be the same value that decided the VISIBILITY of every new
   * conversation, so clicking "Team" to browse team threads silently made the
   * next thing you typed readable by the whole workspace. That is how a
   * directors' catchup became a team artefact. Reading and publishing are not
   * the same decision and no longer share a variable.
   */
  const [tab, setTab] = useState<"private" | "team">("private");
  /**
   * WHO WILL BE ABLE TO READ THE NEXT CONVERSATION YOU START.
   *
   * Private by default, always, and only ever changed from the composer's own
   * visibility control — never as a side effect of navigating. Incognito forces
   * it private.
   */
  const [newVisibility, setNewVisibility] = useState<"private" | "team">("private");
  const [homeInput, setHomeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>();
  const [initialAttachments, setInitialAttachments] = useState<
    Attachment[] | undefined
  >();
  const [searchQuery, setSearchQuery] = useState("");
  const [deepSearchResults, setDeepSearchResults] = useState<AIConversation[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceTranscriptN, setVoiceTranscriptN] = useState(0);
  const [voiceWakeSession, setVoiceWakeSession] = useState(false);
  const [voiceWakeCommand, setVoiceWakeCommand] = useState<string | undefined>();
  const voiceWakeAudioRef = useRef<(() => Promise<Float32Array | null>) | undefined>(undefined);
  // Mobile puts Live + Orac in the header (their floating pills overlapped the
  // composer's send button). WakeMode stays mounted either way — the wake
  // engine lives inside it — so the header drives it through this handle.
  const wakeRef = useRef<WakeModeHandle>(null);
  const [wakeUi, setWakeUi] = useState({ armed: false, listening: false, loading: false });
  const [seedText, setSeedText] = useState<{ text: string; nonce: number } | null>(null);

  /**
   * Handoff from the Writing Studio's "Ask" button.
   *
   * Read ONCE and cleared, so a refresh does not re-seed a question the writer
   * has already asked or already dismissed. sessionStorage rather than a query
   * parameter because the payload is a draft excerpt: in a URL it would be a
   * two-thousand-character address sitting in browser history and in any log
   * that records paths.
   *
   * Only seeds when the thread it names is the one now open — a stale handoff
   * from a piece the writer navigated away from must not appear in an
   * unrelated conversation.
   */
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("engineai:ask"); } catch { return; }
    if (!raw) return;
    try { sessionStorage.removeItem("engineai:ask"); } catch { /* cleared either way */ }
    try {
      const h = JSON.parse(raw) as { conversationId?: string; text?: string };
      if (!h?.text || !h.conversationId) return;
      if (selectedId && h.conversationId !== selectedId) return;
      setSeedText({ text: h.text, nonce: Date.now() });
      toast.info("Added to the message box — finish your question");
    } catch { /* a malformed handoff is not worth an error to the writer */ }
  }, [selectedId]);
  const { canInstall, promptInstall } = useInstallPrompt();
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Still here for the DESKTOP TOP-BAR client selector, which is a separate
  // control from the sidebar's. The sidebar keeps its own copy of this state
  // internally; these two pickers were never wired together.
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [contextConfig, setContextConfig] = useState({
    contracts: "summary" as string,
    contentPipeline: "summary" as string,
    socialPresence: "summary" as string,
    ideas: "summary" as string,
    webSearch: "on" as string,
    memory: "on" as string,
    meetingBrain: "on" as string,
    imageGeneration: "on" as string,
  });
  const [debugMode, setDebugMode] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  // "Make recurring" on an answer opens the hub with the form pre-filled.
  const [scheduledPrefill, setScheduledPrefill] = useState<{ title?: string; prompt?: string } | null>(null);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [personaliseDialogOpen, setPersonaliseDialogOpen] = useState(false);
  const [personaliseTab, setPersonaliseTab] = useState<"context" | "company" | "roles" | "connections">("context");
  const [clientContextOpen, setClientContextOpen] = useState(false);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [memoryCount, setMemoryCount] = useState(0);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
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

  const filteredClients = (
    clientSearchQuery
      ? customers.filter((c) => c.name.toLowerCase().includes(clientSearchQuery.toLowerCase()))
      : customers
  ).sort((a, b) => a.name.localeCompare(b.name));



  // Prevent hydration mismatch for theme icon
  useEffect(() => setMounted(true), []);

  // When opening a thread from URL params (e.g. shared link or refresh),
  // ensure the client context matches the thread's client.
  // Wait for CustomerProvider to finish loading before setting — otherwise
  // fetchCustomers will override our selection with the URL param value.
  const customerLoading = customerCtx?.loading ?? true;
  const threadClientSyncedRef = useRef(false);

  /**
   * Arriving from MeetingBrain AFTER a meeting (`/engineai?mb=<id>`).
   *
   * MeetingBrain's ⚡ link before/during a meeting opens Live. Once the meeting
   * has ended there is nothing to listen to, but this is the moment the
   * transcript, summary and extracted tasks finally exist — so that link comes
   * here instead and seeds a grounded question. Nothing is copied across: only
   * the meeting id crosses the URL, and the model re-fetches with
   * query_meetingbrain under the reader's OWN authority, which is what keeps a
   * meeting someone didn't attend out of reach.
   */
  const mbSeededRef = useRef(false);
  useEffect(() => {
    const mbId = searchParams.get("mb");
    // Wait for the session/workspace to resolve. The auth gate here is
    // client-side, so this effect can otherwise fire before sign-in completes,
    // the mb-context fetch 401s, and the seed loses the meeting title.
    if (!mbId || !workspaceId || mbSeededRef.current) return;
    mbSeededRef.current = true;
    (async () => {
      let title = "";
      try {
        const res = await fetch(`/api/ai/meeting/mb-context?meetingId=${encodeURIComponent(mbId)}`);
        if (res.ok) title = (await res.json())?.meeting?.title || "";
      } catch { /* the question still works without the title */ }
      const seed = title
        ? `Brief me on the meeting "${title}" — pull it up with query_meetingbrain (report: meeting_details, meeting_id: ${mbId}). What was decided, what did we commit to, and what's still open?`
        : `Brief me on the MeetingBrain meeting with id ${mbId} — use query_meetingbrain (report: meeting_details). What was decided, what did we commit to, and what's still open?`;
      // FORCE the audience this was fetched under. mb-context reads the
      // meeting with visibility "private"; if the Team tab happens to be
      // active, handleQuickSend would create a TEAM conversation and the seed
      // — which instructs the model to call meeting_details — would pull the
      // full client transcript into a workspace-readable thread. handleVoiceStart
      // hardcodes "private" for exactly this reason; this path must match.
      setNewVisibility("private");
      setTab("private");
      setIncognitoMode(false);
      setHomeInput((prev) => (prev.trim() ? prev : seed));
      toast.info(title ? `Loaded "${title}" — press send for the briefing` : "Meeting loaded — press send for the briefing");
      // Drop ?mb= so a refresh doesn't re-seed over what the user has typed.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("mb");
        window.history.replaceState({}, "", url.toString());
      } catch { /* noop */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    const threadId = searchParams.get("thread");
    if (!threadId || customerLoading || threadClientSyncedRef.current) return;
    threadClientSyncedRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/ai/conversations/${threadId}`);
        if (!res.ok) return;
        const data = await res.json();
        const conv = data.conversation;
        if (!conv) return;

        const threadClientId = (conv.customerId || conv.id_client) ? String(conv.customerId || conv.id_client) : null;
        const currentClientId = customerCtx?.selectedCustomerId || null;
        if (threadClientId !== currentClientId) {
          pendingThreadRef.current = threadId;
          customerCtx?.setSelectedCustomerId(threadClientId);
        }
      } catch {
        // Ignore — thread will load with current context
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerLoading]);

  // Track the visual viewport height so the home view resizes when the
  // mobile keyboard opens/closes. Without this, flex-1 centres against the
  // full viewport height and the logo gets pushed to the very top.
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setViewportHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  // Focus the home textarea on mount and when returning from a chat.
  // autoFocus attribute handles the initial SSR render; this useEffect
  // covers client-side navigations (back from chat → home).
  // Double-attempt: immediate + delayed, because some mobile browsers
  // need the DOM fully settled before focus will trigger the keyboard.
  useEffect(() => {
    if (!selectedId && textareaRef.current) {
      textareaRef.current.focus();
      const timer = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [selectedId]);

  // Client selection is driven by URL ?client= parameter.
  // If arriving via a thread URL, the thread-client effect (above)
  // will switch to the correct client for that thread and update the URL.

  // Dynamic page title — show conversation title like ChatGPT does
  useEffect(() => {
    if (selectedId) {
      const conv = conversations.find((c) => c.id === selectedId);
      if (conv?.title) {
        document.title = `${conv.title} — EngineAI`;
      } else {
        document.title = "EngineAI — AI Content Assistant";
      }
    } else {
      document.title = "EngineAI — AI Content Assistant";
    }
  }, [selectedId, conversations]);

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
        if (data.currentModel) {
          setSelectedModel(data.currentModel);
          if (data.contextConfig) {
            setContextConfig(data.contextConfig);
          }
        } else if (data.contextConfig) {
          setContextConfig(data.contextConfig);
        }
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
      // Exclude design-mode sessions — they live in /engineai/design.
      let url = `/api/ai/conversations?workspaceId=${workspaceId}&mode=general`;
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

  // Track whether this is the initial page load vs a user-initiated customer change.
  // Stays true until CustomerContext has loaded AND the first fetch completes,
  // so that async customer resolution (from URL param) doesn't reset selectedId.
  const initialLoadRef = useRef(true);
  const customerLoaded = !(customerCtx?.loading ?? true);

  useEffect(() => {
    if (urlThreadRef.current) {
      setSelectedId(urlThreadRef.current);
      urlThreadRef.current = null;
    } else if (pendingThreadRef.current) {
      const threadId = pendingThreadRef.current;
      pendingThreadRef.current = null;
      setSelectedId(threadId);
    } else if (initialLoadRef.current) {
      // Still in initial load phase — keep selectedId
    } else {
      setSelectedId(null);
      setInitialMessage(undefined);
      setInitialAttachments(undefined);
    }
    if (customerLoaded) {
      initialLoadRef.current = false;
    }
    fetchConversations();
  }, [fetchConversations, customerLoaded]);

  // Sync selectedId ↔ URL ?thread= and client ↔ URL ?client=
  // Sync state → URL. Only delete a param if we previously wrote it
  // (prevents race conditions from stripping URL params on load).
  const prevThreadRef = useRef<string | null | undefined>(undefined);
  const prevClientRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    // Thread
    if (selectedId !== prevThreadRef.current) {
      if (selectedId) {
        url.searchParams.set("thread", selectedId);
      } else if (prevThreadRef.current !== undefined) {
        url.searchParams.delete("thread");
      }
      prevThreadRef.current = selectedId;
      changed = true;
    }

    // Client — only delete if we previously set a non-null value
    if (customerId !== prevClientRef.current) {
      if (customerId) {
        url.searchParams.set("client", customerId);
      } else if (prevClientRef.current && prevClientRef.current !== undefined) {
        url.searchParams.delete("client");
      }
      prevClientRef.current = customerId;
      changed = true;
    }

    if (changed) {
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedId, customerId]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [homeInput]);

  // Upload state and logic live in one place — see use-file-uploads.tsx. This
  // page previously carried its own byte-for-byte copy, so an improvement made
  // to the other composer never reached the screen where a new chat with an
  // attachment actually starts.
  const { uploads, uploading, uploadFiles, dismiss: dismissUpload } = useFileUploads(
    useCallback((att: Attachment) => setPendingAttachments((prev) => [...prev, att]), [])
  );

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
          // newVisibility, not tab: the list you were browsing must not decide
          // who can read what you are about to write.
          visibility: incognitoMode ? "private" : newVisibility,
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

  // Start an immersive voice session. From a chat: binds to that thread.
  // From home: creates a fresh PRIVATE conversation first (voice is personal-
  // scope — personal MeetingBrain/Slack tools are blocked in team threads).
  // fromWake: session opened by the "Hey Engine" wake phrase — greets
  // immediately and auto-ends after prolonged silence.
  const handleVoiceStart = async (
    fromWake = false,
    wakeCommand?: string,
    wakeAudio?: () => Promise<Float32Array | null>
  ) => {
    if (!workspaceId || sending) return;
    setVoiceWakeSession(fromWake);
    setVoiceWakeCommand(fromWake ? wakeCommand : undefined);
    voiceWakeAudioRef.current = fromWake ? wakeAudio : undefined;
    if (selectedId) {
      setVoiceOpen(true);
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          visibility: "private",
          model: selectedModel,
          customerId: customerId || undefined,
          // isIncognito, exactly as the text composer sends it.
          //
          // It was missing here, and the two buttons sit in the SAME composer
          // row: a user with Incognito visibly selected pressed the mic and got
          // a persisted, sidebar-visible, verbatim-transcribed thread. The UI
          // promised one thing and the server did another, which is worse than
          // not offering the toggle.
          isIncognito: incognitoMode,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to start voice session");
        return;
      }
      const data = await res.json();
      setConversations((prev) => [data.conversation, ...prev]);
      setSelectedId(data.conversation.id);
      setVoiceOpen(true);
    } catch {
      toast.error("Failed to start voice session");
    } finally {
      setSending(false);
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

  // Deep search — backend searches titles, summaries AND message content
  // (debounced; only for queries of 3+ chars)
  useEffect(() => {
    if (!workspaceId || searchQuery.trim().length < 3) {
      setDeepSearchResults([]);
      return;
    }
    const q = searchQuery.trim();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/ai/conversations?workspaceId=${workspaceId}&search=${encodeURIComponent(q)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setDeepSearchResults(data.conversations || []);
      } catch {
        // Deep search is best-effort; title filtering still works
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, workspaceId]);


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
      const matchesContent = deepSearchResults.some((d) => d.id === c.id);
      if (!matchesTitle && !matchesClient && !matchesContent) return false;
    }
    return true;
  });

  // Deep-search results for conversations not in the local list (e.g. other clients)
  const deepExtra = searchQuery
    ? deepSearchResults.filter(
        (c) =>
          (tab === "private" ? c.visibility === "private" : tab === "team" ? c.visibility === "team" : true) &&
          !filtered.some((f) => f.id === c.id) &&
          !conversations.some((lc) => lc.id === c.id)
      )
    : [];
  const displayed = searchQuery ? [...filtered, ...deepExtra] : filtered;


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

  // Delete conversation
  const handleDeleteConversation = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await fetch(`/api/ai/conversations/${convId}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (selectedId === convId) {
        setSelectedId(null);
        router.replace("/engineai");
      }
      toast.success("Conversation deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  // Rename conversation (double-click to start, Enter/blur to save)
  const startRenaming = (e: React.MouseEvent, conv: AIConversation) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingConvId(conv.id);
    setEditingTitle(conv.title || "");
  };

  const saveRename = async (convId: string) => {
    const trimmed = editingTitle.trim();
    if (!trimmed || trimmed === conversations.find((c) => c.id === convId)?.title) {
      setEditingConvId(null);
      return;
    }
    try {
      await fetch(`/api/ai/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title: trimmed } : c))
      );
    } catch {
      toast.error("Failed to rename");
    }
    setEditingConvId(null);
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

  /**
   * Jump from a notebook entry to the message it was captured from.
   * The thread may need to load first, so poll briefly for the anchor rather
   * than assuming it is already mounted; give up quietly if the message has
   * since been deleted (id_message deliberately has no foreign key).
   */
  const jumpToSource = useCallback((conversationId: string, messageId: string | null) => {
    if (conversationId !== selectedId) setSelectedId(conversationId);
    if (!messageId) return;
    let tries = 0;
    const find = () => {
      const el = document.getElementById(`msg-${messageId}`);
      if (!el) {
        if (tries++ < 40) setTimeout(find, 100); // ~4s, covers a thread fetch
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ai-flash");
      setTimeout(() => el.classList.remove("ai-flash"), 1800);
    };
    setTimeout(find, 60);
  }, [selectedId]);

  // Get the currently selected conversation object
  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

/**
 * Orac — the hands-free wake phrase — is OFF while it is reworked.
 *
 * One flag rather than deleted code: the wake engine, the enrolment flow and
 * the templates all still work and all still have their hard-won fixes in them
 * (Chrome's AEC destroying wake audio, background-tab burst handling, the
 * double-append that made server VAD open two turns at once). Deleting that and
 * writing it again later would pay for those a second time.
 *
 * Off means NOT MOUNTED, not merely hidden: WakeMode holds the microphone open
 * to listen for the phrase, so a hidden-but-mounted component would keep the
 * mic live with no way to turn it off — the worst of both.
 *
 * Voice itself is unaffected. The composer's voice button opens VoiceDock
 * directly and is the supported way in.
 */
const ORAC_ENABLED = false;


  /**
   * Mobile-only header controls — now empty, and that is the point.
   *
   * This held two buttons and neither survives. The meeting copilot is launched
   * from MeetingBrain, whose MeetingDetailModal opens
   * ai.thecontentengine.com/meeting?mb=<id> directly: that is where a meeting
   * actually starts, and it is the only launcher carrying the meeting id. A
   * second door here bought nothing and cost the word "Live" — Radio meant
   * "meeting", AudioLines in the composer meant "voice", and AudioLines in this
   * header meant the wake word. Three controls, two identical icons, and the
   * only one labelled Live was the one that was not voice.
   *
   * The wake-word button went with ORAC_ENABLED. Voice is reachable from the
   * composer on every breakpoint, so nothing is lost on a phone.
   *
   * Kept as a named slot rather than deleted: both headers render it, and this
   * is where the next header control will go.
   */
  const mobileTools = null;

  return (
    <>
      {/* ─── Mobile overlay backdrop ─── */}
      {/* The sidebar moved to components/engineai/EngineAISidebar.tsx so every
          surface under /engineai has it. The Content Optimiser rendered with no
          navigation and no header at all before this, against a design whose own
          annotation read "Header — the chrome that was missing".

          Three blocks stay HERE as slots — the conversation list, the profile
          dropdown and the rail avatar. They are the most intricate JSX in this
          file (client grouping, pinning, inline rename, delete, deep-search
          results) and the optimiser needs none of them, so moving them would
          risk the daily-driver surface for no gain. Articles moved, because it
          is genuinely identical on both surfaces and duplicating it is how two
          sidebars begin to drift apart. */}
      <EngineAISidebar
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        onNewChat={() => { customerCtx?.setSelectedCustomerId(null); handleNewChat(); }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        tab={tab}
        onTabChange={setTab}
        conversationsLoading={loading}
        conversationCount={displayed.length}
        railFooter={
          <>
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
                  onClick={() => { setPersonaliseTab("context"); setPersonaliseDialogOpen(true); }}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Personalise
                </DropdownMenuItem>
                {/* First-class entry, and NOT admin-gated. These are the user's
                    own accounts; burying them as a tab inside Personalise meant
                    people looked under Administration → Integrations instead,
                    which most of them cannot even open. */}
                <DropdownMenuItem
                  onClick={() => { setPersonaliseTab("connections"); setPersonaliseDialogOpen(true); }}
                  className="gap-2"
                >
                  <Link2 className="h-4 w-4" />
                  Connections
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
                <DropdownMenuItem
                  onClick={() => setScheduledOpen(true)}
                  className="gap-2"
                >
                  <Clock className="h-4 w-4" />
                  Scheduled prompts
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
                  onClick={() => setClientContextOpen(true)}
                  className="gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Client Context
                </DropdownMenuItem>
                {/* Only rendered once Chrome/Edge has fired beforeinstallprompt,
                    so the item never appears where it couldn't work (already
                    installed, or a browser without the API). */}
                {canInstall && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        const outcome = await promptInstall();
                        if (outcome === "accepted") toast.success("EngineAI installed — look for it on your home screen");
                      }}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Install app
                    </DropdownMenuItem>
                  </>
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
          </>
        }
        footer={
          <>
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
                  onClick={() => { setPersonaliseTab("context"); setPersonaliseDialogOpen(true); }}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Personalise
                </DropdownMenuItem>
                {/* First-class entry, and NOT admin-gated. These are the user's
                    own accounts; burying them as a tab inside Personalise meant
                    people looked under Administration → Integrations instead,
                    which most of them cannot even open. */}
                <DropdownMenuItem
                  onClick={() => { setPersonaliseTab("connections"); setPersonaliseDialogOpen(true); }}
                  className="gap-2"
                >
                  <Link2 className="h-4 w-4" />
                  Connections
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
                <DropdownMenuItem
                  onClick={() => setScheduledOpen(true)}
                  className="gap-2"
                >
                  <Clock className="h-4 w-4" />
                  Scheduled prompts
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
                  onClick={() => setClientContextOpen(true)}
                  className="gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Client Context
                </DropdownMenuItem>
                {/* Only rendered once Chrome/Edge has fired beforeinstallprompt,
                    so the item never appears where it couldn't work (already
                    installed, or a browser without the API). */}
                {canInstall && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        const outcome = await promptInstall();
                        if (outcome === "accepted") toast.success("EngineAI installed — look for it on your home screen");
                      }}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Install app
                    </DropdownMenuItem>
                  </>
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
          </>
        }
      >
                  {sortedGroups ? (
                  /* ─── Grouped by client ─── */
                  sortedGroups.map((group) => (
                    <div key={group.key}>
                      {/* Group heading */}
                      <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
                        <p className="text-[10.5px] font-medium text-white/40 pl-1 truncate">
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
                          onClick={() => editingConvId !== conv.id && handleSelectThread(conv)}
                          onDoubleClick={(e) => startRenaming(e, conv)}
                          className={cn(
                            "w-full text-left rounded-lg px-2.5 py-2 transition-colors group/conv",
                            selectedId === conv.id
                              ? "bg-white/15 text-white"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            {editingConvId === conv.id ? (
                              <input
                                autoFocus
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => saveRename(conv.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveRename(conv.id);
                                  if (e.key === "Escape") setEditingConvId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[14px] font-medium flex-1 bg-white/10 text-white rounded px-1.5 py-0.5 outline-none ring-1 ring-white/30 focus:ring-white/60 min-w-0"
                              />
                            ) : (
                              <p className="text-[14px] font-medium truncate flex-1">{conv.title}</p>
                            )}
                            {/* Right slot: idle = timestamp (+pin badge); hover/selected = actions.
                                Swapped with hidden/flex (NOT opacity) so idle rows give the full
                                width to the title and no invisible-but-clickable buttons exist. */}
                            <div className="flex items-center shrink-0">
                              <span
                                className={cn(
                                  "flex items-center gap-1 text-[11px] text-white/55",
                                  selectedId === conv.id ? "hidden" : "group-hover/conv:hidden"
                                )}
                              >
                                {pinnedConvIds.has(conv.id) && (
                                  <Pin className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                )}
                                {timeAgo(conv.updatedAt)}
                              </span>
                              <div
                                className={cn(
                                  "items-center gap-0.5",
                                  selectedId === conv.id ? "flex" : "hidden group-hover/conv:flex"
                                )}
                              >
                                <button
                                  onClick={(e) => startRenaming(e, conv)}
                                  className="p-1 rounded hover:bg-white/10"
                                  title="Rename"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-white/50 hover:text-white/90" />
                                </button>
                                <button
                                  onClick={(e) => togglePinConversation(e, conv.id)}
                                  className="p-1 rounded hover:bg-white/10"
                                  title={pinnedConvIds.has(conv.id) ? "Unpin" : "Pin"}
                                >
                                  <Pin
                                    className={cn(
                                      "h-3.5 w-3.5 transition-colors",
                                      pinnedConvIds.has(conv.id)
                                        ? "text-yellow-400 fill-yellow-400"
                                        : "text-white/50 hover:text-white/90"
                                    )}
                                  />
                                </button>
                                <button
                                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                                  className="p-1 rounded ml-0.5 hover:bg-red-500/15"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-white/50 hover:text-red-400" />
                                </button>
                              </div>
                            </div>
                          </div>
                          {conv.sharedWithMe && conv.sharedByName && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <UserPlus className="h-3 w-3 text-white/30 shrink-0" />
                              <p className="text-[11px] text-white/55 truncate">
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
                          className="w-full text-left px-2.5 py-1.5 text-[12px] text-white/55 hover:text-white/80 transition-colors"
                        >
                          {group.totalCount - GROUP_PREVIEW_LIMIT} more...
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  /* ─── Flat list (search results, incl. deep content matches) ─── */
                  displayed.map((conv) => (
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
                        <p className="text-[14px] font-medium truncate flex-1">{conv.title}</p>
                        <span className="text-[11px] text-white/55 shrink-0">
                          {timeAgo(conv.updatedAt)}
                        </span>
                      </div>
                      {conv.sharedWithMe && conv.sharedByName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <UserPlus className="h-3 w-3 text-white/30 shrink-0" />
                          <p className="text-[11px] text-white/55 truncate">
                            Shared by {conv.sharedByName}
                          </p>
                        </div>
                      )}
                      {conv.customerName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3 text-white/30 shrink-0" />
                          <p className="text-[11px] text-white/55 truncate">
                            {conv.customerName}
                          </p>
                        </div>
                      )}
                    </button>
                  ))
                )}
      </EngineAISidebar>

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
                alt="EngineAI"
                className="h-5 w-5 dark:brightness-0 dark:invert"
              />
              <span className="text-sm font-bold">EngineAI</span>
            </div>
            {mobileTools}
          </div>
        )}

        {/* Desktop top bar — client picker + theme toggle (home view only; chat view uses ChatPanel headerExtra) */}
        <div className={cn("hidden lg:flex items-center gap-3 px-4 pt-2.5 pb-1 shrink-0", selectedId && "!hidden")}>
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
              refreshSignal={voiceTranscriptN}
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
              onMakeRecurring={(seed) => { setScheduledPrefill(seed); setScheduledOpen(true); }}
              seedText={seedText}
              inputEndSlot={
                <button
                  /* A TOGGLE, not a one-way door. disabled={voiceOpen} left the
                     only exit as Stop inside the dock, so pressing the control
                     you had just pressed did nothing and it read as broken. */
                  onClick={() => { setVoiceWakeSession(false); setVoiceOpen((v) => !v); }}
                  title={voiceOpen ? "End the live voice session" : "Live — talk to EngineAI"}
                  aria-pressed={voiceOpen}
                  className={cn(
                    "h-8 rounded-lg px-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors",
                    voiceOpen
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground/70 hover:text-foreground hover:bg-muted"
                  )}
                >
                  <AudioLines className={cn("h-4 w-4", voiceOpen && "animate-pulse")} />
                  <span>Live</span>
                </button>
              }
              headerExtra={
                <>
                {mobileTools}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="hidden lg:flex h-8 w-8 rounded-full border bg-background hover:bg-muted items-center justify-center transition-colors shrink-0">
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
                </>
              }
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
          <div
            className="flex-1 flex flex-col overflow-hidden lg:overflow-y-auto"
            style={
              // On mobile, use the visual viewport height (minus mobile header 48px)
              // so the layout tracks the keyboard open/close. On desktop, let CSS handle it.
              viewportHeight && typeof window !== "undefined" && window.innerWidth < 1024
                ? { height: `${viewportHeight - 48}px`, flex: "none" }
                : undefined
            }
          >
            {/*
              Mobile: logo centred in space above input, tracks keyboard via visualViewport
              Desktop: everything centred as one block (justify-center), privacy at bottom
            */}

            {/* Logo + tagline */}
            <div className={cn(
              "flex flex-col items-center px-4 min-h-0",
              // Mobile: fill available space, centre logo in that space (like Claude mobile)
              "flex-1 justify-center pb-0",
              // Desktop: don't grow, just add top spacing to help centre the whole group
              "lg:flex-none lg:justify-start lg:pt-[18vh] lg:pb-6"
            )}>
              <img
                src="/assets/logo_engine_icon.svg"
                alt="EngineAI"
                className="h-10 w-10 lg:h-14 lg:w-14 mb-3 lg:mb-5 dark:brightness-0 dark:invert"
              />
              <h1 className="text-2xl lg:text-4xl font-bold tracking-tight mb-1 lg:mb-2">
                What are you working on?
              </h1>
              <p className="text-sm lg:text-base text-muted-foreground max-w-md text-center lg:mb-0">
                Brainstorm ideas, draft content, refine messaging, and more.
              </p>
            </div>

            {/* Input area */}
            <div className="shrink-0 w-full flex flex-col items-center px-4 pb-4 lg:pb-8">
              <div
                className="w-full max-w-[46rem]"
                onDragEnter={handleHomeDragEnter}
                onDragLeave={handleHomeDragLeave}
                onDragOver={handleHomeDragOver}
                onDrop={handleHomeDrop}
              >
                {/* In-flight uploads — shown from the moment the file is
                    chosen, so the wait says which file, how big, and how far. */}
                <UploadChips jobs={uploads} onDismiss={dismissUpload} />

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
                    autoFocus
                    enterKeyHint="send"
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 py-3 sm:px-5 sm:py-4 text-[15px] sm:text-base focus:outline-none placeholder:text-muted-foreground disabled:opacity-50"
                    style={{ minHeight: "44px", maxHeight: "160px" }}
                  />

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.rtf,.json,.xml,.tsv,.html,.txt,.csv,.md"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {/* Bottom button bar */}
                  <div className="flex px-3 pb-3 items-center gap-1 sm:gap-1.5">
                    {/* ── Mobile + button with options popover ── */}
                    <Popover open={mobileOptionsOpen} onOpenChange={setMobileOptionsOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground lg:hidden"
                        >
                          <Plus className={cn("h-5 w-5 transition-transform", mobileOptionsOpen && "rotate-45")} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="start" className="w-[280px] p-0 lg:hidden max-h-[70vh] overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {/* Attach file */}
                          <button
                            onClick={() => { fileInputRef.current?.click(); setMobileOptionsOpen(false); }}
                            disabled={sending || uploading}
                            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                          >
                            {uploading ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <Paperclip className="h-4 w-4 text-muted-foreground" />
                            )}
                            Attach file
                          </button>

                          {/* Visibility */}
                          <div className="h-px bg-border mx-2" />
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Visibility</p>
                          </div>
                          <div className="flex gap-1 px-2">
                            <button
                              onClick={() => { setNewVisibility("private"); setIncognitoMode(false); }}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors",
                                !incognitoMode && newVisibility === "private"
                                  ? "bg-foreground/10 text-foreground font-medium"
                                  : "text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Lock className="h-3 w-3" />
                              Private
                            </button>
                            <button
                              onClick={() => { setNewVisibility("team"); setIncognitoMode(false); }}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors",
                                !incognitoMode && newVisibility === "team"
                                  ? "bg-foreground/10 text-foreground font-medium"
                                  : "text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Users className="h-3 w-3" />
                              Team
                            </button>
                            <button
                              onClick={() => {
                                setIncognitoMode(true);
                                setNewVisibility("private");
                                toast.info("Incognito — chat won't be saved and memories are disabled");
                              }}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors",
                                incognitoMode
                                  ? "bg-amber-500/10 text-amber-500 font-medium"
                                  : "text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <EyeOff className="h-3 w-3" />
                              Incognito
                            </button>
                          </div>

                          {/* Context toggles */}
                          <div className="h-px bg-border mx-2" />
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Context</p>
                          </div>
                          <div className="grid grid-cols-4 gap-1 px-2">
                            {[
                              { key: "contracts" as const, label: "Contracts", Icon: ScrollText, color: "text-amber-400" },
                              { key: "contentPipeline" as const, label: "Content", Icon: Newspaper, color: "text-blue-400" },
                              { key: "socialPresence" as const, label: "Social", Icon: Share2, color: "text-violet-400" },
                              { key: "ideas" as const, label: "Ideas", Icon: Lightbulb, color: "text-yellow-400" },
                            ].map((item) => {
                              const level = contextConfig[item.key];
                              const isOn = level !== "off";
                              const nextLevel = isOn ? "off" : "summary";
                              return (
                                <button
                                  key={item.key}
                                  onClick={() =>
                                    setContextConfig((prev) => ({ ...prev, [item.key]: nextLevel }))
                                  }
                                  className={cn(
                                    "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition-all",
                                    isOn
                                      ? "text-foreground/80 bg-foreground/5"
                                      : "text-muted-foreground/40 hover:bg-muted"
                                  )}
                                >
                                  <item.Icon className={cn("h-3.5 w-3.5", isOn ? item.color : "text-muted-foreground/50")} />
                                  {item.label}
                                </button>
                              );
                            })}
                            <button
                              onClick={() =>
                                setContextConfig((prev) => ({ ...prev, webSearch: prev.webSearch === "on" ? "off" : "on" }))
                              }
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition-all",
                                contextConfig.webSearch === "on"
                                  ? "text-foreground/80 bg-foreground/5"
                                  : "text-muted-foreground/40 hover:bg-muted"
                              )}
                            >
                              <Globe className={cn("h-3.5 w-3.5", contextConfig.webSearch === "on" ? "text-emerald-400" : "text-muted-foreground/50")} />
                              Web
                            </button>
                            <button
                              onClick={() =>
                                setContextConfig((prev) => ({ ...prev, memory: prev.memory === "on" ? "off" : "on" }))
                              }
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition-all",
                                contextConfig.memory === "on"
                                  ? "text-foreground/80 bg-foreground/5"
                                  : "text-muted-foreground/40 hover:bg-muted"
                              )}
                            >
                              <Brain className={cn("h-3.5 w-3.5", contextConfig.memory === "on" ? "text-pink-400" : "text-muted-foreground/50")} />
                              Memory
                            </button>
                            {newVisibility !== "team" && (
                              <button
                                onClick={() =>
                                  setContextConfig((prev) => ({ ...prev, meetingBrain: prev.meetingBrain === "on" ? "off" : "on" }))
                                }
                                className={cn(
                                  "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition-all",
                                  contextConfig.meetingBrain === "on"
                                    ? "text-foreground/80 bg-foreground/5"
                                    : "text-muted-foreground/40 hover:bg-muted"
                                )}
                              >
                                <ListChecks className={cn("h-3.5 w-3.5", contextConfig.meetingBrain === "on" ? "text-teal-400" : "text-muted-foreground/50")} />
                                Tasks
                              </button>
                            )}
                            <button
                              onClick={() =>
                                setContextConfig((prev) => ({ ...prev, imageGeneration: prev.imageGeneration === "on" ? "off" : "on" }))
                              }
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] transition-all",
                                contextConfig.imageGeneration === "on"
                                  ? "text-foreground/80 bg-foreground/5"
                                  : "text-muted-foreground/40 hover:bg-muted"
                              )}
                            >
                              <ImageIcon className={cn("h-3.5 w-3.5", contextConfig.imageGeneration === "on" ? "text-violet-400" : "text-muted-foreground/50")} />
                              Image
                            </button>
                          </div>

                          {/* Theme */}
                          <div className="h-px bg-border mx-2" />
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Theme</p>
                          </div>
                          <div className="flex gap-1 px-2 pb-1">
                            <button
                              onClick={() => setTheme("light")}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors",
                                mounted && resolvedTheme === "light"
                                  ? "bg-foreground/10 text-foreground font-medium"
                                  : "text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Sun className="h-3 w-3" />
                              Light
                            </button>
                            <button
                              onClick={() => setTheme("dark")}
                              className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors",
                                mounted && resolvedTheme === "dark"
                                  ? "bg-foreground/10 text-foreground font-medium"
                                  : "text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Moon className="h-3 w-3" />
                              Dark
                            </button>
                            <button
                              onClick={() => setTheme("system")}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted transition-colors"
                            >
                              <Monitor className="h-3 w-3" />
                              System
                            </button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* ── Desktop-only: attach button ── */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                      className="hidden lg:flex h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      title="Attach file"
                    >
                      {uploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5" />
                      )}
                    </Button>

                    {/* ── Desktop-only: visibility dropdown ── */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "hidden lg:flex h-8 gap-1.5 text-xs px-2.5",
                            incognitoMode
                              ? "text-amber-500 hover:text-amber-400"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {incognitoMode ? (
                            <EyeOff className="h-3 w-3" />
                          ) : newVisibility === "private" ? (
                            <Lock className="h-3 w-3" />
                          ) : (
                            <Users className="h-3 w-3" />
                          )}
                          {incognitoMode ? "Incognito" : newVisibility === "private" ? "Private" : "Team"}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        <DropdownMenuItem
                          onClick={() => { setNewVisibility("private"); setIncognitoMode(false); }}
                          className={cn("gap-2 text-sm", !incognitoMode && newVisibility === "private" && "bg-muted font-medium")}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Private
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { setNewVisibility("team"); setIncognitoMode(false); }}
                          className={cn("gap-2 text-sm", !incognitoMode && newVisibility === "team" && "bg-muted font-medium")}
                        >
                          <Users className="h-3.5 w-3.5" />
                          Team
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setIncognitoMode(true);
                            setNewVisibility("private");
                            toast.info("Incognito — chat won't be saved and memories are disabled");
                          }}
                          className={cn("gap-2 text-sm", incognitoMode && "bg-muted font-medium text-amber-500")}
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Incognito
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* ── Mobile: subtle visibility indicator ── */}
                    <span className={cn(
                      "lg:hidden text-[10px] px-1.5 py-0.5 rounded-md",
                      incognitoMode
                        ? "text-amber-500 bg-amber-500/10"
                        : "text-muted-foreground/60"
                    )}>
                      {incognitoMode ? "Incognito" : newVisibility === "private" ? "" : "Team"}
                    </span>

                    <div className="flex-1" />

                    {/* ── Model selector (both mobile + desktop) ── */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 sm:h-8 gap-1.5 rounded-lg border bg-background text-[13px] text-foreground/90 hover:bg-muted px-2.5"
                        >
                          {selectedModel === "auto" && <Sparkles className="h-3 w-3 text-amber-500" />}
                          {getModelLabel(selectedModel)}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {/* Auto option */}
                        <DropdownMenuItem
                          onClick={() => setSelectedModel("auto")}
                          className={cn(
                            "text-sm",
                            selectedModel === "auto" && "bg-muted font-medium"
                          )}
                        >
                          <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div>EngineAI Auto</div>
                            <div className="text-[10px] text-muted-foreground font-normal">Routes to the best model</div>
                          </div>
                          {selectedModel === "auto" && (
                            <span className="text-primary text-xs">&#10003;</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {/* Individual models */}
                        {AI_MODELS.filter((m) => m.id !== "auto").map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onClick={() => {
                              setSelectedModel(m.id);
                            }}
                            className={cn(
                              "text-sm py-2",
                              selectedModel === m.id && "bg-muted font-medium"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div>{m.label}</div>
                              {"description" in m && m.description && (
                                <div className="text-[10px] text-muted-foreground font-normal">{m.description}</div>
                              )}
                            </div>
                            {selectedModel === m.id && (
                              <span className="text-primary text-xs shrink-0">
                                &#10003;
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <button
                      onClick={() => handleVoiceStart()}
                      disabled={sending}
                      title="Start a voice conversation"
                      className="h-9 w-9 shrink-0 rounded-xl border bg-background hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-50"
                    >
                      <AudioLines className="h-4 w-4 text-muted-foreground" />
                    </button>
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

                {/* Starter prompts — a proper card grid (the primary first-run
                    affordance), shown until the user starts typing */}
                {!homeInput.trim() && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                    {[
                      { label: "What's in the content pipeline?", prompt: "What's in the content pipeline right now? Give me a summary by client and status.", Icon: Newspaper },
                      { label: "Latest client meetings", prompt: "Summarise our most recent client meetings — key topics and next steps.", Icon: Users },
                      { label: "My tasks", prompt: "What tasks am I assigned right now, across the Engine and my meetings?", Icon: ListChecks },
                      { label: "Draft a LinkedIn post", prompt: "Draft a LinkedIn post for one of our clients. Ask me which client and topic first.", Icon: Sparkles },
                    ].map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          setHomeInput(s.prompt);
                          textareaRef.current?.focus();
                        }}
                        className="flex items-center gap-2.5 p-3 rounded-xl border bg-background text-left hover:bg-muted/50 hover:border-foreground/20 transition-colors"
                      >
                        <span className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0">
                          <s.Icon className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span className="text-[13px] font-medium text-foreground/90 leading-snug">{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Context & web search controls (desktop only — mobile uses + popover) */}
                <div className="hidden lg:flex items-center justify-center gap-1.5 mt-3 flex-wrap">
                  {[
                    { key: "contracts" as const, label: "Contracts", Icon: ScrollText, color: "text-amber-400" },
                    { key: "contentPipeline" as const, label: "Content", Icon: Newspaper, color: "text-blue-400" },
                    { key: "socialPresence" as const, label: "Social", Icon: Share2, color: "text-violet-400" },
                    { key: "ideas" as const, label: "Ideas", Icon: Lightbulb, color: "text-yellow-400" },
                  ].map((item) => {
                    const level = contextConfig[item.key];
                    const isOn = level !== "off";
                    const nextLevel = isOn ? "off" : "summary";
                    return (
                      <button
                        key={item.key}
                        onClick={() =>
                          setContextConfig((prev) => ({
                            ...prev,
                            [item.key]: nextLevel,
                          }))
                        }
                        title={`${item.label}: ${isOn ? "On" : "Off"} — click to toggle`}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                          isOn
                            ? "bg-foreground/[0.06] border-border text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        <item.Icon className={cn(
                          "h-3.5 w-3.5 transition-colors",
                          isOn
                            ? item.color
                            : "text-muted-foreground/50"
                        )} />
                        {item.label}
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
                      // All selectable models support web search: Claude natively,
                      // Grok via LiveSearch, GPT/Gemini via the web_search tool.
                    }}
                    title={`Web Search: ${contextConfig.webSearch === "on" ? "On — AI can search the web" : "Off"} — click to toggle`}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      contextConfig.webSearch === "on"
                        ? "bg-foreground/[0.06] border-border text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Globe className={cn(
                      "h-3.5 w-3.5 transition-colors",
                      contextConfig.webSearch === "on" ? "text-emerald-400" : "text-muted-foreground/50"
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
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      contextConfig.memory === "on"
                        ? "bg-foreground/[0.06] border-border text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Brain className={cn(
                      "h-3.5 w-3.5 transition-colors",
                      contextConfig.memory === "on" ? "text-pink-400" : "text-muted-foreground/50"
                    )} />
                    Memory
                  </button>
                  {newVisibility !== "team" && (
                    <button
                      onClick={() =>
                        setContextConfig((prev) => ({
                          ...prev,
                          meetingBrain: prev.meetingBrain === "on" ? "off" : "on",
                        }))
                      }
                      title={`MeetingBrain: ${contextConfig.meetingBrain === "on" ? "On — includes your tasks & meetings" : "Off"} — click to toggle`}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                        contextConfig.meetingBrain === "on"
                          ? "bg-foreground/[0.06] border-border text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <ListChecks className={cn(
                        "h-3.5 w-3.5 transition-colors",
                        contextConfig.meetingBrain === "on" ? "text-teal-400" : "text-muted-foreground/50"
                      )} />
                      MeetingBrain
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const turningOn = contextConfig.imageGeneration !== "on";
                      setContextConfig((prev) => ({
                        ...prev,
                        imageGeneration: turningOn ? "on" : "off",
                      }));
                    }}
                    title={`Image Generation: ${contextConfig.imageGeneration === "on" ? "On — AI can create images" : "Off"} — click to toggle`}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      contextConfig.imageGeneration === "on"
                        ? "bg-foreground/[0.06] border-border text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <ImageIcon className={cn(
                      "h-3.5 w-3.5 transition-colors",
                      contextConfig.imageGeneration === "on" ? "text-violet-400" : "text-muted-foreground/50"
                    )} />
                    Image
                  </button>
                </div>

              </div>
            </div>

            {/* Privacy line — desktop: pushed to bottom with flex-1 spacer; mobile: hidden (saves space for keyboard) */}
            <div className="hidden lg:flex flex-1 items-end justify-center pb-4">
              <button
                onClick={() => setPrivacyModalOpen(true)}
                className="text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors text-center flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="h-3 w-3" />
                Your data is protected. No AI provider trains on your conversations.
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Notebook (docked right, collapsed by default) ─── */}
      <NotebookPanel
        workspaceId={workspaceId}
        onJumpToSource={jumpToSource}
        onAskAbout={(entry) => {
          // Seed the composer rather than sending: the user decides what to ask
          // about the clipping.
          const seed = `About this from my notebook:\n\n> ${entry.quote.slice(0, 1200)}\n\n`;
          if (selectedId) setSeedText({ text: seed, nonce: Date.now() });
          else setHomeInput((prev) => (prev.trim() ? `${prev}\n\n${seed}` : seed));
          toast.info("Added to the message box — finish your question");
        }}
      />

      {/* Data Privacy Modal */}
      <Dialog open={privacyModalOpen} onOpenChange={setPrivacyModalOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Your Data is Protected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              EngineAI connects to multiple AI providers via their enterprise APIs.
              Under each provider&apos;s enterprise terms, <strong className="text-foreground">your prompts, responses, and client data
              are never used to train AI models</strong>.
            </p>

            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium text-foreground text-xs">Anthropic (Claude)</div>
                <p className="text-xs">
                  API data is explicitly excluded from model training. Inputs are retained for
                  7 days for abuse monitoring only, then automatically deleted.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium text-foreground text-xs">xAI (Grok)</div>
                <p className="text-xs">
                  Enterprise API terms state: &ldquo;xAI shall not use any User Content for any of its
                  internal AI or other training purposes.&rdquo; You own all inputs and outputs.
                  Data is automatically deleted within 30 days.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium text-foreground text-xs">OpenAI (GPT-4o)</div>
                <p className="text-xs">
                  API data is not used for training by default &mdash; no opt-out required.
                  Data is retained for up to 30 days for abuse monitoring only.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium text-foreground text-xs">Google (Gemini)</div>
                <p className="text-xs">
                  Enterprise and API customer data is never used for model training.
                  Google explicitly confirms prompts and outputs don&apos;t touch training pipelines.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium text-foreground text-xs">Perplexity (Sonar)</div>
                <p className="text-xs">
                  API data is not used for model training. Perplexity&apos;s API terms state that
                  customer inputs and outputs are not used to train or improve their models.
                  Perplexity includes built-in web search &mdash; queries are sent to the web to
                  retrieve real-time information, but your conversation data remains private.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
              <div className="font-medium text-foreground text-xs">What this means for The Content Engine</div>
              <ul className="text-xs space-y-1 list-disc list-inside">
                <li>Client data shared in conversations stays private</li>
                <li>No provider will use your content to improve their public models</li>
                <li>All data is automatically deleted from provider servers within 7&ndash;30 days</li>
                <li>Conversation history is stored securely in your workspace database</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground/60">
              These protections apply to all models available in EngineAI, including when
              using Auto mode. For full details, refer to each provider&apos;s enterprise terms of service.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Scheduled prompts hub */}
      {workspaceId && (
        <ScheduledPromptsDialog
          workspaceId={workspaceId}
          open={scheduledOpen}
          onClose={() => { setScheduledOpen(false); setScheduledPrefill(null); }}
          prefill={scheduledPrefill}
        />
      )}

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
          initialTab={personaliseTab}
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
      {/* Client Context Dialog */}
      <ClientContextDialog
        open={clientContextOpen}
        onClose={() => setClientContextOpen(false)}
      />
      {/* Docked voice conversation — thread stays visible and fills live */}
      {workspaceId && selectedId && (
        <VoiceDock
          incognito={incognitoMode}
          open={voiceOpen}
          onClose={() => {
            setVoiceOpen(false);
            // Catch the final transcript flush
            setVoiceTranscriptN((n) => n + 1);
          }}
          conversationId={selectedId}
          workspaceId={workspaceId}
          customerId={customerId}
          onTranscriptSaved={() => setVoiceTranscriptN((n) => n + 1)}
          wakeSession={voiceWakeSession}
          initialCommand={voiceWakeCommand}
          initialAudioPromise={voiceWakeAudioRef.current}
        />
      )}
      {/* "Orac" — hands-free wake phrase (local-only listening). Off while it
          is reworked; see ORAC_ENABLED. Not mounted rather than hidden, because
          mounting it opens the microphone. */}
      {ORAC_ENABLED && workspaceId && (
        <WakeMode
          ref={wakeRef}
          onStateChange={setWakeUi}
          engaged={voiceOpen}
          onWake={(command, commandAudio) => handleVoiceStart(true, command, commandAudio)}
          onEndConversation={() => {
            setVoiceOpen(false);
            // Pick up the dock's final transcript flush in the thread
            setTimeout(() => setVoiceTranscriptN((n) => n + 1), 800);
          }}
        />
      )}
      {/* The meeting copilot has no entry point here any more.
          It is launched from MeetingBrain, whose MeetingDetailModal opens
          ai.thecontentengine.com/meeting with the meeting id — the place a
          meeting actually starts, and the only launcher that carries that id.
          The feature is unchanged; only this second door is gone, so that
          "Live" in this app means voice and nothing else. */}
    </>
  );
}
