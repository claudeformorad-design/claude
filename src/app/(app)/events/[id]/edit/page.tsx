import { tr } from "@/i18n/tr";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getEvent } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { EventForm } from "../../event-form";
import { eventFormOptions } from "../../form-data";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.eventsManage);
  const { locale, t } = await getI18n();
  const [d, o] = await Promise.all([getEvent(ctx.supabase, ctx.hotel.id, id), eventFormOptions(ctx)]);
  if (!d) notFound();
  const e = d.event;
  if (e.status === "completed" || e.status === "cancelled") redirect(`/events/${id}`);
  const n = (v: string) => String(Number(v));
  return (
    <>
      <PageHeader title={tr("تعديل {0}", e.title)} />
      <EventForm errors={t.errors} locale={locale} decimals={o.decimals} types={o.types} halls={o.halls} customers={o.customers} chargeCodes={o.chargeCodes}
        initial={{
          id: e.id, title: e.title, event_type: e.event_type, contact_name: e.contact_name, contact_phone: e.contact_phone ?? "", customer_id: e.customer_id ?? "",
          hall_room_id: e.hall_room_id ?? "", starts_at: e.starts_at.replace(" ", "T").slice(0, 16), ends_at: e.ends_at.replace(" ", "T").slice(0, 16), guests_count: String(e.guests_count),
          discount: Number(e.discount) ? n(e.discount) : "", notes: e.notes ?? "", terms: e.terms ?? "",
          items: d.items.map((i) => ({
            description: i.description, per_person: i.per_person, quantity: n(i.quantity), unit_price: n(i.unit_price),
            charge_code_id: o.chargeCodes.some((c) => c.id === i.charge_code_id) ? i.charge_code_id : "",
          })),
        }} />
    </>
  );
}
