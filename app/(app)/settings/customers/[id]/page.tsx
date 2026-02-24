"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Plus,
  Loader2,
  ArrowLeft,
  Trash2,
  Pencil,
  Check,
  X,
  FileText,
  Calendar,
  DollarSign,
  Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

// ── Status badge helpers ──

const customerStatusStyles: Record<string, string> = {
  active: "bg-green-500/10 text-green-600",
  inactive: "bg-gray-500/10 text-gray-500",
  archived: "bg-red-500/10 text-red-500",
};

const contractStatusStyles: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-500",
  active: "bg-green-500/10 text-green-600",
  completed: "bg-blue-500/10 text-blue-600",
  expired: "bg-red-500/10 text-red-500",
};

// ── Format helpers ──

function formatCU(value: number | null | undefined): string {
  if (value == null) return "0.0";
  return value.toFixed(1);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── CU Progress Ring (SVG donut) ──

function CUProgressRing({
  used,
  total,
  size = 80,
  strokeWidth = 6,
}: {
  used: number;
  total: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const offset = circumference - (percentage / 100) * circumference;

  const color =
    percentage >= 90
      ? "text-red-500"
      : percentage >= 70
      ? "text-amber-500"
      : "text-blue-500";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="-rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/50"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${color}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  // Data state
  const [customer, setCustomer] = useState<any>(null);
  const [customerContracts, setCustomerContracts] = useState<any[]>([]);
  const [contentObjects, setContentObjects] = useState<any[]>([]);
  const [contentCount, setContentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<
    "overview" | "contracts" | "content"
  >("overview");

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    website: "",
    industry: "",
    primaryContactName: "",
    primaryContactEmail: "",
    notes: "",
  });

  // Add contract dialog
  const [showAddContract, setShowAddContract] = useState(false);
  const [contractForm, setContractForm] = useState({
    name: "",
    totalContentUnits: "",
    startDate: "",
    endDate: "",
    monthlyFee: "",
    notes: "",
  });
  const [addingContract, setAddingContract] = useState(false);

  // ── Data fetching ──

  const fetchCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to fetch customer");
      const data = await res.json();
      const c = data.customer;
      setCustomer(c);
      setCustomerContracts(c.contracts || []);
      setContentCount(c.contentCount || 0);
      setEditForm({
        name: c.name || "",
        website: c.website || "",
        industry: c.industry || "",
        primaryContactName: c.primaryContactName || "",
        primaryContactEmail: c.primaryContactEmail || "",
        notes: c.notes || "",
      });
    } catch (err) {
      console.error("Failed to fetch customer:", err);
    }
  }, [customerId]);

  const fetchContent = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/content-objects?customerId=${customerId}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setContentObjects(data.contentObjects || []);
    } catch (err) {
      console.error("Failed to fetch content objects:", err);
    }
  }, [customerId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchCustomer();
      setLoading(false);
    };
    load();
  }, [fetchCustomer]);

  // Fetch content objects lazily when the content tab is activated
  useEffect(() => {
    if (activeTab === "content") {
      fetchContent();
    }
  }, [activeTab, fetchContent]);

  // ── Actions ──

  const saveCustomer = async (updates: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.customer) {
        setCustomer(data.customer);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    await saveCustomer(editForm);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    if (customer) {
      setEditForm({
        name: customer.name || "",
        website: customer.website || "",
        industry: customer.industry || "",
        primaryContactName: customer.primaryContactName || "",
        primaryContactEmail: customer.primaryContactEmail || "",
        notes: customer.notes || "",
      });
    }
    setEditing(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    await saveCustomer({ status: newStatus });
  };

  const handleAddContract = async () => {
    if (!contractForm.name.trim() || !contractForm.totalContentUnits) return;
    setAddingContract(true);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          name: contractForm.name.trim(),
          totalContentUnits: parseFloat(contractForm.totalContentUnits),
          startDate: contractForm.startDate || new Date().toISOString(),
          endDate:
            contractForm.endDate ||
            new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          monthlyFee: contractForm.monthlyFee
            ? parseFloat(contractForm.monthlyFee)
            : null,
          notes: contractForm.notes || null,
        }),
      });
      const data = await res.json();
      if (data.contract) {
        setCustomerContracts((prev) => [data.contract, ...prev]);
        setShowAddContract(false);
        setContractForm({
          name: "",
          totalContentUnits: "",
          startDate: "",
          endDate: "",
          monthlyFee: "",
          notes: "",
        });
      }
    } catch (err) {
      console.error("Add contract failed:", err);
    } finally {
      setAddingContract(false);
    }
  };

  const handleContractStatusChange = async (
    contractId: string,
    newStatus: string
  ) => {
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.contract) {
        setCustomerContracts((prev) =>
          prev.map((c) => (c.id === contractId ? data.contract : c))
        );
      }
    } catch (err) {
      console.error("Contract status update failed:", err);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this customer?")) return;
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/settings/customers");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete customer");
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ── Computed values ──

  const totalCU = customerContracts.reduce(
    (sum, c) => sum + (c.totalContentUnits || 0) + (c.rolloverUnits || 0),
    0
  );
  const usedCU = customerContracts.reduce(
    (sum, c) => sum + (c.usedContentUnits || 0),
    0
  );
  const remainingCU = totalCU - usedCU;

  const activeContracts = customerContracts.filter(
    (c) => c.status === "active"
  );
  const hasActiveContracts = activeContracts.length > 0;

  // ── Loading state ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-center text-muted-foreground py-16">
          Customer not found
        </p>
      </div>
    );
  }

  // ── Tab content renderers ──

  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Customer Info Card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Customer Information
            </CardTitle>
            {!editing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                className="gap-1.5 h-7 text-xs"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="gap-1 h-7 text-xs text-green-600 hover:text-green-700"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="gap-1 h-7 text-xs text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Name
                </label>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Website
                </label>
                <Input
                  value={editForm.website}
                  onChange={(e) =>
                    setEditForm({ ...editForm, website: e.target.value })
                  }
                  className="h-8 text-sm"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Industry
                </label>
                <Input
                  value={editForm.industry}
                  onChange={(e) =>
                    setEditForm({ ...editForm, industry: e.target.value })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Primary Contact Name
                </label>
                <Input
                  value={editForm.primaryContactName}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      primaryContactName: e.target.value,
                    })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Primary Contact Email
                </label>
                <Input
                  type="email"
                  value={editForm.primaryContactEmail}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      primaryContactEmail: e.target.value,
                    })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Notes
                </label>
                <Textarea
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { label: "Name", value: customer.name },
                {
                  label: "Website",
                  value: customer.website,
                  isLink: true,
                },
                { label: "Industry", value: customer.industry },
                {
                  label: "Primary Contact",
                  value: customer.primaryContactName,
                },
                {
                  label: "Contact Email",
                  value: customer.primaryContactEmail,
                },
              ].map(({ label, value, isLink }) => (
                <div
                  key={label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{label}</span>
                  {isLink && value ? (
                    <a
                      href={
                        value.startsWith("http") ? value : `https://${value}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate max-w-[200px]"
                    >
                      {value}
                    </a>
                  ) : (
                    <span className="text-foreground/80 truncate max-w-[200px]">
                      {value || "--"}
                    </span>
                  )}
                </div>
              ))}
              {customer.notes && (
                <div className="pt-2 border-t">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                    Notes
                  </span>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap">
                    {customer.notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CU Summary Card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="px-5 pt-5 pb-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            Content Units Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-4">
          <div className="flex items-center gap-6">
            <CUProgressRing used={usedCU} total={totalCU} size={90} strokeWidth={7} />
            <div className="flex-1 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Budget</span>
                <span className="font-semibold">{formatCU(totalCU)} CU</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="font-semibold">{formatCU(usedCU)} CU</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining</span>
                <span className="font-semibold text-green-600">
                  {formatCU(remainingCU)} CU
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderContractsTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {customerContracts.length} contract
          {customerContracts.length !== 1 ? "s" : ""}
        </h3>
        <Button
          size="sm"
          onClick={() => setShowAddContract(true)}
          className="gap-1.5 h-8 text-xs"
        >
          <Plus className="h-3 w-3" />
          Add Contract
        </Button>
      </div>

      {customerContracts.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No contracts yet. Add one to start tracking content units.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {customerContracts.map((contract) => {
            const contractTotal =
              (contract.totalContentUnits || 0) +
              (contract.rolloverUnits || 0);
            const contractUsed = contract.usedContentUnits || 0;
            const contractPct =
              contractTotal > 0
                ? Math.min((contractUsed / contractTotal) * 100, 100)
                : 0;

            return (
              <Card key={contract.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold truncate">
                          {contract.name}
                        </h4>
                        <Badge
                          variant="secondary"
                          className={`${
                            contractStatusStyles[contract.status] ||
                            "bg-gray-500/10 text-gray-500"
                          } border-0 text-[10px] capitalize`}
                        >
                          {contract.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(contract.startDate)} &mdash;{" "}
                          {formatDate(contract.endDate)}
                        </span>
                        {contract.monthlyFee != null && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {formatCurrency(contract.monthlyFee)}/mo
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Contract status actions */}
                    <div className="shrink-0 ml-3">
                      <select
                        value={contract.status}
                        onChange={(e) =>
                          handleContractStatusChange(
                            contract.id,
                            e.target.value
                          )
                        }
                        className="rounded-md border bg-background px-2 py-1 text-xs h-7"
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  </div>

                  {/* CU progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {formatCU(contractUsed)} / {formatCU(contractTotal)} CU
                      </span>
                      <span>{contractPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${contractPct}%` }}
                      />
                    </div>
                  </div>

                  {contract.rolloverUnits > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Includes {formatCU(contract.rolloverUnits)} rollover units
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderContentTab = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {contentObjects.length} content item
        {contentObjects.length !== 1 ? "s" : ""}
      </h3>

      {contentObjects.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No content linked to this customer yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Title
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Type
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    CU Cost
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {contentObjects.map((obj) => (
                  <tr
                    key={obj.id}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => router.push(`/content/${obj.id}`)}
                  >
                    <td className="px-4 py-3 font-medium truncate max-w-[250px]">
                      {obj.workingTitle || obj.finalTitle || "Untitled"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className="text-[10px] capitalize border-0"
                      >
                        {obj.contentType}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCU(obj.contentUnits)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className="text-[10px] capitalize border-0"
                      >
                        {obj.status?.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(obj.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );

  // ── Render ──

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "contracts" as const, label: "Contracts" },
    { key: "content" as const, label: "Content" },
  ];

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-1.5 h-8 px-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {customer.name}
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="secondary"
                    className={`${
                      customerStatusStyles[customer.status] ||
                      "bg-gray-500/10 text-gray-500"
                    } border-0 text-[10px] capitalize`}
                  >
                    {customer.status}
                  </Badge>
                  {customer.industry && (
                    <span className="text-xs text-muted-foreground">
                      {customer.industry}
                    </span>
                  )}
                  {saving && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Tab navigation + content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pill tabs */}
          <div className="bg-muted rounded-lg p-1 flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "overview" && renderOverviewTab()}
          {activeTab === "contracts" && renderContractsTab()}
          {activeTab === "content" && renderContentTab()}
        </div>

        {/* RIGHT: Sidebar */}
        <div className="space-y-4">
          {/* Status Card */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold">Status</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-3">
              <select
                value={customer.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm h-8"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold">
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Content Items
                  </span>
                  <span className="font-semibold">{contentCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Active Contracts
                  </span>
                  <span className="font-semibold">
                    {activeContracts.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    Total CU Budget
                  </span>
                  <span className="font-semibold">{formatCU(totalCU)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    CU Remaining
                  </span>
                  <span className="font-semibold text-green-600">
                    {formatCU(remainingCU)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Back to Customers Link */}
          <Link href="/settings/customers">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Customers
            </Button>
          </Link>

          {/* Delete Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={hasActiveContracts}
            className="w-full gap-2 text-muted-foreground hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Customer
          </Button>
          {hasActiveContracts && (
            <p className="text-[11px] text-muted-foreground text-center -mt-2">
              Cannot delete -- has active contracts
            </p>
          )}
        </div>
      </div>

      {/* ── Add Contract Dialog ── */}
      <Dialog open={showAddContract} onOpenChange={setShowAddContract}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-500" />
              Add Contract
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Contract Name *
              </label>
              <Input
                value={contractForm.name}
                onChange={(e) =>
                  setContractForm({ ...contractForm, name: e.target.value })
                }
                placeholder="e.g. Q1 2026 Retainer"
                className="h-8 text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Total Content Units *
              </label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={contractForm.totalContentUnits}
                onChange={(e) =>
                  setContractForm({
                    ...contractForm,
                    totalContentUnits: e.target.value,
                  })
                }
                placeholder="e.g. 20"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={contractForm.startDate}
                  onChange={(e) =>
                    setContractForm({
                      ...contractForm,
                      startDate: e.target.value,
                    })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  End Date
                </label>
                <Input
                  type="date"
                  value={contractForm.endDate}
                  onChange={(e) =>
                    setContractForm({
                      ...contractForm,
                      endDate: e.target.value,
                    })
                  }
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Monthly Fee
              </label>
              <Input
                type="number"
                step="1"
                min="0"
                value={contractForm.monthlyFee}
                onChange={(e) =>
                  setContractForm({
                    ...contractForm,
                    monthlyFee: e.target.value,
                  })
                }
                placeholder="e.g. 5000"
                className="h-8 text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Notes
              </label>
              <Textarea
                value={contractForm.notes}
                onChange={(e) =>
                  setContractForm({
                    ...contractForm,
                    notes: e.target.value,
                  })
                }
                rows={3}
                placeholder="Optional notes..."
                className="text-sm resize-none"
              />
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleAddContract}
              disabled={
                addingContract ||
                !contractForm.name.trim() ||
                !contractForm.totalContentUnits
              }
            >
              {addingContract ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create Contract
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
