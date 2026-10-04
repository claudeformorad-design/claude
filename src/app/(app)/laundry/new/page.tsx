import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { LAUNDRY_SERVICE } from "@/lib/ops/labels";
import { baseDecimals, listLaundryItems, servicesInHouse } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { LaundryOrderForm } from "./order-form";

export default async function NewLaundryOrderPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.laundryManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [items, guests, dec] = await Promise.all([
    listLaundryItems(ctx.supabase, ctx.hotel.id), servicesInHouse(ctx.supabase, ctx.hotel.id), baseDecimals(ctx.supabase, ctx.hotel.base_currency),
  ]);
  return (
    <>
      <PageHeader title={tr("طلب غسيل")} />
      <LaundryOrderForm errors={t.errors} locale={locale} decimals={dec} initialGuest={sp.reservation}
        items={items.filter((i) => i.is_active).map((i) => ({ id: i.id, name: i.name, service: LAUNDRY_SERVICE[i.service], price: Number(i.price) }))}
        guests={guests.map((g) => ({ reservation_id: g.reservation_id, label: g.room_number ? tr("غرفة {0}، {1}", g.room_number, g.guest_name) : g.guest_name }))} />
    </>
  );
}
