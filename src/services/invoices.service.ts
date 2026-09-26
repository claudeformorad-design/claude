import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { InvoiceItemRow, InvoiceRow, InvoiceTaxRow, PaymentAllocationRow } from "@/lib/supabase/database.types";
import { type DirectInvoiceInput, directInvoiceSchema } from "@/lib/validation/revenue";
import { toMoney } from "@/lib/accounting/money";
import { raise } from "./errors";

const INVOICE_COLUMNS =
  "id, hotel_id, invoice_number, invoice_type, folio_id, customer_id, bill_to_name, bill_to_tax_number, bill_to_address, issue_date, due_date, currency_code, subtotal::text, tax_total::text, total::text, amount_due::text, amount_paid::text, status, journal_entry_id, notes, created_at, created_by, updated_at";

export async function listInvoices(
  supabase: SupabaseServerClient,
  hotelId: string,
  filters: { status?: string; customerId?: string; q?: string } = {},
): Promise<InvoiceRow[]> {
  let query = supabase.from("invoices").select(INVOICE_COLUMNS).eq("hotel_id", hotelId).order("issue_date", { ascending: false }).order("invoice_number", { ascending: false }).limit(300);
  if (filters.status === "issued" || filters.status === "partially_paid" || filters.status === "paid") query = query.eq("status", filters.status);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.q) {
    const s = filters.q.replace(/[%,()]/g, " ").trim();
    if (s) query = query.or(`invoice_number.ilike.%${s}%,bill_to_name.ilike.%${s}%`);
  }
  const { data, error } = await query;
  raise(error);
  return (data ?? []) as unknown as InvoiceRow[];
}

/** فواتير العميل غير المسددة (للتخصيص في سندات القبض) */
export async function listOpenInvoices(supabase: SupabaseServerClient, hotelId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from("invoices").select(INVOICE_COLUMNS).eq("hotel_id", hotelId).neq("status", "paid").order("issue_date");
  raise(error);
  return (data ?? []) as unknown as InvoiceRow[];
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  taxes: InvoiceTaxRow[];
  allocations: (PaymentAllocationRow & { voucher_number: string | null; voucher_status: string | null })[];
}

export async function getInvoice(supabase: SupabaseServerClient, hotelId: string, id: string): Promise<InvoiceDetail | null> {
  const { data, error } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!data) return null;
  const [items, taxes, allocs] = await Promise.all([
    supabase.from("invoice_items").select("id, invoice_id, hotel_id, line_no, charge_code_id, department_id, business_date, description, quantity::text, unit_price::text, net_amount::text, tax_amount::text, total_amount::text, source_transaction_id").eq("invoice_id", id).order("line_no"),
    supabase.from("invoice_taxes").select("invoice_id, hotel_id, tax_rate_id, taxable_base::text, amount::text").eq("invoice_id", id),
    supabase.from("payment_allocations").select("payment_id, invoice_id, hotel_id, amount::text, created_at, created_by").eq("invoice_id", id),
  ]);
  raise(items.error);
  raise(taxes.error);
  const allocRows = (allocs.data ?? []) as unknown as PaymentAllocationRow[];
  const vouchers = allocRows.length
    ? (await supabase.from("payments").select("id, voucher_number, status").in("id", allocRows.map((a) => a.payment_id))).data ?? []
    : [];
  const vById = new Map(vouchers.map((v) => [v.id, v]));
  return {
    invoice: data as unknown as InvoiceRow,
    items: (items.data ?? []) as unknown as InvoiceItemRow[],
    taxes: (taxes.data ?? []) as unknown as InvoiceTaxRow[],
    allocations: allocRows.map((a) => ({ ...a, voucher_number: vById.get(a.payment_id)?.voucher_number ?? null, voucher_status: vById.get(a.payment_id)?.status ?? null })),
  };
}

export async function createDirectInvoice(supabase: SupabaseServerClient, hotelId: string, input: DirectInvoiceInput): Promise<string> {
  const v = directInvoiceSchema.parse(input);
  const { data, error } = await supabase.rpc("create_direct_invoice", {
    p_hotel_id: hotelId,
    p_customer_id: v.customer_id,
    p_issue_date: v.issue_date,
    p_notes: v.notes,
    p_lines: v.lines.map((l) => ({
      charge_code_id: l.charge_code_id, description: l.description,
      quantity: toMoney(l.quantity).toFixed(), unit_price: toMoney(l.unit_price).toFixed(),
    })),
  });
  raise(error);
  return data!;
}
