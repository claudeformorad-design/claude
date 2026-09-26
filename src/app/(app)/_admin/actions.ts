"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

const opt = z.string().trim().transform((v) => (v === "" ? null : v));
const optAmount = z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative())).transform((v) => (v === "" ? null : toMoney(v).toFixed()));
const fail = { ok: false as const, error: "validation" as const };
const done = <T,>(r: ActionResult<T>, path: string) => { if (r.ok) revalidatePath(path); return r; };

export async function saveHotelAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const p = z.object({
    name_ar: z.string().trim().min(1), name_en: opt, legal_name: opt, tax_number: opt, commercial_registration: opt,
    address: opt, phone: opt, email: opt, timezone: z.string().trim().min(1),
    total_rooms: z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().int().nonnegative().nullable()),
    journal_approval_threshold: optAmount, voucher_approval_threshold: optAmount,
  }).safeParse(input);
  if (!p.success) return fail;
  return done(await toActionResult(async () => {
    const { error } = await ctx.supabase.from("hotels").update(p.data).eq("id", ctx.hotel.id);
    raise(error);
    return undefined;
  }), "/settings/hotel");
}

export async function saveDepartmentAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.departmentsManage);
  const p = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/), name_ar: z.string().trim().min(1), name_en: opt,
    kind: z.enum(["revenue_center", "cost_center", "service_center"]),
  }).safeParse(input);
  if (!p.success) return fail;
  return done(await toActionResult(async () => {
    const { error } = await ctx.supabase.from("departments").insert({ ...p.data, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  }), "/settings/hotel");
}

export async function addMemberAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const p = z.object({ email: z.email(), role_id: z.uuid() }).safeParse(input);
  if (!p.success) return fail;
  return done(await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("add_hotel_member", { p_hotel_id: ctx.hotel.id, p_email: p.data.email, p_role_ids: [p.data.role_id] });
    raise(error);
    return data!;
  }), "/settings/users");
}

/** استبدال أدوار عضو (إضافة الجديد وحذف غير المحدد) + تفعيل/تعطيل */
export async function setMemberRolesAction(userId: string, roleIds: string[], isActive: boolean): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  if (!z.uuid().safeParse(userId).success || !z.array(z.uuid()).safeParse(roleIds).success) return fail;
  return done(await toActionResult(async () => {
    const { data: current, error: e1 } = await ctx.supabase.from("user_hotel_roles").select("role_id").eq("hotel_id", ctx.hotel.id).eq("user_id", userId);
    raise(e1);
    const have = new Set((current ?? []).map((r) => r.role_id));
    const add = roleIds.filter((r) => !have.has(r));
    const remove = [...have].filter((r) => !roleIds.includes(r));
    if (add.length) raise((await ctx.supabase.from("user_hotel_roles").insert(add.map((role_id) => ({ hotel_id: ctx.hotel.id, user_id: userId, role_id })))).error);
    if (remove.length) raise((await ctx.supabase.from("user_hotel_roles").delete().eq("hotel_id", ctx.hotel.id).eq("user_id", userId).in("role_id", remove)).error);
    raise((await ctx.supabase.from("hotel_members").update({ is_active: isActive }).eq("hotel_id", ctx.hotel.id).eq("user_id", userId)).error);
    return undefined;
  }), "/settings/users");
}

export async function saveRoleAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const p = z.object({
    id: z.uuid().optional(), code: z.string().trim().toLowerCase().regex(/^[a-z_]{2,40}$/), name_ar: z.string().trim().min(1),
    name_en: z.string().trim().min(1), permissions: z.array(z.string()),
  }).safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  return done(await toActionResult(async () => {
    let id = v.id;
    if (id) raise((await ctx.supabase.from("roles").update({ code: v.code, name_ar: v.name_ar, name_en: v.name_en }).eq("id", id)).error);
    else {
      const { data, error } = await ctx.supabase.from("roles").insert({ hotel_id: ctx.hotel.id, code: v.code, name_ar: v.name_ar, name_en: v.name_en }).select("id").single();
      raise(error);
      id = data!.id;
    }
    raise((await ctx.supabase.from("role_permissions").delete().eq("role_id", id!)).error);
    if (v.permissions.length) raise((await ctx.supabase.from("role_permissions").insert(v.permissions.map((c) => ({ role_id: id!, permission_code: c })))).error);
    return undefined;
  }), "/settings/users");
}

export async function periodAction(op: "close" | "open" | "closeYear" | "newYear", id: string, startDate?: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.periodsManage);
  return done(await toActionResult(async () => {
    if (op === "closeYear") raise((await ctx.supabase.rpc("close_fiscal_year", { p_fiscal_year_id: id })).error);
    else if (op === "newYear") raise((await ctx.supabase.rpc("create_fiscal_year", { p_hotel_id: ctx.hotel.id, p_start_date: startDate! })).error);
    else raise((await ctx.supabase.rpc("set_period_status", { p_period_id: id, p_status: op === "close" ? "closed" : "open" })).error);
    return undefined;
  }), "/periods");
}
