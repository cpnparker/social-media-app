import ExcelJS from "exceljs";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { nextDay } from "@/lib/date-utils";
import { canSignMedia, signMediaUrl } from "@/lib/gcs-sign";

// Client handover export: a two-sheet workbook for one client covering all
// content COMMISSIONED in the period (task date_created basis — the same
// definition as the operations dashboards, so the export always agrees with
// the on-screen numbers). Sheet 1 is one row per content item with Google Doc
// links and media download URLs; sheet 2 is one row per final-revision media
// file with a signed, no-login download URL (1-year validity).

interface ContentRow {
  idContent: number | null; // null: standalone task with no content record
  name: string;
  type: string;
  contract: string;
  commissioned: string | null;
  delivered: string | null;
  cus: number;
  docBody: string | null;
  docSocial: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface MediaRow {
  idContent: number;
  fileName: string;
  fileType: string;
  sizeMB: number | null;
  url: string;
}

const APP_URL = "https://app.thecontentengine.com";

function docUrl(id: string | null): string | null {
  return id ? `https://docs.google.com/document/d/${id}/edit` : null;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export async function buildClientExport(
  clientId: number,
  from: string | null,
  to: string | null
): Promise<{ buffer: Buffer; clientName: string }> {
  // ── 1. Tasks commissioned in period (same filters as the dashboards) ──
  const BASE_COLS = "id_task, id_content, id_client, name_client, units_content, date_created, date_completed, flag_spiked";
  const buildTaskQuery = (view: string, extraCols: string) => (s: number, e: number) => {
    let q = supabase
      .from(view)
      .select(`${BASE_COLS}, ${extraCols}`)
      .eq("id_client", clientId)
      .order("id_task", { ascending: true });
    if (from) q = q.gte("date_created", from);
    if (to) q = q.lt("date_created", nextDay(to));
    return q.range(s, e);
  };
  const [contentTasks, socialTasks] = await Promise.all([
    fetchAllRows(buildTaskQuery("app_tasks_content", "name_content, type_content")),
    fetchAllRows(buildTaskQuery("app_tasks_social", "name_social")),
  ]);

  // Group by content, but keep name/type/date fallbacks from the tasks so
  // orphan content ids (no app_content row) and standalone tasks (null
  // id_content) still render — the dashboards count both, and the export's
  // totals must agree with the on-screen numbers.
  interface TaskAgg { cus: number; name: string; type: string; firstCreated: string | null; lastCompleted: string | null; }
  let clientName = "Client";
  const aggByContent = new Map<number, TaskAgg>();
  const standaloneRows: ContentRow[] = [];
  for (const t of [...contentTasks, ...socialTasks]) {
    if (t.flag_spiked === 1 && !t.date_completed) continue;
    if (t.name_client) clientName = t.name_client;
    const cus = Number(t.units_content) || 0;
    const name = t.name_content || t.name_social || "Untitled";
    const type = t.type_content || (t.name_social !== undefined ? "social promo" : "unknown");
    if (t.id_content) {
      const agg = aggByContent.get(t.id_content) ?? { cus: 0, name, type, firstCreated: null, lastCompleted: null };
      agg.cus += cus;
      if (t.date_created && (!agg.firstCreated || t.date_created < agg.firstCreated)) agg.firstCreated = t.date_created;
      if (t.date_completed && (!agg.lastCompleted || t.date_completed > agg.lastCompleted)) agg.lastCompleted = t.date_completed;
      aggByContent.set(t.id_content, agg);
    } else {
      standaloneRows.push({
        idContent: null,
        name,
        type: type.replace(/_/g, " "),
        contract: "",
        commissioned: t.date_created || null,
        delivered: t.date_completed || null,
        cus: r2(cus),
        docBody: null,
        docSocial: null,
      });
    }
  }
  const contentIds = Array.from(aggByContent.keys());

  // ── 2. Content metadata + Google Doc references ──
  const contentRows: ContentRow[] = [];
  const foundIds = new Set<number>();
  for (let i = 0; i < contentIds.length; i += 200) {
    const batch = contentIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("app_content")
      .select("id_content, name_content, type_content, name_contract, date_created, date_completed, document_body, document_social")
      .in("id_content", batch);
    if (error) throw error;
    for (const c of data || []) {
      foundIds.add(c.id_content);
      contentRows.push({
        idContent: c.id_content,
        name: c.name_content || "Untitled",
        type: (c.type_content || "unknown").replace(/_/g, " "),
        contract: c.name_contract || "",
        commissioned: c.date_created || null,
        delivered: c.date_completed || null,
        cus: r2(aggByContent.get(c.id_content)?.cus || 0),
        docBody: c.document_body || null,
        docSocial: c.document_social || null,
      });
    }
  }
  // Orphan content ids: counted by the dashboards, so render from task data
  for (const [id, agg] of Array.from(aggByContent.entries())) {
    if (foundIds.has(id)) continue;
    contentRows.push({
      idContent: id,
      name: agg.name,
      type: agg.type.replace(/_/g, " "),
      contract: "",
      commissioned: agg.firstCreated,
      delivered: agg.lastCompleted,
      cus: r2(agg.cus),
      docBody: null,
      docSocial: null,
    });
  }
  contentRows.push(...standaloneRows);
  contentRows.sort((a, b) => (a.commissioned || "").localeCompare(b.commissioned || "") || a.name.localeCompare(b.name));

  // ── 3. Final-revision media files with signed download URLs ──
  const mediaRows: MediaRow[] = [];
  if (canSignMedia() && contentIds.length > 0) {
    const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    let media: Record<string, unknown>[] = [];
    for (let i = 0; i < contentIds.length; i += 100) {
      const batch = contentIds.slice(i, i + 100);
      media = media.concat(
        await fetchAllRows((s, e) =>
          supabase
            .from("app_media_content")
            .select("id_content, id_file, file_name, file_path, type_file, order_sort")
            .eq("flag_current", 1)
            .in("id_content", batch)
            .order("id_media", { ascending: true })
            .range(s, e)
        )
      );
    }
    const fileIds = Array.from(new Set(media.map((m) => m.id_file).filter(Boolean))) as number[];
    const sizeByFile: Record<number, number> = {};
    for (let i = 0; i < fileIds.length; i += 200) {
      const { data } = await supabase.from("files").select("id_file, information_size").in("id_file", fileIds.slice(i, i + 200));
      for (const f of data || []) sizeByFile[f.id_file] = Number(f.information_size) || 0;
    }
    for (const m of media) {
      const path = m.file_path as string | null;
      if (!path) continue;
      const url = signMediaUrl(path, expires);
      if (!url) continue;
      const size = sizeByFile[m.id_file as number];
      mediaRows.push({
        idContent: m.id_content as number,
        fileName: (m.file_name as string) || "",
        fileType: (m.type_file as string) || "",
        sizeMB: size ? Math.round((size / 1048576) * 100) / 100 : null,
        url,
      });
    }
    mediaRows.sort((a, b) => a.idContent - b.idContent || a.fileName.localeCompare(b.fileName));
  }
  const mediaByContent: Record<number, MediaRow[]> = {};
  for (const m of mediaRows) (mediaByContent[m.idContent] ||= []).push(m);
  const mediaFor = (row: ContentRow): MediaRow[] =>
    row.idContent != null ? mediaByContent[row.idContent] || [] : [];

  // ── 4. Workbook ──
  const wb = new ExcelJS.Workbook();
  const today = new Date().toISOString().slice(0, 10);
  const expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const range = `${from || "all time"} to ${to || today}`;

  const headFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  const headFont: Partial<ExcelJS.Font> = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  const cellFont: Partial<ExcelJS.Font> = { name: "Arial", size: 10 };
  const linkFont: Partial<ExcelJS.Font> = { name: "Arial", size: 10, color: { argb: "FF0563C1" }, underline: true };
  const subFont: Partial<ExcelJS.Font> = { name: "Arial", size: 9, color: { argb: "FF666666" } };

  // Sheet 1 — Content
  const ws = wb.addWorksheet("Content");
  ws.getCell("A1").value = `${clientName} — Content Commissioned`;
  ws.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  ws.getCell("A2").value = `Content commissioned ${range}. Generated ${today} from The Content Engine operations database. Same definition as the operations dashboards (tasks created in period; spiked-incomplete excluded).`;
  ws.getCell("A2").font = subFont;
  ws.getCell("A3").value = `Doc links are Google Docs shared "anyone with the link". Media download links need no login and are valid until ${expiryDate}. Full per-file list on the "Media Files" sheet.`;
  ws.getCell("A3").font = subFont;

  const HEAD = 5;
  const headers = ["#", "Content", "Type", "Contract", "Commissioned", "Delivered", "CUs", "Script (Google Doc)", "Social copy (Google Doc)", "Media files", "App link", "Media download URLs"];
  headers.forEach((h, i) => {
    const c = ws.getRow(HEAD).getCell(i + 1);
    c.value = h;
    c.font = headFont;
    c.fill = headFill;
  });

  contentRows.forEach((row, i) => {
    const r = ws.getRow(HEAD + 1 + i);
    const media = mediaFor(row);
    r.getCell(1).value = i + 1;
    r.getCell(2).value = row.name;
    r.getCell(3).value = row.type;
    r.getCell(4).value = row.contract;
    r.getCell(5).value = parseDate(row.commissioned);
    r.getCell(5).numFmt = "dd mmm yyyy";
    r.getCell(6).value = parseDate(row.delivered);
    r.getCell(6).numFmt = "dd mmm yyyy";
    r.getCell(7).value = row.cus;
    r.getCell(7).numFmt = "0.00";
    const body = docUrl(row.docBody);
    if (body) r.getCell(8).value = { text: "Open doc", hyperlink: body };
    const social = docUrl(row.docSocial);
    if (social) r.getCell(9).value = { text: "Open doc", hyperlink: social };
    if (media.length) r.getCell(10).value = media.length;
    if (row.idContent != null) {
      const appLink = `${APP_URL}/all/contents/${row.idContent}`;
      r.getCell(11).value = { text: appLink, hyperlink: appLink };
    }
    if (media.length) r.getCell(12).value = media.map((m) => m.url).join("\n");
    r.eachCell((c, col) => {
      c.font = col === 8 || col === 9 || col === 11 ? linkFont : cellFont;
    });
  });
  const totalRow = ws.getRow(HEAD + 1 + contentRows.length);
  totalRow.getCell(2).value = `Total — ${contentRows.length} content items`;
  totalRow.getCell(7).value = contentRows.length
    ? { formula: `SUM(G${HEAD + 1}:G${HEAD + contentRows.length})` }
    : 0;
  totalRow.getCell(7).numFmt = "0.00";
  totalRow.eachCell((c) => (c.font = { name: "Arial", size: 10, bold: true }));
  [5, 52, 17, 36, 13, 13, 8, 17, 21, 11, 50, 70].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: HEAD }];
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + contentRows.length, column: headers.length } };

  // Sheet 2 — Media Files
  const ws2 = wb.addWorksheet("Media Files");
  ws2.getCell("A1").value = "Final media files — direct download links";
  ws2.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  ws2.getCell("A2").value = `Latest-revision media for each content item. Links need no login and are valid until ${expiryDate}.`;
  ws2.getCell("A2").font = subFont;
  const H2 = 4;
  ["Content", "Commissioned", "File name", "File type", "Size (MB)", "Download URL"].forEach((h, i) => {
    const c = ws2.getRow(H2).getCell(i + 1);
    c.value = h;
    c.font = headFont;
    c.fill = headFill;
  });
  let rowIdx = H2 + 1;
  for (const row of contentRows) {
    for (const m of mediaFor(row)) {
      const r = ws2.getRow(rowIdx++);
      r.getCell(1).value = row.name;
      r.getCell(2).value = parseDate(row.commissioned);
      r.getCell(2).numFmt = "dd mmm yyyy";
      r.getCell(3).value = m.fileName;
      r.getCell(4).value = m.fileType;
      if (m.sizeMB != null) {
        r.getCell(5).value = m.sizeMB;
        r.getCell(5).numFmt = "0.00";
      }
      r.getCell(6).value = { text: m.url, hyperlink: m.url };
      r.eachCell((c, col) => (c.font = col === 6 ? linkFont : cellFont));
    }
  }
  [52, 13, 55, 22, 10, 95].forEach((w, i) => (ws2.getColumn(i + 1).width = w));
  ws2.views = [{ state: "frozen", ySplit: H2 }];
  if (rowIdx > H2 + 1) ws2.autoFilter = { from: { row: H2, column: 1 }, to: { row: rowIdx - 1, column: 6 } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, clientName };
}
