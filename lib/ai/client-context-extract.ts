/**
 * Client context extraction and summarisation.
 *
 * Fetches client asset files (PDFs, DOCX, text) from Google Cloud Storage
 * (private bucket) or public URLs, extracts text, summarises each file,
 * then consolidates into a single structured client profile stored in
 * intelligence.ai_client_context.
 *
 * Pattern follows lib/rfp/extract.ts.
 */

import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { Storage } from "@google-cloud/storage";
import { google } from "googleapis";
import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai/usage-logger";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

interface AssetFile {
  id_asset: number;
  name_asset: string;
  type_asset: string;
  file_url: string | null;
  file_path: string | null;
  file_bucket: string | null;
  file_name: string | null;
  information_description: string | null;
}

interface FileSummary {
  id_asset: number;
  name: string;
  type: string;
  summary: string;
  chars_extracted: number;
}

/**
 * Determine the effective MIME type for an asset.
 * Uses the stored type_asset first, falls back to file extension.
 */
function getEffectiveMimeType(asset: AssetFile): string {
  // type_asset often has the real MIME (e.g. "application/pdf")
  if (asset.type_asset) {
    // Strip charset suffix if present (e.g. "text/html; charset=utf-8" → "text/html")
    const base = asset.type_asset.split(";")[0].trim();
    if (base.includes("/")) return base;
  }
  // Fall back to file extension
  const fileName = asset.file_name || asset.name_asset || "";
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc": return "application/msword";
    case "txt": case "md": case "csv": return "text/plain";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default: return "application/octet-stream";
  }
}

/**
 * Check if a MIME type is one we can extract text from.
 */
function isExtractable(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType.startsWith("text/")
  );
}

/**
 * Google Workspace document types we can export text from.
 */
const GOOGLE_DOC_PATTERNS: { pattern: RegExp; type: string; exportPath: string }[] = [
  { pattern: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/, type: "document", exportPath: "document" },
  { pattern: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/, type: "presentation", exportPath: "presentation" },
  { pattern: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/, type: "spreadsheet", exportPath: "spreadsheets" },
];

/**
 * Check if an asset links to a Google Workspace document (Doc, Slides, or Sheet).
 * Checks file_path, file_url, AND information_description for URLs.
 */
function isGoogleWorkspaceDoc(asset: AssetFile): boolean {
  const sources = [asset.file_path, asset.file_url, asset.information_description].filter(Boolean).join(" ");
  return GOOGLE_DOC_PATTERNS.some(({ pattern }) => pattern.test(sources));
}

/** @deprecated Use isGoogleWorkspaceDoc instead */
function isGoogleDoc(asset: AssetFile): boolean {
  return isGoogleWorkspaceDoc(asset);
}

/**
 * Extract a Google Workspace doc URL from any asset field (file_path, file_url, or description).
 */
function extractGoogleDocUrl(asset: AssetFile): string | null {
  const sources = [asset.file_path, asset.file_url, asset.information_description].filter(Boolean);
  for (const source of sources) {
    for (const { pattern } of GOOGLE_DOC_PATTERNS) {
      if (pattern.test(source!)) return source!;
    }
  }
  return null;
}

/**
 * Get an authenticated Google Drive client using service account credentials
 * with domain-wide delegation to impersonate a workspace user.
 *
 * Setup required (one-time, by Google Workspace admin):
 * 1. Go to Google Workspace Admin → Security → API Controls → Domain-wide Delegation
 * 2. Add the service account client ID (from GOOGLE_SERVICE credentials)
 * 3. Authorize scope: https://www.googleapis.com/auth/drive.readonly
 * 4. Set GOOGLE_IMPERSONATE_EMAIL env var to a user in the workspace (e.g. service@thecontentengine.com)
 */
function getGoogleDriveAuth() {
  const serviceJson = process.env.GOOGLE_SERVICE;
  if (!serviceJson) return null;
  try {
    const credentials = JSON.parse(serviceJson);
    const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL;

    if (impersonateEmail) {
      // Domain-wide delegation: impersonate a workspace user to access org-shared files
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        subject: impersonateEmail,
      });
      return auth;
    }

    // Fallback: direct service account access (only works for files shared with the SA)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    return auth;
  } catch {
    return null;
  }
}

/** MIME types for exporting Google Workspace files as plain text */
const EXPORT_MIME: Record<string, string> = {
  document: "text/plain",
  presentation: "text/plain",
  spreadsheet: "text/csv",
};

/**
 * Extract a Google Workspace doc ID and fetch as plain text.
 * Supports Google Docs, Slides, and Sheets.
 * Tries unauthenticated export first, falls back to Google Drive API with service account.
 * Returns { text, error } so callers can surface diagnostics.
 */
async function fetchGoogleDocText(url: string): Promise<{ text: string | null; error?: string }> {
  for (const { pattern, type, exportPath } of GOOGLE_DOC_PATTERNS) {
    const match = url.match(pattern);
    if (!match) continue;

    const docId = match[1];

    // Try 1: Unauthenticated export (works for publicly shared files)
    const exportUrl = `https://docs.google.com/${exportPath}/d/${docId}/export?format=txt`;
    try {
      const response = await fetch(exportUrl);
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().length >= 50) {
          console.log(`[ClientContext] Google ${type} public export OK: ${docId} (${text.length} chars)`);
          return { text };
        }
      }
      console.log(`[ClientContext] Google ${type} public export failed (${response.status}): ${docId}, trying authenticated...`);
    } catch (err) {
      console.log(`[ClientContext] Google ${type} public fetch error, trying authenticated...`);
    }

    // Try 2: Authenticated export via Google Drive API (for org-restricted files)
    const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL;
    try {
      const auth = getGoogleDriveAuth();
      if (!auth) {
        const reason = !process.env.GOOGLE_SERVICE
          ? "GOOGLE_SERVICE env var not set"
          : !impersonateEmail
            ? "GOOGLE_IMPERSONATE_EMAIL env var not set — domain-wide delegation not configured"
            : "Failed to create auth client";
        console.warn(`[ClientContext] ${reason}`);
        return { text: null, error: reason };
      }
      console.log(`[ClientContext] Attempting authenticated export for ${type} ${docId} (impersonate=${impersonateEmail || 'none'})`);
      const drive = google.drive({ version: "v3", auth });
      const mimeType = EXPORT_MIME[type] || "text/plain";
      const res = await drive.files.export({ fileId: docId, mimeType }, { responseType: "text" });
      const text = typeof res.data === "string" ? res.data : String(res.data);
      if (text && text.trim().length >= 50) {
        console.log(`[ClientContext] Google ${type} authenticated export OK: ${docId} (${text.length} chars)`);
        return { text };
      }
      return { text: null, error: `Google ${type} exported but content too short (${text?.length || 0} chars)` };
    } catch (authErr: any) {
      const errMsg = authErr?.errors?.[0]?.message || authErr?.message || String(authErr);
      console.warn(`[ClientContext] Google ${type} authenticated export failed: ${docId} — ${errMsg}`);
      return { text: null, error: `Auth export failed: ${errMsg.slice(0, 100)}` };
    }
  }

  return { text: null, error: "URL does not match any Google Workspace document pattern" };
}

/**
 * Get a GCS Storage client using service account credentials from env.
 */
function getGCSClient(): Storage {
  const project = process.env.GOOGLE_PROJECT;
  const serviceJson = process.env.GOOGLE_SERVICE;
  if (!project || !serviceJson) {
    throw new Error("GOOGLE_PROJECT or GOOGLE_SERVICE env vars not set");
  }
  const credentials = JSON.parse(serviceJson);
  return new Storage({ projectId: project, credentials });
}

const GCS_BUCKET_PREFIX = "production-env-engine-";

/**
 * Get a download URL for a file based on its bucket type.
 * - "private" → GCS signed URL from reflex_deploy_private
 * - "public"  → direct GCS public URL from reflex_deploy_public
 * - "external" → the path itself is the URL
 */
async function getFileUrl(
  bucket: string,
  path: string
): Promise<string | null> {
  try {
    if (bucket === "private") {
      const gcs = getGCSClient();
      const gcsBucket = gcs.bucket(GCS_BUCKET_PREFIX + bucket);
      const file = gcsBucket.file(path);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 2 * 24 * 60 * 60 * 1000, // 2 days
      });
      return url;
    } else if (bucket === "public") {
      return `https://storage.googleapis.com/${GCS_BUCKET_PREFIX}${bucket}/${path}`;
    } else if (bucket === "external") {
      return path;
    }
    return null;
  } catch (err: any) {
    console.warn(`[ClientContext] Failed to get file URL: ${bucket}/${path}`, err.message);
    return null;
  }
}

/**
 * Download file content from GCS (private/public) or a direct URL.
 */
async function downloadFile(
  bucket: string,
  path: string
): Promise<Buffer | null> {
  const url = await getFileUrl(bucket, path);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[ClientContext] Download failed (${response.status}): ${bucket}/${path}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err: any) {
    console.warn(`[ClientContext] Download error: ${bucket}/${path}`, err.message);
    return null;
  }
}

/**
 * Extract text from a file buffer based on MIME type.
 */
async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string | undefined> {
  if (mimeType === "application/pdf") {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    // Extract text from PPTX slides using JSZip + XML parsing
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const slideTexts: string[] = [];

    // PPTX slides are in ppt/slides/slide1.xml, slide2.xml, etc.
    const slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
        return numA - numB;
      });

    for (const slideFile of slideFiles) {
      const xml = await zip.files[slideFile].async("string");
      // Extract all text between <a:t> tags (PowerPoint text runs)
      const texts = xml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (texts) {
        const slideText = texts
          .map((t) => t.replace(/<\/?a:t>/g, ""))
          .join(" ");
        if (slideText.trim()) slideTexts.push(slideText.trim());
      }
    }

    return slideTexts.join("\n\n");
  }

  if (mimeType.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  return undefined;
}

/**
 * Summarise a single document's extracted text.
 */
async function summariseDocument(
  xai: OpenAI,
  text: string,
  fileName: string
): Promise<string> {
  const truncated = text.slice(0, 12000);

  const response = await xai.chat.completions.create({
    model: "grok-4-1-fast",
    messages: [
      {
        role: "system",
        content: `You are extracting factual information from a client document for a content agency's AI assistant.

RULES:
- Extract ONLY what the document explicitly states. Do not infer, embellish, or generalise.
- Preserve the document's own language strength: if it says "we aim to be innovative", write "aims to be innovative" — do NOT upgrade to "is innovative" or "known for innovation".
- Distinguish between directives (rules to follow) vs descriptions (context about the client).
- If the document is aspirational or forward-looking, label it as such (e.g. "Goals include..." not "The brand is...").
- If the document doesn't cover a topic, say nothing about that topic. Do NOT fill gaps with assumptions.
- Prioritise concrete, specific details over vague generalisations.

Extract any of the following that the document DIRECTLY addresses:
- Brand voice/tone rules or guidelines (exact language, not paraphrased)
- Stated business objectives or KPIs
- Defined target audiences or personas
- Content rules, dos and don'ts
- Key messages or approved talking points
- Industry/market context

Keep to 200-400 tokens. Return plain text, no markdown headers.
Document: "${fileName}"`,
      },
      { role: "user", content: truncated },
    ],
    max_completion_tokens: 500,
    temperature: 0.2,
  });

  logAiUsage({ model: "grok-4-1-fast", source: "client-context", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

  return response.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Consolidate multiple file summaries into one structured client profile.
 */
async function consolidateProfile(
  xai: OpenAI,
  fileSummaries: FileSummary[],
  clientName: string
): Promise<string> {
  const input = fileSummaries
    .map((f) => `--- ${f.name} (${f.type}, ${f.chars_extracted.toLocaleString()} chars extracted) ---\n${f.summary}`)
    .join("\n\n");

  const response = await xai.chat.completions.create({
    model: "grok-4-1-fast",
    messages: [
      {
        role: "system",
        content: `You are compiling a factual client reference profile for "${clientName}" from document summaries. This profile will be used by an AI content assistant.

RULES:
- Compile faithfully. Do NOT synthesise, blend, or amplify. If two documents each briefly mention "innovation", say "innovation is mentioned in [source1] and [source2]" — do NOT upgrade to "strong focus on innovation".
- Include source attribution in parentheses, e.g. "(from Brand Guidelines)" or "(from Campaign Brief FY23)".
- Weight sources by depth: a document that extracted 5,000+ characters is more authoritative than one with 500 characters. The character counts are shown below.
- OMIT sections entirely if the evidence is thin, only from one peripheral document, or speculative.
- If sources contradict each other, note both positions rather than merging them.
- Distinguish between established rules ("Brand voice MUST be...") and contextual observations ("Campaign brief mentioned...").

Use these sections — but ONLY include sections with solid evidence:

**Brand & Voice**: Tone, personality, language rules — only from explicit guidelines
**Strategic Objectives**: Stated goals, KPIs — only what's explicitly documented
**Target Audience**: Defined personas or segments — only if specified
**Content Guidelines**: Dos, don'ts, format preferences — only explicit rules
**Key Messages**: Approved talking points, themes — only stated messages
**Industry Context**: Sector, positioning — only documented facts
**Other Notes**: Anything else useful — only if clearly evidenced

If fewer than 3 sections have solid evidence, that's fine — a short accurate profile is better than a padded inaccurate one.
Aim for 400-1000 tokens. Use bullet points.`,
      },
      { role: "user", content: input },
    ],
    max_completion_tokens: 1500,
    temperature: 0.2,
  });

  logAiUsage({ model: "grok-4-1-fast", source: "client-context", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

  return response.choices?.[0]?.message?.content?.trim() || "";
}

interface SkippedFile {
  id_asset: number;
  name: string;
  reason: string;
}

/**
 * Process all asset files for a client and store the consolidated profile.
 */
export async function processClientContext(
  workspaceId: string,
  clientId: number,
  clientName?: string
): Promise<{ processed: number; total: number; skipped: SkippedFile[]; error?: string }> {
  try {
    // 1. Fetch all asset files for this client via the joined view
    const { data: assets, error: assetsErr } = await supabase
      .from("app_assets_clients")
      .select(
        "id_asset, name_asset, type_asset, file_url, file_path, file_bucket, file_name, information_description"
      )
      .eq("id_client", clientId);

    if (assetsErr) throw assetsErr;
    if (!assets || assets.length === 0) {
      console.log(`[ClientContext] No assets for client ${clientId}`);
      return { processed: 0, total: 0, skipped: [] };
    }

    const xai = getXAIClient();
    const fileSummaries: FileSummary[] = [];
    const skippedFiles: SkippedFile[] = [];

    // 2. Process each file
    for (const asset of assets) {
      try {
        const fileName =
          asset.file_name || asset.name_asset || `asset-${asset.id_asset}`;

        // Handle Google Workspace docs (Docs, Slides, Sheets) separately
        if (isGoogleWorkspaceDoc(asset)) {
          const docUrl = extractGoogleDocUrl(asset) || "";
          const { text, error: gdocError } = await fetchGoogleDocText(docUrl);
          if (!text || text.trim().length < 50) {
            const reason = gdocError || "Google Doc/Slides empty or inaccessible";
            console.log(`[ClientContext] No usable text from Google Workspace doc: ${asset.name_asset} (url: ${docUrl}, error: ${reason})`);
            skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason });
            continue;
          }
          const summary = await summariseDocument(xai, text, fileName);
          if (summary) {
            fileSummaries.push({
              id_asset: asset.id_asset,
              name: asset.name_asset || fileName,
              type: "google-doc",
              summary,
              chars_extracted: text.length,
            });
            console.log(`[ClientContext] Processed Google Doc "${asset.name_asset}": ${text.length} chars → ${summary.length} char summary`);
          }
          continue;
        }

        // Skip assets with no file reference
        if (!asset.file_path && !asset.file_url) {
          skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason: "No file attached" });
          continue;
        }

        const mimeType = getEffectiveMimeType(asset);

        // Skip unsupported file types
        if (!isExtractable(mimeType)) {
          console.log(`[ClientContext] Skipping: ${fileName} (${mimeType})`);
          skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason: `Unsupported file type (${mimeType.split("/").pop()})` });
          continue;
        }

        // Download file content via GCS signed URL or direct URL
        let buffer: Buffer | null = null;

        if (asset.file_bucket && asset.file_path) {
          buffer = await downloadFile(asset.file_bucket, asset.file_path);
        } else if (asset.file_url) {
          // Fallback: direct URL fetch
          try {
            const response = await fetch(asset.file_url);
            if (response.ok) {
              buffer = Buffer.from(await response.arrayBuffer());
            } else {
              console.warn(`[ClientContext] Failed to fetch ${fileName}: ${response.status}`);
            }
          } catch (err: any) {
            console.warn(`[ClientContext] Fetch error for ${fileName}:`, err.message);
          }
        }

        if (!buffer) {
          console.warn(`[ClientContext] Could not download: ${fileName}`);
          skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason: "Download failed" });
          continue;
        }

        // Extract text
        const text = await extractText(buffer, mimeType);
        if (!text || text.trim().length < 50) {
          console.log(`[ClientContext] No usable text from ${fileName} (${text?.length || 0} chars)`);
          skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason: "No extractable text content" });
          continue;
        }

        // Summarise
        const summary = await summariseDocument(xai, text, fileName);
        if (summary) {
          fileSummaries.push({
            id_asset: asset.id_asset,
            name: asset.name_asset || fileName,
            type: asset.type_asset || "document",
            summary,
            chars_extracted: text.length,
          });
        }

        console.log(`[ClientContext] Processed ${fileName}: ${text.length} chars → ${summary.length} char summary`);
      } catch (fileErr) {
        console.error(`[ClientContext] Error processing asset ${asset.id_asset}:`, fileErr);
        const fileName = asset.file_name || asset.name_asset || `asset-${asset.id_asset}`;
        skippedFiles.push({ id_asset: asset.id_asset, name: asset.name_asset || fileName, reason: "Processing error" });
        // Continue with other files
      }
    }

    if (fileSummaries.length === 0) {
      console.log(
        `[ClientContext] No extractable content for client ${clientId} (${skippedFiles.length} skipped)`
      );
      return { processed: 0, total: assets.length, skipped: skippedFiles };
    }

    // 3. Consolidate into one profile
    const name = clientName || `Client ${clientId}`;
    const consolidatedProfile = await consolidateProfile(
      xai,
      fileSummaries,
      name
    );

    // 4. Upsert into ai_client_context (try with new columns, fall back without)
    const fullPayload = {
      id_workspace: workspaceId,
      id_client: clientId,
      document_context: consolidatedProfile,
      document_file_summaries: fileSummaries,
      document_skipped_files: skippedFiles,
      units_asset_count: fileSummaries.length,
      units_asset_total: assets.length,
      date_last_processed: new Date().toISOString(),
    };

    let { error: upsertErr } = await intelligenceDb
      .from("ai_client_context")
      .upsert(fullPayload, { onConflict: "id_workspace,id_client" });

    // Fallback: if new columns don't exist yet, upsert without them
    if (upsertErr?.code === "42703") {
      console.warn("[ClientContext] New columns not yet migrated, upserting without skipped_files/asset_total");
      const { document_skipped_files, units_asset_total, ...legacyPayload } = fullPayload;
      const fallback = await intelligenceDb
        .from("ai_client_context")
        .upsert(legacyPayload, { onConflict: "id_workspace,id_client" });
      upsertErr = fallback.error;
    }

    if (upsertErr) throw upsertErr;

    console.log(
      `[ClientContext] Client ${clientId} (${name}): ${fileSummaries.length}/${assets.length} files processed → ${consolidatedProfile.length} char profile (${skippedFiles.length} skipped)`
    );

    return { processed: fileSummaries.length, total: assets.length, skipped: skippedFiles };
  } catch (err: any) {
    console.error(
      `[ClientContext] Failed for client ${clientId}:`,
      err.message
    );
    return { processed: 0, total: 0, skipped: [], error: err.message };
  }
}
