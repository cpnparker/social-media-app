"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface Contract {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  totalContentUnits: number;
  usedContentUnits: number;
  rolloverUnits: number;
  monthlyFee: number;
  status: string;
  startDate: string;
  endDate: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-500",
  active: "bg-green-500/10 text-green-600",
  completed: "bg-blue-500/10 text-blue-600",
  expired: "bg-red-500/10 text-red-500",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatCU(value: number): string {
  return value.toFixed(1);
}

function getProgressColor(percentage: number): string {
  if (percentage > 90) return "bg-red-500";
  if (percentage >= 70) return "bg-amber-500";
  return "bg-green-500";
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      const res = await fetch(`/api/contracts?${params.toString()}`);
      const data = await res.json();
      setContracts(data.contracts || []);
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const filtered = search
    ? contracts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.customerName.toLowerCase().includes(search.toLowerCase())
      )
    : contracts;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="h-6 w-6 text-blue-500" />
          Active Contracts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View all contracts across your clients
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[
            { value: "all", label: "All" },
            { value: "draft", label: "Draft" },
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
            { value: "expired", label: "Expired" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customer or contract..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-1">No contracts found</p>
            <p className="text-sm text-muted-foreground">
              {search || statusFilter !== "all"
                ? "Try adjusting your filters or search term"
                : "No contracts have been created yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">
                      Contract Name
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">
                      Customer
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3 min-w-[180px]">
                      CU Progress
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">
                      Start Date
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">
                      End Date
                    </th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-3">
                      Monthly Fee
                    </th>
                    <th className="text-center font-medium text-muted-foreground px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((contract) => {
                    const total = contract.totalContentUnits;
                    const used = contract.usedContentUnits;
                    const percentage = total > 0 ? (used / total) * 100 : 0;
                    const clampedPercentage = Math.min(percentage, 100);

                    return (
                      <tr
                        key={contract.id}
                        className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/customers/${contract.customerId}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {contract.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <Link href={`/customers/${contract.customerId}`}>
                            {contract.customerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${getProgressColor(percentage)}`}
                                style={{ width: `${clampedPercentage}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatCU(used)} / {formatCU(total)} CUs
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(contract.startDate)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(contract.endDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                          {formatCurrency(contract.monthlyFee)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant="secondary"
                            className={`border-0 text-[11px] capitalize ${
                              statusColors[contract.status] || "bg-gray-500/10 text-gray-500"
                            }`}
                          >
                            {contract.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
