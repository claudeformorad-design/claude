import { CalendarCheck, Hourglass, Plane } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { LEAVE_STATUS } from "@/lib/hr/labels";
import { listEmployees, listLeaves, listLeaveTypes } from "@/services/hr.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { SimpleForm } from "../../_assets/simple-form";
import { decideLeaveAction, saveLeaveAction } from "../actions";
import { leaveFields } from "../forms";

type Tab = "pending" | "approved" | "all";

/** الإجازات: الطلبات بانتظار القرار أولًا، والمعتمدة، والكل */
export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [leaves, employees, types] = await Promise.all([
    listLeaves(ctx.supabase, ctx.hotel.id), listEmployees(ctx.supabase, ctx.hotel.id), listLeaveTypes(ctx.supabase, ctx.hotel.id),
  ]);
  const pending = leaves.filter((l) => l.status === "pending");
  const tab: Tab = sp.tab === "approved" || sp.tab === "all" ? sp.tab : pending.length ? "pending" : "approved";
  const shown = tab === "all" ? leaves : leaves.filter((l) => l.status === tab);
  const onLeaveToday = leaves.filter((l) => l.status === "approved" && l.start_date <= today && l.end_date >= today);
  const canManage = ctx.can(PERMISSIONS.hrManage);
  const typeOptions = types.filter((x) => x.is_active).map((x) => ({ id: x.id, label: x.name }));

  return (
    <>
      <PageHeader title={t.nav.leaves} actions={canManage && employees.length > 0 && (
        <FormDialog label="إجازة جديدة" title="إجازة جديدة">
          <SimpleForm columns={2} submitLabel="حفظ الإجازة" errors={t.errors} action={saveLeaveAction}
            initial={{ employee_id: employees[0]!.id, leave_type_id: typeOptions[0]?.id ?? "", start_date: today, end_date: today, reason: "", approve: true }}
            fields={leaveFields(typeOptions, employees.map((e) => ({ id: e.id, label: `${e.code} ${e.full_name}` })))} />
        </FormDialog>
      )} />

      <StatGrid className="lg:grid-cols-3">
        <Stat icon={Hourglass} tone="clay" label="بانتظار القرار" value={<span className="num">{pending.length}</span>} />
        <Stat icon={Plane} tone="teal" label="في إجازة اليوم" value={<span className="num">{onLeaveToday.length}</span>} />
        <Stat icon={CalendarCheck} tone="neutral" label="إجازات معتمدة هذا العام"
          value={<span className="num">{leaves.filter((l) => l.status === "approved" && l.start_date.startsWith(today.slice(0, 4))).length}</span>} />
      </StatGrid>

      <FilterTabs className="mb-4" active={tab} items={[
        { key: "pending", href: "/hr/leaves?tab=pending", label: "بانتظار القرار", count: pending.length },
        { key: "approved", href: "/hr/leaves?tab=approved", label: "المعتمدة" },
        { key: "all", href: "/hr/leaves?tab=all", label: "الكل", count: leaves.length },
      ]} />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>الموظف</TableHead><TableHead>النوع</TableHead><TableHead>الفترة</TableHead><TableHead>الأيام</TableHead><TableHead>السبب</TableHead><TableHead className="text-end">الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState icon={Plane} title="لا إجازات هنا" description="الإجازات المسجلة تظهر في هذه القائمة حسب حالتها." /></TableCell></TableRow>}
            {shown.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap"><EntityCell name={l.employee?.full_name ?? ""} href={`/hr/${l.employee_id}`} /></TableCell>
                <TableCell className="whitespace-nowrap">{l.leave_type?.name}{l.leave_type && !l.leave_type.paid && !l.leave_type.name.includes("بدون راتب") && <span className="text-slate-500"> بدون راتب</span>}</TableCell>
                <TableCell className="whitespace-nowrap"><span className="num">{l.start_date}</span> إلى <span className="num">{l.end_date}</span></TableCell>
                <TableCell className="num">{Number(l.days)}</TableCell>
                <TableCell className="cell-fluid text-slate-600">{l.reason}</TableCell>
                <TableCell className="text-end">
                  {canManage && l.status === "pending" ? (
                    <span className="inline-flex gap-1.5">
                      <ActionButton label="اعتماد" done="اعتُمدت الإجازة" errors={t.errors} run={decideLeaveAction.bind(null, l.id, "approved")} />
                      <ActionButton label="رفض" done="رُفضت الإجازة" variant="ghost" errors={t.errors} run={decideLeaveAction.bind(null, l.id, "rejected")} />
                    </span>
                  ) : canManage && l.status === "approved" && l.start_date > today ? (
                    <ActionButton label="إلغاء" done="أُلغيت الإجازة" variant="ghost" errors={t.errors} confirmText="إلغاء هذه الإجازة المعتمدة؟"
                      run={decideLeaveAction.bind(null, l.id, "cancelled")} />
                  ) : <Badge variant={LEAVE_STATUS[l.status]!.tone}>{LEAVE_STATUS[l.status]!.label}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
