import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { fiscalYearStart, formatDateTime, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { reportWorkbook } from "@/lib/export/excel";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/** تصدير أي تقرير إلى Excel بهوية النظام وبنفس بنية الصفحة (اتجاه RTL للعربية، أرقام كقيم رقمية قابلة للجمع) */
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

  const buffer = await reportWorkbook(table, {
    hotel: app.hotel, rtl: locale === "ar", appName: t.app.name,
    generatedAt: formatDateTime(new Date().toISOString(), app.hotel.timezone), preparedBy: app.profile?.full_name,
  });
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${key}-${to}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${table.title} ${to}.xlsx`)}`,
    },
  });
}
