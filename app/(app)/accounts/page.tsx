"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Link2,
  Unlink,
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
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [allLateAccounts, setAllLateAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  // Track account IDs before connecting, so we can detect new ones
  const preConnectIdsRef = useRef<Set<string>>(new Set());

  const fetchAccounts = useCallback(async () => {
    try {
      // Scope accounts to customer-linked accounts when a customer is selected
      const custParam = selectedCustomerId ? `?customerId=${selectedCustomerId}` : "";
      const res = await fetch(`/api/accounts${custParam}`);
      const data = await res.json();

      // Set accounts from the /accounts endpoint
      if (data.accounts) {
        setConnectedAccounts(data.accounts);
      }
      // Set profiles
      if (data.profiles) {
        setProfiles(data.profiles);
      }

      // Also fetch ALL Late accounts (unscoped) so we know what's available to link
      if (selectedCustomerId) {
        const allRes = await fetch("/api/accounts");
        const allData = await allRes.json();
        setAllLateAccounts(allData.accounts || []);
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
      toast.error("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Handle the ?connected=true OAuth callback — auto-link new account to customer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      window.history.replaceState({}, "", "/accounts");

      // Fetch ALL accounts to find the newly connected one
      (async () => {
        try {
          const allRes = await fetch("/api/accounts");
          const allData = await allRes.json();
          const allAccounts: ConnectedAccount[] = allData.accounts || [];

          // Find accounts that weren't in pre-connect snapshot
          const newAccounts = allAccounts.filter(
            (a) => !preConnectIdsRef.current.has(a._id)
          );

          if (newAccounts.length > 0 && selectedCustomerId) {
            // Auto-link new accounts to the current customer
            for (const acct of newAccounts) {
              try {
                await fetch("/api/customer-accounts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    customerId: selectedCustomerId,
                    lateAccountId: acct._id,
                    platform: acct.platform,
                    displayName: acct.displayName || acct.username || acct.platform,
                    username: acct.username || null,
                    avatarUrl: acct.avatarUrl || null,
                  }),
                });
              } catch (e) {
                console.error("Failed to auto-link account:", e);
              }
            }
            toast.success(
              `Account connected and linked to this customer!`
            );
          } else {
            toast.success("Account connected successfully!");
          }

          // Refresh to show updated list
          fetchAccounts();
        } catch (err) {
          console.error("Post-connect error:", err);
          toast.success("Account connected! Refresh to see updates.");
          fetchAccounts();
        }
      })();
    }
  }, [fetchAccounts, selectedCustomerId]);

  const handleConnect = async (platformSlug: string) => {
    setConnecting(platformSlug);
    try {
      // Snapshot current account IDs before connecting
      const preRes = await fetch("/api/accounts");
      const preData = await preRes.json();
      preConnectIdsRef.current = new Set(
        (preData.accounts || []).map((a: any) => a._id)
      );

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

  // Link an existing Late account to the current customer
  const handleLinkAccount = async (account: ConnectedAccount) => {
    if (!selectedCustomerId) return;
    setLinking(account._id);
    try {
      const res = await fetch("/api/customer-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          lateAccountId: account._id,
          platform: account.platform,
          displayName: account.displayName || account.username || account.platform,
          username: account.username || null,
          avatarUrl: account.avatarUrl || null,
        }),
      });
      if (res.ok) {
        toast.success(`${account.displayName || account.platform} linked to customer`);
        fetchAccounts();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to link account");
      }
    } catch (err) {
      toast.error("Failed to link account");
    } finally {
      setLinking(null);
    }
  };

  // Unlink an account from the current customer
  const handleUnlinkAccount = async (account: ConnectedAccount) => {
    if (!selectedCustomerId) return;
    setLinking(account._id);
    try {
      const res = await fetch(
        `/api/customer-accounts?customerId=${selectedCustomerId}&lateAccountId=${account._id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success(`Account unlinked from customer`);
        fetchAccounts();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to unlink account");
      }
    } catch (err) {
      toast.error("Failed to unlink account");
    } finally {
      setLinking(null);
    }
  };

  const connectedPlatforms = new Set(
    connectedAccounts.map((a) => a.platform?.toLowerCase())
  );

  // Compute unlinked accounts (available in Late but not linked to current customer)
  const connectedIds = new Set(connectedAccounts.map((a) => a._id));
  const unlinkableAccounts = useMemo(
    () => allLateAccounts.filter((a) => !connectedIds.has(a._id)),
    [allLateAccounts, connectedIds]
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
            {selectedCustomerId
              ? "Social media accounts linked to this customer"
              : "Connect your social media accounts to start publishing and managing content"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAccounts} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Connected accounts for this customer */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {selectedCustomerId ? "Customer\u2019s linked accounts" : "Your accounts"}
          </h2>
          <Badge variant="secondary" className="font-normal">
            {connectedAccounts.length} linked
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
              const isUnlinking = linking === account._id;
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
                    {selectedCustomerId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-red-500 shrink-0"
                        onClick={() => handleUnlinkAccount(account)}
                        disabled={isUnlinking}
                      >
                        {isUnlinking ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unlink className="h-4 w-4" />
                        )}
                      </Button>
                    )}
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
              <h3 className="text-lg font-semibold mb-1">No accounts linked yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {selectedCustomerId
                  ? "Link existing social accounts below, or connect a new platform."
                  : "Connect your first social media account below to start scheduling and publishing content."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Available (unlinked) Late accounts for this customer */}
      {selectedCustomerId && unlinkableAccounts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Available accounts to link</h2>
            <Badge variant="outline" className="font-normal">
              {unlinkableAccounts.length} available
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unlinkableAccounts.map((account) => {
              const platformInfo = platforms.find(
                (p) => p.slug === account.platform?.toLowerCase()
              );
              const isLinking = linking === account._id;
              return (
                <Card key={account._id} className="border-0 shadow-sm border-dashed">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Avatar className="h-11 w-11 opacity-60">
                      <AvatarImage src={account.avatarUrl} />
                      <AvatarFallback
                        className={`${platformInfo?.bgColor || "bg-muted"} text-sm font-bold`}
                        style={{ color: platformInfo?.color }}
                      >
                        {platformInfo?.icon || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {account.displayName || account.username || "Account"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {platformInfo?.name || account.platform}
                        {account.username && ` · @${account.username}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleLinkAccount(account)}
                      disabled={isLinking}
                      className="gap-1.5 bg-blue-500 hover:bg-blue-600 text-white shrink-0"
                    >
                      {isLinking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5" />
                          Link
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Available platforms — connect new */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Connect a new platform</h2>
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
                        {accountCount} {accountCount === 1 ? "account" : "accounts"} linked
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {isConnected && (
                      <Button
                        size="sm"
                        onClick={() => handleConnect(platform.slug)}
                        disabled={isConnecting}
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0"
                      >
                        {isConnecting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Reconnect"
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleConnect(platform.slug)}
                      disabled={isConnecting}
                      className="bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      {isConnecting && !isConnected ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isConnected ? (
                        <>
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add
                        </>
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  </div>
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
