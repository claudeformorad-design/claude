import { tr } from "@/i18n/tr";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { hhmm } from "@/lib/hr/labels";
import { attendanceOn, getHrSettings, listEmployees, listShifts } from "@/services/hr.service";
import { getI18n } from "@/i18n/server";
import { AttendanceSheet, type SheetRow } from "./attendance-sheet";

/** الحضور والانصراف اليدوي ليوم: الحالة من المسجل، ثم الإجازة المعتمدة، ثم الراحة من جدول الورديات أو العطلة الأسبوعية */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const day = sp.date && isIsoDate(sp.date) ? sp.date : today;
  const [employees, shifts, settings, info] = await Promise.all([
    listEmployees(ctx.supabase, ctx.hotel.id, { includeTerminated: true }),
    listShifts(ctx.supabase, ctx.hotel.id),
    getHrSettings(ctx.supabase, ctx.hotel.id),
    attendanceOn(ctx.supabase, ctx.hotel.id, day),
  ]);
  const shiftName = new Map(shifts.map((s) => [s.id, tr("{0} من {1} إلى {2}", s.name, hhmm(s.start_time), hhmm(s.end_time))]));
  const weekend = settings.weekend_days.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
  const byEmployee = new Map(info.attendance.map((a) => [a.employee_id, a]));
  const rows: SheetRow[] = employees
    .filter((e) => e.hire_date <= day && (!e.termination_date || e.termination_date >= day))
    .map((e) => {
      const a = byEmployee.get(e.id);
      const rostered = info.roster.has(e.id);
      const shiftId = rostered ? info.roster.get(e.id) : e.shift_id;
      const off = rostered ? !shiftId : weekend;
      const leave = info.onLeave.get(e.id) ?? null;
      return {
        employee_id: e.id, name: e.full_name, shift: shiftId ? shiftName.get(shiftId) ?? null : off ? tr("راحة") : null, leave,
        status: a?.status ?? (leave ? "leave" : off ? "off" : "present"),
        check_in: hhmm(a?.check_in), check_out: hhmm(a?.check_out), notes: a?.notes ?? "",
        late: a?.late_minutes ?? 0, overtime: a?.overtime_minutes ?? 0,
      };
    });

  return (
    <>
      <PageHeader title={t.nav.attendance} actions={
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={day} aria-label={tr("اليوم")} className="w-52" />
          <Button type="submit" variant="outline">{tr("عرض")}</Button>
        </form>
      } />
      {rows.length === 0
        ? <EmptyState icon={ClipboardCheck} title={tr("لا موظفين في هذا اليوم")} description={tr("أضف الموظفين من صفحة الموظفين أولًا.")} actionHref="/hr" actionLabel={tr("الموظفون")} />
        : <AttendanceSheet key={day} day={day} rows={rows} canEdit={ctx.can(PERMISSIONS.hrManage)} errors={t.errors} />}
    </>
  );
}
