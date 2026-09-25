"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { accountFormSchema, type AccountFormInput } from "@/lib/validation/account";
import { saveAccount } from "@/services/accounts.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function saveAccountAction(input: AccountFormInput): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.accountsManage);
  const parsed = accountFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };

  const result = await toActionResult(() => saveAccount(ctx.supabase, ctx.hotel.id, parsed.data));
  if (result.ok) revalidatePath("/accounts");
  return result;
}
