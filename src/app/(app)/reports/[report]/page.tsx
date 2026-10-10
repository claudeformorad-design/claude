import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ExportButtons } from "@/components/reports/export-buttons";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { listDepartments } from "@/services/accounts.service";
import { requireAppContext } from "@/lib/auth/context";
import { toPlainReport } from "@/lib/export/plain-report";
import { REPORTS, type ReportKey, buildReport, parseReportParams, reportQuery } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/** صفحة عامة للقوائم المالية: قائمة الدخل، الميزانية، التدفقات، الإشغال، النقدية اليومية */
const PAGES = ["income-statement", "balance-sheet", "cash-flow", "rooms", "daily-cash", "tax-return", "monthly-movement", "daily-totals", "missing-numbers", "budget-vs-actual"] as const;

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ report: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { report } = await params;
  if (!(PAGES as readonly string[]).includes(report)) notFound();
  const key = report as ReportKey;
  const ctx = await requireAppContext(REPORTS[key]);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const params_ = parseReportParams(key, (k) => (sp as Record<string, string | undefined>)[k], ctx.hotel);
  const { from, to } = params_;
  const table = await buildReport(key, ctx, t, locale, params_);
  const pointInTime = key === "balance-sheet" || key === "daily-cash" || key === "budget-vs-actual";
  const departments = key === "budget-vs-actual" ? (await listDepartments(ctx.supabase, ctx.hotel.id)).filter((d) => d.is_active) : [];
  const noDates = key === "missing-numbers";

  return (
    <>
      <PageHeader title={table.title} />
      {!noDates && <form className="toolbar print:hidden">
        {!pointInTime && <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label={t.common.from} />}
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label={t.common.to} />
        {departments.length > 0 && (
          <NativeSelect name="department" defaultValue={params_.department ?? ""} className="w-56" aria-label={tr("القسم")}>
            <option value="">{tr("كل الأقسام")}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{(locale === "en" && d.name_en) || d.name_ar}</option>)}
          </NativeSelect>
        )}
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>}
      <ReportView report={toPlainReport(table, locale)} from={pointInTime || noDates ? undefined : from} to={to}
        actions={<ExportButtons report={key} query={reportQuery(params_)} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />} />
    </>
  );
}
