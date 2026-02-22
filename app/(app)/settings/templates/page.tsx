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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const contentTypes = [
  "article",
  "video",
  "graphic",
  "thread",
  "newsletter",
  "podcast",
  "other",
];

const roles = ["writer", "editor", "producer", "designer", "reviewer", "other"];

const roleColors: Record<string, string> = {
  writer: "bg-blue-500/10 text-blue-500",
  editor: "bg-amber-500/10 text-amber-500",
  producer: "bg-green-500/10 text-green-500",
  designer: "bg-pink-500/10 text-pink-500",
  reviewer: "bg-violet-500/10 text-violet-500",
  other: "bg-gray-500/10 text-gray-500",
};

interface Template {
  id: string;
  title: string;
  description: string | null;
  defaultRole: string;
  sortOrder: number;
  contentType: string;
}

export default function TemplatesSettingsPage() {
  const [activeType, setActiveType] = useState("article");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // New template form
  const [newTitle, setNewTitle] = useState("");
  const [newRole, setNewRole] = useState("other");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editRole, setEditRole] = useState("");

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/task-templates?contentType=${activeType}`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const addTemplate = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: activeType,
          title: newTitle.trim(),
          defaultRole: newRole,
        }),
      });
      const data = await res.json();
      if (data.template) {
        setTemplates((prev) => [...prev, data.template]);
        setNewTitle("");
        setNewRole("other");
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
    setEditRole(template.defaultRole);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    try {
      const res = await fetch(`/api/task-templates/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), defaultRole: editRole }),
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

    // Save new order
    try {
      await fetch("/api/task-templates/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((t) => t.id) }),
      });
    } catch (err) {
      console.error("Failed to reorder:", err);
      fetchTemplates(); // Revert on failure
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Define production steps for each content type. Tasks are auto-created when commissioning ideas.
      </p>

      {/* Content Type Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
        {contentTypes.map((type) => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              activeType === type
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {templates.length === 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <ListChecks className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium mb-1">No templates for {activeType}</p>
                <p className="text-xs text-muted-foreground">
                  Add production steps to auto-create tasks when commissioning ideas.
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
                {/* Drag handle */}
                <div className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Step number */}
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium shrink-0">
                  {index + 1}
                </div>

                {editingId === template.id ? (
                  /* Edit mode */
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
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="rounded border bg-background px-2 py-1 text-xs w-24"
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </select>
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
                  /* View mode */
                  <>
                    <span className="text-sm flex-1 truncate">{template.title}</span>
                    <Badge
                      variant="secondary"
                      className={`${roleColors[template.defaultRole] || roleColors.other} border-0 text-[10px] capitalize shrink-0`}
                    >
                      {template.defaultRole}
                    </Badge>
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
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-xs w-24"
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
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
