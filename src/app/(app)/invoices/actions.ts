"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { type DirectInvoiceInput, directInvoiceSchema } from "@/lib/validation/revenue";
import { createDirectInvoice } from "@/services/invoices.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function createDirectInvoiceAction(input: DirectInvoiceInput): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.invoicesCreate);
  if (!directInvoiceSchema.safeParse(input).success) return { ok: false, error: "validation" };
  const r = await toActionResult(() => createDirectInvoice(ctx.supabase, ctx.hotel.id, input));
  if (r.ok) revalidatePath("/invoices");
  return r;
}
