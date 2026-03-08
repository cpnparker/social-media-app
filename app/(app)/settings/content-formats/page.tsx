"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Save,
  RotateCcw,
  Lightbulb,
  Check,
  FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/contexts/WorkspaceContext";

/* ──────────────────────────────────────────── */
/*  Types                                       */
/* ──────────────────────────────────────────── */

interface ContentType {
  id: number;
  key: string;
  name: string;
  isActive: boolean;
}

interface CUDefinition {
  id: string;
  format: string;
  category: string;
  units: number;
  description: string;
}

/* ──────────────────────────────────────────── */
/*  Component                                   */
/* ──────────────────────────────────────────── */

export default function ContentFormatsPage() {
  const wsCtx = useWorkspace();
  const workspaceId = wsCtx.selectedWorkspace?.id;

  // ── State ──
  const [loading, setLoading] = useState(true);
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | null>(null);
  const [definitions, setDefinitions] = useState<CUDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(false);

  // Format descriptions from Neon workspaces table
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [savedDescriptions, setSavedDescriptions] = useState<Record<string, string>>({});

  // Per-format edit state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // ── Fetch content types from Supabase ──
  const fetchContentTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/content-types");
      if (!res.ok) throw new Error("Failed to fetch content types");
      const data = await res.json();
      const types: ContentType[] = (data.contentTypes || []).map((t: any) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        isActive: t.isActive,
      }));
      setContentTypes(types);
      if (types.length > 0 && !activeTypeId) {
        setActiveTypeId(types[0].id);
      }
    } catch (err) {
      console.error("Failed to load content types:", err);
    }
  }, [activeTypeId]);

  // ── Fetch format definitions + descriptions from AI settings ──
  const fetchDefinitions = useCallback(async () => {
    if (!workspaceId) return;
    setLoadingDefs(true);
    try {
      const res = await fetch(`/api/ai/settings?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      const data = await res.json();

      const defs: CUDefinition[] = (data.cuDefinitions || []).map((d: any) => ({
        id: d.id,
        format: d.format,
        category: d.category || "other",
        units: d.units,
        description: d.description || "",
      }));
      setDefinitions(defs);

      // Build descriptions map from the definitions
      const descs: Record<string, string> = {};
      defs.forEach((d) => {
        if (d.description) descs[d.id] = d.description;
      });
      setDescriptions(descs);
      setSavedDescriptions(descs);
    } catch (err) {
      console.error("Failed to load definitions:", err);
    } finally {
      setLoadingDefs(false);
    }
  }, [workspaceId]);

  // ── Initial load ──
  useEffect(() => {
    async function load() {
      await fetchContentTypes();
      setLoading(false);
    }
    load();
  }, [fetchContentTypes]);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  // ── Filter definitions by active type ──
  const filteredDefs = definitions.filter(
    (d) => !activeTypeId || d.category === contentTypes.find((t) => t.id === activeTypeId)?.key
  );

  // If no match by key, try falling back to the category name
  const displayDefs = filteredDefs.length > 0
    ? filteredDefs
    : definitions.filter((d) => {
        const activeType = contentTypes.find((t) => t.id === activeTypeId);
        return activeType && d.category?.toLowerCase() === activeType.name?.toLowerCase();
      });

  // ── Save a single format description ──
  const saveDescription = async (defId: string) => {
    if (!workspaceId) return;
    setSavingId(defId);

    try {
      const prompt = descriptions[defId] || "";
      const payload: Record<string, string> = { [defId]: prompt };

      // If empty, send empty string (will effectively clear it)
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          formatDescriptions: payload,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      setSavedDescriptions((prev) => ({ ...prev, [defId]: prompt }));
      setSavedId(defId);
      setTimeout(() => setSavedId(null), 2000);
      toast.success("Format prompt saved");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save prompt");
    } finally {
      setSavingId(null);
    }
  };

  // ── Reset a single format description ──
  const resetDescription = async (defId: string) => {
    if (!workspaceId) return;
    setSavingId(defId);

    try {
      const res = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          formatDescriptions: { [defId]: "" },
        }),
      });

      if (!res.ok) throw new Error("Failed to reset");

      setDescriptions((prev) => {
        const copy = { ...prev };
        delete copy[defId];
        return copy;
      });
      setSavedDescriptions((prev) => {
        const copy = { ...prev };
        delete copy[defId];
        return copy;
      });
      toast.success("Prompt reset to default");
    } catch (err) {
      console.error("Reset error:", err);
      toast.error("Failed to reset prompt");
    } finally {
      setSavingId(null);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Content Format Descriptions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add optional AI prompts per content format. When set, these are included as context
          when a user works with content of that format in EngineGPT.
        </p>
      </div>

      {/* Content type tabs */}
      {contentTypes.length > 0 && (
        <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto scrollbar-hide">
          {contentTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setActiveTypeId(type.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTypeId === type.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {type.name}
            </button>
          ))}
        </div>
      )}

      {/* Format list */}
      {loadingDefs ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : displayDefs.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium mb-1">No formats defined</p>
            <p className="text-xs text-muted-foreground">
              Add content unit definitions in the Content Units settings page first.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {displayDefs.map((def) => {
            const isExpanded = expandedId === def.id;
            const currentPrompt = descriptions[def.id] || "";
            const savedPrompt = savedDescriptions[def.id] || "";
            const hasChanges = currentPrompt !== savedPrompt;
            const hasPrompt = !!currentPrompt.trim();
            const isSaving = savingId === def.id;
            const justSaved = savedId === def.id;

            return (
              <Card key={def.id} className="border shadow-sm">
                <CardContent className="p-0">
                  {/* Format header row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : def.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{def.format}</span>
                      <Badge variant="secondary" className="border-0 text-[10px] shrink-0">
                        {def.units} CU
                      </Badge>
                    </div>

                    {hasPrompt && (
                      <Badge variant="secondary" className="border-0 bg-violet-500/10 text-violet-600 text-[10px] shrink-0">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Custom
                      </Badge>
                    )}
                  </button>

                  {/* Expanded prompt editor */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t">
                      <div className="pt-3">
                        <p className="text-sm text-muted-foreground mb-3">
                          Customise the AI prompt for <strong>{def.format}</strong>.
                          This will be included as context when EngineGPT works with content of this format.
                        </p>

                        <textarea
                          value={currentPrompt}
                          onChange={(e) =>
                            setDescriptions((prev) => ({ ...prev, [def.id]: e.target.value }))
                          }
                          placeholder={`Describe how ${def.format} content should be written, structured, or approached...`}
                          rows={5}
                          className="w-full rounded-md border bg-background px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring font-mono leading-relaxed"
                        />

                        {/* Variable hints */}
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 mt-3">
                          <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p className="font-medium text-foreground">Available variables</p>
                            <p>
                              <code className="bg-muted px-1 rounded">{"{content_type}"}</code>{" "}
                              <code className="bg-muted px-1 rounded">{"{title}"}</code>{" "}
                              <code className="bg-muted px-1 rounded">{"{brief}"}</code>{" "}
                              <code className="bg-muted px-1 rounded">{"{topics}"}</code>{" "}
                              <code className="bg-muted px-1 rounded">{"{customer}"}</code>
                            </p>
                            <p>These are replaced with actual content values when generating.</p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-3">
                          <Button
                            size="sm"
                            onClick={() => saveDescription(def.id)}
                            disabled={!hasChanges || isSaving}
                            className="gap-1.5"
                          >
                            {isSaving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : justSaved ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Save className="h-3.5 w-3.5" />
                            )}
                            {justSaved ? "Saved" : "Save Prompt"}
                          </Button>
                          {hasPrompt && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => resetDescription(def.id)}
                              disabled={isSaving}
                              className="gap-1.5"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
