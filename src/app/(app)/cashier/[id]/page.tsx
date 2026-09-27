import { forbidden, notFound } from "next/navigation";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
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
        title={`الوردية ${s.shift_number}`}
        description={`${s.user_name || "—"} — فُتحت ${formatDateTime(s.opened_at, ctx.hotel.timezone)}${s.closed_at ? ` وأُغلقت ${formatDateTime(s.closed_at, ctx.hotel.timezone)}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {s.status === "open" ? <Badge variant="success" className="text-[16px]">مفتوحة</Badge> : <Badge variant="secondary" className="text-[16px]">مغلقة</Badge>}
            <Button asChild variant="outline" size="sm"><Link href="/cashier">الصندوق</Link></Button>
          </div>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <ShiftReportView report={report} locale={locale} timezone={ctx.hotel.timezone} canViewFolio={ctx.can(PERMISSIONS.folioView)} />
        </div>
        <div className="space-y-6">
          {s.status === "closed" && (
            <Card>
              <CardHeader><CardTitle>نتيجة الإغلاق</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-[16px]">
                <div className="flex items-center justify-between rounded-lg bg-panel p-3">
                  <span className="text-slate-600">{diffBase < 0 ? "عجز" : diffBase > 0 ? "زيادة" : "الفرق"}</span>
                  <Money value={Math.abs(diffBase)} locale={locale} className={diffBase < 0 ? "text-[20px] font-bold text-urgent" : "text-[20px] font-bold text-ink"} />
                </div>
                {s.over_short_entry_id && ctx.can(PERMISSIONS.journalView) && (
                  <Link href={`/journal/${s.over_short_entry_id}`} className="block text-action hover:underline">عرض قيد الفروقات</Link>
                )}
                {s.closing_note && <p className="text-slate-600">{s.closing_note}</p>}
              </CardContent>
            </Card>
          )}
          {canClose && (
            <Card className="border-ink/20">
              <CardHeader><CardTitle>إغلاق الوردية</CardTitle></CardHeader>
              <CardContent>
                <CloseShiftForm shiftId={s.id} errors={t.errors} supervisor={!s.is_mine}
                  lines={report.methods.map((m) => ({ payment_method_id: m.payment_method_id, name: m.name, kind: m.kind, currency_code: m.currency_code, expected: Number(m.expected) }))} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
