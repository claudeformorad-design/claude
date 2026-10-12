import { tr } from "@/i18n/tr";
import "server-only";
import { type Money, ZERO, toMoney } from "@/lib/accounting/money";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { raise } from "./errors";

export type StatementLine = {
  date: string;
  kind: "invoice" | "credit_note" | "write_off" | "receipt" | "refund";
  number: string;
  description: string;
  debit: Money;
  credit: Money;
  balance: Money;
  href: string;
};

export type CustomerStatement = {
  customer: { id: string; code: string; name_ar: string; name_en: string | null; phone: string | null; address: string | null; tax_number: string | null; credit_limit: string | null };
  opening: Money;
  lines: StatementLine[];
  debit: Money;
  credit: Money;
  closing: Money;
  /** مبالغ محوّلة للآجل على فوليوهات مفتوحة لم تصدر فاتورتها بعد (خارج الكشف حتى الفوترة) */
  pendingFolios: Money;
};

/**
 * كشف حساب العميل لفترة: الرصيد الافتتاحي، ثم الفواتير الآجلة (مدين)، وإشعارات الدائن وسندات القبض (دائن)،
 * وسندات الصرف للعميل (مدين)، بتسلسل التاريخ مع الرصيد الجاري. السندات الملغاة لا تدخل الكشف.
 * الرصيد الختامي يساوي الذمة القائمة على العميل: الفواتير غير المسددة ناقص الرصيد الدائن غير المخصص.
 */
export async function customerStatement(supabase: SupabaseServerClient, hotelId: string, customerId: string, from: string, to: string): Promise<CustomerStatement | null> {
  const { data: customer, error } = await supabase.from("customers")
    .select("id, code, name_ar, name_en, phone, address, tax_number, credit_limit::text").eq("hotel_id", hotelId).eq("id", customerId).maybeSingle();
  raise(error);
  if (!customer) return null;
  const [invoices, notes, payments, folioCredit] = await Promise.all([
    supabase.from("invoices").select("id, invoice_number, issue_date, amount_due::text, invoice_type").eq("hotel_id", hotelId).eq("customer_id", customerId).lte("issue_date", to),
    supabase.from("credit_notes").select("id, credit_note_number, issue_date, total::text, reason, invoice_id, invoices!inner(customer_id, invoice_number)")
      .eq("hotel_id", hotelId).eq("invoices.customer_id", customerId).lte("issue_date", to),
    supabase.from("payments").select("id, voucher_number, voucher_type, payment_date, amount::text, description").eq("hotel_id", hotelId).eq("customer_id", customerId)
      .eq("status", "posted").lte("payment_date", to),
    supabase.rpc("customer_pending_city_ledger", { p_customer_id: customerId }),
  ]);
  raise(invoices.error); raise(notes.error); raise(payments.error);
  type Inv = { id: string; invoice_number: string; issue_date: string; amount_due: string };
  type Note = { id: string; credit_note_number: string; issue_date: string; total: string; reason: string; invoice_id: string; invoices: { invoice_number: string } };
  type Pay = { id: string; voucher_number: string; voucher_type: "receipt" | "disbursement"; payment_date: string; amount: string; description: string };
  const noteRows = (notes.data ?? []) as unknown as Note[];
  // قيمة الفاتورة الأصلية على العميل = المستحق الحالي + إشعارات الدائن التي خُصمت منها (كلها، ولو بعد نهاية الفترة)
  const allNotes = (await supabase.from("credit_notes").select("invoice_id, total::text, invoices!inner(customer_id)").eq("hotel_id", hotelId).eq("invoices.customer_id", customerId)).data as unknown as { invoice_id: string; total: string }[] | null;
  // الديون المعدومة تخفّض المستحق مثل الإشعار الدائن، فتُضاف لقيمة الفاتورة الأصلية وتظهر سطرًا دائنًا
  const writeOffs = (await supabase.from("invoice_write_offs").select("id, invoice_id, write_off_date, amount::text, reason, invoices!inner(customer_id, invoice_number)")
    .eq("hotel_id", hotelId).eq("invoices.customer_id", customerId)).data as unknown as { id: string; invoice_id: string; write_off_date: string; amount: string; reason: string; invoices: { invoice_number: string } }[] | null;
  const credited = new Map<string, Money>();
  for (const n of allNotes ?? []) credited.set(n.invoice_id, (credited.get(n.invoice_id) ?? ZERO).plus(toMoney(n.total)));
  for (const w of writeOffs ?? []) credited.set(w.invoice_id, (credited.get(w.invoice_id) ?? ZERO).plus(toMoney(w.amount)));

  const moves: Omit<StatementLine, "balance">[] = [];
  for (const i of (invoices.data ?? []) as unknown as Inv[]) {
    const original = toMoney(i.amount_due).plus(credited.get(i.id) ?? ZERO);
    if (original.isZero()) continue;
    moves.push({ date: i.issue_date, kind: "invoice", number: i.invoice_number, description: tr("فاتورة آجلة"), debit: original, credit: ZERO, href: `/invoices/${i.id}` });
  }
  for (const n of noteRows) {
    moves.push({ date: n.issue_date, kind: "credit_note", number: n.credit_note_number, description: n.reason, debit: ZERO, credit: toMoney(n.total), href: `/invoices/${n.invoice_id}` });
  }
  for (const w of writeOffs ?? []) {
    if (w.write_off_date > to) continue;
    moves.push({ date: w.write_off_date, kind: "write_off", number: w.invoices.invoice_number, description: tr("دين معدوم: {0}", w.reason), debit: ZERO, credit: toMoney(w.amount), href: `/invoices/${w.invoice_id}` });
  }
  for (const p of (payments.data ?? []) as unknown as Pay[]) {
    const receipt = p.voucher_type === "receipt";
    moves.push({ date: p.payment_date, kind: receipt ? "receipt" : "refund", number: p.voucher_number, description: p.description,
      debit: receipt ? ZERO : toMoney(p.amount), credit: receipt ? toMoney(p.amount) : ZERO, href: `/vouchers/${p.id}` });
  }
  const order = { invoice: 0, refund: 1, credit_note: 2, write_off: 3, receipt: 4 };
  moves.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.number.localeCompare(b.number));

  let opening = ZERO;
  const lines: StatementLine[] = [];
  let running = ZERO;
  let debit = ZERO;
  let credit = ZERO;
  for (const m of moves) {
    if (m.date < from) { opening = opening.plus(m.debit).minus(m.credit); continue; }
    if (!lines.length) running = opening;
    running = running.plus(m.debit).minus(m.credit);
    debit = debit.plus(m.debit);
    credit = credit.plus(m.credit);
    lines.push({ ...m, balance: running });
  }
  return {
    customer: customer as unknown as CustomerStatement["customer"],
    opening, lines, debit, credit, closing: opening.plus(debit).minus(credit),
    pendingFolios: folioCredit.error ? ZERO : toMoney(String(folioCredit.data ?? 0)),
  };
}

export type VendorStatementLine = Omit<StatementLine, "kind"> & { kind: "bill" | "debit_note" | "payment" | "vendor_receipt" };

export type VendorStatement = {
  vendor: { id: string; code: string; name_ar: string; name_en: string | null; phone: string | null; address: string | null; tax_number: string | null };
  opening: Money;
  lines: VendorStatementLine[];
  debit: Money;
  credit: Money;
  /** المستحق للمورد (دائن)، وسالبه رصيد مدين على المورد (عربون أو دفعة زائدة) */
  closing: Money;
};

/**
 * كشف حساب المورد لفترة من جهة حسابه عندنا: فواتيره دائنة (علينا)، ومرتجعات المشتريات وسندات الصرف له
 * (ومنها العربون) مدينة، وسند قبض منه دائن. الرصيد الجاري = الدائن ناقص المدين، فيساوي ما علينا للمورد.
 * تطبيق العربون على فاتورة لا يظهر سطرًا: لا يغير رصيده، وإنما ينقل المدفوع مقدمًا إلى الفاتورة.
 */
export async function vendorStatement(supabase: SupabaseServerClient, hotelId: string, vendorId: string, from: string, to: string): Promise<VendorStatement | null> {
  const { data: vendor, error } = await supabase.from("vendors")
    .select("id, code, name_ar, name_en, phone, address, tax_number").eq("hotel_id", hotelId).eq("id", vendorId).maybeSingle();
  raise(error);
  if (!vendor) return null;
  const [bills, notes, payments] = await Promise.all([
    supabase.from("vendor_bills").select("id, bill_number, vendor_invoice_no, bill_date, total::text, notes").eq("hotel_id", hotelId).eq("vendor_id", vendorId).lte("bill_date", to),
    supabase.from("vendor_debit_notes").select("id, debit_note_number, issue_date, total::text, reason, bill_id, vendor_bills!inner(vendor_id)")
      .eq("hotel_id", hotelId).eq("vendor_bills.vendor_id", vendorId).lte("issue_date", to),
    supabase.from("payments").select("id, voucher_number, voucher_type, payment_date, amount::text, description").eq("hotel_id", hotelId).eq("vendor_id", vendorId)
      .eq("status", "posted").lte("payment_date", to),
  ]);
  raise(bills.error); raise(notes.error); raise(payments.error);
  type Bill = { id: string; bill_number: string; vendor_invoice_no: string | null; bill_date: string; total: string; notes: string | null };
  type Note = { id: string; debit_note_number: string; issue_date: string; total: string; reason: string; bill_id: string };
  type Pay = { id: string; voucher_number: string; voucher_type: "receipt" | "disbursement"; payment_date: string; amount: string; description: string };

  const moves: Omit<VendorStatementLine, "balance">[] = [];
  for (const b of (bills.data ?? []) as unknown as Bill[]) {
    const total = toMoney(b.total);
    if (total.isZero()) continue;
    moves.push({ date: b.bill_date, kind: "bill", number: b.bill_number,
      description: b.vendor_invoice_no ? tr("فاتورة المورد رقم {0}", b.vendor_invoice_no) : (b.notes ?? tr("فاتورة مورد")),
      debit: ZERO, credit: total, href: `/bills/${b.id}` });
  }
  for (const n of (notes.data ?? []) as unknown as Note[]) {
    moves.push({ date: n.issue_date, kind: "debit_note", number: n.debit_note_number, description: n.reason, debit: toMoney(n.total), credit: ZERO, href: `/bills/${n.bill_id}` });
  }
  for (const p of (payments.data ?? []) as unknown as Pay[]) {
    const paid = p.voucher_type === "disbursement";
    moves.push({ date: p.payment_date, kind: paid ? "payment" : "vendor_receipt", number: p.voucher_number, description: p.description,
      debit: paid ? toMoney(p.amount) : ZERO, credit: paid ? ZERO : toMoney(p.amount), href: `/vouchers/${p.id}` });
  }
  const order = { bill: 0, vendor_receipt: 1, debit_note: 2, payment: 3 };
  moves.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.number.localeCompare(b.number));

  let opening = ZERO;
  const lines: VendorStatementLine[] = [];
  let running = ZERO;
  let debit = ZERO;
  let credit = ZERO;
  for (const m of moves) {
    if (m.date < from) { opening = opening.plus(m.credit).minus(m.debit); continue; }
    if (!lines.length) running = opening;
    running = running.plus(m.credit).minus(m.debit);
    debit = debit.plus(m.debit);
    credit = credit.plus(m.credit);
    lines.push({ ...m, balance: running });
  }
  return { vendor: vendor as unknown as VendorStatement["vendor"], opening, lines, debit, credit, closing: opening.plus(credit).minus(debit) };
}
