import { tr } from "@/i18n/tr";
import ExcelJS from "exceljs";
import { isValidAmount, toMoney } from "@/lib/accounting/money";

/**
 * قراءة ملفات الاستيراد وتحويل قيم الخلايا. يقبل Excel بصيغة xlsx وCSV بترميز UTF-8.
 * أول صف فيه عناوين الأعمدة، ويُقبل العنوان بالعربية كما في القالب (والنجمة اختيارية) أو بالمفتاح الإنجليزي.
 */

export type ColumnKind = "text" | "number" | "date" | "bool" | "enum";
export type ImportColumn = {
  key: string;
  header: string;
  kind: ColumnKind;
  required?: boolean;
  max?: number;
  example: string;
  hint?: string;
  /** للقوائم: النص المعروض بالعربية ← القيمة المخزنة */
  options?: Record<string, string>;
};

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type RawSheet = { headers: string[]; rows: { line: number; cells: string[] }[] };

const normalizeHeader = (h: string) => h.replace(/[*‏‎]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

/** CSV بسيط متوافق مع Excel: فاصلة أو فاصلة منقوطة، والحقول بين علامات تنصيص */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field.trim()); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field.trim()); out.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field.trim()); out.push(row); }
  return out;
}

export async function readSheet(file: File): Promise<RawSheet> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportFileError(tr("حجم الملف أكبر من 5 ميجابايت"));
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith(".csv")) {
    grid = parseCsv(await file.text());
  } else if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(await file.arrayBuffer());
    } catch {
      throw new ImportFileError(tr("تعذّرت قراءة ملف Excel، احفظه بصيغة xlsx وأعد المحاولة"));
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new ImportFileError(tr("الملف لا يحتوي على ورقة بيانات"));
    grid = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(r.getCell(c).value));
      grid[n - 1] = cells;
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  } else {
    throw new ImportFileError(tr("صيغة الملف غير مدعومة، استخدم xlsx أو csv"));
  }
  const [head = [], ...body] = grid;
  const rows = body.map((cells, i) => ({ line: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportFileError(tr("الحد الأقصى {0} صف في الملف الواحد", MAX_IMPORT_ROWS));
  return { headers: head.map((h) => h.trim()), rows };
}

export class ImportFileError extends Error {}

/** يربط أعمدة الملف بأعمدة القالب؛ يرجع الأعمدة المطلوبة الناقصة */
export function mapHeaders(headers: string[], columns: ImportColumn[]): { index: Map<string, number>; missing: string[]; unknown: string[] } {
  const index = new Map<string, number>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const n = normalizeHeader(h);
    const col = columns.find((c) => normalizeHeader(c.header) === n || normalizeHeader(tr(c.header)) === n || c.key.toLowerCase() === n);
    if (col && !index.has(col.key)) index.set(col.key, i); else unknown.push(h);
  });
  const missing = columns.filter((c) => c.required && !index.has(c.key)).map((c) => tr(c.header));
  return { index, missing, unknown };
}

const YES = new Set(["نعم", "yes", "y", "true", "1", "صح"]);
const NO = new Set(["لا", "no", "n", "false", "0", "خطأ"]);

/** تحويل قيمة الخلية حسب نوع العمود؛ يرجع خطأ بالعربية أو القيمة */
export function convert(col: ImportColumn, raw: string): { value: string | number | boolean | null } | { error: string } {
  const v = raw.trim();
  if (!v) return col.required ? { error: tr("{0} مطلوب", tr(col.header)) } : { value: null };
  switch (col.kind) {
    case "text":
      if (col.max && v.length > col.max) return { error: tr("{0} أطول من {1} حرفًا", tr(col.header), col.max) };
      return { value: v };
    case "number": {
      const n = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
      if (!isValidAmount(n) || toMoney(n).isNegative()) return { error: tr("{0} يجب أن يكون رقمًا موجبًا", tr(col.header)) };
      return { value: toMoney(n).toFixed() };
    }
    case "date": {
      const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
      if (!y) return { error: tr("{0} تاريخ غير صحيح، اكتبه مثل 2026-01-31", tr(col.header)) };
      const out = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      const dt = new Date(`${out}T00:00:00Z`);
      if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== out) return { error: tr("{0} تاريخ غير صحيح", tr(col.header)) };
      return { value: out };
    }
    case "bool": {
      const l = v.toLowerCase();
      if (YES.has(l)) return { value: true };
      if (NO.has(l)) return { value: false };
      return { error: tr("{0} يُكتب نعم أو لا", tr(col.header)) };
    }
    case "enum": {
      const options = col.options ?? {};
      const hit = Object.entries(options).find(([label, val]) => label === v || tr(label) === v || val.toLowerCase() === v.toLowerCase());
      if (!hit) return { error: tr("{0} يجب أن يكون واحدًا من: {1}", tr(col.header), Object.keys(options).map((k) => tr(k)).join(tr("، "))) };
      return { value: hit[1] };
    }
  }
}
