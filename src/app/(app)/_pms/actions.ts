"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  bulkRoomsSchema, floorSchema, guestSchema, lastMinuteSchema, quoteSchema, reservationSchema, reservationUpdateSchema,
  roomSchema, roomStatusSchema, roomTypeSchema, seasonSchema, waitlistSchema,
} from "@/lib/validation/pms";
import type { CheckOutSummary, ReservationQuote } from "@/lib/supabase/database.types";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { quoteReservation } from "@/services/pms.service";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

/**
 * عمليات قسم إدارة الفندق. كل قاعدة (السعة، التداخل، الأسعار، الحالات، الصلاحيات)
 * تتحقق منها قاعدة البيانات؛ هنا التحقق من الشكل وتحديث الصفحات بعد الحفظ.
 */
const fail = { ok: false as const, error: "validation" as const };

/** كل تغيير في الحجوزات ينعكس على هذه الصفحات */
function refreshPms(...extra: string[]) {
  for (const p of ["/front-desk", "/reservations", "/tape-chart", "/rooms", "/waitlist", "/guests", ...extra]) revalidatePath(p);
}

// ----------------------------------------------------------------------------- إعداد الغرف
export async function saveFloorAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const p = floorSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { id, ...v } = p.data;
    const { error } = id
      ? await ctx.supabase.from("floors").update(v).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("floors").insert({ ...v, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms("/room-setup");
  return r;
}

export async function deleteFloorAction(id: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("floors").delete().eq("id", id).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms("/room-setup");
  return r;
}

export async function saveRoomTypeAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const p = roomTypeSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { id, ...v } = p.data;
    const payload = { ...v, weekend_rate: v.booking_mode === "hourly" ? null : v.weekend_rate, overbooking_limit: v.booking_mode === "hourly" ? 0 : v.overbooking_limit };
    const { error } = id
      ? await ctx.supabase.from("room_types").update(payload).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("room_types").insert({ ...payload, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms("/room-setup", "/rates");
  return r;
}

export async function saveRoomAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const p = roomSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { id, ...v } = p.data;
    const { error } = id
      ? await ctx.supabase.from("rooms").update(v).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("rooms").insert({ ...v, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms("/room-setup");
  return r;
}

export async function createRoomsBulkAction(input: unknown): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const p = bulkRoomsSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_rooms_bulk", {
      p_hotel_id: ctx.hotel.id, p_room_type_id: p.data.room_type_id, p_from_number: p.data.from_number, p_to_number: p.data.to_number,
      p_floor_id: p.data.floor_id, p_prefix: p.data.prefix,
    });
    raise(error);
    return Number(data ?? 0);
  });
  if (r.ok) refreshPms("/room-setup");
  return r;
}

export async function deleteRoomAction(id: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsSetup);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("rooms").delete().eq("id", id).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms("/room-setup");
  return r;
}

export async function setRoomStatusAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsRoomStatus);
  const p = roomStatusSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("set_room_status", {
      p_room_id: p.data.room_id, p_housekeeping_status: p.data.housekeeping_status ?? null,
      p_service_status: p.data.service_status ?? null, p_service_note: p.data.service_note,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms();
  return r;
}

// ----------------------------------------------------------------------------- النزلاء
export async function saveGuestAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = guestSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { id, ...v } = p.data;
    const payload = { ...v, id_number: v.id_type ? v.id_number : null, blacklist_reason: v.is_blacklisted ? v.blacklist_reason : null };
    if (id) {
      const { error } = await ctx.supabase.from("guests").update(payload).eq("id", id).eq("hotel_id", ctx.hotel.id);
      raise(error);
      return id;
    }
    const { data, error } = await ctx.supabase.from("guests").insert({ ...payload, hotel_id: ctx.hotel.id }).select("id").single();
    raise(error);
    return data!.id as string;
  });
  if (r.ok) refreshPms(`/guests/${r.data}`);
  return r;
}

// ----------------------------------------------------------------------------- الحجوزات
/** طابع زمني محلي للوحدات بالساعة (بتوقيت الفندق): 2026-10-02T16:00:00 */
const ts = (date: string | null, time: string | null) => (date && time ? `${date}T${time}:00` : null);

export async function quoteAction(input: unknown): Promise<ActionResult<ReservationQuote>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const p = quoteSchema.safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  return toActionResult(() => quoteReservation(ctx.supabase, ctx.hotel.id, {
    roomTypeId: v.room_type_id, arrival: v.arrival_date, departure: v.departure_date,
    startsAt: ts(v.session_date, v.start_time), endsAt: ts(v.session_date, v.end_time),
    pricing: v.pricing, fixedRate: v.fixed_rate, excludeId: v.exclude_id,
  }));
}

/**
 * حجز جديد: فردي أو مجموعة أو متكرر. النزيل موجود أو يُنشأ مع الحجز.
 * الناتج: رابط الصفحة التالية ورسالة الملخص (للحجز المتكرر: عدد المواعيد المحجوزة والمتخطاة).
 */
export async function createReservationAction(input: unknown): Promise<ActionResult<{ href: string; message: string }>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = reservationSchema.safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const newGuest = async (): Promise<string> => {
      if (!v.new_guest_name) raise({ message: "Guest name is required" });
      const { data, error } = await ctx.supabase.from("guests").insert({
        hotel_id: ctx.hotel.id, full_name: v.new_guest_name ?? "", phone: v.new_guest_phone, nationality: v.new_guest_nationality,
        id_type: v.new_guest_id_number ? v.new_guest_id_type ?? "national_id" : null, id_number: v.new_guest_id_number,
        customer_id: v.customer_id,
      }).select("id").single();
      raise(error);
      return data!.id as string;
    };
    const guestId: string = v.guest_id ?? (await newGuest());

    if (v.kind === "group") {
      const { data, error } = await ctx.supabase.rpc("create_group_reservation", {
        p_hotel_id: ctx.hotel.id, p_name: v.group_name ?? "", p_guest_id: guestId, p_room_type_id: v.room_type_id,
        // القيم الناقصة تُرسل فارغة فترفضها قاعدة البيانات برسالة عربية دقيقة
        p_arrival_date: v.arrival_date as string, p_departure_date: v.departure_date as string, p_rooms: v.group_rooms ?? 0,
        p_adults: v.adults, p_children: v.children, p_customer_id: v.customer_id, p_status: v.status, p_source: v.source, p_notes: v.notes,
      });
      raise(error);
      return { href: `/reservations?group=${data}`, message: `تم حجز ${v.group_rooms} غرف للمجموعة` };
    }

    if (v.kind === "series") {
      const { data, error } = await ctx.supabase.rpc("create_reservation_series", {
        p_hotel_id: ctx.hotel.id, p_guest_id: guestId, p_room_type_id: v.room_type_id, p_weekday: v.weekday ?? -1,
        p_start_date: v.series_start as string, p_end_date: v.series_end as string, p_nights: v.series_nights,
        p_start_time: v.start_time, p_end_time: v.end_time, p_room_id: v.room_id, p_adults: v.adults, p_children: v.children,
        p_customer_id: v.customer_id, p_source: v.source, p_notes: v.notes, p_waitlist_conflicts: v.waitlist_conflicts,
      });
      raise(error);
      const s = data!;
      const skipped = s.skipped.length ? `، تُخطي ${s.skipped.length} موعد متعارض${s.waitlisted ? ` وأُضيف لقائمة الانتظار` : ""}` : "";
      return { href: `/reservations?series=${s.series_id}`, message: `تم حجز ${s.created} موعدًا${skipped}` };
    }

    const { data, error } = await ctx.supabase.rpc("create_reservation", {
      p_hotel_id: ctx.hotel.id, p_guest_id: guestId, p_room_type_id: v.room_type_id,
      p_arrival_date: v.arrival_date, p_departure_date: v.departure_date,
      p_starts_at: ts(v.session_date, v.start_time), p_ends_at: ts(v.session_date, v.end_time),
      p_adults: v.adults, p_children: v.children, p_room_id: v.room_id, p_status: v.status, p_source: v.source,
      p_customer_id: v.customer_id, p_pricing: v.pricing, p_fixed_rate: v.fixed_rate, p_rate_reason: v.rate_reason,
      p_special_requests: v.special_requests, p_notes: v.notes, p_tentative_until: v.status === "tentative" ? v.tentative_until : null,
    });
    raise(error);
    return { href: `/reservations/${data}`, message: "تم إنشاء الحجز" };
  });
  if (r.ok) refreshPms();
  return r;
}

export async function updateReservationAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = reservationUpdateSchema.safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("update_reservation", {
      p_reservation_id: v.id, p_room_type_id: v.room_type_id, p_arrival_date: v.arrival_date, p_departure_date: v.departure_date,
      p_starts_at: ts(v.session_date, v.start_time), p_ends_at: ts(v.session_date, v.end_time),
      p_adults: v.adults, p_children: v.children, p_source: v.source, p_customer_id: v.customer_id, p_pricing: v.pricing,
      p_fixed_rate: v.fixed_rate, p_rate_reason: v.rate_reason, p_special_requests: v.special_requests, p_notes: v.notes,
      p_tentative_until: v.tentative_until, p_reprice: v.reprice,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms(`/reservations/${v.id}`);
  return r;
}

const id = z.uuid();
async function reservationOp(
  permission: typeof PERMISSIONS.pmsManage | typeof PERMISSIONS.pmsCancel,
  reservationId: string,
  run: (ctx: Awaited<ReturnType<typeof requireAppContext>>) => PromiseLike<{ error: { message: string } | null }>,
): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(permission);
  if (!id.safeParse(reservationId).success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await run(ctx);
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms(`/reservations/${reservationId}`);
  return r;
}

export async function assignRoomAction(reservationId: string, roomId: string | null) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) =>
    ctx.supabase.rpc("assign_reservation_room", { p_reservation_id: reservationId, p_room_id: roomId || null }));
}
export async function confirmReservationAction(reservationId: string) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) => ctx.supabase.rpc("confirm_reservation", { p_reservation_id: reservationId }));
}
export async function cancelReservationAction(reservationId: string, reason: string) {
  return reservationOp(PERMISSIONS.pmsCancel, reservationId, (ctx) =>
    ctx.supabase.rpc("cancel_reservation", { p_reservation_id: reservationId, p_reason: reason }));
}
export async function noShowAction(reservationId: string, reason: string) {
  return reservationOp(PERMISSIONS.pmsCancel, reservationId, (ctx) =>
    ctx.supabase.rpc("mark_reservation_no_show", { p_reservation_id: reservationId, p_reason: reason || null }));
}

/** إلغاء بقية مواعيد الحجز المتكرر من تاريخ (افتراضيًا اليوم بتوقيت الفندق) */
export async function cancelSeriesAction(seriesId: string, reason: string, fromDate?: string | null): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsCancel);
  if (!id.safeParse(seriesId).success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("cancel_reservation_series", { p_series_id: seriesId, p_reason: reason, p_from_date: fromDate || null });
    raise(error);
    return Number(data ?? 0);
  });
  if (r.ok) refreshPms();
  return r;
}

// ----------------------------------------------------------------------------- التسكين والمغادرة
const moneyInput = z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount").transform((v) => toMoney(v).toFixed());

/** تدقيق نهاية اليوم: ترحيل الليالي وعدم الحضور ولقطة تقرير المدير — الناتج تاريخ اليوم المدقق */
export async function runNightAuditAction(date?: string | null): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsNightAudit);
  const d = z.iso.date().nullish().safeParse(date);
  if (!d.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("run_night_audit", { p_hotel_id: ctx.hotel.id, p_date: d.data ?? null });
    raise(error);
    return data!.date;
  });
  if (r.ok) refreshPms("/night-audit", "/guest-register");
  return r;
}

/** عملة طريقة الدفع (null = العملة الأساسية) — المبلغ المُدخل يكون بعملتها */
async function methodCurrency(ctx: Awaited<ReturnType<typeof requireAppContext>>, methodId: string) {
  const { data } = await ctx.supabase.from("payment_methods").select("currency_code").eq("hotel_id", ctx.hotel.id).eq("id", methodId).maybeSingle();
  return (data as { currency_code: string | null } | null)?.currency_code ?? null;
}

export async function recordDepositAction(reservationId: string, input: unknown): Promise<ActionResult<undefined>> {
  const p = z.object({ method: z.uuid(), amount: moneyInput, reference: z.string().trim().max(100).optional() }).safeParse(input);
  if (!p.success) return fail;
  return reservationOp(PERMISSIONS.pmsManage, reservationId, async (ctx) => (await methodCurrency(ctx, p.data.method))
    ? ctx.supabase.rpc("record_reservation_deposit_fx", {
        p_reservation_id: reservationId, p_payment_method_id: p.data.method, p_foreign_amount: p.data.amount, p_reference: p.data.reference || null,
      })
    : ctx.supabase.rpc("record_reservation_deposit", {
        p_reservation_id: reservationId, p_payment_method_id: p.data.method, p_amount: p.data.amount, p_reference: p.data.reference || null,
      }));
}

export async function setBillingAction(reservationId: string, billTo: string) {
  const b = z.enum(["guest", "company_room", "company_all"]).safeParse(billTo);
  if (!b.success) return fail;
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) =>
    ctx.supabase.rpc("set_reservation_billing", { p_reservation_id: reservationId, p_bill_to: b.data }));
}

/** دفعة على فوليو الحجز أثناء المغادرة (تُستخدم للعملات الأجنبية والدفع المجزأ) — الناتج ملخص المغادرة بعدها */
export async function payStayAction(reservationId: string, input: unknown): Promise<ActionResult<CheckOutSummary>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = z.object({ method: z.uuid(), amount: moneyInput, kind: z.enum(["payment", "refund", "deposit_refund"]).default("payment") }).safeParse(input);
  if (!p.success || !id.safeParse(reservationId).success) return fail;
  const r = await toActionResult(async () => {
    const prep = await ctx.supabase.rpc("prepare_check_out", { p_reservation_id: reservationId });
    raise(prep.error);
    const folio = prep.data!.folio_id;
    const pay = (await methodCurrency(ctx, p.data.method))
      ? await ctx.supabase.rpc("post_folio_foreign_money", { p_folio_id: folio, p_txn_type: p.data.kind, p_payment_method_id: p.data.method, p_foreign_amount: p.data.amount })
      : p.data.kind === "refund"
        ? await ctx.supabase.rpc("post_folio_refund", { p_folio_id: folio, p_payment_method_id: p.data.method, p_amount: p.data.amount, p_description: "إرجاع الباقي للنزيل" })
        : p.data.kind === "deposit_refund"
          ? await ctx.supabase.rpc("refund_folio_deposit", { p_folio_id: folio, p_payment_method_id: p.data.method, p_amount: p.data.amount, p_description: "استرداد باقي العربون" })
          : await ctx.supabase.rpc("post_folio_payment", { p_folio_id: folio, p_payment_method_id: p.data.method, p_amount: p.data.amount, p_description: "تحصيل عند المغادرة" });
    raise(pay.error);
    const next = await ctx.supabase.rpc("prepare_check_out", { p_reservation_id: reservationId });
    raise(next.error);
    return next.data!;
  });
  if (r.ok) refreshPms(`/reservations/${reservationId}`, "/cashier");
  return r;
}

export async function checkInAction(reservationId: string, roomId?: string | null) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) =>
    ctx.supabase.rpc("check_in_reservation", { p_reservation_id: reservationId, p_room_id: roomId || null }));
}

export async function postChargesAction(reservationId: string) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) => ctx.supabase.rpc("post_reservation_charges", { p_reservation_id: reservationId }));
}

export async function moveRoomAction(reservationId: string, roomId: string, reason: string) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) =>
    ctx.supabase.rpc("move_reservation_room", { p_reservation_id: reservationId, p_room_id: roomId, p_reason: reason }));
}

export async function changeDepartureAction(reservationId: string, departure: string) {
  return reservationOp(PERMISSIONS.pmsManage, reservationId, (ctx) =>
    ctx.supabase.rpc("change_stay_departure", { p_reservation_id: reservationId, p_departure_date: departure }));
}

/** تجهيز المغادرة: تقصير الإقامة إن كانت مبكرة وترحيل كل الليالي، ثم الرصيد المستحق */
export async function prepareCheckOutAction(reservationId: string): Promise<ActionResult<CheckOutSummary>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  if (!id.safeParse(reservationId).success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("prepare_check_out", { p_reservation_id: reservationId });
    raise(error);
    return data!;
  });
  if (r.ok) refreshPms(`/reservations/${reservationId}`);
  return r;
}

/** تحصيل المتبقي (إن وُجد) ثم المغادرة وإصدار الفاتورة الضريبية — الناتج رقم الفاتورة */
export async function settleAndCheckOutAction(reservationId: string, input: unknown): Promise<ActionResult<string | null>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = z.object({ method: z.string().optional(), amount: z.string().trim().optional(), customer_id: z.string().optional() }).safeParse(input);
  if (!p.success || !id.safeParse(reservationId).success) return fail;
  const r = await toActionResult(async () => {
    const prep = await ctx.supabase.rpc("prepare_check_out", { p_reservation_id: reservationId });
    raise(prep.error);
    const amount = p.data.amount && isValidAmount(p.data.amount) ? toMoney(p.data.amount) : null;
    if (amount && amount.gt(0)) {
      if (!p.data.method) raise({ message: "Select a payment method" });
      const pay = (await methodCurrency(ctx, p.data.method!))
        ? await ctx.supabase.rpc("post_folio_foreign_money", {
            p_folio_id: prep.data!.folio_id, p_txn_type: "payment", p_payment_method_id: p.data.method!, p_foreign_amount: amount.toFixed(),
          })
        : await ctx.supabase.rpc("post_folio_payment", {
            p_folio_id: prep.data!.folio_id, p_payment_method_id: p.data.method!, p_amount: amount.toFixed(),
            p_description: "تحصيل عند المغادرة", p_customer_id: p.data.customer_id || null,
          });
      raise(pay.error);
    }
    const { data, error } = await ctx.supabase.rpc("check_out_reservation", { p_reservation_id: reservationId });
    raise(error);
    return (data as string | null) ?? null;
  });
  if (r.ok) refreshPms(`/reservations/${reservationId}`, "/folios", "/invoices");
  return r;
}

// ----------------------------------------------------------------------------- قائمة الانتظار
export async function addWaitlistAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  const p = waitlistSchema.safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("add_waitlist_entry", {
      p_hotel_id: ctx.hotel.id, p_room_type_id: v.room_type_id, p_arrival_date: v.arrival_date, p_departure_date: v.departure_date,
      p_guest_id: v.guest_id, p_guest_name: v.guest_name, p_phone: v.phone, p_adults: v.adults, p_children: v.children, p_notes: v.notes,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms();
  return r;
}

export async function convertWaitlistAction(entryId: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  if (!id.safeParse(entryId).success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("convert_waitlist_entry", { p_entry_id: entryId });
    raise(error);
    return data as string;
  });
  if (r.ok) refreshPms();
  return r;
}

export async function cancelWaitlistAction(entryId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsManage);
  if (!id.safeParse(entryId).success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("cancel_waitlist_entry", { p_entry_id: entryId });
    raise(error);
    return undefined;
  });
  if (r.ok) refreshPms();
  return r;
}

// ----------------------------------------------------------------------------- الأسعار
export async function saveSeasonAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsRatesManage);
  const p = seasonSchema.safeParse(input);
  if (!p.success) return fail;
  const { id: seasonId, prices, ...v } = p.data;
  const r = await toActionResult(async () => {
    let sid = seasonId;
    if (sid) {
      const { error } = await ctx.supabase.from("rate_seasons").update(v).eq("id", sid).eq("hotel_id", ctx.hotel.id);
      raise(error);
    } else {
      const { data, error } = await ctx.supabase.from("rate_seasons").insert({ ...v, hotel_id: ctx.hotel.id }).select("id").single();
      raise(error);
      sid = data!.id as string;
    }
    // أسعار الأنواع في الموسم: الفارغ يعني «نسبة التعديل على السعر الأساسي»
    const del = await ctx.supabase.from("rate_season_prices").delete().eq("season_id", sid);
    raise(del.error);
    const rows = prices.filter((x) => x.nightly_rate !== null).map((x) => ({
      season_id: sid!, hotel_id: ctx.hotel.id, room_type_id: x.room_type_id, nightly_rate: x.nightly_rate!, weekend_rate: x.weekend_rate,
    }));
    if (rows.length) {
      const { error } = await ctx.supabase.from("rate_season_prices").insert(rows);
      raise(error);
    }
    return undefined;
  });
  if (r.ok) revalidatePath("/rates");
  return r;
}

export async function deleteSeasonAction(seasonId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsRatesManage);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("rate_seasons").delete().eq("id", seasonId).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/rates");
  return r;
}

export async function saveLastMinuteAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsRatesManage);
  const p = lastMinuteSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { id: ruleId, ...v } = p.data;
    const { error } = ruleId
      ? await ctx.supabase.from("last_minute_rules").update(v).eq("id", ruleId).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("last_minute_rules").insert({ ...v, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/rates");
  return r;
}

export async function deleteLastMinuteAction(ruleId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.pmsRatesManage);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("last_minute_rules").delete().eq("id", ruleId).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/rates");
  return r;
}
