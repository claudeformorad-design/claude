import { z } from "zod";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, normalizeDigits, toMoney } from "@/lib/accounting/money";

/**
 * مخططات Zod لقسم إدارة الفندق. قاعدة البيانات تعيد التحقق من كل القواعد
 * (السعة، التداخل، الصلاحيات، الأسعار)؛ هنا نتحقق من الشكل لتغذية راجعة سريعة.
 */
const optText = (max = 500) => z.string().trim().max(max).optional().transform((v) => (v === undefined || v === "" ? null : v));
const optUuid = z.string().trim().optional().transform((v) => (v === undefined || v === "" ? null : v)).pipe(z.uuid().nullable());
const date = z.string().trim().refine(isIsoDate, "invalid_date");
const optDate = z.string().trim().optional().refine((v) => !v || isIsoDate(v), "invalid_date").transform((v) => (v ? v : null));
const optTime = z.string().trim().optional().refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "invalid_time").transform((v) => (v ? v : null));
const int = (min: number, max: number) => z.union([z.string(), z.number()]).transform((v) => Number(normalizeDigits(String(v)).trim())).pipe(z.number().int().min(min).max(max));
const amount = z.string().trim().refine((v) => isValidAmount(v) && !toMoney(v).isNegative(), "invalid_amount").transform((v) => toMoney(v).toFixed());
const optAmount = z.string().trim().optional()
  .refine((v) => !v || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount")
  .transform((v) => (v ? toMoney(v).toFixed() : null));
const pct = (min: number, max: number) => z.string().trim().optional()
  .refine((v) => !v || (isValidAmount(v) && toMoney(v).gt(min) && toMoney(v).lte(max)), "invalid_amount")
  .transform((v) => (v ? toMoney(v).toFixed() : null));
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "code_format");

export const floorSchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(60), sort_order: int(0, 999) });

export const roomTypeSchema = z.object({
  id: z.uuid().optional(),
  code,
  name_ar: z.string().trim().min(1).max(100),
  booking_mode: z.enum(["nightly", "hourly"]),
  max_adults: int(1, 1000),
  max_children: int(0, 50),
  base_rate: amount,
  weekend_rate: optAmount,
  min_hours: z.string().trim().optional().transform((v) => (v ? toMoney(v).toFixed() : "1")),
  overbooking_limit: int(0, 100),
  charge_code_id: optUuid,
  description: optText(500),
  is_active: z.boolean(),
});
export type RoomTypeValues = z.output<typeof roomTypeSchema>;

export const roomSchema = z.object({
  id: z.uuid().optional(),
  room_number: z.string().trim().min(1).max(20),
  room_type_id: z.uuid(),
  floor_id: optUuid,
  notes: optText(300),
  is_active: z.boolean(),
});

export const bulkRoomsSchema = z.object({
  room_type_id: z.uuid(),
  floor_id: optUuid,
  from_number: int(0, 99999),
  to_number: int(0, 99999),
  prefix: optText(5),
});

export const roomStatusSchema = z.object({
  room_id: z.uuid(),
  housekeeping_status: z.enum(["clean", "dirty", "inspected"]).optional(),
  service_status: z.enum(["in_service", "out_of_service"]).optional(),
  service_note: optText(300),
});

export const guestSchema = z.object({
  id: z.uuid().optional(),
  full_name: z.string().trim().min(1).max(150),
  phone: optText(40),
  email: optText(120),
  nationality: optText(60),
  id_type: z.enum(["national_id", "passport", "residence", "other", ""]).optional().transform((v) => (v ? v : null)),
  id_number: optText(40),
  date_of_birth: optDate,
  customer_id: optUuid,
  notes: optText(1000),
  is_blacklisted: z.boolean(),
  blacklist_reason: optText(300),
});
export type GuestValues = z.output<typeof guestSchema>;

/** نزيل الحجز: موجود (guest_id) أو جديد يُنشأ مع الحجز */
const guestRef = z.object({
  guest_id: optUuid,
  new_guest_name: optText(150),
  new_guest_phone: optText(40),
  new_guest_id_type: z.enum(["national_id", "passport", "residence", "other", ""]).optional().transform((v) => (v ? v : null)),
  new_guest_id_number: optText(40),
  new_guest_nationality: optText(60),
});

const stayFields = {
  room_type_id: z.uuid(),
  arrival_date: optDate,
  departure_date: optDate,
  session_date: optDate,
  start_time: optTime,
  end_time: optTime,
  adults: int(1, 1000),
  children: int(0, 50),
  source: z.enum(["direct", "phone", "walk_in", "website", "booking_com", "expedia", "agent", "corporate", "other"]),
  customer_id: optUuid,
  pricing: z.enum(["standard", "fixed", "monthly"]),
  fixed_rate: optAmount,
  rate_reason: optText(300),
  special_requests: optText(1000),
  notes: optText(1000),
};

export const reservationSchema = guestRef.extend({
  ...stayFields,
  kind: z.enum(["single", "group", "series"]),
  room_id: optUuid,
  status: z.enum(["tentative", "confirmed"]),
  tentative_until: optDate,
  // المجموعة
  group_name: optText(150),
  group_rooms: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined || v === "" ? null : Number(normalizeDigits(String(v))))),
  // التكرار
  weekday: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined || v === "" ? null : Number(v))),
  series_start: optDate,
  series_end: optDate,
  series_nights: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined || v === "" ? null : Number(normalizeDigits(String(v))))),
  waitlist_conflicts: z.boolean().optional().transform((v) => v ?? true),
});
export type ReservationInput = z.input<typeof reservationSchema>;
export type ReservationValues = z.output<typeof reservationSchema>;

export const reservationUpdateSchema = z.object({
  id: z.uuid(),
  ...stayFields,
  tentative_until: optDate,
  reprice: z.boolean(),
});
export type ReservationUpdateInput = z.input<typeof reservationUpdateSchema>;

export const quoteSchema = z.object({
  room_type_id: z.uuid(),
  arrival_date: optDate,
  departure_date: optDate,
  session_date: optDate,
  start_time: optTime,
  end_time: optTime,
  pricing: z.enum(["standard", "fixed", "monthly"]),
  fixed_rate: optAmount,
  exclude_id: optUuid,
});

export const waitlistSchema = z.object({
  room_type_id: z.uuid(),
  arrival_date: date,
  departure_date: date,
  guest_id: optUuid,
  guest_name: optText(150),
  phone: optText(40),
  adults: int(1, 50),
  children: int(0, 50),
  notes: optText(500),
});

export const seasonSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  date_from: date,
  date_to: date,
  adjust_pct: pct(-100, 500),
  is_active: z.boolean(),
  notes: optText(500),
  prices: z.array(z.object({ room_type_id: z.uuid(), nightly_rate: optAmount, weekend_rate: optAmount })),
});
export type SeasonInput = z.input<typeof seasonSchema>;

export const lastMinuteSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  room_type_id: optUuid,
  days_before: int(0, 30),
  discount_pct: z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0) && toMoney(v).lt(100), "invalid_amount").transform((v) => toMoney(v).toFixed()),
  is_active: z.boolean(),
});
