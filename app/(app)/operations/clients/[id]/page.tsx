"use client";

/**
 * Client CRM view — docs/client-summary-spec.md §6.
 *
 * Written to be read top to bottom by someone who has never touched the
 * account: a stand-in AM, someone covering holiday, a director before a call.
 *
 * The two rules that shape every panel here:
 *
 *  1. AN ABSENT SECTION EXPLAINS ITSELF. A panel that renders empty reads as
 *     "nothing to report". A panel that says "we could not read this, and
 *     here is why" reads as what it is. The spec is blunt about this for
 *     meetings especially: "no meeting in 90 days" and "this client has no
 *     domain registered so we cannot look" are different facts and must never
 *     look the same.
 *  2. WHAT IS NOT BUILT IS NAMED. The Tuesday walk-through and the automated
 *     signal engine are specced but not built. They appear as a stated gap
 *     rather than as silence, so nobody concludes this account is quiet.
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ArrowLeft, ExternalLink, AlertTriangle, CircleAlert,
  Info, Construction, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";

interface Payload {
  client: {
    idClient: number; name: string; industry: string | null; description: string | null;
    website: string | null; accountManagerEngine: string | null;
    accountManagerAirtable: string | null; accountManagerDisagrees: boolean;
  };
  engine: {
    contracts: any[]; liveCount: number;
    notStartedCount: number; allLiveNotStarted: boolean; startsOn: string | null;
  } | null;
  delivery: {
    totalCu: number | null; byMonth: { month: string; cu: number }[];
    inFlight: number; spiked: number; missingUnits: number; lastCompleted: string | null;
    everHadTasks: boolean;
  } | null;
  airtable: { live: any[]; upcoming: any[]; pipeline: any[]; history: any[] } | null;
  meetings: { state: "ok" | "no_domain" | "unavailable"; windowDays: number; rows: any[]; detail?: string };
  showMoney: boolean;
  warnings: string[];
  notBuilt: string[];
  sources: Record<string, string>;
  fetchedAt: string;
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const num = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString() : "not recorded");

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-semibold text-sm">{title}</h2>
          {aside}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** An honest empty state: what we looked for, and why there is nothing. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function ClientDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const workspaceId = useWorkspaceSafe()?.selectedWorkspace?.id;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/operations/clients/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        if (!cancelled) setData(body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load this client");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, id]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-3">
        <Link href="/operations/clients" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="h-4 w-4" /> All clients
        </Link>
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4">
            <CircleAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Couldn&apos;t load this client</p>
              <p className="text-muted-foreground mt-0.5">{error}</p>
              <p className="text-muted-foreground mt-2">A load failure — not an empty account.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = data.client;
  const liveContracts = data.airtable?.live ?? [];

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <Link href="/operations/clients" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" /> All clients
      </Link>

      {/* ── Header: who owns this, who to ask ── */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">{c.name}</h1>
          {c.website && (
            <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
               target="_blank" rel="noopener noreferrer"
               className="text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {!data.airtable && <Badge variant="outline" className="font-normal">Not linked in Airtable</Badge>}
        </div>
        {c.industry && <p className="text-sm text-muted-foreground mt-0.5">{c.industry}</p>}
        {c.description && <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">{c.description}</p>}

        <div className="mt-2 text-sm">
          <span className="text-muted-foreground">Account manager: </span>
          {c.accountManagerAirtable || c.accountManagerEngine ? (
            <>
              <span className="font-medium">{c.accountManagerAirtable ?? c.accountManagerEngine}</span>
              {!c.accountManagerAirtable && <span className="text-muted-foreground text-xs ml-1.5">(from Engine — no live Airtable contract)</span>}
              {/* Both, labelled. A handover that landed in one system only is
                  exactly what a stand-in needs to know. */}
              {c.accountManagerDisagrees && (
                <span className="block text-xs text-amber-600 dark:text-amber-500 mt-1">
                  Engine says <strong>{c.accountManagerEngine}</strong>, Airtable says <strong>{c.accountManagerAirtable}</strong> — these disagree, so a handover may have landed in one system only.
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">not recorded in either system</span>
          )}
        </div>
      </div>

      {/* Anything that makes a panel below less trustworthy than it looks. */}
      {data.warnings.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="py-3 space-y-1.5">
            {data.warnings.map((w, i) => (
              <p key={i} className="text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" /><span>{w}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Contracts (the plan) ── */}
      <Section title="Contracts — the plan (Airtable)">
        {!data.airtable ? (
          <Nothing>Airtable is {data.sources.airtable} — contract data is unavailable, not absent. Don&apos;t read this as &ldquo;no contract&rdquo;.</Nothing>
        ) : liveContracts.length === 0 ? (
          <div className="space-y-2">
            <Nothing>No live contract in Airtable.</Nothing>
            {data.airtable.history.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Most recent ended: </span>
                {data.airtable.history[0].name} · {fmtDate(data.airtable.history[0].endDate)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {liveContracts.map((ct: any, i: number) => (
              <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b last:border-0 pb-2 last:pb-0">
                <div>
                  <span className="font-medium text-sm">{ct.name}</span>
                  <Badge variant="outline" className="ml-2 text-xs font-normal">{ct.bookingStatus}</Badge>
                  {ct.managers?.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">{ct.managers.join(", ")}</span>
                  )}
                </div>
                <div className="text-sm tabular-nums text-muted-foreground">
                  {num(ct.contractedCu)} CU contracted · {num(ct.remainingCu)} remaining · ends {fmtDate(ct.endDate)}
                  {data.showMoney && typeof ct.valueChf === "number" && ` · CHF ${ct.valueChf.toLocaleString()}`}
                </div>
              </div>
            ))}
            {(data.airtable.upcoming.length > 0 || data.airtable.pipeline.length > 0) && (
              <p className="text-xs text-muted-foreground pt-1">
                Also: {data.airtable.upcoming.length} booked, {data.airtable.pipeline.length} in pipeline.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── Delivery (the actual) ── */}
      <Section title="Delivery — the actual (Engine)" aside={<span className="text-xs text-muted-foreground">last 12 months</span>}>
        {!data.delivery ? (
          <Nothing>Delivery could not be read. This is a failed query, <strong>not</strong> zero delivery.</Nothing>
        ) : (
          <div className="space-y-2.5">
            <div className="text-sm">
              <span className="font-medium tabular-nums">{num(data.delivery.totalCu)}</span>
              <span className="text-muted-foreground"> CU completed in the last 12 months</span>
              {data.engine?.allLiveNotStarted && (
                <Badge variant="outline" className="ml-2 text-xs font-normal">not started yet</Badge>
              )}
              {data.delivery.inFlight > 0 && <span className="text-muted-foreground"> · {data.delivery.inFlight} in flight</span>}
              {/* Spiked work is shown, not hidden — cancelled work is signal. */}
              {data.delivery.spiked > 0 && <span className="text-muted-foreground"> · {data.delivery.spiked} spiked</span>}
            </div>

            {data.delivery.byMonth.length > 0 ? (
              <div className="flex items-end gap-1 h-16">
                {data.delivery.byMonth.map((m) => {
                  const max = Math.max(...data.delivery!.byMonth.map((x) => x.cu), 1);
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${m.month}: ${m.cu} CU`}>
                      <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${Math.max(2, (m.cu / max) * 100)}%` }} />
                      <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            ) : data.engine?.allLiveNotStarted ? (
              // The distinction that matters most in a Tuesday meeting. Zero
              // delivered against a contract that starts next month is the plan
              // working, not an account in trouble — and the raw figures cannot
              // tell those apart.
              <div className="text-sm flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span>
                  Nothing delivered yet because the work has not started —
                  {data.engine.liveCount === 1 ? " this contract begins " : ` all ${data.engine.liveCount} live contracts begin `}
                  <strong>{fmtDate(data.engine.startsOn)}</strong>. This is not a shortfall.
                </span>
              </div>
            ) : !data.delivery.everHadTasks ? (
              <Nothing>
                No task has ever been recorded for this client in Engine — not merely none in the last 12 months.
                {(data.engine?.liveCount ?? 0) > 0 && <> There {data.engine!.liveCount === 1 ? "is" : "are"} {data.engine!.liveCount} live Engine contract(s), so either the work is not tracked as content units or it has yet to be set up.</>}
              </Nothing>
            ) : (
              <Nothing>
                No task completed in the last 12 months.
                {data.delivery.lastCompleted && <> Last completed: {fmtDate(data.delivery.lastCompleted)}.</>}
                {data.delivery.inFlight > 0 && <> {data.delivery.inFlight} task(s) still in flight, so this is not an idle account.</>}
              </Nothing>
            )}

            {/* Excluded rows are counted, never silently dropped from the sum. */}
            {data.delivery.missingUnits > 0 && (
              <p className="text-xs text-muted-foreground">
                {data.delivery.missingUnits} completed task(s) carry no CU figure and are excluded from the total above.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── Client meetings ── */}
      <Section
        title="Client meetings — the relationship"
        aside={<span className="text-xs text-muted-foreground">last {data.meetings.windowDays} days</span>}
      >
        {data.meetings.state === "no_domain" ? (
          // The distinction the spec insists on. This is "we cannot look",
          // which is a data-setup problem, not a quiet account.
          <div className="text-sm flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{data.meetings.detail}</span>
          </div>
        ) : data.meetings.state === "unavailable" ? (
          <Nothing>Meeting records are unavailable{data.meetings.detail ? ` — ${data.meetings.detail}` : ""}. Not the same as no meetings.</Nothing>
        ) : data.meetings.rows.length === 0 ? (
          <Nothing>No client meeting recorded in the last {data.meetings.windowDays} days. We looked and found nothing — the client is registered and matchable.</Nothing>
        ) : (
          <div className="space-y-3">
            {data.meetings.rows.map((m: any) => (
              <div key={m.meetingId} className="border-b last:border-0 pb-2.5 last:pb-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{m.title}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(m.date)}</span>
                  {m.meetingKind && m.meetingKind !== "client meeting" && (
                    <Badge variant="outline" className="text-xs font-normal">{m.meetingKind}</Badge>
                  )}
                </div>
                {m.summary && <p className="text-sm text-muted-foreground mt-1">{m.summary}</p>}
                {m.nextSteps && (
                  <p className="text-sm mt-1">
                    <span className="text-muted-foreground">Next steps: </span>{m.nextSteps}
                  </p>
                )}
                {/* Attendee text has had email addresses stripped server-side —
                    Google fills `name` with the address when there is no
                    display name, and this page is open to the whole company. */}
                {m.attendees && <p className="text-xs text-muted-foreground mt-1">With: {m.attendees}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── What is specced but not built ── */}
      {data.notBuilt.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Construction className="h-4 w-4 text-muted-foreground" /> Not built yet
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Named rather than left blank, so nothing here reads as &ldquo;this account is quiet&rdquo;.
            </p>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {data.notBuilt.map((x, i) => <li key={i}>· {x}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Contracts from Airtable ({data.sources.airtable}) · delivery from Engine ({data.sources.engineContracts}) ·
        meetings from MeetingBrain ({data.sources.meetings})
        {!data.showMoney && " · contract values hidden for your access level"}
      </p>
    </div>
  );
}
