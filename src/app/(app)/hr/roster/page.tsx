import { tr } from "@/i18n/tr";
import { CalendarClock } from "lucide-react";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { WEEKDAYS } from "@/lib/hr/labels";
import { getHrSettings, listEmployees, listShifts, rosterBetween } from "@/services/hr.service";
import { getI18n } from "@/i18n/server";
import { RosterGrid } from "./roster-grid";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** بداية الأسبوع يوم السبت */
const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7));

/** جدول الورديات الأسبوعي: من السبت إلى الجمعة */
export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const start = weekStart(sp.week && isIsoDate(sp.week) ? sp.week : todayInTimeZone(ctx.hotel.timezone));
  const end = addDays(start, 6);
  const [employees, shifts, settings, roster] = await Promise.all([
    listEmployees(ctx.supabase, ctx.hotel.id), listShifts(ctx.supabase, ctx.hotel.id),
    getHrSettings(ctx.supabase, ctx.hotel.id), rosterBetween(ctx.supabase, ctx.hotel.id, start, end),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, label: WEEKDAYS[dow]!, weekend: settings.weekend_days.includes(dow) };
  });
  const initial = Object.fromEntries(roster.map((r) => [`${r.employee_id}|${r.work_date}`, r.shift_id ?? "off"]));

  return (
    <>
      <PageHeader title={t.nav.roster} actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline"><Link href={`/hr/roster?week=${addDays(start, -7)}`}>{tr("الأسبوع السابق")}</Link></Button>
          <span className="rounded-lg bg-subtle px-3 py-2 text-[15.5px] text-slate-600">{tr("من")}{" "}<span className="num text-ink">{start}</span>{" "}{tr("إلى")}{" "}<span className="num text-ink">{end}</span></span>
          <Button asChild variant="outline"><Link href={`/hr/roster?week=${addDays(start, 7)}`}>{tr("الأسبوع التالي")}</Link></Button>
        </div>
      } />
      {employees.length === 0
        ? <EmptyState icon={CalendarClock} title={tr("لا موظفين بعد")} description={tr("أضف الموظفين ثم وزّع ورديات الأسبوع هنا.")} actionHref="/hr" actionLabel={tr("الموظفون")} />
        : <RosterGrid key={start} days={days} shifts={shifts.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name }))}
            employees={employees.map((e) => ({ id: e.id, name: e.full_name, defaultShift: e.shift_id }))}
            initial={initial} canEdit={ctx.can(PERMISSIONS.hrManage)} errors={t.errors} />}
    </>
  );
}
