/**
 * GET  /api/optimizer/import — what can be brought in.
 * POST /api/optimizer/import — bring one in and open it as an article.
 *
 * Import is the studio's PRIMARY entry point, not its escape hatch: most
 * optimisation work is on content that already exists. Three sources, all
 * backed by plumbing this repo already has.
 *
 * EVERYTHING IMPORTED IS A COPY. Nothing here writes back to a Google Doc or to
 * a content unit, and the studio says so on the page. A writer who thinks the
 * editor is a live view of their Doc would lose work believing it was saved
 * somewhere it is not.
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { requireOptimizer } from "../_lib/access";
import { getClientCanon } from "@/lib/optimizer/client-canon";
import { canAccessClient, requireAuth } from "@/lib/permissions";
import { checkConversationAccess } from "@/lib/ai/access";
import { detectContentType, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import { RUBRIC_VERSION } from "@/lib/optimizer/rubric";
import { toEditorHtml } from "@/lib/optimizer/import-html";

export const maxDuration = 60;

/**
 * The cap is measured in WORDS OF PROSE, after conversion — never in raw
 * characters. The first version compared `content.length` before conversion,
 * and a browser copy of a ~1,500-word published article carries the page's
 * markup with it: a writer pasted an ordinary article and was told it was
 * "87k characters — too long to score", which was true of the markup and
 * false of her article. Characters measure the wrapper; words measure the
 * thing being scored.
 *
 * 6,000 is deliberately far above the rubric's 800-2,500 calibration band:
 * the band is guidance the score panel already gives, and refusing an import
 * is a much blunter instrument than a note on the score.
 */
const MAX_IMPORT_WORDS = 6000;
/** Transport bound for the Drive fetch — raw HTML, before conversion. */
const MAX_IMPORT_CHARS = 500000;

export async function GET(req: NextRequest) {
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const clientId = Number(req.nextUrl.searchParams.get("clientId")) || null;

  // ── Google Docs shared with the service account ──
  let docs: { id: string; name: string; modified: string }[] = [];
  let docsNotice: string | null = null;
  try {
    const { queryDriveDocs } = await import("@/lib/gdrive/docs");
    const result = await queryDriveDocs("list");
    if (result.notice) {
      // The service account may simply not be configured. That is a setup
      // state, not an error — say it plainly rather than showing an empty list
      // that looks like "you have no documents".
      docsNotice = result.notice;
    } else {
      const raw: any[] = (result.data && result.data.documents) || [];
      docs = raw
        .filter((d) => d.type === "document")
        .map((d) => ({ id: d.name, name: d.name, modified: d.modified || "" }));
    }
  } catch (e: any) {
    docsNotice = "Google Drive is unreachable right now.";
  }

  // ── Commissioned pieces from the Engine content pipeline ──
  let engineItems: { id: number; title: string; type: string; status: string }[] = [];
  if (clientId) {
    const authed = await requireAuth();
    if (!("userId" in authed)) return authed;
    const ok = await canAccessClient(authed.userId, authed.role, clientId);
    if (!ok) return NextResponse.json({ error: "No access to that client" }, { status: 403 });
    try {
      // Columns verified against the real table: status lives in flag_completed
      // and flag_spiked, NOT a type_status column. PostgREST fails the entire
      // select on an unknown column, so a guess here returns nothing at all and
      // reads as "this client has no content".
      const { data } = await supabase
        .from("app_content")
        .select("id_content, name_content, type_content, flag_completed, flag_spiked")
        .eq("id_client", clientId)
        .order("id_content", { ascending: false })
        .limit(40);
      engineItems = (data || [])
        // Spiked pieces are the bulk of the clutter in this table and nobody
        // wants to optimise one.
        .filter((c: any) => c.flag_spiked !== 1)
        .slice(0, 25)
        .map((c: any) => ({
          id: c.id_content,
          title: c.name_content || `Content ${c.id_content}`,
          type: c.type_content || "",
          status: c.flag_completed === 1 ? "Completed" : "In progress",
        }));
    } catch {
      /* the pipeline is a bonus source; its absence must not break import */
    }
  }

  return NextResponse.json({
    docs,
    docsNotice,
    engineItems,
    // Surfaced so "my doc isn't in the list" has an answer rather than being a
    // dead end. Reading it needs no secret — it is an address to share TO.
    serviceAccount: process.env.GOOGLE_SA_EMAIL || null,
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  const source: string = body.source;
  // Kept in step with the CHECK in the NEWEST migration
  // (20260825_writing_studio_chat_origin.sql), not the three older copies in
  // 20260821 — verify-optimizer-chat-origin asserts the two agree.
  if (["pasted", "gdoc", "gdoc-link", "url", "engine", "file", "chat"].indexOf(source) < 0) {
    return NextResponse.json({ error: "Unknown import source" }, { status: 400 });
  }

  /**
   * CHAT ORIGIN — the text is lifted here, never accepted from the browser.
   *
   * The obvious design sends the rendered answer up with the request. It is
   * also indefensible: the browser would be supplying the content, the
   * provenance AND the privacy decision, so a crafted POST could mint a piece
   * containing anything, attributed to a conversation it never came from, with
   * the private-source flag conveniently unset.
   *
   * So the client sends two ids. The server re-reads the conversation, decides
   * for itself whether the caller may see it, decides for itself whether its
   * privacy must survive the copy, and takes the text from the message row.
   *
   * Refusals, in order, each for its own reason:
   *   - no access to the conversation            → the piece cannot exist
   *   - view-only share                          → a view recipient may not
   *                                                create workspace content
   *                                                from someone else's thread
   *   - incognito                                → the thread is deliberately
   *                                                unstored; copying it into a
   *                                                stored document defeats the
   *                                                only promise incognito makes
   *   - not an assistant message                 → "start a piece from this
   *                                                answer" means an answer
   */
  let chatText: string | null = null;
  let chatPrivateSource = false;
  if (source === "chat") {
    const conversationId = String(body.conversationId || "");
    const messageId = String(body.messageId || "");
    if (!conversationId || !messageId) {
      return NextResponse.json({ error: "conversationId and messageId are required" }, { status: 400 });
    }

    const { data: conv } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace, flag_incognito")
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: "That conversation no longer exists" }, { status: 404 });
    }
    // Workspace isolation before anything else: a conversation in another
    // workspace is not merely forbidden, it is not found.
    if ((conv as any).id_workspace && (conv as any).id_workspace !== caller.workspaceId) {
      return NextResponse.json({ error: "That conversation no longer exists" }, { status: 404 });
    }

    const access = await checkConversationAccess(conversationId, caller.userId, {
      visibility: (conv as any).type_visibility,
      userCreated: (conv as any).user_created,
      workspaceId: (conv as any).id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "That conversation no longer exists" }, { status: 404 });
    }
    if (access.permission === "view") {
      return NextResponse.json(
        { error: "You have read-only access to that conversation." },
        { status: 403 }
      );
    }
    if ((conv as any).flag_incognito) {
      return NextResponse.json(
        {
          error:
            "This chat is incognito — it is not stored, and a piece made from it would be. Copy the text across yourself if you want to keep it.",
        },
        { status: 400 }
      );
    }

    const { data: msg } = await intelligenceDb
      .from("ai_messages")
      .select("id_message, role_message, document_message")
      .eq("id_message", messageId)
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!msg || (msg as any).role_message !== "assistant") {
      return NextResponse.json({ error: "That answer is no longer available" }, { status: 404 });
    }
    const raw = String((msg as any).document_message || "").trim();
    if (!raw) {
      return NextResponse.json({ error: "That answer has no text to start from" }, { status: 400 });
    }

    // Two strips, both because the studio is not the chat surface.
    //   Citation tokens are a chat rendering convention and mean nothing here.
    //   Image markdown points at /api/media, which the editor cannot resolve and
    //   the export path deliberately skips — leaving it would put broken images
    //   in an exported document.
    chatText = raw
      .replace(/\[__CITE_\d+__\]/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!chatText) {
      return NextResponse.json({ error: "That answer has no text to start from" }, { status: 400 });
    }

    // THE FLOOR. Anything not positively confirmed as a team thread is treated
    // as private — the safe direction, and the only one that survives a new
    // visibility value being added later.
    chatPrivateSource = (conv as any).type_visibility !== "team";
  }

  const clientId = body.clientId != null ? Number(body.clientId) : null;
  if (clientId != null && !Number.isNaN(clientId)) {
    const authed = await requireAuth();
    if (!("userId" in authed)) return authed;
    const ok = await canAccessClient(authed.userId, authed.role, clientId);
    if (!ok) return NextResponse.json({ error: "No access to that client" }, { status: 403 });
  }

  let title = typeof body.title === "string" ? body.title.trim() : "";
  let content = "";
  let sourceRef: string | null = null;
  /** Surfaced to the writer — what did not survive the import. Silence about a
   *  dropped figure is how an import stops being trustworthy. */
  let importWarnings: string[] = [];

  if (source === "chat") {
    // Already acquired, server-side, above. It gets a branch of its own rather
    // than nothing because this chain ENDS in an `else` that means "from the
    // Engine pipeline" and demands a numeric content id — so a source with no
    // branch does not fall through harmlessly, it falls into a different
    // importer and fails with that importer's error. Which is exactly what
    // happened: "Start a piece" returned "Which piece?".
    content = chatText || "";
    if (!title) {
      // Named from the answer's own first line, trimmed of markdown furniture,
      // so the piece arrives with something better than "Untitled piece".
      const firstLine = content.split(/\n/).map((l) => l.replace(/^#+\s*/, "").trim()).filter(Boolean)[0] || "";
      title = firstLine.slice(0, 80) || "From a chat";
    }
    sourceRef = String(body.conversationId || "");
  } else if (source === "pasted") {
    content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) return NextResponse.json({ error: "Nothing to import" }, { status: 400 });
  } else if (source === "url") {
    // A published page. The most common content to optimise is content that is
    // already live and should start earning AI citations.
    const { importFromUrl } = await import("@/lib/optimizer/url-import");
    const result = await importFromUrl(typeof body.ref === "string" ? body.ref : "");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    content = result.html || "";
    if (!title) title = (result.title || "Imported page").slice(0, 200);
    sourceRef = (typeof body.ref === "string" ? body.ref : "").trim().slice(0, 500);
  } else if (source === "file") {
    // An uploaded document. The bytes do NOT come through this request: a
    // Vercel serverless function caps its request body at 4.5MB, and a Word
    // document with photographs passes that routinely — the founder's own test
    // file is 3.9MB. The browser sends the file straight to blob storage and
    // this route is handed the PATH it landed at.
    //
    // The path is attacker-controlled, and the blob store holds everything
    // this app has ever written — decks, chat attachments, generated
    // documents. An unconstrained path here would convert any of them into the
    // caller's editor, which is a cross-workspace read. So the path must sit
    // under this caller's OWN workspace prefix, which requireOptimizer has
    // already proved they belong to.
    //
    // Read through the blob SDK rather than over HTTP: the store is private,
    // so a plain fetch of the URL gets nothing, and going through the SDK with
    // the server's own token means there is no user-supplied URL to fetch and
    // therefore no request forgery to defend against.
    const blobPath = typeof body.blobPath === "string" ? body.blobPath : "";
    const expectedPrefix = `optimizer-uploads/w${caller.workspaceId}/`;
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

    const fileName = typeof body.fileName === "string" ? body.fileName : "document.docx";
    const { importFile } = await import("@/lib/optimizer/file-import");
    const result = await importFile(
      { name: fileName, type: typeof body.fileType === "string" ? body.fileType : "", buffer },
      { workspaceId: caller.workspaceId, maxChars: MAX_IMPORT_CHARS }
    );

    // The source document is deleted either way. It was only ever a transport
    // for the bytes; its figures already live in their own blobs, and leaving
    // the original behind keeps a second copy of a client document in storage
    // that nothing reads and nobody remembers to remove.
    try {
      const { del } = await import("@vercel/blob");
      await del(blobPath);
    } catch {
      /* a failed cleanup must not fail the import the writer is waiting on */
    }

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    content = result.html || "";
    if (!title) title = (result.title || "Uploaded document").slice(0, 200);
    sourceRef = fileName.slice(0, 500);
    importWarnings = result.warnings || [];
  } else if (source === "gdoc-link") {
    // A pasted link, which is the workflow that does NOT require the document
    // to have been shared with the service account first. Verified 2026-08-21
    // against a live "anyone with the link" doc; see lib/gdrive/doc-link.ts.
    const { extractDocId, fetchDocText } = await import("@/lib/gdrive/doc-link");
    const docId = extractDocId(typeof body.ref === "string" ? body.ref : "");
    if (!docId) {
      return NextResponse.json(
        { error: "That is not a Google Doc link — it should look like docs.google.com/document/d/…" },
        { status: 400 }
      );
    }
    const result = await fetchDocText(docId, MAX_IMPORT_CHARS);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.permission ? 403 : 400 });
    }
    content = toEditorHtml(result.text || "", result.isHtml);
    // The export carries no usable title, so the document's own first line is
    // the best available and the writer can rename it. Taken from the CONVERTED
    // html so it is the first line of the article, not a stray style rule.
    if (!title) {
      const firstBlock = content.match(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/i);
      const raw = firstBlock ? firstBlock[2].replace(/<[^>]+>/g, " ") : "";
      title = (raw.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() || "Imported document").slice(0, 200);
    }
    sourceRef = `https://docs.google.com/document/d/${docId}/edit`;
  } else if (source === "gdoc") {
    const name = typeof body.ref === "string" ? body.ref : "";
    if (!name) return NextResponse.json({ error: "Which document?" }, { status: 400 });
    try {
      const { queryDriveDocs, TRUNCATION_MARKER } = await import("@/lib/gdrive/docs");
      const result = await queryDriveDocs("read", name);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
      content = (result.data && result.data.content) || "";
      // The Drive reader caps a document at 8,000 characters and appends a
      // marker saying so. That marker is written for a model reading a brief;
      // here it would land in the writer's editor as body text AND the
      // optimiser would score the surviving two thirds as a whole article,
      // producing a number for a piece nobody has read. Refuse, and say what
      // to do instead — paste takes four times as much.
      if (content.indexOf(TRUNCATION_MARKER) >= 0) {
        return NextResponse.json(
          {
            error:
              "That document is too long to pull from the shared list — only the first 8,000 characters come back that way, and scoring part of an article would give you a number for content nobody has read. Paste its link instead: that path reads the whole thing.",
          },
          { status: 413 }
        );
      }
      if (!title) title = (result.data && result.data.name) || name;
      sourceRef = name;
    } catch (e: any) {
      return NextResponse.json({ error: "Could not read that document" }, { status: 502 });
    }
  } else {
    // From the Engine pipeline. The content unit carries the brief; the body
    // itself may live in a Google Doc referenced by the unit.
    const contentId = Number(body.ref);
    if (!contentId || Number.isNaN(contentId)) {
      return NextResponse.json({ error: "Which piece?" }, { status: 400 });
    }
    const { data } = await supabase
      .from("app_content")
      .select("id_content, id_client, name_content, information_brief")
      .eq("id_content", contentId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "That piece was not found" }, { status: 404 });
    if (clientId != null && (data as any).id_client !== clientId) {
      return NextResponse.json({ error: "That piece belongs to another client" }, { status: 403 });
    }
    if (!title) title = (data as any).name_content || `Content ${contentId}`;
    content = typeof body.content === "string" ? body.content : "";
    sourceRef = String(contentId);
    if (!content.trim()) {
      // The unit exists but its text is not in the Engine — a real and common
      // state. Open the article anyway with the brief attached rather than
      // refusing: the writer can paste the body in and keep the grounding.
      content = "";
    }
  }

  // THE CONVERSION, for every source that did not already do its own.
  //
  // Without this an import reaches Tiptap as plain text, and Tiptap parses its
  // input as HTML — where newlines are whitespace. Every imported article
  // became one paragraph with no headings, and the rubric scores heading
  // structure, so the writer was shown a low score and a list of structural
  // problems that belonged to the conversion, not to their piece.
  //
  // `contentIsHtml` is passed explicitly where the source knows: a paste can
  // carry real clipboard HTML, and guessing from the content is guessing.
  // The chat branch supplies its own text, lifted from the message row rather
  // than sent by the browser. It is markdown-ish prose, so it takes the same
  // conversion every other plain-text source takes.
  if (source === "chat" && chatText) {
    content = chatText;
  }
  if (source !== "gdoc-link" && source !== "file") {
    content = toEditorHtml(content, source === "pasted" ? body.contentIsHtml === true : undefined);
  }

  // Detected on the text that will be STORED — after conversion, so the
  // detector sees the same structure the editor and the rubric will.
  const detectedType = (() => {
    try {
      return detectContentType(content.replace(/<[^>]+>/g, " "), title);
    } catch {
      return { type: DEFAULT_CONTENT_TYPE } as any;
    }
  })().type;

  const proseWords = (content.replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;
  if (proseWords > MAX_IMPORT_WORDS) {
    return NextResponse.json(
      {
        error: `That is ${Math.round(proseWords / 100) / 10}k words — too long to score in one piece. The rubric is calibrated for 800-2,500 words; bring it in a section at a time.`,
      },
      { status: 413 }
    );
  }

  let canon: any = {};
  if (clientId != null && !Number.isNaN(clientId)) {
    try {
      canon = await getClientCanon(caller.workspaceId, clientId, caller.email);
    } catch {
      canon = { gaps: [{ source: "engine", reason: "Canon unavailable at import time" }] };
    }
  }

  const { data: session, error } = await intelligenceDb
    .from("optimizer_sessions")
    .insert({
      id_workspace: caller.workspaceId,
      user_created: caller.userId,
      id_client: clientId != null && !Number.isNaN(clientId) ? clientId : null,
      name_title: title || "Untitled piece",
      // Straight to refining: there is nothing to generate, and a status of
      // "brief" would send the writer to a form they do not need.
      type_status: "refining",
      type_format: typeof body.format === "string" ? body.format : "explainer",
      type_platform: "balanced",
      type_source: source,
      document_source_ref: sourceRef,
      // Detected from the text that will actually be stored, so a pasted report
      // is a report from the first render rather than after a round trip. The
      // detector is deterministic and free — no model call on an import.
      type_content: detectedType,
      // The privacy floor. Set only by the chat branch, which is the only path
      // that copies from a container with its own privacy.
      flag_private_source: chatPrivateSource ? 1 : 0,
      // Imported content is scored, not generated — target queries are the only
      // brief field that still matters, and the writer adds them in the panel
      // where the unscored pillar is visible.
      config_brief: { targetQueries: [], audience: "", goal: "", lengthBand: "", voice: "" },
      config_canon: canon,
      name_rubric_version: RUBRIC_VERSION,
    })
    .select("id_session")
    .maybeSingle();

  if (error || !session) {
    console.error("[optimizer] import failed:", error?.message);
    // 23514 is a CHECK violation, and for this table it means the deployed
    // type_source constraint has not been widened for this source yet. The
    // migration file and the database disagreeing is not hypothetical here —
    // CREATE TABLE IF NOT EXISTS skips the constraint on an existing table, so
    // 'url' shipped ahead of its ALTER once already. Say which migration is
    // owed rather than returning a blank 500 that looks like a bug in the file
    // the writer just uploaded.
    if ((error as any)?.code === "23514") {
      return NextResponse.json(
        {
          error:
            "This deployment's database has not been migrated for this import type yet. Run the ALTER at the end of supabase/migrations/20260821_content_optimizer.sql, then try again.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not import that" }, { status: 500 });
  }

  const sessionId = (session as any).id_session;
  if (content.trim()) {
    await intelligenceDb.from("optimizer_drafts").insert({
      id_session: sessionId,
      units_version: 1,
      document_body: content,
      units_words: (content.match(/\S+/g) || []).length,
    });
  }

  return NextResponse.json({
    sessionId,
    title,
    words: (content.match(/\S+/g) || []).length,
    warnings: importWarnings.length ? importWarnings : undefined,
  });
}
