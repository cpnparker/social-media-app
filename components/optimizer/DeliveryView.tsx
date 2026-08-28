"use client";

/**
 * The delivery view — what changed, section by section, and on whose authority.
 *
 * This is the thing you put in front of a client: not a diff viewer, a
 * REPORT. The distinction decides most of the design below.
 *
 * A diff viewer answers "what bytes moved". A delivery report answers "what did
 * you change about my article, and why should I accept it" — so the unit is the
 * SECTION, not the line; unchanged sections are collapsed rather than displayed;
 * and every claim about a change carries the confidence it actually has.
 *
 * WHAT IT REFUSES TO DO. Most edits to a draft are keystrokes, and a keystroke
 * has no reason attached — the justification for an AI-driven change is in scope
 * at the button and is dropped at the prop boundary today, so it is not in the
 * database to show. A report that printed a plausible rationale beside every
 * change would be inventing the most load-bearing column on the page. So the
 * reason line is either sourced or it says "not recorded", and the header says
 * how many of each, where the reader will see it rather than discover it later.
 *
 * WHAT IT SHOWS AS UNCERTAIN. alignRevisions reports how each section pair was
 * matched. A heading match is certain. A body match means the heading was
 * renamed and the pairing is an inference — shown as one, because the failure it
 * guards against is telling a client a section was deleted and another invented
 * when it was retitled.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, ArrowRight, Info, Printer } from "lucide-react";
import { parseDraft } from "@/lib/optimizer/parse";
import {
  alignRevisions, summariseRevisions, wordDiff,
  type RevisionSection, type DiffPart,
} from "@/lib/optimizer/revisions";
import { cn } from "@/lib/utils";

interface VersionRow { units_version: number; units_words: number; date_created: string }

export default function DeliveryView({
  sessionId,
  workspaceId,
  title,
  currentHtml,
  refreshKey,
}: {
  sessionId: string;
  workspaceId: string;
  title: string;
  /** The live draft. The newer side is always what is on screen now, not a
   *  stored row — the writer's unsaved edits are part of what they are
   *  delivering, and a report that lagged the editor would be wrong the moment
   *  it mattered. */
  currentHtml: string;
  refreshKey?: number;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [baseHtml, setBaseHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── The list of versions to compare against ──────────────────────────────
  useEffect(() => {
    if (!sessionId || !workspaceId) return;
    let cancelled = false;
    fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/versions?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const rows: VersionRow[] = Array.isArray(d?.versions) ? d.versions : [];
        setVersions(rows);
        // Default to the OLDEST stored version, because "what did you change"
        // means since the beginning, not since the last save.
        if (rows.length > 0) setBaseline(rows[rows.length - 1].units_version);
      })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [sessionId, workspaceId, refreshKey]);

  // ── The chosen baseline's body ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !workspaceId || baseline === null) return;
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/versions?workspaceId=${encodeURIComponent(workspaceId)}&version=${baseline}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.version?.document_body === undefined) { setError(d?.error || "Could not read that version"); setBaseHtml(null); }
        else setBaseHtml(String(d.version.document_body || ""));
      })
      .catch(() => { if (!cancelled) setError("Could not read that version"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, workspaceId, baseline]);

  // ── The comparison itself ────────────────────────────────────────────────
  // Both sides parsed with the SAME title, or headings and offsets diverge for
  // reasons that have nothing to do with the edit.
  const sections = useMemo(() => {
    if (baseHtml === null) return null;
    try {
      return alignRevisions(
        parseDraft({ body: baseHtml, title }),
        parseDraft({ body: currentHtml, title })
      );
    } catch {
      return null;
    }
  }, [baseHtml, currentHtml, title]);

  const summary = useMemo(() => (sections ? summariseRevisions(sections) : null), [sections]);
  const changed = useMemo(() => (sections || []).filter((s) => s.status !== "unchanged"), [sections]);

  if (versions !== null && versions.length === 0) {
    return (
      <Empty
        head="Nothing to compare yet"
        body="A version is kept when you apply a change from the conversation or restore an earlier draft. Once there are two, this page shows what moved between them."
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[52rem] px-6 py-8 flex flex-col gap-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">What changed</h1>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted print:hidden"
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <span className="text-muted-foreground">Compared with</span>
            <select
              value={baseline ?? ""}
              onChange={(e) => setBaseline(Number(e.target.value))}
              className="bg-muted/60 hover:bg-muted rounded-md px-2 py-1 text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {(versions || []).map((v) => (
                <option key={v.units_version} value={v.units_version}>
                  version {v.units_version} · {new Date(v.date_created).toLocaleDateString()} · {v.units_words.toLocaleString()} words
                </option>
              ))}
            </select>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">the draft as it stands</span>
          </div>

          {summary && (
            <div className="flex items-center gap-4 flex-wrap text-[12.5px] rounded-xl border p-3">
              <Stat n={summary.edited} label="edited" tone="edit" />
              <Stat n={summary.added} label="added" tone="add" />
              <Stat n={summary.removed} label="removed" tone="del" />
              <Stat n={summary.unchanged} label="untouched" tone="mute" />
              <span className="text-muted-foreground ml-auto tabular-nums">
                {summary.wordsBefore.toLocaleString()} → {summary.wordsAfter.toLocaleString()} words
              </span>
            </div>
          )}

          {/* Stated where it will be read, not in a footnote. */}
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Reasons are shown for changes the tool recorded one for. Edits typed straight into the
            document carry none, and are marked as such rather than given a plausible explanation.
            {summary && summary.inferred > 0 && (
              <> {summary.inferred === 1 ? "One section was" : `${summary.inferred} sections were`} matched
              by their wording rather than their heading — those pairings are our reading, not a fact.</>
            )}
          </p>
        </div>

        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}

        {/* ── The sections ───────────────────────────────────────────── */}
        {!loading && sections && changed.length === 0 && (
          <Empty head="No changes since that version" body="Pick an earlier version to compare against, or make an edit." />
        )}

        {!loading && changed.map((s, i) => <SectionCard key={i} s={s} />)}

        {!loading && sections && changed.length > 0 && summary && summary.unchanged > 0 && (
          <p className="text-[12px] text-muted-foreground pt-1">
            {summary.unchanged} {summary.unchanged === 1 ? "section is" : "sections are"} unchanged and
            not shown.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "edit" | "add" | "del" | "mute" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn(
        "text-[15px] font-semibold tabular-nums",
        tone === "add" && "text-emerald-600 dark:text-emerald-400",
        tone === "del" && "text-red-600 dark:text-red-400",
        tone === "edit" && "text-foreground",
        tone === "mute" && "text-muted-foreground"
      )}>{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Empty({ head, body }: { head: string; body: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[38rem] px-6 py-16 text-center">
        <p className="text-[15px] font-semibold mb-1.5">{head}</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

/**
 * One section.
 *
 * An EDITED section shows the words inline — struck for what went, marked for
 * what arrived — because two columns side by side make the reader do the
 * comparison the report is supposed to have done for them. Added and removed
 * sections show their one side, since there is nothing to compare.
 */
function SectionCard({ s }: { s: RevisionSection }) {
  const parts: DiffPart[] | null = useMemo(
    () => (s.status === "edited" && s.before !== null && s.after !== null ? wordDiff(s.before, s.after) : null),
    [s]
  );
  const heading = s.headingAfter || s.headingBefore || "Untitled section";

  return (
    <div className="rounded-xl border overflow-hidden break-inside-avoid">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/40 flex-wrap">
        <StatusPill status={s.status} />
        <span className="text-[13.5px] font-semibold flex-1 min-w-0 truncate">{heading}</span>
        {s.retitled && s.headingBefore && (
          <span className="text-[11.5px] text-muted-foreground shrink-0">
            renamed from &ldquo;{s.headingBefore}&rdquo;
          </span>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {s.wordsBefore} → {s.wordsAfter} words
        </span>
      </div>

      {/* Confidence, where the claim is made rather than in a legend. */}
      {(s.basis === "body" || s.basis === "position") && (
        <p className="flex items-start gap-1.5 px-4 py-2 text-[11.5px] text-muted-foreground border-b bg-muted/20">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          {s.basis === "body"
            ? "Matched to the earlier section by its wording, because the heading changed. We think these are the same section."
            : "Matched by position — neither side carries a heading."}
        </p>
      )}

      <div className="px-4 py-3 text-[13px] leading-relaxed">
        {s.status === "edited" && parts && (
          <p className="whitespace-pre-wrap">
            {parts.map((p, i) =>
              p.kind === "same" ? <span key={i}>{p.text} </span> :
              p.kind === "del" ? (
                <del key={i} className="bg-red-500/10 text-red-700 dark:text-red-300 rounded px-0.5 no-underline line-through decoration-red-500/60">{p.text} </del>
              ) : (
                <mark key={i} className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 rounded px-0.5">{p.text} </mark>
              )
            )}
          </p>
        )}

        {/* Past the diff cap: say the section changed without pretending to
            know where. Both sides in full, rather than a silent nothing. */}
        {s.status === "edited" && !parts && (
          <div className="flex flex-col gap-3">
            <p className="text-[11.5px] text-muted-foreground">
              Too long to mark word by word — both versions in full.
            </p>
            <div>
              <Label>Before</Label>
              <p className="whitespace-pre-wrap text-muted-foreground">{s.before}</p>
            </div>
            <div>
              <Label>After</Label>
              <p className="whitespace-pre-wrap">{s.after}</p>
            </div>
          </div>
        )}

        {s.status === "added" && <p className="whitespace-pre-wrap">{s.after}</p>}
        {s.status === "removed" && (
          <p className="whitespace-pre-wrap text-muted-foreground line-through decoration-red-500/50">{s.before}</p>
        )}
      </div>

      {/* THE REASON SLOT. Empty for now on every path, and saying so — the
          justification exists in code at the moment a change is applied and is
          dropped before it reaches storage. Printing a guess here would be
          inventing the column the whole report exists for. */}
      <p className="px-4 py-2 border-t text-[11.5px] text-muted-foreground bg-muted/20">
        Reason: not recorded for this change.
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{children}</span>
  );
}

function StatusPill({ status }: { status: RevisionSection["status"] }) {
  const map = {
    edited: ["Edited", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    added: ["Added", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"],
    removed: ["Removed", "bg-red-500/15 text-red-700 dark:text-red-300"],
    unchanged: ["Unchanged", "bg-muted text-muted-foreground"],
  } as const;
  const [label, cls] = map[status];
  return <span className={cn("text-[10.5px] font-medium px-2 py-0.5 rounded-md shrink-0", cls)}>{label}</span>;
}
