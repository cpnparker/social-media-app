"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  Trash2,
  Send,
  RefreshCw,
  Check,
  Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { platformLabels, platformColors } from "@/lib/platform-utils";
import { cn } from "@/lib/utils";

interface PromoDraft {
  id: string;
  platform: string;
  content: string;
  status: string;
  generatedByAi: boolean;
  createdAt: string;
}

interface PromoDraftsSectionProps {
  contentObjectId: string;
  workspaceId: string;
  contentTitle: string;
  contentBody?: string;
  drafts: PromoDraft[];
  onDraftsChange: (drafts: PromoDraft[]) => void;
}

const defaultPlatforms = ["twitter", "linkedin", "instagram", "facebook"];

export default function PromoDraftsSection({
  contentObjectId,
  workspaceId,
  contentTitle,
  contentBody,
  drafts,
  onDraftsChange,
}: PromoDraftsSectionProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    try {
      // Step 1: Generate with AI
      const aiRes = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promo-drafts",
          title: contentTitle,
          bodyContent: contentBody || "",
          platforms: defaultPlatforms,
        }),
      });
      const aiData = await aiRes.json();

      if (!aiData.drafts?.length) {
        setGenerating(false);
        return;
      }

      // Step 2: Save to DB
      const saveRes = await fetch("/api/promo-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentObjectId,
          workspaceId,
          drafts: aiData.drafts.map((d: any) => ({
            platform: d.platform,
            content: d.content,
            generatedByAi: true,
          })),
        }),
      });
      const saveData = await saveRes.json();

      if (saveData.drafts) {
        onDraftsChange([...drafts, ...saveData.drafts]);
      }
    } catch (err) {
      console.error("Failed to generate promo drafts:", err);
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = async () => {
    // Delete existing drafts first
    try {
      await Promise.all(
        drafts.map((d) =>
          fetch(`/api/promo-drafts/${d.id}`, { method: "DELETE" })
        )
      );
      onDraftsChange([]);
    } catch (err) {
      console.error("Failed to delete old drafts:", err);
    }
    // Then generate fresh
    await generate();
  };

  const startEdit = (draft: PromoDraft) => {
    setEditingId(draft.id);
    setEditContent(draft.content);
  };

  const saveEdit = async (draftId: string) => {
    setSavingId(draftId);
    try {
      const res = await fetch(`/api/promo-drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const data = await res.json();
      if (data.draft) {
        onDraftsChange(
          drafts.map((d) => (d.id === draftId ? data.draft : d))
        );
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSavingId(null);
      setEditingId(null);
    }
  };

  const deleteDraft = async (draftId: string) => {
    try {
      await fetch(`/api/promo-drafts/${draftId}`, { method: "DELETE" });
      onDraftsChange(drafts.filter((d) => d.id !== draftId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const sendToCompose = (draft: PromoDraft) => {
    const params = new URLSearchParams({
      prefillContent: draft.content,
      platform: draft.platform,
    });
    router.push(`/compose?${params.toString()}`);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="px-4 pt-4 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            Promo Drafts
          </CardTitle>
          {drafts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={regenerate}
              disabled={generating}
              className="h-7 px-2 text-xs gap-1 text-muted-foreground"
            >
              <RefreshCw className={cn("h-3 w-3", generating && "animate-spin")} />
              Regenerate
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-3">
        {drafts.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground mb-3">
              Generate AI-powered promotional drafts for social media.
            </p>
            <Button
              onClick={generate}
              disabled={generating}
              size="sm"
              className="gap-1.5"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? "Generating..." : "Generate Drafts"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => {
              const isEditing = editingId === draft.id;
              const label = platformLabels[draft.platform] || draft.platform;
              const colorClass = platformColors[draft.platform] || "bg-gray-500";

              return (
                <div
                  key={draft.id}
                  className="rounded-lg border bg-muted/30 overflow-hidden"
                >
                  {/* Platform header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-background/50">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          colorClass
                        )}
                      />
                      <span className="text-xs font-medium">{label}</span>
                      {draft.generatedByAi && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 h-4 border-0 bg-violet-500/10 text-violet-500"
                        >
                          AI
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {!isEditing && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(draft)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => sendToCompose(draft)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-blue-500"
                            title="Send to Compose"
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteDraft(draft.id)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Draft content */}
                  <div className="px-3 py-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={4}
                          className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                          autoFocus
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            {editContent.length} chars
                          </span>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(null)}
                              className="h-6 px-2 text-[10px]"
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => saveEdit(draft.id)}
                              disabled={savingId === draft.id}
                              className="h-6 px-2 text-[10px] gap-1"
                            >
                              {savingId === draft.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                        {draft.content}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {generating && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating new drafts...
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
