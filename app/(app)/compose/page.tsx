"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Send,
  Clock,
  Image as ImageIcon,
  X,
  Loader2,
  CheckCircle2,
  CalendarDays,
  Globe,
  Smile,
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

interface Account {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  profileId?: string;
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
  const [content, setContent] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleMediaUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingMedia(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          setMediaUrls((prev) => [...prev, data.url]);
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeMedia = (index: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  };

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
      if (mediaUrls.length > 0) body.mediaUrls = mediaUrls;
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
        setMediaUrls([]);
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
    if (!aiPrompt.trim()) {
      toast.error("Enter a topic or idea first");
      return;
    }
    setAiLoading(true);
    setAiAction("generate");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          topic: aiPrompt,
          platforms: selectedPlatforms,
          tone: "engaging",
        }),
      });
      const data = await res.json();
      if (data.content) {
        setContent(data.content);
        setAiPrompt("");
        toast.success("Post generated!");
      } else {
        toast.error(data.error || "Failed to generate");
      }
    } catch {
      toast.error("AI request failed");
    } finally {
      setAiLoading(false);
      setAiAction(null);
    }
  };

  const aiRewrite = async (style: string) => {
    if (!content.trim()) {
      toast.error("Write something first, then let AI improve it");
      return;
    }
    setAiLoading(true);
    setAiAction(`rewrite-${style}`);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          content,
          style,
          platforms: selectedPlatforms,
        }),
      });
      const data = await res.json();
      if (data.content) {
        setContent(data.content);
        toast.success(`Rewritten — ${style}`);
      }
    } catch {
      toast.error("AI request failed");
    } finally {
      setAiLoading(false);
      setAiAction(null);
    }
  };

  const aiHashtags = async () => {
    if (!content.trim()) {
      toast.error("Write some content first");
      return;
    }
    setAiLoading(true);
    setAiAction("hashtags");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hashtags",
          content,
          platforms: selectedPlatforms,
        }),
      });
      const data = await res.json();
      if (data.hashtags?.length) {
        setSuggestedHashtags(data.hashtags);
        toast.success(`${data.hashtags.length} hashtags suggested`);
      } else {
        toast.error("No hashtags generated");
      }
    } catch {
      toast.error("AI request failed");
    } finally {
      setAiLoading(false);
      setAiAction(null);
    }
  };

  const aiAdapt = async (targetPlatform: string) => {
    if (!content.trim()) {
      toast.error("Write some content first");
      return;
    }
    setAiLoading(true);
    setAiAction(`adapt-${targetPlatform}`);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adapt",
          content,
          targetPlatform,
        }),
      });
      const data = await res.json();
      if (data.content) {
        setContent(data.content);
        toast.success(`Adapted for ${platformMeta[targetPlatform]?.name || targetPlatform}`);
      }
    } catch {
      toast.error("AI request failed");
    } finally {
      setAiLoading(false);
      setAiAction(null);
    }
  };

  const aiBestTime = async () => {
    setLoadingBestTime(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "best-time",
          platforms: selectedPlatforms,
          timezone,
        }),
      });
      const data = await res.json();
      setBestTimeData(data);
    } catch {
      toast.error("Failed to get suggestions");
    } finally {
      setLoadingBestTime(false);
    }
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
    // Find the next occurrence of the given day
    const dayMap: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
      Thursday: 4, Friday: 5, Saturday: 6,
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

          {/* Content editor */}
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What would you like to share?"
                className="w-full min-h-[180px] resize-none bg-transparent text-base leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              />

              {/* Media previews */}
              {mediaUrls.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-4 pt-4 border-t">
                  {mediaUrls.map((url, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={url}
                        alt=""
                        className="h-24 w-24 object-cover rounded-lg border"
                      />
                      <button
                        onClick={() => removeMedia(i)}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAiPanel(false)}
                    className="h-7 w-7 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Rewrite styles */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Rewrite style
                  </p>
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
                          {isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                          ) : (
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="text-xs font-medium">{style.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Adapt per platform */}
                {uniquePlatforms.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Adapt for platform
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {uniquePlatforms.map((platform) => {
                        const meta = platformMeta[platform];
                        const isActive = aiAction === `adapt-${platform}`;
                        return (
                          <Button
                            key={platform}
                            variant="outline"
                            size="sm"
                            onClick={() => aiAdapt(platform)}
                            disabled={aiLoading || !content.trim()}
                            className="gap-2 text-xs"
                          >
                            {isActive ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <span
                                className="h-3.5 w-3.5 rounded-full inline-block"
                                style={{ backgroundColor: meta?.color }}
                              />
                            )}
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
                    <Hash className="h-4 w-4 text-blue-500" />
                    Suggested Hashtags
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={addAllHashtags}
                      className="text-xs gap-1 text-blue-500 hover:text-blue-600"
                    >
                      Add all
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSuggestedHashtags([])}
                      className="text-xs text-muted-foreground h-7 w-7 p-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedHashtags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => addHashtag(tag)}
                      className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Schedule options */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  When to publish
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={aiBestTime}
                  disabled={loadingBestTime}
                  className="gap-2 text-xs text-violet-500 hover:text-violet-600 hover:bg-violet-500/10"
                >
                  {loadingBestTime ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Clock3 className="h-3.5 w-3.5" />
                  )}
                  AI suggest time
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Button
                  variant={scheduleMode === "now" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("now")}
                  className={
                    scheduleMode === "now"
                      ? "bg-blue-500 hover:bg-blue-600 gap-2"
                      : "gap-2"
                  }
                >
                  <Send className="h-4 w-4" />
                  Publish Now
                </Button>
                <Button
                  variant={scheduleMode === "schedule" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("schedule")}
                  className={
                    scheduleMode === "schedule"
                      ? "bg-blue-500 hover:bg-blue-600 gap-2"
                      : "gap-2"
                  }
                >
                  <Clock className="h-4 w-4" />
                  Schedule
                </Button>
              </div>

              {/* AI Best Time Suggestions */}
              {bestTimeData?.suggestions?.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-violet-500/5 border border-violet-500/10">
                  <p className="text-xs font-medium text-violet-600 mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI Recommended Times
                  </p>
                  {bestTimeData.summary && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {bestTimeData.summary}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {bestTimeData.suggestions.map((s: any, i: number) => (
                      <button
                        key={i}
                        onClick={() => applyBestTime(s.day, s.time)}
                        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-violet-500/10 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">
                            {s.day} {s.time}
                          </span>
                          {s.platform && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {platformMeta[s.platform]?.name || s.platform}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground max-w-[200px] truncate">
                          {s.reason}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {scheduleMode === "schedule" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
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
            disabled={
              publishing ||
              !content.trim() ||
              selectedAccounts.length === 0 ||
              isOverLimit ||
              (scheduleMode === "schedule" &&
                (!scheduledDate || !scheduledTime))
            }
            className="w-full h-12 text-base font-medium bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20 gap-2"
          >
            {publishing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : scheduleMode === "now" ? (
              <>
                <Send className="h-5 w-5" />
                Publish Now
              </>
            ) : (
              <>
                <CalendarDays className="h-5 w-5" />
                Schedule Post
              </>
            )}
          </Button>
        </div>

        {/* Right sidebar — platform selection */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Publish to
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    No accounts connected yet
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => (window.location.href = "/accounts")}
                  >
                    Connect accounts
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {accounts.map((account) => {
                    const meta =
                      platformMeta[account.platform?.toLowerCase()] || null;
                    const isSelected = selectedAccounts.includes(account._id);
                    return (
                      <button
                        key={account._id}
                        onClick={() => toggleAccount(account._id)}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                          isSelected
                            ? "bg-blue-500/10 ring-1 ring-blue-500/30"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={account.avatarUrl} />
                          <AvatarFallback
                            className={`${meta?.bgColor || "bg-gray-100"} text-xs font-bold`}
                            style={{ color: meta?.color }}
                          >
                            {meta?.icon || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {account.displayName || account.username}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {meta?.name || account.platform}
                          </p>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="h-5 w-5 text-blue-500 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Character limits */}
          {selectedPlatforms.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Character limits
                </CardTitle>
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
                        <span className="font-medium">
                          {meta?.name || platform}
                        </span>
                        <span
                          className={
                            isOver
                              ? "text-destructive font-semibold"
                              : "text-muted-foreground"
                          }
                        >
                          {content.length}/{limit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isOver
                              ? "bg-destructive"
                              : pct > 80
                              ? "bg-amber-500"
                              : "bg-blue-500"
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
