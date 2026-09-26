import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type {
  AgingRow, BankStatementLineRow, PayrollRunRow, PurchaseOrderRow, VendorBillLineRow, VendorBillRow, VendorRow,
} from "@/lib/supabase/database.types";
import { raise } from "./errors";

const BILL_COLS =
  "id, hotel_id, bill_number, vendor_id, vendor_invoice_no, po_id, bill_date, due_date, subtotal::text, tax_total::text, total::text, amount_paid::text, status, journal_entry_id, notes, created_at, created_by";

export async function listVendors(supabase: SupabaseServerClient, hotelId: string): Promise<VendorRow[]> {
  const { data, error } = await supabase.from("vendors").select("*").eq("hotel_id", hotelId).order("code");
  raise(error);
  return data ?? [];
}

export async function saveVendor(supabase: SupabaseServerClient, hotelId: string, v: Partial<VendorRow> & { code: string; name_ar: string }) {
  const payload = {
    code: v.code, name_ar: v.name_ar, name_en: v.name_en ?? null, tax_number: v.tax_number ?? null, phone: v.phone ?? null,
    email: v.email ?? null, address: v.address ?? null, payment_terms_days: v.payment_terms_days ?? 30, is_active: v.is_active ?? true,
  };
  const { error } = v.id
    ? await supabase.from("vendors").update(payload).eq("id", v.id).eq("hotel_id", hotelId)
    : await supabase.from("vendors").insert({ ...payload, hotel_id: hotelId });
  raise(error);
}

export async function listPurchaseOrders(supabase: SupabaseServerClient, hotelId: string): Promise<PurchaseOrderRow[]> {
  const { data, error } = await supabase.from("purchase_orders").select("*").eq("hotel_id", hotelId).order("order_date", { ascending: false }).limit(300);
  raise(error);
  return data ?? [];
}

export async function listBills(supabase: SupabaseServerClient, hotelId: string, vendorId?: string): Promise<VendorBillRow[]> {
  let q = supabase.from("vendor_bills").select(BILL_COLS).eq("hotel_id", hotelId).order("bill_date", { ascending: false }).limit(300);
  if (vendorId) q = q.eq("vendor_id", vendorId);
  const { data, error } = await q;
  raise(error);
  return (data ?? []) as unknown as VendorBillRow[];
}

export async function getBill(supabase: SupabaseServerClient, hotelId: string, id: string) {
  const { data, error } = await supabase.from("vendor_bills").select(BILL_COLS).eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!data) return null;
  const { data: lines } = await supabase
    .from("vendor_bill_lines")
    .select("id, bill_id, hotel_id, line_no, description, account_id, department_id, quantity::text, unit_price::text, net_amount::text, tax_rate_id, tax_amount::text")
    .eq("bill_id", id).order("line_no");
  return { bill: data as unknown as VendorBillRow, lines: (lines ?? []) as unknown as VendorBillLineRow[] };
}

export async function listPayrollRuns(supabase: SupabaseServerClient, hotelId: string): Promise<PayrollRunRow[]> {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("id, hotel_id, run_number, period_month, posting_date, total_gross::text, total_net::text, journal_entry_id, notes, created_at")
    .eq("hotel_id", hotelId).order("period_month", { ascending: false });
  raise(error);
  return (data ?? []) as unknown as PayrollRunRow[];
}

export async function listBankLines(supabase: SupabaseServerClient, hotelId: string, accountId: string): Promise<BankStatementLineRow[]> {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .select("id, hotel_id, account_id, txn_date, description, reference, amount::text, matched_line_id, matched_at, matched_by, created_at")
    .eq("hotel_id", hotelId).eq("account_id", accountId).order("txn_date", { ascending: false });
  raise(error);
  return (data ?? []) as unknown as BankStatementLineRow[];
}

/** سطور الأستاذ المرحّلة على الحساب البنكي مع حالة مطابقتها */
export async function listLedgerLines(supabase: SupabaseServerClient, hotelId: string, accountId: string) {
  const { data, error } = await supabase
    .from("journal_entry_lines")
    .select("id, base_debit::text, base_credit::text, description, journal_entries!inner(entry_date, entry_number, description, status)")
    .eq("hotel_id", hotelId).eq("account_id", accountId).eq("journal_entries.status", "posted");
  raise(error);
  return (data ?? []) as unknown as {
    id: string; base_debit: string; base_credit: string; description: string | null;
    journal_entries: { entry_date: string; entry_number: string; description: string };
  }[];
}

export async function agingReport(supabase: SupabaseServerClient, hotelId: string, kind: "receivable" | "payable", asOf: string): Promise<AgingRow[]> {
  const { data, error } = await supabase
    .rpc("aging_report", { p_hotel_id: hotelId, p_kind: kind, p_as_of: asOf })
    .select("party_id, party_name, document_id, document_number, document_date, due_date, outstanding::text, days_overdue, bucket");
  raise(error);
  return (data ?? []) as unknown as AgingRow[];
}
