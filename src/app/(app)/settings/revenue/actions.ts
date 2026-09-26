"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { chargeCodeFormSchema, paymentMethodFormSchema, taxRateFormSchema } from "@/lib/validation/revenue";
import { saveChargeCode, savePaymentMethod, saveTaxRate } from "@/services/revenue-settings.service";
import { type ActionResult, toActionResult } from "@/services/errors";

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
