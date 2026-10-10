import { tr } from "@/i18n/tr";
import { FormDialog } from "@/components/ui/dialog";
import { forbidden } from "next/navigation";
import Link from "@/components/link";
import { Banknote, Clock, Coins, LockKeyhole, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { localNameOf } from "@/lib/local-name";
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
  const [shifts, methods] = await Promise.all([listShifts(ctx.supabase, ctx.hotel.id), listPaymentMethods(ctx.supabase, ctx.hotel.id)]);
  // الصندوق الرئيسي يأخذ العهدة الأساسية؛ وبقية الصناديق النقدية لكل منها عهدتها بعملتها
  const cashBoxes = methods.filter((m) => m.is_active && m.kind === "cash");
  const mainBox = cashBoxes.filter((m) => !m.currency_code).sort((a, b) => Number(b.code === "CASH") - Number(a.code === "CASH") || a.code.localeCompare(b.code))[0];
  const otherBoxes = cashBoxes.filter((m) => m.id !== mainBox?.id).map((m) => ({ id: m.id, name: localNameOf(m), currency: m.currency_code ?? ctx.hotel.base_currency }));
  const open = shifts.find((s) => s.status === "open" && s.user_id === ctx.user.id);
  const report = open ? await shiftReport(ctx.supabase, open.id) : null;
  const othersOpen = shifts.filter((s) => s.status === "open" && s.user_id !== ctx.user.id);
  const cashExpected = report?.methods.filter((m) => m.kind === "cash" && !m.foreign).reduce((a, m) => a + Number(m.expected), 0) ?? 0;
  // المتوقع في صناديق العملات الأخرى، كل عملة لحالها
  const foreignExpected = new Map<string, number>();
  for (const m of report?.methods ?? []) if (m.kind === "cash" && m.foreign) foreignExpected.set(m.currency_code, (foreignExpected.get(m.currency_code) ?? 0) + Number(m.expected));

  return (
    <>
      <PageHeader
        title={tr("الصندوق")}
        actions={
          <>
            {ctx.can(PERMISSIONS.cashReportView) && (
              <Button asChild variant="outline"><Link href="/reports/cash-by-currency"><Coins className="size-4" />{tr("النقدية بالعملات")}</Link></Button>
            )}
            {mine && !open && (
              <FormDialog label={tr("فتح وردية")} title={tr("فتح وردية")} description={tr("استلم الصندوق وسجّل العهدة الموجودة فيه")} width="sm">
                <OpenShiftForm errors={t.errors} currency={ctx.hotel.base_currency} boxes={otherBoxes} />
              </FormDialog>
            )}
            {open && report && (
              <FormDialog label={tr("إغلاق الوردية")} title={tr("إغلاق الوردية")} description={tr("عُدّ النقد في كل صندوق بعملته")} variant="dark" icon={false}>
                <CloseShiftForm shiftId={open.id} errors={t.errors}
                  lines={report.methods.map((m) => ({ payment_method_id: m.payment_method_id, name: m.name, kind: m.kind, currency_code: m.currency_code, expected: Number(m.expected) }))} />
              </FormDialog>
            )}
          </>
        }
      />

      {report && open && (
        <StatGrid>
          <Stat icon={Clock} tone="ink" label={tr("الوردية")} value={<span className="num">{open.shift_number}</span>} hint={<>{tr("منذ")}{" "}<span className="num">{formatDateTime(open.opened_at, ctx.hotel.timezone)}</span></>} />
          <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="teal" label={tr("العهدة")} value={<Money value={open.opening_float} locale={locale} />} />
          <Stat currency={ctx.hotel.base_currency} icon={Banknote} tone="clay" label={tr("النقد المتوقع")} value={<Money value={cashExpected} locale={locale} />}
            hint={foreignExpected.size > 0 ? <span className="num">{[...foreignExpected].map(([c, v]) => `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`).join("، ")}</span> : undefined} />
          <Stat icon={LockKeyhole} tone="neutral" label={tr("الحركات")} value={<span className="num">{report.transactions.length}</span>} />
        </StatGrid>
      )}

      <div className={`grid items-start gap-6 ${supervisor && othersOpen.length > 0 ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <div className="space-y-6">
          {report && <ShiftReportView report={report} locale={locale} timezone={ctx.hotel.timezone} canViewFolio={ctx.can(PERMISSIONS.folioView)} />}

          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("سجل الورديات")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("الوردية")}</TableHead><TableHead>{tr("الموظف")}</TableHead><TableHead>{tr("الفتح")}</TableHead><TableHead>{tr("الإغلاق")}</TableHead><TableHead>{tr("الحالة")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {shifts.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">{tr("لم تُفتح ورديات بعد")}</TableCell></TableRow>}
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Link href={`/cashier/${s.id}`} className="num font-semibold text-action">{s.shift_number}</Link></TableCell>
                    <TableCell>{s.user_name || ""}</TableCell>
                    <TableCell className="num whitespace-nowrap">{formatDateTime(s.opened_at, ctx.hotel.timezone)}</TableCell>
                    <TableCell className="num whitespace-nowrap">{s.closed_at ? formatDateTime(s.closed_at, ctx.hotel.timezone) : ""}</TableCell>
                    <TableCell>
                      {s.status === "open" ? <Badge variant="success">{tr("مفتوحة")}</Badge> : <Badge variant="secondary">{tr("مغلقة")}</Badge>}
                      {s.over_short_entry_id && <Badge variant="warning" className="ms-2">{tr("فروقات")}</Badge>}
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
              <CardHeader><CardTitle>{tr("ورديات مفتوحة لموظفين آخرين")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {othersOpen.map((s) => (
                  <Link key={s.id} href={`/cashier/${s.id}`} className="flex items-center justify-between rounded-lg border border-line p-3 hover:bg-panel">
                    <span><span className="font-semibold text-ink">{s.user_name || ""}</span><span className="num block text-[13.5px] text-slate-500">{s.shift_number}</span></span>
                    <Badge variant="success">{tr("مفتوحة")}</Badge>
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
