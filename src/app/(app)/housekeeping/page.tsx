import { CheckCircle2, Clock, Sparkles, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { HOUSEKEEPING, HOUSEKEEPING_KIND, HOUSEKEEPING_TASK_STATUS } from "@/lib/pms/labels";
import { listRooms } from "@/services/pms.service";
import { listHousekeepingTasks } from "@/services/operations.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { addHousekeepingTaskAction } from "../_ops/actions";
import { GenerateButton, TaskControls } from "./task-controls";

type Tab = "open" | "done" | "all";

/**
 * التدبير الفندقي: مهام اليوم لكل غرفة (تنظيف مغادرة، إقامة مستمرة، فحص، صيانة) وإسنادها للعاملين.
 * إنجاز التنظيف يجعل الغرفة «نظيفة» فتصبح جاهزة للتسكين، والصيانة تُخرج الغرفة من الخدمة حتى إنجازها.
 */
export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsHousekeeping);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [tasks, rooms] = await Promise.all([listHousekeepingTasks(ctx.supabase, ctx.hotel.id, today), listRooms(ctx.supabase, ctx.hotel.id)]);
  const room = new Map(rooms.map((r) => [r.id, r]));
  const tab: Tab = sp.tab === "done" || sp.tab === "all" ? sp.tab : "open";
  const open = tasks.filter((x) => x.status === "pending" || x.status === "in_progress");
  const shown = tab === "open" ? open : tab === "done" ? tasks.filter((x) => x.status === "done") : tasks;

  return (
    <>
      <PageHeader title="التدبير الفندقي" description="مهام تنظيف الغرف وفحصها وصيانتها لليوم" actions={<GenerateButton date={today} errors={t.errors} />} />
      <StatGrid>
        <Stat icon={Clock} tone="ink" label="مهام مفتوحة" value={<span className="num">{open.length}</span>} />
        <Stat icon={Sparkles} tone="clay" label="قيد التنفيذ" value={<span className="num">{tasks.filter((x) => x.status === "in_progress").length}</span>} />
        <Stat icon={CheckCircle2} tone="teal" label="أُنجزت اليوم" value={<span className="num">{tasks.filter((x) => x.status === "done").length}</span>} />
        <Stat icon={Wrench} tone="neutral" label="غرف تحتاج تنظيف" value={<span className="num">{rooms.filter((r) => r.is_active && r.housekeeping_status === "dirty").length}</span>} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <FilterTabs active={tab} items={[
              { key: "open", href: "/housekeeping", label: "المفتوحة", count: open.length },
              { key: "done", href: "/housekeeping?tab=done", label: "المنجزة" },
              { key: "all", href: "/housekeeping?tab=all", label: "الكل", count: tasks.length },
            ]} />
          </CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>الغرفة</TableHead><TableHead>المهمة</TableHead><TableHead>الحالة</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={4} className="py-10 text-center text-slate-500">{tab === "open" ? "لا مهام مفتوحة — اضغط «توليد مهام اليوم»" : "لا مهام"}</TableCell></TableRow>}
              {shown.map((x) => {
                const r = room.get(x.room_id);
                const hk = r ? HOUSEKEEPING[r.housekeeping_status] : null;
                return (
                  <TableRow key={x.id}>
                    <TableCell className="whitespace-nowrap"><span className="num text-[18px] font-bold">{r?.room_number}</span>{hk && <Badge variant={hk.variant} className="ms-2">{hk.label}</Badge>}</TableCell>
                    <TableCell className="cell-fluid">
                      <span className="font-medium text-ink">{HOUSEKEEPING_KIND[x.kind]}</span>{x.priority === 1 && <Badge variant="destructive" className="ms-2">عاجل</Badge>}
                      {(x.notes || x.assignee) && <span className="block text-[14px] text-slate-500">{[x.assignee, x.notes].filter(Boolean).join(" · ")}</span>}
                    </TableCell>
                    <TableCell><Badge variant={HOUSEKEEPING_TASK_STATUS[x.status].variant}>{HOUSEKEEPING_TASK_STATUS[x.status].label}</Badge></TableCell>
                    <TableCell className="text-end"><TaskControls taskId={x.id} status={x.status} assignee={x.assignee} errors={t.errors} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>مهمة جديدة</CardTitle></CardHeader>
          <CardContent>
            <SimpleForm columns={1} submitLabel="إضافة المهمة" errors={t.errors} action={addHousekeepingTaskAction}
              initial={{ room_id: rooms.find((r) => r.is_active)?.id ?? "", kind: "maintenance", date: today, notes: "", assignee: "", out_of_service: false }}
              fields={[
                { name: "room_id", label: "الغرفة", options: rooms.filter((r) => r.is_active).map((r) => ({ id: r.id, label: r.room_number })) },
                { name: "kind", label: "النوع", options: Object.entries(HOUSEKEEPING_KIND).map(([id, label]) => ({ id, label })) },
                { name: "notes", label: "الوصف (إلزامي للصيانة)" },
                { name: "assignee", label: "العامل (اختياري)" },
                { name: "date", label: "التاريخ", type: "date" },
                { name: "out_of_service", label: "إخراج الغرفة من الخدمة حتى الإنجاز", checkbox: true },
              ]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
