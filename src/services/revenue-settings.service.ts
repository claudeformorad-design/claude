import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { ChargeCodeRow, PaymentMethodRow, TaxRateRow } from "@/lib/supabase/database.types";
import type { ChargeCodeFormValues, PaymentMethodFormValues, TaxRateFormValues } from "@/lib/validation/revenue";
import { raise } from "./errors";

export type ChargeCodeWithTaxes = ChargeCodeRow & { tax_rate_ids: string[] };

export async function listTaxRates(supabase: SupabaseServerClient, hotelId: string): Promise<TaxRateRow[]> {
  const { data, error } = await supabase
    .from("tax_rates")
    .select("id, hotel_id, code, name_ar, name_en, kind, rate::text, is_compound, account_id, is_active, created_at, created_by, updated_at, updated_by")
    .eq("hotel_id", hotelId)
    .order("code");
  raise(error);
  return (data ?? []) as unknown as TaxRateRow[];
}

export async function listChargeCodes(supabase: SupabaseServerClient, hotelId: string): Promise<ChargeCodeWithTaxes[]> {
  const [codes, links] = await Promise.all([
    supabase.from("charge_codes").select("id, hotel_id, code, name_ar, name_en, category, department_id, revenue_account_id, default_price::text, price_includes_tax, is_active, created_at, created_by, updated_at, updated_by").eq("hotel_id", hotelId).order("code"),
    supabase.from("charge_code_taxes").select("charge_code_id, tax_rate_id").eq("hotel_id", hotelId),
  ]);
  raise(codes.error);
  raise(links.error);
  const byCode = new Map<string, string[]>();
  for (const l of links.data ?? []) byCode.set(l.charge_code_id, [...(byCode.get(l.charge_code_id) ?? []), l.tax_rate_id]);
  return ((codes.data ?? []) as unknown as ChargeCodeRow[]).map((c) => ({ ...c, tax_rate_ids: byCode.get(c.id) ?? [] }));
}

export async function listPaymentMethods(supabase: SupabaseServerClient, hotelId: string): Promise<PaymentMethodRow[]> {
  const { data, error } = await supabase.from("payment_methods").select("*").eq("hotel_id", hotelId).order("code");
  raise(error);
  return data ?? [];
}

export async function saveTaxRate(supabase: SupabaseServerClient, hotelId: string, v: TaxRateFormValues): Promise<void> {
  const payload = {
    code: v.code, name_ar: v.name_ar, name_en: v.name_en, kind: v.kind, rate: v.rate,
    is_compound: v.is_compound, account_id: v.account_id, is_active: v.is_active,
  };
  const { error } = v.id
    ? await supabase.from("tax_rates").update(payload).eq("id", v.id).eq("hotel_id", hotelId)
    : await supabase.from("tax_rates").insert({ ...payload, hotel_id: hotelId });
  raise(error);
}

export async function savePaymentMethod(supabase: SupabaseServerClient, hotelId: string, v: PaymentMethodFormValues): Promise<void> {
  const payload = { code: v.code, name_ar: v.name_ar, name_en: v.name_en, kind: v.kind, account_id: v.account_id, currency_code: v.currency_code, is_active: v.is_active };
  const { error } = v.id
    ? await supabase.from("payment_methods").update(payload).eq("id", v.id).eq("hotel_id", hotelId)
    : await supabase.from("payment_methods").insert({ ...payload, hotel_id: hotelId });
  raise(error);
}

/** حفظ رمز إيراد وضرائبه (استبدال قائمة الضرائب المرتبطة) */
export async function saveChargeCode(supabase: SupabaseServerClient, hotelId: string, v: ChargeCodeFormValues): Promise<void> {
  const payload = {
    code: v.code, name_ar: v.name_ar, name_en: v.name_en, category: v.category, department_id: v.department_id,
    revenue_account_id: v.revenue_account_id, default_price: v.default_price, price_includes_tax: v.price_includes_tax,
    is_active: v.is_active,
  };
  let id = v.id;
  if (id) {
    const { error } = await supabase.from("charge_codes").update(payload).eq("id", id).eq("hotel_id", hotelId);
    raise(error);
  } else {
    const { data, error } = await supabase.from("charge_codes").insert({ ...payload, hotel_id: hotelId }).select("id").single();
    raise(error);
    id = data!.id;
  }
  const del = await supabase.from("charge_code_taxes").delete().eq("charge_code_id", id);
  raise(del.error);
  if (v.tax_rate_ids.length) {
    const ins = await supabase
      .from("charge_code_taxes")
      .insert(v.tax_rate_ids.map((t) => ({ hotel_id: hotelId, charge_code_id: id!, tax_rate_id: t })));
    raise(ins.error);
  }
}
