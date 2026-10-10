import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { BedDouble, BellRing, BrushCleaning, CalendarCheck, CalendarRange, DoorOpen, Hourglass, LogOut, Plus, Users, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityCell } from "@/components/ui/entity";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { addDays, dayLabel, nightsBetween, nightsText, timeOf, timeRange } from "@/lib/pms/dates";
import { RESERVATION_STATUS } from "@/lib/pms/labels";
import { cn } from "@/lib/utils";
import { frontDeskSummary, listReservations, listRooms, roomTypeAvailability, type ReservationListItem } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { QuickCheckIn } from "../_pms/handover";

/**
 * لوحة الاستقبال: ما يحتاجه موظف الاستقبال اليوم في شاشة واحدة — الوصول والمغادرة، الإشغال الليلة،
 * التنبيهات (طلبات انتظار أصبحت متاحة، حجوزات مبدئية ينتهي موعدها، غرف تحتاج تنظيف) وتوقع الأسبوع.
 */
export default async function FrontDeskPage() {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { t } = await getI18n();
  const s = await frontDeskSummary(ctx.supabase, ctx.hotel.id);
  const today = s.today;
  const [arrivals, departures, holds, week, inHouse, rooms] = await Promise.all([
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["tentative", "confirmed"], arrivalOn: today }),
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["confirmed", "checked_in"], departureOn: today }),
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["tentative"], from: today }),
    roomTypeAvailability(ctx.supabase, ctx.hotel.id, today, addDays(today, 7)),
    listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["checked_in"] }),
    listRooms(ctx.supabase, ctx.hotel.id),
  ]);
  const dirtyRooms = new Set(rooms.filter((x) => x.housekeeping_status === "dirty").map((x) => x.id));
  const expiring = holds.filter((r) => r.tentative_until && r.tentative_until <= today);
  const occupancy = s.capacity ? Math.round((s.sold_tonight / s.capacity) * 100) : 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const rows = week.filter((w) => w.stay_date === d);
    const cap = rows.reduce((a, w) => a + w.capacity, 0);
    const sold = rows.reduce((a, w) => a + w.sold, 0);
    return { d, cap, sold, pct: cap ? Math.round((sold / cap) * 100) : 0 };
  });
  const canManage = ctx.can(PERMISSIONS.pmsManage);
  const stayText = (r: ReservationListItem) =>
    r.booking_mode === "hourly" ? timeRange(r.starts_at, r.ends_at) : nightsText(nightsBetween(r.arrival_date, r.departure_date));

  return (
    <>
      <PageHeader
        title={t.nav.frontDesk}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/tape-chart"><CalendarRange />{tr("جدول الإشغال")}</Link></Button>
            {canManage && <Button asChild><Link href="/reservations/new"><Plus />{tr("حجز جديد")}</Link></Button>}
          </>
        }
      />

      <StatGrid>
        <Stat icon={CalendarCheck} tone="ink" label={tr("وصول اليوم")} value={<span className="num">{s.arrivals}</span>} hint={tr("{0} بلا غرفة مخصصة", arrivals.filter((r) => !r.room_id).length)} />
        <Stat icon={LogOut} tone="teal" label={tr("مغادرة اليوم")} value={<span className="num">{s.departures}</span>} />
        <Stat icon={Users} tone="clay" label={tr("المقيمون الآن")} value={<span className="num">{s.in_house}</span>} />
        <Stat icon={BedDouble} tone="neutral" label={tr("الإشغال الليلة")} value={<span className="num">{occupancy}%</span>} hint={tr("{0} شاغرة من {1}", s.available_tonight, s.capacity)} />
      </StatGrid>

      {(s.waitlist_ready > 0 || expiring.length > 0 || s.dirty > 0 || s.out_of_service > 0) && (
        <div className="stagger mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {s.waitlist_ready > 0 && <Alert href="/waitlist?tab=ready" icon={BellRing} tone="action" title={tr("{0} طلب انتظار أصبح متاحًا", s.waitlist_ready)} text={tr("تحررت غرف لطلبات في قائمة الانتظار، حوّلها لحجوزات")} />}
          {expiring.length > 0 && <Alert href="/reservations?tab=tentative" icon={Hourglass} tone="amber" title={tr("{0} حجز مبدئي انتهت مهلته", expiring.length)} text={tr("أكّدها مع النزيل أو ألغها لتحرير الغرف")} />}
          {s.dirty > 0 && <Alert href="/rooms?filter=dirty" icon={BrushCleaning} tone="neutral" title={tr("{0} غرفة تحتاج تنظيف", s.dirty)} text={tr("تابعها مع التدبير الفندقي قبل وصول النزلاء")} />}
          {s.out_of_service > 0 && <Alert href="/rooms?filter=oos" icon={Wrench} tone="urgent" title={tr("{0} غرفة خارج الخدمة", s.out_of_service)} text={tr("لا تُباع حتى تعود للخدمة")} />}
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle className="justify-between"><span>{tr("الوصول اليوم")}</span><Link href="/reservations?tab=arrivals" className="font-medium text-action">{tr("الكل")}</Link></CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الغرفة")}</TableHead><TableHead>{tr("النوع")}</TableHead><TableHead>{tr("الإقامة")}</TableHead><TableHead>{tr("الحالة")}</TableHead>{canManage && <TableHead />}</TableRow></TableHeader>
              <TableBody>
                {arrivals.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-500">{tr("لا يوجد وصول متوقع اليوم")}</TableCell></TableRow>}
                {arrivals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="cell-fluid"><EntityCell name={r.guest?.full_name ?? ""} href={`/reservations/${r.id}`} /></TableCell>
                    <TableCell className="whitespace-nowrap">{r.room ? <span className="num font-semibold">{r.room.room_number}</span> : <Link href={`/reservations/${r.id}`}><Badge variant="warning">{tr("خصّص غرفة")}</Badge></Link>}</TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600">{localNameOf(r.room_type)}</TableCell>
                    <TableCell className="whitespace-nowrap">{stayText(r)}</TableCell>
                    <TableCell><Badge variant={RESERVATION_STATUS[r.status].variant}>{RESERVATION_STATUS[r.status].label}</Badge></TableCell>
                    {canManage && (
                      <TableCell className="text-end">
                        {r.room_id && r.booking_mode === "nightly" && dirtyRooms.has(r.room_id)
                          ? <Badge variant="warning">{tr("الغرفة تحتاج تنظيف")}</Badge>
                          : (r.room_id || r.booking_mode === "hourly") && (
                            <QuickCheckIn reservationId={r.id} roomId={r.room_id} access={ctx.hotel.room_access} errors={t.errors} />
                          )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader><CardTitle className="justify-between"><span>{tr("المقيمون الآن")}</span><span className="num font-medium text-slate-500">{inHouse.length}</span></CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الغرفة")}</TableHead><TableHead>{tr("المغادرة")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {inHouse.length === 0 && <TableRow><TableCell colSpan={4} className="py-10 text-center text-slate-500">{tr("لا يوجد نزلاء مقيمون")}</TableCell></TableRow>}
                {inHouse.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="cell-fluid"><EntityCell name={r.guest?.full_name ?? ""} href={`/reservations/${r.id}`} /></TableCell>
                    <TableCell className="num whitespace-nowrap font-semibold">{r.room?.room_number ?? ""}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.booking_mode === "hourly" ? <span className="num">{timeOf(r.ends_at)}</span> : dayLabel(r.departure_date)}
                      {r.departure_date < today && <Badge variant="destructive" className="ms-2">{tr("متأخر")}</Badge>}</TableCell>
                    <TableCell className="text-end">
                      {(r.departure_date <= today || r.booking_mode === "hourly") && <Button asChild size="sm" variant="outline"><Link href={`/reservations/${r.id}`}><LogOut className="size-4" />{tr("مغادرة")}</Link></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{tr("الإشغال للأيام السبعة القادمة")}</CardTitle></CardHeader>
            <CardContent>
              <div className="flex h-40 items-end gap-2">
                {days.map((x) => (
                  <div key={x.d} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={tr("{0} من {1}", x.sold, x.cap)}>
                    <span className="num text-[13.5px] font-semibold text-ink">{x.pct}%</span>
                    <div className="relative w-full flex-1 overflow-hidden rounded-md bg-subtle">
                      <div className={cn("absolute inset-x-0 bottom-0 rounded-md transition-[height] duration-700", x.pct >= 90 ? "bg-urgent-dot" : x.pct >= 70 ? "bg-action" : "bg-action/60")}
                        style={{ height: `${Math.min(100, x.pct)}%` }} />
                    </div>
                    <span className="text-[13px] text-slate-500">{x.d === today ? tr("الليلة") : dayLabel(x.d, { weekday: "short" })}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("المغادرة اليوم")}</CardTitle></CardHeader>
            <Table>
              <TableBody>
                {departures.length === 0 && <TableRow><TableCell className="py-8 text-center text-slate-500">{tr("لا مغادرة متوقعة اليوم")}</TableCell></TableRow>}
                {departures.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="cell-fluid"><EntityCell name={r.guest?.full_name ?? ""} href={`/reservations/${r.id}`} /></TableCell>
                    <TableCell className="num font-bold">{r.room?.room_number ?? ""}</TableCell>
                    <TableCell className="text-end">{r.status === "checked_in" && canManage
                      ? <Button asChild size="sm" variant="dark"><Link href={`/reservations/${r.id}`}>{tr("مغادرة")}</Link></Button>
                      : <Badge variant={RESERVATION_STATUS[r.status].variant}>{RESERVATION_STATUS[r.status].label}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <QuickLink href="/rooms" icon={DoorOpen} label={tr("خريطة الغرف")} />
            <QuickLink href="/waitlist" icon={Hourglass} label={tr("قائمة الانتظار{0}", s.waitlist_ready ? tr("، {0} متاح", s.waitlist_ready) : "")} />
          </div>
        </div>
      </div>
    </>
  );
}

const TONES = {
  action: "border-action/30 bg-accent1-tint/70 text-sky",
  amber: "border-amber-dot/40 bg-amber-tint text-amber",
  urgent: "border-urgent/30 bg-urgent-tint text-urgent",
  neutral: "border-line bg-panel text-slate-700",
} as const;

function Alert({ href, icon: Icon, tone, title, text }: { href: string; icon: React.ComponentType<{ className?: string }>; tone: keyof typeof TONES; title: string; text: string }) {
  return (
    <Link href={href} className={cn("group flex items-start gap-3 rounded-lg border p-4 transition-colors", TONES[tone])}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14.5px] opacity-80">{text}</span>
      </span>
    </Link>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link href={href} className="surface lift flex items-center gap-3 p-4 text-[16px] font-medium text-ink">
      <span className="flex size-9 items-center justify-center rounded-[10px] bg-subtle text-slate-700"><Icon className="size-[18px]" /></span>{label}
    </Link>
  );
}
