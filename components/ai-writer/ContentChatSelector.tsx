"use client";

import { Lock, Users, Plus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AIConversation } from "@/lib/types/ai";

interface ContentChatSelectorProps {
  conversations: AIConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: (visibility: "private" | "team") => void;
  loading: boolean;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function ContentChatSelector({
  conversations,
  selectedId,
  onSelect,
  onNewConversation,
  loading,
}: ContentChatSelectorProps) {
  const privateChats = conversations.filter((c) => c.visibility === "private");
  const teamChats = conversations.filter((c) => c.visibility === "team");

  if (loading) {
    return (
      <div className="px-4 py-3 border-b bg-muted/30">
        <div className="h-4 w-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="px-3 md:px-4 py-3 border-b bg-muted/30 space-y-2">
      {/* Private chats row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs md:text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 shrink-0 w-auto md:w-14">
          <Lock className="h-3 w-3" /> Mine
        </span>
        {privateChats.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 md:px-2.5 py-1.5 md:py-1 rounded-full text-sm md:text-xs transition-all max-w-[200px] md:max-w-[180px]",
              selectedId === c.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-background border hover:bg-muted"
            )}
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {c.title === "New Conversation"
                ? "New chat"
                : c.title}
            </span>
            <span
              className={cn(
                "text-xs md:text-[10px] shrink-0",
                selectedId === c.id
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              )}
            >
              {timeAgo(c.updatedAt)}
            </span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNewConversation("private")}
          className="h-8 md:h-6 px-3 md:px-2 text-xs md:text-[10px] gap-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 md:h-3 w-3.5 md:w-3" /> Private
        </Button>
      </div>

      {/* Team chats row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs md:text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1 shrink-0 w-auto md:w-14">
          <Users className="h-3 w-3" /> Team
        </span>
        {teamChats.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 md:px-2.5 py-1.5 md:py-1 rounded-full text-sm md:text-xs transition-all max-w-[200px] md:max-w-[180px]",
              selectedId === c.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-background border hover:bg-muted"
            )}
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {c.title === "New Conversation"
                ? "New chat"
                : c.title}
            </span>
            <span
              className={cn(
                "text-xs md:text-[10px] shrink-0",
                selectedId === c.id
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              )}
            >
              {timeAgo(c.updatedAt)}
            </span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNewConversation("team")}
          className="h-8 md:h-6 px-3 md:px-2 text-xs md:text-[10px] gap-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 md:h-3 w-3.5 md:w-3" /> Team
        </Button>
      </div>

      {conversations.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-1">
          No conversations yet. Start a private or team chat.
        </p>
      )}
    </div>
  );
}
