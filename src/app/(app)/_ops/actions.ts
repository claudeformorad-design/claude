"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

/** عمليات الأقسام التشغيلية — القواعد كلها في قاعدة البيانات، وهنا التحقق من الشكل */
const fail = { ok: false as const, error: "validation" as const };
const uuid = z.uuid();
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/);
const money = (min0 = false) => z.string().trim().refine((v) => isValidAmount(v) && (min0 ? !toMoney(v).isNegative() : toMoney(v).gt(0)), "invalid_amount").transform((v) => toMoney(v).toFixed());
const bool = z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on");
const optText = z.string().trim().max(500).optional().transform((v) => v || null);

async function run<T>(permission: string, paths: string[], fn: (ctx: Awaited<ReturnType<typeof requireAppContext>>) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireAppContext(permission as Parameters<typeof requireAppContext>[0]);
  const r = await toActionResult(() => fn(ctx));
  if (r.ok) for (const p of paths) revalidatePath(p);
  return r;
}

// ----------------------------------------------------------------------------- نقاط البيع
export async function saveOutletAction(input: unknown) {
  const p = z.object({ id: uuid.optional().or(z.literal("")), code, name_ar: z.string().trim().min(1), is_active: bool }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.posManage, ["/pos", "/pos/setup"], async (ctx) => {
    const row = { code: p.data.code, name_ar: p.data.name_ar, is_active: p.data.id ? p.data.is_active : true };
    const { error } = p.data.id
      ? await ctx.supabase.from("pos_outlets").update(row).eq("id", p.data.id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("pos_outlets").insert({ ...row, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

export async function savePosItemAction(input: unknown) {
  const p = z.object({
    id: uuid.optional().or(z.literal("")), outlet_id: uuid, item_name: z.string().trim().min(1), category: optText,
    price: money(), charge_code_id: uuid, is_active: bool,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.posManage, ["/pos", "/pos/setup"], async (ctx) => {
    const row = {
      outlet_id: p.data.outlet_id, name_ar: p.data.item_name, category: p.data.category, price: p.data.price,
      charge_code_id: p.data.charge_code_id, is_active: p.data.id ? p.data.is_active : true,
    };
    const { error } = p.data.id
      ? await ctx.supabase.from("pos_items").update(row).eq("id", p.data.id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("pos_items").insert({ ...row, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

export async function settlePosOrderAction(input: unknown) {
  const p = z.object({
    outlet_id: uuid,
    lines: z.array(z.object({ item_id: uuid, quantity: z.coerce.number().positive().max(1000) })).min(1),
    mode: z.enum(["room", "paid"]),
    reservation_id: uuid.optional().nullable(),
    payment_method_id: uuid.optional().nullable(),
    note: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.posSell, ["/pos", "/folios", "/invoices"], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("pos_settle_order", {
      p_outlet_id: p.data.outlet_id, p_lines: p.data.lines.map((l) => ({ item_id: l.item_id, quantity: String(l.quantity) })),
      p_mode: p.data.mode, p_reservation_id: p.data.reservation_id ?? null, p_payment_method_id: p.data.payment_method_id ?? null, p_note: p.data.note,
    });
    raise(error);
    return data!;
  });
}

// ----------------------------------------------------------------------------- التدبير الفندقي
export async function generateHousekeepingAction(date: string) {
  if (!z.iso.date().safeParse(date).success) return fail;
  return run(PERMISSIONS.pmsHousekeeping, ["/housekeeping"], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("generate_housekeeping_tasks", { p_hotel_id: ctx.hotel.id, p_date: date });
    raise(error);
    return data as number;
  });
}

export async function addHousekeepingTaskAction(input: unknown) {
  const p = z.object({
    room_id: uuid, kind: z.enum(["departure", "stayover", "inspection", "maintenance", "turndown"]),
    date: z.iso.date(), notes: optText, assignee: optText, out_of_service: bool,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.pmsHousekeeping, ["/housekeeping", "/rooms", "/front-desk"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("add_housekeeping_task", {
      p_room_id: p.data.room_id, p_kind: p.data.kind, p_date: p.data.date, p_notes: p.data.notes, p_assignee: p.data.assignee,
      p_out_of_service: p.data.out_of_service,
    });
    raise(error);
    return undefined;
  });
}

export async function updateHousekeepingTaskAction(taskId: string, input: unknown) {
  const p = z.object({
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(), assignee: z.string().trim().max(100).optional(),
  }).safeParse(input);
  if (!p.success || !uuid.safeParse(taskId).success) return fail;
  return run(PERMISSIONS.pmsHousekeeping, ["/housekeeping", "/rooms", "/front-desk"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("update_housekeeping_task", {
      p_task_id: taskId, p_status: p.data.status ?? null, p_assignee: p.data.assignee ?? null,
    });
    raise(error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- خطط الأسعار
export async function saveRatePlanAction(input: unknown) {
  const p = z.object({
    id: uuid.optional().or(z.literal("")), code, name_ar: z.string().trim().min(1),
    adjust_pct: z.string().trim().refine((v) => v === "" || (/^-?\d+(\.\d{1,3})?$/.test(v) && Number(v) >= -100 && Number(v) <= 500), "invalid_amount"),
    per_night: z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount"),
    per_person: bool, includes_breakfast: bool, is_active: bool,
    customer_id: uuid.optional().or(z.literal("")), room_type_id: uuid.optional().or(z.literal("")), description: optText,
  }).safeParse(input);
  if (!p.success) return fail;
  return run(PERMISSIONS.pmsRatesManage, ["/rate-plans"], async (ctx) => {
    const row = {
      code: p.data.code, name_ar: p.data.name_ar, adjust_pct: p.data.adjust_pct || "0", per_night: p.data.per_night ? toMoney(p.data.per_night).toFixed() : "0",
      per_person: p.data.per_person, includes_breakfast: p.data.includes_breakfast, is_active: p.data.id ? p.data.is_active : true,
      customer_id: p.data.customer_id || null, room_type_id: p.data.room_type_id || null, description: p.data.description,
    };
    const { error } = p.data.id
      ? await ctx.supabase.from("rate_plans").update(row).eq("id", p.data.id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("rate_plans").insert({ ...row, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
}

export async function setReservationRatePlanAction(reservationId: string, planId: string) {
  if (!uuid.safeParse(reservationId).success || (planId && !uuid.safeParse(planId).success)) return fail;
  return run(PERMISSIONS.pmsManage, [`/reservations/${reservationId}`, "/reservations", "/front-desk"], async (ctx) => {
    const { error } = await ctx.supabase.rpc("set_reservation_rate_plan", { p_reservation_id: reservationId, p_rate_plan_id: planId || null });
    raise(error);
    return undefined;
  });
}
