"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { type CustomerFormInput, customerFormSchema } from "@/lib/validation/revenue";
import { saveCustomer } from "@/services/customers.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function saveCustomerAction(input: CustomerFormInput): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.customersManage);
  const parsed = customerFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const r = await toActionResult(() => saveCustomer(ctx.supabase, ctx.hotel.id, parsed.data));
  if (r.ok) revalidatePath("/customers");
  return r;
}
