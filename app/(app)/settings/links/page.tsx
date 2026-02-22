"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Loader2,
  GripVertical,
  Trash2,
  Pencil,
  Check,
  X,
  Copy,
  ExternalLink,
  Link2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ProfileLink {
  id: string;
  title: string;
  url: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function LinksSettingsPage() {
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceSlug, setWorkspaceSlug] = useState("");

  // New link form
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIcon, setEditIcon] = useState("");

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch("/api/profile-links");
      const data = await res.json();
      setLinks(data.links || []);
    } catch {
      console.error("Failed to fetch links");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace");
      const data = await res.json();
      setWorkspaceSlug(data.workspace?.slug || "");
    } catch {}
  }, []);

  useEffect(() => {
    fetchLinks();
    fetchWorkspace();
  }, [fetchLinks, fetchWorkspace]);

  const publicUrl = workspaceSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/links/${workspaceSlug}`
    : "";

  const copyPublicUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Link copied to clipboard");
  };

  const addLink = async () => {
    if (!newTitle.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/profile-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), url: newUrl.trim() }),
      });
      const data = await res.json();
      if (data.link) {
        setLinks((prev) => [...prev, data.link]);
        setNewTitle("");
        setNewUrl("");
        toast.success("Link added");
      }
    } catch {
      toast.error("Failed to add link");
    } finally {
      setAdding(false);
    }
  };

  const deleteLink = async (id: string) => {
    try {
      await fetch(`/api/profile-links/${id}`, { method: "DELETE" });
      setLinks((prev) => prev.filter((l) => l.id !== id));
      toast.success("Link removed");
    } catch {
      toast.error("Failed to delete link");
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/profile-links/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await res.json();
      if (data.link) {
        setLinks((prev) => prev.map((l) => (l.id === id ? data.link : l)));
      }
    } catch {
      toast.error("Failed to update link");
    }
  };

  const startEdit = (link: ProfileLink) => {
    setEditingId(link.id);
    setEditTitle(link.title);
    setEditUrl(link.url);
    setEditDescription(link.description || "");
    setEditIcon(link.icon || "");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim() || !editUrl.trim()) return;
    try {
      const res = await fetch(`/api/profile-links/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          url: editUrl.trim(),
          description: editDescription.trim() || null,
          icon: editIcon.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.link) {
        setLinks((prev) => prev.map((l) => (l.id === editingId ? data.link : l)));
        toast.success("Link updated");
      }
    } catch {
      toast.error("Failed to update link");
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

    const reordered = [...links];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);

    setLinks(reordered);
    dragItem.current = null;
    dragOverItem.current = null;

    try {
      await fetch("/api/profile-links/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((l) => l.id) }),
      });
    } catch {
      fetchLinks();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Create a link-in-bio page to share across your social profiles.
      </p>

      {/* Public URL */}
      {publicUrl && (
        <Card className="border-0 shadow-sm bg-gradient-to-r from-blue-500/5 via-violet-500/5 to-pink-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shrink-0">
                <Link2 className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Your public page</p>
                <p className="text-sm font-mono truncate">{publicUrl}</p>
              </div>
              <Button variant="outline" size="sm" onClick={copyPublicUrl} className="gap-1.5 shrink-0">
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Links list */}
      <div className="space-y-2">
        {links.length === 0 && (
          <Card className="border-dashed border-2 border-muted-foreground/20">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Link2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium mb-1">No links yet</p>
              <p className="text-xs text-muted-foreground">
                Add links to build your link-in-bio page.
              </p>
            </CardContent>
          </Card>
        )}

        {links.map((link, index) => (
          <Card
            key={link.id}
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

              {editingId === link.id ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title"
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Input
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder="https://..."
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={editIcon}
                      onChange={(e) => setEditIcon(e.target.value)}
                      placeholder="Icon/emoji (optional)"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="text-green-500 hover:text-green-600">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {link.icon && (
                    <span className="text-lg shrink-0">{link.icon}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${!link.isActive ? "text-muted-foreground line-through" : ""}`}>
                      {link.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                  </div>
                  <button
                    onClick={() => toggleActive(link.id, link.isActive)}
                    className={`h-5 w-9 rounded-full transition-colors shrink-0 relative ${
                      link.isActive ? "bg-blue-500" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        link.isActive ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                  <button onClick={() => startEdit(link)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteLink(link.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Add new link */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Link title"
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") addLink(); }}
              />
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") addLink(); }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addLink}
                disabled={!newTitle.trim() || !newUrl.trim() || adding}
                className="h-8 gap-1 shrink-0"
              >
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
