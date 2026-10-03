import ExcelJS from "exceljs";
import { MoneyDecimal } from "@/lib/accounting/money";
import { plainText } from "@/lib/text";
import type { HotelRow } from "@/lib/supabase/database.types";
import type { ReportTable } from "@/services/report-tables";
import { CODE_COLUMN, hasCodes } from "./plain-report";

/**
 * ملف Excel بهوية النظام: شريط عنوان داكن باسم الفندق، عنوان التقرير وفترته، رأس جدول داكن،
 * صفوف أقسام دافئة وإجمالي داكن، أرقام قابلة للجمع (بلا أقواس والسالب بالأحمر)، وإعداد طباعة A4 جاهز.
 */
const INK = "FF1F1D1B";
const INK_SOFT = "FF6B6964";
const LINE = "FFECEAE3";
const SECTION = "FFF1F0EC";
const SUBTOTAL = "FFFBF9F3";
const WHITE = "FFFFFFFF";
const FONT = "Segoe UI";
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00;""';

export async function reportWorkbook(table: ReportTable, opts: {
  hotel: HotelRow; rtl: boolean; generatedAt: string; preparedBy?: string; appName: string;
}): Promise<ArrayBuffer> {
  const { hotel, rtl } = opts;
  const dir = rtl ? "rtl" : "ltr";
  const pad = (text: string) => `  ${text}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.appName;
  wb.title = table.title;
  wb.company = hotel.name_ar;

  // عمود الرمز مستقل قبل الاسم حين يحمل التقرير رموزًا، ويمتد عليه عنوان القسم والإجمالي
  const codes = hasCodes(table.rows);
  const lead = codes ? 1 : 0;
  const columns = codes ? [CODE_COLUMN, ...table.columns] : table.columns;
  const cols = columns.length;
  const headerRow = 6;
  const ws = wb.addWorksheet(table.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), {
    views: [{ rightToLeft: rtl, state: "frozen", ySplit: headerRow, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: cols > 5 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
      printTitlesRow: `${headerRow}:${headerRow}`,
    },
    headerFooter: {
      oddFooter: `&L&8&K6B6964${hotel.name_ar}&R&8&K6B6964صفحة &P من &N`,
    },
  });

  // عرض الأعمدة: الرمز ضيق، والبيان أعرض، والبقية للأرقام؛ يتسع حسب أطول قيمة
  const width = (i: number) => {
    const texts = [table.columns[i] ?? "", ...table.rows.map((r) => {
      const c = r.cells[i];
      return c instanceof MoneyDecimal ? c.toFixed(2) + "000" : (c ?? "");
    })];
    const longest = Math.max(...texts.map((s) => String(s).length));
    return i === 0 ? Math.min(Math.max(longest + 6, 34), 60) : Math.min(Math.max(longest + 4, 16), 28);
  };
  ws.columns = [...(codes ? [{ width: 12 }] : []), ...table.columns.map((_, i) => ({ width: width(i) }))];

  const band = (rowNo: number, height: number) => {
    ws.mergeCells(rowNo, 1, rowNo, cols);
    const row = ws.getRow(rowNo);
    row.height = height;
    return row.getCell(1);
  };

  // 1: شريط اسم الفندق
  const h = band(1, 34);
  h.value = pad(hotel.name_ar);
  h.font = { name: FONT, size: 15, bold: true, color: { argb: WHITE } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  h.alignment = { vertical: "middle", readingOrder: dir };

  // 2: بيانات الفندق النظامية
  const legal = [hotel.legal_name, hotel.tax_number && `الرقم الضريبي ${hotel.tax_number}`, hotel.commercial_registration && `السجل التجاري ${hotel.commercial_registration}`]
    .filter(Boolean).join("   ");
  const l = band(2, legal ? 20 : 8);
  l.value = legal && pad(legal);
  l.font = { name: FONT, size: 9, color: { argb: INK_SOFT } };
  l.alignment = { vertical: "middle", readingOrder: dir };

  // 3: عنوان التقرير
  const title = band(3, 30);
  title.value = pad(table.title);
  title.font = { name: FONT, size: 17, bold: true, color: { argb: INK } };
  title.alignment = { vertical: "bottom", readingOrder: dir };

  // 4: الفترة وتاريخ الإعداد
  const meta = band(4, 20);
  meta.value = pad([table.subtitle, `أُعدّ في ${opts.generatedAt}`, opts.preparedBy && `بواسطة ${opts.preparedBy}`].filter(Boolean).join("   "));
  meta.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
  meta.alignment = { vertical: "top", readingOrder: dir };

  ws.getRow(5).height = 10;

  // 6: رأس الجدول
  const head = ws.getRow(headerRow);
  head.values = columns.map((c, i) => (i <= lead ? pad(c) : c));
  head.height = 28;
  head.eachCell((c, i) => {
    c.font = { name: FONT, size: 10.5, bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { vertical: "middle", horizontal: i <= lead + 1 ? undefined : "center", readingOrder: dir };
  });

  for (const r of table.rows) {
    const values = r.cells.map((c, i) => (c instanceof MoneyDecimal ? c.toDecimalPlaces(2).toNumber()
      : i === 0 && c ? (r.kind === "line" && !codes ? `      ${plainText(c)}` : pad(plainText(c))) : plainText(c)));
    const line = r.kind === "line";
    const row = ws.addRow(codes ? (line ? [pad(r.code ?? ""), ...values] : [values[0], null, ...values.slice(1)]) : values);
    if (codes && !line) ws.mergeCells(row.number, 1, row.number, 2);
    row.height = r.kind === "line" ? 21 : 24;
    const fill = r.kind === "section" ? SECTION : r.kind === "subtotal" ? SUBTOTAL : r.kind === "total" ? INK : null;
    for (let i = 1; i <= cols; i++) {
      const c = row.getCell(i);
      const first = i <= lead + 1;
      c.font = {
        name: FONT, size: r.kind === "total" ? 11 : 10.5, bold: r.kind !== "line",
        color: { argb: r.kind === "total" ? WHITE : codes && line && i === 1 ? INK_SOFT : INK },
      };
      if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      c.border = r.kind === "total" ? {} : { bottom: { style: "thin", color: { argb: LINE } }, ...(r.kind === "subtotal" ? { top: { style: "thin", color: { argb: "FFDCD9D0" } } } : {}) };
      // المحاذاة العامة: النص يبدأ من جهة القراءة والأرقام في الجهة المقابلة، كما في الجدول على الشاشة
      c.alignment = { vertical: "middle", readingOrder: dir };
      if (!first && typeof c.value === "number") c.numFmt = MONEY_FMT;
    }
  }

  if (table.note) {
    ws.addRow([]);
    const n = ws.addRow([pad(table.note.text)]);
    ws.mergeCells(n.number, 1, n.number, cols);
    const c = n.getCell(1);
    c.font = { name: FONT, size: 10, bold: true, color: { argb: table.note.ok ? "FF23845A" : "FFB42318" } };
    c.alignment = { readingOrder: dir };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
