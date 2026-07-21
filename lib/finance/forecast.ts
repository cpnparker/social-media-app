/**
 * Finance forecast (READ-ONLY) — the "Forecast 2026.xlsx" workbook in Google
 * Drive, fetched LIVE (10-min cache) so EngineAI always reads current numbers.
 *
 * The file is an Office .xlsx stored in Drive (not a native Google Sheet), so
 * we fetch the raw file via the public-download endpoint and parse with
 * SheetJS. Requires the file to be link-visible ("Anyone with the link —
 * Viewer"); a restricted file returns an actionable notice, never a crash.
 *
 * SENSITIVE-SHEET GUARD: the workbook also contains salary data. Sheets in
 * FINANCE_FORECAST_EXCLUDE_SHEETS (default "Salary projections") are invisible
 * to the tool — not listed, not readable — regardless of the finance flag.
 */

import * as XLSX from "xlsx";
import { getGoogleAccessToken, googleSaConfigured, googleSaEmail } from "@/lib/gdrive/auth";

const DEFAULT_FILE_ID = "1Skw6rHX5mtQMbkK5anbJrMwEL-2AHDab";
const CACHE_MS = 10 * 60_000;

let cache: { at: number; buf: ArrayBuffer } | null = null;

function excludedSheets(): Set<string> {
  const raw = process.env.FINANCE_FORECAST_EXCLUDE_SHEETS ?? "Salary projections";
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

async function fetchWorkbook(): Promise<XLSX.WorkBook | { error: string }> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const id = process.env.FINANCE_FORECAST_FILE_ID || DEFAULT_FILE_ID;
    if (googleSaConfigured()) {
      // Preferred: private file shared only with the service account.
      try {
        const token = await getGoogleAccessToken();
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404 || res.status === 403) {
          return {
            error: `The service account can't see the forecast file — share the Drive file with ${googleSaEmail()} as Viewer.`,
          };
        }
        if (!res.ok) return { error: `Drive fetch failed (${res.status})` };
        cache = { at: Date.now(), buf: await res.arrayBuffer() };
      } catch (e: any) {
        return { error: `Google service-account auth failed: ${String(e?.message || e).slice(0, 160)}` };
      }
    } else {
      // Fallback: public-download endpoint — only works if the file is
      // link-visible. Prefer the service account for private files.
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: "follow" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || type.includes("text/html")) {
        return {
          error:
            "The forecast spreadsheet isn't accessible to the server. Set up the Google service account (GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY_B64 env vars, then share the file with the service account) — or make the file link-visible.",
        };
      }
      cache = { at: Date.now(), buf: await res.arrayBuffer() };
    }
  }
  try {
    return XLSX.read(cache.buf, { type: "array" });
  } catch (e: any) {
    cache = null;
    return { error: `Could not parse the forecast file: ${String(e?.message || e).slice(0, 120)}` };
  }
}

/** Serialize one sheet as trimmed pipe-separated rows the model can read. */
function serializeSheet(ws: XLSX.WorkSheet): string {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const lines: string[] = [];
  for (const r of rows) {
    const cells = r.map((c) => String(c).trim());
    if (!cells.some((c) => c !== "")) continue; // skip empty rows
    // trim trailing empty cells
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    lines.push(cells.slice(0, end).join(" | "));
    if (lines.length >= 110) { lines.push("… (truncated)"); break; }
  }
  return lines.join("\n").slice(0, 7000);
}

export async function queryForecast(
  sheet?: string
): Promise<{ data: any; count: number; error?: string; notice?: string }> {
  try {
    const wb = await fetchWorkbook();
    if ("error" in wb) return { data: [], count: 0, error: wb.error };

    const excluded = excludedSheets();
    const visible = wb.SheetNames.filter((n) => !excluded.has(n.toLowerCase()));

    let target = sheet
      ? visible.find((n) => n.toLowerCase() === sheet.toLowerCase()) ||
        visible.find((n) => n.toLowerCase().includes(sheet.toLowerCase()))
      : undefined;
    if (sheet && !target) {
      return {
        data: { available_sheets: visible }, count: visible.length,
        error: `No sheet matching "${sheet}" — pick one of the available sheets.`,
      };
    }
    if (!target) target = visible.includes("Forecast Actual Booked") ? "Forecast Actual Booked" : visible[0];

    return {
      data: {
        file: "Forecast 2026 (live from Google Drive)",
        sheet: target,
        available_sheets: visible,
        rows: serializeSheet(wb.Sheets[target]),
      },
      count: 1,
    };
  } catch (err: any) {
    console.error("[Forecast] Query failed:", err?.message);
    return { data: [], count: 0, error: `Forecast lookup failed: ${String(err?.message || err).slice(0, 140)}` };
  }
}
