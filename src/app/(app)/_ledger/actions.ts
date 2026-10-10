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

// ---------------------------------------------------------------- عمولات وكلاء الحجز
const SOURCES = ["direct", "phone", "walk_in", "website", "booking_com", "expedia", "agent", "corporate", "other"] as const;

export async function saveCommissionRateAction(source: string, rateInput: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.commissionsManage);
  const p = z.object({ source: z.enum(SOURCES), rate: z.coerce.number().min(0).max(100) }).safeParse({ source, rate: rateInput.trim() || "0" });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("save_channel_commission_rate", { p_hotel_id: ctx.hotel.id, p_source: p.data.source, p_rate: String(p.data.rate) });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/commissions");
  return r;
}

export async function postCommissionsAction(reservationIds?: string[]): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.commissionsManage);
  const p = z.array(z.uuid()).max(500).optional().safeParse(reservationIds);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_channel_commissions", { p_hotel_id: ctx.hotel.id, p_reservation_ids: p.data ?? null });
    raise(error);
    return data ?? 0;
  });
  if (r.ok) revalidatePath("/commissions");
  return r;
}

export async function reverseCommissionAction(id: string, why: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.commissionsManage);
  const p = z.object({ id: z.uuid(), why: reason }).safeParse({ id, why });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("reverse_channel_commission", { p_id: p.data.id, p_reason: p.data.why });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/commissions");
  return r;
}

// ---------------------------------------------------------------- الموازنة التقديرية
const budgetAmount = z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount")
  .transform((v) => toMoney(v || "0").toFixed());

export async function saveBudgetAction(input: { fiscalYearId: string; accountId: string; departmentId: string | null; amounts: string[] }): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.budgetsManage);
  const p = z.object({ fiscalYearId: z.uuid(), accountId: z.uuid(), departmentId: z.uuid().nullable(), amounts: z.array(budgetAmount).min(1).max(13) }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("save_budget", {
      p_hotel_id: ctx.hotel.id, p_fiscal_year_id: p.data.fiscalYearId, p_account_id: p.data.accountId, p_department_id: p.data.departmentId, p_amounts: p.data.amounts,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/budgets");
  return r;
}

// ---------------------------------------------------------------- المرفقات
export async function deleteAttachmentAction(id: string, path: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext();
  const p = z.object({ id: z.uuid(), path: z.string().regex(/^\/[a-z-]+\/[0-9a-f-]{36}$/) }).safeParse({ id, path });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("delete_attachment", { p_id: p.data.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath(p.data.path);
  return r;
}

// ---------------------------------------------------------------- التحويل وتبديل العملة
const positive = z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount").transform((v) => toMoney(v).toFixed());

export async function createTransferAction(input: { fromMethodId: string; fromAmount: string; toMethodId: string; toAmount: string; description: string; date: string }): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsDisbursement);
  const p = z.object({ fromMethodId: z.uuid(), fromAmount: positive, toMethodId: z.uuid(), toAmount: positive, description: z.string().trim().max(300), date }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_fund_transfer", {
      p_hotel_id: ctx.hotel.id, p_from_method_id: p.data.fromMethodId, p_from_amount: p.data.fromAmount,
      p_to_method_id: p.data.toMethodId, p_to_amount: p.data.toAmount, p_description: p.data.description || null, p_date: p.data.date,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/transfers");
  return r;
}

export async function voidTransferAction(id: string, why: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsVoid);
  const p = z.object({ id: z.uuid(), why: reason }).safeParse({ id, why });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("void_fund_transfer", { p_id: p.data.id, p_reason: p.data.why });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/transfers");
  return r;
}

// ---------------------------------------------------------------- عربون الموردين وإعادة تقييم العملات
export async function payVendorAdvanceAction(input: { vendorId: string; methodId: string; amount: string; date: string; reference: string }): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsDisbursement);
  const p = z.object({ vendorId: z.uuid(), methodId: z.uuid(), amount, date, reference: z.string().trim().max(80) }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("pay_vendor_advance", {
      p_hotel_id: ctx.hotel.id, p_vendor_id: p.data.vendorId, p_payment_method_id: p.data.methodId, p_amount: p.data.amount,
      p_payment_date: p.data.date, p_reference: p.data.reference || null,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/vendor-advances");
  return r;
}

export async function applyVendorAdvanceAction(advanceId: string, billId: string, amountInput: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsDisbursement);
  const p = z.object({ advanceId: z.uuid(), billId: z.uuid(), amount }).safeParse({ advanceId, billId, amount: amountInput });
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("apply_vendor_advance", { p_advance_id: p.data.advanceId, p_bill_id: p.data.billId, p_amount: p.data.amount });
    raise(error);
    return data!;
  });
  if (r.ok) { revalidatePath("/vendor-advances"); revalidatePath(`/bills/${billId}`); }
  return r;
}

export async function postFxRevaluationAction(input: { date: string; lines: { payment_method_id: string; foreign_balance: string }[] }): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.journalPost);
  const p = z.object({
    date, lines: z.array(z.object({ payment_method_id: z.uuid(), foreign_balance: z.string().trim().refine((v) => isValidAmount(v) && !toMoney(v).isNegative()).transform((v) => toMoney(v).toFixed()) })).min(1).max(100),
  }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_fx_revaluation", { p_hotel_id: ctx.hotel.id, p_lines: p.data.lines, p_date: p.data.date });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/fx-revaluation");
  return r;
}
