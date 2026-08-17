"use client";

/**
 * Client summary — one row per CLIENT, for the Tuesday morning run-through.
 *
 * A client with three live contracts is one relationship with three contracts,
 * which is how the meeting walks it. Three sources, each authoritative for a
 * different thing: Engine knows what was DELIVERED, Airtable knows the account
 * manager and the commercial position, and money is gated per viewer.
 *
 * The rules this page inherits from /api/operations/clients, and the reason it
 * looks less tidy than a dashboard usually does:
 *
 *   - NULL IS NEVER RENDERED AS ZERO. "Not recorded" and "none" are different
 *     answers, and a dash that means "we don't know" is worth more than a 0
 *     that quietly means the same thing.
 *   - AN UNAVAILABLE SOURCE SAYS SO. If Airtable is down, the renewal column
 *     reads "unavailable" rather than empty — otherwise the Tuesday meeting
 *     concludes nothing is expiring.
 *   - NOTHING IS DROPPED FOR FAILING TO JOIN. A client that exists in one
 *     system and not the other is labelled, not hidden.
 *   - A DISAGREEMENT IS SHOWN, not resolved. When Engine and Airtable name
 *     different account managers, both appear; picking one silently is how the
 *     wrong person gets asked about a renewal.
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  AlertTriangle,
  Search,
  ExternalLink,
  Users,
  CircleAlert,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";

/* ─────────────── Types (mirror the API payload) ─────────────── */

interface ContractRow {
  name: string;
  bookingStatus: string | null;
  endDate: string | null;
  endingInDays: number | null;
  deliveredPct: number | null;
  contractedCu: number | null;
  remainingCu: number | null;
  valueChf?: number | null;
}

interface ClientRow {
  idClient: number;
  name: string;
  industry: string | null;
  website: string | null;
  joinState: "matched" | "engine_only" | "airtable_only" | "duplicate_engine_id";
  accountManager: string | null;
  accountManagerEngine: string | null;
  accountManagerDisagrees: boolean;
  engine: {
    liveContracts: number;
    contractedCu: number | null;
    deliveredCu: number | null;
    remainingCu: number | null;
    nextEndDate: string | null;
  } | null;
  renewal: { soonestEndingInDays: number | null; contracts: ContractRow[] } | null;
}

interface Payload {
  rows: ClientRow[];
  counts: { clients: number; matched: number; engineOnly: number; duplicateEngineId: number; airtableOnly: number };
  airtableOnly: { customer: string; reason: string }[];
  showMoney: boolean;
  warnings: string[];
  sources: { engine: string; engineContracts: string; airtable: string };
  fetchedAt: string;
}

/* ─────────────── Rendering helpers ─────────────── */

/** A number, or an em dash when it was never recorded. NEVER a zero stand-in. */
function num(v: number | null | undefined): string {
  return typeof v === "number" ? v.toLocaleString() : "—";
}

/** Renewal urgency. Null days means unknown, which is not the same as "far off". */
function renewalTone(days: number | null | undefined): { label: string; cls: string } {
  if (typeof days !== "number") return { label: "no end date", cls: "text-muted-foreground" };
  if (days < 0) return { label: `ended ${Math.abs(days)}d ago`, cls: "text-destructive font-medium" };
  if (days <= 30) return { label: `${days}d`, cls: "text-destructive font-medium" };
  if (days <= 90) return { label: `${days}d`, cls: "text-amber-600 dark:text-amber-500 font-medium" };
  return { label: `${days}d`, cls: "text-muted-foreground" };
}

export default function ClientSummaryPage() {
  const workspaceId = useWorkspaceSafe()?.selectedWorkspace?.id;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/operations/clients?workspaceId=${encodeURIComponent(workspaceId)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        if (!cancelled) setData(body);
      } catch (e: any) {
        // Surfaced, not swallowed. An empty table that silently means "the
        // request failed" is the worst outcome for a meeting that is about to
        // make decisions from it.
        if (!cancelled) setError(e?.message || "Could not load clients");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (r) =>
        r.name?.toLowerCase().includes(needle) ||
        r.accountManager?.toLowerCase().includes(needle) ||
        r.industry?.toLowerCase().includes(needle)
    );
  }, [data, q]);

  if (!workspaceId) {
    return <div className="p-6 text-sm text-muted-foreground">Select a workspace to see clients.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4">
            <CircleAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Couldn&apos;t load the client list</p>
              <p className="text-muted-foreground mt-0.5">{error}</p>
              <p className="text-muted-foreground mt-2">
                This is a load failure, not an empty list — don&apos;t read it as &ldquo;no clients&rdquo;.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const airtableDown = data?.sources.airtable !== "live";
  const contractsDown = data?.sources.engineContracts !== "live";

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {data?.counts.clients ?? 0} with live work
            {data?.fetchedAt && ` · as at ${new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Client, account manager, industry…"
            className="pl-8"
          />
        </div>
      </div>

      {/* Anything that makes a column less trustworthy than it looks. These are
          deliberately at the top: a caveat below the table is a caveat nobody
          reads before making a decision from the table. */}
      {(airtableDown || contractsDown || (data?.warnings.length ?? 0) > 0) && (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="py-3 space-y-1.5">
            {airtableDown && (
              <p className="text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Airtable is {data?.sources.airtable}.</strong> Account manager and renewal
                  columns are <em>unavailable</em>, not empty — nothing here says a contract isn&apos;t expiring.
                </span>
              </p>
            )}
            {contractsDown && (
              <p className="text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span><strong>Engine contracts are unavailable.</strong> Delivery figures are missing, not zero.</span>
              </p>
            )}
            {data?.warnings.map((w, i) => (
              <p key={i} className="text-sm flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{w}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* The table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Account manager</th>
                <th className="px-4 py-2.5 font-medium text-right">Live contracts</th>
                <th className="px-4 py-2.5 font-medium text-right">CUs delivered</th>
                <th className="px-4 py-2.5 font-medium text-right">Remaining</th>
                <th className="px-4 py-2.5 font-medium text-right">Soonest renewal</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {q ? "No clients match that search." : "No clients with live work."}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const tone = renewalTone(r.renewal?.soonestEndingInDays);
                return (
                  <tr key={r.idClient} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.website && (
                          <a
                            href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {/* A client that didn't join is LABELLED, never hidden. */}
                        {r.joinState === "engine_only" && (
                          <Badge variant="outline" className="text-xs font-normal">not in Airtable</Badge>
                        )}
                        {r.joinState === "duplicate_engine_id" && (
                          <Badge variant="destructive" className="text-xs font-normal">duplicate Engine ID</Badge>
                        )}
                      </div>
                      {r.industry && <div className="text-xs text-muted-foreground mt-0.5">{r.industry}</div>}
                    </td>

                    <td className="px-4 py-2.5">
                      {r.joinState === "duplicate_engine_id" ? (
                        <span className="text-muted-foreground text-xs">
                          ambiguous — two Airtable rows claim this client
                        </span>
                      ) : r.accountManager ? (
                        <div>
                          <span>{r.accountManager}</span>
                          {/* Both names, deliberately. Resolving this silently is
                              how the wrong person is asked about a renewal. */}
                          {r.accountManagerDisagrees && (
                            <div className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                              Engine says {r.accountManagerEngine}
                            </div>
                          )}
                        </div>
                      ) : airtableDown ? (
                        <span className="text-muted-foreground text-xs">unavailable</span>
                      ) : r.accountManagerEngine ? (
                        <div>
                          <span className="text-muted-foreground">{r.accountManagerEngine}</span>
                          <div className="text-xs text-muted-foreground mt-0.5">from Engine</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.engine ? r.engine.liveContracts : <span className="text-muted-foreground text-xs">unavailable</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.engine ? (
                        <>
                          {num(r.engine.deliveredCu)}
                          {typeof r.engine.contractedCu === "number" && (
                            <span className="text-muted-foreground"> / {num(r.engine.contractedCu)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">unavailable</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.engine ? num(r.engine.remainingCu) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", tone.cls)}>
                      {r.renewal ? tone.label : <span className="text-muted-foreground text-xs">unavailable</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Clients visible in Airtable but not in this table. Listed rather than
          dropped — a client in one system and not the other is a data question
          somebody has to answer, not a row to quietly lose. */}
      {(data?.airtableOnly.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              In Airtable but not shown above ({data!.airtableOnly.length})
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              These have no Engine link, so their delivery figures can&apos;t be joined. Not an error — a data gap.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data!.airtableOnly.map((a, i) => (
                <Badge key={i} variant="outline" className="text-xs font-normal">
                  {a.customer} <span className="text-muted-foreground ml-1">· {a.reason}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Where each column came from. Cheap to render, and it is the difference
          between "no renewals are due" and "we could not read the renewals". */}
      <p className="text-xs text-muted-foreground">
        Account manager and renewal from Airtable ({data?.sources.airtable}) · delivery from Engine (
        {data?.sources.engineContracts}) · {data?.counts.matched ?? 0} of {data?.counts.clients ?? 0} joined
        {data?.showMoney === false && " · contract values hidden for your access level"}
      </p>
    </div>
  );
}
