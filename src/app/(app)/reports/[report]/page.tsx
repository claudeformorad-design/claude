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
const PAGES = ["income-statement", "balance-sheet", "cash-flow", "rooms", "daily-cash", "tax-return", "monthly-movement", "daily-totals", "missing-numbers", "budget-vs-actual", "item-card", "stock-balances", "count-sheet", "item-prices", "expiring-stock"] as const;

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
  const inventory = key === "item-card" || key === "stock-balances" || key === "count-sheet" || key === "item-prices" || key === "expiring-stock";
  const pointInTime = key === "balance-sheet" || key === "daily-cash" || key === "budget-vs-actual" || (inventory && key !== "item-card");
  const [invItems, invCats] = inventory ? await Promise.all([
    ctx.supabase.from("inventory_items").select("id, sku, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("is_active", true).order("sku"),
    ctx.supabase.from("inventory_categories").select("id, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("is_active", true).order("code"),
  ]) : [null, null];
  const departments = key === "budget-vs-actual" ? (await listDepartments(ctx.supabase, ctx.hotel.id)).filter((d) => d.is_active) : [];
  const noDates = key === "missing-numbers";

  return (
    <>
      <PageHeader title={table.title} />
      {!noDates && <form className="toolbar print:hidden">
        {!pointInTime && <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label={t.common.from} />}
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label={t.common.to} />
        {key === "item-card" && (
          <NativeSelect name="item" defaultValue={params_.item ?? ""} className="w-64" aria-label={tr("الصنف")}>
            <option value="">{tr("اختر الصنف")}</option>
            {(invItems?.data ?? []).map((x) => <option key={x.id} value={x.id}>{`${x.sku} ${(locale === "en" && x.name_en) || x.name_ar}`}</option>)}
          </NativeSelect>
        )}
        {inventory && key !== "item-card" && (invCats?.data ?? []).length > 0 && (
          <NativeSelect name="category" defaultValue={params_.category ?? ""} className="w-56" aria-label={tr("الفئة")}>
            <option value="">{tr("كل الفئات")}</option>
            {(invCats?.data ?? []).map((c) => <option key={c.id} value={c.id}>{(locale === "en" && c.name_en) || c.name_ar}</option>)}
          </NativeSelect>
        )}
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
