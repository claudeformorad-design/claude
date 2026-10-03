"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { type VoucherInput, voucherSchema } from "@/lib/validation/revenue";
import { createVoucher, voidVoucher } from "@/services/vouchers.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function createVoucherAction(input: VoucherInput): Promise<ActionResult<string>> {
  const parsed = voucherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const ctx = await requireAppContext(
    parsed.data.voucher_type === "receipt" ? PERMISSIONS.paymentsReceipt : PERMISSIONS.paymentsDisbursement,
  );
  const r = await toActionResult(() => createVoucher(ctx.supabase, ctx.hotel.id, input));
  if (r.ok) {
    revalidatePath("/vouchers");
    revalidatePath("/invoices");
  }
  return r;
}

export async function voidVoucherAction(id: string, reason: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsVoid);
  if (!reason.trim()) return { ok: false, error: "validation" };
  const r = await toActionResult(async () => {
    await voidVoucher(ctx.supabase, id, reason.trim());
    return undefined;
  });
  if (r.ok) revalidatePath(`/vouchers/${id}`);
  return r;
}
