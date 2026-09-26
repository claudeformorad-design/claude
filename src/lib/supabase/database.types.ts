/**
 * أنواع قاعدة البيانات (المرحلتان 1 و2).
 * يمكن إعادة توليدها تلقائيًا بعد ربط المشروع:
 *   npx supabase gen types typescript --project-id <id> --schema public > src/lib/supabase/database.types.ts
 * ملاحظة: الأعمدة من نوع numeric تُقرأ دائمًا كنص (::text) للحفاظ على الدقة المالية.
 */
import type { AccountSubtype, AccountType, BalanceSide } from "@/lib/accounting/accounts";
import type { FolioTxnType } from "@/lib/accounting/folio";

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
  is_active: boolean;
};

/** أدوار المستخدم في الفندق (متعدد لمتعدد) — الصلاحيات = اتحاد صلاحيات الأدوار */
export type UserHotelRoleRow = {
  hotel_id: string;
  user_id: string;
  role_id: string;
  created_at: string;
  created_by: string | null;
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


// ----------------------------------------------------------------------------- المرحلة 2
export type TaxKind = "vat" | "tourism_fee" | "municipality_fee" | "service_charge" | "other";
export type ChargeCategory =
  | "room" | "food" | "beverage" | "minibar" | "spa" | "events" | "shop"
  | "transport" | "tours" | "laundry" | "parking" | "telephone" | "other";
export type PaymentMethodKind = "cash" | "card" | "bank_transfer" | "cheque" | "e_wallet" | "city_ledger";
export type CustomerType = "individual" | "company" | "travel_agent" | "ota" | "government";
export type FolioType = "guest" | "master" | "company" | "non_guest";
export type FolioStatus = "open" | "closed" | "cancelled";
export type InvoiceType = "folio" | "direct";
export type InvoiceStatus = "issued" | "partially_paid" | "paid";
export type VoucherType = "receipt" | "disbursement";
export type VoucherParty = "customer" | "account";
export type VoucherStatus = "posted" | "voided";

export type TaxRateRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; name_en: string | null;
  kind: TaxKind; rate: string; is_compound: boolean; account_id: string; is_active: boolean;
};

export type ChargeCodeRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; name_en: string | null;
  category: ChargeCategory; department_id: string; revenue_account_id: string;
  default_price: string | null; price_includes_tax: boolean; is_active: boolean;
};

export type ChargeCodeTaxRow = { hotel_id: string; charge_code_id: string; tax_rate_id: string };

export type PaymentMethodRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; name_en: string | null;
  kind: PaymentMethodKind; account_id: string; is_active: boolean;
};

export type CustomerRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; name_en: string | null;
  customer_type: CustomerType; tax_number: string | null; commercial_registration: string | null;
  email: string | null; phone: string | null; address: string | null;
  credit_limit: string | null; allow_credit: boolean; payment_terms_days: number;
  notes: string | null; is_active: boolean;
};

export type GuestFolioRow = Audit & {
  id: string; hotel_id: string; folio_number: string; folio_type: FolioType; status: FolioStatus;
  guest_name: string; customer_id: string | null; room_number: string | null; reservation_ref: string | null;
  arrival_date: string | null; departure_date: string | null; adults: number | null;
  master_folio_id: string | null; notes: string | null; closed_at: string | null; closed_by: string | null;
};

export type FolioTransactionRow = {
  id: string; hotel_id: string; folio_id: string; txn_type: FolioTxnType; direction: 1 | -1;
  business_date: string; charge_code_id: string | null; payment_method_id: string | null;
  department_id: string | null; customer_id: string | null; description: string; reference: string | null;
  quantity: string; unit_price: string | null; net_amount: string; tax_amount: string; total_amount: string;
  ledger_effect: string; deposit_effect: string; related_transaction_id: string | null;
  counter_folio_id: string | null; voided_by_id: string | null; journal_entry_id: string | null;
  created_at: string; created_by: string | null;
};

export type InvoiceRow = {
  id: string; hotel_id: string; invoice_number: string; invoice_type: InvoiceType; folio_id: string | null;
  customer_id: string | null; bill_to_name: string; bill_to_tax_number: string | null; bill_to_address: string | null;
  issue_date: string; due_date: string | null; currency_code: string;
  subtotal: string; tax_total: string; total: string; amount_due: string; amount_paid: string;
  status: InvoiceStatus; journal_entry_id: string | null; notes: string | null;
  created_at: string; created_by: string | null; updated_at: string;
};

export type InvoiceItemRow = {
  id: string; invoice_id: string; hotel_id: string; line_no: number; charge_code_id: string | null;
  department_id: string | null; business_date: string | null; description: string; quantity: string;
  unit_price: string | null; net_amount: string; tax_amount: string; total_amount: string;
  source_transaction_id: string | null;
};

export type InvoiceTaxRow = { invoice_id: string; hotel_id: string; tax_rate_id: string; taxable_base: string; amount: string };

export type PaymentRow = {
  id: string; hotel_id: string; voucher_number: string; voucher_type: VoucherType; party_type: VoucherParty;
  payment_date: string; payment_method_id: string; amount: string; customer_id: string | null;
  counter_account_id: string | null; department_id: string | null; party_name: string | null;
  reference: string | null; description: string; status: VoucherStatus; journal_entry_id: string | null;
  void_reason: string | null; voided_at: string | null; voided_by: string | null;
  void_journal_entry_id: string | null; created_at: string; created_by: string | null;
};

export type PaymentAllocationRow = {
  payment_id: string; invoice_id: string; hotel_id: string; amount: string; created_at: string; created_by: string | null;
};


// ----------------------------------------------------------------------------- المرحلة 3
export type BillStatus = "open" | "partially_paid" | "paid";
export type VendorRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; name_en: string | null; tax_number: string | null;
  phone: string | null; email: string | null; address: string | null; payment_terms_days: number;
  default_account_id: string | null; is_active: boolean;
};
export type PurchaseOrderRow = {
  id: string; hotel_id: string; po_number: string; vendor_id: string; order_date: string;
  status: "open" | "billed" | "cancelled"; notes: string | null; created_at: string; created_by: string | null;
};
export type VendorBillRow = {
  id: string; hotel_id: string; bill_number: string; vendor_id: string; vendor_invoice_no: string | null; po_id: string | null;
  bill_date: string; due_date: string; subtotal: string; tax_total: string; total: string; amount_paid: string;
  status: BillStatus; journal_entry_id: string | null; notes: string | null; created_at: string; created_by: string | null;
};
export type VendorBillLineRow = {
  id: string; bill_id: string; hotel_id: string; line_no: number; description: string; account_id: string;
  department_id: string | null; quantity: string; unit_price: string; net_amount: string; tax_rate_id: string | null; tax_amount: string;
};
export type PayrollRunRow = {
  id: string; hotel_id: string; run_number: string; period_month: string; posting_date: string;
  total_gross: string; total_net: string; journal_entry_id: string | null; notes: string | null; created_at: string;
};
export type BankStatementLineRow = {
  id: string; hotel_id: string; account_id: string; txn_date: string; description: string; reference: string | null;
  amount: string; matched_line_id: string | null; matched_at: string | null; matched_by: string | null; created_at: string;
};
export type AgingRow = {
  party_id: string; party_name: string; document_id: string; document_number: string; document_date: string;
  due_date: string; outstanding: string; days_overdue: number; bucket: "current" | "1_30" | "31_60" | "61_90" | "over_90";
};


// ----------------------------------------------------------------------------- المرحلة 4
export type FixedAssetRow = {
  id: string; hotel_id: string; asset_number: string; name: string; category: string; asset_account_id: string;
  department_id: string | null; acquisition_date: string; cost: string; salvage_value: string; useful_life_months: number;
  depreciation_start: string; accumulated_depreciation: string; status: "active" | "fully_depreciated" | "disposed";
  vendor_bill_id: string | null; journal_entry_id: string | null; disposal_date: string | null; disposal_proceeds: string | null;
  disposal_journal_entry_id: string | null; notes: string | null; created_at: string; created_by: string | null;
};
export type InventoryItemRow = Audit & {
  id: string; hotel_id: string; sku: string; name_ar: string; name_en: string | null; unit: string;
  inventory_account_id: string; expense_account_id: string; reorder_level: string; quantity_on_hand: string;
  average_cost: string; is_active: boolean;
};
export type InventoryTxnRow = {
  id: string; hotel_id: string; item_id: string; txn_type: "receipt" | "issue" | "adjustment"; txn_date: string;
  quantity: string; unit_cost: string; total_cost: string; department_id: string | null; vendor_bill_id: string | null;
  description: string | null; journal_entry_id: string | null; created_at: string; created_by: string | null;
};

type FolioMoneyArgs = {
  p_folio_id: string; p_payment_method_id: string; p_amount: string;
  p_business_date?: string | null; p_reference?: string | null; p_description?: string | null;
};

type ReadOnlyTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      hotels: Table<HotelRow, "name_ar" | "country_code" | "base_currency">;
      users_profiles: Table<UserProfileRow, "id">;
      roles: Table<RoleRow, "code" | "name_ar" | "name_en">;
      hotel_members: Table<HotelMemberRow, "hotel_id" | "user_id">;
      user_hotel_roles: Table<UserHotelRoleRow, "hotel_id" | "user_id" | "role_id">;
      currencies: Table<CurrencyRow, "code" | "name_ar" | "name_en" | "symbol">;
      departments: Table<DepartmentRow, "hotel_id" | "code" | "name_ar" | "kind">;
      chart_of_accounts: Table<AccountRow, "hotel_id" | "code" | "name_ar" | "account_type" | "account_subtype">;
      fiscal_years: Table<FiscalYearRow, "hotel_id" | "name" | "start_date" | "end_date">;
      accounting_periods: Table<AccountingPeriodRow, "hotel_id" | "fiscal_year_id" | "period_no" | "name" | "start_date" | "end_date">;
      journal_entries: Table<JournalEntryRow, "hotel_id" | "entry_date" | "period_id" | "description" | "currency_code">;
      journal_entry_lines: Table<JournalEntryLineRow, "journal_entry_id" | "hotel_id" | "line_no" | "account_id">;
      audit_logs: Table<AuditLogRow, "table_name" | "record_id" | "action">;
      tax_rates: Table<TaxRateRow, "hotel_id" | "code" | "name_ar" | "kind" | "rate" | "account_id">;
      charge_codes: Table<ChargeCodeRow, "hotel_id" | "code" | "name_ar" | "category" | "department_id" | "revenue_account_id">;
      charge_code_taxes: Table<ChargeCodeTaxRow, "hotel_id" | "charge_code_id" | "tax_rate_id">;
      payment_methods: Table<PaymentMethodRow, "hotel_id" | "code" | "name_ar" | "kind" | "account_id">;
      customers: Table<CustomerRow, "hotel_id" | "code" | "name_ar">;
      guest_folios: Table<GuestFolioRow, "hotel_id" | "folio_number" | "guest_name">;
      folio_transactions: ReadOnlyTable<FolioTransactionRow>;
      invoices: ReadOnlyTable<InvoiceRow>;
      invoice_items: ReadOnlyTable<InvoiceItemRow>;
      invoice_taxes: ReadOnlyTable<InvoiceTaxRow>;
      payments: ReadOnlyTable<PaymentRow>;
      payment_allocations: ReadOnlyTable<PaymentAllocationRow>;
      vendors: Table<VendorRow, "hotel_id" | "code" | "name_ar">;
      fixed_assets: ReadOnlyTable<FixedAssetRow>;
      depreciation_schedule: ReadOnlyTable<{ id: string; hotel_id: string; asset_id: string; period_month: string; amount: string; journal_entry_id: string | null; created_at: string }>;
      inventory_items: Table<InventoryItemRow, "hotel_id" | "sku" | "name_ar" | "inventory_account_id" | "expense_account_id">;
      inventory_transactions: ReadOnlyTable<InventoryTxnRow>;
      purchase_orders: ReadOnlyTable<PurchaseOrderRow>;
      vendor_bills: ReadOnlyTable<VendorBillRow>;
      vendor_bill_lines: ReadOnlyTable<VendorBillLineRow>;
      payroll_runs: ReadOnlyTable<PayrollRunRow>;
      credit_notes: ReadOnlyTable<{ id: string; hotel_id: string; credit_note_number: string; invoice_id: string; issue_date: string; net_amount: string; tax_amount: string; total: string; reason: string; created_at: string }>;
      bank_statement_lines: Table<BankStatementLineRow, "hotel_id" | "account_id" | "txn_date" | "description" | "amount">;
    };
    Views: {
      folio_balances: {
        Row: { folio_id: string; hotel_id: string; balance: string; deposit_balance: string; net_charges: string; transaction_count: number };
        Relationships: [];
      };
      customer_balances: {
        Row: { customer_id: string; hotel_id: string; open_invoices: string; unapplied_credit: string };
        Relationships: [];
      };
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
      room_statistics: { Args: { p_hotel_id: string; p_from: string; p_to: string }; Returns: { business_date: string; room_nights: string; room_revenue: string; rooms_available: number }[] };
      cash_flow_lines: { Args: { p_hotel_id: string; p_from: string; p_to: string }; Returns: { activity: "operating" | "investing" | "financing"; account_id: string; amount: string }[] };
      cash_balance: { Args: { p_hotel_id: string; p_as_of: string }; Returns: string };
      daily_cash_report: { Args: { p_hotel_id: string; p_date: string }; Returns: { payment_method_id: string; method_name: string; source: string; receipts: string; payments: string }[] };
      monthly_pnl: { Args: { p_hotel_id: string; p_from: string; p_to: string }; Returns: { month: string; revenue: string; expenses: string }[] };
      register_fixed_asset: {
        Args: {
          p_hotel_id: string; p_name: string; p_category: string; p_asset_account_id: string; p_cost: string; p_useful_life_months: number;
          p_acquisition_date: string; p_salvage_value?: string; p_department_id?: string | null; p_vendor_bill_id?: string | null;
          p_counter_account_id?: string | null; p_notes?: string | null;
        };
        Returns: string;
      };
      run_depreciation: { Args: { p_hotel_id: string; p_month: string }; Returns: number };
      dispose_fixed_asset: { Args: { p_asset_id: string; p_disposal_date: string; p_proceeds?: string; p_proceeds_account_id?: string | null }; Returns: string };
      post_inventory_movement: {
        Args: {
          p_item_id: string; p_type: "receipt" | "issue" | "adjustment"; p_quantity: string; p_date?: string | null; p_unit_cost?: string | null;
          p_department_id?: string | null; p_vendor_bill_id?: string | null; p_description?: string | null;
        };
        Returns: string;
      };
      department_profitability: {
        Args: { p_hotel_id: string; p_from: string; p_to: string };
        Returns: { department_id: string | null; account_type: "revenue" | "expense"; account_subtype: string; amount: string }[];
      };
      create_purchase_order: { Args: { p_hotel_id: string; p_vendor_id: string; p_lines: Json; p_order_date?: string | null; p_notes?: string | null }; Returns: string };
      create_vendor_bill: {
        Args: { p_hotel_id: string; p_vendor_id: string; p_lines?: Json | null; p_po_id?: string | null; p_bill_date?: string | null; p_vendor_invoice_no?: string | null; p_notes?: string | null };
        Returns: string;
      };
      pay_vendor: {
        Args: { p_hotel_id: string; p_vendor_id: string; p_payment_method_id: string; p_allocations: Json; p_payment_date?: string | null; p_reference?: string | null; p_description?: string | null };
        Returns: string;
      };
      post_payroll: { Args: { p_hotel_id: string; p_period_month: string; p_lines: Json; p_posting_date?: string | null; p_notes?: string | null }; Returns: string };
      create_credit_note: { Args: { p_invoice_id: string; p_amount: string; p_reason: string; p_date?: string | null }; Returns: string };
      auto_match_bank_lines: { Args: { p_hotel_id: string; p_account_id: string }; Returns: number };
      aging_report: { Args: { p_hotel_id: string; p_kind: "receivable" | "payable"; p_as_of?: string | null }; Returns: AgingRow[] };
      open_folio: {
        Args: {
          p_hotel_id: string; p_guest_name: string; p_folio_type?: FolioType; p_customer_id?: string | null;
          p_room_number?: string | null; p_reservation_ref?: string | null; p_arrival_date?: string | null;
          p_departure_date?: string | null; p_adults?: number | null; p_master_folio_id?: string | null; p_notes?: string | null;
        };
        Returns: string;
      };
      post_folio_charge: {
        Args: {
          p_folio_id: string; p_charge_code_id: string; p_unit_price: string; p_quantity?: string;
          p_business_date?: string | null; p_description?: string | null; p_reference?: string | null;
        };
        Returns: string;
      };
      post_folio_allowance: {
        Args: { p_folio_id: string; p_charge_txn_id: string; p_amount: string; p_reason: string; p_business_date?: string | null };
        Returns: string;
      };
      post_folio_payment: { Args: FolioMoneyArgs & { p_customer_id?: string | null }; Returns: string };
      post_folio_refund: { Args: FolioMoneyArgs; Returns: string };
      post_folio_deposit: { Args: FolioMoneyArgs; Returns: string };
      refund_folio_deposit: { Args: FolioMoneyArgs; Returns: string };
      apply_folio_deposit: { Args: { p_folio_id: string; p_amount?: string | null; p_business_date?: string | null }; Returns: string | null };
      transfer_folio_balance: {
        Args: { p_from_folio_id: string; p_to_folio_id: string; p_amount: string; p_description?: string | null; p_business_date?: string | null };
        Returns: string;
      };
      void_folio_transaction: { Args: { p_txn_id: string; p_reason: string; p_business_date?: string | null }; Returns: string };
      cancel_folio: { Args: { p_folio_id: string }; Returns: undefined };
      checkout_folio: { Args: { p_folio_id: string; p_business_date?: string | null }; Returns: string };
      create_direct_invoice: {
        Args: { p_hotel_id: string; p_customer_id: string; p_lines: Json; p_issue_date?: string | null; p_notes?: string | null };
        Returns: string;
      };
      create_payment_voucher: {
        Args: {
          p_hotel_id: string; p_voucher_type: VoucherType; p_party_type: VoucherParty; p_payment_method_id: string;
          p_amount: string; p_description: string; p_payment_date?: string | null; p_customer_id?: string | null;
          p_counter_account_id?: string | null; p_department_id?: string | null; p_party_name?: string | null;
          p_reference?: string | null; p_allocations?: Json | null;
        };
        Returns: string;
      };
      allocate_payment: { Args: { p_payment_id: string; p_allocations: Json }; Returns: undefined };
      void_payment_voucher: { Args: { p_payment_id: string; p_reason: string; p_date?: string | null }; Returns: undefined };
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
      folio_type: FolioType;
      folio_status: FolioStatus;
      folio_txn_type: FolioTxnType;
      invoice_type: InvoiceType;
      invoice_status: InvoiceStatus;
      voucher_type: VoucherType;
      voucher_party: VoucherParty;
      voucher_status: VoucherStatus;
      payment_method_kind: PaymentMethodKind;
      charge_category: ChargeCategory;
      customer_type: CustomerType;
      tax_kind: TaxKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
