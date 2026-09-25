import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { fiscalYearStart } from "@/lib/accounting/fiscal";
import { buildTrialBalance, type TrialBalance } from "@/lib/accounting/trial-balance";
import { raise } from "./errors";

export interface TrialBalanceParams {
  hotelId: string;
  fiscalYearStartMonth: number;
  from: string;
  to: string;
  includeZeroRows?: boolean;
}

/** بداية السنة المالية المحتوية لتاريخ: من جدول السنوات المالية إن وُجد، وإلا من إعداد الفندق */
export async function resolveFiscalYearStart(
  supabase: SupabaseServerClient,
  hotelId: string,
  date: string,
  fallbackStartMonth: number,
): Promise<string> {
  const { data } = await supabase
    .from("fiscal_years")
    .select("start_date")
    .eq("hotel_id", hotelId)
    .lte("start_date", date)
    .gte("end_date", date)
    .maybeSingle();
  return data?.start_date ?? fiscalYearStart(date, fallbackStartMonth);
}

export async function getTrialBalance(supabase: SupabaseServerClient, params: TrialBalanceParams): Promise<TrialBalance> {
  const fyStart = await resolveFiscalYearStart(supabase, params.hotelId, params.from, params.fiscalYearStartMonth);

  const [accounts, activity] = await Promise.all([
    supabase
      .from("chart_of_accounts")
      .select("id, code, name_ar, name_en, account_type, system_key")
      .eq("hotel_id", params.hotelId)
      .eq("is_postable", true)
      .order("code"),
    supabase
      .rpc("gl_account_activity", {
        p_hotel_id: params.hotelId,
        p_fiscal_year_start: fyStart,
        p_from: params.from,
        p_to: params.to,
      })
      .select(
        "account_id, prior_years_debit::text, prior_years_credit::text, ytd_before_debit::text, ytd_before_credit::text, period_debit::text, period_credit::text",
      ),
  ]);
  raise(accounts.error);
  raise(activity.error);

  return buildTrialBalance(accounts.data ?? [], activity.data ?? [], { includeZeroRows: params.includeZeroRows });
}
