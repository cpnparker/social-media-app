"use client";

import { useState } from "react";
import { Plus, Search, Lock, Users, MessageSquare, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AIConversation } from "@/lib/types/ai";

interface ConversationListProps {
  conversations: AIConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: (visibility: "private" | "team") => void;
  loading?: boolean;
}

type TabFilter = "all" | "private" | "team";

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNewConversation,
  loading,
}: ConversationListProps) {
  const [tab, setTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = conversations.filter((c) => {
    if (tab === "private" && c.visibility !== "private") return false;
    if (tab === "team" && c.visibility !== "team") return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => onNewConversation("private")}
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onNewConversation("team")}
            title="New team conversation"
          >
            <Users className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(["all", "private", "team"] as TabFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-xs font-medium text-center transition-colors border-b-2",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "all" ? "All" : t === "private" ? "Private" : "Team"}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? "No conversations match your search" : "No conversations yet"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Start a new chat to begin
            </p>
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 border-b transition-colors hover:bg-muted/50",
                selectedId === conv.id && "bg-muted"
              )}
            >
              <div className="flex items-start gap-2">
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">
                      {conv.title}
                    </span>
                    {conv.visibility === "private" ? (
                      <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Users className="h-2.5 w-2.5 shrink-0 text-blue-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-4 font-normal"
                    >
                      {conv.model.includes("grok") ? "Grok" : "Claude"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
