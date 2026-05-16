"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { toast } from "sonner";

import { LeftNavRail } from "@/components/design-mode/shell/LeftNavRail";
import { Header } from "@/components/design-mode/shell/Header";
import { BrandKitRail } from "@/components/design-mode/brand-kit/BrandKitRail";
import { CanvasStage } from "@/components/design-mode/canvas/CanvasStage";
import { Timeline } from "@/components/design-mode/timeline/Timeline";
import { AIRailWrapper } from "@/components/design-mode/ai-rail/AIRailWrapper";
import { PublishSheet } from "@/components/design-mode/publish/PublishSheet";
import { OnboardingHint } from "@/components/design-mode/OnboardingHint";

import type { DesignSessionFull, DesignShot } from "@/lib/design/types";

interface SessionSummary {
  id: string;
  name: string;
  visibility: "private" | "team";
  isIncognito: boolean;
  clientName?: string | null;
  updatedAt: string;
  myPermission: "owner" | "view" | "collaborate" | null;
  sharedWithMe?: boolean;
}

export default function DesignModePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;
  const customerCtx = useCustomerSafe();
  const customer = customerCtx?.selectedCustomer;

  const sessionIdFromUrl = searchParams.get("session");
  const contentIdParam = searchParams.get("content");
  const contentIdFromUrl = contentIdParam ? parseInt(contentIdParam, 10) : null;

  const [sessionId, setSessionId] = useState<string | null>(sessionIdFromUrl);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [data, setData] = useState<DesignSessionFull | null>(null);
  const [currentShotId, setCurrentShotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activeFormat, setActiveFormat] = useState("16:9");
  const [generating, setGenerating] = useState(false);
  const [animating, setAnimating] = useState(false);

  // ── auto-create session on first visit ────────────────────────────────────
  const createSession = useCallback(async (opts: { isIncognito?: boolean; visibility?: "private" | "team" } = {}) => {
    if (!workspaceId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/design/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId: customer?.id ? Number(customer.id) : undefined,
          contentId: contentIdFromUrl ?? undefined,
          visibility: opts.visibility ?? "private",
          isIncognito: opts.isIncognito ?? false,
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const json = JSON.parse(text);
      if (!json?.session?.id) throw new Error("Unexpected response shape");
      setSessionId(json.session.id);
      const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
      const contentQs = contentIdFromUrl ? `&content=${contentIdFromUrl}` : "";
      router.replace(`${currentPath}?session=${json.session.id}${contentQs}`);
    } catch (err: any) {
      console.error("Failed to create session:", err);
      setCreateError(err?.message || "Unknown error");
    } finally {
      setCreating(false);
    }
  }, [workspaceId, customer?.id, contentIdFromUrl, router]);

  useEffect(() => {
    if (sessionId || !workspaceId || creating || createError) return;
    createSession();
  }, [sessionId, workspaceId, creating, createError, createSession]);

  // ── load session data ─────────────────────────────────────────────────────
  const refreshSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/design/sessions/${sessionId}`);
      if (!res.ok) return;
      const j = (await res.json()) as DesignSessionFull;
      setData(j);
      if (!currentShotId && j.session.currentShotId) {
        setCurrentShotId(j.session.currentShotId);
      } else if (!currentShotId && j.shots.length > 0) {
        setCurrentShotId(j.shots[0].id);
      }
    } catch { /* non-fatal */ }
  }, [sessionId, currentShotId]);

  useEffect(() => { refreshSession(); }, [refreshSession]);

  // ── sessions list (header dropdown) ───────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/design/sessions?workspaceId=${workspaceId}&limit=50`);
      if (!res.ok) return;
      const j = await res.json();
      setSessions((j.sessions || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        visibility: s.visibility,
        isIncognito: s.isIncognito,
        clientName: s.clientName,
        updatedAt: s.updatedAt,
        myPermission: s.myPermission,
        sharedWithMe: s.sharedWithMe,
      })));
    } catch { /* non-fatal */ }
  }, [workspaceId]);

  // ── derived state ─────────────────────────────────────────────────────────
  const currentShot: DesignShot | null = useMemo(() => {
    if (!data) return null;
    return data.shots.find((s) => s.id === currentShotId) || data.shots[0] || null;
  }, [data, currentShotId]);

  const totalDuration = useMemo(
    () => (data?.shots || []).reduce((sum, s) => sum + s.duration, 0),
    [data?.shots],
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  const handleVisibilityChange = useCallback(async (next: "private" | "team") => {
    if (!sessionId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    if (res.ok) {
      toast.success(`Changed to ${next === "private" ? "Private" : "Team"}`);
      refreshSession();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error || "Failed to change visibility");
    }
  }, [sessionId, refreshSession]);

  const handleSelectShot = useCallback(async (shotId: string) => {
    setCurrentShotId(shotId);
    if (!sessionId) return;
    fetch(`/api/design/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentShotId: shotId }),
    }).catch(() => {});
  }, [sessionId]);

  const handleAddShot = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled shot", duration: 5.0, modelId: "runway-g4" }),
    });
    if (res.ok) {
      const j = await res.json();
      await refreshSession();
      if (j?.shot?.id) setCurrentShotId(j.shot.id);
      toast.success("Shot added");
    }
  }, [sessionId, refreshSession]);

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!sessionId || !currentShotId) return;
    await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    });
    refreshSession();
  }, [sessionId, currentShotId, refreshSession]);

  const handleCommit = useCallback(async () => {
    if (!sessionId || !currentShotId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}/commit`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success("Committed to timeline");
      refreshSession();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error || "Commit failed");
    }
  }, [sessionId, currentShotId, refreshSession]);

  const handleDeleteShot = useCallback(async (shotId: string) => {
    if (!sessionId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}/shots/${shotId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      // If we deleted the current shot, clear selection
      if (shotId === currentShotId) setCurrentShotId(null);
      toast.success("Shot removed");
      refreshSession();
    } else {
      toast.error("Couldn't remove shot");
    }
  }, [sessionId, currentShotId, refreshSession]);

  const handleShotTitleSave = useCallback(async (shotId: string, title: string) => {
    if (!sessionId) return;
    setData((prev) => prev ? {
      ...prev,
      shots: prev.shots.map((s) => s.id === shotId ? { ...s, title } : s),
    } : prev);
    await fetch(`/api/design/sessions/${sessionId}/shots/${shotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }, [sessionId]);

  const handleShotBeatSave = useCallback(async (shotId: string, beat: string | null) => {
    if (!sessionId) return;
    setData((prev) => prev ? {
      ...prev,
      shots: prev.shots.map((s) => s.id === shotId ? { ...s, beat } : s),
    } : prev);
    await fetch(`/api/design/sessions/${sessionId}/shots/${shotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beat }),
    });
  }, [sessionId]);

  const handleReorderShots = useCallback(async (orderedIds: string[]) => {
    if (!sessionId) return;
    // Optimistic: re-order in place, reassign idx
    setData((prev) => prev ? {
      ...prev,
      shots: orderedIds.map((id, i) => {
        const s = prev.shots.find((x) => x.id === id);
        return s ? { ...s, idx: i + 1 } : s!;
      }).filter(Boolean),
    } : prev);
    // Persist per-shot idx updates in parallel
    await Promise.all(orderedIds.map((id, i) =>
      fetch(`/api/design/sessions/${sessionId}/shots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idx: i + 1 }),
      })
    ));
  }, [sessionId]);

  const handleUploadReference = useCallback(async (file: File) => {
    if (!sessionId || !currentShotId) return;
    const form = new FormData();
    form.set("file", file);
    form.set("caption", file.name);
    const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}/refs`, {
      method: "POST",
      body: form,
    });
    if (res.ok) {
      toast.success("Reference added");
      refreshSession();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error || "Upload failed");
    }
  }, [sessionId, currentShotId, refreshSession]);

  const handleRemoveReference = useCallback(async (refId: string) => {
    if (!sessionId || !currentShotId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}/refs?refId=${refId}`, {
      method: "DELETE",
    });
    if (res.ok) refreshSession();
  }, [sessionId, currentShotId, refreshSession]);

  const handleAnimateImage = useCallback(async () => {
    if (!sessionId || !currentShotId || animating) return;
    setAnimating(true);
    try {
      const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}/animate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: 5, format: activeFormat === "9:16" ? "portrait" : activeFormat === "1:1" ? "square" : "landscape" }),
      });
      const text = await res.text();
      if (!res.ok) {
        const j = JSON.parse(text || "{}");
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = JSON.parse(text);
      toast.success(`Animated to S${(data?.shots.length || 0) + 1} (${j.durationSec}s)`);
      await refreshSession();
      if (j.shotId) setCurrentShotId(j.shotId);
    } catch (err: any) {
      toast.error(err?.message || "Animate failed");
    } finally {
      setAnimating(false);
    }
  }, [sessionId, currentShotId, animating, activeFormat, data?.shots.length, refreshSession]);

  const handleSelectVersion = useCallback(async (versionId: string) => {
    if (!sessionId || !currentShotId) return;
    // Optimistic
    setData((prev) => prev ? {
      ...prev,
      shots: prev.shots.map((s) => s.id === currentShotId ? { ...s, currentVersionId: versionId } : s),
    } : prev);
    fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentVersionId: versionId }),
    }).catch(() => refreshSession());
  }, [sessionId, currentShotId, refreshSession]);

  const handlePromptSave = useCallback(async (prompt: string) => {
    if (!sessionId || !currentShotId) return;
    // Optimistic UI update
    setData((prev) => prev ? {
      ...prev,
      shots: prev.shots.map((s) => s.id === currentShotId ? { ...s, prompt } : s),
    } : prev);
    const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      toast.error("Failed to save prompt");
      refreshSession();
    } else {
      toast.success("Prompt saved");
    }
  }, [sessionId, currentShotId, refreshSession]);

  const handleRegenerate = useCallback(async () => {
    if (!sessionId || !currentShotId || generating) return;
    setGenerating(true);
    // Optimistic: flip status pill to 'generating' immediately
    setData((prev) => prev ? {
      ...prev,
      shots: prev.shots.map((s) => s.id === currentShotId ? { ...s, status: "generating" } : s),
    } : prev);

    try {
      const res = await fetch(`/api/design/sessions/${sessionId}/shots/${currentShotId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: activeFormat === "9:16" ? "portrait" : activeFormat === "1:1" ? "square" : "landscape" }),
      });
      const text = await res.text();
      if (!res.ok) {
        const j = JSON.parse(text || "{}");
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = JSON.parse(text);
      toast.success(`Generated v${j.version.idx} (${j.version.metadata?.model_id || "model"})`);
      await refreshSession();
    } catch (err: any) {
      const msg = err?.message || "Generation failed";
      toast.error(msg);
      // Roll back the optimistic 'generating' status
      setData((prev) => prev ? {
        ...prev,
        shots: prev.shots.map((s) => s.id === currentShotId ? { ...s, status: "review" } : s),
      } : prev);
    } finally {
      setGenerating(false);
    }
  }, [sessionId, currentShotId, generating, activeFormat, refreshSession]);

  const handlePublish = useCallback(async (opts: { formats: string[]; caption: string }) => {
    if (!sessionId) return;
    const res = await fetch(`/api/design/sessions/${sessionId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formats: opts.formats.map((ratio) => ({ ratio })),
        caption: opts.caption,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      const j = JSON.parse(text || "{}");
      toast.error(j?.error || `Publish failed (${res.status})`);
      return;
    }
    const j = JSON.parse(text);
    toast.success(j.note || `Published ${j.publishedAssetCount} assets to the Engine`);
    setPublishOpen(false);
    refreshSession();
  }, [sessionId, refreshSession]);

  const switchSession = useCallback((id: string) => {
    setSessionId(id);
    setData(null);
    setCurrentShotId(null);
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "/engineai/design";
    const contentQs = contentIdFromUrl ? `&content=${contentIdFromUrl}` : "";
    router.replace(`${currentPath}?session=${id}${contentQs}`);
  }, [router, contentIdFromUrl]);

  // ── render ────────────────────────────────────────────────────────────────
  if (createError) {
    return (
      <div className="design-mode flex h-[100vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="editorial-display text-2xl text-[hsl(var(--design-danger))]">Couldn&apos;t start a design session</h3>
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
    );
  }

  if (creating || !data) {
    return (
      <div className="design-mode flex h-[100vh] items-center justify-center text-sm text-muted-foreground">
        Starting Design Mode…
      </div>
    );
  }

  return (
    <div className="design-mode flex h-[100vh] overflow-hidden">
      <LeftNavRail active="design" userInitial={(customer?.name || "U").slice(0, 1).toUpperCase()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          session={data.session}
          content={data.content}
          client={data.client}
          shotsCount={data.shots.length}
          totalDuration={totalDuration}
          sessions={sessions}
          onLoadSessions={loadSessions}
          onSwitchSession={switchSession}
          onNewSession={(opts) => createSession(opts)}
          onChangeVisibility={handleVisibilityChange}
          onPublish={() => setPublishOpen(true)}
          onBack={() => router.push("/engineai")}
        />

        {/* Body — brand kit | center stack (canvas + timeline) | AI rail */}
        <div className="flex min-h-0 flex-1">
          <BrandKitRail
            brandKit={data.brandKit}
            client={data.client}
            shots={data.shots}
            currentShot={currentShot}
            defaultCollapsed={true}
          />

          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* First-run onboarding hint — only shown when the session is empty */}
            {data.shots.length === 0 && (
              <div className="pointer-events-none absolute right-4 top-4 z-20">
                <OnboardingHint
                  id="empty-session-tip"
                  title="Start by creating a shot"
                  body={
                    <>
                      Click <span className="font-medium">Create a shot</span> below, write a prompt,
                      pick a model, and we&apos;ll generate it on-brand for{" "}
                      {data.client?.name ? <span className="font-medium">{data.client.name}</span> : "your client"}.
                    </>
                  }
                  visible={true}
                />
              </div>
            )}
            <div className="min-h-0 flex-1">
              <CanvasStage
                shot={currentShot}
                onRegenerate={handleRegenerate}
                onCommit={handleCommit}
                onModelChange={handleModelChange}
                onPromptSave={handlePromptSave}
                onFormatChange={setActiveFormat}
                onSelectVersion={handleSelectVersion}
                onAddShot={handleAddShot}
                onTitleSave={(title) => currentShot && handleShotTitleSave(currentShot.id, title)}
                onBeatSave={(beat) => currentShot && handleShotBeatSave(currentShot.id, beat)}
                onDelete={() => currentShot && handleDeleteShot(currentShot.id)}
                onUploadReference={handleUploadReference}
                onRemoveReference={handleRemoveReference}
                onAnimateImage={handleAnimateImage}
                animating={animating}
                activeFormat={activeFormat}
                generating={generating}
              />
            </div>
            <div className="h-[270px] flex-shrink-0">
              <Timeline
                tracks={data.tracks}
                shots={data.shots}
                currentShotId={currentShotId}
                defaultShape={(data.session.timelineShape as "storyboard" | "tracks") || "storyboard"}
                onSelectShot={handleSelectShot}
                onAddShot={handleAddShot}
                onDeleteShot={handleDeleteShot}
                onReorder={handleReorderShots}
                onShapeChange={async (shape) => {
                  if (!sessionId) return;
                  await fetch(`/api/design/sessions/${sessionId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ timelineShape: shape }),
                  });
                }}
              />
            </div>
          </div>

          <AIRailWrapper
            currentShot={currentShot}
            workspaceId={workspaceId || null}
            clientId={data.session.clientId}
            contentId={data.session.contentId}
            designSessionId={sessionId}
            allShots={data.shots}
            briefExcerpt={data.content?.brief || null}
            brandSummary={data.brandKit?.visualIdentity?.voice || data.brandKit?.versionTag || (data.client?.name ? `Client: ${data.client.name}` : null)}
            onAssetReady={refreshSession}
            defaultOpen={false}
          />
        </div>
      </div>

      <PublishSheet
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        content={data.content}
        shots={data.shots}
        onPublish={handlePublish}
      />
    </div>
  );
}
