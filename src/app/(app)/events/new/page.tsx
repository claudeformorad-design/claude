import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays } from "@/lib/pms/dates";
import { getI18n } from "@/i18n/server";
import { EventForm } from "../event-form";
import { eventFormOptions } from "../form-data";

export default async function NewEventPage() {
  const ctx = await requireAppContext(PERMISSIONS.eventsManage);
  const { locale, t } = await getI18n();
  const o = await eventFormOptions(ctx);
  const day = addDays(todayInTimeZone(ctx.hotel.timezone), 7);
  return (
    <>
      <PageHeader title={tr("مناسبة جديدة")} />
      <EventForm errors={t.errors} locale={locale} decimals={o.decimals} types={o.types} halls={o.halls} customers={o.customers} chargeCodes={o.chargeCodes}
        initial={{
          id: "", title: "", event_type: "wedding", contact_name: "", contact_phone: "", customer_id: "", hall_room_id: o.halls[0]?.id ?? "",
          starts_at: `${day}T18:00`, ends_at: `${day}T23:00`, guests_count: "", discount: "", notes: "", terms: "",
          items: [{ description: tr("تأجير القاعة"), per_person: false, quantity: "1", unit_price: "", charge_code_id: "" }],
        }} />
    </>
  );
}
