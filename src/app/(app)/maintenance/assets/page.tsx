import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { Cpu } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { ASSET_CATEGORY } from "@/lib/ops/labels";
import type { MaintenanceAssetRow } from "@/lib/supabase/database.types";
import { listRooms } from "@/services/pms.service";
import { listMaintenanceAssets, listMaintenanceRequests } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { type Field, SimpleForm } from "../../_assets/simple-form";
import { saveMaintenanceAssetAction } from "../../_services/actions";

/** سجل الأجهزة والمعدات: موقعها وضمانها وعدد أعطالها */
export default async function MaintenanceAssetsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.maintenanceManage);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [assets, rooms, requests] = await Promise.all([
    listMaintenanceAssets(ctx.supabase, ctx.hotel.id), listRooms(ctx.supabase, ctx.hotel.id), listMaintenanceRequests(ctx.supabase, ctx.hotel.id),
  ]);
  const room = new Map(rooms.map((r) => [r.id, r.room_number]));
  const edit = assets.find((a) => a.id === sp.edit);
  const fields = (withActive: boolean): Field[] => [
    { name: "name", label: tr("اسم الجهاز") },
    { name: "code", label: tr("الرمز"), ltr: true },
    { name: "category", label: tr("التصنيف"), options: Object.entries(ASSET_CATEGORY).map(([id, label]) => ({ id, label })) },
    { name: "room_id", label: tr("الغرفة"), optional: true, options: rooms.filter((r) => r.is_active).map((r) => ({ id: r.id, label: r.room_number })) },
    { name: "location", label: tr("الموقع") },
    { name: "brand", label: tr("الماركة والموديل") },
    { name: "serial_number", label: tr("الرقم التسلسلي"), ltr: true },
    { name: "purchase_date", label: tr("تاريخ الشراء"), type: "date" },
    { name: "warranty_until", label: tr("الضمان حتى"), type: "date" },
    { name: "notes", label: tr("ملاحظات") },
    ...(withActive ? [{ name: "is_active", label: tr("في الخدمة"), checkbox: true as const }] : []),
  ];
  const initial = (a?: MaintenanceAssetRow) => ({
    id: a?.id ?? "", name: a?.name ?? "", code: a?.code ?? "", category: a?.category ?? "ac", room_id: a?.room_id ?? "", location: a?.location ?? "",
    brand: a?.brand ?? "", serial_number: a?.serial_number ?? "", purchase_date: a?.purchase_date ?? "", warranty_until: a?.warranty_until ?? "",
    notes: a?.notes ?? "", is_active: a?.is_active ?? true,
  });

  return (
    <>
      <PageHeader title={tr("سجل الأجهزة")} actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/maintenance">{tr("بلاغات الصيانة")}</Link></Button>
          <FormDialog label={tr("جهاز جديد")} title={tr("جهاز جديد")} width="lg">
            <SimpleForm columns={2} submitLabel={tr("إضافة")} errors={t.errors} action={saveMaintenanceAssetAction} initial={initial()} fields={fields(false)} />
          </FormDialog>
        </div>
      } />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow><TableHead>{tr("الجهاز")}</TableHead><TableHead>{tr("التصنيف")}</TableHead><TableHead>{tr("المكان")}</TableHead><TableHead>{tr("الضمان")}</TableHead><TableHead className="text-end">{tr("الأعطال")}</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {assets.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState icon={Cpu} title={tr("لا أجهزة مسجلة")} description={tr("سجّل المكيفات والمصاعد والمولدات وغيرها لتتبع أعطالها وضمانها.")} /></TableCell></TableRow>}
            {assets.map((a) => {
              const count = requests.filter((r) => r.asset_id === a.id).length;
              return (
                <TableRow key={a.id}>
                  <TableCell className="cell-fluid">
                    <span className="font-medium text-ink">{a.name}</span>{!a.is_active && <Badge variant="secondary" className="ms-2">{tr("خارج الخدمة")}</Badge>}
                    {(a.brand || a.serial_number) && <span className="block text-[14px] text-slate-500">{[a.brand, a.serial_number].filter(Boolean).join(tr("، "))}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{ASSET_CATEGORY[a.category]}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.room_id ? <span className="num font-semibold">{room.get(a.room_id)}</span> : a.location}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {a.warranty_until ? (a.warranty_until >= today ? <Badge variant="success">{tr("حتى {0}", dayLabel(a.warranty_until))}</Badge> : <Badge variant="secondary">{tr("انتهى")}</Badge>) : null}
                  </TableCell>
                  <TableCell className="text-end num">{count}</TableCell>
                  <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/maintenance/assets?edit=${a.id}`}>{tr("تعديل")}</Link></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {edit && (
        <RouteDialog closeHref="/maintenance/assets" title={tr("تعديل {0}", edit.name)} width="lg">
          <SimpleForm columns={2} submitLabel={tr("حفظ")} errors={t.errors} action={saveMaintenanceAssetAction} initial={initial(edit)} fields={fields(true)} onDone="/maintenance/assets" />
        </RouteDialog>
      )}
    </>
  );
}
