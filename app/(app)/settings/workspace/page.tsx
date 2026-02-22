"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Check, Key, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const planLabels: Record<string, { label: string; color: string }> = {
  free: { label: "Free", color: "bg-gray-500/10 text-gray-500" },
  starter: { label: "Starter", color: "bg-blue-500/10 text-blue-500" },
  pro: { label: "Pro", color: "bg-violet-500/10 text-violet-500" },
  agency: { label: "Agency", color: "bg-amber-500/10 text-amber-500" },
};

export default function WorkspaceSettingsPage() {
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace");
      const data = await res.json();
      if (data.workspace) {
        setWorkspace(data.workspace);
        setName(data.workspace.name || "");
        setSlug(data.workspace.slug || "");
        setApiKey(data.workspace.lateApiKey || "");
      }
    } catch (err) {
      console.error("Failed to load workspace:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Workspace name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          lateApiKey: apiKey.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      const data = await res.json();
      setWorkspace(data.workspace);
      toast.success("Workspace updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const plan = planLabels[workspace?.plan] || planLabels.free;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* General */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Workspace Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-md h-9"
              placeholder="My Workspace"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Workspace URL
            </label>
            <div className="flex items-center gap-0 max-w-md">
              <span className="text-xs text-muted-foreground bg-muted px-3 py-2 rounded-l-md border border-r-0 h-9 flex items-center">
                contentengine.app/
              </span>
              <Input
                value={slug}
                onChange={(e) =>
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                      .replace(/-+/g, "-")
                  )
                }
                className="rounded-l-none h-9"
                placeholder="my-workspace"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Current Plan
            </label>
            <Badge
              variant="secondary"
              className={`${plan.color} border-0 text-xs`}
            >
              {plan.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* API Integration */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            API Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
              Late API Key
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Connect your Late.com account to sync social profiles and post
              scheduling.
            </p>
            <div className="flex items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="h-9 pr-9 font-mono text-xs"
                  placeholder="sk_live_..."
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2"
          size="sm"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save Changes
        </Button>
        {workspace && (
          <span className="text-xs text-muted-foreground">
            Last updated{" "}
            {new Date(workspace.updatedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
