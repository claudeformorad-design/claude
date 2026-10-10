import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { ReportDocument } from "@/components/reports/report-document";
import { docMeta, toPlainReport } from "@/lib/export/plain-report";
import { requireAppContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { REPORTS, type ReportKey, buildReport, parseReportParams } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";
import { PrintToolbar } from "./print-toolbar";

/** نسخة التقرير للطباعة وحفظه PDF (بلا قوائم النظام)، تفتح في تبويب جديد وتعرض نافذة الطباعة مباشرة */
export default async function PrintReportPage({ params, searchParams }: {
  params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { report } = await params;
  if (!(report in REPORTS)) notFound();
  const key = report as ReportKey;
  const ctx = await requireAppContext(REPORTS[key]);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const table = await buildReport(key, ctx, t, locale, parseReportParams(key, (k) => sp[k], ctx.hotel));
  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{tr("{0}، {1}", table.title, ctx.hotel.name_ar)}</title>
      <PrintToolbar />
      <ReportDocument report={toPlainReport(table, locale)}
        meta={docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name)} />
    </div>
  );
}
