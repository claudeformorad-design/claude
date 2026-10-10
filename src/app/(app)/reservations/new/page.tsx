import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BedDouble } from "lucide-react";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, weekdayOf } from "@/lib/pms/dates";
import { getI18n } from "@/i18n/server";
import { loadReservationFormData } from "../form-data";
import { ReservationForm, type ReservationFormValues } from "../reservation-form";

/** حجز جديد: ?guest= لنزيل محدد، ?type=&arrival=&departure= من جدول الإشغال، ?kind=group|series */
export default async function NewReservationPage({ searchParams }: {
  searchParams: Promise<{ guest?: string; type?: string; arrival?: string; departure?: string; room?: string; kind?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const data = await loadReservationFormData(ctx);
  const type = data.roomTypes.find((x) => x.id === sp.type) ?? data.roomTypes.find((x) => x.mode === "nightly") ?? data.roomTypes[0];
  const arrival = sp.arrival && sp.arrival >= today ? sp.arrival : today;
  const kind = sp.kind === "group" || sp.kind === "series" ? sp.kind : "single";

  const initial: ReservationFormValues = {
    kind,
    guest_id: data.guestOptions.some((g) => g.id === sp.guest) ? sp.guest! : "",
    new_guest_name: "", new_guest_phone: "", new_guest_id_type: "", new_guest_id_number: "", new_guest_nationality: "",
    room_type_id: type?.id ?? "", room_id: data.roomOptions.some((r) => r.id === sp.room && r.typeId === type?.id) ? sp.room! : "",
    arrival_date: arrival, departure_date: sp.departure && sp.departure > arrival ? sp.departure : addDays(arrival, 1),
    session_date: arrival, start_time: "16:00", end_time: "20:00",
    adults: "1", children: "0", status: "confirmed", tentative_until: addDays(today, 2),
    source: "direct", customer_id: "", pricing: "standard", fixed_rate: "", rate_reason: "", special_requests: "", notes: "",
    group_name: "", group_rooms: "5",
    weekday: String(weekdayOf(arrival)), series_start: arrival, series_end: addDays(arrival, 8 * 7), series_nights: "2", waitlist_conflicts: true,
    reprice: false,
  };

  return (
    <>
      <PageHeader title={tr("حجز جديد")} />
      {data.roomTypes.length === 0 ? (
        <Card><EmptyState icon={BedDouble} title={tr("لا توجد أنواع غرف")} description={tr("عرّف أنواع الغرف والغرف أولًا لتتمكن من الحجز.")}
          actionHref={ctx.can(PERMISSIONS.pmsSetup) ? "/room-setup" : undefined} actionLabel={tr("إعداد الغرف")} /></Card>
      ) : (
        <ReservationForm mode="create" initial={initial} roomTypes={data.roomTypes} rooms={data.roomOptions} guests={data.guestOptions}
          companies={data.companies} today={today} canOverride={ctx.can(PERMISSIONS.pmsRatesOverride)} canOverbook={ctx.can(PERMISSIONS.pmsOverbook)}
          errors={t.errors} />
      )}
      <p className="mt-6 text-[14.5px] text-slate-500">{tr("تبحث عن غرفة لتاريخ محدد؟")}{" "}<Link href="/tape-chart" className="text-action">{tr("افتح جدول الإشغال")}</Link></p>
    </>
  );
}
