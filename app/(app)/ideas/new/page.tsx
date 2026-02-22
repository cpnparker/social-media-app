"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function NewIdeaPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [topicTags, setTopicTags] = useState<string[]>([]);
  const [strategicTags, setStrategicTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [strategicInput, setStrategicInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);

  const addTag = (
    input: string,
    setter: (fn: (prev: string[]) => string[]) => void,
    inputSetter: (v: string) => void
  ) => {
    const tag = input.trim().toLowerCase();
    if (tag) {
      setter((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
      inputSetter("");
    }
  };

  const removeTag = (
    tag: string,
    setter: (fn: (prev: string[]) => string[]) => void
  ) => {
    setter((prev) => prev.filter((t) => t !== tag));
  };

  const handleAutoTag = async () => {
    if (!title) return;
    setAutoTagging(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto-tag",
          title,
          description,
        }),
      });
      const data = await res.json();
      if (data.topicTags?.length) setTopicTags(data.topicTags);
      if (data.strategicTags?.length) setStrategicTags(data.strategicTags);
    } catch (err) {
      console.error("Auto-tag failed:", err);
    } finally {
      setAutoTagging(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          sourceType,
          topicTags,
          strategicTags,
        }),
      });
      const data = await res.json();
      if (data.idea?.id) {
        router.push(`/ideas/${data.idea.id}`);
      }
    } catch (err) {
      console.error("Failed to create idea:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="h-9 w-9"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">New Idea</h1>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Idea Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the content idea?"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the idea in more detail..."
              rows={4}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Source Type</Label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="rss">RSS Feed</option>
              <option value="email">Email</option>
              <option value="api">API</option>
              <option value="internal">Internal / AI</option>
            </select>
          </div>

          {/* Topic Tags */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Topic Tags</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAutoTag}
                disabled={autoTagging || !title}
                className="gap-1.5 text-xs h-7"
              >
                {autoTagging ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Auto-tag with AI
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
              {topicTags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-blue-500/10 text-blue-500 rounded-full px-2.5 py-1 flex items-center gap-1"
                >
                  {tag}
                  <button onClick={() => removeTag(tag, setTopicTags)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add a topic tag..."
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagInput, setTopicTags, setTagInput);
                }
              }}
            />
          </div>

          {/* Strategic Tags */}
          <div>
            <Label>Strategic Tags</Label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
              {strategicTags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-purple-500/10 text-purple-500 rounded-full px-2.5 py-1 flex items-center gap-1"
                >
                  {tag}
                  <button onClick={() => removeTag(tag, setStrategicTags)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={strategicInput}
              onChange={(e) => setStrategicInput(e.target.value)}
              placeholder="Add a strategic tag..."
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(strategicInput, setStrategicTags, setStrategicInput);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!title.trim() || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Create Idea
        </Button>
      </div>
    </div>
  );
}
