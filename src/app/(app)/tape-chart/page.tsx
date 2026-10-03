import Link from "@/components/link";
import { CalendarRange, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, dayLabel, nightsBetween, timeOf, timeRange } from "@/lib/pms/dates";
import { RESERVATION_STATUS } from "@/lib/pms/labels";
import { cn } from "@/lib/utils";
import { listReservations, listRooms, listRoomTypes, roomTypeAvailability, type ReservationListItem } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";

const BAR: Record<string, string> = {
  tentative: "border-amber-dot/60 bg-amber-tint text-amber",
  confirmed: "border-action/40 bg-accent1-tint text-ink",
  checked_in: "border-ink bg-ink text-white",
  checked_out: "border-line bg-subtle text-slate-500",
};

/** توزيع الحجوزات غير المخصصة على مسارات لا تتداخل (لتظهر كلها دون تراكب) */
function lanes(list: ReservationListItem[]): ReservationListItem[][] {
  const out: ReservationListItem[][] = [];
  for (const r of [...list].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))) {
    const lane = out.find((l) => l.at(-1)!.departure_date <= r.arrival_date);
    if (lane) lane.push(r); else out.push([r]);
  }
  return out;
}

/**
 * جدول الإشغال: الغرف صفوفًا والأيام أعمدة، والحجوزات أشرطة ملونة بحالتها.
 * رأس كل نوع يعرض عدد الغرف الشاغرة في كل ليلة، والنقر على خانة فارغة يبدأ حجزًا لتلك الغرفة وذلك اليوم.
 */
export default async function TapeChartPage({ searchParams }: { searchParams: Promise<{ start?: string; days?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const span = sp.days === "7" ? 7 : sp.days === "30" ? 30 : 14;
  const start = sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : addDays(today, -1);
  const end = addDays(start, span);
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));

  const [types, rooms, reservations, availability] = await Promise.all([
    listRoomTypes(ctx.supabase, ctx.hotel.id),
    listRooms(ctx.supabase, ctx.hotel.id),
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["tentative", "confirmed", "checked_in", "checked_out"], from: addDays(start, 1), to: addDays(end, -1) }),
    roomTypeAvailability(ctx.supabase, ctx.hotel.id, start, end),
  ]);
  const visible = reservations.filter((r) => r.booking_mode === "nightly" ? r.departure_date > start && r.arrival_date < end : r.arrival_date >= start && r.arrival_date < end);
  const avail = new Map(availability.map((a) => [`${a.room_type_id}|${a.stay_date}`, a.available]));
  const canCreate = ctx.can(PERMISSIONS.pmsManage);
  const weekend = new Set(ctx.hotel.weekend_nights);
  const cols = `minmax(150px, 170px) repeat(${span}, minmax(${span > 14 ? 44 : 64}px, 1fr))`;
  const col = (date: string) => Math.max(0, nightsBetween(start, date)) + 2;
  const nav = (s: string) => `/tape-chart?start=${s}${span !== 14 ? `&days=${span}` : ""}`;

  const Bar = ({ r }: { r: ReservationListItem }) => {
    const from = r.arrival_date < start ? start : r.arrival_date;
    const to = r.booking_mode === "hourly" ? addDays(r.arrival_date, 1) : r.departure_date > end ? end : r.departure_date;
    const st = RESERVATION_STATUS[r.status];
    return (
      <Link href={`/reservations/${r.id}`} title={`${r.confirmation_number}، ${r.guest?.full_name ?? ""}، ${st.label}`}
        style={{ gridColumn: `${col(from)} / ${col(to)}`, gridRow: 1 }}
        className={cn("z-[1] m-1 flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-[14px] font-medium transition-[filter] hover:brightness-95",
          BAR[r.status] ?? BAR.confirmed, r.arrival_date < start && "rounded-s-none", r.departure_date > end && r.booking_mode === "nightly" && "rounded-e-none")}>
        <span className="truncate">{r.booking_mode === "hourly" ? `${timeOf(r.starts_at)} ` : ""}{r.guest?.full_name}</span>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title={t.nav.tapeChart}
        actions={canCreate && <Button asChild><Link href="/reservations/new"><Plus />حجز جديد</Link></Button>}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href={nav(addDays(start, -span))}>السابق</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={nav(addDays(today, -1))}>اليوم</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={nav(addDays(start, span))}>التالي</Link></Button>
          <span className="ms-2 text-[16px] font-medium text-ink">من {dayLabel(start, { day: "numeric", month: "long" })} إلى {dayLabel(addDays(end, -1), { day: "numeric", month: "long", year: "numeric" })}</span>
        </div>
        <FilterTabs active={String(span)} items={[7, 14, 30].map((n) => ({ key: String(n), href: `/tape-chart?start=${start}${n !== 14 ? `&days=${n}` : ""}`, label: `${n} يومًا` }))} />
      </div>
      <div className="mb-4 flex flex-wrap gap-4 text-[14.5px] text-slate-600">
        {(["confirmed", "tentative", "checked_in", "checked_out"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={cn("size-3 rounded-sm border", BAR[s])} />{RESERVATION_STATUS[s].label}</span>
        ))}
      </div>

      {rooms.length === 0 ? (
        <Card><EmptyState icon={CalendarRange} title="لا توجد غرف بعد" description="أضف أنواع الغرف والغرف ليظهر جدول الإشغال."
          actionHref={ctx.can(PERMISSIONS.pmsSetup) ? "/room-setup" : undefined} actionLabel="إعداد الغرف" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className="min-w-max" style={{ minWidth: "100%" }}>
            {/* رأس الأيام */}
            <div className="sticky top-0 z-[2] grid bg-thead text-thead-text" style={{ gridTemplateColumns: cols }}>
              <div className="px-4 py-3 font-bold">الغرفة</div>
              {days.map((d) => (
                <div key={d} className={cn("border-s border-white/10 px-1 py-2 text-center", weekend.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && "bg-white/10", d === today && "bg-action")}>
                  <span className="block text-[12.5px] opacity-80">{dayLabel(d, { weekday: "short" })}</span>
                  <span className="num text-[15px] font-semibold">{Number(d.slice(8))}</span>
                </div>
              ))}
            </div>

            {types.filter((x) => x.is_active).map((type) => {
              const typeRooms = rooms.filter((r) => r.room_type_id === type.id && r.is_active);
              if (typeRooms.length === 0) return null;
              const unassigned = visible.filter((r) => r.room_type_id === type.id && !r.room_id && r.status !== "checked_out");
              return (
                <section key={type.id}>
                  {/* رأس النوع: الشاغر في كل ليلة */}
                  <div className="grid border-b border-line bg-group-row" style={{ gridTemplateColumns: cols }}>
                    <div className="px-4 py-2 font-bold text-ink">{type.name_ar}<span className="ms-2 font-normal text-slate-500">{type.booking_mode === "hourly" ? "بالساعة" : `${typeRooms.length} غرف`}</span></div>
                    {days.map((d) => {
                      const a = avail.get(`${type.id}|${d}`);
                      return (
                        <div key={d} className={cn("num border-s border-line/70 py-2 text-center text-[13.5px] font-semibold",
                          a === undefined ? "text-slate-300" : a <= 0 ? "text-urgent" : a <= 1 ? "text-amber" : "text-success")}>
                          {a === undefined ? "" : a}
                        </div>
                      );
                    })}
                  </div>
                  {typeRooms.map((room) => {
                    const bars = visible.filter((r) => r.room_id === room.id);
                    return (
                      <div key={room.id} className="grid h-12 border-b border-line" style={{ gridTemplateColumns: cols }}>
                        <div style={{ gridColumn: 1, gridRow: 1 }} className="flex items-center gap-2 px-4">
                          <span className="num font-bold text-ink">{room.room_number}</span>
                          {room.service_status === "out_of_service" && <span className="rounded bg-urgent-tint px-1.5 text-urgent">خارج الخدمة</span>}
                          {room.housekeeping_status === "dirty" && room.service_status === "in_service" && <span className="rounded bg-amber-tint px-1.5 text-amber">تنظيف</span>}
                        </div>
                        {days.map((d, i) => (
                          canCreate && room.service_status === "in_service" && d >= today ? (
                            <Link key={d} style={{ gridColumn: i + 2, gridRow: 1 }} aria-label={`حجز الغرفة ${room.room_number} يوم ${d}`}
                              href={`/reservations/new?type=${type.id}&room=${room.id}&arrival=${d}&departure=${addDays(d, 1)}`}
                              className={cn("border-s border-line/70 transition-colors hover:bg-accent1-tint/50", weekend.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && "bg-panel/60")} />
                          ) : (
                            <div key={d} style={{ gridColumn: i + 2, gridRow: 1 }}
                              className={cn("border-s border-line/70", room.service_status === "out_of_service" ? "bg-urgent-tint/40" : d < today ? "bg-subtle/60" : weekend.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && "bg-panel/60")} />
                          )
                        ))}
                        {type.booking_mode === "nightly" ? bars.map((r) => <Bar key={r.id} r={r} />) : (
                          // الوحدات بالساعة: عدة حجوزات في اليوم نفسه تُجمع في خانة واحدة
                          [...new Set(bars.map((r) => r.arrival_date))].map((day) => {
                            const same = bars.filter((r) => r.arrival_date === day);
                            return same.length === 1 ? <Bar key={day} r={same[0]!} /> : (
                              <Link key={day} href={`/reservations?q=${encodeURIComponent(room.room_number)}&tab=all`}
                                style={{ gridColumn: `${col(day)} / ${col(addDays(day, 1))}`, gridRow: 1 }}
                                title={same.map((r) => `${timeRange(r.starts_at, r.ends_at)} ${r.guest?.full_name ?? ""}`).join("\n")}
                                className="z-[1] m-1 flex items-center justify-center rounded-md border border-action/40 bg-accent1-tint text-[13.5px] font-semibold text-ink">
                                <span className="num">{same.length}</span>&nbsp;حجوزات
                              </Link>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                  {lanes(unassigned).map((lane, i) => (
                    <div key={i} className="grid h-12 border-b border-dashed border-line bg-panel/40" style={{ gridTemplateColumns: cols }}>
                      <div style={{ gridColumn: 1, gridRow: 1 }} className="flex items-center px-4 text-[14px] text-slate-500">{i === 0 ? "غير مخصصة" : ""}</div>
                      {lane.map((r) => <Bar key={r.id} r={r} />)}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
