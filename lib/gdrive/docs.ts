/**
 * Drive documents tool (READ-ONLY): any file shared with the EngineAI service
 * account becomes queryable by the whole workspace — "share with the robot"
 * IS the publish decision (Chris's chosen policy, 2026-07-22).
 *
 * EXCEPTION: the finance forecast workbook keeps its own finance-flag-gated
 * report and is invisible to this general tool.
 *
 * Supports: Google Docs/Slides (export text), Google Sheets + Excel (SheetJS),
 * PDFs (pdf-parse), Word (mammoth), plain text/CSV/Markdown.
 */

import * as XLSX from "xlsx";
import { getGoogleAccessToken, googleSaConfigured, googleSaEmail } from "@/lib/gdrive/auth";

const FORECAST_FILE_ID = process.env.FINANCE_FORECAST_FILE_ID || "1Skw6rHX5mtQMbkK5anbJrMwEL-2AHDab";
const CACHE_MS = 10 * 60_000;
const MAX_CHARS = 8000;

const listCache: { at: number; files: DriveFile[] } = { at: 0, files: [] };
const contentCache = new Map<string, { at: number; text: string }>();

interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string }

async function listShared(): Promise<DriveFile[]> {
  // Short cache, and NEVER cache emptiness for long — a freshly shared file
  // must show up promptly ("I shared it and the list is still empty" bug).
  const ttl = listCache.files.length ? 60_000 : 5_000;
  if (Date.now() - listCache.at < ttl) return listCache.files;
  const token = await getGoogleAccessToken();
  const params = new URLSearchParams({
    // NOTE: no `sharedWithMe = true` — that flag is unreliable for service
    // accounts. An SA owns nothing, so "everything visible" IS the shared set.
    q: "trashed = false",
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: "100",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const j = await res.json();
  const files: DriveFile[] = (j.files || [])
    .filter((f: any) => f.id !== FORECAST_FILE_ID) // finance-gated elsewhere
    .filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");
  console.log(`[DriveDocs] list: ${files.length} file(s) visible to the service account`);
  listCache.at = Date.now();
  listCache.files = files;
  return files;
}

function serializeSheetRows(ws: XLSX.WorkSheet, cap: number): string {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const lines: string[] = [];
  for (const r of rows) {
    const cells = r.map((c) => String(c).trim());
    if (!cells.some((c) => c !== "")) continue;
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    lines.push(cells.slice(0, end).join(" | "));
    if (lines.length >= cap) { lines.push("… (truncated)"); break; }
  }
  return lines.join("\n");
}

async function readFileText(f: DriveFile): Promise<string> {
  const cached = contentCache.get(f.id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.text;

  const token = await getGoogleAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  let text = "";

  if (f.mimeType === "application/vnd.google-apps.document" || f.mimeType === "application/vnd.google-apps.presentation") {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`, { headers: auth });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    text = await res.text();
  } else if (f.mimeType === "application/vnd.google-apps.spreadsheet" || f.mimeType.includes("spreadsheetml") || f.mimeType === "application/vnd.ms-excel") {
    const url = f.mimeType === "application/vnd.google-apps.spreadsheet"
      ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
      : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`;
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
    const perSheet = Math.max(20, Math.floor(120 / wb.SheetNames.length));
    text = wb.SheetNames.map((n) => `### Sheet: ${n}\n${serializeSheetRows(wb.Sheets[n], perSheet)}`).join("\n\n");
  } else {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: auth });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (f.mimeType === "application/pdf") {
      const pdfParseModule: any = await import("pdf-parse");
      const pdfParse = pdfParseModule.default ?? pdfParseModule;
      text = (await pdfParse(buf)).text || "";
    } else if (f.mimeType.includes("wordprocessingml")) {
      const mammoth: any = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: buf })).value || "";
    } else if (f.mimeType.startsWith("text/") || f.mimeType === "application/json") {
      text = buf.toString("utf8");
    } else {
      throw new Error(`Unsupported file type: ${f.mimeType}`);
    }
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
  contentCache.set(f.id, { at: Date.now(), text });
  return text;
}

export async function queryDriveDocs(
  action: string,
  name?: string
): Promise<{ data: any; count: number; error?: string; notice?: string }> {
  if (!googleSaConfigured()) {
    return { data: [], count: 0, notice: "Drive documents aren't set up yet (the Google service account isn't configured). An admin needs to add GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY_B64." };
  }
  try {
    const files = await listShared();
    if (action === "list" || !name) {
      if (!files.length) {
        return { data: [], count: 0, notice: `No documents have been shared with EngineAI yet. Tell the user: share a Google Drive file with ${googleSaEmail()} (Viewer) and it becomes queryable here.` };
      }
      return { data: { documents: files.map((f) => ({ name: f.name, type: f.mimeType.split(".").pop(), modified: f.modifiedTime?.slice(0, 10) })) }, count: files.length };
    }
    // action === "read"
    const q = name.toLowerCase();
    const match = files.find((f) => f.name.toLowerCase() === q) || files.find((f) => f.name.toLowerCase().includes(q));
    if (!match) {
      return { data: { available: files.map((f) => f.name) }, count: files.length, error: `No shared document matching "${name}".` };
    }
    const text = await readFileText(match);
    if (!text) return { data: [], count: 0, error: `"${match.name}" contained no extractable text.` };
    return { data: { name: match.name, modified: match.modifiedTime?.slice(0, 10), content: text }, count: 1 };
  } catch (err: any) {
    console.error("[DriveDocs] Failed:", err?.message);
    return { data: [], count: 0, error: `Drive lookup failed: ${String(err?.message || err).slice(0, 140)}` };
  }
}
