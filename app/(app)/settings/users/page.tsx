"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  UserPlus,
  Mail,
  Loader2,
  X,
  ShieldCheck,
  Shield,
  Eye,
  Pencil,
  Building2,
  Search,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Minus,
} from "lucide-react";
import Link from "next/link";
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

/* ─────────────── Types ─────────────── */

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  provider: string;
  createdAt: string;
  role: string;
  appRole: string;
  invitedAt: string;
  joinedAt: string | null;
  accessEngine: boolean;
  accessEngineGpt: boolean;
  accessOperations: boolean;
  accessAdmin: boolean;
  accessMeetingBrain: boolean;
  accessRfpTool: boolean;
  accessAuthorityOn: boolean;
}

interface CustomerAssignment {
  customerId: string;
  customerName: string;
  role: string;
}

type AccessField =
  | "accessEngine"
  | "accessEngineGpt"
  | "accessOperations"
  | "accessAdmin"
  | "accessMeetingBrain"
  | "accessRfpTool"
  | "accessAuthorityOn";

/* ─────────────── Config ─────────────── */

const PAGE_SIZE = 25;

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

const accessFields: { key: AccessField; label: string }[] = [
  { key: "accessEngine", label: "Engine" },
  { key: "accessEngineGpt", label: "GPT" },
  { key: "accessOperations", label: "Ops" },
  { key: "accessAdmin", label: "Admin" },
  { key: "accessMeetingBrain", label: "MB" },
  { key: "accessRfpTool", label: "RFP" },
  { key: "accessAuthorityOn", label: "Auth" },
];

const appRoleOptions: { value: string; label: string; color: string; bg: string }[] = [
  { value: "tceadmin", label: "TCE Admin", color: "text-violet-500", bg: "bg-violet-500/10" },
  { value: "tcemanager", label: "TCE Manager", color: "text-blue-500", bg: "bg-blue-500/10" },
  { value: "tceuser", label: "TCE Staff", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { value: "clientadmin", label: "Client Admin", color: "text-orange-500", bg: "bg-orange-500/10" },
  { value: "clientuser", label: "Client User", color: "text-amber-500", bg: "bg-amber-500/10" },
  { value: "freelancer", label: "Freelancer", color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { value: "none", label: "No Access", color: "text-gray-400", bg: "bg-gray-500/10" },
];

/* ─────────────── Page ─────────────── */

export default function UsersSettingsPage() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerAssignments, setCustomerAssignments] = useState<
    Record<string, CustomerAssignment[]>
  >({});

  // Search & pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk dropdown
  const [bulkDropdown, setBulkDropdown] = useState<AccessField | null>(null);
  const bulkDropdownRef = useRef<HTMLDivElement>(null);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);

  /* ── Derived data ── */

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.email && m.email.toLowerCase().includes(q))
    );
  }, [members, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const pagedMembers = useMemo(
    () =>
      filteredMembers.slice(
        currentPage * PAGE_SIZE,
        (currentPage + 1) * PAGE_SIZE
      ),
    [filteredMembers, currentPage]
  );

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery]);

  // Close bulk dropdown on outside click
  useEffect(() => {
    if (!bulkDropdown) return;
    function handleClick(e: MouseEvent) {
      if (
        bulkDropdownRef.current &&
        !bulkDropdownRef.current.contains(e.target as Node)
      ) {
        setBulkDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bulkDropdown]);

  /* ── Selection helpers ── */

  const visibleIds = useMemo(
    () => new Set(pagedMembers.map((m) => m.id)),
    [pagedMembers]
  );

  const allVisibleSelected =
    pagedMembers.length > 0 &&
    pagedMembers.every((m) => selectedIds.has(m.id));
  const someVisibleSelected =
    pagedMembers.some((m) => selectedIds.has(m.id)) && !allVisibleSelected;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pagedMembers.forEach((m) => next.delete(m.id));
        return next;
      });
    } else {
      // Select all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pagedMembers.forEach((m) => next.add(m.id));
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── Data fetching ── */

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

  const fetchCustomerAssignments = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace/customer-assignments");
      if (!res.ok) return;
      const data = await res.json();
      const assignments: {
        userId: string;
        customerId: string;
        customerName: string;
        role: string;
      }[] = data.assignments || [];

      const grouped: Record<string, CustomerAssignment[]> = {};
      for (const a of assignments) {
        if (!grouped[a.userId]) grouped[a.userId] = [];
        grouped[a.userId].push({
          customerId: a.customerId,
          customerName: a.customerName,
          role: a.role,
        });
      }
      setCustomerAssignments(grouped);
    } catch {
      // silently fail — badges just won't show
    }
  }, []);

  useEffect(() => {
    fetchMembers();
    fetchCustomerAssignments();
  }, [fetchMembers, fetchCustomerAssignments]);

  /* ── Handlers ── */

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


  const handleUpdateAccess = async (
    userId: string,
    field: AccessField,
    value: boolean
  ) => {
    try {
      const res = await fetch("/api/workspace-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to update access");
      // Optimistic update
      setMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, [field]: value } : m))
      );
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleBulkAccess = async (field: AccessField, value: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDropdown(null);
    try {
      const res = await fetch("/api/workspace-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ids, [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to update access");
      // Optimistic update
      setMembers((prev) =>
        prev.map((m) =>
          selectedIds.has(m.id) ? { ...m, [field]: value } : m
        )
      );
      const label =
        field === "accessEngine"
          ? "Engine"
          : field === "accessEngineGpt"
            ? "GPT"
            : field === "accessOperations"
              ? "Ops"
              : field === "accessAdmin"
                ? "Admin"
                : "MB";
      toast.success(
        `${value ? "Enabled" : "Disabled"} ${label} access for ${ids.length} user${ids.length !== 1 ? "s" : ""}`
      );
      setSelectedIds(new Set());
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      await fetchMembers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  /* ── Render ── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {/* ── Action bar: search + add user ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name or email..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          {filteredMembers.length} user{filteredMembers.length !== 1 ? "s" : ""}
        </p>
        <Button
          onClick={() => setInviteOpen(true)}
          size="sm"
          className="gap-1.5 h-8 shrink-0"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add User
        </Button>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-1" ref={bulkDropdownRef}>
            {accessFields.map(({ key, label }) => (
              <div key={key} className="relative">
                <button
                  onClick={() =>
                    setBulkDropdown(bulkDropdown === key ? null : key)
                  }
                  className={cn(
                    "text-[11px] font-medium px-2 py-1 rounded flex items-center gap-0.5 transition-colors",
                    bulkDropdown === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-foreground"
                  )}
                >
                  {label}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {bulkDropdown === key && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-md min-w-[120px] py-1">
                    <button
                      onClick={() => handleBulkAccess(key, true)}
                      className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors text-emerald-600 dark:text-emerald-400"
                    >
                      Enable all
                    </button>
                    <button
                      onClick={() => handleBulkAccess(key, false)}
                      className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors text-red-500"
                    >
                      Disable all
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Users list ── */}
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
            {/* Select all header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
              <button
                onClick={toggleSelectAll}
                className={cn(
                  "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  allVisibleSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : someVisibleSelected
                      ? "bg-primary/50 border-primary text-primary-foreground"
                      : "border-muted-foreground/30 hover:border-muted-foreground/50"
                )}
              >
                {allVisibleSelected && <Check className="h-3 w-3" />}
                {someVisibleSelected && <Minus className="h-3 w-3" />}
              </button>
              <span className="text-[11px] text-muted-foreground">
                Select all
              </span>
              {filteredMembers.length !== members.length && (
                <span className="text-[10px] text-muted-foreground/60">
                  ({filteredMembers.length} filtered)
                </span>
              )}
            </div>

            {/* Member rows */}
            <div className="divide-y">
              {pagedMembers.map((member) => {
                const rc = roleConfig[member.role] || roleConfig.viewer;
                const assignments = customerAssignments[member.id] || [];
                const isSelected = selectedIds.has(member.id);
                return (
                  <div
                    key={member.id}
                    className={cn(
                      "group flex items-center gap-3 p-3 transition-colors",
                      isSelected
                        ? "bg-primary/5"
                        : "hover:bg-muted/30"
                    )}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelect(member.id)}
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30 hover:border-muted-foreground/50"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </button>

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
                      {/* Customer assignment badges */}
                      {assignments.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {assignments.map((a) => (
                            <Link
                              key={a.customerId}
                              href={`/settings/customers/${a.customerId}`}
                              className="inline-flex items-center gap-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] px-1.5 py-0.5 rounded hover:bg-blue-500/20 transition-colors"
                            >
                              <Building2 className="h-2.5 w-2.5 shrink-0" />
                              {a.customerName}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Role + User Type + Access */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        {/* Workspace role */}
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
                        {/* App role (user type) — read-only, managed externally */}
                        {(() => {
                          const ar = appRoleOptions.find((o) => o.value === member.appRole) || appRoleOptions[appRoleOptions.length - 1];
                          return (
                            <span
                              className={cn(
                                "rounded-md text-[10px] font-medium px-2 py-1",
                                ar.bg,
                                ar.color
                              )}
                              title="User type (managed in Postgres)"
                            >
                              {ar.label}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Area access pills */}
                      <div className="flex flex-wrap gap-1">
                        {accessFields.map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() =>
                              handleUpdateAccess(
                                member.id,
                                key,
                                !member[key]
                              )
                            }
                            className={cn(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors",
                              member[key]
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground/40"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

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

            {/* No search results */}
            {filteredMembers.length === 0 && searchQuery && (
              <div className="flex flex-col items-center py-8 text-center">
                <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No users match &ldquo;{searchQuery}&rdquo;
                </p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t">
                <p className="text-[11px] text-muted-foreground">
                  {currentPage * PAGE_SIZE + 1}&ndash;
                  {Math.min(
                    (currentPage + 1) * PAGE_SIZE,
                    filteredMembers.length
                  )}{" "}
                  of {filteredMembers.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.max(0, p - 1))
                    }
                    disabled={currentPage === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] text-muted-foreground px-1">
                    Page {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentPage((p) =>
                        Math.min(totalPages - 1, p + 1)
                      )
                    }
                    disabled={currentPage >= totalPages - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Invite User Dialog ── */}
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
