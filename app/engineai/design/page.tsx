"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { ArrowLeft, Plus, Sparkles, BadgeCheck, FileText, Lock, Users, EyeOff, ChevronDown, History } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DesignChat, type DesignMessage } from "@/components/design-mode/DesignChat";
import { Canvas } from "@/components/design-mode/Canvas";
import { ArtlistBrowser } from "@/components/design-mode/ArtlistBrowser";
import { AssetDrawer } from "@/components/design-mode/AssetDrawer";
import type { DesignAsset } from "@/components/design-mode/AssetTile";

interface ContentScope {
  id: number;
  workingTitle: string | null;
  contentType: string | null;
}

interface DesignSession {
  id: string;
  title: string;
  visibility: "private" | "team";
  isIncognito?: boolean;
  customerName?: string | null;
  customerId?: string | null;
  contentId?: number | null;
  updatedAt: string;
  myPermission?: "owner" | "view" | "collaborate";
  sharedWithMe?: boolean;
}

type ConversationMeta = {
  visibility: "private" | "team";
  isIncognito: boolean;
  myPermission: "owner" | "view" | "collaborate";
};

export default function DesignModePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const customerCtx = useCustomerSafe();
  const customer = customerCtx?.selectedCustomer;

  const contentIdParam = searchParams.get("content");
  const contentId = contentIdParam ? parseInt(contentIdParam, 10) : null;

  const [conversationId, setConversationId] = useState<string | null>(searchParams.get("thread"));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DesignMessage[]>([]);
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [activeTab, setActiveTab] = useState<"canvas" | "library">("canvas");
  const [animatePrompt, setAnimatePrompt] = useState<string | undefined>();
  const [contentScope, setContentScope] = useState<ContentScope | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<DesignAsset | null>(null);
  const [conversationMeta, setConversationMeta] = useState<ConversationMeta | null>(null);
  const [sessions, setSessions] = useState<DesignSession[] | null>(null);

  // Fetch content metadata when scoped to a content piece.
  useEffect(() => {
    if (!contentId || !workspaceId) { setContentScope(null); return; }
    fetch(`/api/content-objects/${contentId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((j) => {
        const c = j?.contentObject;
        if (c) setContentScope({ id: contentId, workingTitle: c.workingTitle || null, contentType: c.contentType || null });
      })
      .catch(() => { /* non-fatal — designer can still work without the title */ });
  }, [contentId, workspaceId]);

  // Auto-create a design session on first load if none exists.
  const createSession = useCallback(async (opts: { isIncognito?: boolean; visibility?: "private" | "team" } = {}) => {
    if (!workspaceId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          mode: "design",
          visibility: opts.visibility ?? "private",
          isIncognito: opts.isIncognito ?? false,
          customerId: customer?.id ?? undefined,
          contentObjectId: contentId ?? undefined,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = JSON.parse(text);
      if (!json?.conversation?.id) {
        throw new Error(`Unexpected response shape: ${text.slice(0, 200)}`);
      }
      setConversationId(json.conversation.id);
      setConversationMeta({
        visibility: (json.conversation.visibility as "private" | "team") || "private",
        isIncognito: !!json.conversation.isIncognito,
        myPermission: "owner",
      });
      const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
      const contentQs = contentId ? `&content=${contentId}` : "";
      router.replace(`${currentPath}?thread=${json.conversation.id}${contentQs}`);
    } catch (err: any) {
      const msg = err?.message || String(err) || "Unknown error";
      console.error("Failed to create design session:", msg);
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }, [workspaceId, customer?.id, router, contentId]);

  // Load existing conversation's metadata (visibility, incognito, my permission).
  useEffect(() => {
    if (!conversationId) { setConversationMeta(null); return; }
    fetch(`/api/ai/conversations/${conversationId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((j) => {
        const c = j?.conversation;
        if (c) setConversationMeta({
          visibility: c.visibility,
          isIncognito: !!c.isIncognito,
          myPermission: c.myPermission || "owner",
        });
      })
      .catch(() => { /* non-fatal */ });
  }, [conversationId]);

  // Load past design sessions for the workspace (respects privacy server-side).
  const loadSessions = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/ai/conversations?workspaceId=${workspaceId}&mode=design&limit=50`);
      if (!res.ok) return;
      const j = await res.json();
      setSessions((j.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.title || "Untitled session",
        visibility: c.visibility,
        isIncognito: !!c.isIncognito,
        customerName: c.customerName,
        customerId: c.customerId,
        contentId: c.contentObjectId ?? null,
        updatedAt: c.updatedAt,
        myPermission: c.myPermission,
        sharedWithMe: c.sharedWithMe,
      })));
    } catch { /* non-fatal */ }
  }, [workspaceId]);

  const handleVisibilityChange = useCallback(async (next: "private" | "team") => {
    if (!conversationId || !conversationMeta) return;
    if (conversationMeta.myPermission !== "owner") {
      toast.error("Only the owner can change visibility");
      return;
    }
    if (conversationMeta.isIncognito) {
      toast.error("Incognito sessions can't be shared");
      return;
    }
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (res.ok) {
        setConversationMeta((m) => m ? { ...m, visibility: next } : m);
        toast.success(`Changed to ${next === "private" ? "Private" : "Team"}`);
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error || "Failed to change visibility");
      }
    } catch {
      toast.error("Failed to change visibility");
    }
  }, [conversationId, conversationMeta]);

  useEffect(() => {
    if (conversationId || !workspaceId || creating || createError) return;
    createSession();
  }, [conversationId, workspaceId, creating, createError, createSession]);

  // Load existing assets when the conversation is set.
  useEffect(() => {
    if (!conversationId || !workspaceId) return;
    fetch(`/api/ai/design/assets?workspaceId=${workspaceId}&conversationId=${conversationId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((j) => setAssets(j.assets || []))
      .catch(() => { /* non-fatal */ });
  }, [conversationId, workspaceId]);

  const onAssetReady = useCallback((asset: DesignAsset) => {
    setAssets((prev) => {
      // Drop any pending placeholder matching this type
      const cleaned = prev.filter((a) => !(a.pending && a.type_asset === asset.type_asset));
      return [asset, ...cleaned];
    });
  }, []);

  const onAssetPending = useCallback((placeholder: DesignAsset) => {
    setAssets((prev) => [placeholder, ...prev]);
  }, []);

  const onAssetProgress = useCallback((id: string, progress: number) => {
    setAssets((prev) => prev.map((a) => (a.id_asset === id ? { ...a, progress } : a)));
  }, []);

  const onPin = useCallback(async (asset: DesignAsset) => {
    const newPinned = asset.flag_pinned ? 0 : 1;
    setAssets((prev) => prev.map((a) => (a.id_asset === asset.id_asset ? { ...a, flag_pinned: newPinned } : a)));
    if (!asset.id_asset.startsWith("local-") && !asset.id_asset.startsWith("pending-")) {
      await fetch("/api/ai/design/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_asset: asset.id_asset, flag_pinned: newPinned }),
      });
    }
  }, []);

  const onArchive = useCallback(async (asset: DesignAsset) => {
    setAssets((prev) => prev.filter((a) => a.id_asset !== asset.id_asset));
    if (!asset.id_asset.startsWith("local-") && !asset.id_asset.startsWith("pending-")) {
      await fetch("/api/ai/design/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_asset: asset.id_asset, flag_archived: 1 }),
      });
    }
  }, []);

  const onAnimate = useCallback((asset: DesignAsset) => {
    // Pre-fill the chat with a motion brief that references the asset's URL,
    // so the AI calls generate_video with image_url set.
    const prompt = `Animate this image with a slow cinematic camera push and natural ambient motion. Use the existing scene as-is. Source image: ${asset.blob_url}`;
    setAnimatePrompt(prompt);
    setSelectedAsset(null);
  }, []);

  const onRegenerate = useCallback((asset: DesignAsset) => {
    // Pre-fill chat with the original prompt + a "try variations" instruction.
    const base = asset.prompt || "this asset";
    setAnimatePrompt(
      asset.type_asset === "image"
        ? `Generate 3 variations of: ${base}\nKeep the same brand context and composition; vary the lighting, mood, or angle.`
        : `Regenerate this video with the same brief but try a different motion: ${base}`
    );
    setSelectedAsset(null);
  }, []);

  const attachAssetToContent = useCallback(async (asset: DesignAsset): Promise<void> => {
    if (!contentScope) return;
    const res = await fetch("/api/ai/design/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_asset: asset.id_asset, id_content: contentScope.id }),
    });
    if (!res.ok) throw new Error(`Attach failed: ${res.status}`);
    setAssets((prev) => prev.map((a) =>
      a.id_asset === asset.id_asset ? ({ ...a, ...(({ id_content: contentScope.id } as unknown) as Partial<DesignAsset>) }) : a
    ));
  }, [contentScope]);

  const newSession = useCallback(async (opts: { isIncognito?: boolean } = {}) => {
    if (!workspaceId) return;
    const res = await fetch("/api/ai/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        mode: "design",
        visibility: "private",
        isIncognito: opts.isIncognito ?? false,
        customerId: customer?.id ?? undefined,
        contentObjectId: contentId ?? undefined,
      }),
    });
    const json = await res.json();
    setConversationId(json.conversation.id);
    setConversationMeta({
      visibility: "private",
      isIncognito: !!opts.isIncognito,
      myPermission: "owner",
    });
    setMessages([]);
    setAssets([]);
    setAnimatePrompt(undefined);
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
    const contentQs = contentId ? `&content=${contentId}` : "";
    router.replace(`${currentPath}?thread=${json.conversation.id}${contentQs}`);
    loadSessions();
  }, [workspaceId, customer?.id, router, contentId, loadSessions]);

  const switchSession = useCallback((sessionId: string) => {
    setConversationId(sessionId);
    setMessages([]);
    setAssets([]);
    setAnimatePrompt(undefined);
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
    const contentQs = contentId ? `&content=${contentId}` : "";
    router.replace(`${currentPath}?thread=${sessionId}${contentQs}`);
  }, [router, contentId]);

  const brandBadge = useMemo(() => {
    if (!customer) return null;
    return (
      <span className="pill pill-success">
        <BadgeCheck className="h-3 w-3" />
        {customer.name}
      </span>
    );
  }, [customer]);

  const contentBadge = useMemo(() => {
    if (!contentScope) return null;
    const label = contentScope.workingTitle || `Content #${contentScope.id}`;
    const trimmed = label.length > 36 ? label.slice(0, 34) + "…" : label;
    return (
      <Link
        href={`/content/${contentScope.id}`}
        className="pill pill-accent hover:opacity-80"
        title={`Designing for: ${label}`}
      >
        <FileText className="h-3 w-3" />
        {contentScope.contentType ? `${contentScope.contentType}: ` : ""}{trimmed}
      </Link>
    );
  }, [contentScope]);

  return (
    <div className="design-mode flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-5 py-3">
        <button
          onClick={() => router.push("/engineai")}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-[hsl(var(--design-border))]/30 hover:text-foreground"
          aria-label="Back to EngineAI"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-baseline gap-2">
          <h1 className="editorial-display text-xl tracking-tight">Design</h1>
          <span className="section-label">Studio</span>
        </div>
        {contentBadge}
        {brandBadge}

        {/* Visibility badge / dropdown — only when a session is loaded */}
        {conversationId && conversationMeta && !conversationMeta.isIncognito && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "pill",
                  conversationMeta.visibility === "private" ? "pill-neutral" : "pill-runway",
                  conversationMeta.myPermission !== "owner" && "opacity-70 cursor-default",
                )}
                disabled={conversationMeta.myPermission !== "owner"}
              >
                {conversationMeta.visibility === "private" ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                {conversationMeta.visibility === "private" ? "Private" : "Team"}
                {conversationMeta.myPermission === "owner" && <ChevronDown className="h-2.5 w-2.5" />}
              </button>
            </DropdownMenuTrigger>
            {conversationMeta.myPermission === "owner" && (
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem
                  onClick={() => handleVisibilityChange("private")}
                  className={cn("text-xs gap-2", conversationMeta.visibility === "private" && "bg-muted font-medium")}
                >
                  <Lock className="h-3 w-3" />
                  <span className="flex-1">Private</span>
                  {conversationMeta.visibility === "private" && <span className="text-primary text-xs">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleVisibilityChange("team")}
                  className={cn("text-xs gap-2", conversationMeta.visibility === "team" && "bg-muted font-medium")}
                >
                  <Users className="h-3 w-3" />
                  <span className="flex-1">Team</span>
                  {conversationMeta.visibility === "team" && <span className="text-primary text-xs">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        )}

        {/* Incognito badge */}
        {conversationMeta?.isIncognito && (
          <span className="pill pill-warning">
            <EyeOff className="h-3 w-3" />
            Incognito
          </span>
        )}

        {/* View-only badge */}
        {conversationMeta && conversationMeta.myPermission === "view" && (
          <span className="pill pill-neutral">View only</span>
        )}

        <div className="flex-1" />

        {/* Past sessions */}
        <DropdownMenu onOpenChange={(open) => open && loadSessions()}>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-xs font-medium hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/50">
              <History className="h-3.5 w-3.5" /> Sessions
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">Recent design sessions</DropdownMenuLabel>
            <div className="max-h-96 overflow-y-auto">
              {sessions === null ? (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">Loading…</DropdownMenuItem>
              ) : sessions.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">No past sessions in this workspace.</DropdownMenuItem>
              ) : (
                sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => switchSession(s.id)}
                    className={cn("flex flex-col items-start gap-0.5 text-xs", s.id === conversationId && "bg-muted")}
                  >
                    <div className="flex w-full items-center gap-1.5">
                      {s.isIncognito ? <EyeOff className="h-2.5 w-2.5 text-amber-600" /> :
                        s.visibility === "team" ? <Users className="h-2.5 w-2.5 text-purple-600" /> :
                        <Lock className="h-2.5 w-2.5 text-zinc-500" />}
                      <span className="flex-1 truncate font-medium">{s.title}</span>
                      {s.sharedWithMe && <span className="text-[9px] text-muted-foreground">shared</span>}
                    </div>
                    <div className="flex w-full items-center gap-1 text-[10px] text-muted-foreground">
                      {s.customerName && <span>{s.customerName}</span>}
                      {s.customerName && s.updatedAt && <span>·</span>}
                      {s.updatedAt && <span>{new Date(s.updatedAt).toLocaleDateString()}</span>}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* New session menu (Plus button with dropdown for incognito option) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--design-accent))] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90">
              <Plus className="h-3.5 w-3.5" /> New session
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => newSession()} className="gap-2 text-xs">
              <Lock className="h-3 w-3" />
              <span className="flex-1">New session</span>
              <span className="text-[10px] text-muted-foreground">private</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => newSession({ isIncognito: true })} className="gap-2 text-xs">
              <EyeOff className="h-3 w-3 text-amber-600" />
              <span className="flex-1">New incognito session</span>
              <span className="text-[10px] text-muted-foreground">no save</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
              Incognito sessions don&apos;t save messages or canvas assets. You can still generate and download, but nothing is persisted.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden bg-[hsl(var(--design-bg))]">
        {/* Chat */}
        <div className="flex w-[35%] min-w-[320px] flex-col border-r border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))]">
          {conversationId ? (
            <DesignChat
              conversationId={conversationId}
              messages={messages}
              setMessages={setMessages}
              onAssetReady={onAssetReady}
              onAssetPending={onAssetPending}
              onAssetProgress={onAssetProgress}
              initialInput={animatePrompt}
            />
          ) : createError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <h3 className="editorial-display text-xl text-[hsl(var(--design-danger))]">Couldn&apos;t start a design session</h3>
              <div className="design-card max-w-md p-3 text-left text-[11.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                {createError}
              </div>
              <button
                onClick={() => { setCreateError(null); createSession(); }}
                className="rounded-full bg-[hsl(var(--design-accent))] px-4 py-1.5 text-[12px] font-medium text-white shadow-sm hover:opacity-90"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              {creating ? (
                <>
                  <Sparkles className="h-5 w-5 animate-pulse text-[hsl(var(--design-accent))]" />
                  <span className="text-[12px]">Starting your design session…</span>
                </>
              ) : !workspaceId ? (
                <span className="text-[12px]">Pick a workspace to begin.</span>
              ) : (
                <span className="text-[12px]">Loading…</span>
              )}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))]/50 px-5 py-2.5">
            <div className="flex items-baseline gap-3">
              <div className="section-label">Canvas</div>
              <div className="editorial-numeric text-2xl text-foreground">{assets.length}</div>
              <div className="text-[11px] text-muted-foreground">{assets.length === 1 ? "asset" : "assets"} in session</div>
            </div>
          </div>
          <Canvas
            assets={assets}
            onAnimate={onAnimate}
            onPin={onPin}
            onArchive={onArchive}
            onSelect={setSelectedAsset}
            className="flex-1"
          />
        </div>

        {/* Library */}
        <div className="flex w-[22%] min-w-[260px] flex-col border-l border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))]">
          <div className="flex border-b">
            <TabButton active={activeTab === "library"} onClick={() => setActiveTab("library")}>Artlist</TabButton>
            <TabButton active={activeTab === "canvas"} onClick={() => setActiveTab("canvas")}>Past assets</TabButton>
          </div>
          {activeTab === "library" ? (
            <ArtlistBrowser
              onLicense={(item) => {
                // Send a chat message asking the AI to license this clip.
                // The AI will call license_artlist_asset which fetches/mirrors/persists.
                setAnimatePrompt(
                  `License Artlist clip "${item.title}" (asset_id: ${item.id}) and add it to the canvas. Surface the license terms in your reply.`
                );
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              <PastAssets workspaceId={workspaceId} clientId={customer?.id} onAdd={(a) => setAssets((prev) => prev.find((x) => x.id_asset === a.id_asset) ? prev : [a, ...prev])} />
            </div>
          )}
        </div>
      </div>

      {/* Asset detail drawer */}
      <AssetDrawer
        asset={selectedAsset}
        contentScopeId={contentScope?.id ?? null}
        contentScopeTitle={contentScope?.workingTitle ?? null}
        onClose={() => setSelectedAsset(null)}
        onPin={(a) => onPin(a)}
        onArchive={(a) => { onArchive(a); setSelectedAsset(null); }}
        onAnimate={onAnimate}
        onRegenerate={onRegenerate}
        onAttachToContent={contentScope ? attachAssetToContent : undefined}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
        active ? "border-b-2 border-[hsl(var(--design-accent))] text-[hsl(var(--design-accent))]" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PastAssets({ workspaceId, clientId, onAdd }: { workspaceId?: string; clientId?: string | number | null; onAdd: (a: DesignAsset) => void }) {
  const [items, setItems] = useState<DesignAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    const url = clientId
      ? `/api/ai/design/assets?workspaceId=${workspaceId}&clientId=${clientId}&limit=50`
      : `/api/ai/design/assets?workspaceId=${workspaceId}&limit=50`;
    fetch(url)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((j) => setItems(j.assets || []))
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, [workspaceId, clientId]);

  if (loading) return <div className="p-4 text-[11px] text-muted-foreground">Loading…</div>;
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
        <div className="text-[12px] font-medium text-muted-foreground">No past assets yet</div>
        <div className="text-[11px] text-muted-foreground/80">Generated and licensed assets from earlier sessions will appear here.</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((a) => (
        <button
          key={a.id_asset}
          onClick={() => onAdd(a)}
          className="design-card design-tile flex w-full gap-2 p-2 text-left hover:border-[hsl(var(--design-accent))]/40"
        >
          {a.type_asset === "video" || a.type_asset === "artlist_video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={a.blob_url} className="h-12 w-16 flex-shrink-0 rounded object-cover" muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.blob_url} alt="" className="h-12 w-16 flex-shrink-0 rounded object-cover" loading="lazy" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium leading-tight">{a.prompt || a.metadata?.title || a.source}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="capitalize">{a.source}</span>
              <span>·</span>
              <span>{new Date(a.date_created).toLocaleDateString()}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
