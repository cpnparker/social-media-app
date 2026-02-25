"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ListChecks,
  Plus,
  Loader2,
  GripVertical,
  Trash2,
  Pencil,
  Check,
  X,
  UserCheck,
  Copy,
  PlusCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface ContentType {
  id: number;
  key: string;
  name: string;
  isActive: boolean;
}

interface Template {
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

export default function TemplatesSettingsPage() {
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // New template form
  const [newTitle, setNewTitle] = useState("");
  const [newCU, setNewCU] = useState("");
  const [newDefaultAdded, setNewDefaultAdded] = useState(true);
  const [newCanAdd, setNewCanAdd] = useState(false);
  const [newAM, setNewAM] = useState(false);
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCU, setEditCU] = useState("");
  const [editDefaultAdded, setEditDefaultAdded] = useState(false);
  const [editCanAdd, setEditCanAdd] = useState(false);
  const [editAM, setEditAM] = useState(false);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Fetch content types
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/content-types");
        const data = await res.json();
        const types: ContentType[] = data.contentTypes || [];
        setContentTypes(types);
        const firstActive = types.find((t) => t.isActive);
        if (firstActive) setActiveTypeId(firstActive.id);
      } catch (err) {
        console.error("Failed to fetch content types:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fetchTemplates = useCallback(async () => {
    if (activeTypeId === null) return;
    setLoadingTemplates(true);
    try {
      const res = await fetch(`/api/task-templates?typeId=${activeTypeId}`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [activeTypeId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const addTemplate = async () => {
    if (!newTitle.trim() || activeTypeId === null) return;
    setAdding(true);
    try {
      const res = await fetch("/api/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId: activeTypeId,
          title: newTitle.trim(),
          contentUnits: parseFloat(newCU) || 0,
          defaultAdded: newDefaultAdded,
          canManuallyAdd: newCanAdd,
          assignedToAccountManager: newAM,
        }),
      });
      const data = await res.json();
      if (data.template) {
        setTemplates((prev) => [...prev, data.template]);
        setNewTitle("");
        setNewCU("");
        setNewDefaultAdded(true);
        setNewCanAdd(false);
        setNewAM(false);
      }
    } catch (err) {
      console.error("Failed to add template:", err);
    } finally {
      setAdding(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      await fetch(`/api/task-templates/${id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  const startEdit = (template: Template) => {
    setEditingId(template.id);
    setEditTitle(template.title);
    setEditCU(template.contentUnits.toFixed(2));
    setEditDefaultAdded(template.defaultAdded);
    setEditCanAdd(template.canManuallyAdd);
    setEditAM(template.assignedToAccountManager);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    try {
      const res = await fetch(`/api/task-templates/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          contentUnits: parseFloat(editCU) || 0,
          defaultAdded: editDefaultAdded,
          canManuallyAdd: editCanAdd,
          assignedToAccountManager: editAM,
        }),
      });
      const data = await res.json();
      if (data.template) {
        setTemplates((prev) =>
          prev.map((t) => (t.id === editingId ? data.template : t))
        );
      }
    } catch (err) {
      console.error("Failed to update template:", err);
    } finally {
      setEditingId(null);
    }
  };

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = async () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const reordered = [...templates];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);

    setTemplates(reordered);
    dragItem.current = null;
    dragOverItem.current = null;

    try {
      await fetch("/api/task-templates/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((t) => t.id) }),
      });
    } catch (err) {
      console.error("Failed to reorder:", err);
      fetchTemplates();
    }
  };

  const activeTypes = contentTypes.filter((t) => t.isActive);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Define production steps for each content type. Tasks are auto-created
        when commissioning content.
      </p>

      {/* Content Type Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
        {activeTypes.map((type) => (
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

      {/* Templates List */}
      {loadingTemplates ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {templates.length === 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <ListChecks className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium mb-1">
                  No templates for this content type
                </p>
                <p className="text-xs text-muted-foreground">
                  Add production steps to auto-create tasks when commissioning.
                </p>
              </CardContent>
            </Card>
          )}

          {templates.map((template, index) => (
            <Card
              key={template.id}
              className="border-0 shadow-sm"
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium shrink-0">
                  {index + 1}
                </div>

                {editingId === template.id ? (
                  <>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      value={editCU}
                      onChange={(e) => setEditCU(e.target.value)}
                      className="w-20 h-8 text-sm text-right"
                      placeholder="CU"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editDefaultAdded}
                        onChange={(e) => setEditDefaultAdded(e.target.checked)}
                        className="rounded"
                      />
                      Default
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editCanAdd}
                        onChange={(e) => setEditCanAdd(e.target.checked)}
                        className="rounded"
                      />
                      Manual
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editAM}
                        onChange={(e) => setEditAM(e.target.checked)}
                        className="rounded"
                      />
                      AM
                    </label>
                    <button
                      onClick={saveEdit}
                      className="text-green-500 hover:text-green-600"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm flex-1 truncate">
                      {template.title}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {template.contentUnits.toFixed(2)} CU
                    </span>
                    {template.defaultAdded && (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-green-500/10 text-green-600 text-[10px] gap-0.5 shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                        Default
                      </Badge>
                    )}
                    {template.canManuallyAdd && (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-blue-500/10 text-blue-600 text-[10px] gap-0.5 shrink-0"
                      >
                        <PlusCircle className="h-3 w-3" />
                        Manual
                      </Badge>
                    )}
                    {template.assignedToAccountManager && (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-violet-500/10 text-violet-600 text-[10px] gap-0.5 shrink-0"
                      >
                        <UserCheck className="h-3 w-3" />
                        AM
                      </Badge>
                    )}
                    <button
                      onClick={() => startEdit(template)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Add new template */}
          <Card className="border-0 shadow-sm border-dashed">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium shrink-0 text-muted-foreground">
                  {templates.length + 1}
                </div>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Add production step..."
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTemplate();
                  }}
                />
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={newCU}
                  onChange={(e) => setNewCU(e.target.value)}
                  placeholder="CU"
                  className="w-16 h-8 text-sm text-right"
                />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={newDefaultAdded}
                    onChange={(e) => setNewDefaultAdded(e.target.checked)}
                    className="rounded"
                  />
                  Default
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={newCanAdd}
                    onChange={(e) => setNewCanAdd(e.target.checked)}
                    className="rounded"
                  />
                  Manual
                </label>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={newAM}
                    onChange={(e) => setNewAM(e.target.checked)}
                    className="rounded"
                  />
                  AM
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addTemplate}
                  disabled={!newTitle.trim() || adding}
                  className="h-8 gap-1"
                >
                  {adding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
