import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

/**
 * تخصيص سندات القبض على فواتير العملاء الآجلة.
 * القواعد (مطابقة لتريغر payment_allocations في الترحيل 8):
 *  - مبلغ كل تخصيص > 0
 *  - مجموع التخصيصات ≤ مبلغ السند (الباقي رصيد دائن للعميل "على الحساب")
 *  - تخصيص الفاتورة ≤ المتبقي عليها
 *  - الفاتورة لنفس العميل
 */
export interface OpenInvoice {
  id: string;
  customer_id: string | null;
  amount_due: MoneyInput;
  amount_paid: MoneyInput;
}

export interface AllocationInput {
  invoice_id: string;
  amount: MoneyInput;
}

export type AllocationError = "invalid_amount" | "exceeds_invoice" | "exceeds_payment" | "wrong_customer" | "unknown_invoice" | "duplicate_invoice";

export function invoiceOutstanding(inv: OpenInvoice): Money {
  return toMoney(inv.amount_due).minus(toMoney(inv.amount_paid));
}

export type InvoiceStatus = "issued" | "partially_paid" | "paid";

/** حالة الفاتورة من المستحق والمدفوع (الفاتورة النقدية بالكامل مستحقها صفر ⇒ مدفوعة) */
export function invoiceStatus(amountDue: MoneyInput, amountPaid: MoneyInput): InvoiceStatus {
  const due = toMoney(amountDue);
  const paid = toMoney(amountPaid);
  if (paid.gte(due)) return "paid";
  if (paid.isZero()) return "issued";
  return "partially_paid";
}

export function validateAllocations(
  paymentAmount: MoneyInput,
  customerId: string,
  allocations: readonly AllocationInput[],
  invoices: readonly OpenInvoice[],
): { errors: { index: number; code: AllocationError }[]; allocated: Money; unallocated: Money } {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const errors: { index: number; code: AllocationError }[] = [];
  let allocated = ZERO;

  allocations.forEach((a, index) => {
    const amount = toMoney(a.amount);
    const inv = byId.get(a.invoice_id);
    if (!amount.isPositive() || amount.isZero()) errors.push({ index, code: "invalid_amount" });
    else if (!inv) errors.push({ index, code: "unknown_invoice" });
    else if (seen.has(a.invoice_id)) errors.push({ index, code: "duplicate_invoice" });
    else if (inv.customer_id !== customerId) errors.push({ index, code: "wrong_customer" });
    else if (amount.gt(invoiceOutstanding(inv))) errors.push({ index, code: "exceeds_invoice" });
    seen.add(a.invoice_id);
    allocated = allocated.plus(amount.isPositive() ? amount : ZERO);
  });

  const total = toMoney(paymentAmount);
  if (allocated.gt(total)) errors.push({ index: -1, code: "exceeds_payment" });
  return { errors, allocated, unallocated: total.minus(allocated) };
}

/** تخصيص تلقائي: الأقدم أولًا (FIFO) حتى نفاد مبلغ السند */
export function autoAllocate(paymentAmount: MoneyInput, invoices: readonly (OpenInvoice & { issue_date: string })[]): AllocationInput[] {
  let remaining = toMoney(paymentAmount);
  const out: AllocationInput[] = [];
  for (const inv of [...invoices].sort((a, b) => a.issue_date.localeCompare(b.issue_date))) {
    if (!remaining.isPositive() || remaining.isZero()) break;
    const outstanding = invoiceOutstanding(inv);
    if (!outstanding.isPositive() || outstanding.isZero()) continue;
    const amount = outstanding.lt(remaining) ? outstanding : remaining;
    out.push({ invoice_id: inv.id, amount: amount.toFixed() });
    remaining = remaining.minus(amount);
  }
  return out;
}
