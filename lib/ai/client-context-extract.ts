/**
 * Client context extraction and summarisation.
 *
 * Fetches client asset files (PDFs, DOCX, text) from Supabase Storage,
 * extracts text, summarises each file, then consolidates into a single
 * structured client profile stored in intelligence.ai_client_context.
 *
 * Pattern follows lib/rfp/extract.ts.
 */

import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import OpenAI from "openai";

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
    mimeType.startsWith("text/")
  );
}

/**
 * Check if an asset links to a Google Doc.
 */
function isGoogleDoc(asset: AssetFile): boolean {
  const path = asset.file_path || asset.file_url || "";
  return path.includes("docs.google.com/document");
}

/**
 * Extract the Google Doc ID from a URL and fetch as plain text.
 */
async function fetchGoogleDocText(url: string): Promise<string | null> {
  // Extract doc ID from URL like https://docs.google.com/document/d/DOCID/edit...
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;

  const docId = match[1];
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  try {
    const response = await fetch(exportUrl);
    if (!response.ok) {
      console.warn(`[ClientContext] Google Doc export failed (${response.status}): ${docId}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    console.warn(`[ClientContext] Google Doc fetch error: ${docId}`, err);
    return null;
  }
}

/**
 * Download file content from Supabase Storage (private bucket).
 */
async function downloadFromStorage(
  bucket: string,
  path: string
): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.warn(`[ClientContext] Storage download failed: ${bucket}/${path}`, error?.message);
    return null;
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
    model: "grok-3-mini",
    messages: [
      {
        role: "system",
        content: `You are summarising a client document for a content agency's AI assistant. Extract the most useful context about this client, capturing:
1. Brand identity, voice, and tone guidelines
2. Strategic objectives and business goals
3. Target audience and market positioning
4. Content guidelines, dos and don'ts
5. Key messages, themes, and talking points
6. Any specific instructions, preferences, or constraints
7. Industry context and competitive positioning

Focus on actionable details the AI can use when writing content for this client.
Keep to 300-500 tokens. Return plain text, no markdown headers.
Document name: ${fileName}`,
      },
      { role: "user", content: truncated },
    ],
    max_tokens: 600,
    temperature: 0.3,
  });

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
    .map((f) => `--- ${f.name} (${f.type}) ---\n${f.summary}`)
    .join("\n\n");

  const response = await xai.chat.completions.create({
    model: "grok-3-mini",
    messages: [
      {
        role: "system",
        content: `You are building a client context profile for "${clientName}" that an AI content assistant will use when writing for this client.

Synthesise the document summaries below into a structured client background. Use these sections (skip any that have no relevant information):

**Brand & Voice**: Tone, personality, language style, dos and don'ts
**Strategic Objectives**: Business goals, KPIs, what success looks like
**Target Audience**: Who they're trying to reach, demographics, personas
**Content Guidelines**: Preferred formats, topics, editorial rules
**Key Messages**: Core themes, talking points, value propositions
**Industry Context**: Sector, competitive landscape, market position
**Other Notes**: Anything else useful for content creation

Be concise but specific. Use bullet points. Aim for 800-1200 tokens total.
Do NOT invent information — only include what's supported by the documents.`,
      },
      { role: "user", content: input },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });

  return response.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Process all asset files for a client and store the consolidated profile.
 */
export async function processClientContext(
  workspaceId: string,
  clientId: number,
  clientName?: string
): Promise<{ processed: number; error?: string }> {
  try {
    // 1. Fetch all asset files for this client via the joined view
    const { data: assets, error: assetsErr } = await supabase
      .from("app_assets_clients")
      .select(
        "id_asset, name_asset, type_asset, file_url, file_path, file_bucket, file_name"
      )
      .eq("id_client", clientId);

    if (assetsErr) throw assetsErr;
    if (!assets || assets.length === 0) {
      console.log(`[ClientContext] No assets for client ${clientId}`);
      return { processed: 0 };
    }

    const xai = getXAIClient();
    const fileSummaries: FileSummary[] = [];

    // 2. Process each file
    for (const asset of assets) {
      try {
        const fileName =
          asset.file_name || asset.name_asset || `asset-${asset.id_asset}`;

        // Handle Google Docs separately
        if (isGoogleDoc(asset)) {
          const docUrl = asset.file_path || asset.file_url || "";
          const text = await fetchGoogleDocText(docUrl);
          if (!text || text.trim().length < 50) {
            console.log(`[ClientContext] No usable text from Google Doc: ${asset.name_asset}`);
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
          continue;
        }

        const mimeType = getEffectiveMimeType(asset);

        // Skip unsupported file types
        if (!isExtractable(mimeType)) {
          console.log(`[ClientContext] Skipping: ${fileName} (${mimeType})`);
          continue;
        }

        // Download file content
        let buffer: Buffer | null = null;

        if (asset.file_bucket && asset.file_path && asset.file_bucket !== "external") {
          // Private/public Supabase Storage — use SDK download
          buffer = await downloadFromStorage(asset.file_bucket, asset.file_path);
        } else if (asset.file_url) {
          // Direct URL fetch
          const response = await fetch(asset.file_url);
          if (response.ok) {
            buffer = Buffer.from(await response.arrayBuffer());
          } else {
            console.warn(`[ClientContext] Failed to fetch ${fileName}: ${response.status}`);
          }
        }

        if (!buffer) {
          console.warn(`[ClientContext] Could not download: ${fileName}`);
          continue;
        }

        // Extract text
        const text = await extractText(buffer, mimeType);
        if (!text || text.trim().length < 50) {
          console.log(`[ClientContext] No usable text from ${fileName} (${text?.length || 0} chars)`);
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
        // Continue with other files
      }
    }

    if (fileSummaries.length === 0) {
      console.log(
        `[ClientContext] No extractable content for client ${clientId}`
      );
      return { processed: 0 };
    }

    // 3. Consolidate into one profile
    const name = clientName || `Client ${clientId}`;
    const consolidatedProfile = await consolidateProfile(
      xai,
      fileSummaries,
      name
    );

    // 4. Upsert into ai_client_context
    const { error: upsertErr } = await intelligenceDb
      .from("ai_client_context")
      .upsert(
        {
          id_workspace: workspaceId,
          id_client: clientId,
          document_context: consolidatedProfile,
          document_file_summaries: fileSummaries,
          units_asset_count: fileSummaries.length,
          date_last_processed: new Date().toISOString(),
        },
        { onConflict: "id_workspace,id_client" }
      );

    if (upsertErr) throw upsertErr;

    console.log(
      `[ClientContext] Client ${clientId} (${name}): ${fileSummaries.length} files → ${consolidatedProfile.length} char profile`
    );

    return { processed: fileSummaries.length };
  } catch (err: any) {
    console.error(
      `[ClientContext] Failed for client ${clientId}:`,
      err.message
    );
    return { processed: 0, error: err.message };
  }
}
