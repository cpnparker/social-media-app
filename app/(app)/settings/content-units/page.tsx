"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Boxes,
  Plus,
  Loader2,
  GripVertical,
  Trash2,
  Pencil,
  Check,
  X,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const categories = [
  { value: "blogs", label: "Blogs" },
  { value: "video", label: "Video" },
  { value: "animation", label: "Animation" },
  { value: "visuals", label: "Visuals" },
  { value: "social", label: "Social" },
  { value: "other", label: "Other" },
];

interface Definition {
  id: string;
  category: string;
  formatName: string;
  description: string | null;
  defaultContentUnits: number;
  isActive: boolean;
  sortOrder: number;
}

export default function ContentUnitsSettingsPage() {
  const [activeCategory, setActiveCategory] = useState("blogs");
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [hasAnyDefinitions, setHasAnyDefinitions] = useState(true);

  // New definition form
  const [newFormatName, setNewFormatName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCost, setNewCost] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormatName, setEditFormatName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCost, setEditCost] = useState("");

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const fetchDefinitions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/content-unit-definitions?category=${activeCategory}`
      );
      const data = await res.json();
      setDefinitions(data.definitions || []);
    } catch (err) {
      console.error("Failed to fetch definitions:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  // Check if workspace has any definitions at all (for seed button)
  const checkHasDefinitions = useCallback(async () => {
    try {
      const results = await Promise.all(
        categories.map((cat) =>
          fetch(`/api/content-unit-definitions?category=${cat.value}`).then(
            (r) => r.json()
          )
        )
      );
      const total = results.reduce(
        (sum, data) => sum + (data.definitions?.length || 0),
        0
      );
      setHasAnyDefinitions(total > 0);
    } catch {
      // If check fails, hide seed button
      setHasAnyDefinitions(true);
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  useEffect(() => {
    checkHasDefinitions();
  }, [checkHasDefinitions]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      await fetch("/api/content-unit-definitions/seed", { method: "POST" });
      setHasAnyDefinitions(true);
      fetchDefinitions();
    } catch (err) {
      console.error("Failed to seed defaults:", err);
    } finally {
      setSeeding(false);
    }
  };

  const addDefinition = async () => {
    if (!newFormatName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/content-unit-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: activeCategory,
          formatName: newFormatName.trim(),
          description: newDescription.trim() || null,
          defaultContentUnits: parseFloat(newCost) || 1,
        }),
      });
      const data = await res.json();
      if (data.definition) {
        setDefinitions((prev) => [...prev, data.definition]);
        setNewFormatName("");
        setNewDescription("");
        setNewCost("");
        setHasAnyDefinitions(true);
      }
    } catch (err) {
      console.error("Failed to add definition:", err);
    } finally {
      setAdding(false);
    }
  };

  const deleteDefinition = async (id: string) => {
    try {
      await fetch(`/api/content-unit-definitions/${id}`, { method: "DELETE" });
      setDefinitions((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete definition:", err);
    }
  };

  const toggleActive = async (definition: Definition) => {
    try {
      const res = await fetch(`/api/content-unit-definitions/${definition.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !definition.isActive }),
      });
      const data = await res.json();
      if (data.definition) {
        setDefinitions((prev) =>
          prev.map((d) => (d.id === definition.id ? data.definition : d))
        );
      }
    } catch (err) {
      console.error("Failed to toggle active:", err);
    }
  };

  const startEdit = (definition: Definition) => {
    setEditingId(definition.id);
    setEditFormatName(definition.formatName);
    setEditDescription(definition.description || "");
    setEditCost(definition.defaultContentUnits.toFixed(2));
  };

  const saveEdit = async () => {
    if (!editingId || !editFormatName.trim()) return;
    try {
      const res = await fetch(`/api/content-unit-definitions/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatName: editFormatName.trim(),
          description: editDescription.trim() || null,
          defaultContentUnits: parseFloat(editCost) || 1,
        }),
      });
      const data = await res.json();
      if (data.definition) {
        setDefinitions((prev) =>
          prev.map((d) => (d.id === editingId ? data.definition : d))
        );
      }
    } catch (err) {
      console.error("Failed to update definition:", err);
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

    const reordered = [...definitions];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);

    setDefinitions(reordered);
    dragItem.current = null;
    dragOverItem.current = null;

    // Save new order
    try {
      await fetch("/api/content-unit-definitions/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((d) => d.id) }),
      });
    } catch (err) {
      console.error("Failed to reorder:", err);
      fetchDefinitions(); // Revert on failure
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Define content unit costs for each format. These values are used as
          defaults when commissioning content for customers.
        </p>
        {!hasAnyDefinitions && (
          <Button
            variant="outline"
            size="sm"
            onClick={seedDefaults}
            disabled={seeding}
            className="shrink-0 gap-1.5"
          >
            {seeding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Load Default Definitions
          </Button>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              activeCategory === cat.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Definitions List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {definitions.length === 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Boxes className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium mb-1">
                  No definitions for this category
                </p>
                <p className="text-xs text-muted-foreground">
                  Add content unit definitions to set default costs for each
                  format.
                </p>
              </CardContent>
            </Card>
          )}

          {definitions.map((definition, index) => (
            <Card
              key={definition.id}
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

                {editingId === definition.id ? (
                  /* Edit mode */
                  <>
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={editFormatName}
                        onChange={(e) => setEditFormatName(e.target.value)}
                        placeholder="Format name"
                        className="flex-1 h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <Input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Description"
                        className="flex-1 h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        value={editCost}
                        onChange={(e) => setEditCost(e.target.value)}
                        className="w-20 h-8 text-sm text-right"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    </div>
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
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">
                        {definition.formatName}
                      </span>
                      {definition.description && (
                        <span className="text-xs text-muted-foreground truncate block">
                          {definition.description}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-mono text-muted-foreground shrink-0">
                      {definition.defaultContentUnits.toFixed(2)} CU
                    </span>
                    <Badge
                      variant="secondary"
                      className={`cursor-pointer select-none border-0 text-[10px] shrink-0 ${
                        definition.isActive
                          ? "bg-green-500/10 text-green-500"
                          : "bg-gray-500/10 text-gray-500"
                      }`}
                      onClick={() => toggleActive(definition)}
                    >
                      {definition.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <button
                      onClick={() => startEdit(definition)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteDefinition(definition.id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Add new definition */}
          <Card className="border-0 shadow-sm border-dashed">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={newFormatName}
                  onChange={(e) => setNewFormatName(e.target.value)}
                  placeholder="Format name..."
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDefinition();
                  }}
                />
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Description..."
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDefinition();
                  }}
                />
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  placeholder="1.00"
                  className="w-20 h-8 text-sm text-right"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDefinition();
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addDefinition}
                  disabled={!newFormatName.trim() || adding}
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
