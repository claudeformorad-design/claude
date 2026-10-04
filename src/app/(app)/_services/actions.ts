"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

/** عمليات خدمات التشغيل: القواعد كلها في قاعدة البيانات، وهنا التحقق من الشكل فقط */
const fail = { ok: false as const, error: "validation" as const };
const uuid = z.uuid();
const optUuid = uuid.optional().nullable().or(z.literal("")).transform((v) => v || null);
const money = (min0 = false) => z.string().trim().refine((v) => isValidAmount(v) && (min0 ? !toMoney(v).isNegative() : toMoney(v).gt(0)), "invalid_amount").transform((v) => toMoney(v).toFixed());
const optMoney = z.string().trim().optional().refine((v) => !v || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount").transform((v) => (v ? toMoney(v).toFixed() : null));
const bool = z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on");
const text = z.string().trim().min(1).max(500);
const optText = z.string().trim().max(2000).optional().nullable().transform((v) => v || null);
const optDate = z.union([z.iso.date(), z.literal("")]).optional().nullable().transform((v) => v || null);
const qty = z.coerce.number().positive().max(100000);
/** وقت محلي من حقل datetime-local بصيغة YYYY-MM-DDTHH:mm */
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);

async function run<T>(permission: Permission, paths: string[], fn: (ctx: Awaited<ReturnType<typeof requireAppContext>>) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireAppContext(permission);
  const r = await toActionResult(() => fn(ctx));
  if (r.ok) for (const p of paths) revalidatePath(p);
  return r;
}

// ----------------------------------------------------------------------------- الصيانة
const MAINT = ["/maintenance", "/rooms", "/front-desk"];

export async function createMaintenanceRequestAction(input: unknown) {
  const p = z.object({
    title: text, description: optText, room_id: optUuid, asset_id: optUuid, location: optText,
    priority: z.enum(["low", "normal", "high", "urgent"]), out_of_service: bool, due_date: optDate,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.maintenanceReport, MAINT, async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("create_maintenance_request", {
      p_hotel_id: ctx.hotel.id, p_title: p.data.title, p_description: p.data.description, p_room_id: p.data.room_id, p_asset_id: p.data.asset_id,
      p_location: p.data.location, p_priority: p.data.priority, p_out_of_service: p.data.out_of_service, p_due_date: p.data.due_date,
    });
    raise(error);
    return data!;
  });
}

export async function updateMaintenanceRequestAction(requestId: string, input: unknown) {
  const p = z.object({
    status: z.enum(["open", "in_progress", "on_hold", "done", "cancelled"]).optional(),
    assignee: z.string().trim().max(100).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    resolution: z.string().trim().max(2000).optional(), labor_cost: optMoney,
  }).safeParse(input);
  if (!p.success || !uuid.safeParse(requestId).success) return fail;
  return run(PERMISSIONS.maintenanceManage, [...MAINT, `/maintenance/${requestId}`], async (ctx) => {
    const { error } = await ctx.supabase.rpc("update_maintenance_request", {
      p_request_id: requestId, p_status: p.data.status ?? null, p_assignee: p.data.assignee ?? null, p_priority: p.data.priority ?? null,
      p_resolution: p.data.resolution || null, p_labor_cost: p.data.labor_cost,
    });
    raise(error);
    return undefined;
  });
}

export async function addMaintenancePartAction(requestId: string, input: unknown) {
  const p = z.object({ description: z.string().trim().max(500).optional(), quantity: qty, unit_cost: optMoney, item_id: optUuid }).safeParse(input);
  if (!p.success || !uuid.safeParse(requestId).success) return fail;
  return run(PERMISSIONS.maintenanceManage, [`/maintenance/${requestId}`, "/maintenance", "/inventory"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("add_maintenance_part", {
      p_request_id: requestId, p_description: p.data.description ?? "", p_quantity: String(p.data.quantity), p_unit_cost: p.data.unit_cost, p_item_id: p.data.item_id,
    });
    raise(error);
    return undefined;
  });
}

export async function saveMaintenanceAssetAction(input: unknown) {
  const p = z.object({
    id: uuid.optional().or(z.literal("")), name: text, code: z.string().trim().max(30).optional().transform((v) => v || null),
    category: z.enum(["ac", "electrical", "plumbing", "appliance", "furniture", "elevator", "generator", "it", "other"]),
    room_id: optUuid, location: optText, brand: optText, serial_number: optText, purchase_date: optDate, warranty_until: optDate, notes: optText, is_active: bool,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.maintenanceManage, ["/maintenance/assets"], async (ctx) => {
    const { id, ...row } = p.data;
    const values = { ...row, is_active: id ? row.is_active : true };
    const { error } = id
      ? await ctx.supabase.from("maintenance_assets").update(values).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("maintenance_assets").insert({ ...values, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- المفقودات والأمانات
const LOST = ["/lost-found"];

export async function registerLostItemAction(input: unknown) {
  const p = z.object({
    description: text, category: z.enum(["electronics", "documents", "money", "jewelry", "clothing", "bags", "other"]), found_date: optDate,
    room_id: optUuid, found_location: optText, found_by: optText, storage_location: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.lostFoundManage, LOST, async (ctx) => {
    const { error } = await ctx.supabase.rpc("register_lost_item", {
      p_hotel_id: ctx.hotel.id, p_description: p.data.description, p_found_date: p.data.found_date, p_category: p.data.category,
      p_room_id: p.data.room_id, p_found_location: p.data.found_location, p_found_by: p.data.found_by, p_storage_location: p.data.storage_location,
    });
    raise(error);
    return undefined;
  });
}

async function closeLostItem(itemId: string, input: unknown) {
  const p = z.object({ action: z.enum(["return", "dispose"]), returned_to: optText, id_number: optText, note: optText }).safeParse(input);
  if (!p.success || !uuid.safeParse(itemId).success) return fail;
  return run(PERMISSIONS.lostFoundManage, LOST, async (ctx) => {
    const { error } = await ctx.supabase.rpc("close_lost_item", {
      p_item_id: itemId, p_action: p.data.action, p_returned_to: p.data.returned_to, p_id_number: p.data.id_number, p_note: p.data.note,
    });
    raise(error);
    return undefined;
  });
}

/** تسليم الغرض لصاحبه باسم المستلم ورقم هويته */
export async function returnLostItemAction(itemId: string, input: unknown) {
  return closeLostItem(itemId, { ...(input as object), action: "return" });
}

/** إتلاف الغرض أو التبرع به بعد انتهاء مدة الحفظ، مع السبب */
export async function disposeLostItemAction(itemId: string, reason: string) {
  return closeLostItem(itemId, { action: "dispose", note: reason });
}

export async function openSafeDepositAction(input: unknown) {
  const p = z.object({ reservation_id: optUuid, guest_name: z.string().trim().max(200).optional(), box_number: text, items: text }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.lostFoundManage, LOST, async (ctx) => {
    let guest = p.data.guest_name ?? "";
    if (!guest && p.data.reservation_id) {
      const { data } = await ctx.supabase.rpc("services_in_house", { p_hotel_id: ctx.hotel.id });
      guest = (data ?? []).find((r) => r.reservation_id === p.data.reservation_id)?.guest_name ?? "";
    }
    const { error } = await ctx.supabase.rpc("open_safe_deposit", {
      p_hotel_id: ctx.hotel.id, p_guest_name: guest, p_box_number: p.data.box_number, p_items: p.data.items, p_reservation_id: p.data.reservation_id,
    });
    raise(error);
    return undefined;
  });
}

export async function returnSafeDepositAction(depositId: string, note: string) {
  if (!uuid.safeParse(depositId).success) return fail;
  return run(PERMISSIONS.lostFoundManage, LOST, async (ctx) => {
    const { error } = await ctx.supabase.rpc("return_safe_deposit", { p_deposit_id: depositId, p_note: note.trim().slice(0, 500) || null });
    raise(error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- المغسلة
const LAUNDRY = ["/laundry", "/laundry/setup"];

export async function saveLaundryItemAction(input: unknown) {
  const p = z.object({
    id: uuid.optional().or(z.literal("")), name: text, service: z.enum(["wash", "iron", "wash_iron", "dry_clean"]), price: money(), is_active: bool,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.laundryManage, LAUNDRY, async (ctx) => {
    const row = { name: p.data.name, service: p.data.service, price: p.data.price, is_active: p.data.id ? p.data.is_active : true };
    if (p.data.id) {
      const { error } = await ctx.supabase.from("laundry_items").update(row).eq("id", p.data.id).eq("hotel_id", ctx.hotel.id);
      raise(error);
    } else {
      // رمز إيراد المغسلة الافتراضي
      const { data: cc, error: e1 } = await ctx.supabase.from("charge_codes").select("id").eq("hotel_id", ctx.hotel.id).eq("code", "LAUNDRY").maybeSingle();
      raise(e1);
      if (!cc) raise({ message: "Revenue code not found" });
      const { error } = await ctx.supabase.from("laundry_items").insert({ ...row, hotel_id: ctx.hotel.id, charge_code_id: cc!.id });
      raise(error);
    }
    return undefined;
  });
}

export async function createLaundryOrderAction(input: unknown) {
  const p = z.object({
    reservation_id: uuid, lines: z.array(z.object({ item_id: uuid, quantity: z.coerce.number().int().min(1).max(500) })).min(1),
    express: z.boolean(), express_pct: z.coerce.number().min(0).max(300), notes: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.laundryManage, LAUNDRY, async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("create_laundry_order", {
      p_reservation_id: p.data.reservation_id, p_lines: p.data.lines, p_express: p.data.express, p_express_pct: String(p.data.express_pct),
      p_notes: p.data.notes,
    });
    raise(error);
    return data!;
  });
}

export async function updateLaundryOrderAction(orderId: string, status: string) {
  if (!uuid.safeParse(orderId).success || !["in_process", "ready", "delivered", "cancelled"].includes(status)) return fail;
  return run(PERMISSIONS.laundryManage, [...LAUNDRY, "/folios"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("update_laundry_order", { p_order_id: orderId, p_status: status });
    raise(error);
    return undefined;
  });
}

export async function saveLinenTypeAction(input: unknown) {
  const p = z.object({ id: uuid.optional().or(z.literal("")), name: text, par_level: z.coerce.number().int().min(0).max(100000), is_active: bool }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.laundryManage, LAUNDRY, async (ctx) => {
    const row = { name: p.data.name, par_level: p.data.par_level, is_active: p.data.id ? p.data.is_active : true };
    const { error } = p.data.id
      ? await ctx.supabase.from("linen_types").update(row).eq("id", p.data.id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("linen_types").insert({ ...row, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

export async function addLinenMovementAction(input: unknown) {
  const p = z.object({
    linen_type_id: uuid, kind: z.enum(["purchased", "sent", "returned", "damaged"]), quantity: z.coerce.number().int().min(1).max(100000),
    movement_date: z.iso.date(), notes: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.laundryManage, LAUNDRY, async (ctx) => {
    const { error } = await ctx.supabase.from("linen_movements").insert({ ...p.data, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- المناسبات
const EVENTS = ["/events"];
const eventInput = z.object({
  id: uuid.optional().nullable().or(z.literal("")).transform((v) => v || null),
  title: text, event_type: z.enum(["wedding", "conference", "meeting", "party", "graduation", "other"]), contact_name: text,
  contact_phone: optText, customer_id: optUuid, hall_room_id: optUuid, starts_at: localTime, ends_at: localTime,
  guests_count: z.coerce.number().int().min(0).max(100000), discount: optMoney, notes: optText, terms: optText,
  items: z.array(z.object({
    description: text, per_person: z.boolean(), quantity: qty, unit_price: money(true), charge_code_id: optUuid,
  })).min(1),
}).refine((v) => v.ends_at > v.starts_at, { path: ["ends_at"] });

export async function saveEventAction(input: unknown) {
  const p = eventInput.safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  return run(PERMISSIONS.eventsManage, [...EVENTS, ...(v.id ? [`/events/${v.id}`] : [])], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("save_event", {
      p_hotel_id: ctx.hotel.id, p_event_id: v.id, p_title: v.title, p_event_type: v.event_type, p_contact_name: v.contact_name,
      p_contact_phone: v.contact_phone, p_customer_id: v.customer_id, p_hall_room_id: v.hall_room_id, p_starts_at: v.starts_at, p_ends_at: v.ends_at,
      p_guests_count: v.guests_count, p_discount: v.discount ?? "0", p_notes: v.notes, p_terms: v.terms,
      p_items: v.items.map((i) => ({ ...i, quantity: String(i.quantity) })),
    });
    raise(error);
    return data!;
  });
}

export async function confirmEventAction(eventId: string) {
  if (!uuid.safeParse(eventId).success) return fail;
  return run(PERMISSIONS.eventsManage, [...EVENTS, `/events/${eventId}`, "/folios"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("confirm_event", { p_event_id: eventId });
    raise(error);
    return undefined;
  });
}

export async function completeEventAction(eventId: string) {
  if (!uuid.safeParse(eventId).success) return fail;
  return run(PERMISSIONS.eventsManage, [...EVENTS, `/events/${eventId}`, "/folios"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("complete_event", { p_event_id: eventId });
    raise(error);
    return undefined;
  });
}

export async function cancelEventAction(eventId: string, reason: string) {
  if (!uuid.safeParse(eventId).success) return fail;
  return run(PERMISSIONS.eventsManage, [...EVENTS, `/events/${eventId}`], async (ctx) => {
    const { error } = await ctx.supabase.rpc("cancel_event", { p_event_id: eventId, p_reason: reason });
    raise(error);
    return undefined;
  });
}

export async function addEventTaskAction(eventId: string, input: unknown) {
  const p = z.object({ due_at: localTime, task: text, owner: optText }).safeParse(input);
  if (!p.success || !uuid.safeParse(eventId).success) return fail;
  return run(PERMISSIONS.eventsManage, [`/events/${eventId}`], async (ctx) => {
    const { error } = await ctx.supabase.from("event_tasks").insert({ ...p.data, hotel_id: ctx.hotel.id, event_id: eventId });
    raise(error);
    return undefined;
  });
}

export async function toggleEventTaskAction(eventId: string, taskId: string, done: boolean) {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(taskId).success) return fail;
  return run(PERMISSIONS.eventsManage, [`/events/${eventId}`], async (ctx) => {
    const { error } = await ctx.supabase.from("event_tasks").update({ done, done_at: done ? new Date().toISOString() : null })
      .eq("id", taskId).eq("event_id", eventId).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- تقييمات النزلاء
const rating = z.coerce.number().int().min(1).max(5);
const optRating = z.union([z.literal(""), z.null(), rating]).optional().transform((v) => (typeof v === "number" ? v : null));

export async function recordPaperSurveyAction(input: unknown) {
  const p = z.object({
    guest_name: optText, room_number: optText, overall: rating, cleanliness: optRating, staff: optRating, comfort: optRating, value: optRating, food: optRating,
    recommend: z.enum(["yes", "no", ""]).optional(), comment: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.feedbackManage, ["/surveys"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("record_paper_survey", {
      p_hotel_id: ctx.hotel.id, p_guest_name: p.data.guest_name, p_room_number: p.data.room_number, p_overall: p.data.overall,
      p_cleanliness: p.data.cleanliness, p_staff: p.data.staff, p_comfort: p.data.comfort, p_value: p.data.value, p_food: p.data.food,
      p_recommend: p.data.recommend === "yes" ? true : p.data.recommend === "no" ? false : null, p_comment: p.data.comment,
    });
    raise(error);
    return undefined;
  });
}
