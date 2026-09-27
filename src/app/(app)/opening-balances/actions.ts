"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

const amt = z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount")
  .transform((v) => (v === "" ? "" : toMoney(v).toFixed()));

/** ترحيل الأرصدة الافتتاحية (مرة واحدة) — كل القواعد في قاعدة البيانات */
export async function postOpeningBalancesAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const p = z.object({
    date: z.iso.date(),
    accounts: z.array(z.object({ account_id: z.uuid(), debit: amt, credit: amt })),
    customers: z.array(z.object({ customer_id: z.uuid(), amount: amt, reference: z.string().trim().max(100).optional() })),
    vendors: z.array(z.object({ vendor_id: z.uuid(), amount: amt, reference: z.string().trim().max(100).optional() })),
  }).safeParse(input);
  if (!p.success) return { ok: false, error: "validation" };
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_opening_balances", {
      p_hotel_id: ctx.hotel.id, p_date: p.data.date,
      p_accounts: p.data.accounts.filter((a) => a.debit || a.credit),
      p_customers: p.data.customers.filter((c) => c.amount),
      p_vendors: p.data.vendors.filter((v) => v.amount),
    });
    raise(error);
    return data as string;
  });
  if (r.ok) for (const path of ["/", "/journal", "/opening-balances", "/customers", "/vendors", "/invoices", "/bills", "/reports/trial-balance"]) revalidatePath(path);
  return r;
}
