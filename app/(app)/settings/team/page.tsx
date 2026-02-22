"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Trash2,
  Shield,
  ShieldCheck,
  User,
  Loader2,
  Link2,
  Unlink,
  ChevronDown,
  ChevronRight,
  UserPlus,
  Mail,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { platformLabels, platformHexColors } from "@/lib/platform-utils";
import { useTeam } from "@/lib/contexts/TeamContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TeamMember {
  id: string;
  role: string;
  joinedAt: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatar: string | null;
}

interface TeamAccount {
  id: string;
  lateAccountId: string;
  platform: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  createdAt: string;
  members: TeamMember[];
  accounts: TeamAccount[];
}

const roleConfig: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  admin: { icon: ShieldCheck, color: "text-violet-500", bg: "bg-violet-500/10", label: "Admin" },
  manager: { icon: Shield, color: "text-blue-500", bg: "bg-blue-500/10", label: "Manager" },
  user: { icon: User, color: "text-gray-500", bg: "bg-gray-500/10", label: "User" },
};

const roleOptions = ["admin", "manager", "user"];

export default function TeamSettingsPage() {
  const { teams, refreshTeams } = useTeam();
  const [teamDetails, setTeamDetails] = useState<Record<string, TeamDetail>>({});
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create team dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Add member dialog
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("user");
  const [addingMember, setAddingMember] = useState(false);

  // Edit team name inline
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [editTeamDesc, setEditTeamDesc] = useState("");

  // Available accounts
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);

  const fetchTeamDetail = useCallback(async (teamId: string) => {
    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) return;
      const data = await res.json();
      setTeamDetails((prev) => ({ ...prev, [teamId]: data.team }));
    } catch {}
  }, []);

  const fetchAvailableAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) return;
      const data = await res.json();
      setAvailableAccounts(data.accounts || []);
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAvailableAccounts();
    Promise.all(teams.map((t) => fetchTeamDetail(t.id))).finally(() => setLoading(false));
  }, [teams, fetchTeamDetail, fetchAvailableAccounts]);

  useEffect(() => {
    if (teams.length > 0 && !expandedTeam) setExpandedTeam(teams[0].id);
  }, [teams, expandedTeam]);

  // ─── Handlers ───

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreating(true);
    try {
      const workspaceId = teams[0]?.workspaceId;
      if (!workspaceId) { toast.error("No workspace found"); return; }
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim(), description: newTeamDescription.trim() || null, workspaceId }),
      });
      if (!res.ok) throw new Error("Failed to create team");
      toast.success("Team created");
      setCreateDialogOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
      await refreshTeams();
    } catch (err: any) {
      toast.error(err.message || "Failed to create team");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateTeam = async (teamId: string) => {
    if (!editTeamName.trim()) return;
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editTeamName.trim(), description: editTeamDesc.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Team updated");
      setEditingTeamId(null);
      await refreshTeams();
      await fetchTeamDetail(teamId);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm("Delete this team and all its linked accounts?")) return;
    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Team deleted");
      setExpandedTeam(null);
      await refreshTeams();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !addMemberTeamId) return;
    setAddingMember(true);
    try {
      const res = await fetch(`/api/teams/${addMemberTeamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newMemberEmail.trim(), role: newMemberRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add member");
      }
      toast.success("Member added");
      const teamId = addMemberTeamId;
      setAddMemberTeamId(null);
      setNewMemberEmail("");
      setNewMemberRole("user");
      await fetchTeamDetail(teamId);
      await refreshTeams();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (teamId: string, memberId: string) => {
    if (!confirm("Remove this member from the team?")) return;
    try {
      const res = await fetch(`/api/teams/${teamId}/members?memberId=${memberId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove member");
      toast.success("Member removed");
      await fetchTeamDetail(teamId);
      await refreshTeams();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleChangeRole = async (teamId: string, memberId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role: newRole }),
      });
      if (!res.ok) throw new Error("Failed to update role");
      toast.success("Role updated");
      await fetchTeamDetail(teamId);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUnlinkAccount = async (teamId: string, accountId: string) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/accounts?accountId=${accountId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink");
      toast.success("Account unlinked");
      await fetchTeamDetail(teamId);
      await refreshTeams();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleLinkAccount = async (teamId: string, account: any) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lateAccountId: account._id || account.id,
          platform: (account.platform || "unknown").toLowerCase(),
          displayName: account.displayName || account.username || "Unknown",
          username: account.username || null,
          avatarUrl: account.avatarUrl || account.avatar || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to link");
      toast.success("Account linked");
      await fetchTeamDetail(teamId);
      await refreshTeams();
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
          {teams.length} team{teams.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="gap-1.5 h-8">
          <Plus className="h-3.5 w-3.5" /> New Team
        </Button>
      </div>

      {/* Teams */}
      {teams.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-14 w-14 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-violet-500" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No teams yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create your first team to organize accounts and members.</p>
            <Button onClick={() => setCreateDialogOpen(true)} className="mt-4 gap-2" size="sm">
              <Plus className="h-4 w-4" /> Create Team
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => {
            const detail = teamDetails[team.id];
            const isExpanded = expandedTeam === team.id;
            const isEditing = editingTeamId === team.id;

            return (
              <Card key={team.id} className="border-0 shadow-sm overflow-hidden">
                {/* Team header */}
                <button
                  onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5 text-violet-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.memberCount} member{team.memberCount !== 1 ? "s" : ""} &middot; {team.accountCount} account{team.accountCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>

                {/* Expanded content */}
                {isExpanded && detail && (
                  <CardContent className="pt-0 pb-4 space-y-5">
                    {/* Team info (editable) */}
                    {isEditing ? (
                      <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                        <Input value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)} className="h-8 text-sm" placeholder="Team name" />
                        <Input value={editTeamDesc} onChange={(e) => setEditTeamDesc(e.target.value)} className="h-8 text-sm" placeholder="Description (optional)" />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleUpdateTeam(team.id)} disabled={!editTeamName.trim()}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingTeamId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {detail.description && <p className="text-sm text-muted-foreground flex-1">{detail.description}</p>}
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground shrink-0" onClick={() => { setEditingTeamId(team.id); setEditTeamName(team.name); setEditTeamDesc(detail.description || ""); }}>
                          Edit
                        </Button>
                      </div>
                    )}

                    {/* Members */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" /> Members ({detail.members.length})
                        </h4>
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setAddMemberTeamId(team.id); setNewMemberEmail(""); setNewMemberRole("user"); }}>
                          <UserPlus className="h-3 w-3" /> Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {detail.members.map((member) => {
                          const rc = roleConfig[member.role] || roleConfig.user;
                          return (
                            <div key={member.id} className="group flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                                {member.userName?.charAt(0).toUpperCase() || "?"}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{member.userName}</p>
                                <p className="text-xs text-muted-foreground truncate">{member.userEmail}</p>
                              </div>
                              <select
                                value={member.role}
                                onChange={(e) => handleChangeRole(team.id, member.id, e.target.value)}
                                className={cn("rounded-md border-0 text-xs font-medium px-2 py-1 cursor-pointer", rc.bg, rc.color)}
                              >
                                {roleOptions.map((r) => (
                                  <option key={r} value={r}>{roleConfig[r]?.label || r}</option>
                                ))}
                              </select>
                              <button onClick={() => handleRemoveMember(team.id, member.id)} className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-500 transition-all p-1">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {detail.members.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-3">No members yet</p>
                        )}
                      </div>
                    </div>

                    {/* Linked Accounts */}
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-muted-foreground" /> Linked Accounts ({detail.accounts.length})
                      </h4>
                      <div className="space-y-1">
                        {detail.accounts.map((acc) => {
                          const platform = acc.platform?.toLowerCase();
                          const color = platformHexColors[platform] || "#6b7280";
                          const label = platformLabels[platform] || acc.platform;
                          return (
                            <div key={acc.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors group">
                              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{acc.displayName}</p>
                                <p className="text-xs text-muted-foreground">{label}{acc.username && ` @${acc.username}`}</p>
                              </div>
                              <button onClick={() => handleUnlinkAccount(team.id, acc.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-red-500/10 text-red-500">
                                <Unlink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {availableAccounts.length > 0 && (
                          <div className="pt-2">
                            <p className="text-xs text-muted-foreground mb-2">Link an account:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {availableAccounts
                                .filter((a) => !detail.accounts.some((linked) => linked.lateAccountId === (a._id || a.id)))
                                .map((acc) => {
                                  const platform = (acc.platform || "").toLowerCase();
                                  const color = platformHexColors[platform] || "#6b7280";
                                  return (
                                    <button key={acc._id || acc.id} onClick={() => handleLinkAccount(team.id, acc)} className="inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 font-medium border border-dashed border-muted-foreground/30 hover:bg-muted/50 transition-colors">
                                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                      <Plus className="h-2.5 w-2.5" />
                                      {acc.displayName || acc.username}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Danger zone */}
                    <div className="pt-3 border-t flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Created {new Date(detail.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteTeam(team.id)} className="gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 h-7 text-xs">
                        <Trash2 className="h-3 w-3" /> Delete Team
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Team Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>Teams help you organize accounts and members.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Team Name</label>
              <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. Marketing, Sales" className="h-9" onKeyDown={(e) => { if (e.key === "Enter") handleCreateTeam(); }} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
              <Input value={newTeamDescription} onChange={(e) => setNewTeamDescription(e.target.value)} placeholder="What is this team for?" className="h-9" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateTeam} disabled={!newTeamName.trim() || creating} className="gap-2">
                {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create Team
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={!!addMemberTeamId} onOpenChange={(open) => { if (!open) setAddMemberTeamId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>Enter the email address of the user to add.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="user@example.com" className="h-9 pl-9" onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(); }} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role</label>
              <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm h-9">
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{roleConfig[r]?.label || r}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddMemberTeamId(null)}>Cancel</Button>
              <Button size="sm" onClick={handleAddMember} disabled={!newMemberEmail.trim() || addingMember} className="gap-2">
                {addingMember && <Loader2 className="h-4 w-4 animate-spin" />} Add Member
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
