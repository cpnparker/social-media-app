"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

interface ConnectedAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isActive?: boolean;
  profileId?: { _id: string; name: string } | string;
}

interface Profile {
  _id: string;
  name: string;
  isDefault?: boolean;
}

const platforms = [
  { name: "Twitter / X", slug: "twitter", color: "#1DA1F2", bgColor: "bg-sky-500/10", icon: "𝕏" },
  { name: "Instagram", slug: "instagram", color: "#E4405F", bgColor: "bg-pink-500/10", icon: "📷" },
  { name: "Facebook", slug: "facebook", color: "#1877F2", bgColor: "bg-blue-600/10", icon: "f" },
  { name: "LinkedIn", slug: "linkedin", color: "#0A66C2", bgColor: "bg-blue-700/10", icon: "in" },
  { name: "TikTok", slug: "tiktok", color: "#000000", bgColor: "bg-gray-900/10 dark:bg-gray-100/10", icon: "♪" },
  { name: "YouTube", slug: "youtube", color: "#FF0000", bgColor: "bg-red-500/10", icon: "▶" },
  { name: "Pinterest", slug: "pinterest", color: "#BD081C", bgColor: "bg-red-600/10", icon: "P" },
  { name: "Reddit", slug: "reddit", color: "#FF4500", bgColor: "bg-orange-500/10", icon: "R" },
  { name: "Bluesky", slug: "bluesky", color: "#0085FF", bgColor: "bg-blue-500/10", icon: "🦋" },
  { name: "Threads", slug: "threads", color: "#000000", bgColor: "bg-gray-900/10 dark:bg-gray-100/10", icon: "@" },
  { name: "Google Business", slug: "googlebusiness", color: "#4285F4", bgColor: "bg-blue-500/10", icon: "G" },
  { name: "Telegram", slug: "telegram", color: "#26A5E4", bgColor: "bg-cyan-500/10", icon: "✈" },
  { name: "Snapchat", slug: "snapchat", color: "#FFFC00", bgColor: "bg-yellow-400/10", icon: "👻" },
];

export default function AccountsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();

      // Set accounts from the /accounts endpoint
      if (data.accounts) {
        setConnectedAccounts(data.accounts);
      }
      // Set profiles
      if (data.profiles) {
        setProfiles(data.profiles);
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
      toast.error("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      toast.success("Account connected successfully!");
      window.history.replaceState({}, "", "/accounts");
      fetchAccounts();
    }
  }, [fetchAccounts]);

  const handleConnect = async (platformSlug: string) => {
    setConnecting(platformSlug);
    try {
      // Use the default profile
      const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0];
      const profileId = defaultProfile?._id || "";
      const res = await fetch(
        `/api/accounts/connect?platform=${platformSlug}${profileId ? `&profileId=${profileId}` : ""}`
      );
      const data = await res.json();
      const url = data.data?.url || data.url || data.data?.authUrl || data.authUrl;
      if (url) {
        window.open(url, "_blank", "width=600,height=700");
      } else {
        toast.error("Could not get OAuth URL. Check your Late API key.");
      }
    } catch (err) {
      toast.error("Failed to connect. Please try again.");
    } finally {
      setConnecting(null);
    }
  };

  const connectedPlatforms = new Set(
    connectedAccounts.map((a) => a.platform?.toLowerCase())
  );

  const getProfileName = (account: ConnectedAccount) => {
    if (typeof account.profileId === "object" && account.profileId?.name) {
      return account.profileId.name;
    }
    return "";
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connected Accounts</h1>
          <p className="text-muted-foreground mt-1">
            Connect your social media accounts to start publishing and managing content
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAccounts} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Connected accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Your accounts</h2>
          <Badge variant="secondary" className="font-normal">
            {connectedAccounts.length} connected
          </Badge>
        </div>

        {loading ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : connectedAccounts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {connectedAccounts.map((account) => {
              const platformInfo = platforms.find(
                (p) => p.slug === account.platform?.toLowerCase()
              );
              const profileName = getProfileName(account);
              return (
                <Card key={account._id} className="border-0 shadow-sm">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={account.avatarUrl} />
                      <AvatarFallback
                        className={`${platformInfo?.bgColor || "bg-muted"} text-sm font-bold`}
                        style={{ color: platformInfo?.color }}
                      >
                        {platformInfo?.icon || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">
                          {account.displayName || account.username || "Account"}
                        </p>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {platformInfo?.name || account.platform}
                        {account.username && ` · @${account.username}`}
                        {profileName && ` · ${profileName}`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed border-2 border-muted-foreground/20">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No accounts connected yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your first social media account below to start scheduling and publishing content.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Available platforms */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Available platforms</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {platforms.map((platform) => {
            const isConnected = connectedPlatforms.has(platform.slug);
            const isConnecting = connecting === platform.slug;
            const accountCount = connectedAccounts.filter(
              (a) => a.platform?.toLowerCase() === platform.slug
            ).length;
            return (
              <Card
                key={platform.slug}
                className="border-0 shadow-sm hover:shadow-md transition-all group cursor-pointer"
              >
                <CardContent className="flex items-center gap-4 py-4">
                  <div
                    className={`h-12 w-12 rounded-xl ${platform.bgColor} flex items-center justify-center text-lg font-bold shrink-0`}
                    style={{ color: platform.color }}
                  >
                    {platform.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{platform.name}</p>
                      {isConnected && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      )}
                    </div>
                    {isConnected && accountCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {accountCount} {accountCount === 1 ? "account" : "accounts"} connected
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleConnect(platform.slug)}
                    disabled={isConnecting}
                    className={
                      isConnected
                        ? "shrink-0 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0"
                        : "shrink-0 bg-blue-500 hover:bg-blue-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    }
                    variant={isConnected ? "outline" : "default"}
                  >
                    {isConnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isConnected ? (
                      "Reconnect"
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">Powered by Late API</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All platform connections are securely handled through Late&apos;s OAuth integration.
            Your credentials are never stored directly.
          </p>
        </div>
      </div>
    </div>
  );
}
