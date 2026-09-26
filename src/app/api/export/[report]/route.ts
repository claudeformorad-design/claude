import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { fiscalYearStart, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { MoneyDecimal } from "@/lib/accounting/money";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/** تصدير أي تقرير إلى Excel بنفس بنية الصفحة (اتجاه RTL للعربية، أرقام كقيم رقمية قابلة للجمع) */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  if (!(report in REPORTS)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const key = report as ReportKey;
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  if (!app.can(REPORTS[key])) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { locale, t } = await getI18n();
  const url = new URL(request.url);
  const today = todayInTimeZone(app.hotel.timezone);
  const to = isIsoDate(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const fromParam = url.searchParams.get("from") ?? "";
  const from = isIsoDate(fromParam) && fromParam <= to ? fromParam : fiscalYearStart(to, app.hotel.fiscal_year_start_month);
  const table = await buildReport(key, app, t, locale, { from, to });

  const wb = new ExcelJS.Workbook();
  wb.creator = t.app.name;
  const ws = wb.addWorksheet(table.title.slice(0, 31), { views: [{ rightToLeft: locale === "ar", state: "frozen", ySplit: 4 }] });
  ws.addRow([app.hotel.name_ar]).font = { bold: true, size: 14 };
  ws.addRow([table.title]).font = { bold: true, size: 12 };
  ws.addRow([table.subtitle]);
  const header = ws.addRow(table.columns);
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }; });
  for (const row of table.rows) {
    const r = ws.addRow(row.cells.map((c) => (c instanceof MoneyDecimal ? c.toDecimalPlaces(2).toNumber() : c ?? "")));
    if (row.kind !== "line") r.font = { bold: true };
    if (row.kind === "total") r.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  }
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 42 : 18;
    if (i > 0) col.numFmt = "#,##0.00;[Red]-#,##0.00";
  });
  if (table.note) ws.addRow([]).getCell(1).value = table.note.text;

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${key}-${to}.xlsx"`,
    },
  });
}
