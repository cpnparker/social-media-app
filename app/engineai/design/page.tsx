"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { ArrowLeft, Plus, Sparkles, BadgeCheck } from "lucide-react";
import { DesignChat, type DesignMessage } from "@/components/design-mode/DesignChat";
import { Canvas } from "@/components/design-mode/Canvas";
import { ArtlistBrowser } from "@/components/design-mode/ArtlistBrowser";
import type { DesignAsset } from "@/components/design-mode/AssetTile";

export default function DesignModePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const customerCtx = useCustomerSafe();
  const customer = customerCtx?.selectedCustomer;

  const [conversationId, setConversationId] = useState<string | null>(searchParams.get("thread"));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DesignMessage[]>([]);
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [activeTab, setActiveTab] = useState<"canvas" | "library">("canvas");
  const [animatePrompt, setAnimatePrompt] = useState<string | undefined>();

  // Auto-create a design session on first load if none exists.
  const createSession = useCallback(async () => {
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
          visibility: "private",
          customerId: customer?.id ?? undefined,
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
      const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
      router.replace(`${currentPath}?thread=${json.conversation.id}`);
    } catch (err: any) {
      const msg = err?.message || String(err) || "Unknown error";
      console.error("Failed to create design session:", msg);
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }, [workspaceId, customer?.id, router]);

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
  }, []);

  const newSession = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch("/api/ai/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, mode: "design", visibility: "private", customerId: customer?.id ?? undefined }),
    });
    const json = await res.json();
    setConversationId(json.conversation.id);
    setMessages([]);
    setAssets([]);
    setAnimatePrompt(undefined);
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
    router.replace(`${currentPath}?thread=${json.conversation.id}`);
  }, [workspaceId, customer?.id, router]);

  const brandBadge = useMemo(() => {
    if (!customer) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <BadgeCheck className="h-3 w-3" />
        Brand: {customer.name}
      </span>
    );
  }, [customer]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-4 py-2">
        <button
          onClick={() => router.push("/engineai")}
          className="rounded p-1 hover:bg-muted"
          aria-label="Back to EngineAI"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">Design</h1>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            Beta
          </span>
        </div>
        {brandBadge}
        <div className="flex-1" />
        <button
          onClick={newSession}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> New session
        </button>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat */}
        <div className="flex w-[35%] min-w-[320px] flex-col border-r">
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
              <div className="text-sm font-medium text-destructive">Couldn&apos;t start a design session</div>
              <div className="max-w-md whitespace-pre-wrap break-words rounded border bg-muted p-3 text-left text-xs text-muted-foreground">
                {createError}
              </div>
              <button
                onClick={() => { setCreateError(null); createSession(); }}
                className="rounded border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {creating ? "Starting your design session…" : !workspaceId ? "Pick a workspace to begin." : "Loading…"}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Canvas</div>
            <div className="text-[11px] text-muted-foreground">{assets.length} {assets.length === 1 ? "asset" : "assets"}</div>
          </div>
          <Canvas
            assets={assets}
            onAnimate={onAnimate}
            onPin={onPin}
            onArchive={onArchive}
            className="flex-1"
          />
        </div>

        {/* Library */}
        <div className="flex w-[22%] min-w-[260px] flex-col border-l">
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
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-medium ${active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
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

  if (loading) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>;
  if (items.length === 0) return <div className="p-4 text-xs text-muted-foreground">No past assets yet.</div>;

  return (
    <div className="space-y-1.5">
      {items.map((a) => (
        <button
          key={a.id_asset}
          onClick={() => onAdd(a)}
          className="flex w-full gap-2 rounded border p-1.5 text-left hover:border-primary"
        >
          {a.type_asset === "video" || a.type_asset === "artlist_video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={a.blob_url} className="h-12 w-16 flex-shrink-0 rounded object-cover" muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.blob_url} alt="" className="h-12 w-16 flex-shrink-0 rounded object-cover" loading="lazy" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs">{a.prompt || a.metadata?.title || a.source}</div>
            <div className="text-[10px] text-muted-foreground">{a.source} · {new Date(a.date_created).toLocaleDateString()}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
