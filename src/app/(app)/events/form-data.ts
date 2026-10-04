import "server-only";
import { tr } from "@/i18n/tr";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { localNameOf } from "@/lib/local-name";
import { EVENT_TYPE } from "@/lib/ops/labels";
import { listRooms, listRoomTypes } from "@/services/pms.service";
import { listChargeCodes } from "@/services/revenue-settings.service";
import { baseDecimals } from "@/services/guest-services.service";

/** خيارات نموذج المناسبة: القاعات (غرف الحجز بالساعة)، الشركات، رموز الإيراد */
export async function eventFormOptions(ctx: AppContext) {
  const [rooms, types, codes, customers, decimals] = await Promise.all([
    listRooms(ctx.supabase, ctx.hotel.id), listRoomTypes(ctx.supabase, ctx.hotel.id), listChargeCodes(ctx.supabase, ctx.hotel.id),
    ctx.can(PERMISSIONS.customersView)
      ? ctx.supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("is_active", true).order("code")
      : Promise.resolve({ data: [] as { id: string; code: string; name_ar: string; name_en: string | null }[] }),
    baseDecimals(ctx.supabase, ctx.hotel.base_currency),
  ]);
  const hourly = new Map(types.filter((t) => t.booking_mode === "hourly").map((t) => [t.id, localNameOf(t)]));
  return {
    decimals,
    types: Object.entries(EVENT_TYPE).map(([id, label]) => ({ id, label })),
    halls: rooms.filter((r) => r.is_active && hourly.has(r.room_type_id)).map((r) => ({ id: r.id, label: tr("{0}، {1}", r.room_number, hourly.get(r.room_type_id)!) })),
    customers: (customers.data ?? []).map((c) => ({ id: c.id, label: `${c.code} ${localNameOf(c)}` })),
    chargeCodes: codes.filter((c) => c.is_active && c.code !== "EVENTS").map((c) => ({ id: c.id, label: localNameOf(c) })),
  };
}
