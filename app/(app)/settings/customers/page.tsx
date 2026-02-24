"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, Plus, Loader2, Search, FileText } from "lucide-react";
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Customer {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  status: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  website: string | null;
  logoUrl: string | null;
  activeContracts: number;
  totalBudget: number;
  usedBudget: number;
}

const statusTabs = ["all", "active", "inactive", "archived"] as const;
type StatusTab = (typeof statusTabs)[number];

const statusBadgeStyles: Record<string, string> = {
  active: "bg-green-500/10 text-green-600",
  inactive: "bg-gray-500/10 text-gray-500",
  archived: "bg-red-500/10 text-red-600",
};

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formIndustry, setFormIndustry] = useState("");
  const [formContactName, setFormContactName] = useState("");
  const [formContactEmail, setFormContactEmail] = useState("");
  const [formWebsite, setFormWebsite] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const qs = params.toString();
      const res = await fetch(`/api/customers${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err) {
      console.error("Failed to fetch customers:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const resetForm = () => {
    setFormName("");
    setFormIndustry("");
    setFormContactName("");
    setFormContactEmail("");
    setFormWebsite("");
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          industry: formIndustry.trim() || undefined,
          primaryContactName: formContactName.trim() || undefined,
          primaryContactEmail: formContactEmail.trim() || undefined,
          website: formWebsite.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        console.error("Failed to create customer:", errData.error);
        return;
      }

      resetForm();
      setDialogOpen(false);
      fetchCustomers();
    } catch (err) {
      console.error("Failed to create customer:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCU = (value: number) => {
    return Number(value || 0).toFixed(1);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-blue-500" />
            Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your agency clients and content budgets
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {statusTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Customer Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : customers.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No customers yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first customer to start managing content budgets
            </p>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((customer) => {
            const total = Number(customer.totalBudget) || 0;
            const used = Number(customer.usedBudget) || 0;
            const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
            const contracts = Number(customer.activeContracts) || 0;

            return (
              <Card
                key={customer.id}
                className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(`/settings/customers/${customer.id}`)}
              >
                <CardContent className="p-5 space-y-3">
                  {/* Name + Industry */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-base truncate">
                        {customer.name}
                      </h3>
                      {customer.industry && (
                        <Badge
                          variant="secondary"
                          className="border-0 text-[10px] mt-1"
                        >
                          {customer.industry}
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-0 text-[10px] capitalize shrink-0",
                        statusBadgeStyles[customer.status] || "bg-gray-500/10 text-gray-500"
                      )}
                    >
                      {customer.status}
                    </Badge>
                  </div>

                  {/* CU Usage Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>CU Usage</span>
                      <span>
                        {formatCU(used)} / {formatCU(total)} CUs
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          pct >= 90
                            ? "bg-red-500"
                            : pct >= 70
                              ? "bg-amber-500"
                              : "bg-blue-500"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Contracts count */}
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {contracts} active {contracts === 1 ? "contract" : "contracts"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Customer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
            <DialogDescription>
              Create a new customer to manage their content and contracts.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCustomer} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Customer name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Industry</label>
              <Input
                placeholder="e.g. Technology, Healthcare, Finance"
                value={formIndustry}
                onChange={(e) => setFormIndustry(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Primary Contact Name</label>
              <Input
                placeholder="Contact name"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Primary Contact Email</label>
              <Input
                type="email"
                placeholder="contact@example.com"
                value={formContactEmail}
                onChange={(e) => setFormContactEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Website</label>
              <Input
                placeholder="https://example.com"
                value={formWebsite}
                onChange={(e) => setFormWebsite(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm();
                  setDialogOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !formName.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  "Create Customer"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
