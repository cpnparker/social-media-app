"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import {
  Send,
  Clock,
  Image as ImageIcon,
  X,
  Loader2,
  CheckCircle2,
  CalendarDays,
  Globe,
  Hash,
  Sparkles,
  Wand2,
  RefreshCw,
  ArrowRight,
  Zap,
  Type,
  MessageSquare,
  PenLine,
  Laugh,
  Briefcase,
  Target,
  Clock3,
  Eye,
  EyeOff,
  Video,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import LivePreviewPanel from "@/components/compose/LivePreviewPanel";

interface Account {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  profileId?: string;
}

interface MediaItem {
  url: string;
  altText?: string;
  contentType?: string;
  filename?: string;
}

const platformLimits: Record<string, number> = {
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
  reddit: 40000,
  bluesky: 300,
  threads: 500,
  googlebusiness: 1500,
  telegram: 4096,
  snapchat: 250,
};

const platformMeta: Record<
  string,
  { name: string; color: string; bgColor: string; icon: string }
> = {
  twitter: { name: "Twitter / X", color: "#1DA1F2", bgColor: "bg-sky-500/10", icon: "\u{1D54F}" },
  instagram: { name: "Instagram", color: "#E4405F", bgColor: "bg-pink-500/10", icon: "\uD83D\uDCF7" },
  facebook: { name: "Facebook", color: "#1877F2", bgColor: "bg-blue-600/10", icon: "f" },
  linkedin: { name: "LinkedIn", color: "#0A66C2", bgColor: "bg-blue-700/10", icon: "in" },
  tiktok: { name: "TikTok", color: "#000000", bgColor: "bg-gray-900/10", icon: "\u266A" },
  youtube: { name: "YouTube", color: "#FF0000", bgColor: "bg-red-500/10", icon: "\u25B6" },
  pinterest: { name: "Pinterest", color: "#BD081C", bgColor: "bg-red-600/10", icon: "P" },
  reddit: { name: "Reddit", color: "#FF4500", bgColor: "bg-orange-500/10", icon: "R" },
  bluesky: { name: "Bluesky", color: "#0085FF", bgColor: "bg-blue-500/10", icon: "\uD83E\uDD8B" },
  threads: { name: "Threads", color: "#000000", bgColor: "bg-gray-900/10", icon: "@" },
  googlebusiness: { name: "Google Business", color: "#4285F4", bgColor: "bg-blue-500/10", icon: "G" },
  telegram: { name: "Telegram", color: "#26A5E4", bgColor: "bg-cyan-500/10", icon: "\u2708" },
  snapchat: { name: "Snapchat", color: "#FFFC00", bgColor: "bg-yellow-400/10", icon: "\uD83D\uDC7B" },
};

const rewriteStyles = [
  { key: "shorter", label: "Shorter", icon: Type, desc: "More concise" },
  { key: "longer", label: "Longer", icon: MessageSquare, desc: "More detail" },
  { key: "casual", label: "Casual", icon: Laugh, desc: "Friendly tone" },
  { key: "professional", label: "Professional", icon: Briefcase, desc: "Polished" },
  { key: "engaging", label: "Engaging", icon: Target, desc: "Better hook" },
  { key: "witty", label: "Witty", icon: Sparkles, desc: "Add humor" },
];

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <ComposePageInner />
    </Suspense>
  );
}

function ComposePageInner() {
  const searchParams = useSearchParams();
  const [content, setContent] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // Media drag reorder
  const [dragMediaIndex, setDragMediaIndex] = useState<number | null>(null);

  // Alt text dialog
  const [altTextIndex, setAltTextIndex] = useState<number | null>(null);
  const [altTextDraft, setAltTextDraft] = useState("");

  // Preview toggle
  const [showPreview, setShowPreview] = useState(true);

  // AI state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [suggestedHashtags, setSuggestedHashtags] = useState<string[]>([]);
  const [bestTimeData, setBestTimeData] = useState<any>(null);
  const [loadingBestTime, setLoadingBestTime] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (data.accounts) {
        setAccounts(
          data.accounts.map((a: any) => ({
            _id: a._id,
            platform: a.platform,
            username: a.username,
            displayName: a.displayName,
            avatarUrl: a.avatarUrl,
            profileId:
              typeof a.profileId === "object" ? a.profileId?._id : a.profileId,
          }))
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Prefill from query params (e.g. from promo drafts)
  useEffect(() => {
    const prefillContent = searchParams.get("prefillContent");
    const prefillPlatform = searchParams.get("platform");
    if (prefillContent) {
      setContent(decodeURIComponent(prefillContent));
    }
    if (prefillPlatform && accounts.length > 0) {
      const matchingAccount = accounts.find(
        (a) => a.platform?.toLowerCase() === prefillPlatform.toLowerCase()
      );
      if (matchingAccount && !selectedAccounts.includes(matchingAccount._id)) {
        setSelectedAccounts((prev) => [...prev, matchingAccount._id]);
      }
    }
  }, [searchParams, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  // ——— Upload helpers ———

  const uploadFile = (file: File): Promise<MediaItem> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress((prev) => ({
            ...prev,
            [file.name]: Math.round((e.loaded / e.total) * 100),
          }));
        }
      };

      xhr.onload = () => {
        setUploadProgress((prev) => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          resolve({
            url: data.url,
            contentType: data.contentType,
            filename: data.filename || file.name,
          });
        } else {
          reject(new Error(`Upload failed: ${file.name}`));
        }
      };

      xhr.onerror = () => {
        setUploadProgress((prev) => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
        reject(new Error(`Upload failed: ${file.name}`));
      };

      xhr.open("POST", "/api/media/upload");
      xhr.send(formData);
    });
  };

  const uploadFiles = async (files: File[]) => {
    setUploadingMedia(true);
    try {
      for (const file of files) {
        try {
          const item = await uploadFile(file);
          setMediaItems((prev) => [...prev, item]);
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const removeMedia = (index: number) => {
    setMediaItems((prev) => prev.filter((_, i) => i !== index));
  };

  const openAltTextEditor = (index: number) => {
    setAltTextIndex(index);
    setAltTextDraft(mediaItems[index]?.altText || "");
  };

  const saveAltText = () => {
    if (altTextIndex !== null) {
      setMediaItems((prev) =>
        prev.map((item, i) =>
          i === altTextIndex ? { ...item, altText: altTextDraft || undefined } : item
        )
      );
      setAltTextIndex(null);
    }
  };

  // ——— Publish ———

  const handlePublish = async () => {
    if (!content.trim()) {
      toast.error("Please write some content for your post.");
      return;
    }
    if (selectedAccounts.length === 0) {
      toast.error("Please select at least one account to publish to.");
      return;
    }
    setPublishing(true);
    try {
      const platformEntries = selectedAccounts.map((accountId) => {
        const account = accounts.find((a) => a._id === accountId);
        return { platform: account?.platform, accountId: account?._id };
      });
      const body: any = { content, platforms: platformEntries };
      if (mediaItems.length > 0) {
        body.mediaUrls = mediaItems.map((m) => m.url);
        body.mediaItems = mediaItems;
      }
      if (scheduleMode === "now") {
        body.publishNow = true;
      } else {
        body.scheduledFor = `${scheduledDate}T${scheduledTime}:00`;
        body.timezone = timezone;
      }
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(
          scheduleMode === "now"
            ? "Post published successfully!"
            : "Post scheduled successfully!"
        );
        setContent("");
        setSelectedAccounts([]);
        setMediaItems([]);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create post");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  // ——— AI Functions ———

  const aiGenerate = async () => {
    if (!aiPrompt.trim()) { toast.error("Enter a topic or idea first"); return; }
    setAiLoading(true);
    setAiAction("generate");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", topic: aiPrompt, platforms: selectedPlatforms, tone: "engaging" }),
      });
      const data = await res.json();
      if (data.content) { setContent(data.content); setAiPrompt(""); toast.success("Post generated!"); }
      else toast.error(data.error || "Failed to generate");
    } catch { toast.error("AI request failed"); }
    finally { setAiLoading(false); setAiAction(null); }
  };

  const aiRewrite = async (style: string) => {
    if (!content.trim()) { toast.error("Write something first, then let AI improve it"); return; }
    setAiLoading(true);
    setAiAction(`rewrite-${style}`);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rewrite", content, style, platforms: selectedPlatforms }),
      });
      const data = await res.json();
      if (data.content) { setContent(data.content); toast.success(`Rewritten — ${style}`); }
    } catch { toast.error("AI request failed"); }
    finally { setAiLoading(false); setAiAction(null); }
  };

  const aiHashtags = async () => {
    if (!content.trim()) { toast.error("Write some content first"); return; }
    setAiLoading(true);
    setAiAction("hashtags");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hashtags", content, platforms: selectedPlatforms }),
      });
      const data = await res.json();
      if (data.hashtags?.length) { setSuggestedHashtags(data.hashtags); toast.success(`${data.hashtags.length} hashtags suggested`); }
      else toast.error("No hashtags generated");
    } catch { toast.error("AI request failed"); }
    finally { setAiLoading(false); setAiAction(null); }
  };

  const aiAdapt = async (targetPlatform: string) => {
    if (!content.trim()) { toast.error("Write some content first"); return; }
    setAiLoading(true);
    setAiAction(`adapt-${targetPlatform}`);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adapt", content, targetPlatform }),
      });
      const data = await res.json();
      if (data.content) { setContent(data.content); toast.success(`Adapted for ${platformMeta[targetPlatform]?.name || targetPlatform}`); }
    } catch { toast.error("AI request failed"); }
    finally { setAiLoading(false); setAiAction(null); }
  };

  const aiBestTime = async () => {
    setLoadingBestTime(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "best-time", platforms: selectedPlatforms, timezone }),
      });
      const data = await res.json();
      setBestTimeData(data);
    } catch { toast.error("Failed to get suggestions"); }
    finally { setLoadingBestTime(false); }
  };

  const addHashtag = (tag: string) => {
    setContent((prev) => `${prev}\n\n${tag}`);
    setSuggestedHashtags((prev) => prev.filter((t) => t !== tag));
  };

  const addAllHashtags = () => {
    setContent((prev) => `${prev}\n\n${suggestedHashtags.join(" ")}`);
    setSuggestedHashtags([]);
  };

  const applyBestTime = (day: string, time: string) => {
    const dayMap: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
    };
    const targetDay = dayMap[day];
    if (targetDay === undefined) return;
    const now = new Date();
    const today = now.getDay();
    let diff = targetDay - today;
    if (diff <= 0) diff += 7;
    const date = new Date(now);
    date.setDate(date.getDate() + diff);
    const dateStr = date.toISOString().split("T")[0];
    setScheduleMode("schedule");
    setScheduledDate(dateStr);
    setScheduledTime(time);
    setBestTimeData(null);
    toast.success(`Scheduled for ${day} at ${time}`);
  };

  // Character limits
  const selectedPlatforms = selectedAccounts
    .map((id) => accounts.find((a) => a._id === id)?.platform?.toLowerCase())
    .filter(Boolean) as string[];
  const minCharLimit =
    selectedPlatforms.length > 0
      ? Math.min(...selectedPlatforms.map((p) => platformLimits[p] || 5000))
      : 5000;
  const isOverLimit = content.length > minCharLimit;
  const uniquePlatforms = Array.from(new Set(selectedPlatforms));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Compose</h1>
        <p className="text-muted-foreground mt-1">
          Create and schedule posts across your social platforms
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main composer — left 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          {/* AI Generate bar */}
          <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-500/5 via-blue-500/5 to-cyan-500/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <Input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && aiGenerate()}
                  placeholder="Describe your post idea and let AI draft it..."
                  className="border-0 bg-background/60 backdrop-blur-sm focus-visible:ring-1 focus-visible:ring-violet-500/30"
                />
                <Button
                  onClick={aiGenerate}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white shrink-0 gap-2"
                  size="sm"
                >
                  {aiLoading && aiAction === "generate" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Content editor with drag-and-drop */}
          <Card
            className={cn(
              "border-0 shadow-sm relative transition-all",
              isDragOver && "ring-2 ring-blue-500 ring-offset-2"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
            onDrop={handleDrop}
          >
            {/* Drop overlay */}
            {isDragOver && (
              <div className="absolute inset-0 bg-blue-500/5 rounded-lg flex items-center justify-center z-10 pointer-events-none">
                <div className="flex flex-col items-center gap-2">
                  <ImageIcon className="h-8 w-8 text-blue-500" />
                  <p className="text-sm font-medium text-blue-500">Drop files to upload</p>
                </div>
              </div>
            )}

            <CardContent className="pt-6">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What would you like to share?"
                className="w-full min-h-[180px] resize-none bg-transparent text-base leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              />

              {/* Media previews */}
              {mediaItems.length > 0 && (
                <div className="flex gap-3 flex-wrap mt-4 pt-4 border-t">
                  {mediaItems.map((item, i) => (
                    <div
                      key={i}
                      className={cn(
                        "relative group cursor-grab active:cursor-grabbing",
                        dragMediaIndex === i && "opacity-50"
                      )}
                      draggable
                      onDragStart={() => setDragMediaIndex(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragMediaIndex !== null && dragMediaIndex !== i) {
                          const reordered = [...mediaItems];
                          const [moved] = reordered.splice(dragMediaIndex, 1);
                          reordered.splice(i, 0, moved);
                          setMediaItems(reordered);
                        }
                        setDragMediaIndex(null);
                      }}
                      onDragEnd={() => setDragMediaIndex(null)}
                    >
                      {item.contentType?.startsWith("video/") ? (
                        <div className="h-32 w-32 rounded-lg border bg-muted flex flex-col items-center justify-center gap-1">
                          <Video className="h-8 w-8 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground truncate max-w-[100px] px-1">
                            {item.filename || "Video"}
                          </span>
                        </div>
                      ) : (
                        <img
                          src={item.url}
                          alt={item.altText || ""}
                          className="h-32 w-32 object-cover rounded-lg border"
                        />
                      )}
                      <button
                        onClick={() => removeMedia(i)}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => openAltTextEditor(i)}
                        className={cn(
                          "absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity",
                          item.altText
                            ? "bg-blue-500 text-white"
                            : "bg-black/60 text-white"
                        )}
                      >
                        {item.altText ? "ALT" : "+ Alt"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload progress */}
              {Object.keys(uploadProgress).length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {Object.entries(uploadProgress).map(([name, pct]) => (
                    <div key={name} className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                      <span className="text-xs text-muted-foreground truncate max-w-[120px]">{name}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Toolbar */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={handleMediaUpload}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingMedia}
                    className="gap-2 text-muted-foreground"
                  >
                    {uploadingMedia ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    Media
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-muted-foreground"
                    onClick={() => setShowAiPanel(!showAiPanel)}
                  >
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-violet-500 font-medium">AI Assist</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-muted-foreground"
                    onClick={aiHashtags}
                    disabled={aiLoading || !content.trim()}
                  >
                    {aiLoading && aiAction === "hashtags" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Hash className="h-4 w-4" />
                    )}
                    Hashtags
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-muted-foreground"
                    onClick={() => setShowPreview(!showPreview)}
                  >
                    {showPreview ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    Preview
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-medium tabular-nums ${
                      isOverLimit
                        ? "text-destructive"
                        : content.length > minCharLimit * 0.8
                        ? "text-amber-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {content.length} / {minCharLimit}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Assist Panel */}
          {showAiPanel && (
            <Card className="border-0 shadow-sm border-l-4 border-l-violet-500">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    AI Assistant
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowAiPanel(false)} className="h-7 w-7 p-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Rewrite style</p>
                  <div className="grid grid-cols-3 gap-2">
                    {rewriteStyles.map((style) => {
                      const Icon = style.icon;
                      const isActive = aiAction === `rewrite-${style.key}`;
                      return (
                        <button
                          key={style.key}
                          onClick={() => aiRewrite(style.key)}
                          disabled={aiLoading || !content.trim()}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-violet-500/20 hover:bg-violet-500/5 transition-all disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {isActive ? <Loader2 className="h-4 w-4 animate-spin text-violet-500" /> : <Icon className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-xs font-medium">{style.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {uniquePlatforms.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Adapt for platform</p>
                    <div className="flex flex-wrap gap-2">
                      {uniquePlatforms.map((platform) => {
                        const meta = platformMeta[platform];
                        const isActive = aiAction === `adapt-${platform}`;
                        return (
                          <Button key={platform} variant="outline" size="sm" onClick={() => aiAdapt(platform)} disabled={aiLoading || !content.trim()} className="gap-2 text-xs">
                            {isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full inline-block" style={{ backgroundColor: meta?.color }} />}
                            {meta?.name || platform}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Suggested Hashtags */}
          {suggestedHashtags.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Hash className="h-4 w-4 text-blue-500" /> Suggested Hashtags
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={addAllHashtags} className="text-xs gap-1 text-blue-500 hover:text-blue-600">Add all <ArrowRight className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setSuggestedHashtags([])} className="text-xs text-muted-foreground h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedHashtags.map((tag) => (
                    <button key={tag} onClick={() => addHashtag(tag)} className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium hover:bg-blue-500/20 transition-colors">{tag}</button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Live Preview */}
          {showPreview && (
            <LivePreviewPanel
              content={content}
              selectedPlatforms={uniquePlatforms}
              mediaItems={mediaItems}
              accounts={accounts}
              selectedAccountIds={selectedAccounts}
              platformMeta={platformMeta}
            />
          )}

          {/* Schedule options */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">When to publish</CardTitle>
                <Button variant="ghost" size="sm" onClick={aiBestTime} disabled={loadingBestTime} className="gap-2 text-xs text-violet-500 hover:text-violet-600 hover:bg-violet-500/10">
                  {loadingBestTime ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
                  AI suggest time
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Button variant={scheduleMode === "now" ? "default" : "outline"} size="sm" onClick={() => setScheduleMode("now")} className={scheduleMode === "now" ? "bg-blue-500 hover:bg-blue-600 gap-2" : "gap-2"}>
                  <Send className="h-4 w-4" /> Publish Now
                </Button>
                <Button variant={scheduleMode === "schedule" ? "default" : "outline"} size="sm" onClick={() => setScheduleMode("schedule")} className={scheduleMode === "schedule" ? "bg-blue-500 hover:bg-blue-600 gap-2" : "gap-2"}>
                  <Clock className="h-4 w-4" /> Schedule
                </Button>
              </div>

              {bestTimeData?.suggestions?.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-violet-500/5 border border-violet-500/10">
                  <p className="text-xs font-medium text-violet-600 mb-2 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> AI Recommended Times</p>
                  {bestTimeData.summary && <p className="text-xs text-muted-foreground mb-2">{bestTimeData.summary}</p>}
                  <div className="space-y-1.5">
                    {bestTimeData.suggestions.map((s: any, i: number) => (
                      <button key={i} onClick={() => applyBestTime(s.day, s.time)} className="w-full flex items-center justify-between p-2 rounded-md hover:bg-violet-500/10 transition-colors text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{s.day} {s.time}</span>
                          {s.platform && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{platformMeta[s.platform]?.name || s.platform}</Badge>}
                        </div>
                        <span className="text-[11px] text-muted-foreground max-w-[200px] truncate">{s.reason}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {scheduleMode === "schedule" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                  </div>
                  <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="h-4 w-4" />
                    <span>{timezone}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Publish button */}
          <Button
            onClick={handlePublish}
            disabled={publishing || !content.trim() || selectedAccounts.length === 0 || isOverLimit || (scheduleMode === "schedule" && (!scheduledDate || !scheduledTime))}
            className="w-full h-12 text-base font-medium bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20 gap-2"
          >
            {publishing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : scheduleMode === "now" ? (
              <><Send className="h-5 w-5" /> Publish Now</>
            ) : (
              <><CalendarDays className="h-5 w-5" /> Schedule Post</>
            )}
          </Button>
        </div>

        {/* Right sidebar — platform selection */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Publish to</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-3">No accounts connected yet</p>
                  <Button variant="outline" size="sm" onClick={() => (window.location.href = "/accounts")}>Connect accounts</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {accounts.map((account) => {
                    const meta = platformMeta[account.platform?.toLowerCase()] || null;
                    const isSelected = selectedAccounts.includes(account._id);
                    return (
                      <button
                        key={account._id}
                        onClick={() => toggleAccount(account._id)}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                          isSelected ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "hover:bg-muted/50"
                        }`}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={account.avatarUrl} />
                          <AvatarFallback className={`${meta?.bgColor || "bg-gray-100"} text-xs font-bold`} style={{ color: meta?.color }}>{meta?.icon || "?"}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{account.displayName || account.username}</p>
                          <p className="text-xs text-muted-foreground">{meta?.name || account.platform}</p>
                        </div>
                        {isSelected && <CheckCircle2 className="h-5 w-5 text-blue-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedPlatforms.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Character limits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {uniquePlatforms.map((platform) => {
                  const limit = platformLimits[platform] || 5000;
                  const meta = platformMeta[platform];
                  const pct = Math.min((content.length / limit) * 100, 100);
                  const isOver = content.length > limit;
                  return (
                    <div key={platform} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{meta?.name || platform}</span>
                        <span className={isOver ? "text-destructive font-semibold" : "text-muted-foreground"}>{content.length}/{limit}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isOver ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Alt text dialog */}
      <Dialog open={altTextIndex !== null} onOpenChange={(open) => { if (!open) setAltTextIndex(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alt Text</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Describe this image for accessibility and SEO.</p>
          {altTextIndex !== null && mediaItems[altTextIndex] && !mediaItems[altTextIndex].contentType?.startsWith("video/") && (
            <img src={mediaItems[altTextIndex].url} alt="" className="w-full h-40 object-cover rounded-lg" />
          )}
          <textarea
            value={altTextDraft}
            onChange={(e) => setAltTextDraft(e.target.value)}
            placeholder="Describe this image..."
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAltTextIndex(null)}>Cancel</Button>
            <Button size="sm" onClick={saveAltText}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
