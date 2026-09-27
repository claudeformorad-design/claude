import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import Link from "@/components/link";
import { BedDouble, Building2, DoorOpen, Layers, Plus, Timer } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { BOOKING_MODE, HOUSEKEEPING, SERVICE } from "@/lib/pms/labels";
import { listFloors, listRooms, listRoomTypes } from "@/services/pms.service";
import { listChargeCodes } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { ActionButton } from "../_pms/action-button";
import { createRoomsBulkAction, deleteFloorAction, deleteRoomAction, saveFloorAction, saveRoomAction, saveRoomTypeAction } from "../_pms/actions";

type Tab = "types" | "rooms" | "floors";

/**
 * إعداد الغرف: أنواع الغرف (ليلية أو بالساعة) بأسعارها الأساسية وسعتها وحد الحجز الزائد،
 * والغرف (فرديًا أو دفعة واحدة بمدى أرقام)، والطوابق.
 */
export default async function RoomSetupPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "rooms" || sp.tab === "floors" ? sp.tab : "types";
  const [types, rooms, floors, codes] = await Promise.all([
    listRoomTypes(ctx.supabase, ctx.hotel.id),
    listRooms(ctx.supabase, ctx.hotel.id),
    listFloors(ctx.supabase, ctx.hotel.id),
    listChargeCodes(ctx.supabase, ctx.hotel.id).catch(() => []),
  ]);
  const typeById = new Map(types.map((x) => [x.id, x]));
  const floorById = new Map(floors.map((x) => [x.id, x]));
  const roomsByType = new Map<string, number>();
  for (const r of rooms) roomsByType.set(r.room_type_id, (roomsByType.get(r.room_type_id) ?? 0) + 1);
  const nightlyRooms = rooms.filter((r) => r.is_active && typeById.get(r.room_type_id)?.booking_mode === "nightly").length;
  const hourlyUnits = rooms.filter((r) => r.is_active && typeById.get(r.room_type_id)?.booking_mode === "hourly").length;
  const typeOptions = types.filter((x) => x.is_active).map((x) => ({ id: x.id, label: x.name_ar }));
  const floorOptions = floors.map((x) => ({ id: x.id, label: x.name }));
  const roomCode = codes.find((c) => c.code === "ROOM")?.id ?? "";

  const editingType = tab === "types" ? (sp.edit ? types.find((x) => x.id === sp.edit) : sp.new ? null : undefined) : undefined;
  const editingRoom = tab === "rooms" ? (sp.edit ? rooms.find((x) => x.id === sp.edit) : sp.new ? null : undefined) : undefined;
  const editingFloor = tab === "floors" ? (sp.edit ? floors.find((x) => x.id === sp.edit) : sp.new ? null : undefined) : undefined;
  const newHref = `/room-setup?tab=${tab}&new=1`;
  const newLabel = tab === "types" ? "نوع غرف جديد" : tab === "rooms" ? "غرفة جديدة" : "طابق جديد";

  return (
    <>
      <PageHeader
        title={t.nav.roomSetup}
        description="أنواع الغرف وأسعارها الأساسية وسعتها، والغرف والقاعات، والطوابق. الأسعار الموسمية والعروض من صفحة الأسعار."
        actions={<div className="flex gap-2">{tab === "rooms" && (<FormDialog label="إضافة غرف دفعة واحدة" variant="outline" title="إضافة غرف دفعة واحدة" description="مدى أرقام متتالي من نفس النوع؛ الأرقام الموجودة تُتجاوز تلقائيًا.">
              {typeOptions.length === 0 ? <p className="text-[16px] text-slate-500">عرّف نوع غرف أولًا.</p> : (
                <SimpleForm columns={2} submitLabel="إضافة الغرف" errors={t.errors} action={createRoomsBulkAction}
                  initial={{ room_type_id: typeOptions[0]!.id, floor_id: "", from_number: "", to_number: "", prefix: "" }}
                  fields={[
                    { name: "room_type_id", label: "النوع", options: typeOptions },
                    { name: "floor_id", label: "الطابق", optional: true, options: floorOptions },
                    { name: "from_number", label: "من رقم", type: "number" },
                    { name: "to_number", label: "إلى رقم", type: "number" },
                    { name: "prefix", label: "بادئة اختيارية مثل H", ltr: true },
                  ]} />
              )}
            </FormDialog>)}<Button asChild><Link href={newHref}><Plus />{newLabel}</Link></Button></div>}
      />
      <StatGrid>
        <Stat icon={BedDouble} tone="ink" label="أنواع الغرف" value={<span className="num">{types.length}</span>} hint={`${types.filter((x) => x.booking_mode === "hourly").length} بالساعة`} />
        <Stat icon={DoorOpen} tone="teal" label="غرف ليلية نشطة" value={<span className="num">{nightlyRooms}</span>} hint="تُحتسب في تقارير الإشغال" />
        <Stat icon={Timer} tone="clay" label="وحدات بالساعة" value={<span className="num">{hourlyUnits}</span>} hint="قاعات وشاليهات ومسابح" />
        <Stat icon={Layers} tone="neutral" label="الطوابق" value={<span className="num">{floors.length}</span>} />
      </StatGrid>

      <FilterTabs className="mb-5" active={tab} items={[
        { key: "types", href: "/room-setup", label: "أنواع الغرف", count: types.length },
        { key: "rooms", href: "/room-setup?tab=rooms", label: "الغرف", count: rooms.length },
        { key: "floors", href: "/room-setup?tab=floors", label: "الطوابق", count: floors.length },
      ]} />

      {tab === "types" && (
        <div className="grid gap-6">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرمز</TableHead><TableHead>النوع</TableHead><TableHead>الحجز</TableHead><TableHead>السعة</TableHead>
                  <TableHead className="text-end">السعر الأساسي</TableHead><TableHead className="text-end">نهاية الأسبوع</TableHead>
                  <TableHead>حجز زائد</TableHead><TableHead>الغرف</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.length === 0 && (
                  <TableRow><TableCell colSpan={9}><EmptyState icon={BedDouble} title="لا توجد أنواع غرف بعد"
                    description="ابدأ بتعريف أنواع الغرف مثل المفردة والمزدوجة والجناح، أو الوحدات بالساعة مثل القاعة والمسبح، ثم أضف الغرف."
                    actionHref="/room-setup?new=1" actionLabel="نوع غرف جديد" /></TableCell></TableRow>
                )}
                {types.map((x) => (
                  <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}>
                    <TableCell className="num font-semibold">{x.code}</TableCell>
                    <TableCell className="cell-fluid font-medium">{x.name_ar}</TableCell>
                    <TableCell><Badge variant={x.booking_mode === "hourly" ? "info" : "outline"}>{BOOKING_MODE[x.booking_mode]}</Badge></TableCell>
                    <TableCell className="num">{x.max_adults}{x.max_children ? ` بالغ و${x.max_children} طفل` : ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-end font-semibold"><Money value={x.base_rate} locale={locale} />
                      <span className="ms-1 text-[14.5px] font-normal text-slate-500">{x.booking_mode === "hourly" ? "/ساعة" : "/ليلة"}</span></TableCell>
                    <TableCell className="text-end">{x.weekend_rate ? <Money value={x.weekend_rate} locale={locale} /> : <span className="text-slate-400"></span>}</TableCell>
                    <TableCell className="num">{x.booking_mode === "nightly" ? (x.overbooking_limit || "") : ""}</TableCell>
                    <TableCell className="num">{roomsByType.get(x.id) ?? 0}</TableCell>
                    <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/room-setup?edit=${x.id}`}>{t.common.edit}</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {editingType !== undefined && (
            <RouteDialog closeHref="/room-setup" title={<>{editingType ? `تعديل ${editingType.name_ar}` : "نوع غرف جديد"}</>} description="للوحدات بالساعة: السعر الأساسي هو سعر الساعة.">
              <SimpleForm key={editingType?.id ?? "new"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveRoomTypeAction} onDone="/room-setup"
                initial={{
                  ...(editingType ? { id: editingType.id } : {}),
                  code: editingType?.code ?? "", name_ar: editingType?.name_ar ?? "", booking_mode: editingType?.booking_mode ?? "nightly",
                  max_adults: String(editingType?.max_adults ?? 2), max_children: String(editingType?.max_children ?? 0),
                  base_rate: editingType ? String(Number(editingType.base_rate)) : "", weekend_rate: editingType?.weekend_rate ? String(Number(editingType.weekend_rate)) : "",
                  min_hours: String(Number(editingType?.min_hours ?? 1)), overbooking_limit: String(editingType?.overbooking_limit ?? 0),
                  charge_code_id: editingType ? editingType.charge_code_id ?? "" : roomCode, description: editingType?.description ?? "",
                  is_active: editingType?.is_active ?? true,
                }}
                fields={[
                  { name: "code", label: "الرمز", ltr: true },
                  { name: "name_ar", label: "الاسم" },
                  { name: "booking_mode", label: "نوع الحجز", options: [{ id: "nightly", label: "ليلي للغرف والأجنحة" }, { id: "hourly", label: "بالساعة للقاعات والمسابح والشاليهات" }] },
                  { name: "charge_code_id", label: "كود الإيراد", optional: true, options: codes.filter((c) => c.is_active).map((c) => ({ id: c.id, label: `${c.code} ${c.name_ar}` })) },
                  { name: "max_adults", label: "أقصى عدد بالغين", type: "number" },
                  { name: "max_children", label: "أقصى عدد أطفال", type: "number" },
                  { name: "base_rate", label: "السعر الأساسي", type: "number" },
                  { name: "weekend_rate", label: "سعر نهاية الأسبوع", type: "number" },
                  { name: "overbooking_limit", label: "حد الحجز الزائد، والصفر يمنعه", type: "number" },
                  { name: "min_hours", label: "أقل مدة بالساعات للوحدات بالساعة", type: "number" },
                  { name: "description", label: "الوصف" },
                  { name: "is_active", label: t.common.active, checkbox: true },
                ]} />
            </RouteDialog>
          )}
        </div>
      )}

      {tab === "rooms" && (
        <div className="grid gap-6">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الغرفة</TableHead><TableHead>النوع</TableHead><TableHead>الطابق</TableHead>
                  <TableHead>النظافة</TableHead><TableHead>الخدمة</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.length === 0 && (
                  <TableRow><TableCell colSpan={6}><EmptyState icon={DoorOpen} title="لا توجد غرف بعد"
                    description={types.length ? "أضف الغرف دفعة واحدة بمدى الأرقام، مثلًا من 101 إلى 120، بزر إضافة غرف دفعة واحدة." : "عرّف أنواع الغرف أولًا ثم أضف الغرف."}
                    actionHref={types.length ? undefined : "/room-setup?new=1"} actionLabel={types.length ? undefined : "نوع غرف جديد"} /></TableCell></TableRow>
                )}
                {rooms.map((r) => {
                  const type = typeById.get(r.room_type_id);
                  return (
                    <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                      <TableCell className="num text-[18px] font-bold">{r.room_number}</TableCell>
                      <TableCell className="cell-fluid">{type?.name_ar ?? ""} {type?.booking_mode === "hourly" && <Badge variant="info" className="ms-1">بالساعة</Badge>}</TableCell>
                      <TableCell>{r.floor_id ? floorById.get(r.floor_id)?.name : <span className="text-slate-400"></span>}</TableCell>
                      <TableCell><Badge variant={HOUSEKEEPING[r.housekeeping_status].variant}>{HOUSEKEEPING[r.housekeeping_status].label}</Badge></TableCell>
                      <TableCell>{r.service_status === "out_of_service" ? <Badge variant="destructive" title={r.service_note ?? ""}>{SERVICE.out_of_service}</Badge> : <span className="text-slate-500">{SERVICE.in_service}</span>}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="sm"><Link href={`/room-setup?tab=rooms&edit=${r.id}`}>{t.common.edit}</Link></Button>
                          <ActionButton variant="ghost" label="حذف" done="حُذفت الغرفة" errors={t.errors} confirmText={`حذف الغرفة ${r.room_number}؟`}
                            run={deleteRoomAction.bind(null, r.id)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <div className="space-y-6">
            {editingRoom !== undefined && (
              <RouteDialog closeHref="/room-setup?tab=rooms" title={<>{editingRoom ? `تعديل الغرفة ${editingRoom.room_number}` : "غرفة جديدة"}</>}>
                <SimpleForm key={editingRoom?.id ?? "new-room"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveRoomAction} onDone="/room-setup?tab=rooms"
                  initial={{
                    ...(editingRoom ? { id: editingRoom.id } : {}),
                    room_number: editingRoom?.room_number ?? "", room_type_id: editingRoom?.room_type_id ?? typeOptions[0]?.id ?? "",
                    floor_id: editingRoom?.floor_id ?? "", notes: editingRoom?.notes ?? "", is_active: editingRoom?.is_active ?? true,
                  }}
                  fields={[
                    { name: "room_number", label: "رقم الغرفة", ltr: true },
                    { name: "room_type_id", label: "النوع", options: typeOptions },
                    { name: "floor_id", label: "الطابق", optional: true, options: floorOptions },
                    { name: "notes", label: "ملاحظات" },
                    { name: "is_active", label: t.common.active, checkbox: true },
                  ]} />
              </RouteDialog>
            )}

          </div>
        </div>
      )}

      {tab === "floors" && (
        <div className="grid gap-6">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>الطابق</TableHead><TableHead>الترتيب</TableHead><TableHead>الغرف</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {floors.length === 0 && (
                  <TableRow><TableCell colSpan={4}><EmptyState icon={Building2} title="لا توجد طوابق" description="الطوابق اختيارية؛ تساعد في ترتيب خريطة الغرف." /></TableCell></TableRow>
                )}
                {floors.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="cell-fluid font-medium">{f.name}</TableCell>
                    <TableCell className="num">{f.sort_order}</TableCell>
                    <TableCell className="num">{rooms.filter((r) => r.floor_id === f.id).length}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="sm"><Link href={`/room-setup?tab=floors&edit=${f.id}`}>{t.common.edit}</Link></Button>
                        <ActionButton variant="ghost" label="حذف" done="حُذف الطابق" errors={t.errors} confirmText={`حذف ${f.name}؟`} run={deleteFloorAction.bind(null, f.id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {editingFloor !== undefined && (
            <RouteDialog closeHref="/room-setup?tab=floors" title={<>{editingFloor ? `تعديل ${editingFloor.name}` : "طابق جديد"}</>}>
              <SimpleForm key={editingFloor?.id ?? "new-floor"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveFloorAction} onDone="/room-setup?tab=floors"
                initial={{ ...(editingFloor ? { id: editingFloor.id } : {}), name: editingFloor?.name ?? "", sort_order: String(editingFloor?.sort_order ?? floors.length + 1) }}
                fields={[{ name: "name", label: "اسم الطابق" }, { name: "sort_order", label: "الترتيب", type: "number" }]} />
            </RouteDialog>
          )}
        </div>
      )}
    </>
  );
}
