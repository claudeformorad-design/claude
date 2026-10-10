import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { CashierShiftRow, ExchangeRateRow, ShiftReport } from "@/lib/supabase/database.types";
import { raise } from "./errors";

/** قراءات الصندوق والعملات: ورديات الكاشير وأسعار الصرف (الكتابة كلها عبر دوال قاعدة البيانات) */

export async function listCurrencies(supabase: SupabaseServerClient): Promise<{ code: string; name_ar: string; symbol: string; decimals: number }[]> {
  const { data, error } = await supabase.from("currencies").select("code, name_ar, name_en, symbol, decimals").eq("is_active", true).order("code");
  raise(error);
  return (data ?? []) as { code: string; name_ar: string; symbol: string; decimals: number }[];
}

export async function listExchangeRates(supabase: SupabaseServerClient, hotelId: string): Promise<ExchangeRateRow[]> {
  const { data, error } = await supabase.from("exchange_rates")
    .select("id, hotel_id, currency_code, rate_date, rate::text, created_at, created_by")
    .eq("hotel_id", hotelId).order("rate_date", { ascending: false }).limit(300);
  raise(error);
  return (data ?? []) as unknown as ExchangeRateRow[];
}

/** السعر الساري لكل عملة حتى تاريخ معيّن (آخر سعر في التاريخ أو قبله) */
export function latestRates(rates: ExchangeRateRow[], asOf: string): Map<string, { rate: string; date: string }> {
  const m = new Map<string, { rate: string; date: string }>();
  for (const r of rates) if (r.rate_date <= asOf && !m.has(r.currency_code)) m.set(r.currency_code, { rate: r.rate, date: r.rate_date });
  return m;
}

export type ShiftListItem = CashierShiftRow & { user_name: string };

export async function listShifts(supabase: SupabaseServerClient, hotelId: string): Promise<ShiftListItem[]> {
  const { data, error } = await supabase.from("cashier_shifts")
    .select("id, hotel_id, shift_number, user_id, business_date, opened_at, opening_float::text, float_method_id, status, closed_at, closed_by, closing_note, over_short_entry_id")
    .eq("hotel_id", hotelId).order("opened_at", { ascending: false }).limit(200);
  raise(error);
  const rows = (data ?? []) as unknown as CashierShiftRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("users_profiles").select("id, full_name, email").in("id", ids);
    for (const p of (people ?? []) as { id: string; full_name: string; email: string | null }[]) names.set(p.id, p.full_name || p.email || "");
  }
  return rows.map((r) => ({ ...r, user_name: names.get(r.user_id) ?? "" }));
}

export async function shiftReport(supabase: SupabaseServerClient, shiftId: string): Promise<ShiftReport | null> {
  const { data, error } = await supabase.rpc("cashier_shift_report", { p_shift_id: shiftId });
  if (error) return null;
  return data as ShiftReport;
}
