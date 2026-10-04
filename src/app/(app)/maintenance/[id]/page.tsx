import { tr } from "@/i18n/tr";
import { forbidden, notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { Properties } from "@/components/ui/properties";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { toMoney, ZERO } from "@/lib/accounting/money";
import { dayLabel } from "@/lib/pms/dates";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "@/lib/ops/labels";
import { listRooms } from "@/services/pms.service";
import { baseDecimals, getMaintenanceRequest, listMaintenanceAssets } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { addMaintenancePartAction, updateMaintenanceRequestAction } from "../../_services/actions";

/** بلاغ الصيانة: بياناته، تحديث حالته وإسناده، قطع الغيار، وإجمالي التكلفة */
export default async function MaintenanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext();
  if (!ctx.can(PERMISSIONS.maintenanceReport) && !ctx.can(PERMISSIONS.maintenanceManage)) forbidden();
  const { locale, t } = await getI18n();
  const d = await getMaintenanceRequest(ctx.supabase, ctx.hotel.id, id);
  if (!d) notFound();
  const { request: r, parts } = d;
  const canManage = ctx.can(PERMISSIONS.maintenanceManage);
  const isOpen = r.status === "open" || r.status === "in_progress" || r.status === "on_hold";
  const [rooms, assets, dec, items] = await Promise.all([
    listRooms(ctx.supabase, ctx.hotel.id),
    listMaintenanceAssets(ctx.supabase, ctx.hotel.id),
    baseDecimals(ctx.supabase, ctx.hotel.base_currency),
    canManage && isOpen && ctx.can(PERMISSIONS.inventoryView)
      ? ctx.supabase.from("inventory_items").select("id, sku, name_ar, quantity_on_hand::text").eq("hotel_id", ctx.hotel.id).eq("is_active", true).order("sku")
      : Promise.resolve({ data: [] as { id: string; sku: string; name_ar: string; quantity_on_hand: string }[] }),
  ]);
  const stock = (items.data ?? []) as unknown as { id: string; sku: string; name_ar: string; quantity_on_hand: string }[];
  const roomNo = rooms.find((x) => x.id === r.room_id)?.room_number;
  const asset = assets.find((x) => x.id === r.asset_id);
  const partsTotal = parts.reduce((s, p) => s.plus(toMoney(p.quantity).times(toMoney(p.unit_cost))), ZERO);
  const total = partsTotal.plus(toMoney(r.labor_cost));
  const tz = ctx.hotel.timezone;

  return (
    <>
      <PageHeader title={r.title} actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={MAINTENANCE_STATUS[r.status].variant}>{MAINTENANCE_STATUS[r.status].label}</Badge>
          {canManage && isOpen && (
            <>
              <FormDialog label={tr("تحديث البلاغ")} title={tr("تحديث البلاغ {0}", r.request_number)} variant="outline" icon={false} width="lg">
                <SimpleForm columns={2} submitLabel={tr("حفظ")} errors={t.errors} action={updateMaintenanceRequestAction.bind(null, r.id)}
                  initial={{ status: r.status, assignee: r.assignee ?? "", priority: r.priority, labor_cost: toMoney(r.labor_cost).isZero() ? "" : r.labor_cost, resolution: r.resolution ?? "" }}
                  fields={[
                    { name: "status", label: tr("الحالة"), options: Object.entries(MAINTENANCE_STATUS).map(([k, v]) => ({ id: k, label: v.label })) },
                    { name: "priority", label: tr("الأولوية"), options: Object.entries(MAINTENANCE_PRIORITY).map(([k, v]) => ({ id: k, label: v.label })) },
                    { name: "assignee", label: tr("الفني") },
                    { name: "labor_cost", label: tr("تكلفة العمل"), type: "number" },
                    { name: "resolution", label: tr("ما تم إنجازه، إلزامي عند الإنجاز") },
                  ]} />
              </FormDialog>
              <FormDialog label={tr("قطعة غيار")} title={tr("قطعة غيار للبلاغ {0}", r.request_number)} variant="outline">
                <SimpleForm columns={2} submitLabel={tr("إضافة")} errors={t.errors} action={addMaintenancePartAction.bind(null, r.id)}
                  initial={{ item_id: "", description: "", quantity: "1", unit_cost: "" }}
                  fields={[
                    ...(stock.length ? [{ name: "item_id", label: tr("من المخزون"), optional: true, options: stock.map((s) => ({ id: s.id, label: tr("{0} {1}، المتوفر {2}", s.sku, s.name_ar, Number(s.quantity_on_hand)) })) }] : []),
                    { name: "description", label: tr("الوصف إن لم تكن من المخزون") },
                    { name: "quantity", label: tr("الكمية"), type: "number" as const },
                    { name: "unit_cost", label: tr("تكلفة الوحدة، للقطع المشتراة مباشرة"), type: "number" as const },
                  ]} />
              </FormDialog>
            </>
          )}
        </div>
      } />

      <Properties items={[
        [tr("رقم البلاغ"), <span key="n" className="num">{r.request_number}</span>],
        [tr("الأولوية"), MAINTENANCE_PRIORITY[r.priority].label],
        [tr("الغرفة"), roomNo ? <span key="r" className="num">{roomNo}</span> : null],
        [tr("الموقع"), r.location],
        [tr("الجهاز"), asset ? asset.name : null],
        [tr("الفني"), r.assignee],
        [tr("وقت البلاغ"), <span key="t" className="num">{formatDateTime(r.reported_at, tz)}</span>],
        [tr("مطلوب قبل"), r.due_date ? dayLabel(r.due_date) : null],
        [tr("بدأ العمل"), r.started_at ? <span key="s" className="num">{formatDateTime(r.started_at, tz)}</span> : null],
        [tr("أُغلق"), r.completed_at ? <span key="c" className="num">{formatDateTime(r.completed_at, tz)}</span> : null],
        [tr("خارج الخدمة"), r.out_of_service ? (isOpen ? tr("الغرفة خارج الخدمة حتى الإصلاح") : tr("عادت الغرفة للخدمة")) : null],
      ]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{tr("التفاصيل")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-[15.5px]">
            <p className="whitespace-pre-line text-slate-700">{r.description || tr("لا توجد تفاصيل إضافية")}</p>
            {r.resolution && (
              <div className="border-s-2 border-line ps-3">
                <p className="text-slate-500">{tr("ما تم إنجازه")}</p>
                <p className="whitespace-pre-line font-medium text-ink">{r.resolution}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {canManage && (
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("التكلفة")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("البند")}</TableHead><TableHead className="text-end">{tr("الكمية")}</TableHead><TableHead className="text-end">{tr("التكلفة")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {parts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="cell-fluid">{p.description}{p.inventory_item_id && <Badge variant="outline" className="ms-2">{tr("من المخزون")}</Badge>}</TableCell>
                    <TableCell className="text-end num">{Number(p.quantity)}</TableCell>
                    <TableCell className="text-end"><Money value={toMoney(p.quantity).times(toMoney(p.unit_cost))} locale={locale} decimals={dec} /></TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="cell-fluid">{tr("تكلفة العمل")}</TableCell><TableCell />
                  <TableCell className="text-end"><Money value={r.labor_cost} locale={locale} decimals={dec} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="cell-fluid font-semibold">{tr("الإجمالي")}</TableCell><TableCell />
                  <TableCell className="text-end font-semibold"><Money value={total} locale={locale} decimals={dec} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
