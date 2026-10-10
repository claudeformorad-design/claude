import { tr } from "@/i18n/tr";
import { FormDialog } from "@/components/ui/dialog";
import { forbidden, notFound } from "next/navigation";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { PrintButton } from "../../invoices/[id]/print-button";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { shiftReport } from "@/services/cashier.service";
import { getI18n } from "@/i18n/server";
import { ShiftReportView } from "../report-view";
import { CloseShiftForm } from "../shift-forms";

/** تقرير وردية كاشير: الصناديق والفروق وكل حركاتها، مع إغلاقها من المشرف إن كانت مفتوحة */
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext();
  if (!ctx.can(PERMISSIONS.cashierShifts) && !ctx.can(PERMISSIONS.cashierShiftsManage)) forbidden();
  const { locale, t } = await getI18n();
  const report = await shiftReport(ctx.supabase, id);
  if (!report) notFound();
  const s = report.shift;
  const diffBase = report.methods.reduce((a, m) => a + Number(m.difference_base ?? 0), 0);
  const canClose = s.status === "open" && (s.is_mine || ctx.can(PERMISSIONS.cashierShiftsManage));

  return (
    <>
      <PageHeader
        title={tr("الوردية {0}", s.shift_number)}
        actions={
          <div className="flex items-center gap-2">
            {s.status === "open" ? <Badge variant="success" className="text-[16px]">{tr("مفتوحة")}</Badge> : <Badge variant="secondary" className="text-[16px]">{tr("مغلقة")}</Badge>}
            <Button asChild variant="outline" size="sm" className="print:hidden"><Link href="/cashier">{tr("الصندوق")}</Link></Button>
            <PrintButton label={tr("طباعة")} />
            {canClose && (
              <FormDialog label={tr("إغلاق الوردية")} title={tr("إغلاق الوردية")} description={tr("عُدّ النقد في كل صندوق بعملته")} variant="dark" size="sm" icon={false} className="print:hidden">
                <CloseShiftForm shiftId={s.id} errors={t.errors} supervisor={!s.is_mine}
                  lines={report.methods.map((m) => ({ payment_method_id: m.payment_method_id, name: m.name, kind: m.kind, currency_code: m.currency_code, expected: Number(m.expected) }))} />
              </FormDialog>
            )}
          </div>
        }
      />
      <Properties items={[
        [tr("الكاشير"), s.user_name],
        [tr("فُتحت"), <span key="o" className="num">{formatDateTime(s.opened_at, ctx.hotel.timezone)}</span>],
        [tr("أُغلقت"), s.closed_at && <span className="num">{formatDateTime(s.closed_at, ctx.hotel.timezone)}</span>],
      ]} />
      <div className={`grid items-start gap-6 ${s.status === "closed" ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <div className="space-y-6">
          <ShiftReportView report={report} locale={locale} timezone={ctx.hotel.timezone} canViewFolio={ctx.can(PERMISSIONS.folioView)} />
        </div>
        <div className="space-y-6">
          {s.status === "closed" && (
            <Card>
              <CardHeader><CardTitle>{tr("نتيجة الإغلاق")}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-[16px]">
                <div className="flex items-center justify-between rounded-lg bg-panel p-3">
                  <span className="text-slate-600">{diffBase < 0 ? tr("عجز") : diffBase > 0 ? tr("زيادة") : tr("الفرق")}</span>
                  <Money value={Math.abs(diffBase)} locale={locale} className={diffBase < 0 ? "text-[20px] font-bold text-urgent" : "text-[20px] font-bold text-ink"} />
                </div>
                {s.over_short_entry_id && ctx.can(PERMISSIONS.journalView) && (
                  <Link href={`/journal/${s.over_short_entry_id}`} className="block text-action">{tr("عرض قيد الفروقات")}</Link>
                )}
                {s.closing_note && <p className="text-slate-600">{s.closing_note}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
