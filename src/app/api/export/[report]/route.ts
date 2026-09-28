import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { fiscalYearStart, formatDateTime, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { reportWorkbook } from "@/lib/export/excel";
import { docMeta, toPlainReport } from "@/lib/export/plain-report";
import { reportPdf } from "@/lib/export/pdf-report";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/**
 * تصدير أي تقرير: Excel بهوية النظام (افتراضيًا)، أو ?format=pdf لملف PDF متجهي بخطوط النظام.
 * التقرير نفسه يُبنى مرة واحدة بنفس بنية الصفحة.
 */
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
  const generatedAt = formatDateTime(new Date().toISOString(), app.hotel.timezone);
  const fileName = `${table.title} ${to}`;

  const disposition = (ext: string) => `attachment; filename="${key}-${to}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${fileName}.${ext}`)}`;

  if (url.searchParams.get("format") === "pdf") {
    const pdf = await reportPdf(toPlainReport(table, locale), docMeta(app.hotel, generatedAt, app.profile?.full_name));
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition("pdf") } });
  }

  const buffer = await reportWorkbook(table, { hotel: app.hotel, rtl: locale === "ar", appName: t.app.name, generatedAt, preparedBy: app.profile?.full_name });
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition("xlsx"),
    },
  });
}
