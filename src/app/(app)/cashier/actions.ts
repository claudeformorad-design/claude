"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import type { ShiftReport } from "@/lib/supabase/database.types";
import { raise, type ActionResult, toActionResult, invalid } from "@/services/errors";

/** ورديات الكاشير وأسعار الصرف — القواعد كلها في قاعدة البيانات */
const fail = { ok: false as const, error: "validation" as const };
const amount = z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount");

export async function openShiftAction(openingFloat: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.cashierShifts);
  const p = amount.safeParse(openingFloat ?? "");
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("open_cashier_shift", { p_hotel_id: ctx.hotel.id, p_opening_float: p.data ? toMoney(p.data).toFixed() : "0" });
    raise(error);
    return data as string;
  });
  if (r.ok) revalidatePath("/cashier");
  return r;
}

export async function closeShiftAction(shiftId: string, input: unknown): Promise<ActionResult<ShiftReport>> {
  const ctx = await requireAppContext(PERMISSIONS.cashierShifts);
  const p = z.object({
    counts: z.array(z.object({ payment_method_id: z.uuid(), counted: amount })),
    note: z.string().trim().max(500).optional(),
  }).safeParse(input);
  if (!p.success || !z.uuid().safeParse(shiftId).success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("close_cashier_shift", {
      p_shift_id: shiftId,
      p_counts: p.data.counts.filter((c) => c.counted !== "").map((c) => ({ payment_method_id: c.payment_method_id, counted: toMoney(c.counted).toFixed() })),
      p_note: p.data.note || null,
    });
    raise(error);
    return data as ShiftReport;
  });
  if (r.ok) { revalidatePath("/cashier"); revalidatePath(`/cashier/${shiftId}`); }
  return r;
}

export async function setExchangeRateAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.currenciesManage);
  const p = z.object({
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    rate: z.string().trim().refine((v) => /^\d+(\.\d{1,10})?$/.test(v) && Number(v) > 0, "invalid_amount"),
    date: z.iso.date().optional().or(z.literal("")),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("set_exchange_rate", {
      p_hotel_id: ctx.hotel.id, p_currency_code: p.data.currency, p_rate: p.data.rate, p_rate_date: p.data.date || null,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/settings/currencies");
  return r;
}
