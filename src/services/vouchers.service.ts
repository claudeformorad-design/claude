import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { PaymentAllocationRow, PaymentRow } from "@/lib/supabase/database.types";
import { type VoucherInput, voucherSchema } from "@/lib/validation/revenue";
import { toMoney } from "@/lib/accounting/money";
import { raise } from "./errors";
import { searchTerm } from "@/lib/search-term";

const COLUMNS =
  "id, hotel_id, voucher_number, voucher_type, party_type, payment_date, payment_method_id, amount::text, customer_id, counter_account_id, department_id, party_name, reference, description, status, journal_entry_id, void_reason, voided_at, voided_by, void_journal_entry_id, created_at, created_by";

export async function listVouchers(
  supabase: SupabaseServerClient,
  hotelId: string,
  filters: { type?: string; q?: string } = {},
): Promise<PaymentRow[]> {
  let query = supabase.from("payments").select(COLUMNS).eq("hotel_id", hotelId).order("payment_date", { ascending: false }).order("voucher_number", { ascending: false }).limit(300);
  if (filters.type === "receipt" || filters.type === "disbursement") query = query.eq("voucher_type", filters.type);
  if (filters.q) {
    const s = searchTerm(filters.q);
    if (s) query = query.or(`voucher_number.ilike.%${s}%,party_name.ilike.%${s}%,description.ilike.%${s}%`);
  }
  const { data, error } = await query;
  raise(error);
  return (data ?? []) as unknown as PaymentRow[];
}

export async function getVoucher(
  supabase: SupabaseServerClient,
  hotelId: string,
  id: string,
): Promise<{ voucher: PaymentRow; allocations: (PaymentAllocationRow & { invoice_number: string | null })[] } | null> {
  const { data, error } = await supabase.from("payments").select(COLUMNS).eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!data) return null;
  const { data: allocs } = await supabase.from("payment_allocations").select("payment_id, invoice_id, hotel_id, amount::text, created_at, created_by").eq("payment_id", id);
  const rows = (allocs ?? []) as unknown as PaymentAllocationRow[];
  const invs = rows.length ? (await supabase.from("invoices").select("id, invoice_number").in("id", rows.map((a) => a.invoice_id))).data ?? [] : [];
  const byId = new Map(invs.map((i) => [i.id, i.invoice_number]));
  return { voucher: data as unknown as PaymentRow, allocations: rows.map((a) => ({ ...a, invoice_number: byId.get(a.invoice_id) ?? null })) };
}

export async function createVoucher(supabase: SupabaseServerClient, hotelId: string, input: VoucherInput): Promise<string> {
  const v = voucherSchema.parse(input);
  const { data, error } = await supabase.rpc("create_payment_voucher", {
    p_hotel_id: hotelId,
    p_voucher_type: v.voucher_type,
    p_party_type: v.party_type,
    p_payment_method_id: v.payment_method_id,
    p_amount: toMoney(v.amount).toFixed(),
    p_description: v.description,
    p_payment_date: v.payment_date,
    p_customer_id: v.party_type === "customer" ? v.customer_id : null,
    p_counter_account_id: v.party_type === "account" ? v.counter_account_id : null,
    p_department_id: v.department_id,
    p_party_name: v.party_name,
    p_reference: v.reference,
    p_allocations: v.voucher_type === "receipt" && v.party_type === "customer"
      ? v.allocations.map((a) => ({ invoice_id: a.invoice_id, amount: toMoney(a.amount).toFixed() }))
      : null,
  });
  raise(error);
  return data!;
}

export async function voidVoucher(supabase: SupabaseServerClient, id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("void_payment_voucher", { p_payment_id: id, p_reason: reason });
  raise(error);
}
