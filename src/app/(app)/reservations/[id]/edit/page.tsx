import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { timeOf } from "@/lib/pms/dates";
import { getReservation } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { loadReservationFormData } from "../../form-data";
import { ReservationForm } from "../../reservation-form";

/** تعديل حجز مبدئي أو مؤكد: التواريخ والنوع والعدد والتسعير (الليالي القائمة تحتفظ بسعرها) */
export default async function EditReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const { t } = await getI18n();
  const r = await getReservation(ctx.supabase, ctx.hotel.id, id);
  if (!r) notFound();
  if (r.status !== "tentative" && r.status !== "confirmed") redirect(`/reservations/${id}`);
  const data = await loadReservationFormData(ctx);
  const money = (v: string | null) => (v ? String(Number(v)) : "");

  return (
    <>
      <PageHeader title={`تعديل الحجز ${r.confirmation_number}`} description={`${r.guest?.full_name ?? ""} — الليالي القائمة تحتفظ بسعرها المثبّت، والمضافة تُسعَّر بالأسعار الحالية.`} />
      <ReservationForm mode="edit" reservationId={r.id} roomTypes={data.roomTypes.filter((x) => x.mode === r.booking_mode)} rooms={data.roomOptions}
        guests={data.guestOptions} companies={data.companies} today={todayInTimeZone(ctx.hotel.timezone)}
        canOverride={ctx.can(PERMISSIONS.pmsRatesOverride)} canOverbook={ctx.can(PERMISSIONS.pmsOverbook)} errors={t.errors}
        initial={{
          kind: "single", guest_id: r.guest_id,
          new_guest_name: "", new_guest_phone: "", new_guest_id_type: "", new_guest_id_number: "", new_guest_nationality: "",
          room_type_id: r.room_type_id, room_id: r.room_id ?? "",
          arrival_date: r.booking_mode === "nightly" ? r.arrival_date : "", departure_date: r.booking_mode === "nightly" ? r.departure_date : "",
          session_date: r.booking_mode === "hourly" ? r.arrival_date : "", start_time: timeOf(r.starts_at), end_time: timeOf(r.ends_at),
          adults: String(r.adults), children: String(r.children), status: r.status, tentative_until: r.tentative_until ?? "",
          source: r.source, customer_id: r.customer_id ?? "", pricing: r.pricing, fixed_rate: money(r.fixed_rate), rate_reason: r.rate_reason ?? "",
          special_requests: r.special_requests ?? "", notes: r.notes ?? "",
          group_name: "", group_rooms: "", weekday: "", series_start: "", series_end: "", series_nights: "", waitlist_conflicts: false, reprice: false,
        }} />
    </>
  );
}
