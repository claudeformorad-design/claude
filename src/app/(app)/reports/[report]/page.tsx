import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ExportButtons } from "@/components/reports/export-buttons";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAppContext } from "@/lib/auth/context";
import { fiscalYearStart, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { toPlainReport } from "@/lib/export/plain-report";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/** صفحة عامة للقوائم المالية: قائمة الدخل، الميزانية، التدفقات، الإشغال، النقدية اليومية */
const PAGES = ["income-statement", "balance-sheet", "cash-flow", "rooms", "daily-cash", "tax-return"] as const;

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ report: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { report } = await params;
  if (!(PAGES as readonly string[]).includes(report)) notFound();
  const key = report as ReportKey;
  const ctx = await requireAppContext(REPORTS[key]);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const defaultFrom = key === "income-statement" || key === "cash-flow" ? fiscalYearStart(to, ctx.hotel.fiscal_year_start_month) : `${to.slice(0, 7)}-01`;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : defaultFrom;
  const table = await buildReport(key, ctx, t, locale, { from, to });
  const pointInTime = key === "balance-sheet" || key === "daily-cash";

  return (
    <>
      <PageHeader title={table.title} />
      <form className="toolbar print:hidden">
        {!pointInTime && <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label={t.common.from} />}
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <ReportView report={toPlainReport(table, locale)} from={pointInTime ? undefined : from} to={to}
        actions={<ExportButtons report={key} query={`from=${from}&to=${to}`} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />} />
    </>
  );
}
