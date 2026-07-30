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

/** Sheet names are typed by a human and asked for by a model, so neither side
 *  agrees on punctuation: the workbook's "Renewals only 100" was never found
 *  when the model asked for "Renewals Only 100%" because the old test was
 *  one-directional (sheet.includes(want)) on raw strings. Compare on
 *  alphanumerics only, and allow the want to be the longer of the two. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveSheet(visible: string[], want: string): string | undefined {
  const w = norm(want);
  if (!w) return undefined;
  return (
    visible.find((n) => norm(n) === w) ||
    visible.find((n) => norm(n).startsWith(w)) ||
    visible.find((n) => norm(n).includes(w)) ||
    // "Renewals Only 100%" ⊃ "Renewals only 100". Require a reasonably long
    // sheet name so a 2-letter tab doesn't swallow every request.
    visible.find((n) => norm(n).length >= 5 && w.includes(norm(n)))
  );
}

/** Serialize one sheet as trimmed pipe-separated rows the model can read.
 *  With `match`, return only the header block plus rows whose LABEL cells hit
 *  a term — a cross-scenario question wants one row from every sheet, not 110
 *  rows from three of them. */
export function serializeSheet(ws: XLSX.WorkSheet, match?: string[]): { rows: string; matched: number } {
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const all: string[] = [];
  for (const r of raw) {
    const cells = r.map((c) => String(c).trim());
    if (!cells.some((c) => c !== "")) continue; // skip empty rows
    // trim trailing empty cells
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    all.push(cells.slice(0, end).join(" | "));
  }

  if (!match || match.length === 0) {
    const lines = all.slice(0, 110);
    if (all.length > 110) lines.push("… (truncated)");
    return { rows: lines.join("\n").slice(0, 7000), matched: lines.length };
  }

  const terms = match.map(norm).filter(Boolean);
  // The first non-empty rows carry the month header the figures line up under.
  const head = all.slice(0, 4);
  const hits: string[] = [];
  for (const line of all.slice(4)) {
    const label = norm(line.split("|").slice(0, 2).join(" "));
    if (terms.some((t) => label.includes(t))) hits.push(line);
    if (hits.length >= 40) break;
  }
  return { rows: [...head, ...hits].join("\n").slice(0, 7000), matched: hits.length };
}

/** How many sheets one call may return. Comparison questions ("net profit by
 *  month across every scenario") need most of the workbook at once, and the
 *  tool loop caps repeat calls to the same tool at 3 — so one-sheet-per-call
 *  meant the model got three scenarios and filled the rest of the table with
 *  "[not retrieved]". Serialisation is already capped per sheet, so several
 *  fit comfortably. */
const MAX_SHEETS_PER_CALL = 12;
/** With a row filter each sheet costs a handful of lines, so the whole
 *  workbook fits — which is the only way a "compare every scenario" answer
 *  gets every scenario. */
const MAX_SHEETS_FILTERED = 30;

export async function queryForecast(
  sheet?: string,
  match?: string
): Promise<{ data: any; count: number; error?: string; notice?: string }> {
  try {
    const wb = await fetchWorkbook();
    if ("error" in wb) return { data: [], count: 0, error: wb.error };

    const excluded = excludedSheets();
    const visible = wb.SheetNames.filter((n) => !excluded.has(n.toLowerCase()));

    const terms = (match || "").split(",").map((x) => x.trim()).filter(Boolean);
    const filtered = terms.length > 0;

    // "all" (or a comma-separated list) returns several sheets in one call.
    const raw = (sheet || "").trim();
    const wantsAll = /^(all|\*|all sheets|everything)$/i.test(raw);
    const requested = wantsAll
      ? visible
      : raw.includes(",")
        ? raw.split(",").map((x) => x.trim()).filter(Boolean)
        : [];

    if (wantsAll || requested.length > 1) {
      const resolved: string[] = [];
      const missing: string[] = [];
      for (const want of requested) {
        const hit = resolveSheet(visible, want);
        if (hit && !resolved.includes(hit)) resolved.push(hit);
        else if (!hit) missing.push(want);
      }
      const limit = filtered ? MAX_SHEETS_FILTERED : MAX_SHEETS_PER_CALL;
      const capped = resolved.slice(0, limit);
      const dropped = resolved.slice(limit);
      const sheets = capped.map((n) => {
        const { rows, matched } = serializeSheet(wb.Sheets[n], filtered ? terms : undefined);
        return {
          sheet: n,
          rows,
          // Say it outright, per sheet: a silent empty block is what the model
          // turns into "Not retrieved" instead of asking again.
          ...(filtered && matched === 0
            ? { note: `No row matched ${terms.map((t) => `"${t}"`).join(" / ")} on this sheet — the figure may be labelled differently here. Re-read this sheet without a row filter before reporting it as unavailable.` }
            : {}),
        };
      });
      return {
        data: {
          file: "Forecast 2026 (live from Google Drive)",
          available_sheets: visible,
          ...(filtered ? { row_filter: terms } : {}),
          ...(missing.length
            ? { not_found: missing, not_found_hint: "These names matched no sheet. Check available_sheets for the real spelling and call again — do NOT report them as unavailable without retrying." }
            : {}),
          ...(dropped.length
            ? { omitted_sheets: dropped, omitted_hint: `Hit the ${limit}-sheet limit. Call again with sheet="${dropped.join(", ")}" to get these — do NOT leave them blank in the answer.` }
            : {}),
          sheets,
        },
        count: capped.length,
      };
    }

    let target = raw ? resolveSheet(visible, raw) : undefined;
    if (raw && !target) {
      return {
        data: { available_sheets: visible }, count: visible.length,
        error: `No sheet matching "${raw}" — pick one of the available sheets.`,
      };
    }
    if (!target) target = visible.includes("Forecast Actual Booked") ? "Forecast Actual Booked" : visible[0];

    const { rows, matched } = serializeSheet(wb.Sheets[target], filtered ? terms : undefined);
    return {
      data: {
        file: "Forecast 2026 (live from Google Drive)",
        sheet: target,
        available_sheets: visible,
        ...(filtered ? { row_filter: terms } : {}),
        rows,
        ...(filtered && matched === 0
          ? { note: `No row matched ${terms.map((t) => `"${t}"`).join(" / ")} — re-read this sheet without a row filter before reporting the figure as unavailable.` }
          : {}),
      },
      count: 1,
    };
  } catch (err: any) {
    console.error("[Forecast] Query failed:", err?.message);
    return { data: [], count: 0, error: `Forecast lookup failed: ${String(err?.message || err).slice(0, 140)}` };
  }
}
