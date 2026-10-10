import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { ExportButtons } from "@/components/reports/export-buttons";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { requireAppContext } from "@/lib/auth/context";
import { toPlainReport } from "@/lib/export/plain-report";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { REPORTS, buildReport, parseReportParams, reportQuery } from "@/services/report-tables";
import { getI18n } from "@/i18n/server";

/**
 * كشف حساب لأي حساب بين تاريخين: الحساب التفصيلي بحركته، والرئيسي إجماليًا بكل فروعه،
 * ويمكن حصره في مركز تكلفة، أو عرض كشف مركز التكلفة وحده.
 */
export default async function AccountStatementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAppContext(REPORTS["account-statement"]);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const p = parseReportParams("account-statement", (k) => sp[k], ctx.hotel);
  const [table, accounts, departments] = await Promise.all([
    buildReport("account-statement", ctx, t, locale, p),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;
  const ready = Boolean(p.account || p.department);

  return (
    <>
      <PageHeader title={ready ? table.title : tr("كشف حساب")} />
      <form className="toolbar print:hidden">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{tr("الحساب")}</span>
          <NativeSelect name="account" defaultValue={p.account ?? ""} className="w-80" aria-label={tr("الحساب")}>
            <option value="">{tr("كل الحسابات")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{`${a.code} ${name(a)}${a.is_postable ? "" : ` (${tr("إجمالي")})`}`}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{tr("مركز التكلفة")}</span>
          <NativeSelect name="department" defaultValue={p.department ?? ""} className="w-60" aria-label={tr("مركز التكلفة")}>
            <option value="">{tr("كل المراكز")}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{`${d.code} ${name(d)}`}</option>)}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t.common.from}</span>
          <Input type="date" name="from" defaultValue={p.from} dir="ltr" className="w-48" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t.common.to}</span>
          <Input type="date" name="to" defaultValue={p.to} dir="ltr" className="w-48" />
        </label>
        <Button type="submit" variant="outline">{tr("عرض الكشف")}</Button>
      </form>
      {ready
        ? <ReportView report={toPlainReport(table, locale)} from={p.from} to={p.to} actions={<ExportButtons report="account-statement" query={reportQuery(p)} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />} />
        : <p className="rounded-xl border border-line bg-white p-8 text-center text-slate-500">{tr("اختر حسابًا أو مركز تكلفة، وحدد الفترة، ثم اضغط عرض الكشف.")}</p>}
    </>
  );
}
