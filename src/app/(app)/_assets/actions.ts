"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

const amount = (allowZero = false) =>
  z.string().trim().refine((v) => isValidAmount(v) && (allowZero ? !toMoney(v).isNegative() : toMoney(v).gt(0))).transform((v) => toMoney(v).toFixed());
const date = z.string().refine(isIsoDate);
const opt = z.string().trim().transform((v) => (v === "" ? null : v));
const fail = { ok: false as const, error: "validation" as const };

export async function registerAssetAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.assetsManage);
  const p = z.object({
    name: z.string().trim().min(1), category: z.string().trim().min(1), asset_account_id: z.uuid(), cost: amount(),
    salvage_value: amount(true), useful_life_months: z.coerce.number().int().positive(), acquisition_date: date,
    department_id: opt, counter_account_id: z.uuid(), notes: opt,
  }).safeParse(input);
  if (!p.success) return fail;
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
  if (!p.success) return fail;
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
  }).safeParse(input);
  if (!p.success) return fail;
  const { id, ...payload } = p.data;
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
  }).safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_inventory_movement", {
      p_item_id: v.item_id, p_type: v.type, p_quantity: v.quantity, p_date: v.date, p_unit_cost: v.unit_cost,
      p_department_id: v.department_id, p_vendor_bill_id: v.vendor_bill_id, p_description: v.description,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/inventory");
  return r;
}
