"use client";

import { Lock, Users, Plus, MessageSquare, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AI_MODELS, getModelLabel } from "@/lib/ai/models";
import type { AIConversation } from "@/lib/types/ai";

interface ContentChatSelectorProps {
  conversations: AIConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: (visibility: "private" | "team", model?: string) => void;
  loading: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
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
  selectedModel,
  onModelChange,
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
      {/* Model selector + new chat actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs px-2.5"
            >
              {selectedModel === "auto" && <Sparkles className="h-3 w-3 text-amber-500" />}
              {getModelLabel(selectedModel)}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem
              onClick={() => onModelChange("auto")}
              className={cn(
                "text-xs",
                selectedModel === "auto" && "bg-muted font-medium"
              )}
            >
              <Sparkles className="h-3 w-3 mr-1.5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div>EngineGPT Auto</div>
                <div className="text-[10px] text-muted-foreground font-normal">Routes to the best model</div>
              </div>
              {selectedModel === "auto" && (
                <span className="text-primary text-xs">&#10003;</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {AI_MODELS.filter((m) => m.id !== "auto").map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onModelChange(m.id)}
                className={cn(
                  "text-xs",
                  selectedModel === m.id && "bg-muted font-medium"
                )}
              >
                <span className="flex-1">{m.label}</span>
                {selectedModel === m.id && (
                  <span className="text-primary text-xs">&#10003;</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNewConversation("private", selectedModel)}
          className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          <Lock className="h-2.5 w-2.5" />
          Private
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNewConversation("team", selectedModel)}
          className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          <Users className="h-2.5 w-2.5" />
          Team
        </Button>
      </div>

      {/* Conversation chips */}
      {(privateChats.length > 0 || teamChats.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {[...privateChats, ...teamChats].map((c) => (
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
              {c.visibility === "private" ? (
                <Lock className="h-2.5 w-2.5 shrink-0" />
              ) : (
                <Users className="h-2.5 w-2.5 shrink-0" />
              )}
              <span className="truncate">
                {c.title === "New Conversation" ? "New chat" : c.title}
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
        </div>
      )}

      {conversations.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-1">
          No conversations yet. Start a private or team chat.
        </p>
      )}
    </div>
  );
}
