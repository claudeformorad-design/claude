import { tr } from "@/i18n/tr";
import { forbidden } from "next/navigation";
import Link from "@/components/link";
import { CheckCircle2, Clock, Hammer, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "@/lib/ops/labels";
import { listRooms } from "@/services/pms.service";
import { listMaintenanceAssets, listMaintenanceRequests } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { createMaintenanceRequestAction } from "../_services/actions";

type Tab = "open" | "done" | "all";
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/**
 * الصيانة: بلاغات الأعطال للغرف والأجهزة والمرافق. البلاغ قد يُخرج الغرفة من الخدمة حتى إنجازه،
 * والفني يسجّل ما أنجزه وقطع الغيار وتكلفة العمل.
 */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext();
  if (!ctx.can(PERMISSIONS.maintenanceReport) && !ctx.can(PERMISSIONS.maintenanceManage)) forbidden();
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [requests, rooms, assets] = await Promise.all([
    listMaintenanceRequests(ctx.supabase, ctx.hotel.id), listRooms(ctx.supabase, ctx.hotel.id), listMaintenanceAssets(ctx.supabase, ctx.hotel.id),
  ]);
  const room = new Map(rooms.map((r) => [r.id, r.room_number]));
  const asset = new Map(assets.map((a) => [a.id, a.name]));
  const tab: Tab = sp.tab === "done" || sp.tab === "all" ? sp.tab : "open";
  const open = requests.filter((r) => r.status === "open" || r.status === "in_progress" || r.status === "on_hold")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.reported_at.localeCompare(b.reported_at));
  const closed = requests.filter((r) => r.status === "done" || r.status === "cancelled");
  const shown = tab === "open" ? open : tab === "done" ? closed : requests;
  const monthStart = `${today.slice(0, 7)}-01`;
  const doneThisMonth = requests.filter((r) => r.status === "done" && r.completed_at && formatDateTime(r.completed_at, ctx.hotel.timezone).slice(0, 10) >= monthStart);
  const canManage = ctx.can(PERMISSIONS.maintenanceManage);

  return (
    <>
      <PageHeader title={tr("الصيانة")} actions={
        <div className="flex gap-2">
          {canManage && <Button asChild variant="outline"><Link href="/maintenance/assets">{tr("سجل الأجهزة")}</Link></Button>}
          <FormDialog label={tr("بلاغ عطل")} title={tr("بلاغ عطل جديد")} width="lg">
            <SimpleForm columns={2} submitLabel={tr("إرسال البلاغ")} errors={t.errors} action={createMaintenanceRequestAction}
              initial={{ title: "", room_id: "", asset_id: "", location: "", priority: "normal", due_date: "", description: "", out_of_service: false }}
              fields={[
                { name: "title", label: tr("العطل") },
                { name: "priority", label: tr("الأولوية"), options: Object.entries(MAINTENANCE_PRIORITY).map(([id, v]) => ({ id, label: v.label })) },
                { name: "room_id", label: tr("الغرفة"), optional: true, options: rooms.filter((r) => r.is_active).map((r) => ({ id: r.id, label: r.room_number })) },
                { name: "asset_id", label: tr("الجهاز"), optional: true, options: assets.filter((a) => a.is_active).map((a) => ({ id: a.id, label: a.name })) },
                { name: "location", label: tr("الموقع إن لم يكن غرفة") },
                { name: "due_date", label: tr("مطلوب قبل"), type: "date" },
                { name: "description", label: tr("التفاصيل") },
                { name: "out_of_service", label: tr("إخراج الغرفة من الخدمة حتى الإصلاح"), checkbox: true },
              ]} />
          </FormDialog>
        </div>
      } />
      <StatGrid>
        <Stat icon={Clock} tone="ink" label={tr("بلاغات مفتوحة")} value={<span className="num">{open.length}</span>} />
        <Stat icon={Hammer} tone="clay" label={tr("عاجلة ومرتفعة")} value={<span className="num">{open.filter((r) => r.priority === "urgent" || r.priority === "high").length}</span>} />
        <Stat icon={Wrench} tone="neutral" label={tr("غرف خارج الخدمة بسببها")} value={<span className="num">{new Set(open.filter((r) => r.out_of_service && r.room_id).map((r) => r.room_id)).size}</span>} />
        <Stat icon={CheckCircle2} tone="teal" label={tr("أُنجزت هذا الشهر")} value={<span className="num">{doneThisMonth.length}</span>} />
      </StatGrid>

      <Card className="overflow-hidden">
        <CardHeader>
          <FilterTabs active={tab} items={[
            { key: "open", href: "/maintenance", label: tr("المفتوحة"), count: open.length },
            { key: "done", href: "/maintenance?tab=done", label: tr("المغلقة") },
            { key: "all", href: "/maintenance?tab=all", label: tr("الكل"), count: requests.length },
          ]} />
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow><TableHead>{tr("الرقم")}</TableHead><TableHead>{tr("العطل")}</TableHead><TableHead>{tr("المكان")}</TableHead><TableHead>{tr("الأولوية")}</TableHead><TableHead>{tr("الفني")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead>{tr("البلاغ")}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow><TableCell colSpan={7}><EmptyState icon={Wrench} title={tab === "open" ? tr("لا بلاغات مفتوحة") : tr("لا بلاغات")} description={tr("أي موظف يبلّغ عن عطل من هنا، والفني يتابعه حتى الإنجاز.")} /></TableCell></TableRow>
            )}
            {shown.map((r) => {
              const late = r.due_date && r.due_date < today && (r.status === "open" || r.status === "in_progress" || r.status === "on_hold");
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap"><Link href={`/maintenance/${r.id}`} className="num font-medium text-ink hover:underline">{r.request_number}</Link></TableCell>
                  <TableCell className="cell-fluid">
                    <Link href={`/maintenance/${r.id}`} className="font-medium text-ink hover:underline">{r.title}</Link>
                    {r.out_of_service && r.status !== "done" && r.status !== "cancelled" && <Badge variant="destructive" className="ms-2">{tr("الغرفة خارج الخدمة")}</Badge>}
                    {late && <Badge variant="warning" className="ms-2">{tr("متأخر")}</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.room_id ? <span className="num font-semibold">{room.get(r.room_id)}</span> : r.location}
                    {r.asset_id && <span className="block text-[14px] text-slate-500">{asset.get(r.asset_id)}</span>}
                  </TableCell>
                  <TableCell><Badge variant={MAINTENANCE_PRIORITY[r.priority].variant}>{MAINTENANCE_PRIORITY[r.priority].label}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">{r.assignee}</TableCell>
                  <TableCell><Badge variant={MAINTENANCE_STATUS[r.status].variant}>{MAINTENANCE_STATUS[r.status].label}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">{dayLabel(formatDateTime(r.reported_at, ctx.hotel.timezone).slice(0, 10))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
