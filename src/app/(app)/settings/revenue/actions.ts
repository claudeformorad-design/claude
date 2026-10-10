"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { chargeCodeFormSchema, paymentMethodFormSchema, taxRateFormSchema } from "@/lib/validation/revenue";
import { saveChargeCode, savePaymentMethod, saveTaxRate } from "@/services/revenue-settings.service";
import { z } from "zod";
import { type ActionResult, invalid, raise, toActionResult } from "@/services/errors";

export type RevenueSettingKind = "tax" | "charge" | "method";

export async function saveRevenueSettingAction(kind: RevenueSettingKind, input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.revenueSettingsManage);
  const done = async (fn: () => Promise<void>) => {
    const r = await toActionResult(async () => { await fn(); return undefined; });
    if (r.ok) revalidatePath("/settings/revenue");
    return r;
  };
  if (kind === "tax") {
    const p = taxRateFormSchema.safeParse(input);
    return p.success ? done(() => saveTaxRate(ctx.supabase, ctx.hotel.id, p.data)) : { ok: false, error: "validation" };
  }
  if (kind === "charge") {
    const p = chargeCodeFormSchema.safeParse(input);
    return p.success ? done(() => saveChargeCode(ctx.supabase, ctx.hotel.id, p.data)) : { ok: false, error: "validation" };
  }
  const p = paymentMethodFormSchema.safeParse(input);
  return p.success ? done(() => savePaymentMethod(ctx.supabase, ctx.hotel.id, p.data)) : { ok: false, error: "validation" };
}

/** صندوق أو محفظة أو حساب بنكي جديد بحساب مستقل في دليل الحسابات وطريقة دفع مرتبطة به */
export async function createPaymentBoxAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.revenueSettingsManage);
  const p = z.object({
    kind: z.enum(["cash", "e_wallet", "bank_transfer"]),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/),
    name_ar: z.string().trim().min(1).max(120),
    name_en: z.string().trim().max(120).optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().or(z.literal("")),
    requires_reference: z.boolean(),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_payment_box", {
      p_hotel_id: ctx.hotel.id, p_kind: p.data.kind, p_code: p.data.code, p_name_ar: p.data.name_ar,
      p_name_en: p.data.name_en || null, p_currency_code: p.data.currency || null, p_requires_reference: p.data.requires_reference,
    });
    raise(error);
    return data as string;
  });
  if (r.ok) { revalidatePath("/settings/revenue"); revalidatePath("/cashier"); }
  return r;
}
