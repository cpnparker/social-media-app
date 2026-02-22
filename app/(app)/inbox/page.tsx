"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Inbox,
  MessageCircle,
  Star,
  Archive,
  MoreHorizontal,
  Send,
  Loader2,
  RefreshCw,
  Search,
  Filter,
  ArrowLeft,
  User,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface Conversation {
  _id: string;
  platform: string;
  participantName?: string;
  participantUsername?: string;
  participantAvatar?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  status?: string;
  unreadCount?: number;
  type?: string;
}

interface Message {
  _id: string;
  text: string;
  sender?: string;
  senderName?: string;
  senderAvatar?: string;
  isOurs?: boolean;
  createdAt: string;
  attachments?: Array<{ url: string; type: string }>;
}

const platformMeta: Record<string, { name: string; color: string; bgColor: string; icon: string }> = {
  twitter: { name: "Twitter", color: "#1DA1F2", bgColor: "bg-sky-500/10", icon: "𝕏" },
  instagram: { name: "Instagram", color: "#E4405F", bgColor: "bg-pink-500/10", icon: "📷" },
  facebook: { name: "Facebook", color: "#1877F2", bgColor: "bg-blue-600/10", icon: "f" },
  linkedin: { name: "LinkedIn", color: "#0A66C2", bgColor: "bg-blue-700/10", icon: "in" },
  tiktok: { name: "TikTok", color: "#000000", bgColor: "bg-gray-900/10", icon: "♪" },
  telegram: { name: "Telegram", color: "#26A5E4", bgColor: "bg-cyan-500/10", icon: "✈" },
  bluesky: { name: "Bluesky", color: "#0085FF", bgColor: "bg-blue-500/10", icon: "🦋" },
  reddit: { name: "Reddit", color: "#FF4500", bgColor: "bg-orange-500/10", icon: "R" },
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMessageTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [inboxType, setInboxType] = useState("conversations");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox?type=${inboxType}&limit=30`);
      const data = await res.json();
      setConversations(data.conversations || data.comments || data.reviews || data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [inboxType]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const openConversation = async (convo: Conversation) => {
    setSelectedConvo(convo);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/inbox/${convo._id}`);
      const data = await res.json();
      setMessages(data.messages || data.data || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedConvo) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${selectedConvo._id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText }),
      });
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            _id: Date.now().toString(),
            text: replyText,
            isOurs: true,
            createdAt: new Date().toISOString(),
            senderName: "You",
          },
        ]);
        setReplyText("");
        toast.success("Reply sent!");
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      } else {
        toast.error("Failed to send reply");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSending(false);
    }
  };

  const handleArchive = async (convoId: string) => {
    try {
      await fetch(`/api/inbox/${convoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      toast.success("Conversation archived");
      fetchConversations();
      if (selectedConvo?._id === convoId) {
        setSelectedConvo(null);
        setMessages([]);
      }
    } catch {
      toast.error("Failed to archive");
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.participantName?.toLowerCase().includes(q) ||
      c.participantUsername?.toLowerCase().includes(q) ||
      c.lastMessage?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-0 -m-6">
      {/* Left panel — conversation list */}
      <div
        className={`w-full md:w-[380px] border-r flex flex-col bg-background shrink-0 ${
          selectedConvo ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Inbox header */}
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold tracking-tight">Inbox</h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchConversations}
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Type tabs */}
          <Tabs value={inboxType} onValueChange={setInboxType}>
            <TabsList className="w-full bg-muted/50">
              <TabsTrigger value="conversations" className="flex-1 text-xs">
                Messages
              </TabsTrigger>
              <TabsTrigger value="comments" className="flex-1 text-xs">
                Comments
              </TabsTrigger>
              <TabsTrigger value="reviews" className="flex-1 text-xs">
                Reviews
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-0"
            />
          </div>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Messages from your connected platforms will appear here
              </p>
            </div>
          ) : (
            <div>
              {filteredConversations.map((convo) => {
                const meta = platformMeta[convo.platform?.toLowerCase()];
                const isSelected = selectedConvo?._id === convo._id;

                return (
                  <button
                    key={convo._id}
                    onClick={() => openConversation(convo)}
                    className={`w-full flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors border-b ${
                      isSelected ? "bg-blue-500/5 border-l-2 border-l-blue-500" : ""
                    }`}
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage src={convo.participantAvatar} />
                      <AvatarFallback
                        className={`${meta?.bgColor || "bg-gray-100"} text-xs font-bold`}
                        style={{ color: meta?.color }}
                      >
                        {convo.participantName?.[0]?.toUpperCase() || meta?.icon || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold truncate">
                          {convo.participantName || convo.participantUsername || "Unknown"}
                        </span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {convo.lastMessageAt ? formatTime(convo.lastMessageAt) : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant="secondary"
                          className={`${meta?.bgColor || "bg-gray-100"} border-0 text-[10px] px-1.5 py-0 font-medium`}
                          style={{ color: meta?.color }}
                        >
                          {meta?.name || convo.platform}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {convo.lastMessage || "No messages"}
                      </p>
                    </div>
                    {(convo.unreadCount || 0) > 0 && (
                      <span className="h-5 min-w-5 flex items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white px-1.5 shrink-0">
                        {convo.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right panel — conversation detail */}
      <div
        className={`flex-1 flex flex-col bg-muted/20 ${
          selectedConvo ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedConvo ? (
          <>
            {/* Conversation header */}
            <div className="h-16 border-b bg-background flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8"
                  onClick={() => setSelectedConvo(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Avatar className="h-9 w-9">
                  <AvatarImage src={selectedConvo.participantAvatar} />
                  <AvatarFallback className="text-xs font-bold">
                    {selectedConvo.participantName?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold">
                    {selectedConvo.participantName || selectedConvo.participantUsername}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {platformMeta[selectedConvo.platform?.toLowerCase()]?.name || selectedConvo.platform}
                    {selectedConvo.participantUsername && ` · @${selectedConvo.participantUsername}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleArchive(selectedConvo._id)}
                >
                  <Archive className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <MessageCircle className="h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No messages in this conversation yet
                  </p>
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl mx-auto">
                  {messages.map((msg) => (
                    <div
                      key={msg._id}
                      className={`flex gap-3 ${msg.isOurs ? "justify-end" : ""}`}
                    >
                      {!msg.isOurs && (
                        <Avatar className="h-8 w-8 shrink-0 mt-1">
                          <AvatarImage src={msg.senderAvatar} />
                          <AvatarFallback className="text-xs">
                            {msg.senderName?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={`max-w-[75%] ${
                          msg.isOurs ? "order-first" : ""
                        }`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-2.5 ${
                            msg.isOurs
                              ? "bg-blue-500 text-white rounded-br-md"
                              : "bg-background border rounded-bl-md shadow-sm"
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{msg.text}</p>
                        </div>
                        <p
                          className={`text-[11px] text-muted-foreground mt-1 ${
                            msg.isOurs ? "text-right" : ""
                          }`}
                        >
                          {formatMessageTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Reply composer */}
            <div className="border-t bg-background p-4 shrink-0">
              <div className="flex items-end gap-2 max-w-2xl mx-auto">
                <div className="flex-1 relative">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleReply();
                      }
                    }}
                    placeholder="Type your reply..."
                    rows={1}
                    className="w-full resize-none bg-muted/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px] max-h-[120px]"
                  />
                </div>
                <Button
                  onClick={handleReply}
                  disabled={!replyText.trim() || sending}
                  size="icon"
                  className="h-11 w-11 rounded-xl bg-blue-500 hover:bg-blue-600 shrink-0"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="h-16 w-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
              <MessageCircle className="h-8 w-8 text-blue-500" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Your unified inbox</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Select a conversation from the left to view messages and reply.
              DMs, comments, and reviews from all your connected platforms
              appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
