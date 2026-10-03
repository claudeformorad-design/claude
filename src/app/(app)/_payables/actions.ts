"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optDate, optText } from "@/lib/validation/common";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { saveVendor } from "@/services/payables.service";
import { raise, type ActionResult, toActionResult } from "@/services/errors";

const amount = z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount").transform((v) => toMoney(v).toFixed());
const opt = optText;
const line = z.object({
  description: z.string().trim().min(1).max(300),
  account_id: z.uuid(),
  department_id: opt,
  quantity: amount,
  unit_price: amount,
  tax_rate_id: opt,
});
const linesSchema = z.array(line).min(1);

const fail = { ok: false as const, error: "validation" as const };

export async function saveVendorAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.vendorsManage);
  const p = z.object({
    id: z.uuid().optional(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/),
    name_ar: z.string().trim().min(1).max(200),
    name_en: opt, tax_number: opt, phone: opt, email: opt, address: opt,
    payment_terms_days: z.coerce.number().int().min(0).max(365),
    is_active: z.boolean(),
  }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => { await saveVendor(ctx.supabase, ctx.hotel.id, p.data); return undefined; });
  if (r.ok) revalidatePath("/vendors");
  return r;
}

export async function createPurchaseOrderAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.purchasesManage);
  const p = z.object({ vendor_id: z.uuid(), order_date: optDate, notes: opt, lines: linesSchema }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_purchase_order", {
      p_hotel_id: ctx.hotel.id, p_vendor_id: p.data.vendor_id, p_lines: p.data.lines, p_order_date: p.data.order_date, p_notes: p.data.notes,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/purchase-orders");
  return r;
}

export async function createBillAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.billsCreate);
  const p = z.object({
    vendor_id: z.uuid(), bill_date: optDate, vendor_invoice_no: opt, notes: opt,
    po_id: opt, lines: z.array(line).optional(),
  }).safeParse(input);
  if (!p.success || (!p.data.po_id && !p.data.lines?.length)) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_vendor_bill", {
      p_hotel_id: ctx.hotel.id, p_vendor_id: p.data.vendor_id, p_lines: p.data.po_id ? null : p.data.lines,
      p_po_id: p.data.po_id, p_bill_date: p.data.bill_date, p_vendor_invoice_no: p.data.vendor_invoice_no, p_notes: p.data.notes,
    });
    raise(error);
    return data!;
  });
  if (r.ok) { revalidatePath("/bills"); revalidatePath("/purchase-orders"); }
  return r;
}

export async function payVendorAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.paymentsDisbursement);
  const p = z.object({
    vendor_id: z.uuid(), payment_method_id: z.uuid(), payment_date: optDate, reference: opt,
    allocations: z.array(z.object({ bill_id: z.uuid(), amount })).min(1),
  }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("pay_vendor", {
      p_hotel_id: ctx.hotel.id, p_vendor_id: p.data.vendor_id, p_payment_method_id: p.data.payment_method_id,
      p_allocations: p.data.allocations, p_payment_date: p.data.payment_date, p_reference: p.data.reference,
    });
    raise(error);
    return data!;
  });
  if (r.ok) { revalidatePath("/bills"); revalidatePath("/vouchers"); }
  return r;
}

const money0 = z.string().trim().refine((v) => v === "" || (isValidAmount(v) && !toMoney(v).isNegative())).transform((v) => (v === "" ? "0" : toMoney(v).toFixed()));

export async function postPayrollAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.payrollManage);
  const p = z.object({
    period_month: z.string().regex(/^\d{4}-\d{2}$/),
    posting_date: optDate,
    lines: z.array(z.object({
      employee_name: z.string().trim().min(1), employee_code: opt, department_id: z.uuid(),
      basic: money0, allowances: money0, deductions: money0, insurance_employee: money0, insurance_employer: money0,
    })).min(1),
  }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("post_payroll", {
      p_hotel_id: ctx.hotel.id, p_period_month: `${p.data.period_month}-01`, p_lines: p.data.lines, p_posting_date: p.data.posting_date,
    });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath("/payroll");
  return r;
}

export async function creditNoteAction(invoiceId: string, amountInput: string, reason: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.creditNote);
  const a = amount.safeParse(amountInput);
  if (!a.success || !reason.trim()) return fail;
  const r = await toActionResult(async () => {
    const { data, error } = await ctx.supabase.rpc("create_credit_note", { p_invoice_id: invoiceId, p_amount: a.data, p_reason: reason.trim() });
    raise(error);
    return data!;
  });
  if (r.ok) revalidatePath(`/invoices/${invoiceId}`);
  return r;
}

export async function addBankLineAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.bankReconcile);
  const p = z.object({
    account_id: z.uuid(), txn_date: z.string().refine(isIsoDate), description: z.string().trim().min(1).max(300), reference: opt,
    amount: z.string().trim().refine((v) => isValidAmount(v) && !toMoney(v).isZero()).transform((v) => toMoney(v).toFixed()),
  }).safeParse(input);
  if (!p.success) return fail;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.from("bank_statement_lines").insert({ ...p.data, hotel_id: ctx.hotel.id });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/bank");
  return r;
}

export async function bankMatchAction(op: "auto" | "match" | "unmatch" | "delete", args: { accountId?: string; lineId?: string; ledgerLineId?: string }): Promise<ActionResult<number>> {
  const ctx = await requireAppContext(PERMISSIONS.bankReconcile);
  const r = await toActionResult(async () => {
    if (op === "auto") {
      const { data, error } = await ctx.supabase.rpc("auto_match_bank_lines", { p_hotel_id: ctx.hotel.id, p_account_id: args.accountId! });
      raise(error);
      return data ?? 0;
    }
    const q = ctx.supabase.from("bank_statement_lines");
    const { error } = op === "delete"
      ? await q.delete().eq("id", args.lineId!)
      : await q.update({ matched_line_id: op === "match" ? args.ledgerLineId! : null }).eq("id", args.lineId!);
    raise(error);
    return 1;
  });
  if (r.ok) revalidatePath("/bank");
  return r;
}
