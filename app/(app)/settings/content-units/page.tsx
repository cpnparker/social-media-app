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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ContentType {
  id: number;
  key: string;
  name: string;
  isActive: boolean;
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

export default function ContentUnitsSettingsPage() {
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [cuDefinitions, setCuDefinitions] = useState<CUDefinition[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"templates" | "calculator" | null>("templates");

  // Fetch content types on mount
  const fetchContentTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const res = await fetch("/api/content-types");
      const data = await res.json();
      const types: ContentType[] = data.contentTypes || [];
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
    }
  }, [selectedTypeId, fetchTypeData]);

  const selectedType = contentTypes.find((t) => t.id === selectedTypeId);
  const activeTypes = contentTypes.filter((t) => t.isActive);

  // Calculate total CUs for default tasks
  const totalDefaultCUs = templates
    .filter((t) => t.defaultAdded)
    .reduce((sum, t) => sum + t.contentUnits, 0);

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
                                    {/* Task name + order */}
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

                                    {/* CU Cost */}
                                    <div className="text-center">
                                      <span className="text-sm font-mono">
                                        {template.contentUnits.toFixed(2)}
                                      </span>
                                    </div>

                                    {/* Override % */}
                                    <div className="text-center">
                                      {template.unitsOverride > 0 ? (
                                        <span className="text-sm font-mono text-amber-600">
                                          {template.unitsOverride}%
                                        </span>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">
                                          &mdash;
                                        </span>
                                      )}
                                    </div>

                                    {/* Default Added (flag_clone) */}
                                    <div className="flex justify-center">
                                      {template.defaultAdded ? (
                                        <Badge
                                          variant="secondary"
                                          className="border-0 bg-green-500/10 text-green-600 text-[10px] gap-0.5"
                                        >
                                          <Copy className="h-3 w-3" />
                                          Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">
                                          &mdash;
                                        </span>
                                      )}
                                    </div>

                                    {/* Can Manually Add (flag_add) */}
                                    <div className="flex justify-center">
                                      {template.canManuallyAdd ? (
                                        <Badge
                                          variant="secondary"
                                          className="border-0 bg-blue-500/10 text-blue-600 text-[10px] gap-0.5"
                                        >
                                          <PlusCircle className="h-3 w-3" />
                                          Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">
                                          &mdash;
                                        </span>
                                      )}
                                    </div>

                                    {/* Assigned to AM (flag_account_manager) */}
                                    <div className="flex justify-center">
                                      {template.assignedToAccountManager ? (
                                        <Badge
                                          variant="secondary"
                                          className="border-0 bg-violet-500/10 text-violet-600 text-[10px] gap-0.5"
                                        >
                                          <UserCheck className="h-3 w-3" />
                                          Yes
                                        </Badge>
                                      ) : (
                                        <span className="text-sm text-muted-foreground/50">
                                          &mdash;
                                        </span>
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
                                  <span className="text-sm truncate">
                                    {def.formatName}
                                  </span>
                                  <div className="text-center text-sm font-mono">
                                    {def.defaultContentUnits.toFixed(2)}
                                  </div>
                                  <div className="flex justify-center">
                                    <Badge
                                      variant="secondary"
                                      className="border-0 text-[10px] capitalize"
                                    >
                                      {def.category}
                                    </Badge>
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground">
                                    {def.splitText != null
                                      ? `${def.splitText}%`
                                      : "\u2014"}
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground">
                                    {def.splitVisual != null
                                      ? `${def.splitVisual}%`
                                      : "\u2014"}
                                  </div>
                                  <div className="text-center text-sm text-muted-foreground">
                                    {def.splitVideo != null
                                      ? `${def.splitVideo}%`
                                      : "\u2014"}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
