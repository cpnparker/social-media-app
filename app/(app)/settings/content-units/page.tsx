"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Boxes,
  Loader2,
  ChevronDown,
  ChevronRight,
  UserCheck,
  Copy,
  PlusCircle,
  Calculator,
  Sparkles,
  Save,
  RotateCcw,
  Lightbulb,
  Check,
  FileText,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DocumentTemplate {
  id: number;
  documentType: string;
  documentTarget: string | null;
  key: string;
  linkUrl: string | null;
  documentReference: string | null;
}

interface ContentType {
  id: number;
  key: string;
  name: string;
  isActive: boolean;
  aiPrompt: string | null;
  documentTemplates: DocumentTemplate[];
}

interface TaskTemplate {
  id: string;
  typeId: number;
  title: string;
  description: string | null;
  sortOrder: number;
  contentUnits: number;
  unitsOverride: number;
  defaultAdded: boolean;
  canManuallyAdd: boolean;
  assignedToAccountManager: boolean;
}

interface CUDefinition {
  id: string;
  typeId: number;
  category: string;
  formatName: string;
  defaultContentUnits: number;
  splitText: number | null;
  splitVideo: number | null;
  splitVisual: number | null;
}

const DEFAULT_AI_PROMPT = `You are an expert editor and subject-matter authority with decades of experience producing exceptional {content_type} content. You combine deep topic expertise with masterful writing craft.

Your writing demonstrates:
- Authoritative knowledge that builds reader trust
- Engaging structure with strong hooks and clear flow
- Perfect adaptation to the target audience
- Publication-ready quality requiring minimal editing
- Rich detail, concrete examples, and actionable insights

Write as the expert you are — not as an AI assistant.`;

export default function ContentUnitsSettingsPage() {
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [cuDefinitions, setCuDefinitions] = useState<CUDefinition[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"templates" | "calculator" | "ai_prompt" | "doc_templates" | null>("templates");

  // AI Prompt state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPromptOriginal, setAiPromptOriginal] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  // Fetch content types on mount
  const fetchContentTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const res = await fetch("/api/content-types");
      const data = await res.json();
      const types: ContentType[] = (data.contentTypes || []).map((t: any) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        isActive: t.isActive,
        aiPrompt: t.aiPrompt || null,
        documentTemplates: t.documentTemplates || [],
      }));
      setContentTypes(types);
      // Auto-select first active type
      const firstActive = types.find((t) => t.isActive);
      if (firstActive) {
        setSelectedTypeId(firstActive.id);
      }
    } catch (err) {
      console.error("Failed to fetch content types:", err);
    } finally {
      setLoadingTypes(false);
    }
  }, []);

  // Fetch templates + CU definitions when type changes
  const fetchTypeData = useCallback(async (typeId: number) => {
    setLoadingTemplates(true);
    try {
      const [templatesRes, cuRes] = await Promise.all([
        fetch(`/api/task-templates?typeId=${typeId}`),
        fetch(`/api/content-unit-definitions?typeId=${typeId}`),
      ]);
      const templatesData = await templatesRes.json();
      const cuData = await cuRes.json();
      setTemplates(templatesData.templates || []);
      setCuDefinitions(cuData.definitions || []);
    } catch (err) {
      console.error("Failed to fetch type data:", err);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    fetchContentTypes();
  }, [fetchContentTypes]);

  useEffect(() => {
    if (selectedTypeId !== null) {
      fetchTypeData(selectedTypeId);
      // Load AI prompt for selected type
      const type = contentTypes.find((t) => t.id === selectedTypeId);
      const prompt = type?.aiPrompt || "";
      setAiPrompt(prompt);
      setAiPromptOriginal(prompt);
      setPromptSaved(false);
    }
  }, [selectedTypeId, fetchTypeData, contentTypes]);

  const selectedType = contentTypes.find((t) => t.id === selectedTypeId);
  const activeTypes = contentTypes.filter((t) => t.isActive);

  // Calculate total CUs for default tasks
  const totalDefaultCUs = templates
    .filter((t) => t.defaultAdded)
    .reduce((sum, t) => sum + t.contentUnits, 0);

  const hasPromptChanges = aiPrompt !== aiPromptOriginal;

  const saveAiPrompt = async () => {
    if (!selectedTypeId) return;
    setSavingPrompt(true);
    try {
      const res = await fetch("/api/content-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeId: selectedTypeId, aiPrompt: aiPrompt.trim() }),
      });
      if (res.ok) {
        setAiPromptOriginal(aiPrompt.trim());
        // Update local content types state
        setContentTypes((prev) =>
          prev.map((t) => (t.id === selectedTypeId ? { ...t, aiPrompt: aiPrompt.trim() || null } : t))
        );
        setPromptSaved(true);
        setTimeout(() => setPromptSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save AI prompt:", err);
    } finally {
      setSavingPrompt(false);
    }
  };

  const resetAiPrompt = async () => {
    setAiPrompt("");
    if (!selectedTypeId) return;
    setSavingPrompt(true);
    try {
      await fetch("/api/content-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeId: selectedTypeId, aiPrompt: "" }),
      });
      setAiPromptOriginal("");
      setContentTypes((prev) =>
        prev.map((t) => (t.id === selectedTypeId ? { ...t, aiPrompt: null } : t))
      );
    } catch (err) {
      console.error("Failed to reset AI prompt:", err);
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <p className="text-sm text-muted-foreground">
        View content types and their production task settings. When content is
        commissioned, tasks are auto-created based on these templates and content
        units are reserved against the client&apos;s contract.
      </p>

      {loadingTypes ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Content Type Tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
            {activeTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedTypeId(type.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  selectedTypeId === type.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {type.name}
              </button>
            ))}
          </div>

          {/* Selected Type Content */}
          {selectedType && (
            <div className="space-y-4">
              {/* Summary Bar */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Boxes className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">{selectedType.name}</span>
                </div>
                <div className="text-muted-foreground">
                  {templates.length} task template{templates.length !== 1 ? "s" : ""}
                </div>
                <div className="text-muted-foreground">
                  {templates.filter((t) => t.defaultAdded).length} default on commission
                </div>
                <div className="ml-auto font-mono text-sm font-medium">
                  {totalDefaultCUs.toFixed(2)} CU total on commission
                </div>
              </div>

              {loadingTemplates ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Task Templates Section */}
                  <div>
                    <button
                      onClick={() =>
                        setExpandedSection(
                          expandedSection === "templates" ? null : "templates"
                        )
                      }
                      className="flex items-center gap-2 w-full text-left py-2 text-sm font-semibold"
                    >
                      {expandedSection === "templates" ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      Production Task Templates
                      <span className="text-muted-foreground font-normal">
                        ({templates.length})
                      </span>
                    </button>

                    {expandedSection === "templates" && (
                      <div className="space-y-1.5">
                        {templates.length === 0 ? (
                          <Card className="border-0 shadow-sm">
                            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                              <Boxes className="h-8 w-8 text-muted-foreground/40 mb-2" />
                              <p className="text-sm font-medium mb-0.5">
                                No task templates
                              </p>
                              <p className="text-xs text-muted-foreground">
                                No production tasks configured for this content type.
                              </p>
                            </CardContent>
                          </Card>
                        ) : (
                          <>
                            {/* Header Row */}
                            <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                              <div>Task</div>
                              <div className="text-center">CU Cost</div>
                              <div className="text-center">Override %</div>
                              <div className="text-center">Default</div>
                              <div className="text-center">Manual</div>
                              <div className="text-center">AM</div>
                            </div>

                            {templates.map((template, index) => (
                              <Card key={template.id} className="border-0 shadow-sm">
                                <CardContent className="p-0">
                                  <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-2 items-center px-3 py-2.5">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-[10px] font-medium shrink-0">
                                        {index + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <span className="text-sm truncate block">
                                          {template.title}
                                        </span>
                                        {template.description && (
                                          <span className="text-[11px] text-muted-foreground truncate block">
                                            {template.description}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <span className="text-sm font-mono">
                                        {template.contentUnits.toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="text-center">
                                      {template.unitsOverride > 0 ? (
                                        <span className="text-sm font-mono text-amber-600">
                                          {template.unitsOverride}%
                                        </span>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">&mdash;</span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {template.defaultAdded ? (
                                        <Badge variant="secondary" className="border-0 bg-green-500/10 text-green-600 text-[10px] gap-0.5">
                                          <Copy className="h-3 w-3" /> Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">&mdash;</span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {template.canManuallyAdd ? (
                                        <Badge variant="secondary" className="border-0 bg-blue-500/10 text-blue-600 text-[10px] gap-0.5">
                                          <PlusCircle className="h-3 w-3" /> Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">&mdash;</span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {template.assignedToAccountManager ? (
                                        <Badge variant="secondary" className="border-0 bg-violet-500/10 text-violet-600 text-[10px] gap-0.5">
                                          <UserCheck className="h-3 w-3" /> Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">&mdash;</span>
                                      )}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}

                            {/* Total row */}
                            <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-2 px-3 py-2 border-t">
                              <div className="text-sm font-medium text-muted-foreground">
                                Default commission total
                              </div>
                              <div className="text-center text-sm font-mono font-semibold">
                                {totalDefaultCUs.toFixed(2)}
                              </div>
                              <div />
                              <div className="text-center text-xs text-muted-foreground">
                                {templates.filter((t) => t.defaultAdded).length} tasks
                              </div>
                              <div />
                              <div />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* CU Calculator Definitions Section */}
                  {cuDefinitions.length > 0 && (
                    <div>
                      <button
                        onClick={() =>
                          setExpandedSection(
                            expandedSection === "calculator" ? null : "calculator"
                          )
                        }
                        className="flex items-center gap-2 w-full text-left py-2 text-sm font-semibold"
                      >
                        {expandedSection === "calculator" ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <Calculator className="h-4 w-4" />
                        CU Calculator Definitions
                        <span className="text-muted-foreground font-normal">
                          ({cuDefinitions.length})
                        </span>
                      </button>

                      {expandedSection === "calculator" && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            <div>Format</div>
                            <div className="text-center">CU Cost</div>
                            <div className="text-center">Category</div>
                            <div className="text-center">Text %</div>
                            <div className="text-center">Visual %</div>
                            <div className="text-center">Video %</div>
                          </div>

                          {cuDefinitions.map((def) => (
                            <Card key={def.id} className="border-0 shadow-sm">
                              <CardContent className="p-0">
                                <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] gap-2 items-center px-3 py-2.5">
                                  <span className="text-sm truncate">{def.formatName}</span>
                                  <div className="text-center text-sm font-mono">{def.defaultContentUnits.toFixed(2)}</div>
                                  <div className="flex justify-center">
                                    <Badge variant="secondary" className="border-0 text-[10px] capitalize">{def.category}</Badge>
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground">{def.splitText != null ? `${def.splitText}%` : "\u2014"}</div>
                                  <div className="text-center text-sm text-muted-foreground">{def.splitVisual != null ? `${def.splitVisual}%` : "\u2014"}</div>
                                  <div className="text-center text-sm text-muted-foreground">{def.splitVideo != null ? `${def.splitVideo}%` : "\u2014"}</div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Document Templates Section */}
                  {selectedType && selectedType.documentTemplates.length > 0 && (
                    <div>
                      <button
                        onClick={() =>
                          setExpandedSection(
                            expandedSection === "doc_templates" ? null : "doc_templates"
                          )
                        }
                        className="flex items-center gap-2 w-full text-left py-2 text-sm font-semibold"
                      >
                        {expandedSection === "doc_templates" ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <FileText className="h-4 w-4 text-blue-500" />
                        Document Templates
                        <span className="text-muted-foreground font-normal">
                          ({selectedType.documentTemplates.length})
                        </span>
                      </button>

                      {expandedSection === "doc_templates" && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            <div>Template</div>
                            <div className="text-center">Type</div>
                            <div className="text-center">Target</div>
                            <div></div>
                          </div>

                          {selectedType.documentTemplates.map((dt) => (
                            <Card key={dt.id} className="border-0 shadow-sm">
                              <CardContent className="p-0">
                                <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 items-center px-3 py-2.5">
                                  <div className="min-w-0">
                                    <span className="text-sm truncate block">
                                      {dt.key}
                                    </span>
                                    {dt.documentReference && (
                                      <span className="text-[11px] text-muted-foreground truncate block font-mono">
                                        {dt.documentReference}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex justify-center">
                                    <Badge
                                      variant="secondary"
                                      className={`border-0 text-[10px] capitalize ${
                                        dt.documentType === "google_doc"
                                          ? "bg-blue-500/10 text-blue-600"
                                          : dt.documentType === "sharepoint"
                                          ? "bg-teal-500/10 text-teal-600"
                                          : "bg-gray-500/10 text-gray-600"
                                      }`}
                                    >
                                      {dt.documentType === "google_doc"
                                        ? "Google Doc"
                                        : dt.documentType === "sharepoint"
                                        ? "SharePoint"
                                        : dt.documentType?.replace(/_/g, " ") || "Unknown"}
                                    </Badge>
                                  </div>
                                  <div className="flex justify-center">
                                    {dt.documentTarget ? (
                                      <Badge variant="secondary" className="border-0 text-[10px] capitalize">
                                        {dt.documentTarget.replace(/_/g, " ")}
                                      </Badge>
                                    ) : (
                                      <span className="text-sm text-muted-foreground/50">&mdash;</span>
                                    )}
                                  </div>
                                  <div className="flex justify-center">
                                    {dt.linkUrl ? (
                                      <a
                                        href={dt.linkUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    ) : dt.documentReference && dt.documentType === "google_doc" ? (
                                      <a
                                        href={`https://docs.google.com/document/d/${dt.documentReference}/edit`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Writing Prompt Section */}
                  <div>
                    <button
                      onClick={() =>
                        setExpandedSection(
                          expandedSection === "ai_prompt" ? null : "ai_prompt"
                        )
                      }
                      className="flex items-center gap-2 w-full text-left py-2 text-sm font-semibold"
                    >
                      {expandedSection === "ai_prompt" ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Sparkles className="h-4 w-4 text-violet-500" />
                      AI Writing Prompt
                      {selectedType?.aiPrompt && (
                        <Badge variant="secondary" className="border-0 bg-violet-500/10 text-violet-600 text-[10px]">
                          Custom
                        </Badge>
                      )}
                    </button>

                    {expandedSection === "ai_prompt" && (
                      <Card className="border-0 shadow-sm">
                        <CardContent className="p-4 space-y-4">
                          <p className="text-sm text-muted-foreground">
                            Customise the AI writing prompt for <strong>{selectedType?.name}</strong> content.
                            When empty, the default expert-editor prompt is used.
                          </p>

                          <textarea
                            value={aiPrompt}
                            onChange={(e) => { setAiPrompt(e.target.value); setPromptSaved(false); }}
                            placeholder={DEFAULT_AI_PROMPT.replace(/\{content_type\}/g, selectedType?.name?.toLowerCase() || "content")}
                            rows={8}
                            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring font-mono leading-relaxed"
                          />

                          {/* Variable hints */}
                          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
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
                              <p>These will be replaced with actual content values when generating.</p>
                            </div>
                          </div>

                          {/* Default prompt preview (when empty) */}
                          {!aiPrompt && (
                            <div className="p-3 rounded-lg border border-dashed">
                              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                Default prompt (active when empty)
                              </p>
                              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed font-mono">
                                {DEFAULT_AI_PROMPT.replace(/\{content_type\}/g, selectedType?.name?.toLowerCase() || "content")}
                              </p>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={saveAiPrompt}
                              disabled={!hasPromptChanges || savingPrompt}
                              className="gap-1.5"
                            >
                              {savingPrompt ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : promptSaved ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              {promptSaved ? "Saved" : "Save Prompt"}
                            </Button>
                            {aiPrompt && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={resetAiPrompt}
                                disabled={savingPrompt}
                                className="gap-1.5"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Reset to Default
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
