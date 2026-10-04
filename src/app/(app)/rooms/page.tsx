import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { BedDouble, BrushCleaning, DoorOpen, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { ACTIVE_STATUSES } from "@/lib/pms/labels";
import { timeRange } from "@/lib/pms/dates";
import { listFloors, listReservations, listRooms, listRoomTypes } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { RoomTile, type TileOccupancy } from "./room-tile";

type Filter = "all" | "vacant" | "dirty" | "oos";

/**
 * خريطة الغرف: كل غرفة ببطاقة ملوّنة بحالتها الليلة (مقيم داكن، محجوز أزرق فاتح، شاغرة بيضاء،
 * خارج الخدمة أحمر فاتح) ونقطة النظافة. تُجمَّع حسب الطابق، ومشرف التدبير يغيّر الحالة بنقرة.
 */
export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const filter: Filter = (["vacant", "dirty", "oos"] as const).find((x) => x === sp.filter) ?? "all";
  const today = todayInTimeZone(ctx.hotel.timezone);

  const [rooms, , floors, tonight] = await Promise.all([
    listRooms(ctx.supabase, ctx.hotel.id),
    listRoomTypes(ctx.supabase, ctx.hotel.id),
    listFloors(ctx.supabase, ctx.hotel.id),
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ACTIVE_STATUSES, from: today, to: today }),
  ]);
  const active = rooms.filter((r) => r.is_active);

  // شاغل كل غرفة الليلة (أو حجوزات اليوم للوحدات بالساعة)
  const occupancy = new Map<string, TileOccupancy>();
  for (const r of tonight) {
    if (!r.room_id) continue;
    const inRange = r.booking_mode === "hourly" ? r.arrival_date === today : r.arrival_date <= today && today < r.departure_date;
    if (!inRange) continue;
    const kind = r.status === "checked_in" ? "occupied" : "reserved";
    const prev = occupancy.get(r.room_id);
    if (prev?.kind === "occupied") continue;
    occupancy.set(r.room_id, {
      kind, reservationId: r.id, guest: r.guest?.full_name,
      until: r.booking_mode === "hourly" ? timeRange(r.starts_at, r.ends_at) : r.departure_date,
    });
  }
  const occ = (id: string): TileOccupancy => occupancy.get(id) ?? { kind: "free" };

  const counts = {
    vacant: active.filter((r) => r.service_status === "in_service" && occ(r.id).kind === "free").length,
    dirty: active.filter((r) => r.housekeeping_status === "dirty").length,
    oos: active.filter((r) => r.service_status === "out_of_service").length,
  };
  const shown = active.filter((r) =>
    filter === "vacant" ? r.service_status === "in_service" && occ(r.id).kind === "free"
    : filter === "dirty" ? r.housekeeping_status === "dirty"
    : filter === "oos" ? r.service_status === "out_of_service" : true);

  const groups = [
    ...floors.map((f) => ({ key: f.id, title: f.name, rooms: shown.filter((r) => r.floor_id === f.id) })),
    { key: "none", title: floors.length ? tr("بدون طابق") : tr("الغرف"), rooms: shown.filter((r) => !r.floor_id || !floors.some((f) => f.id === r.floor_id)) },
  ].filter((g) => g.rooms.length > 0);
  const canEdit = ctx.can(PERMISSIONS.pmsRoomStatus);

  return (
    <>
      <PageHeader
        title={t.nav.rooms}
        actions={ctx.can(PERMISSIONS.pmsSetup) && <Button asChild variant="outline"><Link href="/room-setup?tab=rooms">{tr("إعداد الغرف")}</Link></Button>}
      />
      <StatGrid>
        <Stat icon={DoorOpen} tone="ink" label={tr("الغرف والوحدات")} value={<span className="num">{active.length}</span>} hint={tr("{0} مشغولة الآن", [...occupancy.values()].filter((x) => x.kind === "occupied").length)} />
        <Stat icon={BedDouble} tone="teal" label={tr("شاغرة الليلة")} value={<span className="num">{counts.vacant}</span>} hint={tr("في الخدمة وبلا حجز مخصص")} />
        <Stat icon={BrushCleaning} tone="clay" label={tr("تحتاج تنظيف")} value={<span className="num">{counts.dirty}</span>} />
        <Stat icon={Wrench} tone="neutral" label={tr("خارج الخدمة")} value={<span className="num">{counts.oos}</span>} />
      </StatGrid>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={filter} items={[
          { key: "all", href: "/rooms", label: tr("الكل"), count: active.length },
          { key: "vacant", href: "/rooms?filter=vacant", label: tr("شاغرة"), count: counts.vacant },
          { key: "dirty", href: "/rooms?filter=dirty", label: tr("تحتاج تنظيف"), count: counts.dirty },
          { key: "oos", href: "/rooms?filter=oos", label: tr("خارج الخدمة"), count: counts.oos },
        ]} />
        <div className="flex flex-wrap items-center gap-4 text-[14.5px] text-slate-600">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-ink" />{tr("مقيم")}</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-action/40 bg-accent1-tint" />{tr("محجوز الليلة")}</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-line bg-white" />{tr("شاغرة")}</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-urgent-tint" />{tr("خارج الخدمة")}</span>
        </div>
      </div>

      {rooms.length === 0 ? (
        <Card><EmptyState icon={DoorOpen} title={tr("لا توجد غرف بعد")} description={tr("أضف أنواع الغرف ثم الغرف من صفحة إعداد الغرف.")}
          actionHref={ctx.can(PERMISSIONS.pmsSetup) ? "/room-setup" : undefined} actionLabel={tr("إعداد الغرف")} /></Card>
      ) : groups.length === 0 ? (
        <Card><EmptyState title={tr("لا توجد غرف بهذه الحالة")} /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-ink">{g.title}
                <span className="num font-normal text-slate-500">{g.rooms.length}</span></h2>
              <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
                {g.rooms.map((r) => (
                  <RoomTile key={r.id} id={r.id} number={r.room_number}
                    housekeeping={r.housekeeping_status} service={r.service_status} serviceNote={r.service_note}
                    occupancy={occ(r.id)} canEdit={canEdit} errors={t.errors} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
