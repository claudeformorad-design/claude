import { FormDialog } from "@/components/ui/dialog";
import { forbidden } from "next/navigation";
import Link from "@/components/link";
import { Banknote, Clock, LockKeyhole, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { listShifts, shiftReport } from "@/services/cashier.service";
import { getI18n } from "@/i18n/server";
import { ShiftReportView } from "./report-view";
import { CloseShiftForm, OpenShiftForm } from "./shift-forms";

/**
 * الصندوق: وردية الكاشير الحالية (العهدة، ما قُبض وما صُرف لكل صندوق وعملة) وإغلاقها بالعدّ،
 * وسجل الورديات. كل حركة نقدية على أي فوليو تُنسب تلقائيًا لوردية من سجّلها.
 */
export default async function CashierPage() {
  const ctx = await requireAppContext();
  const mine = ctx.can(PERMISSIONS.cashierShifts);
  const supervisor = ctx.can(PERMISSIONS.cashierShiftsManage);
  if (!mine && !supervisor) forbidden();
  const { locale, t } = await getI18n();
  const shifts = await listShifts(ctx.supabase, ctx.hotel.id);
  const open = shifts.find((s) => s.status === "open" && s.user_id === ctx.user.id);
  const report = open ? await shiftReport(ctx.supabase, open.id) : null;
  const othersOpen = shifts.filter((s) => s.status === "open" && s.user_id !== ctx.user.id);
  const cashExpected = report?.methods.filter((m) => m.kind === "cash" && !m.foreign).reduce((a, m) => a + Number(m.expected), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="الصندوق"
        actions={
          <>
            {mine && !open && (
              <FormDialog label="فتح وردية" title="فتح وردية" description="استلم الصندوق وسجّل العهدة الموجودة فيه" width="sm">
                <OpenShiftForm errors={t.errors} currency={ctx.hotel.base_currency} />
              </FormDialog>
            )}
            {open && report && (
              <FormDialog label="إغلاق الوردية" title="إغلاق الوردية" description="عُدّ النقد في كل صندوق بعملته" variant="dark" icon={false}>
                <CloseShiftForm shiftId={open.id} errors={t.errors}
                  lines={report.methods.map((m) => ({ payment_method_id: m.payment_method_id, name: m.name, kind: m.kind, currency_code: m.currency_code, expected: Number(m.expected) }))} />
              </FormDialog>
            )}
          </>
        }
      />

      {report && open && (
        <StatGrid>
          <Stat icon={Clock} tone="ink" label="الوردية" value={<span className="num">{open.shift_number}</span>} hint={<>منذ <span className="num">{formatDateTime(open.opened_at, ctx.hotel.timezone)}</span></>} />
          <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="teal" label="العهدة" value={<Money value={open.opening_float} locale={locale} />} />
          <Stat currency={ctx.hotel.base_currency} icon={Banknote} tone="clay" label="النقد المتوقع" value={<Money value={cashExpected} locale={locale} />} />
          <Stat icon={LockKeyhole} tone="neutral" label="الحركات" value={<span className="num">{report.transactions.length}</span>} />
        </StatGrid>
      )}

      <div className={`grid items-start gap-6 ${supervisor && othersOpen.length > 0 ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <div className="space-y-6">
          {report && <ShiftReportView report={report} locale={locale} timezone={ctx.hotel.timezone} canViewFolio={ctx.can(PERMISSIONS.folioView)} />}

          <Card className="overflow-hidden">
            <CardHeader><CardTitle>سجل الورديات</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>الوردية</TableHead><TableHead>الموظف</TableHead><TableHead>الفتح</TableHead><TableHead>الإغلاق</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>
                {shifts.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لم تُفتح ورديات بعد</TableCell></TableRow>}
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Link href={`/cashier/${s.id}`} className="num font-semibold text-action">{s.shift_number}</Link></TableCell>
                    <TableCell>{s.user_name || ""}</TableCell>
                    <TableCell className="num whitespace-nowrap">{formatDateTime(s.opened_at, ctx.hotel.timezone)}</TableCell>
                    <TableCell className="num whitespace-nowrap">{s.closed_at ? formatDateTime(s.closed_at, ctx.hotel.timezone) : ""}</TableCell>
                    <TableCell>
                      {s.status === "open" ? <Badge variant="success">مفتوحة</Badge> : <Badge variant="secondary">مغلقة</Badge>}
                      {s.over_short_entry_id && <Badge variant="warning" className="ms-2">فروقات</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          {supervisor && othersOpen.length > 0 && (
            <Card>
              <CardHeader><CardTitle>ورديات مفتوحة لموظفين آخرين</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {othersOpen.map((s) => (
                  <Link key={s.id} href={`/cashier/${s.id}`} className="flex items-center justify-between rounded-lg border border-line p-3 hover:bg-panel">
                    <span><span className="font-semibold text-ink">{s.user_name || ""}</span><span className="num block text-[13.5px] text-slate-500">{s.shift_number}</span></span>
                    <Badge variant="success">مفتوحة</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
