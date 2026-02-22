"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  TrendingUp,
  FileText,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

const statusColors: Record<string, string> = {
  submitted: "bg-blue-500/10 text-blue-500",
  shortlisted: "bg-amber-500/10 text-amber-500",
  commissioned: "bg-green-500/10 text-green-500",
  rejected: "bg-red-500/10 text-red-500",
};

const statusFlow = ["submitted", "shortlisted", "commissioned", "rejected"];

export default function IdeaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ideaId = params.id as string;

  const [idea, setIdea] = useState<any>(null);
  const [contentObjects, setContentObjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [commissioning, setCommissioning] = useState(false);
  const [showCommissionDialog, setShowCommissionDialog] = useState(false);
  const [commissionContentType, setCommissionContentType] = useState("article");

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topicTags, setTopicTags] = useState<string[]>([]);
  const [strategicTags, setStrategicTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [strategicInput, setStrategicInput] = useState("");

  const fetchIdea = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`);
      const data = await res.json();
      if (data.idea) {
        setIdea(data.idea);
        setTitle(data.idea.title);
        setDescription(data.idea.description || "");
        setTopicTags(data.idea.topicTags || []);
        setStrategicTags(data.idea.strategicTags || []);
      }
      setContentObjects(data.contentObjects || []);
    } catch (err) {
      console.error("Failed to fetch idea:", err);
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => {
    fetchIdea();
  }, [fetchIdea]);

  const saveIdea = async (updates: any) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.idea) setIdea(data.idea);
    } catch (err) {
      console.error("Failed to save idea:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    await saveIdea({ status: newStatus });
  };

  const handleAutoTag = async () => {
    setAutoTagging(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto-tag", title, description }),
      });
      const data = await res.json();
      if (data.topicTags?.length) {
        setTopicTags(data.topicTags);
        await saveIdea({ topicTags: data.topicTags, strategicTags: data.strategicTags || strategicTags });
      }
      if (data.strategicTags?.length) {
        setStrategicTags(data.strategicTags);
      }
    } catch (err) {
      console.error("Auto-tag failed:", err);
    } finally {
      setAutoTagging(false);
    }
  };

  const handleScore = async () => {
    setScoring(true);
    try {
      // Optionally fetch performance model
      let performanceModel = null;
      try {
        const modelRes = await fetch("/api/profile-performance");
        const modelData = await modelRes.json();
        performanceModel = modelData.model;
      } catch {}

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "score-idea",
          title,
          description,
          topicTags,
          performanceModel,
        }),
      });
      const data = await res.json();
      if (data.score !== undefined) {
        await saveIdea({ predictedEngagementScore: data.score });
      }
    } catch (err) {
      console.error("Scoring failed:", err);
    } finally {
      setScoring(false);
    }
  };

  const handleCommission = async () => {
    setCommissioning(true);
    try {
      const res = await fetch(`/api/ideas/${ideaId}/commission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: commissionContentType }),
      });
      const data = await res.json();
      if (data.contentObject?.id) {
        router.push(`/content/${data.contentObject.id}`);
      }
    } catch (err) {
      console.error("Commission failed:", err);
    } finally {
      setCommissioning(false);
      setShowCommissionDialog(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this idea?")) return;
    try {
      await fetch(`/api/ideas/${ideaId}`, { method: "DELETE" });
      router.push("/ideas");
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleSaveFields = () => {
    saveIdea({ title, description, topicTags, strategicTags });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!idea) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-center text-muted-foreground py-16">Idea not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">Idea Details</h1>
              <Badge
                variant="secondary"
                className={`${statusColors[idea.status] || ""} border-0 capitalize`}
              >
                {idea.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Created {new Date(idea.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={contentObjects.length > 0}
            className="gap-2 text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleSaveFields}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={handleSaveFields}
                  rows={4}
                  className="mt-1"
                />
              </div>

              {/* Topic Tags */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Topic Tags</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAutoTag}
                    disabled={autoTagging}
                    className="gap-1 text-xs h-7"
                  >
                    {autoTagging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Auto-tag
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {topicTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-blue-500/10 text-blue-500 rounded-full px-2.5 py-1 flex items-center gap-1"
                    >
                      {tag}
                      <button onClick={() => {
                        const next = topicTags.filter((t) => t !== tag);
                        setTopicTags(next);
                        saveIdea({ topicTags: next });
                      }}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add topic tag..."
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const tag = tagInput.trim().toLowerCase();
                      if (tag && !topicTags.includes(tag)) {
                        const next = [...topicTags, tag];
                        setTopicTags(next);
                        setTagInput("");
                        saveIdea({ topicTags: next });
                      }
                    }
                  }}
                />
              </div>

              {/* Strategic Tags */}
              <div>
                <label className="text-sm font-medium">Strategic Tags</label>
                <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                  {strategicTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-purple-500/10 text-purple-500 rounded-full px-2.5 py-1 flex items-center gap-1"
                    >
                      {tag}
                      <button onClick={() => {
                        const next = strategicTags.filter((t) => t !== tag);
                        setStrategicTags(next);
                        saveIdea({ strategicTags: next });
                      }}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  value={strategicInput}
                  onChange={(e) => setStrategicInput(e.target.value)}
                  placeholder="Add strategic tag..."
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const tag = strategicInput.trim().toLowerCase();
                      if (tag && !strategicTags.includes(tag)) {
                        const next = [...strategicTags, tag];
                        setStrategicTags(next);
                        setStrategicInput("");
                        saveIdea({ strategicTags: next });
                      }
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Linked Content Objects */}
          {contentObjects.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Linked Content</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contentObjects.map((obj: any) => (
                  <Link
                    key={obj.id}
                    href={`/content/${obj.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{obj.workingTitle}</p>
                      <p className="text-xs text-muted-foreground capitalize">{obj.status}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {obj.contentType}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Score */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Engagement Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              {idea.predictedEngagementScore ? (
                <div className="text-center">
                  <p className="text-4xl font-bold">
                    {Math.round(idea.predictedEngagementScore)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">out of 100</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  Not scored yet
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleScore}
                disabled={scoring}
                className="w-full mt-3 gap-2"
              >
                {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {idea.predictedEngagementScore ? "Re-score" : "Score with AI"}
              </Button>
            </CardContent>
          </Card>

          {/* Status Actions */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Status Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {idea.status === "submitted" && (
                <>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleStatusChange("shortlisted")}
                    disabled={saving}
                  >
                    Shortlist
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleStatusChange("rejected")}
                    disabled={saving}
                  >
                    Reject
                  </Button>
                </>
              )}
              {idea.status === "shortlisted" && !showCommissionDialog && (
                <>
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => setShowCommissionDialog(true)}
                  >
                    Commission Content
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleStatusChange("rejected")}
                    disabled={saving}
                  >
                    Reject
                  </Button>
                </>
              )}
              {idea.status === "shortlisted" && showCommissionDialog && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Content Type</label>
                    <select
                      value={commissionContentType}
                      onChange={(e) => setCommissionContentType(e.target.value)}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      {["article", "video", "graphic", "thread", "newsletter", "podcast", "other"].map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={handleCommission}
                    disabled={commissioning}
                  >
                    {commissioning && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create Content
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowCommissionDialog(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              {idea.status === "rejected" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleStatusChange("submitted")}
                  disabled={saving}
                >
                  Reopen
                </Button>
              )}
              {idea.status === "commissioned" && (
                <p className="text-sm text-muted-foreground text-center">
                  This idea has been commissioned into content.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Source</span>
                <span className="capitalize">{idea.sourceType}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(idea.createdAt).toLocaleDateString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{new Date(idea.updatedAt).toLocaleDateString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Content Objects</span>
                <span>{contentObjects.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
