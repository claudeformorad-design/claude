import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listCompanyOptions, listGuests, listRooms, listRoomTypes } from "@/services/pms.service";
import type { GuestOption, RoomOption, RoomTypeOption } from "./reservation-form";

/** بيانات نموذج الحجز: الأنواع النشطة، الغرف القابلة للتخصيص، النزلاء، والشركات */
export async function loadReservationFormData(ctx: AppContext) {
  const [types, rooms, guests, companies] = await Promise.all([
    listRoomTypes(ctx.supabase, ctx.hotel.id),
    listRooms(ctx.supabase, ctx.hotel.id),
    listGuests(ctx.supabase, ctx.hotel.id),
    ctx.can(PERMISSIONS.customersView) ? listCompanyOptions(ctx.supabase, ctx.hotel.id) : Promise.resolve([]),
  ]);
  const roomTypes: RoomTypeOption[] = types.filter((t) => t.is_active).map((t) => ({
    id: t.id, code: t.code, name: t.name_ar, mode: t.booking_mode, maxAdults: t.max_adults, maxChildren: t.max_children, minHours: Number(t.min_hours),
  }));
  const roomOptions: RoomOption[] = rooms.filter((r) => r.is_active && r.service_status === "in_service").map((r) => ({ id: r.id, number: r.room_number, typeId: r.room_type_id }));
  const guestOptions: GuestOption[] = guests.map((g) => ({ id: g.id, name: g.full_name, phone: g.phone, idNumber: g.id_number, blacklisted: g.is_blacklisted }));
  return { roomTypes, roomOptions, guestOptions, companies };
}
