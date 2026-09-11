"use client";

/**
 * Background material a piece is written FROM.
 *
 * Not documents. A source is never edited, never scored and never appears in
 * the content list — it is the brief you were given, the interview you did, the
 * research you gathered. The absence of anywhere to put these is what merged
 * the Writer and the Optimiser: the only way to bring a document in was the
 * IMPORT path, and import mints a document TO BE SCORED, so "attach the brief"
 * and "assess this article" became the same gesture.
 *
 * The limit is stated on screen before it is reached. Every source rides in the
 * generation prompt and is paid for on every draft, so three is a spend
 * decision — and a limit you can see is a decision, while one you discover by
 * being refused is an obstacle.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FileText, FileUp, Globe, Link2, Loader2, Plus, Trash2, X } from "lucide-react";

interface SourceRow {
  id: string;
  kind: "pasted" | "file" | "gdoc-link" | "url";
  title: string;
  ref: string | null;
  words: number;
  chars: number;
  untrusted: boolean;
}

interface Props {
  sessionId: string;
  workspaceId: string | null;
  /** Bumped when material changes, so a draft knows its grounding moved. */
  onChanged?: () => void;
}

const CONTENT_TYPE_FOR: { [ext: string]: string } = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html", htm: "text/html",
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain",
};

const ICON = {
  pasted: FileText,
  file: FileUp,
  "gdoc-link": Link2,
  url: Globe,
};

type AddTab = "paste" | "upload" | "link";

/**
 * Which route a pasted link takes.
 *
 * ONE field, not a "Web" tab beside a "Doc" tab. A person with a Google Doc
 * link does not think of it as a different KIND of thing from a URL — it is a
 * link — and asking them to classify it first is asking them to know which of
 * two code paths we happen to have. Detected here so picking wrong is not
 * possible.
 */
/**
 * Google links all go down the gdoc path — not only native Docs.
 *
 * Sheets, Slides and drive.google.com/file/d/... used to fall through to the
 * generic page fetch, which returned Google's viewer shell and attached its
 * menu chrome as research. The server now classifies and exports each kind, so
 * the client's job is only to stop sending them the wrong way.
 *
 * "gdoc-link" stays the stored kind because the database CHECK constraint
 * allows four values and a fifth would need a migration for no gain — the
 * distinction that matters is which export to call, and the server derives that
 * from the link itself.
 */
function kindForLink(ref: string): "gdoc-link" | "url" {
  return /^https?:\/\/(docs|drive)\.google\.com\//i.test(ref.trim()) ? "gdoc-link" : "url";
}

/** What the writer is told a Google link is, before they press Attach. */
function googleHint(ref: string): string {
  const r = ref.trim();
  if (/\/spreadsheets\//i.test(r)) return "A Google Sheet. Its first tab is read as text — it needs to be shared with anyone who has the link.";
  if (/\/presentation\//i.test(r)) return "Google Slides. The text on the slides is read — it needs to be shared with anyone who has the link.";
  if (/^https?:\/\/drive\.google\.com\//i.test(r)) return "A file in Drive. PDFs, Word documents and text files are read — it needs to be shared with anyone who has the link.";
  return "A Google Doc. It needs to be shared with anyone who has the link.";
}

export default function SourcesPanel({ sessionId, workspaceId, onChanged }: Props) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [limits, setLimits] = useState({ maxSources: 3, maxChars: 40000 });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AddTab>("paste");
  /**
   * Said in the panel, not in a toast.
   *
   * The rail's composer sits bottom-right and so does sonner, so a toast fired
   * from here lands ON the Discuss input and swallows clicks for as long as it
   * is up — measured, not guessed: elementFromPoint at the composer's centre
   * returned the toast. Confirmation of something the panel already shows is
   * redundant anyway; the row appearing IS the confirmation. What is NOT
   * redundant is truncation, so that stays — inline, where it persists instead
   * of expiring after four seconds and where it cannot cover anything.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState("");

  const load = useCallback(async () => {
    if (!workspaceId || !sessionId) { setLoading(false); return; }
    try {
      const res = await fetch(
        `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/sources?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const d = await res.json();
      if (res.ok) {
        setSources(d.sources || []);
        if (d.limits) setLimits(d.limits);
      }
    } catch {
      /* the panel degrades to empty, which reads correctly as "nothing attached" */
    } finally {
      setLoading(false);
    }
  }, [sessionId, workspaceId]);

  useEffect(() => {
    // Cleared before the fetch, not after it. Otherwise the previous piece's
    // background sits on screen against the new document for the length of a
    // round trip, and "1 of 3 attached" describes something else entirely.
    setSources([]);
    setLoading(true);
    setAdding(false);
    load();
  }, [sessionId, load]);

  const attach = useCallback(
    async (payload: any) => {
      if (!workspaceId) { toast.error("Select a workspace first"); return; }
      setBusy(true);
      try {
        const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, ...payload }),
        });
        const d = await res.json();
        if (!res.ok) { toast.error(d.error || "Could not attach that"); return; }
        setSources(d.sources || []);
        if (d.limits) setLimits(d.limits);
        // Said out loud rather than swallowed: a writer who believes the model
        // read all forty pages will not understand why it never cites page 30.
        // A silently clipped research document would leave the writer believing
        // the model read something it never saw, so truncation is stated and
        // stays stated. A plain success is not stated at all: the new row is
        // already on screen.
        setNotice(
          d.truncated
            ? `Attached — but only the first ${limits.maxChars.toLocaleString()} characters are used. The rest is not sent to the model.`
            : null
        );
        setPasted(""); setTitle(""); setRef(""); setAdding(false);
        onChanged?.();
      } catch {
        toast.error("Could not attach that");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, workspaceId, limits.maxChars, onChanged]
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!workspaceId) { toast.error("Select a workspace first"); return; }
      const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
      // Refused before the upload rather than after it, so nobody waits for
      // 4MB to travel only to be told the format was never accepted.
      if (ext === "doc") { toast.error("That is the older binary .doc. Save it as .docx."); return; }
      // PDF IS ACCEPTED HERE and refused by the optimiser's own import, and
      // the difference is the point: that path scores structure a PDF does not
      // carry, this one reads words. Reports arrive as PDFs.
      if (["pdf", "docx", "html", "htm", "md", "markdown", "txt", "csv"].indexOf(ext) < 0) {
        toast.error("Attach a .pdf, .docx, .html, .md, .txt or .csv."); return;
      }
      setBusy(true);
      try {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`optimizer-uploads/w${workspaceId}/${file.name}`, file, {
          // The store is PRIVATE and rejects "public" outright. The workspace
          // segment is what the route checks the path against, so a caller
          // cannot hand it the path of somebody else's upload.
          access: "private",
          handleUploadUrl: "/api/media/upload",
          contentType: CONTENT_TYPE_FOR[ext] || file.type || "application/octet-stream",
        });
        await attach({ kind: "file", blobPath: blob.pathname, fileName: file.name, fileType: file.type });
      } catch (e: any) {
        toast.error(e?.message || "That upload did not complete");
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, attach]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!workspaceId) return;
      try {
        const res = await fetch(
          `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/sources?workspaceId=${encodeURIComponent(workspaceId)}&sourceId=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        const d = await res.json();
        if (!res.ok) { toast.error(d.error || "Could not remove that"); return; }
        setSources(d.sources || []);
        onChanged?.();
      } catch {
        toast.error("Could not remove that");
      }
    },
    [sessionId, workspaceId, onChanged]
  );

  const full = sources.length >= limits.maxSources;

  return (
    <div className="h-full overflow-y-auto p-3">
      <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
        What this piece is written from — the brief, an interview, research, the client&rsquo;s own
        material. These are never scored and never appear in your content.
      </p>

      {notice && (
        <div className="mb-3 rounded-lg border border-[hsl(var(--ai-warning,38_92%_50%))]/40 bg-[hsl(var(--ai-warning,38_92%_50%))]/[0.07] p-2.5">
          <p className="text-[11.5px] leading-relaxed">{notice}</p>
          <button
            onClick={() => setNotice(null)}
            className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
        </div>
      ) : (
        <>
          {sources.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {sources.map((s) => {
                const Icon = ICON[s.kind] || FileText;
                return (
                  <div key={s.id} className="group rounded-lg border bg-card p-2.5 flex items-start gap-2">
                    <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium leading-snug truncate">{s.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {s.words.toLocaleString()} words
                        {s.untrusted && (
                          // Stated because it changes how the model is told to
                          // treat it: quotable, checkable, never obeyed.
                          <span className="ml-1.5" title="Fetched from the web — quoted and checked, never followed as an instruction">
                            · from the web
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => remove(s.id)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!adding ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setAdding(true)}
                disabled={full}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add background
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                {full
                  ? `${limits.maxSources} is the limit. Each one travels with the brief on every draft, so remove one to add another.`
                  : `${sources.length} of ${limits.maxSources}. Each travels with the brief on every draft.`}
              </p>
            </>
          ) : (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-1">
                  {(["paste", "upload", "link"] as AddTab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "text-[11.5px] px-2 py-1 rounded-md",
                        tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "paste" ? "Paste" : t === "upload" ? "File" : "Link"}
                    </button>
                  ))}
                </div>
                <button onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is it? (optional)"
                className="w-full mb-2 text-[12.5px] bg-transparent border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              />

              {tab === "paste" && (
                <>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="Paste the brief, the transcript, the notes…"
                    rows={6}
                    className="w-full text-[12.5px] bg-transparent border rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    disabled={busy || !pasted.trim()}
                    onClick={() => attach({ kind: "pasted", text: pasted, title })}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Attach"}
                  </Button>
                </>
              )}

              {tab === "upload" && (
                <label className="block border border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/40">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.html,.htm,.md,.markdown,.txt,.csv"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                  {busy ? (
                    <span className="text-[12px] text-muted-foreground inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">.pdf, .docx, .html, .md, .txt or .csv</span>
                  )}
                </label>
              )}

              {tab === "link" && (
                <>
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="A web page, or a Google Docs or Drive link"
                    className="w-full text-[12.5px] bg-transparent border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                    {kindForLink(ref) === "gdoc-link" && ref.trim()
                      ? googleHint(ref)
                      : "Quoted and checked against — never followed. Instructions on a fetched page are treated as text, not as orders."}
                  </p>
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    disabled={busy || !ref.trim()}
                    onClick={() => attach({ kind: kindForLink(ref), ref, title })}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Attach"}
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
