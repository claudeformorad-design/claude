import { Calculator, Users, Wallet } from "lucide-react";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityCell } from "@/components/ui/entity";
import { Input } from "@/components/ui/input";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { minutesText } from "@/lib/hr/labels";
import { payrollPreview, type PayrollLine } from "@/services/hr.service";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { runPayrollAction } from "../actions";

const net = (l: PayrollLine) => l.basic + l.allowances + l.overtime - l.deductions - l.insurance_employee - l.advance_recovery;

/** سبب الخصومات في سطر واحد هادئ تحت اسم الموظف */
function why(l: PayrollLine): string {
  const d = l.details;
  return [
    d.days < d.month_days && `${d.days} يومًا من ${d.month_days}`,
    d.absent_days > 0 && `غياب ${d.absent_days} يوم`,
    d.late > 0 && `تأخير ${minutesText(d.late_minutes)}`,
    d.unpaid_leave_days > 0 && `بدون راتب ${d.unpaid_leave_days} يوم`,
    d.penalties > 0 && "جزاء",
    d.overtime_minutes > 0 && `إضافي ${minutesText(d.overtime_minutes)}`,
  ].filter(Boolean).join("، ");
}

/** مسيّر الموظفين: يُحسب من بياناتهم لشهر، ويُرحَّل مرة واحدة بقيد الرواتب وخصم السلف ومخصص نهاية الخدمة */
export default async function HrPayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayInTimeZone(ctx.hotel.timezone).slice(0, 7);
  const run = await ctx.supabase.from("payroll_runs").select("id, run_number, posting_date, journal_entry_id, from_hr, total_net::text")
    .eq("hotel_id", ctx.hotel.id).eq("period_month", `${month}-01`).maybeSingle();
  raise(run.error);

  let lines: PayrollLine[];
  if (run.data) {
    const { data, error } = await ctx.supabase.from("payroll_lines")
      .select("employee_id, employee_name, employee_code, department_id, basic::text, allowances::text, overtime::text, deductions::text, insurance_employee::text, insurance_employer::text, advance_recovery::text, details")
      .eq("run_id", run.data.id).order("employee_code");
    raise(error);
    lines = ((data ?? []) as unknown as PayrollLine[]).map((l) => ({
      ...l, basic: Number(l.basic), allowances: Number(l.allowances), overtime: Number(l.overtime), deductions: Number(l.deductions),
      insurance_employee: Number(l.insurance_employee), insurance_employer: Number(l.insurance_employer), advance_recovery: Number(l.advance_recovery),
      details: l.details ?? { days: 0, month_days: 0, allowances: [], overtime_minutes: 0, absent_days: 0, absence: 0, late_minutes: 0, late: 0, unpaid_leave_days: 0, unpaid_leave: 0, penalties: 0, component_deductions: 0, advances: [] },
    }));
  } else {
    lines = await payrollPreview(ctx.supabase, ctx.hotel.id, `${month}-01`);
  }
  const sum = (k: (l: PayrollLine) => number) => lines.reduce((a, l) => a + k(l), 0);
  const canRun = !run.data && lines.length > 0 && ctx.can(PERMISSIONS.hrManage) && ctx.can(PERMISSIONS.payrollManage);

  return (
    <>
      <PageHeader title={t.nav.hrPayroll} actions={
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex items-center gap-2">
            <Input type="month" name="month" defaultValue={month} aria-label="الشهر" className="w-48" />
            <Button type="submit" variant="outline">عرض</Button>
          </form>
          {canRun && (
            <ActionButton variant="default" size="default" label="ترحيل المسيّر" done="رُحّل المسيّر وقيوده" errors={t.errors}
              confirmText={`ترحيل مسيّر ${month}؟ يُقيَّد صافي الرواتب مستحقًا، وتُخصم أقساط السلف والجزاءات، ويُسوّى مخصص نهاية الخدمة.`}
              run={runPayrollAction.bind(null, month)} />
          )}
        </div>
      } />

      {run.data ? (
        <Alert variant="success" className="mb-6">
          مسيّر هذا الشهر مرحّل برقم <span className="num">{run.data.run_number}</span> بتاريخ <span className="num">{run.data.posting_date}</span>
          {run.data.journal_entry_id && <>، <Link href={`/journal/${run.data.journal_entry_id}`} className="text-action">عرض القيد</Link></>}
          {!run.data.from_hr && "، وأُدخل يدويًا من صفحة الرواتب"}
        </Alert>
      ) : lines.length > 0 && (
        <p className="mb-6 text-[16px] leading-relaxed text-slate-600">
          معاينة محسوبة من الحضور والإجازات والجزاءات والسلف حتى الآن. تتغير بتغير البيانات حتى تُرحّل، وبعد الترحيل لا تتكرر لنفس الشهر.
        </p>
      )}

      <StatGrid className="lg:grid-cols-3">
        <Stat icon={Users} tone="ink" label="الموظفون في المسيّر" value={<span className="num">{lines.length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Calculator} tone="teal" label="إجمالي المستحق" value={<Money value={sum((l) => l.basic + l.allowances + l.overtime)} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="clay" label="صافي الرواتب" value={<Money value={sum(net)} locale={locale} />} />
      </StatGrid>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>الموظف</TableHead><TableHead className="text-end">الأساسي</TableHead><TableHead className="text-end">البدلات</TableHead>
            <TableHead className="text-end">الإضافي</TableHead><TableHead className="text-end">الخصومات</TableHead><TableHead className="text-end">التأمين</TableHead>
            <TableHead className="text-end">السلفة</TableHead><TableHead className="text-end">الصافي</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.length === 0 && <TableRow><TableCell colSpan={8}><EmptyState icon={Calculator} title="لا موظفين في هذا الشهر" description="يظهر المسيّر بعد إضافة الموظفين النشطين." actionHref="/hr" actionLabel="الموظفون" /></TableCell></TableRow>}
            {lines.map((l) => (
              <TableRow key={l.employee_id ?? l.employee_code}>
                <TableCell className="cell-fluid"><EntityCell name={l.employee_name} sub={why(l) || undefined} href={l.employee_id ? `/hr/${l.employee_id}` : undefined} /></TableCell>
                <TableCell className="text-end"><Money value={l.basic} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={l.allowances} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={l.overtime} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end text-urgent"><Money value={l.deductions} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={l.insurance_employee} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={l.advance_recovery} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end font-semibold text-ink"><Money value={net(l)} locale={locale} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          {lines.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell>الإجمالي{run.data && <Badge variant="success" className="ms-2">مرحّل</Badge>}</TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.basic)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.allowances)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.overtime)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.deductions)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.insurance_employee)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum((l) => l.advance_recovery)} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={sum(net)} locale={locale} /></TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>
    </>
  );
}
