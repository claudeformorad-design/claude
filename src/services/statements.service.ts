import { tr } from "@/i18n/tr";
import "server-only";
import { type Money, ZERO, toMoney } from "@/lib/accounting/money";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { raise } from "./errors";

export type StatementLine = {
  date: string;
  kind: "invoice" | "credit_note" | "receipt" | "refund";
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
  const credited = new Map<string, Money>();
  for (const n of allNotes ?? []) credited.set(n.invoice_id, (credited.get(n.invoice_id) ?? ZERO).plus(toMoney(n.total)));

  const moves: Omit<StatementLine, "balance">[] = [];
  for (const i of (invoices.data ?? []) as unknown as Inv[]) {
    const original = toMoney(i.amount_due).plus(credited.get(i.id) ?? ZERO);
    if (original.isZero()) continue;
    moves.push({ date: i.issue_date, kind: "invoice", number: i.invoice_number, description: tr("فاتورة آجلة"), debit: original, credit: ZERO, href: `/invoices/${i.id}` });
  }
  for (const n of noteRows) {
    moves.push({ date: n.issue_date, kind: "credit_note", number: n.credit_note_number, description: n.reason, debit: ZERO, credit: toMoney(n.total), href: `/invoices/${n.invoice_id}` });
  }
  for (const p of (payments.data ?? []) as unknown as Pay[]) {
    const receipt = p.voucher_type === "receipt";
    moves.push({ date: p.payment_date, kind: receipt ? "receipt" : "refund", number: p.voucher_number, description: p.description,
      debit: receipt ? ZERO : toMoney(p.amount), credit: receipt ? toMoney(p.amount) : ZERO, href: `/vouchers/${p.id}` });
  }
  const order = { invoice: 0, refund: 1, credit_note: 2, receipt: 3 };
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
