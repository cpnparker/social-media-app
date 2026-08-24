"use client";

/**
 * The optimiser's entry point.
 *
 * Import leads and "write something new" sits below it, deliberately. Most
 * optimisation work is on content that already exists — a draft, a published
 * page, a commissioned piece — and generating from a brief is the rarer case.
 * The previous version had this backwards: a brief form filled the screen and
 * paste was a link in a sentence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowRight, ClipboardPaste, FileText, Building2, Globe, Loader2, PenLine, Info, Upload, FileUp } from "lucide-react";

export interface ImportSources {
  docs: { id: string; name: string; modified: string }[];
  docsNotice: string | null;
  engineItems: { id: number; title: string; type: string; status: string }[];
  serviceAccount: string | null;
}

interface Props {
  workspaceId: string | null;
  clientId: number | null;
  clientName: string | null;
  onImported: (sessionId: string) => void;
  onWriteNew: () => void;
}

/** The tab a writer clicks and the `source` the server records are named
 *  differently ("paste" vs "pasted"), so the mapping is a total record keyed by
 *  Tab — adding a tab without a source is then a type error rather than a 400
 *  at the moment someone tries to import. */
type Tab = "paste" | "upload" | "url" | "gdoc" | "engine";
type ImportSource = "pasted" | "gdoc" | "gdoc-link" | "url" | "engine" | "file";
const SOURCE_FOR_TAB: { [k in Tab]: ImportSource } = { paste: "pasted", upload: "file", url: "url", gdoc: "gdoc", engine: "engine" };

/** What importFile in lib/optimizer/file-import.ts will actually accept. Kept
 *  next to the picker so the dialog and the server cannot drift apart. */
const ACCEPTED_UPLOAD = ".docx,.html,.htm,.md,.markdown,.txt";

/**
 * Which tabs show the "or pick one already shared" list underneath.
 *
 * A TOTAL RECORD keyed by Tab, for exactly the reason SOURCE_FOR_TAB is one.
 * This was written as a DENYLIST — `tab !== "paste" && tab !== "url"` — back
 * when the remaining tabs were gdoc and engine, so it read as "the two list
 * tabs". Adding the upload tab silently opted it in, and the drop zone shipped
 * with an empty card and a "Search commissioned pieces" box under it that
 * searched nothing. A denylist over a union type quietly grants the default to
 * every member added later; a total record makes the next tab a COMPILE ERROR
 * until somebody decides.
 */
const SHOWS_SHARED_PICKER: { [k in Tab]: boolean } = {
  paste: false, upload: false, url: false, gdoc: true, engine: true,
};

/** The upload route matches an allow-list of MIME types, and a browser reports
 *  none for .md — so the type is set from the extension rather than trusted. */
const CONTENT_TYPE_FOR: { [ext: string]: string } = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html", htm: "text/html",
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain",
};

export default function StartScreen({ workspaceId, clientId, clientName, onImported, onWriteNew }: Props) {
  const [tab, setTab] = useState<Tab>("paste");
  const [sources, setSources] = useState<ImportSources | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  /**
   * The clipboard's text/html flavour, when the source offered one.
   *
   * A textarea only ever receives text/plain, so pasting an article from Google
   * Docs threw away every heading, list and bold run before the server saw it —
   * and heading structure is SCORED, so the piece was then marked down for
   * problems the paste had introduced. The paste event still carries the rich
   * flavour, so it is captured here and sent alongside.
   */
  const [pastedHtml, setPastedHtml] = useState<string | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [filter, setFilter] = useState("");
  /** The plain text that arrived with the captured html, so an edit can be detected. */
  const pastedPlainRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ workspaceId });
    if (clientId) q.set("clientId", String(clientId));
    fetch(`/api/optimizer/import?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setSources(d); })
      .catch(() => { /* the picker degrades to paste, which always works */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, clientId]);

  const [docUrl, setDocUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);

  const doImport = useCallback(
    async (
      tab: Tab,
      ref?: string,
      title?: string,
      content?: string,
      /** Overrides the tab's default source. The Google Doc tab has two: a
       *  pasted link and a pick from the shared list, which reach the server
       *  by different routes and must be recorded differently. */
      sourceOverride?: ImportSource,
      /** Extra body fields a source needs — the uploaded file's blob URL and
       *  name. A bag rather than three more positional parameters, which at
       *  this arity is where a caller silently passes them in the wrong order. */
      extra?: { [k: string]: unknown }
    ) => {
      if (!workspaceId) { toast.error("Select a workspace first"); return; }
      setBusy(true);
      try {
        const res = await fetch("/api/optimizer/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId, clientId,
            source: sourceOverride || SOURCE_FOR_TAB[tab],
            ref, title,
            // Prefer the rich flavour when the clipboard offered one AND the
            // writer has not since typed over it: `pasted` is the source of
            // truth for what is on screen, so if it no longer matches what was
            // pasted, the html is stale and must not be used.
            content: content,
            contentIsHtml: sourceOverride ? undefined : usingRichPaste,
            ...(extra || {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "Could not bring that in"); return; }
        // What did NOT survive the import, said out loud. An import that
        // quietly drops figures is worse than one that refuses.
        if (Array.isArray(data.warnings)) {
          for (const w of data.warnings) toast.warning(String(w), { duration: 8000 });
        }
        onImported(data.sessionId);
      } catch (e: any) {
        toast.error(e?.message || "Could not bring that in");
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, clientId, onImported]
  );

  /**
   * Take an uploaded document.
   *
   * The bytes go BROWSER → BLOB directly, not through the import route: a
   * Vercel serverless request body caps at 4.5MB and a Word document with
   * photographs passes that routinely. The route is then handed the URL and
   * deletes the object once it has converted it.
   */
  const handleFile = useCallback(
    async (file: File) => {
      if (!workspaceId) { toast.error("Select a workspace first"); return; }
      const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
      // Refused here as well as on the server, so the writer is told before
      // waiting for a 4MB upload to complete and then be rejected.
      if (ext === "doc") {
        toast.error("That is the older binary .doc format. Open it in Word and save as .docx.");
        return;
      }
      if (ext === "pdf") {
        toast.error("A PDF loses its headings, lists and figures when extracted — the score would describe the file format, not the writing. Export the source as .docx.");
        return;
      }
      if (["docx", "html", "htm", "md", "markdown", "txt"].indexOf(ext) < 0) {
        toast.error("Upload a .docx, .html, .md or .txt.");
        return;
      }
      setUploadingName(file.name);
      setBusy(true);
      try {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`optimizer-uploads/w${workspaceId}/${file.name}`, file, {
          // The store is configured PRIVATE, and passing "public" is rejected
          // outright rather than downgraded. The workspace segment is what the
          // import route checks the path against, so a caller cannot hand it
          // the path of somebody else's file.
          access: "private",
          handleUploadUrl: "/api/media/upload",
          // Set explicitly: a browser reports no MIME type at all for .md and
          // often for .txt, and the upload route matches on an allow-list, so
          // an empty type is refused before the file leaves the machine.
          contentType: CONTENT_TYPE_FOR[ext] || file.type || "application/octet-stream",
        });
        await doImport("upload", undefined, undefined, undefined, undefined, {
          blobPath: blob.pathname, fileName: file.name, fileType: file.type,
        });
      } catch (e: any) {
        toast.error(e?.message || "That upload did not complete");
      } finally {
        setBusy(false);
        setUploadingName(null);
      }
    },
    [workspaceId, doImport]
  );

  /** The captured html is only valid while the textarea still shows the text it
   *  came from. Any edit invalidates it, silently and correctly. */
  const usingRichPaste = pastedHtml !== null && pasted === pastedPlainRef.current;

  const docs = (sources?.docs || []).filter((d) =>
    !filter.trim() || d.name.toLowerCase().indexOf(filter.trim().toLowerCase()) >= 0
  );
  const items = (sources?.engineItems || []).filter((i) =>
    !filter.trim() || i.title.toLowerCase().indexOf(filter.trim().toLowerCase()) >= 0
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[48rem] px-6 py-10 flex flex-col gap-6">

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Optimise a piece of content</h1>
          <p className="text-sm text-muted-foreground">
            Score and improve something that already exists, or write a new piece from a brief.
            {clientName ? ` Grounded in what we know about ${clientName}.` : ""}
          </p>
        </div>

        {/* Primary: bring content in */}
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.025] p-5">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-base font-semibold tracking-tight">Bring content in</span>
            <span className="text-[11px] font-semibold text-primary bg-primary/10 rounded px-1.5 py-0.5">
              Most common
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
            It goes straight to the editor with a score. Everything imported is a copy — editing here
            never touches the original.
          </p>

          <div className="flex gap-1.5 mb-3">
            <SourceTab active={tab === "paste"} onClick={() => setTab("paste")} icon={<ClipboardPaste className="h-3.5 w-3.5" />} label="Paste it" />
            <SourceTab active={tab === "upload"} onClick={() => setTab("upload")} icon={<FileUp className="h-3.5 w-3.5" />} label="Upload a file" />
            <SourceTab active={tab === "url"} onClick={() => setTab("url")} icon={<Globe className="h-3.5 w-3.5" />} label="A published page" />
            <SourceTab active={tab === "gdoc"} onClick={() => setTab("gdoc")} icon={<FileText className="h-3.5 w-3.5" />} label="A Google Doc" />
            <SourceTab active={tab === "engine"} onClick={() => setTab("engine")} icon={<Building2 className="h-3.5 w-3.5" />} label="From the Engine" />
          </div>

          {tab === "upload" && (
            <div className="flex flex-col gap-2">
              <div
                role="button"
                tabIndex={0}
                onClick={() => !busy && fileInputRef.current?.click()}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) fileInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files && e.dataTransfer.files[0];
                  if (f && !busy) handleFile(f);
                }}
                className={cn(
                  "rounded-xl border-2 border-dashed px-4 py-9 text-center transition-colors outline-none",
                  busy ? "opacity-60 cursor-wait" : "cursor-pointer",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 focus-visible:border-primary"
                )}
              >
                {busy && uploadingName ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-[13px] text-muted-foreground">Reading {uploadingName}…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[13.5px] font-medium">Drop a document here, or click to choose</span>
                    <span className="text-[12px] text-muted-foreground">
                      .docx keeps its headings, lists, tables and images
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  // Cleared so choosing the SAME file twice fires onChange again.
                  e.target.value = "";
                  if (f) handleFile(f);
                }}
              />
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Images are stored privately with the piece and stay visible only to this workspace.
                PDFs are not accepted — extraction strips the structure the score is about.
              </p>
            </div>
          )}

          {tab === "paste" && (
            <div className="flex flex-col gap-2">
              <Input
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="Give it a title"
                className="h-9"
              />
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                onPaste={(e) => {
                  const html = e.clipboardData.getData("text/html");
                  const text = e.clipboardData.getData("text/plain");
                  if (html && html.trim()) {
                    // Let the textarea take the plain text as normal — it is
                    // what the writer sees and edits — and keep the rich
                    // flavour beside it for the server.
                    setPastedHtml(html);
                    pastedPlainRef.current = text;
                  } else {
                    setPastedHtml(null);
                    pastedPlainRef.current = null;
                  }
                }}
                rows={7}
                placeholder="Paste the content here…"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-muted-foreground">
                  {!pasted.trim()
                    ? "Paste from a doc and the headings come with it"
                    : usingRichPaste
                      ? `${(pasted.match(/\S+/g) || []).length} words · headings and formatting kept`
                      : `${(pasted.match(/\S+/g) || []).length} words · plain text`}
                </span>
                <Button
                  size="sm"
                  disabled={busy || !pasted.trim()}
                  onClick={() => doImport("paste", undefined, pasteTitle, usingRichPaste ? pastedHtml! : pasted)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Open in the editor
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {tab === "url" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pageUrl.trim()) doImport("url", pageUrl.trim(), "");
                  }}
                  placeholder="https://…  — the article's address"
                  className="h-9 flex-1"
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={busy || !pageUrl.trim()}
                  onClick={() => doImport("url", pageUrl.trim(), "")}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                For content that is already live — it comes in as a copy, scored and ready to improve.
                The published page is never touched.
              </p>
            </div>
          )}

          {/* A pasted link, first, because it is the path that works without
              anyone having to share anything — a doc set to "anyone with the
              link" reads straight through — and because it brings in the WHOLE
              document, where the shared list stops at 8,000 characters. */}
          {tab === "gdoc" && (
            <div className="mb-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && docUrl.trim()) {
                      doImport("gdoc", docUrl.trim(), "", undefined, "gdoc-link");
                    }
                  }}
                  placeholder="Paste a Google Doc link"
                  className="h-9 flex-1"
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={busy || !docUrl.trim()}
                  onClick={() => doImport("gdoc", docUrl.trim(), "", undefined, "gdoc-link")}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Works as long as the doc is set to “Anyone with the link”, or is already shared with
                EngineAI. Nothing is written back.
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 pt-1.5">
                Or pick one already shared
              </p>
            </div>
          )}

          {SHOWS_SHARED_PICKER[tab] && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-3 py-2 border-b">
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={tab === "gdoc" ? "Search shared documents" : "Search commissioned pieces"}
                  className="h-8 text-[13px] border-0 px-0 shadow-none focus-visible:ring-0"
                />
              </div>

              <div className="max-h-[220px] overflow-y-auto p-1.5">
                {loading && (
                  <p className="text-[12.5px] text-muted-foreground px-2 py-3">Looking…</p>
                )}

                {!loading && tab === "gdoc" && docs.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground px-2 py-3 leading-relaxed">
                    {sources?.docsNotice || "No documents match."}
                  </p>
                )}
                {!loading && tab === "gdoc" && docs.map((d, i) => (
                  <button
                    key={`${d.id}-${i}`}
                    onClick={() => doImport("gdoc", d.name, d.name)}
                    disabled={busy}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted text-left"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[13.5px] font-medium">{d.name}</span>
                    {d.modified && <span className="text-[11.5px] text-muted-foreground shrink-0">{d.modified}</span>}
                  </button>
                ))}

                {!loading && tab === "engine" && !clientId && (
                  <p className="text-[12.5px] text-muted-foreground px-2 py-3">
                    Select a client to see their commissioned pieces.
                  </p>
                )}
                {!loading && tab === "engine" && clientId && items.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground px-2 py-3">
                    Nothing commissioned for this client yet.
                  </p>
                )}
                {!loading && tab === "engine" && items.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => doImport("engine", String(i.id), i.title)}
                    disabled={busy}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted text-left"
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[13.5px] font-medium">{i.title}</span>
                    <span className="text-[11.5px] text-muted-foreground shrink-0">{i.status}</span>
                  </button>
                ))}
              </div>

              {tab === "gdoc" && sources?.serviceAccount && (
                <div className="border-t bg-muted/40 px-3 py-2 flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                    Missing one? Share it with{" "}
                    <span className="font-mono text-[11px] bg-background border rounded px-1 py-0.5">
                      {sources.serviceAccount}
                    </span>{" "}
                    as a Viewer and it appears here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Secondary: write new */}
        <div className="rounded-2xl border p-4 flex items-center gap-3.5">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <PenLine className="h-4 w-4 text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">Write something new</div>
            <p className="text-[12.5px] text-muted-foreground">
              Brief it and EngineAI drafts it answer-optimised from the first line.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onWriteNew} className="shrink-0">
            Start a brief
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium border transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
