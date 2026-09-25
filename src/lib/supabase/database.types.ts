/**
 * أنواع قاعدة البيانات للمرحلة 1.
 * يمكن إعادة توليدها تلقائيًا بعد ربط المشروع:
 *   npx supabase gen types typescript --project-id <id> --schema public > src/lib/supabase/database.types.ts
 * ملاحظة: الأعمدة من نوع numeric تُقرأ دائمًا كنص (::text) للحفاظ على الدقة المالية.
 */
import type { AccountSubtype, AccountType, BalanceSide } from "@/lib/accounting/accounts";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type JournalStatus = "draft" | "posted";
export type JournalSource =
  | "manual" | "opening" | "reversal" | "closing" | "adjustment" | "folio" | "invoice"
  | "payment" | "vendor_bill" | "expense" | "payroll" | "depreciation" | "inventory" | "petty_cash";
export type PeriodStatus = "open" | "closed";
export type DepartmentKind = "revenue_center" | "cost_center" | "service_center";

type Audit = {
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type HotelRow = Audit & {
  id: string;
  name_ar: string;
  name_en: string | null;
  legal_name: string | null;
  tax_number: string | null;
  commercial_registration: string | null;
  country_code: string;
  base_currency: string;
  fiscal_year_start_month: number;
  timezone: string;
  default_locale: "ar" | "en";
  total_rooms: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  is_active: boolean;
};

export type UserProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_locale: "ar" | "en";
  default_hotel_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type RoleRow = Audit & {
  id: string;
  hotel_id: string | null;
  code: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  is_system: boolean;
};

export type HotelMemberRow = Audit & {
  hotel_id: string;
  user_id: string;
  role_id: string;
  is_active: boolean;
};

export type CurrencyRow = {
  code: string;
  name_ar: string;
  name_en: string;
  symbol: string;
  decimals: number;
  is_active: boolean;
};

export type DepartmentRow = Audit & {
  id: string;
  hotel_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  kind: DepartmentKind;
  parent_id: string | null;
  is_active: boolean;
};

export type AccountRow = Audit & {
  id: string;
  hotel_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type: AccountType;
  account_subtype: AccountSubtype;
  normal_balance: BalanceSide;
  parent_id: string | null;
  level: number;
  is_postable: boolean;
  department_id: string | null;
  currency_code: string | null;
  system_key: string | null;
  description: string | null;
  is_active: boolean;
};

export type FiscalYearRow = Audit & {
  id: string;
  hotel_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
};

export type AccountingPeriodRow = Audit & {
  id: string;
  hotel_id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
};

export type JournalEntryRow = Audit & {
  id: string;
  hotel_id: string;
  entry_number: string | null;
  entry_date: string;
  period_id: string;
  description: string;
  reference: string | null;
  source: JournalSource;
  source_id: string | null;
  currency_code: string;
  exchange_rate: string;
  status: JournalStatus;
  posted_at: string | null;
  posted_by: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
};

export type JournalEntryLineRow = {
  id: string;
  journal_entry_id: string;
  hotel_id: string;
  line_no: number;
  account_id: string;
  department_id: string | null;
  description: string | null;
  debit: string;
  credit: string;
  base_debit: string;
  base_credit: string;
  created_at: string;
};

export type AuditLogRow = {
  id: number;
  hotel_id: string | null;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Json | null;
  new_data: Json | null;
  changed_fields: string[] | null;
  actor_id: string | null;
  occurred_at: string;
};

export type Database = {
  public: {
    Tables: {
      hotels: Table<HotelRow, "name_ar" | "country_code" | "base_currency">;
      users_profiles: Table<UserProfileRow, "id">;
      roles: Table<RoleRow, "code" | "name_ar" | "name_en">;
      hotel_members: Table<HotelMemberRow, "hotel_id" | "user_id" | "role_id">;
      currencies: Table<CurrencyRow, "code" | "name_ar" | "name_en" | "symbol">;
      departments: Table<DepartmentRow, "hotel_id" | "code" | "name_ar" | "kind">;
      chart_of_accounts: Table<AccountRow, "hotel_id" | "code" | "name_ar" | "account_type" | "account_subtype">;
      fiscal_years: Table<FiscalYearRow, "hotel_id" | "name" | "start_date" | "end_date">;
      accounting_periods: Table<AccountingPeriodRow, "hotel_id" | "fiscal_year_id" | "period_no" | "name" | "start_date" | "end_date">;
      journal_entries: Table<JournalEntryRow, "hotel_id" | "entry_date" | "period_id" | "description" | "currency_code">;
      journal_entry_lines: Table<JournalEntryLineRow, "journal_entry_id" | "hotel_id" | "line_no" | "account_id">;
      audit_logs: Table<AuditLogRow, "table_name" | "record_id" | "action">;
    };
    Views: {
      journal_entry_totals: {
        Row: {
          journal_entry_id: string;
          hotel_id: string;
          line_count: number;
          total_debit: string;
          total_credit: string;
          base_total_debit: string;
          base_total_credit: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      my_permissions: { Args: { p_hotel_id: string }; Returns: string[] };
      create_hotel: {
        Args: {
          p_name_ar: string;
          p_country_code: string;
          p_base_currency: string;
          p_name_en?: string | null;
          p_fiscal_year_start_month?: number;
          p_timezone?: string;
          p_seed_defaults?: boolean;
        };
        Returns: string;
      };
      create_fiscal_year: { Args: { p_hotel_id: string; p_start_date: string; p_name?: string | null }; Returns: string };
      save_journal_entry: {
        Args: {
          p_hotel_id: string;
          p_entry_date: string;
          p_description: string;
          p_lines: Json;
          p_reference?: string | null;
          p_currency_code?: string | null;
          p_exchange_rate?: string | number;
          p_entry_id?: string | null;
          p_post?: boolean;
        };
        Returns: string;
      };
      post_journal_entry: { Args: { p_entry_id: string }; Returns: string };
      reverse_journal_entry: {
        Args: { p_entry_id: string; p_reversal_date?: string | null; p_description?: string | null };
        Returns: string;
      };
      gl_account_activity: {
        Args: { p_hotel_id: string; p_fiscal_year_start: string; p_from: string; p_to: string };
        Returns: {
          account_id: string;
          prior_years_debit: string;
          prior_years_credit: string;
          ytd_before_debit: string;
          ytd_before_credit: string;
          period_debit: string;
          period_credit: string;
        }[];
      };
    };
    Enums: {
      account_type: AccountType;
      account_subtype: AccountSubtype;
      balance_side: BalanceSide;
      journal_status: JournalStatus;
      journal_source: JournalSource;
      period_status: PeriodStatus;
      department_kind: DepartmentKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
