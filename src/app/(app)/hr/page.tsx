import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { AlertTriangle, CalendarOff, IdCard, UserX, Wallet } from "lucide-react";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney } from "@/lib/accounting/money";
import { CONTRACT_TYPES, END_REASONS } from "@/lib/hr/labels";
import { listDepartments } from "@/services/accounts.service";
import { attendanceOn, expiryAlerts, getHrSettings, listEmployees, listShifts } from "@/services/hr.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { saveEmployeeAction } from "./actions";
import { employeeFields, employeeInitial } from "./forms";

/** الموظفون: النشطون ومن انتهت خدمتهم، مع تنبيهات الوثائق والعقود وأرقام اليوم */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const ended = sp.status === "terminated";
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [all, departments, shifts, settings, day] = await Promise.all([
    listEmployees(ctx.supabase, ctx.hotel.id, { includeTerminated: true }),
    listDepartments(ctx.supabase, ctx.hotel.id),
    listShifts(ctx.supabase, ctx.hotel.id),
    getHrSettings(ctx.supabase, ctx.hotel.id),
    attendanceOn(ctx.supabase, ctx.hotel.id, today),
  ]);
  const active = all.filter((e) => e.status === "active");
  const shown = ended ? all.filter((e) => e.status === "terminated") : active;
  const alerts = expiryAlerts(active, today, settings.expiry_alert_days);
  const canManage = ctx.can(PERMISSIONS.hrManage);
  const deptOptions = departments.filter((d) => d.is_active).map((d) => ({ id: d.id, label: `${d.code} ${localNameOf(d)}` }));
  const shiftOptions = shifts.filter((s) => s.is_active).map((s) => ({ id: s.id, label: tr("{0}، {1} إلى {2}", s.name, s.start_time.slice(0, 5), s.end_time.slice(0, 5)) }));

  return (
    <>
      <PageHeader title={t.nav.employees} actions={canManage && (
        <FormDialog label={tr("موظف جديد")} title={tr("موظف جديد")} width="lg">
          <SimpleForm columns={2} submitLabel={tr("حفظ الموظف")} errors={t.errors} action={saveEmployeeAction}
            initial={employeeInitial(undefined, { department_id: departments.find((d) => d.code === "ADMIN")?.id, today })}
            fields={employeeFields(deptOptions, shiftOptions)} />
        </FormDialog>
      )} />

      <StatGrid>
        <Stat icon={IdCard} tone="ink" label={tr("الموظفون النشطون")} value={<span className="num">{active.length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="teal" label={tr("الرواتب الأساسية")} value={<Money value={sumMoney(active.map((e) => e.basic_salary))} locale={locale} />} />
        <Stat icon={CalendarOff} tone="clay" label={tr("في إجازة اليوم")} value={<span className="num">{day.onLeave.size}</span>} />
        <Stat icon={UserX} tone="neutral" label={tr("غياب اليوم")} value={<span className="num">{day.attendance.filter((a) => a.status === "absent").length}</span>} />
      </StatGrid>

      {alerts.length > 0 && !ended && (
        <Card className="mb-6 overflow-hidden">
          <CardHeader><CardTitle><AlertTriangle className="size-5 text-amber" />{tr("وثائق وعقود تحتاج تجديد")}</CardTitle></CardHeader>
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li key={`${a.employee.id}-${a.kind}`} className="flex items-center gap-4 px-6 py-3 text-[16px]">
                <Link href={`/hr/${a.employee.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:text-action">{a.employee.full_name}</Link>
                <span className="text-slate-600">{a.kind === "id" ? tr("انتهاء الهوية") : tr("نهاية العقد")}</span>
                <span className="num w-28 text-end text-slate-600">{a.date}</span>
                <Badge variant={a.expired ? "destructive" : "warning"}>{a.expired ? tr("منتهية") : tr("قريبًا")}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <FilterTabs className="mb-4" active={ended ? "terminated" : "active"} items={[
        { key: "active", href: "/hr", label: tr("النشطون"), count: active.length },
        { key: "terminated", href: "/hr?status=terminated", label: tr("انتهت خدمتهم"), count: all.length - active.length },
      ]} />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{tr("الموظف")}</TableHead><TableHead>{tr("الرمز")}</TableHead><TableHead>{tr("القسم")}</TableHead>
            <TableHead>{ended ? tr("نهاية الخدمة") : tr("الوردية")}</TableHead><TableHead>{tr("التعيين")}</TableHead><TableHead>{tr("العقد")}</TableHead>
            <TableHead className="text-end">{tr("الراتب الأساسي")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow><TableCell colSpan={7}>
                <EmptyState icon={IdCard} title={ended ? tr("لا موظفين انتهت خدمتهم") : tr("لا موظفين بعد")}
                  description={ended ? tr("يظهر هنا من أُنهيت خدمته بتسوية نهائية.") : tr("أضف أول موظف لتبدأ تسجيل الحضور والإجازات والرواتب.")} />
              </TableCell></TableRow>
            )}
            {shown.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="cell-fluid"><EntityCell name={e.full_name} sub={e.job_title ?? undefined} href={`/hr/${e.id}`} /></TableCell>
                <TableCell className="num text-slate-500">{e.code}</TableCell>
                <TableCell className="whitespace-nowrap">{localNameOf(e.department)}</TableCell>
                <TableCell className="whitespace-nowrap">{ended
                  ? <>{END_REASONS[e.termination_reason ?? ""]} <span className="num text-slate-500">{e.termination_date}</span></>
                  : (e.shift ? tr(e.shift.name) : null) ?? <span className="text-slate-400">{tr("بلا وردية")}</span>}</TableCell>
                <TableCell className="num">{e.hire_date}</TableCell>
                <TableCell>{CONTRACT_TYPES[e.contract_type]}</TableCell>
                <TableCell className="text-end"><Money value={e.basic_salary} locale={locale} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
