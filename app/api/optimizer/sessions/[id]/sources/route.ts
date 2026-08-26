/**
 * Background material attached to a piece — GET lists, POST attaches.
 *
 * NO MODEL CALL on either. Text is extracted, stored and later carried into a
 * generation prompt; nothing here summarises, classifies or judges. That is
 * what keeps Ship 3 free of new automatic spend, and why there is no
 * assertServiceAllowed below: a route that cannot spend does not need a spend
 * gate, and adding one would imply it might.
 *
 * That reasoning is about SPEND ONLY. It said nothing about safety, and reading
 * it as though it did is how this route shipped with `fetch(body.fileUrl)` in
 * the upload branch — an unguarded server-side fetch of a caller-supplied
 * address. Everything that reaches out from here is guarded: the url branch
 * through the shared safe fetch, the file branch through a workspace-scoped
 * blob path.
 *
 * The cost these DO carry is the prompt they ride in later, which is bounded by
 * MAX_SOURCES and MAX_SOURCE_CHARS rather than by anything here.
 */
import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import {
  listSources,
  countWords,
  MAX_SOURCES,
  MAX_SOURCE_CHARS,
  type SourceKind,
} from "@/lib/optimizer/sources";

export const maxDuration = 60;

const KINDS: SourceKind[] = ["pasted", "file", "gdoc-link", "url"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const sources = await listSources(id);
  // The text is deliberately NOT returned. The panel lists what is attached and
  // how big it is; shipping 120,000 characters to render four rows would be a
  // slow request that also puts client material in a browser cache for no
  // reason. It goes to the model from the server, which is where it is needed.
  return NextResponse.json({
    sources: sources.map((s) => ({ ...s, text: undefined, chars: s.text.length })),
    limits: { maxSources: MAX_SOURCES, maxChars: MAX_SOURCE_CHARS },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body?.workspaceId || null);
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const kind = String(body?.kind || "") as SourceKind;
  if (KINDS.indexOf(kind) < 0) {
    return NextResponse.json({ error: "Unknown kind of source" }, { status: 400 });
  }

  // Checked BEFORE any fetching or extraction: refusing after doing the work is
  // slower for the writer and, on the url path, means we made a request to
  // somebody else's server for a result we were always going to discard.
  const existing = await listSources(id);
  if (existing.length >= MAX_SOURCES) {
    return NextResponse.json(
      {
        error: `Up to ${MAX_SOURCES} background documents. Every one of them travels with the brief on each draft, so the limit is what keeps a draft affordable — remove one to add another.`,
      },
      { status: 409 }
    );
  }

  let text = "";
  let title = String(body?.title || "").trim().slice(0, 200);
  let ref: string | null = null;
  let untrusted = false;

  if (kind === "pasted") {
    text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) return NextResponse.json({ error: "Nothing to attach" }, { status: 400 });
  } else if (kind === "url") {
    // The SAME guarded fetch the import path uses. A second implementation
    // would be a second SSRF surface, and only one of them would be covered by
    // scripts/verify-safe-fetch.ts.
    const { importFromUrl } = await import("@/lib/optimizer/url-import");
    const result = await importFromUrl(typeof body?.ref === "string" ? body.ref : "");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    text = String(result.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) title = (result.title || "Fetched page").slice(0, 200);
    ref = (typeof body?.ref === "string" ? body.ref : "").trim().slice(0, 500);
    // Third-party text of unknown authorship. Quotable and checkable; never an
    // instruction. sourcesBlock frames it accordingly.
    untrusted = true;
  } else if (kind === "gdoc-link") {
    // Same two-step the import route uses: resolve the id from whatever shape
    // of link was pasted, then fetch. A 403 here means the document is not
    // shared, which is a different problem from a bad link and says so.
    const { extractDocId, fetchDocText } = await import("@/lib/gdrive/doc-link");
    const docId = extractDocId(typeof body?.ref === "string" ? body.ref : "");
    if (!docId) {
      return NextResponse.json({ error: "That does not look like a Google Doc link" }, { status: 400 });
    }
    const result = await fetchDocText(docId, MAX_SOURCE_CHARS);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: (result as any).permission ? 403 : 400 });
    }
    text = String(result.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) title = "Google Doc";
    ref = (typeof body?.ref === "string" ? body.ref : "").trim().slice(0, 500);
  } else {
    // ── Uploaded file ────────────────────────────────────────────────────
    //
    // Takes a BLOB PATH, not a URL, and this is a correction rather than a
    // preference. As first written this branch did `fetch(body.fileUrl)` — a
    // server-side request to any address a caller cared to name, whose response
    // was then stored. That is an SSRF primitive with no safe-fetch guard on
    // it, and it sat in the one route that had reasoned itself out of needing
    // guards ("a route that cannot spend does not need a spend gate") — a
    // conclusion about SPEND that quietly read as a conclusion about safety.
    //
    // It would also never have worked: the store is configured PRIVATE, so an
    // unauthenticated GET of a blob URL is refused. The bug that made it
    // useless is the same bug that made it dangerous.
    //
    // So: the same two steps the import route uses. The path must sit under
    // this caller's own workspace prefix — which is what stops one workspace
    // naming another's upload — and the bytes are read through the blob client
    // with credentials rather than fetched.
    const blobPath = typeof body?.blobPath === "string" ? body.blobPath : "";
    const expectedPrefix = `optimizer-uploads/w${guard.caller.workspaceId}/`;
    if (!blobPath.startsWith(expectedPrefix) || blobPath.indexOf("..") >= 0) {
      return NextResponse.json({ error: "That upload could not be located." }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      const { get } = await import("@vercel/blob");
      const stored = await get(blobPath, { access: "private" });
      if (!stored || stored.statusCode !== 200 || !stored.stream) {
        throw new Error("the stored file could not be read back");
      }
      buffer = Buffer.from(await new Response(stored.stream as ReadableStream).arrayBuffer());
    } catch (e: any) {
      return NextResponse.json(
        { error: `The uploaded file could not be read back: ${String(e?.message || e).slice(0, 120)}` },
        { status: 502 }
      );
    }

    const fileName = String(body?.fileName || "document");
    try {
      const { importFile } = await import("@/lib/optimizer/file-import");
      const result = await importFile(
        { name: fileName, type: String(body?.fileType || ""), buffer },
        { workspaceId: guard.caller.workspaceId, maxChars: MAX_SOURCE_CHARS }
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error || "Could not read that file" }, { status: 400 });
      }
      // A source is read for its WORDS. The optimiser converts to html because
      // it scores STRUCTURE — headings, lists, hierarchy — which is the one
      // thing background material is never judged on.
      text = String((result as any).html || (result as any).text || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!title) title = fileName.slice(0, 200);
      ref = fileName.slice(0, 500);
    } catch {
      return NextResponse.json({ error: "Could not read that file" }, { status: 502 });
    } finally {
      // Deleted either way: it was only ever a transport for the bytes, and
      // leaving it behind keeps a second copy of a client document in storage
      // that nothing reads and nobody remembers to remove.
      try {
        const { del } = await import("@vercel/blob");
        await del(blobPath);
      } catch {
        /* a failed cleanup must not fail the attach the writer is waiting on */
      }
    }
  }

  text = text.trim();
  if (!text) return NextResponse.json({ error: "There was no readable text in that" }, { status: 400 });

  // TRUNCATED, AND SAID SO. Silently clipping the back half of a research
  // document would mean the writer believes the model has read something it
  // never saw — the failure this codebase keeps finding in other forms.
  const truncated = text.length > MAX_SOURCE_CHARS;
  if (truncated) text = text.slice(0, MAX_SOURCE_CHARS);

  const { data, error } = await intelligenceDb
    .from("optimizer_sources")
    .insert({
      id_session: id,
      type_source: kind,
      name_title: title || "Untitled source",
      document_source_ref: ref,
      document_text: text,
      units_words: countWords(text),
      flag_untrusted: untrusted ? 1 : 0,
      user_created: guard.caller.userId,
    })
    .select("id_source")
    .maybeSingle();

  if (error || !data) {
    console.error("[optimizer] source attach failed:", error?.message);
    // 42P01 is "relation does not exist": this table ships in a migration run
    // by hand, so say which one rather than returning a blank 500 that looks
    // like a problem with the file the writer just uploaded.
    if ((error as any)?.code === "42P01") {
      return NextResponse.json(
        { error: "This deployment's database has not been migrated for background documents yet. Run supabase/migrations/20260826_writer_sources.sql." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not attach that" }, { status: 500 });
  }

  const sources = await listSources(id);
  return NextResponse.json({
    sources: sources.map((s) => ({ ...s, text: undefined, chars: s.text.length })),
    truncated,
    limits: { maxSources: MAX_SOURCES, maxChars: MAX_SOURCE_CHARS },
  });
}

/**
 * Detach a background document.
 *
 * Scoped by BOTH the source id and the session id. Deleting on the id alone
 * would let anyone holding a source id remove material from a piece they cannot
 * open — the row carries no workspace column of its own, so the session is
 * where the entitlement lives, and loadSessionForCaller has just checked it.
 *
 * A hard delete, deliberately. A source is transient working material rather
 * than a record: it was attached to shape a draft, the draft keeps whatever it
 * took from it, and keeping detached client documents around indefinitely is a
 * liability rather than a feature.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const sourceId = req.nextUrl.searchParams.get("sourceId") || "";
  if (!sourceId) return NextResponse.json({ error: "Which source?" }, { status: 400 });

  const { error } = await intelligenceDb
    .from("optimizer_sources")
    .delete()
    .eq("id_source", sourceId)
    .eq("id_session", id);

  if (error) return NextResponse.json({ error: "Could not remove that" }, { status: 500 });

  const sources = await listSources(id);
  return NextResponse.json({
    sources: sources.map((s) => ({ ...s, text: undefined, chars: s.text.length })),
    limits: { maxSources: MAX_SOURCES, maxChars: MAX_SOURCE_CHARS },
  });
}
