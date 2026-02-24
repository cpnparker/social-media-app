"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  TrendingUp,
  FileText,
  Trash2,
  X,
  ImagePlus,
  Upload,
  Search,
  Wand2,
  ExternalLink,
  Calendar,
  Flag,
  Hash,
  Rocket,
  BarChart3,
  Clock,
  LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  submitted: { color: "text-blue-600", bg: "bg-blue-500/10", label: "New" },
  commissioned: { color: "text-green-600", bg: "bg-green-500/10", label: "Commissioned" },
  rejected: { color: "text-red-500", bg: "bg-red-500/10", label: "Spiked" },
  shortlisted: { color: "text-amber-500", bg: "bg-amber-500/10", label: "Pending" },
};

const contentTypes = [
  { value: "article", label: "Article", icon: "📝" },
  { value: "video", label: "Video", icon: "🎬" },
  { value: "graphic", label: "Graphic", icon: "🎨" },
  { value: "thread", label: "Thread", icon: "🧵" },
  { value: "newsletter", label: "Newsletter", icon: "📧" },
  { value: "podcast", label: "Podcast", icon: "🎙️" },
  { value: "other", label: "Other", icon: "📋" },
];

// Auto-linkify URLs in text
function LinkifiedText({ text }: { text: string }) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,;:!?)}\]"'])/g;
  const parts = text.split(urlRegex);

  return (
    <span>
      {parts.map((part, i) => {
        if (urlRegex.test(part)) {
          urlRegex.lastIndex = 0;
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 underline underline-offset-2 inline-flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {part.length > 60 ? part.substring(0, 57) + "..." : part}
              <ExternalLink className="h-3 w-3 inline shrink-0" />
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Tag input component with colored styling
function TagSection({
  label,
  icon,
  tags,
  color,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  icon: React.ReactNode;
  tags: string[];
  color: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <label className="text-sm font-medium text-foreground/80">{label}</label>
        <span className="text-xs text-muted-foreground ml-auto">{tags.length}</span>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`text-xs ${color} rounded-full px-2.5 py-1 flex items-center gap-1 font-medium`}
            >
              {tag}
              <button
                onClick={() => onRemove(tag)}
                className="hover:opacity-70 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm bg-muted/30 border-dashed"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const tag = inputValue.trim().toLowerCase();
            if (tag && !tags.includes(tag)) {
              onAdd(tag);
            }
          }
        }}
      />
    </div>
  );
}

export default function IdeaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ideaId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [idea, setIdea] = useState<any>(null);
  const [contentObjects, setContentObjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [commissioning, setCommissioning] = useState(false);
  const [commissionContentType, setCommissionContentType] = useState("article");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);

  // Customer & Contract state for commission
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerContracts, setCustomerContracts] = useState<any[]>([]);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [cuCost, setCuCost] = useState<string>("");
  const [cuDefinitions, setCuDefinitions] = useState<any[]>([]);
  const [contractBalance, setContractBalance] = useState<{ total: number; used: number; remaining: number } | null>(null);

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [topicTags, setTopicTags] = useState<string[]>([]);
  const [strategicTags, setStrategicTags] = useState<string[]>([]);
  const [eventTags, setEventTags] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [campaignInput, setCampaignInput] = useState("");
  const [eventInput, setEventInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);

  const fetchIdea = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`);
      const data = await res.json();
      if (data.idea) {
        setIdea(data.idea);
        setTitle(data.idea.title);
        setDescription(data.idea.description || "");
        setImageUrl(data.idea.imageUrl || "");
        setTopicTags(data.idea.topicTags || []);
        setStrategicTags(data.idea.strategicTags || []);
        setEventTags(data.idea.eventTags || []);
        if (data.idea.customerId) setSelectedCustomerId(data.idea.customerId);
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

  // Fetch customers
  useEffect(() => {
    fetch("/api/customers?status=active&limit=200")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers || []))
      .catch(() => {});
  }, []);

  // Fetch CU definitions
  useEffect(() => {
    fetch("/api/content-unit-definitions")
      .then((r) => r.json())
      .then((d) => setCuDefinitions(d.definitions || []))
      .catch(() => {});
  }, []);

  // When customer changes, fetch their contracts
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerContracts([]);
      setSelectedContractId("");
      setContractBalance(null);
      return;
    }
    fetch(`/api/customers/${selectedCustomerId}/contracts`)
      .then((r) => r.json())
      .then((d) => {
        const active = (d.contracts || []).filter((c: any) => c.status === "active");
        setCustomerContracts(active);
        if (active.length === 1) {
          setSelectedContractId(active[0].id);
          const total = (active[0].totalContentUnits || 0) + (active[0].rolloverUnits || 0);
          const used = active[0].usedContentUnits || 0;
          setContractBalance({ total, used, remaining: total - used });
        } else {
          setSelectedContractId("");
          setContractBalance(null);
        }
      })
      .catch(() => {});
  }, [selectedCustomerId]);

  // When contract changes, update balance
  useEffect(() => {
    if (!selectedContractId) {
      setContractBalance(null);
      return;
    }
    const c = customerContracts.find((ct: any) => ct.id === selectedContractId);
    if (c) {
      const total = (c.totalContentUnits || 0) + (c.rolloverUnits || 0);
      const used = c.usedContentUnits || 0;
      setContractBalance({ total, used, remaining: total - used });
    }
  }, [selectedContractId, customerContracts]);

  // Auto-fill CU cost when content type changes
  useEffect(() => {
    if (cuDefinitions.length > 0 && commissionContentType) {
      // Find a matching definition by category or name
      const match = cuDefinitions.find((d: any) =>
        d.formatName?.toLowerCase().includes(commissionContentType) ||
        d.category === commissionContentType
      );
      if (match) {
        setCuCost(String(match.defaultContentUnits));
      }
    }
  }, [commissionContentType, cuDefinitions]);

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

  const handleAutoTag = async () => {
    setAutoTagging(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto-tag", title, description }),
      });
      const data = await res.json();
      const newTopics = data.topicTags || topicTags;
      const newCampaigns = data.strategicTags || strategicTags;
      setTopicTags(newTopics);
      setStrategicTags(newCampaigns);
      await saveIdea({ topicTags: newTopics, strategicTags: newCampaigns });
    } catch (err) {
      console.error("Auto-tag failed:", err);
    } finally {
      setAutoTagging(false);
    }
  };

  const handleScore = async () => {
    setScoring(true);
    try {
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
      const payload: any = { contentType: commissionContentType };
      if (selectedCustomerId) payload.customerId = selectedCustomerId;
      if (selectedContractId) payload.contractId = selectedContractId;
      if (cuCost) payload.contentUnits = parseFloat(cuCost);

      const res = await fetch(`/api/ideas/${ideaId}/commission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        setCommissioning(false);
        return;
      }
      if (data.contentObject?.id) {
        router.push(`/content/${data.contentObject.id}`);
      }
    } catch (err) {
      console.error("Commission failed:", err);
    } finally {
      setCommissioning(false);
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

  const handleImageUpload = async (file: File) => {
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        setImageUrl(data.url);
        await saveIdea({ imageUrl: data.url });
      }
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleGenerateImageSuggestions = async () => {
    setGeneratingImage(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          topic: `Suggest 3 image search keywords for a content piece titled "${title}". ${description ? `Description: ${description.substring(0, 200)}` : ""}. Return ONLY a comma-separated list of 3 search terms, nothing else.`,
          platform: "internal",
        }),
      });
      const data = await res.json();
      if (data.content) {
        const searchQuery = encodeURIComponent(data.content.split(",")[0]?.trim() || title);
        window.open(`https://unsplash.com/s/photos/${searchQuery}`, "_blank");
      }
    } catch (err) {
      console.error("Image suggestion failed:", err);
      // Fallback: open search with title
      const searchQuery = encodeURIComponent(title);
      window.open(`https://unsplash.com/s/photos/${searchQuery}`, "_blank");
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleRemoveImage = async () => {
    setImageUrl("");
    await saveIdea({ imageUrl: "" });
  };

  const handleSaveFields = () => {
    saveIdea({ title, description, topicTags, strategicTags, eventTags, imageUrl });
  };

  const canCommission = idea && idea.status !== "commissioned" && idea.status !== "rejected";
  const isCommissioned = idea?.status === "commissioned";
  const isRejected = idea?.status === "rejected";

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

  const statusInfo = statusConfig[idea.status] || statusConfig.submitted;
  const score = idea.predictedEngagementScore;
  const scoreColor = score >= 70 ? "text-green-500" : score >= 40 ? "text-amber-500" : "text-red-400";

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Top navigation bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Ideas
        </button>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          <Badge
            variant="secondary"
            className={`${statusInfo.bg} ${statusInfo.color} border-0 capitalize font-medium`}
          >
            {statusInfo.label}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ───── LEFT: Main content ───── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Image Section */}
          <Card className="border-0 shadow-sm overflow-hidden">
            {imageUrl ? (
              <div className="relative group">
                <img
                  src={imageUrl}
                  alt={title}
                  className="w-full h-56 object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 bg-white/90 hover:bg-white text-gray-900"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 bg-white/90 hover:bg-white text-red-600"
                    onClick={handleRemoveImage}
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="h-44 bg-gradient-to-br from-muted/50 to-muted flex flex-col items-center justify-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-muted-foreground/10 flex items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">Add a cover image for this idea</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                  >
                    {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={handleGenerateImageSuggestions}
                    disabled={generatingImage}
                  >
                    {generatingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    AI Search
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => {
                      const query = encodeURIComponent(title);
                      window.open(`https://unsplash.com/s/photos/${query}`, "_blank");
                    }}
                  >
                    <Search className="h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
                e.target.value = "";
              }}
            />
          </Card>

          {/* Title & Description */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleSaveFields}
                  className="text-lg font-semibold border-0 px-0 h-auto focus-visible:ring-0 bg-transparent shadow-none"
                  placeholder="Idea title..."
                />
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-sm font-medium text-muted-foreground">Description</label>
                  </div>
                  {description && !editingDescription && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setEditingDescription(true)}
                    >
                      Edit
                    </Button>
                  )}
                </div>

                {editingDescription || !description ? (
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => {
                      handleSaveFields();
                      if (description) setEditingDescription(false);
                    }}
                    onFocus={() => setEditingDescription(true)}
                    rows={5}
                    placeholder="Describe your idea... URLs will be automatically linked."
                    className="resize-none text-sm"
                  />
                ) : (
                  <div
                    className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed cursor-text min-h-[80px] p-3 rounded-md hover:bg-muted/30 transition-colors"
                    onClick={() => setEditingDescription(true)}
                  >
                    <LinkifiedText text={description} />
                  </div>
                )}

                {description && !editingDescription && (
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <LinkIcon className="h-3 w-3" />
                    URLs are automatically linked
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tags: Topics, Campaigns, Events */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Classification</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAutoTag}
                  disabled={autoTagging}
                  className="gap-1.5 text-xs h-7"
                >
                  {autoTagging ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-violet-500" />
                  )}
                  AI Auto-tag
                </Button>
              </div>

              <div className="space-y-4">
                <TagSection
                  label="Topics"
                  icon={<Hash className="h-3.5 w-3.5 text-blue-500" />}
                  tags={topicTags}
                  color="bg-blue-500/10 text-blue-600"
                  inputValue={topicInput}
                  onInputChange={setTopicInput}
                  onAdd={(tag) => {
                    const next = [...topicTags, tag];
                    setTopicTags(next);
                    setTopicInput("");
                    saveIdea({ topicTags: next });
                  }}
                  onRemove={(tag) => {
                    const next = topicTags.filter((t) => t !== tag);
                    setTopicTags(next);
                    saveIdea({ topicTags: next });
                  }}
                  placeholder="Add topic (press Enter)..."
                />

                <Separator className="my-1" />

                <TagSection
                  label="Campaigns"
                  icon={<Flag className="h-3.5 w-3.5 text-purple-500" />}
                  tags={strategicTags}
                  color="bg-purple-500/10 text-purple-600"
                  inputValue={campaignInput}
                  onInputChange={setCampaignInput}
                  onAdd={(tag) => {
                    const next = [...strategicTags, tag];
                    setStrategicTags(next);
                    setCampaignInput("");
                    saveIdea({ strategicTags: next });
                  }}
                  onRemove={(tag) => {
                    const next = strategicTags.filter((t) => t !== tag);
                    setStrategicTags(next);
                    saveIdea({ strategicTags: next });
                  }}
                  placeholder="Add campaign (press Enter)..."
                />

                <Separator className="my-1" />

                <TagSection
                  label="Events"
                  icon={<Calendar className="h-3.5 w-3.5 text-amber-500" />}
                  tags={eventTags}
                  color="bg-amber-500/10 text-amber-600"
                  inputValue={eventInput}
                  onInputChange={setEventInput}
                  onAdd={(tag) => {
                    const next = [...eventTags, tag];
                    setEventTags(next);
                    setEventInput("");
                    saveIdea({ eventTags: next });
                  }}
                  onRemove={(tag) => {
                    const next = eventTags.filter((t) => t !== tag);
                    setEventTags(next);
                    saveIdea({ eventTags: next });
                  }}
                  placeholder="Add event (press Enter)..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Linked Content Objects */}
          {contentObjects.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-5 pt-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Commissioned Content
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {contentObjects.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                {contentObjects.map((obj: any) => (
                  <Link
                    key={obj.id}
                    href={`/content/${obj.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors group"
                  >
                    <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-foreground">
                        {obj.workingTitle || obj.finalTitle}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{obj.status?.replace("_", " ")}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
                      {obj.contentType}
                    </Badge>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ───── RIGHT: Sidebar ───── */}
        <div className="space-y-5">

          {/* Commission CTA — the primary action */}
          {canCommission && (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-500/5 via-blue-500/5 to-cyan-500/5 ring-1 ring-violet-500/20">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Rocket className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Commission Content</h3>
                    <p className="text-[11px] text-muted-foreground">Turn this idea into content</p>
                  </div>
                </div>

                {/* Customer selector */}
                {customers.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Customer</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        saveIdea({ customerId: e.target.value || null });
                      }}
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">No customer</option>
                      {customers.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Contract selector (shown if customer selected) */}
                {selectedCustomerId && customerContracts.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contract</label>
                    <select
                      value={selectedContractId}
                      onChange={(e) => setSelectedContractId(e.target.value)}
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">Select contract...</option>
                      {customerContracts.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({((c.totalContentUnits || 0) + (c.rolloverUnits || 0) - (c.usedContentUnits || 0)).toFixed(1)} CU left)
                        </option>
                      ))}
                    </select>
                    {contractBalance && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              contractBalance.remaining < parseFloat(cuCost || "0")
                                ? "bg-red-500"
                                : "bg-blue-500"
                            }`}
                            style={{ width: `${contractBalance.total > 0 ? Math.min(100, (contractBalance.used / contractBalance.total) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {contractBalance.remaining.toFixed(1)} CU left
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* CU cost */}
                {selectedContractId && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Content Units Cost</label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      value={cuCost}
                      onChange={(e) => setCuCost(e.target.value)}
                      placeholder="e.g. 1.0"
                      className="h-8 text-sm"
                    />
                    {contractBalance && cuCost && parseFloat(cuCost) > contractBalance.remaining && (
                      <p className="text-[11px] text-red-500 mt-1 font-medium">
                        ⚠ Insufficient balance ({contractBalance.remaining.toFixed(1)} CU available)
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Content Type</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {contentTypes.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => setCommissionContentType(type.value)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                          commissionContentType === type.value
                            ? "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <span>{type.icon}</span>
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-md"
                  onClick={handleCommission}
                  disabled={commissioning || (!!selectedContractId && !!cuCost && contractBalance !== null && parseFloat(cuCost) > contractBalance.remaining)}
                >
                  {commissioning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  Commission {contentTypes.find((t) => t.value === commissionContentType)?.label}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Already commissioned message */}
          {isCommissioned && contentObjects.length > 0 && (
            <Card className="border-0 shadow-sm bg-green-500/5 ring-1 ring-green-500/20">
              <CardContent className="p-5 text-center space-y-3">
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <Rocket className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700">Commissioned</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This idea is now in production
                  </p>
                </div>
                <Link href={`/content/${contentObjects[0].id}`}>
                  <Button variant="outline" size="sm" className="gap-1.5 w-full">
                    <FileText className="h-3.5 w-3.5" />
                    View Content
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Engagement Score */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">Engagement Score</h3>
              </div>

              {score ? (
                <div className="flex items-center gap-4 mb-3">
                  <div className="relative h-16 w-16 shrink-0">
                    <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/50" />
                      <circle
                        cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4"
                        className={scoreColor}
                        strokeDasharray={`${(score / 100) * 175.9} 175.9`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-lg font-bold ${scoreColor}`}>{Math.round(score)}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Predicted engagement</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {score >= 70 ? "High potential" : score >= 40 ? "Moderate potential" : "Low potential"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-3 p-3 rounded-lg bg-muted/30">
                  <TrendingUp className="h-5 w-5 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Not yet scored. Use AI to predict engagement.</p>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleScore}
                disabled={scoring}
                className="w-full gap-2"
              >
                {scoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                )}
                {score ? "Re-score" : "Score with AI"}
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-2">
              <h3 className="text-sm font-semibold mb-3">Actions</h3>

              {isRejected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => saveIdea({ status: "submitted" })}
                  disabled={saving}
                >
                  Reopen Idea
                </Button>
              )}

              {!isCommissioned && !isRejected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-red-500 hover:text-red-600 hover:bg-red-500/5"
                  onClick={() => saveIdea({ status: "rejected" })}
                  disabled={saving}
                >
                  Spike Idea
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={contentObjects.length > 0}
                className="w-full gap-2 text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>

              {contentObjects.length > 0 && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Cannot delete — has commissioned content
                </p>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold mb-3">Details</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Hash className="h-3 w-3" /> Source
                  </span>
                  <span className="capitalize text-foreground/80">{idea.sourceType}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Created
                  </span>
                  <span className="text-foreground/80">
                    {new Date(idea.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Updated
                  </span>
                  <span className="text-foreground/80">
                    {new Date(idea.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
