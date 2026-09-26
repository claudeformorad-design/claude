import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { HotelRow } from "@/lib/supabase/database.types";
import { buildTrialBalance } from "@/lib/accounting/trial-balance";
import { buildBalanceSheet, buildCashFlow, buildIncomeStatement, type CashFlowLine, type StatementAccount } from "@/lib/accounting/statements";
import { type RoomDay, roomKpis } from "@/lib/accounting/kpi";
import { toMoney } from "@/lib/accounting/money";
import { resolveFiscalYearStart } from "./reports.service";
import { raise } from "./errors";

async function statementAccounts(supabase: SupabaseServerClient, hotelId: string, locale: string): Promise<(StatementAccount & { system_key: string | null; name_ar: string; name_en: string | null })[]> {
  const { data, error } = await supabase
    .from("chart_of_accounts").select("id, code, name_ar, name_en, account_type, account_subtype, system_key")
    .eq("hotel_id", hotelId).eq("is_postable", true).order("code");
  raise(error);
  return (data ?? []).map((a) => ({ ...a, name: (locale === "en" && a.name_en) || a.name_ar }));
}

async function activity(supabase: SupabaseServerClient, hotelId: string, fyStart: string, from: string, to: string) {
  const { data, error } = await supabase
    .rpc("gl_account_activity", { p_hotel_id: hotelId, p_fiscal_year_start: fyStart, p_from: from, p_to: to })
    .select("account_id, prior_years_debit::text, prior_years_credit::text, ytd_before_debit::text, ytd_before_credit::text, period_debit::text, period_credit::text");
  raise(error);
  return data ?? [];
}

/** قائمة الدخل للفترة */
export async function getIncomeStatement(supabase: SupabaseServerClient, hotel: HotelRow, from: string, to: string, locale: string) {
  const fy = await resolveFiscalYearStart(supabase, hotel.id, from, hotel.fiscal_year_start_month);
  const [accounts, act] = await Promise.all([statementAccounts(supabase, hotel.id, locale), activity(supabase, hotel.id, fy, from, to)]);
  const movements = new Map(act.map((a) => [a.account_id, toMoney(a.period_debit).minus(toMoney(a.period_credit))]));
  return buildIncomeStatement(accounts, movements);
}

/** الميزانية العمومية في تاريخ */
export async function getBalanceSheet(supabase: SupabaseServerClient, hotel: HotelRow, asOf: string, locale: string) {
  const fy = await resolveFiscalYearStart(supabase, hotel.id, asOf, hotel.fiscal_year_start_month);
  const [accounts, act] = await Promise.all([statementAccounts(supabase, hotel.id, locale), activity(supabase, hotel.id, fy, fy, asOf)]);
  const tb = buildTrialBalance(accounts, act, { includeZeroRows: true });
  return buildBalanceSheet(accounts, tb);
}

/** قائمة التدفقات النقدية للفترة */
export async function getCashFlow(supabase: SupabaseServerClient, hotelId: string, from: string, to: string, locale: string) {
  const dayBefore = new Date(`${from}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const [lines, opening, closing, accounts] = await Promise.all([
    supabase.rpc("cash_flow_lines", { p_hotel_id: hotelId, p_from: from, p_to: to }).select("activity, account_id, amount::text"),
    supabase.rpc("cash_balance", { p_hotel_id: hotelId, p_as_of: dayBefore.toISOString().slice(0, 10) }),
    supabase.rpc("cash_balance", { p_hotel_id: hotelId, p_as_of: to }),
    statementAccounts(supabase, hotelId, locale),
  ]);
  raise(lines.error); raise(opening.error); raise(closing.error);
  const rows = (lines.data ?? []) as unknown as CashFlowLine[];
  const name = new Map(accounts.map((a) => [a.id, `${a.code} — ${a.name}`]));
  return { ...buildCashFlow(rows, String(opening.data ?? 0), String(closing.data ?? 0)), lines: rows.map((r) => ({ ...r, name: name.get(r.account_id) ?? "" })) };
}

export async function getRoomStats(supabase: SupabaseServerClient, hotelId: string, from: string, to: string) {
  const { data, error } = await supabase
    .rpc("room_statistics", { p_hotel_id: hotelId, p_from: from, p_to: to })
    .select("business_date, room_nights::text, room_revenue::text, rooms_available");
  raise(error);
  const days = (data ?? []) as unknown as (RoomDay & { business_date: string })[];
  return { days, kpis: roomKpis(days) };
}

export async function getDailyCash(supabase: SupabaseServerClient, hotelId: string, date: string) {
  const { data, error } = await supabase
    .rpc("daily_cash_report", { p_hotel_id: hotelId, p_date: date })
    .select("payment_method_id, method_name, source, receipts::text, payments::text");
  raise(error);
  return (data ?? []) as unknown as { payment_method_id: string; method_name: string; source: "folio" | "voucher"; receipts: string; payments: string }[];
}

export async function getMonthlyPnl(supabase: SupabaseServerClient, hotelId: string, from: string, to: string) {
  const { data, error } = await supabase
    .rpc("monthly_pnl", { p_hotel_id: hotelId, p_from: from, p_to: to })
    .select("month, revenue::text, expenses::text");
  raise(error);
  return (data ?? []) as unknown as { month: string; revenue: string; expenses: string }[];
}
