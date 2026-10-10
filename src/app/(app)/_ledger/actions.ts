"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

const fail = { ok: false as const, error: "validation" as const };
const denied = { ok: false as const, error: "permission_denied" as const };

/** يكفي أن يملك المستخدم إحدى الصلاحيات (قاعدة البيانات تتحقق من المطلوبة لكل اتجاه) */
async function requireAny(...perms: Permission[]) {
  const ctx = await requireAppContext();
  return perms.some((p) => ctx.can(p)) ? ctx : null;
}
const amount = z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount").transform((v) => toMoney(v).toFixed());
const date = z.string().refine(isIsoDate);
const reason = z.string().trim().min(1).max(500);

// ---------------------------------------------------------------- القيود الدورية
const recurringSchema = z.object({
  entryId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  startDate: date,
  count: z.union([z.literal(""), z.coerce.number().int().min(1).max(600)]),
  endDate: z.union([z.literal(""), date]),
});

export async function recurringFromEntryAction(input: z.input<typeof recurringSchema>): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  const p = recurringSchema.safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("recurring_from_entry", {
      p_entry_id: p.data.entryId, p_name: p.data.name, p_frequency: p.data.frequency, p_start_date: p.data.startDate,
      p_end_date: p.data.endDate || null, p_total_count: p.data.count === "" ? null : p.data.count,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/journal/recurring");
  return r;
}

export async function postDueRecurringAction(): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.journalPost);
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_due_recurring_entries", { p_hotel_id: ctx.hotel.id });
    raise(error);
    return data ?? 0;
  });
  if (r.ok) { revalidatePath("/journal/recurring"); revalidatePath("/journal"); }
  return r;
}

export async function setRecurringActiveAction(id: string, active: boolean): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  if (!z.uuid().safeParse(id).success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("set_recurring_entry_active", { p_id: id, p_active: active });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/journal/recurring");
  return r;
}

export async function deleteRecurringAction(id: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  if (!z.uuid().safeParse(id).success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("delete_recurring_entry", { p_id: id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/journal/recurring");
  return r;
}

// ---------------------------------------------------------------- الشيكات
export async function registerChequeAction(input: { paymentId: string; number: string; bank: string; dueDate: string }): Promise<ActionResult<string>> {
  const ctx = await requireAny(PERMISSIONS.paymentsReceipt, PERMISSIONS.paymentsDisbursement);
  if (!ctx) return denied;
  const p = z.object({ paymentId: z.uuid(), number: z.string().trim().min(1).max(40), bank: z.string().trim().max(120), dueDate: date }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("register_cheque", { p_payment_id: p.data.paymentId, p_number: p.data.number, p_bank: p.data.bank, p_due_date: p.data.dueDate });
    raise(error);
    return data!;
  });
  if (r.ok) { revalidatePath(`/vouchers/${p.data.paymentId}`); revalidatePath("/cheques"); }
  return r;
}

export async function clearChequeAction(chequeId: string, bankMethodId: string, onDate: string): Promise<ActionResult<string>> {
  const ctx = await requireAny(PERMISSIONS.paymentsReceipt, PERMISSIONS.paymentsDisbursement);
  if (!ctx) return denied;
  const p = z.object({ chequeId: z.uuid(), bankMethodId: z.uuid(), onDate: date }).safeParse({ chequeId, bankMethodId, onDate });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("clear_cheque", { p_cheque_id: p.data.chequeId, p_bank_method_id: p.data.bankMethodId, p_date: p.data.onDate });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/cheques");
  return r;
}

export async function bounceChequeAction(chequeId: string, why: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsVoid);
  const p = z.object({ chequeId: z.uuid(), why: reason }).safeParse({ chequeId, why });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("bounce_cheque", { p_cheque_id: p.data.chequeId, p_reason: p.data.why });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/cheques");
  return r;
}

// ---------------------------------------------------------------- مرتجعات المشتريات وإعدام الديون
export async function debitNoteAction(billId: string, amountInput: string, why: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.billsDebitNote);
  const p = z.object({ billId: z.uuid(), amount, why: reason }).safeParse({ billId, amount: amountInput, why });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_vendor_debit_note", { p_bill_id: p.data.billId, p_amount: p.data.amount, p_reason: p.data.why });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath(`/bills/${billId}`);
  return r;
}

export async function writeOffAction(invoiceId: string, amountInput: string, why: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.invoicesWriteOff);
  const p = z.object({ invoiceId: z.uuid(), amount, why: reason }).safeParse({ invoiceId, amount: amountInput, why });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("write_off_invoice", { p_invoice_id: p.data.invoiceId, p_amount: p.data.amount, p_reason: p.data.why });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath(`/invoices/${invoiceId}`);
  return r;
}
