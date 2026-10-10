"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optText } from "@/lib/validation/common";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult, invalid } from "@/services/errors";

const amount = (allowZero = false) =>
  z.string().trim().refine((v) => isValidAmount(v) && (allowZero ? !toMoney(v).isNegative() : toMoney(v).gt(0))).transform((v) => toMoney(v).toFixed());
const date = z.string().refine(isIsoDate);
const opt = optText;
const fail = { ok: false as const, error: "validation" as const };

export async function registerAssetAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.assetsManage);
  const p = z.object({
    name: z.string().trim().min(1), category: z.string().trim().min(1), asset_account_id: z.uuid(), cost: amount(),
    salvage_value: amount(true), useful_life_months: z.coerce.number().int().positive(), acquisition_date: date,
    department_id: opt, counter_account_id: z.uuid(), notes: opt,
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("register_fixed_asset", {
      p_hotel_id: ctx.hotel.id, p_name: v.name, p_category: v.category, p_asset_account_id: v.asset_account_id, p_cost: v.cost,
      p_useful_life_months: v.useful_life_months, p_acquisition_date: v.acquisition_date, p_salvage_value: v.salvage_value,
      p_department_id: v.department_id, p_counter_account_id: v.counter_account_id, p_notes: v.notes,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/assets");
  return r;
}

export async function runDepreciationAction(month: string): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.assetsManage);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("run_depreciation", { p_hotel_id: ctx.hotel.id, p_month: `${month}-01` });
    raise(error);
    return data ?? 0;
  });
  if (r.ok) revalidatePath("/assets");
  return r;
}

export async function disposeAssetAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.assetsManage);
  const p = z.object({ asset_id: z.uuid(), disposal_date: date, proceeds: amount(true), proceeds_account_id: opt }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("dispose_fixed_asset", {
      p_asset_id: p.data.asset_id, p_disposal_date: p.data.disposal_date, p_proceeds: p.data.proceeds, p_proceeds_account_id: p.data.proceeds_account_id,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/assets");
  return r;
}

export async function saveItemAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({
    id: z.uuid().optional(), sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,30}$/), name_ar: z.string().trim().min(1),
    name_en: opt, unit: z.string().trim().min(1), inventory_account_id: z.uuid(), expense_account_id: z.uuid(),
    reorder_level: amount(true), is_active: z.boolean(),
    category_id: opt, barcode: z.string().trim().toUpperCase().regex(/^[0-9A-Z-]{4,32}$/).or(z.literal("")).optional(),
    sale_price: z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative())).optional(),
    track_expiry: z.boolean().optional(),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { id, barcode, sale_price, ...rest } = p.data;
  const payload = {
    ...rest, category_id: rest.category_id ?? null, barcode: barcode || null,
    sale_price: sale_price ? toMoney(sale_price).toFixed() : null, track_expiry: rest.track_expiry ?? false,
  };
  const r = await toActionResult(async () => {
    const { error } = id
      ? await ctx.supabase.from("inventory_items").update(payload).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("inventory_items").insert({ ...payload, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function inventoryMovementAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({
    item_id: z.uuid(), type: z.enum(["receipt", "issue", "adjustment"]), date: date,
    quantity: z.string().trim().refine((v) => isValidAmount(v) && !toMoney(v).isZero()).transform((v) => toMoney(v).toFixed()),
    unit_cost: opt, department_id: opt, vendor_bill_id: opt, description: opt,
    expiry_date: z.union([z.literal(""), date]).optional(),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_inventory_movement_ex", {
      p_item_id: v.item_id, p_type: v.type, p_quantity: v.quantity, p_date: v.date, p_unit_cost: v.unit_cost,
      p_department_id: v.department_id, p_vendor_bill_id: v.vendor_bill_id, p_description: v.description,
      p_expiry_date: v.expiry_date || null,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

// ---------------------------------------------------------------- الباركود والفئات والوحدات والأسعار والجرد
export async function generateBarcodeAction(itemId: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  if (!z.uuid().safeParse(itemId).success) return fail;
  const r = await toActionResult(async () => {
    const { data: code, error } = await ctx.supabase.rpc("next_item_barcode", { p_hotel_id: ctx.hotel.id });
    raise(error);
    const up = await ctx.supabase.from("inventory_items").update({ barcode: code! }).eq("id", itemId).eq("hotel_id", ctx.hotel.id).is("barcode", null);
    raise(up.error);
    return code!;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function saveCategoryAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({ id: z.uuid().optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,20}$/), name_ar: z.string().trim().min(1).max(80), name_en: opt, is_active: z.boolean().optional() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { id, ...payload } = p.data;
  const r = await toActionResult(async () => {
    const { error } = id
      ? await ctx.supabase.from("inventory_categories").update({ ...payload, is_active: payload.is_active ?? true }).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("inventory_categories").insert({ ...payload, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function addUnitAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({ name_ar: z.string().trim().min(1).max(30), name_en: opt }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("inventory_units").insert({ ...p.data, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function deleteUnitAction(id: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  if (!z.uuid().safeParse(id).success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("inventory_units").delete().eq("id", id).eq("hotel_id", ctx.hotel.id);
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function bulkPriceAction(input: unknown): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({
    percent: z.string().trim().refine((v) => isValidAmount(v.replace(/^-/, "")) && !toMoney(v.replace(/^-/, "")).isZero()),
    category_id: opt, round_to: z.string().trim().refine((v) => v === "" || (isValidAmount(v) && toMoney(v).gt(0))),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("bulk_change_prices", {
      p_hotel_id: ctx.hotel.id, p_percent: p.data.percent, p_category_id: p.data.category_id ?? null, p_round_to: p.data.round_to || null,
    });
    raise(error);
    return data ?? 0;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}

export async function stockCountAction(input: { date: string; note: string; lines: { item_id: string; counted: string }[] }): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.inventoryManage);
  const p = z.object({
    date, note: z.string().trim().max(300),
    lines: z.array(z.object({ item_id: z.uuid(), counted: z.string().trim().refine((v) => isValidAmount(v) && !toMoney(v).isNegative()).transform((v) => toMoney(v).toFixed()) })).min(1).max(2000),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_stock_count", { p_hotel_id: ctx.hotel.id, p_lines: p.data.lines, p_date: p.data.date, p_note: p.data.note || null });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}
