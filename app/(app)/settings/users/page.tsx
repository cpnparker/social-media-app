"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  Mail,
  Loader2,
  X,
  ShieldCheck,
  Shield,
  Eye,
  Pencil,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  provider: string;
  createdAt: string;
  role: string;
  invitedAt: string;
  joinedAt: string | null;
}

const roleConfig: Record<
  string,
  { icon: any; color: string; bg: string; label: string }
> = {
  owner: {
    icon: ShieldCheck,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    label: "Owner",
  },
  admin: {
    icon: ShieldCheck,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    label: "Admin",
  },
  editor: {
    icon: Pencil,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    label: "Editor",
  },
  viewer: {
    icon: Eye,
    color: "text-gray-500",
    bg: "bg-gray-500/10",
    label: "Viewer",
  },
};

const roleOptions = ["owner", "admin", "editor", "viewer"];

export default function UsersSettingsPage() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace-members");
      if (!res.ok) return;
      const data = await res.json();
      setMembers(data.members || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/workspace-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          name: inviteName.trim() || undefined,
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to invite user");
      }
      toast.success("User added to workspace");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("viewer");
      await fetchMembers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch("/api/workspace-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) throw new Error("Failed to update role");
      toast.success("Role updated");
      await fetchMembers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRemove = async (userId: string, userName: string) => {
    if (!confirm(`Remove ${userName} from the workspace?`)) return;
    try {
      const res = await fetch(`/api/workspace-members?userId=${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove user");
      toast.success("User removed");
      await fetchMembers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} user{members.length !== 1 ? "s" : ""} in workspace
        </p>
        <Button
          onClick={() => setInviteOpen(true)}
          size="sm"
          className="gap-1.5 h-8"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add User
        </Button>
      </div>

      {/* Users list */}
      {members.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-14 w-14 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
              <UserPlus className="h-6 w-6 text-violet-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No users yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add users to your workspace to collaborate on content.
            </p>
            <Button
              onClick={() => setInviteOpen(true)}
              className="mt-4 gap-2"
              size="sm"
            >
              <UserPlus className="h-4 w-4" /> Add User
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="divide-y">
              {members.map((member) => {
                const rc = roleConfig[member.role] || roleConfig.viewer;
                return (
                  <div
                    key={member.id}
                    className="group flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
                  >
                    {/* Avatar */}
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={member.name}
                        className="h-9 w-9 rounded-full shrink-0"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                        {member.name?.charAt(0).toUpperCase() || "?"}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {member.name}
                        </p>
                        {member.provider === "google" && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            Google
                          </span>
                        )}
                        {!member.joinedAt && (
                          <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            Invited
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    </div>

                    {/* Role selector */}
                    <select
                      value={member.role}
                      onChange={(e) =>
                        handleChangeRole(member.id, e.target.value)
                      }
                      className={cn(
                        "rounded-md border-0 text-xs font-medium px-2 py-1 cursor-pointer",
                        rc.bg,
                        rc.color
                      )}
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {roleConfig[r]?.label || r}
                        </option>
                      ))}
                    </select>

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemove(member.id, member.name)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-500 transition-all p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Enter an email to add a user. If they don&apos;t have an account,
              one will be created for them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="h-9 pl-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInvite();
                  }}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Name (optional)
              </label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Full name"
                className="h-9"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm h-9"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleConfig[r]?.label || r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviting}
                className="gap-2"
              >
                {inviting && <Loader2 className="h-4 w-4 animate-spin" />} Add
                User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
