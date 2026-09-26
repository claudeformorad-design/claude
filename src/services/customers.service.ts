import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { CustomerRow } from "@/lib/supabase/database.types";
import type { CustomerFormValues } from "@/lib/validation/revenue";
import { raise } from "./errors";

export type CustomerWithBalance = CustomerRow & { open_invoices: string; unapplied_credit: string };

export async function listCustomers(supabase: SupabaseServerClient, hotelId: string): Promise<CustomerWithBalance[]> {
  const [customers, balances] = await Promise.all([
    supabase.from("customers").select("id, hotel_id, code, name_ar, name_en, customer_type, tax_number, commercial_registration, email, phone, address, credit_limit::text, allow_credit, payment_terms_days, notes, is_active, created_at, created_by, updated_at, updated_by").eq("hotel_id", hotelId).order("code"),
    supabase.from("customer_balances").select("customer_id, open_invoices::text, unapplied_credit::text").eq("hotel_id", hotelId),
  ]);
  raise(customers.error);
  raise(balances.error);
  const byId = new Map((balances.data ?? []).map((b) => [b.customer_id, b]));
  return ((customers.data ?? []) as unknown as CustomerRow[]).map((c) => ({
    ...c,
    open_invoices: byId.get(c.id)?.open_invoices ?? "0",
    unapplied_credit: byId.get(c.id)?.unapplied_credit ?? "0",
  }));
}

export async function saveCustomer(supabase: SupabaseServerClient, hotelId: string, v: CustomerFormValues): Promise<string> {
  const payload = {
    code: v.code, name_ar: v.name_ar, name_en: v.name_en, customer_type: v.customer_type, tax_number: v.tax_number,
    commercial_registration: v.commercial_registration, email: v.email, phone: v.phone, address: v.address,
    allow_credit: v.allow_credit, credit_limit: v.credit_limit, payment_terms_days: v.payment_terms_days,
    notes: v.notes, is_active: v.is_active,
  };
  if (v.id) {
    const { error } = await supabase.from("customers").update(payload).eq("id", v.id).eq("hotel_id", hotelId);
    raise(error);
    return v.id;
  }
  const { data, error } = await supabase.from("customers").insert({ ...payload, hotel_id: hotelId }).select("id").single();
  raise(error);
  return data!.id;
}
