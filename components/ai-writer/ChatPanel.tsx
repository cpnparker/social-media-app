"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock,
  Users,
  MoreHorizontal,
  Download,
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
  X,
  ShieldCheck,
  FileText,
  Database,
  BrainCircuit,
  ChevronDown,
  Search,
  Sparkles,
  ArrowDown,
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
import { AI_MODELS, getModelLabel } from "@/lib/ai/models";
import MessageBubble from "./MessageBubble";
import ChatInput, { type ChatInputHandle } from "./ChatInput";
import ShareDialog from "./ShareDialog";
import SlideDraftPreview, { type SlideDraft } from "./SlideDraftPreview";
import SlideLightbox from "./SlideLightbox";
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
  headerExtra?: React.ReactNode;
  /** Text to drop into the composer WITHOUT sending (notebook "ask about
   *  this"). The nonce lets the same text be seeded twice. */
  seedText?: { text: string; nonce: number } | null;
  /** Increment to quietly refetch messages (no loading spinner) — used by
   *  voice mode to surface transcript turns in the thread live. */
  refreshSignal?: number;
  /** Rendered in the input toolbar next to the send button (e.g. voice mode). */
  inputEndSlot?: React.ReactNode;
  /** Open the Scheduled prompts hub pre-filled with this answer's prompt
   *  ("Make recurring" on assistant messages). */
  onMakeRecurring?: (seed: { title: string; prompt: string }) => void;
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
  headerExtra,
  seedText,
  onMakeRecurring,
  refreshSignal,
  inputEndSlot,
}: ChatPanelProps) {
  const [conversation, setConversation] = useState<AIConversation | null>(null);
  const [messages, setMessages] = useState<AIMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Captures the assistant message id emitted by the server as the first SSE
  // event. Lets the local optimistic row reuse the real DB id so fetch-on-reload
  // merges cleanly and returning tabs know which row to poll.
  const assistantIdRef = useRef<string | null>(null);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingDocument, setIsGeneratingDocument] = useState(false);
  // A slide request that failed on the Google connection rather than on the
  // deck. Held in state (not a toast) because it carries the only action that
  // fixes it, and a toast the user misses leaves them stuck.
  const [slidesReauth, setSlidesReauth] = useState<{ message: string; reason: string } | null>(null);
  // Thumbnails of the deck just built or edited. The markdown link still goes
  // into the message itself, so history keeps a way back to the file; this is
  // the at-a-glance look at what actually landed.
  // A deck rendered but NOT written to Drive. Held until the user presses the
  // button or asks for changes, which replace it with a new draft.
  const [slidesDraft, setSlidesDraft] = useState<SlideDraft | null>(null);
  // The draft as it is RIGHT NOW, for edits that resolve asynchronously. An
  // image takes tens of seconds to generate, and the patch used to be applied
  // to the draft captured when the request started — so every word typed while
  // the picture was being made was thrown away when it arrived.
  const slidesDraftRef = useRef<SlideDraft | null>(null);
  slidesDraftRef.current = slidesDraft;
  const [slidesDraftMessageId, setSlidesDraftMessageId] = useState<string | null>(null);
  const [slidesZoom, setSlidesZoom] = useState<number | null>(null);
  const previewRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Warn once per thread, not once per keystroke. */
  const draftUnsavedWarnedRef = useRef(false);
  const [publishingSlides, setPublishingSlides] = useState(false);
  const [slidesPreview, setSlidesPreview] = useState<
    { url: string; title: string; slideCount: number; updated: boolean; thumbnails: string[] } | null
  >(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  const reauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isQueryingEngine, setIsQueryingEngine] = useState(false);
  const [isSearchingMemory, setIsSearchingMemory] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isFactChecking, setIsFactChecking] = useState(false);
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
  const [moveClientConfirm, setMoveClientConfirm] = useState<{ id: string | null; name: string } | null>(null);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [myPermission, setMyPermission] = useState<"owner" | "view" | "collaborate">("owner");
  const canManage = myPermission === "owner" || !!isAdmin;
  const [shares, setShares] = useState<{ userId: number; userName: string | null; permission: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const initialMessageSent = useRef(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  // Seeded text goes into the box for the user to finish — unlike
  // initialMessage, which is sent automatically.
  const seededNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!seedText || seedText.nonce === seededNonce.current) return;
    // THE NONCE IS CONSUMED ONLY ON SUCCESS.
    //
    // This read `chatInputRef.current?.seedText(...)` with the nonce marked
    // first, so a null ref was swallowed by the optional chain and the seed was
    // gone — marked as delivered, never delivered. That is unreachable when a
    // panel is already on screen, which is why the notebook never showed it,
    // and guaranteed on a FRESH LOAD: this component returns a spinner until
    // the conversation resolves, so ChatInput is not mounted when a seed
    // arriving with the page runs.
    //
    // The Writing Studio's "Ask" lands in exactly that state every time — it
    // navigates to a brand-new thread and seeds it on arrival.
    const input = chatInputRef.current;
    if (!input) return; // not mounted yet; the deps below re-run this when it is
    seededNonce.current = seedText.nonce;
    input.seedText(seedText.text);
  }, [seedText, loading, conversation]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Fetch conversation and messages
  const fetchConversation = useCallback(async () => {
    setLoading(true);
    // The warning is per-thread: a new conversation deserves to be told once.
    draftUnsavedWarnedRef.current = false;
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages || []);
      hydrateSlidesFromMessages(data.messages || []);
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

  // Quiet refresh (no spinner) — voice mode bumps refreshSignal after saving
  // transcript turns so they appear in the thread while the session runs.
  useEffect(() => {
    if (!refreshSignal) return;
    (async () => {
      try {
        const res = await fetch(`/api/ai/conversations/${conversationId}`);
        if (!res.ok) return;
        const data = await res.json();
        setMessages(data.messages || []);
      } catch {
        // best-effort
      }
    })();
  }, [refreshSignal, conversationId]);

  // Fire-and-forget resume: if we return to a conversation where the last row
  // is still `pending` (streaming continued server-side while this tab was
  // unmounted), poll the GET endpoint until the row flips to `complete` or
  // `failed`. Skipped while a local stream is active — that flow owns its own
  // completion.
  const lastMsg = messages[messages.length - 1];
  const pendingAssistantId =
    lastMsg?.role === "assistant" && lastMsg.status === "pending" ? lastMsg.id : null;

  useEffect(() => {
    if (!pendingAssistantId || isStreaming) return;

    const POLL_INTERVAL_MS = 2000;
    const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 min cap
    const startedAt = Date.now();
    let cancelled = false;

    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(intervalId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingAssistantId
              ? { ...m, status: "failed", content: "Generation timed out — please retry." }
              : m
          )
        );
        return;
      }
      try {
        const res = await fetch(`/api/ai/conversations/${conversationId}`);
        if (!res.ok) return;
        const data = await res.json();
        const serverLast = data.messages?.[data.messages.length - 1];
        if (
          serverLast &&
          serverLast.id === pendingAssistantId &&
          serverLast.status &&
          serverLast.status !== "pending"
        ) {
          window.clearInterval(intervalId);
          if (!cancelled) setMessages(data.messages);
        }
      } catch {
        // Swallow transient fetch errors; keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pendingAssistantId, isStreaming, conversationId]);

  // Auto-send initial message (quick-send from home page)
  useEffect(() => {
    if ((initialMessage || initialAttachments?.length) && conversation && !initialMessageSent.current && !loading) {
      initialMessageSent.current = true;
      handleSend(initialMessage || "", initialAttachments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, initialAttachments, conversation, loading]);

  // ── Smart scroll ──
  // Simple rule: scroll to bottom ONCE when user sends a message.
  // Never auto-scroll during streaming. User reads at their own pace.
  // "↓" pill button lets user jump to bottom manually.

  /**
   * Turn a comment on an image into an edit of THAT image.
   *
   * The url is the whole point: without it the model generates a fresh image
   * and the user loses the one they were reacting to, which reads as having
   * been ignored. `source_image_url` routes it through the edit path instead.
   */
  const sendImageComment = (src: string, text: string) => {
    void handleSend(
      `Edit this image: ${text}\n\n` +
      `Use generate_image with source_image_url set to ${src} so it is edited rather than remade. ` +
      `Keep everything I have not asked you to change.`
    );
  };

  /**
   * Apply a direct edit to the draft, and persist it.
   *
   * Local first so the change is instant — the geometry is fixed, so new text
   * needs no re-layout — then saved, because a draft that loses its edits on
   * reload is the same fault that moving drafts onto the message fixed.
   */
  const applyDraftEdit = useCallback(async (patch: SlideDraft | ((cur: SlideDraft) => SlideDraft)) => {
    const current = slidesDraftRef.current;
    if (typeof patch === "function" && !current) return;
    const next = typeof patch === "function" ? patch(current as SlideDraft) : patch;
    setSlidesDraft(next);
    slidesDraftRef.current = next;

    // Re-derive the drawing from the spec. The local patch updates words
    // instantly, which keeps typing responsive, but it cannot know that a bar's
    // LENGTH is its value or that a marker's position is its date — editing a
    // number changed the label and left the bar the old size. Debounced so a
    // burst of keystrokes costs one call.
    if (previewRefreshRef.current) clearTimeout(previewRefreshRef.current);
    previewRefreshRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/slides/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slides: next.slides }),
        });
        if (!res.ok) return;
        const { preview } = await res.json();
        // Only if the user has not moved on to a different draft in the
        // meantime, or a stale response would overwrite newer edits.
        setSlidesDraft((cur) => (cur && cur.slides === next.slides ? { ...cur, preview } : cur));
      } catch {
        /* the optimistic patch stands; words are right even if a bar is not */
      }
    }, 350);

    if (!slidesDraftMessageId) {
      // No message to save against — an incognito thread, or a draft whose
      // pending row never landed. The edit works and will not survive a
      // reload, and saying nothing let people lose an afternoon's tidying.
      if (!draftUnsavedWarnedRef.current) {
        draftUnsavedWarnedRef.current = true;
        toast.warning("Changes to this deck won't be saved if you reload.");
      }
      return;
    }
    // Debounced, like the preview refresh above it. This fires from a
    // textarea's onChange, so typing "Revenue" used to issue seven concurrent
    // read-modify-writes of the whole draft with no version on any of them —
    // whichever response the database served last won, which is not
    // necessarily the last thing typed. One save per pause instead.
    if (draftSaveRef.current) clearTimeout(draftSaveRef.current);
    const messageId = slidesDraftMessageId;
    draftSaveRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/slides/draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, draft: next }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          // The edit stays on screen: it is valid, it just is not saved, and
          // silently reverting what someone typed is worse than saying so.
          toast.error(j.error || "Change applied but not saved — reloading will lose it.");
        }
      } catch {
        toast.error("Change applied but not saved — reloading will lose it.");
      }
    }, 500);
  }, [slidesDraftMessageId]);

  /**
   * Turn a comment on one slide into a properly scoped instruction.
   *
   * The user should only have to write the change, not locate it. The slide
   * number and title come from what they clicked, and the reminder to resend
   * the whole deck is here rather than left to the model: `slides` replaces
   * every slide, so a revision that returns only the changed one silently
   * deletes the rest.
   */
  // Deliberately NOT memoised: handleSend is rebuilt every render and closes
  // over the current conversation and messages. A useCallback here would pin
  // the first render's copy and send into a stale thread.
  const sendSlideComment = (deckTitle: string, index: number, slideTitle: string | undefined, text: string) => {
    const which = slideTitle ? `slide ${index + 1} ("${slideTitle}")` : `slide ${index + 1}`;
    void handleSend(
      `On ${which} of "${deckTitle}": ${text}\n\n` +
      `Change only that slide. Leave every other slide exactly as it is, and resend the complete deck.`
    );
  };

  /**
   * Restore the deck card from the stored messages.
   *
   * Only the LAST deck in the thread is shown. Every revision writes its own
   * draft, so rendering all of them would stack five near-identical previews
   * and put the user back to working out which one is current — the confusion
   * this flow exists to remove. A deck that was published shows as published.
   */
  const hydrateSlidesFromMessages = useCallback((rows: AIMessageRow[]) => {
    const withDeck = [...rows].reverse().find((m) => m.slidesDraft);
    if (!withDeck?.slidesDraft) {
      setSlidesDraft(null); setSlidesDraftMessageId(null); setSlidesPreview(null);
      return;
    }
    const deck = withDeck.slidesDraft;
    if (deck.published?.url) {
      setSlidesDraft(null);
      setSlidesDraftMessageId(null);
      setSlidesPreview({
        url: deck.published.url,
        title: deck.title,
        slideCount: deck.published.slideCount ?? deck.slides.length,
        updated: false,
        thumbnails: deck.published.thumbnails || [],
      });
      return;
    }
    setSlidesPreview(null);
    setSlidesDraft({ title: deck.title, slides: deck.slides, preview: deck.preview });
    setSlidesDraftMessageId(withDeck.id);
  }, []);

  /**
   * Put the reviewed draft into Drive. Only ever reached from the button.
   *
   * On failure the draft is deliberately KEPT — the user has been iterating on
   * it, and clearing it because a network call failed would throw that away.
   */
  const publishSlidesDraft = useCallback(async () => {
    if (!slidesDraft) return;
    setPublishingSlides(true);
    try {
      const res = await fetch("/api/slides/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: slidesDraft.title,
          slides: slidesDraft.slides,
          messageId: slidesDraftMessageId,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // A connection problem is fixable, so it gets the reconnect card
        // rather than a toast the user cannot act on.
        if (j.reconnectable) setSlidesReauth({ message: j.error, reason: j.reason || "needs_reconnect" });
        else toast.error(j.error || "Couldn't create the deck.");
        return;
      }
      setSlidesDraft(null);
      setSlidesPreview({
        url: j.url, title: j.title, slideCount: j.slideCount ?? 0,
        updated: !!j.updated, thumbnails: j.thumbnails || [],
      });
      if (j.warning) toast.warning(j.warning);
      const gained = j.splitFrom ? (j.slideCount ?? 0) - j.splitFrom : 0;
      toast.success(
        gained > 0
          ? `Deck created in your Google Drive — ${j.slideCount} slides. ${gained === 1 ? "One slide was" : `${gained} slides were`} added because a body was too long for its box.`
          : "Deck created in your Google Drive."
      );
    } catch {
      toast.error("Couldn't reach Google. Try again in a moment.");
    } finally {
      setPublishingSlides(false);
    }
  }, [slidesDraft, slidesDraftMessageId]);

  /**
   * Reconnect Google from inside the conversation.
   *
   * The consent round-trip returns to our own callback, which closes itself, so
   * the popup closing is the only signal available — same approach as the
   * connections panel. Closing is NOT success, though: someone can dismiss the
   * window early or approve the wrong Google account, so the capability
   * endpoint is asked whether the scope actually landed before the prompt is
   * cleared. Anything else would tell the user they are ready when they are not.
   */
  const reconnectGoogle = useCallback(() => {
    const url = "/api/connections/google/start";
    const w = window.open(url, "engine-google-connect", "width=520,height=720");
    if (!w) {
      window.location.href = url;
      return;
    }
    setReauthBusy(true);
    if (reauthPollRef.current) clearInterval(reauthPollRef.current);
    reauthPollRef.current = setInterval(() => {
      if (!w.closed) return;
      if (reauthPollRef.current) clearInterval(reauthPollRef.current);
      reauthPollRef.current = null;
      // Google's consent can land a moment after the window goes.
      setTimeout(async () => {
        try {
          const res = await fetch("/api/slides/capability");
          const j = await res.json();
          if (j.canCreate) {
            setSlidesReauth(null);
            toast.success("Google reconnected — ask for the deck again and I'll build it.");
          } else {
            setSlidesReauth({ message: j.message || "That didn't complete. Try connecting again, and make sure you approve the Google account you use here.", reason: j.reason || "needs_reconnect" });
          }
        } catch {
          toast.error("Couldn't confirm the connection. Try again in a moment.");
        } finally {
          setReauthBusy(false);
        }
      }, 800);
    }, 700);
  }, []);

  // The conversation can unmount mid-flow; leaving the watcher running would
  // poll a window handle that no longer matters.
  useEffect(() => () => { if (reauthPollRef.current) clearInterval(reauthPollRef.current); }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether user can see the bottom (for showing the ↓ button)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkPosition = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;
      setUserScrolledUp(!atBottom);
    };

    container.addEventListener("scroll", checkPosition, { passive: true });
    return () => container.removeEventListener("scroll", checkPosition);
  }, []);

  // Scroll to bottom on initial conversation load
  const hasScrolledOnLoad = useRef(false);
  useEffect(() => {
    if (messages.length > 0 && !hasScrolledOnLoad.current) {
      hasScrolledOnLoad.current = true;
      // Wait for DOM to render messages before scrolling
      requestAnimationFrame(() => {
        setUserScrolledUp(false);
        scrollToBottom();
      });
    }
  }, [messages.length, scrollToBottom]);

  // Reset scroll flag when conversation changes
  useEffect(() => {
    hasScrolledOnLoad.current = false;
    setUserScrolledUp(false);
  }, [conversationId]);

  // Scroll to bottom only when USER sends a message, not when assistant response finishes
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    const prev = prevMessagesLenRef.current;
    prevMessagesLenRef.current = messages.length;
    if (messages.length > prev) {
      const latest = messages[messages.length - 1];
      if (latest?.role === "user") {
        setUserScrolledUp(false);
        scrollToBottom();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

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
    assistantIdRef.current = null;

    let fullText = "";
    // Mirrors the server's history-echo guard: when generation failed this
    // turn, the model may echo a PREVIOUS turn's image URL with a success
    // narration — the server strips it from the persisted copy, and this flag
    // lets the client strip it from the live copy so the two never diverge.
    let imageGenFailed = false;

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const res = await fetch(
        `/api/ai/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, attachments, contextConfig: localContextConfig, debugMode }),
          signal: abortController.signal,
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send message");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      // SSE frames can split across reads (routine for multi-KB frames like
      // scheduled_proposal). Buffer the trailing partial line between reads —
      // without this, both halves of a split frame are silently dropped.
      let sseBuf = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuf += decoder.decode(value, { stream: true });
        const segments = sseBuf.split("\n");
        sseBuf = segments.pop() || "";
        const lines = segments.filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.assistantMessageId) {
              assistantIdRef.current = parsed.assistantMessageId;
            } else if (parsed.debugContext) {
              setDebugContext(parsed.debugContext);
            } else if (parsed.searching) {
              setIsSearchingWeb(true);
            } else if (parsed.generating_image) {
              setIsGeneratingImage(true);
            } else if (parsed.image_ready) {
              setIsGeneratingImage(false);
              // Inject image into client fullText for live display
              // (server has its own copy in server-side fullText for DB persistence)
              const imgUrl = parsed.image_ready.url;
              if (imgUrl) {
                fullText += `\n\n![Generated image](${imgUrl})\n\n`;
                setStreamingContent(fullText);
              }
            } else if (parsed.image_error) {
              setIsGeneratingImage(false);
              imageGenFailed = true;
              toast.error(`Image generation failed: ${parsed.image_error}`);
            } else if (parsed.generating_document) {
              setIsGeneratingDocument(true);
            } else if (parsed.document_ready) {
              setIsGeneratingDocument(false);
              const docUrl = parsed.document_ready.url;
              const docName = parsed.document_ready.filename;
              if (docUrl) {
                fullText += `\n\n📄 [Download ${docName}](${docUrl})\n\n`;
                setStreamingContent(fullText);
              }
            } else if (parsed.document_error) {
              setIsGeneratingDocument(false);
              toast.error(`Document generation failed: ${parsed.document_error}`);
            } else if (parsed.slides_draft) {
              setIsGeneratingDocument(false);
              setSlidesReauth(null);
              // A new draft supersedes the last one; two previews of the same
              // deck on screen is the confusion this whole flow removes.
              setSlidesPreview(null);
              setSlidesDraft(parsed.slides_draft);
              setSlidesDraftMessageId(assistantIdRef.current || null);
            } else if (parsed.slides_ready) {
              setIsGeneratingDocument(false);
              const deck = parsed.slides_ready;
              if (deck.url) {
                setSlidesReauth(null);
                setSlidesDraft(null);
                setSlidesPreview({
                  url: deck.url,
                  title: deck.title,
                  slideCount: deck.slideCount ?? 0,
                  updated: !!deck.updated,
                  thumbnails: deck.thumbnails || [],
                });
                fullText += `\n\n📊 [${deck.updated ? "Updated" : "Open"} ${deck.title} in Google Slides](${deck.url})\n\n`;
                setStreamingContent(fullText);
              }
            } else if (parsed.slides_reauth) {
              setIsGeneratingDocument(false);
              setSlidesReauth({
                message: parsed.slides_reauth.message,
                reason: parsed.slides_reauth.reason,
              });
            } else if (parsed.slides_error) {
              // Usually a fixable connection state ("reconnect Google"), not a
              // crash — so the message is shown as-is rather than wrapped in
              // "generation failed", which would bury the action.
              setIsGeneratingDocument(false);
              toast.error(parsed.slides_error);
            } else if (parsed.querying_engine) {
              setIsQueryingEngine(true);
            } else if (parsed.query_result) {
              setIsQueryingEngine(false);
            } else if (parsed.searching_memory) {
              setIsSearchingMemory(true);
            } else if (parsed.memory_result) {
              setIsSearchingMemory(false);
            } else if (parsed.fallback) {
              // Server switched providers mid-turn (stall/failure) and will
              // re-stream the WHOLE answer; only that answer gets persisted.
              // Reset the partial text so display matches what's saved.
              fullText = "";
              setStreamingContent("");
            } else if (parsed.scheduled_proposal) {
              // Inject the proposal marker into client fullText for live display
              // (the server appended the same marker to its persisted copy).
              // MessageBubble extracts it and renders the confirmation card.
              const marker = parsed.scheduled_proposal.marker;
              if (marker) {
                fullText += marker;
                setStreamingContent(fullText);
              }
            } else if (parsed.token) {
              // First token means search/image gen is done (if it was active)
              setIsSearchingWeb(false);
              setIsGeneratingImage(false);
              setIsGeneratingDocument(false);
              setIsQueryingEngine(false);
              setIsSearchingMemory(false);
              fullText += parsed.token;
              // Remove duplicate image markdown from display text.
              // The first ![Generated image](url) was injected by image_ready.
              // Any subsequent ![...](same-url) is the model repeating it — strip those.
              const seenImgUrls = new Set<string>();
              const cleanedDisplay = fullText.replace(
                /!\[([^\]]*)\]\(([^)]+)\)/g,
                (m, _a, u) => {
                  if (seenImgUrls.has(u)) return "";
                  seenImgUrls.add(u);
                  return m;
                }
              );
              setStreamingContent(cleanedDisplay);
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

      // Add assistant message and clear streaming in the same tick so React
      // batches the updates into a single render — prevents images from being
      // unmounted (cancelling their load) between clearing streaming and adding
      // the permanent message.
      if (fullText) {
        // After a FAILED generation, strip any image markdown whose URL already
        // exists in a prior message — that's the model echoing an old image to
        // cover the failure (the server strips it from the persisted copy; this
        // keeps the live copy identical). Clean turns keep echoes: legitimate
        // re-display ("show me that image again") has no failure.
        if (imageGenFailed) {
          const historyUrls = new Set<string>();
          const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
          for (const pm of messages) {
            let m: RegExpExecArray | null;
            const re = new RegExp(imgRe.source, "g");
            while ((m = re.exec(pm.content || "")) !== null) historyUrls.add(m[1]);
          }
          fullText = fullText
            .replace(/\[Previously generated image\]/g, "")
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match: string, _alt: string, url: string) =>
              historyUrls.has(url) ? "" : match
            );
        }
        // Deduplicate image/chart URLs — model sometimes repeats the tool-generated URL
        const seenUrls = new Set<string>();
        const dedupedText = fullText.replace(
          /!\[([^\]]*)\]\(([^)]+)\)/g,
          (match: string, _alt: string, url: string) => {
            if (seenUrls.has(url)) return "";
            seenUrls.add(url);
            return match;
          }
        ).replace(/\n{3,}/g, "\n\n").trim();

        const assistantMsg: AIMessageRow = {
          id: assistantIdRef.current || `assistant-${Date.now()}`,
          conversationId: conversationId,
          role: "assistant",
          content: dedupedText,
          model: conversation.model,
          createdBy: null,
          createdAt: new Date().toISOString(),
          status: "complete",
        };
        // Batch: add message + clear streaming together
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
      } else {
        // Empty response — show a fallback message instead of blank
        const fallbackMsg: AIMessageRow = {
          id: assistantIdRef.current || `assistant-${Date.now()}`,
          conversationId: conversationId,
          role: "assistant",
          content: "Sorry, I wasn't able to generate a response. This can happen with complex tool calls. Please try rephrasing your request, or break it into smaller steps (e.g., first get the data, then ask for a chart).",
          model: conversation.model,
          createdBy: null,
          createdAt: new Date().toISOString(),
          status: "complete",
        };
        setMessages((prev) => [...prev, fallbackMsg]);
        setStreamingContent("");
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
      if (err?.name === "AbortError") {
        // User clicked stop — save whatever we have so far
        if (fullText) {
          const partialMsg: AIMessageRow = {
            id: assistantIdRef.current || `assistant-${Date.now()}`,
            conversationId: conversationId,
            role: "assistant",
            content: fullText + "\n\n*[Generation stopped]*",
            model: conversation.model,
            createdBy: null,
            createdAt: new Date().toISOString(),
            status: "complete",
          };
          setMessages((prev) => [...prev, partialMsg]);
        }
      } else {
        console.error("Send error:", err);
        toast.error(err?.message || "Failed to send message");
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsSearchingWeb(false);
      setIsGeneratingImage(false);
      setIsGeneratingDocument(false);
      setIsQueryingEngine(false);
      setIsSearchingMemory(false);
      setStreamingContent("");
    }
  };

  // Stop generation
  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  // Retry last assistant message
  const handleRetry = async (messageIndex: number) => {
    if (isStreaming || isFactChecking) return;
    // Find the user message that preceded this assistant message
    const userMsg = messages.slice(0, messageIndex).reverse().find(m => m.role === "user");
    if (!userMsg) return;
    // Remove the assistant message (and any after it)
    setMessages(prev => prev.slice(0, messageIndex));
    // Re-send the user message
    handleSend(userMsg.content, userMsg.attachments as any || undefined);
  };

  // Edit a user message: truncate conversation at that point, resend with new content
  const handleEditMessage = async (messageIndex: number, newContent: string) => {
    if (isStreaming || isFactChecking) return;
    // Remove this message and everything after it
    setMessages((prev) => prev.slice(0, messageIndex));
    // Send the edited content as a new message
    handleSend(newContent);
  };

  // Export the conversation as a Markdown file (client-side download)
  const handleExportMarkdown = () => {
    if (!conversation || messages.length === 0) return;
    const lines: string[] = [
      `# ${conversation.title || "EngineAI Conversation"}`,
      ``,
      `_Exported ${new Date().toLocaleString()} · ${messages.length} messages_`,
      ``,
    ];
    for (const m of messages) {
      const who = m.role === "user" ? (m.createdByName || "User") : `EngineAI${m.model ? ` (${getModelLabel(m.model)})` : ""}`;
      lines.push(`---`, ``, `**${who}** · ${new Date(m.createdAt).toLocaleString()}`, ``, m.content, ``);
      if (m.attachments?.length) {
        lines.push(`_Attachments: ${m.attachments.map((a) => a.name).join(", ")}_`, ``);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(conversation.title || "conversation").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "conversation"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Rate an assistant message (thumbs up/down) — optimistic with rollback
  const handleRateMessage = async (messageId: string, rating: 1 | -1 | null) => {
    const previous = messages.find((m) => m.id === messageId)?.rating ?? null;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, rating } : m)));
    try {
      const res = await fetch(`/api/ai/messages/${messageId}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, rating: previous } : m)));
      toast.error("Failed to save feedback");
    }
  };

  // Why it was unhelpful — a follow-up to the flag, never a precondition for it.
  //
  // Sent as its own PATCH so the rating is already saved by the time the picker
  // appears: if the user skips it, closes the tab, or the request fails, the
  // flag still stands. Silent on success — a toast for a one-tap answer is
  // noise, and the click already gave its feedback by disappearing.
  const handleRateReason = async (messageId: string, reason: string) => {
    try {
      const res = await fetch(`/api/ai/messages/${messageId}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: -1, reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Deliberately quiet. The rating survived; only the reason was lost, and
      // telling the user their reason failed invites them to re-rate, which
      // would overwrite a flag that is already recorded.
      console.error("[Feedback] Reason not saved");
    }
  };

  // Change visibility (private ↔ team)
  const handleVisibilityChange = async (newVisibility: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      if (res.ok) {
        setConversation((prev) => prev ? { ...prev, visibility: newVisibility as any } : prev);
        onConversationUpdated?.({ ...conversation!, visibility: newVisibility } as AIConversation);
        toast.success(`Changed to ${newVisibility === "private" ? "Private" : "Team"}`);
      }
    } catch {
      toast.error("Failed to change visibility");
    }
  };

  // Change model mid-conversation
  const handleModelChange = async (newModelId: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModelId }),
      });
      if (res.ok) {
        setConversation((prev) => prev ? { ...prev, model: newModelId } : prev);
        onConversationUpdated?.({ ...conversation!, model: newModelId } as AIConversation);
        toast.success(`Switched to ${getModelLabel(newModelId)}`);
      }
    } catch {
      toast.error("Failed to change model");
    }
  };

  // Fact-check an assistant message using Claude with web search
  const handleFactCheck = async (messageId: string, messageContent: string) => {
    if (isFactChecking || isStreaming) return;

    setIsFactChecking(true);
    setStreamingContent("");

    // Find the user message that preceded this assistant message for context
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    const precedingUserMsg = messages
      .slice(0, msgIndex)
      .reverse()
      .find((m) => m.role === "user");

    try {
      const res = await fetch(
        `/api/ai/conversations/${conversationId}/fact-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId,
            messageContent,
            userQuestion: precedingUserMsg?.content || null,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start fact check");
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
            if (parsed.searching) {
              setIsSearchingWeb(true);
            } else if (parsed.token) {
              setIsSearchingWeb(false);
              fullText += parsed.token;
              setStreamingContent(fullText);
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      // Add the fact-check result as a new message
      if (fullText.trim()) {
        const factCheckMsg: AIMessageRow = {
          id: `factcheck-${Date.now()}`,
          conversationId,
          role: "assistant",
          content: fullText,
          model: "claude-sonnet-4-6",
          createdBy: null,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, factCheckMsg]);
      }
    } catch (err: any) {
      console.error("Fact check error:", err);
      toast.error(err?.message || "Fact check failed");
    } finally {
      setIsFactChecking(false);
      setIsSearchingWeb(false);
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

  // Dismiss drop overlay via Escape key or safety timeout
  useEffect(() => {
    if (!isDragging) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    // Safety timeout: auto-dismiss after 5s in case drag state gets stuck
    const timer = setTimeout(() => {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }, 5000);
    return () => {
      window.removeEventListener("keydown", handleEsc);
      clearTimeout(timer);
    };
  }, [isDragging]);

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
      className="engine-ai-scope flex flex-col flex-1 min-h-0 relative overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
    >
      {/* Full-panel drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => { dragCounterRef.current = 0; setIsDragging(false); }}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-foreground/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-5 w-5 text-foreground/50" />
          </button>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 text-[10px] px-1.5 h-4 rounded-full border border-border bg-background hover:bg-muted transition-colors font-medium">
                  {conversation.visibility === "private" ? (
                    <Lock className="h-2.5 w-2.5" />
                  ) : (
                    <Users className="h-2.5 w-2.5" />
                  )}
                  {conversation.visibility === "private" ? "Private" : "Team"}
                  <ChevronDown className="h-2 w-2" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem
                  onClick={() => handleVisibilityChange("private")}
                  className={cn("text-xs gap-2", conversation.visibility === "private" && "bg-muted font-medium")}
                >
                  <Lock className="h-3 w-3" />
                  <span className="flex-1">Private</span>
                  {conversation.visibility === "private" && <span className="text-primary text-xs">&#10003;</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleVisibilityChange("team")}
                  className={cn("text-xs gap-2", conversation.visibility === "team" && "bg-muted font-medium")}
                >
                  <Users className="h-3 w-3" />
                  <span className="flex-1">Team</span>
                  {conversation.visibility === "team" && <span className="text-primary text-xs">&#10003;</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {myPermission === "view" && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 gap-1 text-muted-foreground"
              >
                View only
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 text-[10px] px-1.5 h-4 rounded-full border border-border bg-background hover:bg-muted transition-colors font-medium">
                  {modelLabel}
                  <ChevronDown className="h-2 w-2" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {AI_MODELS.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => handleModelChange(m.id)}
                    className={cn(
                      "text-sm py-2",
                      conversation?.model === m.id && "bg-muted font-medium"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {m.id === "auto" && <Sparkles className="h-3 w-3 text-amber-500" />}
                        {m.label}
                      </div>
                      {"description" in m && m.description && (
                        <div className="text-[10px] text-muted-foreground font-normal">{m.description}</div>
                      )}
                    </div>
                    {conversation?.model === m.id && (
                      <span className="text-primary text-xs shrink-0">&#10003;</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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

        {/* Desktop customer dropdown with search + move confirmation */}
        {customers && customers.length > 0 && onCustomerChange && (
          <Popover onOpenChange={(open) => { if (!open) setClientSearchQuery(""); }}>
            <PopoverTrigger asChild>
              <button className="hidden lg:flex items-center gap-1 rounded-lg border bg-background hover:bg-muted px-2 py-1 text-[12px] transition-colors shrink-0">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[120px]">
                  {selectedCustomer?.name || "General"}
                </span>
                <ChevronsUpDown className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-[260px] p-0">
              <div className="flex items-center border-b px-3">
                <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  placeholder="Search clients..."
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
                {clientSearchQuery && (
                  <button onClick={() => setClientSearchQuery("")} className="ml-1 shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1">
                {!clientSearchQuery && (
                  <button
                    onClick={() => {
                      if (selectedCustomer) {
                        setMoveClientConfirm({ id: null, name: "General" });
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left",
                      !selectedCustomer && "bg-accent"
                    )}
                  >
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1">General</span>
                    {!selectedCustomer && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                )}
                {customers
                  .filter((c) => !clientSearchQuery || c.name.toLowerCase().includes(clientSearchQuery.toLowerCase()))
                  .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (selectedCustomer?.id !== c.id) {
                        setMoveClientConfirm({ id: c.id, name: c.name });
                      }
                    }}
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

        {/* Extra header controls injected by parent (e.g. theme toggle) */}
        {headerExtra}

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
            <DropdownMenuItem onClick={handleExportMarkdown} disabled={messages.length === 0}>
              <Download className="h-3.5 w-3.5 mr-2" />
              Export as Markdown
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

        {/* Move to client confirmation */}
        <AlertDialog open={!!moveClientConfirm} onOpenChange={(open) => { if (!open) setMoveClientConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                Move &ldquo;{conversation.title}&rdquo; to <strong>{moveClientConfirm?.name}</strong>? Future messages will use that client&apos;s context.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!moveClientConfirm) return;
                  const newId = moveClientConfirm.id;
                  try {
                    await fetch(`/api/ai/conversations/${conversationId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ customerId: newId }),
                    });
                    onCustomerChange?.(newId || "general");
                    setMoveClientConfirm(null);
                  } catch {
                    setMoveClientConfirm(null);
                  }
                }}
              >
                Move
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
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto relative">
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
          <div className="py-4 space-y-1 w-full max-w-[46rem] mx-auto">
            {messages.map((msg, idx) => {
              // Pending assistant rows render as a spinner block (below), not
              // an empty bubble. Failed rows render normally so the user sees
              // the error + retry affordance.
              if (msg.role === "assistant" && msg.status === "pending") return null;
              return (
                <MessageBubble
                  key={msg.id}
                  messageId={msg.id}
                  conversationId={conversationId}
                  conversationTitle={conversation?.title || null}
                  role={msg.role}
                  content={msg.content}
                  model={msg.model}
                  attachments={msg.attachments}
                  userName={msg.createdByName}
                  onImageComment={
                    // Viewers can look but not ask for changes — a comment
                    // sends a message, and that is an edit of the thread.
                    msg.role === "assistant" && myPermission !== "view" ? sendImageComment : undefined
                  }
                  onFactCheck={
                    msg.role === "assistant" && !isStreaming && !isFactChecking && myPermission !== "view" && !msg.content.includes("## 🔍 Fact Check") && msg.status !== "failed"
                      ? () => handleFactCheck(msg.id, msg.content)
                      : undefined
                  }
                  onRetry={
                    msg.role === "assistant" && !isStreaming && !isFactChecking && myPermission !== "view" && idx === messages.length - 1
                      ? () => handleRetry(idx)
                      : undefined
                  }
                  onEdit={
                    msg.role === "user" && !isStreaming && !isFactChecking && myPermission !== "view"
                      ? (newContent: string) => handleEditMessage(idx, newContent)
                      : undefined
                  }
                  rating={msg.rating ?? null}
                  onRate={
                    msg.role === "assistant" && !msg.id.startsWith("temp-") && !msg.id.startsWith("factcheck-") && !msg.id.startsWith("assistant-")
                      ? (rating) => handleRateMessage(msg.id, rating)
                      : undefined
                  }
                  onRateReason={
                    msg.role === "assistant" && !msg.id.startsWith("temp-") && !msg.id.startsWith("factcheck-") && !msg.id.startsWith("assistant-")
                      ? (reason) => handleRateReason(msg.id, reason)
                      : undefined
                  }
                  workspaceId={conversation?.workspaceId ?? null}
                  onMakeRecurring={
                    msg.role === "assistant" && onMakeRecurring && !isStreaming && msg.status !== "failed" && !msg.id.startsWith("factcheck-") && !msg.content.includes("## 🔍 Fact Check")
                      ? () => {
                          const prior = messages.slice(0, idx).filter((m) => m.role === "user").pop();
                          const promptText = (prior?.content || "").trim();
                          if (!promptText) { toast.error("Couldn't find the prompt behind this answer"); return; }
                          onMakeRecurring({
                            title: promptText.replace(/\s+/g, " ").slice(0, 60),
                            prompt: promptText,
                          });
                        }
                      : undefined
                  }
                />
              );
            })}
            {pendingAssistantId && !isStreaming && !isFactChecking && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Still generating… (picking up where you left off)</span>
                </div>
              </div>
            )}
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
            {isStreaming && !isSearchingWeb && !isGeneratingImage && !isGeneratingDocument && !isQueryingEngine && !isSearchingMemory && !streamingContent && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}
            {(isStreaming || isFactChecking) && isSearchingWeb && !streamingContent && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  {isFactChecking ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                  ) : (
                    <Globe className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">
                    {isFactChecking ? "Fact-checking with Claude…" : "Searching the web…"}
                  </span>
                </div>
              </div>
            )}
            {isFactChecking && !isSearchingWeb && !streamingContent && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Fact-checking with Claude…</span>
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
            {isStreaming && isGeneratingDocument && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Generating presentation…</span>
                </div>
              </div>
            )}
            {isStreaming && isQueryingEngine && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <Database className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Querying the Engine…</span>
                </div>
              </div>
            )}
            {isStreaming && isSearchingMemory && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <BrainCircuit className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Searching memories…</span>
                </div>
              </div>
            )}
            {(isStreaming || isFactChecking) && streamingContent && (
              <MessageBubble
                role="assistant"
                content={streamingContent}
                onImageComment={sendImageComment}
                model={isFactChecking ? "claude-sonnet-4-6" : conversation.model}
                isStreaming
                workspaceId={conversation?.workspaceId ?? null}
              />
            )}
            {slidesDraft && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <SlideDraftPreview
                  draft={slidesDraft}
                  publishing={publishingSlides}
                  onPublish={publishSlidesDraft}
                  onSlideComment={(i, text) =>
                    sendSlideComment(slidesDraft.title, i, (slidesDraft.slides?.[i] as any)?.title, text)
                  }
                  onEdit={applyDraftEdit}
                />
              </div>
            )}
            {slidesPreview && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 rounded-lg border bg-muted/30 px-3 py-3">
                  <div className="flex items-center justify-between gap-3 mb-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{slidesPreview.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {slidesPreview.updated ? "Updated in place" : "New deck"}
                        {slidesPreview.slideCount ? ` · ${slidesPreview.slideCount} slides` : ""}
                      </p>
                    </div>
                    <a href={slidesPreview.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <Button size="sm" variant="outline">Open in Slides</Button>
                    </a>
                  </div>
                  {slidesPreview.thumbnails.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {slidesPreview.thumbnails.map((src, i) => (
                        <button key={src} type="button" onClick={() => setSlidesZoom(i)}
                                aria-label={`Slide ${i + 1}`}
                                className="block rounded border overflow-hidden cursor-zoom-in hover:ring-2 hover:ring-primary/40 transition-shadow">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={`Slide ${i + 1}`} className="w-full h-auto block" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Preview unavailable — the deck itself is fine, open it above.
                    </p>
                  )}
                  {slidesPreview.thumbnails.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2.5">Click a slide to read it full size.</p>
                  )}
                </div>
              </div>
            )}
            {slidesPreview && slidesZoom !== null && (
              <SlideLightbox
                index={slidesZoom}
                count={slidesPreview.thumbnails.length}
                onClose={() => setSlidesZoom(null)}
                onIndex={setSlidesZoom}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slidesPreview.thumbnails[slidesZoom]}
                  alt={`Slide ${slidesZoom + 1}`}
                  className="block rounded shadow-2xl"
                  style={{ maxWidth: "min(1100px, calc(100vw - 140px))", maxHeight: "calc(100vh - 180px)" }}
                />
              </SlideLightbox>
            )}
            {slidesReauth && (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="h-7 w-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0 mt-0.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 rounded-lg border bg-muted/40 px-3 py-2.5">
                  <p className="text-sm text-foreground/90">{slidesReauth.message}</p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button size="sm" onClick={reconnectGoogle} disabled={reauthBusy}>
                      {reauthBusy ? "Waiting for Google…" : slidesReauth.reason === "not_connected" ? "Connect Google" : "Reconnect Google"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSlidesReauth(null)} disabled={reauthBusy}>
                      Not now
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
        {/* Scroll to bottom button */}
        {userScrolledUp && (
          <button
            onClick={() => {
              setUserScrolledUp(false);
              scrollToBottom();
            }}
            className="absolute bottom-20 right-4 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-background border border-border shadow-md hover:bg-muted transition-colors"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="border-t bg-background">
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          disabled={isStreaming || isFactChecking || myPermission === "view"}
          endSlot={inputEndSlot}
          bottomSlot={
            <>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-muted/50 transition-colors">
                  {conversation?.model === "auto" && <Sparkles className="h-2.5 w-2.5 text-amber-500" />}
                  <span className="hidden sm:inline">{getModelLabel(conversation?.model || "auto")}</span>
                  <ChevronDown className="h-2 w-2" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                {AI_MODELS.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => handleModelChange(m.id)}
                    className={cn(
                      "text-xs py-1.5",
                      conversation?.model === m.id && "bg-muted font-medium"
                    )}
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {m.id === "auto" && <Sparkles className="h-3 w-3 text-amber-500 shrink-0" />}
                      <span>{m.label}</span>
                      <span className="text-muted-foreground/50 text-[9px] truncate">— {m.description}</span>
                    </div>
                    {conversation?.model === m.id && (
                      <span className="text-primary text-xs shrink-0">&#10003;</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            </>
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
