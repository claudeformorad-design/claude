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
  | "payment" | "vendor_bill" | "expense" | "payroll" | "depreciation" | "inventory" | "petty_cash" | "cashier_shift";
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

export type RoomAccess = "card" | "key";
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
  require_cashier_shift: boolean;
  /** طريقة دخول الغرف التي تُسلَّم للنزيل عند التسكين */
  room_access: RoomAccess;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  is_active: boolean;
  journal_approval_threshold: string | null;
  voucher_approval_threshold: string | null;
  /** الأقسام المفعّلة بالترخيص */
  enabled_modules: HotelModule[];
  check_in_time: string;
  check_out_time: string;
  /** ليالي نهاية الأسبوع (0 = الأحد … 6 = السبت) */
  weekend_nights: number[];
};

export type HotelModule = "accounting" | "pms";

export type UserProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_locale: "ar" | "en";
  default_hotel_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  password_chosen: boolean;
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

export type RoleSettingsRow = {
  hotel_id: string; role_id: string; home_path: string | null; quick_actions: string[]; dashboard_hidden: string[];
  limits: Record<string, number | null>; updated_at: string; updated_by: string | null;
};
export type ApprovalKind = "folio_action" | "reservation_cancel" | "voucher_void";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "cancelled";
export type ApprovalRequestRow = {
  id: string; hotel_id: string; kind: ApprovalKind; payload: Json; summary: string; amount: string | null; note: string | null;
  status: ApprovalStatus; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; result: string | null; error: string | null;
};
export type HotelMemberRow = Audit & {
  hotel_id: string;
  user_id: string;
  is_active: boolean;
  home_path: string | null;
  limits: Record<string, number | null>;
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
export type InvoiceType = "folio" | "direct" | "opening";
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
  kind: PaymentMethodKind; account_id: string; is_active: boolean; currency_code: string | null;
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
  currency_code: string | null; foreign_amount: string | null; exchange_rate: string | null; cashier_shift_id: string | null;
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
export type PurchaseOrderItemRow = {
  id: string; po_id: string; hotel_id: string; line_no: number; description: string; account_id: string;
  department_id: string | null; quantity: string; unit_price: string; tax_rate_id: string | null;
};
export type VendorBillLineRow = {
  id: string; bill_id: string; hotel_id: string; line_no: number; description: string; account_id: string;
  department_id: string | null; quantity: string; unit_price: string; net_amount: string; tax_rate_id: string | null; tax_amount: string;
};
export type PayrollRunRow = {
  id: string; hotel_id: string; run_number: string; period_month: string; posting_date: string;
  total_gross: string; total_net: string; journal_entry_id: string | null; notes: string | null; created_at: string; from_hr: boolean;
};
export type PayrollLineRow = {
  id: string; run_id: string; hotel_id: string; employee_id: string | null; employee_name: string; employee_code: string | null; department_id: string;
  basic: string; allowances: string; overtime: string; deductions: string; insurance_employee: string; insurance_employer: string;
  advance_recovery: string; net_pay: string; details: Json | null;
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
export type LedgerControl = "guest_ledger" | "guest_deposits" | "accounts_receivable" | "accounts_payable" | "inventory" | "trial_balance";
export type InventoryItemRow = Audit & {
  id: string; hotel_id: string; sku: string; name_ar: string; name_en: string | null; unit: string;
  inventory_account_id: string; expense_account_id: string; reorder_level: string; quantity_on_hand: string;
  average_cost: string; stock_value: string; is_active: boolean;
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

// ----------------------------------------------------------------------------- خدمات التشغيل (الترحيل 31)
export type MaintenancePriority = "low" | "normal" | "high" | "urgent";
export type MaintenanceStatus = "open" | "in_progress" | "on_hold" | "done" | "cancelled";
export type MaintenanceAssetCategory = "ac" | "electrical" | "plumbing" | "appliance" | "furniture" | "elevator" | "generator" | "it" | "other";
export type MaintenanceAssetRow = {
  id: string; hotel_id: string; code: string | null; name: string; category: MaintenanceAssetCategory; room_id: string | null; location: string | null;
  brand: string | null; serial_number: string | null; purchase_date: string | null; warranty_until: string | null; notes: string | null;
  is_active: boolean; created_at: string; created_by: string | null;
};
export type MaintenanceRequestRow = {
  id: string; hotel_id: string; request_number: string; title: string; description: string | null; room_id: string | null; asset_id: string | null;
  location: string | null; priority: MaintenancePriority; status: MaintenanceStatus; assignee: string | null; out_of_service: boolean;
  due_date: string | null; labor_cost: string; resolution: string | null; reported_by: string | null; reported_at: string;
  started_at: string | null; completed_at: string | null; completed_by: string | null;
};
export type MaintenancePartRow = {
  id: string; hotel_id: string; request_id: string; description: string; quantity: string; unit_cost: string; inventory_item_id: string | null;
  created_at: string; created_by: string | null;
};
export type LostItemCategory = "electronics" | "documents" | "money" | "jewelry" | "clothing" | "bags" | "other";
export type LostFoundRow = {
  id: string; hotel_id: string; item_number: string; found_date: string; found_location: string | null; room_id: string | null; description: string;
  category: LostItemCategory; found_by: string | null; storage_location: string | null; guest_id: string | null; status: "stored" | "returned" | "disposed";
  returned_to: string | null; returned_id_number: string | null; returned_at: string | null; returned_by: string | null; closed_note: string | null;
  created_at: string; created_by: string | null;
};
export type SafeDepositRow = {
  id: string; hotel_id: string; deposit_number: string; guest_id: string | null; guest_name: string; reservation_id: string | null; room_number: string | null;
  box_number: string; items: string; status: "held" | "returned"; deposited_at: string; received_by: string | null; returned_at: string | null;
  returned_by: string | null; return_note: string | null;
};
export type LaundryService = "wash" | "iron" | "wash_iron" | "dry_clean";
export type LaundryItemRow = {
  id: string; hotel_id: string; name: string; service: LaundryService; price: string; charge_code_id: string; is_active: boolean; sort_order: number;
  created_at: string; created_by: string | null;
};
export type LaundryStatus = "received" | "in_process" | "ready" | "delivered" | "cancelled";
export type LaundryOrderRow = {
  id: string; hotel_id: string; order_number: string; reservation_id: string; folio_id: string; room_number: string | null; guest_name: string;
  status: LaundryStatus; express: boolean; express_pct: string; promised_at: string | null; notes: string | null; total: string;
  received_at: string; received_by: string | null; delivered_at: string | null; delivered_by: string | null;
};
export type LaundryOrderLineRow = {
  order_id: string; line_no: number; hotel_id: string; item_id: string; name: string; quantity: number; unit_price: string; folio_transaction_id: string | null;
};
export type LinenTypeRow = { id: string; hotel_id: string; name: string; par_level: number; is_active: boolean; created_at: string; created_by: string | null };
export type LinenMovementKind = "purchased" | "sent" | "returned" | "damaged";
export type LinenMovementRow = {
  id: string; hotel_id: string; linen_type_id: string; movement_date: string; kind: LinenMovementKind; quantity: number; notes: string | null;
  created_at: string; created_by: string | null;
};
export type EventType = "wedding" | "conference" | "meeting" | "party" | "graduation" | "other";
export type EventStatus = "tentative" | "confirmed" | "completed" | "cancelled";
export type EventBookingRow = {
  id: string; hotel_id: string; event_number: string; title: string; event_type: EventType; status: EventStatus; customer_id: string | null;
  contact_name: string; contact_phone: string | null; hall_room_id: string | null; starts_at: string; ends_at: string; guests_count: number;
  discount: string; folio_id: string | null; notes: string | null; terms: string | null; cancel_reason: string | null; created_at: string;
  created_by: string | null; completed_at: string | null;
};
export type EventItemRow = {
  event_id: string; line_no: number; hotel_id: string; description: string; per_person: boolean; quantity: string; unit_price: string; charge_code_id: string;
};
export type EventTaskRow = {
  id: string; hotel_id: string; event_id: string; due_at: string; task: string; owner: string | null; done: boolean; done_at: string | null;
  created_at: string; created_by: string | null;
};
export type GuestSurveyRow = {
  id: string; hotel_id: string; reservation_id: string | null; guest_name: string; room_number: string | null; token: string;
  status: "pending" | "completed"; channel: "kiosk" | "link" | "paper" | null; overall: number | null; cleanliness: number | null; staff: number | null;
  comfort: number | null; value: number | null; food: number | null; recommend: boolean | null; comment: string | null; created_at: string;
  completed_at: string | null; entered_by: string | null;
};

type ReadOnlyTable<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

// =============================================================================
// قسم إدارة الفندق
// =============================================================================
export type BookingMode = "nightly" | "hourly";
export type HousekeepingStatus = "clean" | "dirty" | "inspected";
export type RoomServiceStatus = "in_service" | "out_of_service";
export type GuestIdType = "national_id" | "passport" | "residence" | "other";
export type ReservationStatus = "tentative" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type ReservationSource = "direct" | "phone" | "walk_in" | "website" | "booking_com" | "expedia" | "agent" | "corporate" | "other";
export type ReservationPricing = "standard" | "fixed" | "monthly";
export type WaitlistStatus = "waiting" | "converted" | "cancelled";
export type SeriesStatus = "active" | "cancelled";

export type FloorRow = Audit & { id: string; hotel_id: string; name: string; sort_order: number };
export type RoomTypeRow = Audit & {
  id: string; hotel_id: string; code: string; name_ar: string; booking_mode: BookingMode;
  max_adults: number; max_children: number; base_rate: string; weekend_rate: string | null; min_hours: string;
  overbooking_limit: number; charge_code_id: string | null; description: string | null; is_active: boolean; sort_order: number;
};
export type RoomRow = Audit & {
  id: string; hotel_id: string; room_number: string; floor_id: string | null; room_type_id: string;
  housekeeping_status: HousekeepingStatus; service_status: RoomServiceStatus; service_note: string | null;
  notes: string | null; is_active: boolean; sort_order: number;
};
export type GuestRow = Audit & {
  id: string; hotel_id: string; full_name: string; phone: string | null; email: string | null; nationality: string | null;
  id_type: GuestIdType | null; id_number: string | null; date_of_birth: string | null; customer_id: string | null;
  notes: string | null; is_blacklisted: boolean; blacklist_reason: string | null;
};
export type RateSeasonRow = Audit & {
  id: string; hotel_id: string; name: string; date_from: string; date_to: string; adjust_pct: string | null; is_active: boolean; notes: string | null;
};
export type RateSeasonPriceRow = { season_id: string; hotel_id: string; room_type_id: string; nightly_rate: string; weekend_rate: string | null };
export type LastMinuteRuleRow = Audit & {
  id: string; hotel_id: string; name: string; room_type_id: string | null; days_before: number; discount_pct: string; is_active: boolean;
};
export type ReservationRow = Audit & {
  id: string; hotel_id: string; confirmation_number: string; guest_id: string; customer_id: string | null;
  room_type_id: string; room_id: string | null; booking_mode: BookingMode; arrival_date: string; departure_date: string;
  starts_at: string | null; ends_at: string | null; adults: number; children: number; status: ReservationStatus;
  source: ReservationSource; pricing: ReservationPricing; fixed_rate: string | null; rate_reason: string | null;
  last_minute_pct: string | null; total_amount: string; group_id: string | null; series_id: string | null;
  tentative_until: string | null; special_requests: string | null; notes: string | null;
  cancelled_at: string | null; cancelled_by: string | null; cancellation_reason: string | null; folio_id: string | null;
  checked_in_at: string | null; checked_out_at: string | null; bill_to: BillTo; rate_plan_id: string | null;
  keys_issued: number | null; keys_issued_by: string | null;
};
export type ReservationNightRow = {
  reservation_id: string; hotel_id: string; stay_date: string; quantity: string; rate: string; discount: string; amount: string; season_id: string | null;
  folio_transaction_id: string | null;
};
export type BillTo = "guest" | "company_room" | "company_all";
export type CheckOutSummary = { folio_id: string; balance: number; deposits: number; due: number; company_due: number; bill_to: BillTo };

export type ExchangeRateRow = { id: string; hotel_id: string; currency_code: string; rate_date: string; rate: string; created_at: string; created_by: string | null };

export type DayStats = {
  date: string; capacity: number; occupied: number; complimentary: number; vacant: number; out_of_service: number; guests: number;
  occupancy_pct: number; room_revenue: number; adr: number; revpar: number; arrivals: number; departures: number; no_shows: number;
  cancellations: number; new_bookings: number; hourly_sessions: number;
  revenue_by_category: { category: string; net: number; tax: number }[];
  collections: { method: string; kind: string; amount: number }[];
  guest_ledger: number; deposits_held: number; forecast: { date: string; sold: number }[];
};
export type AuditSummary = DayStats & {
  nights_posted: number; no_shows_marked: number; open_shifts: number;
  overstays: { id: string; confirmation_number: string; guest: string; departure_date: string }[];
  no_show_list: { id: string; confirmation_number: string; guest: string; arrival_date: string }[];
};
export type NightAuditStatus = {
  date: string; today: string; done: boolean; last_audit: string | null; unposted_nights: number; unposted_amount: number;
  pending_no_shows: { id: string; confirmation_number: string; guest: string; arrival_date: string; status: string }[];
  overstays: { id: string; confirmation_number: string; guest: string; departure_date: string }[];
  open_shifts: number; stats: DayStats;
};
export type NightAuditRow = { id: string; hotel_id: string; business_date: string; run_at: string; run_by: string | null; summary: AuditSummary };
export type GuestRegisterRow = {
  reservation_id: string; confirmation_number: string; room_number: string | null; full_name: string; nationality: string | null;
  id_type: GuestIdType | null; id_number: string | null; date_of_birth: string | null; phone: string | null; adults: number; children: number;
  arrival_date: string; departure_date: string; checked_in_at: string | null; company: string | null;
};

export type PosOutletRow = { id: string; hotel_id: string; code: string; name_ar: string; is_active: boolean; sort_order: number; created_at: string; created_by: string | null };
export type PosItemRow = {
  id: string; hotel_id: string; outlet_id: string; name_ar: string; category: string | null; price: string; charge_code_id: string;
  is_active: boolean; sort_order: number; created_at: string; created_by: string | null;
};
export type PosOrderRow = {
  id: string; hotel_id: string; outlet_id: string; order_number: string; settle_mode: "room" | "paid"; reservation_id: string | null;
  folio_id: string; invoice_id: string | null; payment_method_id: string | null; total: string; note: string | null; created_at: string; created_by: string | null;
};
export type PosOrderLineRow = {
  order_id: string; line_no: number; hotel_id: string; item_id: string; name_ar: string; quantity: string; unit_price: string; folio_transaction_id: string | null;
};
export type HousekeepingKind = "departure" | "stayover" | "inspection" | "maintenance" | "turndown";
export type HousekeepingTaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export type HousekeepingTaskRow = {
  id: string; hotel_id: string; room_id: string; task_date: string; kind: HousekeepingKind; status: HousekeepingTaskStatus;
  assignee: string | null; priority: number; notes: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};
export type RatePlanRow = {
  id: string; hotel_id: string; code: string; name_ar: string; adjust_pct: string; per_night: string; per_person: boolean;
  includes_breakfast: boolean; customer_id: string | null; room_type_id: string | null; description: string | null; is_active: boolean;
  created_at: string; created_by: string | null;
};

export type CashierShiftRow = {
  id: string; hotel_id: string; shift_number: string; user_id: string; business_date: string; opened_at: string;
  opening_float: string; float_method_id: string | null; status: "open" | "closed"; closed_at: string | null;
  closed_by: string | null; closing_note: string | null; over_short_entry_id: string | null;
};
export type ShiftMethodLine = {
  payment_method_id: string; code: string; name: string; kind: PaymentMethodKind; currency_code: string; foreign: boolean;
  float: number; receipts: number; payouts: number; expected: number; base_total: number; count: number;
  counted: number | null; difference: number | null; difference_base: number | null;
};
export type ShiftReport = {
  shift: { id: string; shift_number: string; status: "open" | "closed"; business_date: string; opened_at: string; closed_at: string | null;
    opening_float: number; closing_note: string | null; user_id: string; is_mine: boolean; user_name: string; over_short_entry_id: string | null };
  methods: ShiftMethodLine[];
  transactions: { id: string; created_at: string; txn_type: FolioTxnType; direction: 1 | -1; method: string; amount: number;
    foreign_amount: number | null; currency_code: string | null; folio_id: string; folio_number: string; guest_name: string;
    room_number: string | null; reference: string | null }[];
};
export type ReservationGroupRow = {
  id: string; hotel_id: string; group_number: string; name: string; customer_id: string | null; leader_guest_id: string | null;
  notes: string | null; created_at: string; created_by: string | null;
};
export type ReservationSeriesRow = {
  id: string; hotel_id: string; guest_id: string; customer_id: string | null; room_type_id: string; room_id: string | null;
  weekday: number; nights: number | null; start_time: string | null; end_time: string | null; start_date: string; end_date: string;
  adults: number; children: number; status: SeriesStatus; notes: string | null; cancelled_at: string | null; created_at: string; created_by: string | null;
};
export type WaitlistEntryRow = Audit & {
  id: string; hotel_id: string; guest_id: string | null; guest_name: string; phone: string | null; room_type_id: string;
  arrival_date: string; departure_date: string; adults: number; children: number; notes: string | null;
  status: WaitlistStatus; reservation_id: string | null; series_id: string | null;
};
export type QuoteLine = { date: string; quantity: number; rate: number; discount: number; amount: number; season: string | null };
export type ReservationQuote = {
  lines: QuoteLine[]; total: number; discount: number; nights: number | null; last_minute_pct: number | null;
  booking_mode: BookingMode; capacity: number | null; min_available: number | null; overbooking_limit: number;
};
export type FrontDeskSummary = {
  today: string; arrivals: number; departures: number; in_house: number; capacity: number; sold_tonight: number;
  available_tonight: number; out_of_service: number; dirty: number; tentative: number; waitlist_ready: number;
};

// ----------------------------------------------------------------------------- الموارد البشرية
export type EosTier = { from: number; days: number };
export type EosResign = { from: number; pct: number };
export type HrSettingsRow = {
  hotel_id: string; work_hours_per_day: string; weekend_days: number[]; month_days: number; late_grace_minutes: number;
  late_deduction_rate: string; absence_deduction_days: string; overtime_rate: string; insurance_employee_pct: string; insurance_employer_pct: string;
  eos_tiers: EosTier[]; eos_resign: EosResign[]; leave_encashment: boolean; expiry_alert_days: number; updated_at: string; updated_by: string | null;
};
export type HrLeaveTypeRow = { id: string; hotel_id: string; name: string; days_per_year: string; paid: boolean; carry_over: boolean; encashable: boolean; is_active: boolean; sort_order: number };
export type HrPayComponentRow = {
  id: string; hotel_id: string; name: string; kind: "allowance" | "deduction"; calc: "fixed" | "percent"; default_value: string;
  insurable: boolean; in_eos: boolean; is_active: boolean; sort_order: number;
};
export type HrShiftRow = { id: string; hotel_id: string; name: string; start_time: string; end_time: string; is_active: boolean };
export type HrEmployeeRow = {
  id: string; hotel_id: string; code: string; full_name: string; job_title: string | null; department_id: string; phone: string | null;
  email: string | null; nationality: string | null; id_number: string | null; id_expiry: string | null; birth_date: string | null;
  hire_date: string; contract_type: "permanent" | "fixed" | "part_time"; contract_end: string | null; basic_salary: string;
  shift_id: string | null; status: "active" | "terminated"; termination_date: string | null; termination_reason: "resignation" | "termination" | null;
  notes: string | null; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};
export type HrEmployeeComponentRow = { employee_id: string; hotel_id: string; component_id: string; value: string };
export type HrRosterRow = { hotel_id: string; employee_id: string; work_date: string; shift_id: string | null };
export type HrAttendanceRow = {
  id: string; hotel_id: string; employee_id: string; work_date: string; status: "present" | "absent" | "leave" | "off";
  check_in: string | null; check_out: string | null; shift_start: string | null; shift_end: string | null;
  late_minutes: number; overtime_minutes: number; worked_minutes: number; notes: string | null;
};
export type HrLeaveRow = {
  id: string; hotel_id: string; employee_id: string; leave_type_id: string; start_date: string; end_date: string; days: string;
  status: "pending" | "approved" | "rejected" | "cancelled"; reason: string | null; decided_by: string | null; decided_at: string | null; created_at: string;
};
export type HrAdvanceRow = {
  id: string; hotel_id: string; advance_number: string; employee_id: string; advance_date: string; amount: string; installments: number;
  installment_amount: string; recovered: string; status: "open" | "closed"; payment_method_id: string; journal_entry_id: string | null; notes: string | null;
};
export type HrPenaltyRow = {
  id: string; hotel_id: string; employee_id: string; penalty_date: string; amount: string; reason: string;
  status: "pending" | "approved" | "cancelled"; payroll_run_id: string | null;
};
export type HrSettlementRow = {
  id: string; hotel_id: string; employee_id: string; settlement_date: string; reason: "resignation" | "termination"; service_years: string;
  eos_amount: string; leave_days: string; leave_amount: string; advances_recovered: string; net_amount: string; journal_entry_id: string | null;
  details: Record<string, unknown>; created_at: string;
};

// ----------------------------------------------------------------------------- المساعد الذكي
export type AssistantConversationRow = { id: string; hotel_id: string; user_id: string; title: string; pinned: boolean; created_at: string; updated_at: string };
export type AssistantMessageRow = { id: string; conversation_id: string; role: "user" | "assistant"; content: string; is_error: boolean; created_at: string };
export type AssistantSavedRow = { id: string; hotel_id: string; user_id: string; conversation_id: string | null; question: string; content: string; created_at: string };
export type AssistantSettingsRow = { hotel_id: string; user_id: string; instructions: string; open_mode: "panel" | "page"; updated_at: string };

export type Database = {
  public: {
    Tables: {
      hotels: Table<HotelRow, "name_ar" | "country_code" | "base_currency">;
      users_profiles: Table<UserProfileRow, "id">;
      roles: Table<RoleRow, "code" | "name_ar" | "name_en">;
      permissions: ReadOnlyTable<{ code: string; module: string; action: string; name_ar: string; name_en: string; sort_order: number; product: string }>;
      role_permissions: Table<{ role_id: string; permission_code: string }, "role_id" | "permission_code">;
      user_hotel_roles: Table<{ hotel_id: string; user_id: string; role_id: string; created_at: string; created_by: string | null }, "hotel_id" | "user_id" | "role_id">;
      hotel_members: Table<HotelMemberRow, "hotel_id" | "user_id">;
      user_permission_overrides: Table<{ hotel_id: string; user_id: string; permission_code: string; allow: boolean; created_at: string; created_by: string | null }, "hotel_id" | "user_id" | "permission_code" | "allow">;
      role_settings: Table<RoleSettingsRow, "hotel_id" | "role_id">;
      approval_requests: Table<ApprovalRequestRow, "hotel_id" | "kind" | "payload" | "summary">;
      currencies: Table<CurrencyRow, "code" | "name_ar" | "name_en" | "symbol">;
      exchange_rates: Table<ExchangeRateRow, "hotel_id" | "currency_code" | "rate_date" | "rate">;
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
      purchase_order_items: ReadOnlyTable<PurchaseOrderItemRow>;
      vendor_bills: ReadOnlyTable<VendorBillRow>;
      vendor_bill_lines: ReadOnlyTable<VendorBillLineRow>;
      payroll_runs: ReadOnlyTable<PayrollRunRow>;
      payroll_lines: ReadOnlyTable<PayrollLineRow>;
      credit_notes: ReadOnlyTable<{ id: string; hotel_id: string; credit_note_number: string; invoice_id: string; issue_date: string; net_amount: string; tax_amount: string; total: string; reason: string; created_at: string }>;
      bank_statement_lines: Table<BankStatementLineRow, "hotel_id" | "account_id" | "txn_date" | "description" | "amount">;
      floors: Table<FloorRow, "hotel_id" | "name">;
      room_types: Table<RoomTypeRow, "hotel_id" | "code" | "name_ar">;
      rooms: Table<RoomRow, "hotel_id" | "room_number" | "room_type_id">;
      guests: Table<GuestRow, "hotel_id" | "full_name">;
      rate_seasons: Table<RateSeasonRow, "hotel_id" | "name" | "date_from" | "date_to">;
      rate_season_prices: Table<RateSeasonPriceRow, "season_id" | "hotel_id" | "room_type_id" | "nightly_rate">;
      last_minute_rules: Table<LastMinuteRuleRow, "hotel_id" | "name" | "days_before" | "discount_pct">;
      reservations: ReadOnlyTable<ReservationRow>;
      cashier_shifts: ReadOnlyTable<CashierShiftRow>;
      night_audits: ReadOnlyTable<NightAuditRow>;
      pos_outlets: Table<PosOutletRow, "hotel_id" | "code" | "name_ar">;
      pos_items: Table<PosItemRow, "hotel_id" | "outlet_id" | "name_ar" | "price" | "charge_code_id">;
      pos_orders: ReadOnlyTable<PosOrderRow>;
      pos_order_lines: ReadOnlyTable<PosOrderLineRow>;
      housekeeping_tasks: ReadOnlyTable<HousekeepingTaskRow>;
      rate_plans: Table<RatePlanRow, "hotel_id" | "code" | "name_ar">;
      reservation_nights: ReadOnlyTable<ReservationNightRow>;
      reservation_groups: ReadOnlyTable<ReservationGroupRow>;
      reservation_series: ReadOnlyTable<ReservationSeriesRow>;
      waitlist_entries: ReadOnlyTable<WaitlistEntryRow>;
      hr_settings: Table<HrSettingsRow, "hotel_id">;
      hr_leave_types: Table<HrLeaveTypeRow, "hotel_id" | "name">;
      hr_pay_components: Table<HrPayComponentRow, "hotel_id" | "name" | "kind">;
      hr_shifts: Table<HrShiftRow, "hotel_id" | "name" | "start_time" | "end_time">;
      hr_employees: Table<HrEmployeeRow, "hotel_id" | "full_name" | "department_id" | "hire_date">;
      hr_employee_components: Table<HrEmployeeComponentRow, "employee_id" | "hotel_id" | "component_id" | "value">;
      hr_roster: Table<HrRosterRow, "hotel_id" | "employee_id" | "work_date">;
      hr_attendance: Table<HrAttendanceRow, "hotel_id" | "employee_id" | "work_date">;
      hr_leaves: Table<HrLeaveRow, "hotel_id" | "employee_id" | "leave_type_id" | "start_date" | "end_date">;
      hr_advances: ReadOnlyTable<HrAdvanceRow>;
      hr_penalties: Table<HrPenaltyRow, "hotel_id" | "employee_id" | "penalty_date" | "amount" | "reason">;
      hr_settlements: ReadOnlyTable<HrSettlementRow>;
      assistant_conversations: Table<AssistantConversationRow, "hotel_id" | "title">;
      assistant_messages: Table<AssistantMessageRow, "conversation_id" | "role" | "content">;
      assistant_saved: Table<AssistantSavedRow, "hotel_id" | "content">;
      assistant_settings: Table<AssistantSettingsRow, "hotel_id">;
      maintenance_assets: Table<MaintenanceAssetRow, "hotel_id" | "name">;
      maintenance_requests: ReadOnlyTable<MaintenanceRequestRow>;
      maintenance_parts: ReadOnlyTable<MaintenancePartRow>;
      lost_found_items: ReadOnlyTable<LostFoundRow>;
      safe_deposits: ReadOnlyTable<SafeDepositRow>;
      laundry_items: Table<LaundryItemRow, "hotel_id" | "name" | "price" | "charge_code_id">;
      laundry_orders: ReadOnlyTable<LaundryOrderRow>;
      laundry_order_lines: ReadOnlyTable<LaundryOrderLineRow>;
      linen_types: Table<LinenTypeRow, "hotel_id" | "name">;
      linen_movements: Table<LinenMovementRow, "hotel_id" | "linen_type_id" | "movement_date" | "kind" | "quantity">;
      event_bookings: ReadOnlyTable<EventBookingRow>;
      event_items: ReadOnlyTable<EventItemRow>;
      event_tasks: Table<EventTaskRow, "hotel_id" | "event_id" | "due_at" | "task">;
      guest_surveys: ReadOnlyTable<GuestSurveyRow>;
    };
    Views: {
      linen_balances: {
        Row: { linen_type_id: string; hotel_id: string; name: string; par_level: number; is_active: boolean; total: number; at_laundry: number };
        Relationships: [];
      };
      folio_balances: {
        Row: { folio_id: string; hotel_id: string; balance: string; deposit_balance: string; net_charges: string; transaction_count: number };
        Relationships: [];
      };
      customer_balances: {
        Row: { customer_id: string; hotel_id: string; open_invoices: string; unapplied_credit: string };
        Relationships: [];
      };
      audit_log_view: { Row: AuditLogRow & { actor_name: string | null }; Relationships: [] };
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
      set_hotel_modules: { Args: { p_hotel_id: string; p_modules: HotelModule[] }; Returns: undefined };
      create_reservation: {
        Args: {
          p_hotel_id: string; p_guest_id: string; p_room_type_id: string; p_arrival_date?: string | null; p_departure_date?: string | null;
          p_adults?: number; p_children?: number; p_room_id?: string | null; p_status?: ReservationStatus; p_source?: ReservationSource;
          p_customer_id?: string | null; p_pricing?: ReservationPricing; p_fixed_rate?: string | null; p_rate_reason?: string | null;
          p_starts_at?: string | null; p_ends_at?: string | null; p_special_requests?: string | null; p_notes?: string | null;
          p_tentative_until?: string | null; p_group_id?: string | null; p_series_id?: string | null;
        };
        Returns: string;
      };
      update_reservation: {
        Args: {
          p_reservation_id: string; p_room_type_id: string; p_arrival_date?: string | null; p_departure_date?: string | null;
          p_adults?: number; p_children?: number; p_source?: ReservationSource; p_customer_id?: string | null;
          p_pricing?: ReservationPricing; p_fixed_rate?: string | null; p_rate_reason?: string | null;
          p_starts_at?: string | null; p_ends_at?: string | null; p_special_requests?: string | null; p_notes?: string | null;
          p_tentative_until?: string | null; p_reprice?: boolean;
        };
        Returns: undefined;
      };
      assign_reservation_room: { Args: { p_reservation_id: string; p_room_id: string | null }; Returns: undefined };
      confirm_reservation: { Args: { p_reservation_id: string }; Returns: undefined };
      cancel_reservation: { Args: { p_reservation_id: string; p_reason: string }; Returns: undefined };
      mark_reservation_no_show: { Args: { p_reservation_id: string; p_reason?: string | null }; Returns: undefined };
      quote_reservation: {
        Args: {
          p_hotel_id: string; p_room_type_id: string; p_arrival_date?: string | null; p_departure_date?: string | null;
          p_pricing?: ReservationPricing; p_fixed_rate?: string | null; p_starts_at?: string | null; p_ends_at?: string | null;
          p_exclude_reservation_id?: string | null;
        };
        Returns: ReservationQuote;
      };
      room_type_availability: {
        Args: { p_hotel_id: string; p_from: string; p_to: string };
        Returns: { room_type_id: string; stay_date: string; capacity: number; sold: number; available: number }[];
      };
      create_group_reservation: {
        Args: {
          p_hotel_id: string; p_name: string; p_guest_id: string; p_room_type_id: string; p_arrival_date: string; p_departure_date: string;
          p_rooms: number; p_adults?: number; p_children?: number; p_customer_id?: string | null; p_status?: ReservationStatus;
          p_source?: ReservationSource; p_notes?: string | null;
        };
        Returns: string;
      };
      create_reservation_series: {
        Args: {
          p_hotel_id: string; p_guest_id: string; p_room_type_id: string; p_weekday: number; p_start_date: string; p_end_date: string;
          p_nights?: number | null; p_start_time?: string | null; p_end_time?: string | null; p_room_id?: string | null;
          p_adults?: number; p_children?: number; p_customer_id?: string | null; p_source?: ReservationSource; p_notes?: string | null;
          p_waitlist_conflicts?: boolean;
        };
        Returns: { series_id: string; created: number; skipped: string[]; waitlisted: number };
      };
      cancel_reservation_series: { Args: { p_series_id: string; p_reason: string; p_from_date?: string | null }; Returns: number };
      add_waitlist_entry: {
        Args: {
          p_hotel_id: string; p_room_type_id: string; p_arrival_date: string; p_departure_date: string; p_guest_id?: string | null;
          p_guest_name?: string | null; p_phone?: string | null; p_adults?: number; p_children?: number; p_notes?: string | null;
        };
        Returns: string;
      };
      waitlist_overview: { Args: { p_hotel_id: string }; Returns: (WaitlistEntryRow & { is_available: boolean; is_expired: boolean })[] };
      waitlist_ready_count: { Args: { p_hotel_id: string }; Returns: number };
      convert_waitlist_entry: { Args: { p_entry_id: string; p_room_id?: string | null }; Returns: string };
      cancel_waitlist_entry: { Args: { p_entry_id: string }; Returns: undefined };
      create_rooms_bulk: {
        Args: { p_hotel_id: string; p_room_type_id: string; p_from_number: number; p_to_number: number; p_floor_id?: string | null; p_prefix?: string | null };
        Returns: number;
      };
      set_room_status: {
        Args: { p_room_id: string; p_housekeeping_status?: HousekeepingStatus | null; p_service_status?: RoomServiceStatus | null; p_service_note?: string | null };
        Returns: undefined;
      };
      front_desk_summary: { Args: { p_hotel_id: string }; Returns: FrontDeskSummary };
      record_reservation_deposit: { Args: { p_reservation_id: string; p_payment_method_id: string; p_amount: string; p_reference?: string | null }; Returns: string };
      check_in_reservation: { Args: { p_reservation_id: string; p_room_id?: string | null; p_keys?: number }; Returns: string };
      post_reservation_charges: { Args: { p_reservation_id: string; p_through?: string | null }; Returns: number };
      prepare_check_out: { Args: { p_reservation_id: string }; Returns: CheckOutSummary };
      night_audit_status: { Args: { p_hotel_id: string; p_date?: string | null }; Returns: NightAuditStatus };
      run_night_audit: { Args: { p_hotel_id: string; p_date?: string | null }; Returns: AuditSummary };
      guest_register: { Args: { p_hotel_id: string; p_date?: string | null }; Returns: GuestRegisterRow[] };
      post_opening_balances: {
        Args: { p_hotel_id: string; p_date: string; p_accounts?: { account_id: string; debit?: string; credit?: string }[];
          p_customers?: { customer_id: string; amount: string; reference?: string }[]; p_vendors?: { vendor_id: string; amount: string; reference?: string }[] };
        Returns: string;
      };
      pos_in_house: { Args: { p_hotel_id: string }; Returns: { reservation_id: string; room_number: string | null; guest_name: string; confirmation_number: string; folio_id: string }[] };
      pos_settle_order: {
        Args: { p_outlet_id: string; p_lines: { item_id: string; quantity: string }[]; p_mode: "room" | "paid"; p_reservation_id?: string | null; p_payment_method_id?: string | null; p_note?: string | null };
        Returns: { order_id: string; order_number: string; total: number; invoice_id: string | null; folio_id: string };
      };
      generate_housekeeping_tasks: { Args: { p_hotel_id: string; p_date?: string | null }; Returns: number };
      add_housekeeping_task: { Args: { p_room_id: string; p_kind: HousekeepingKind; p_date?: string | null; p_notes?: string | null; p_assignee?: string | null; p_out_of_service?: boolean }; Returns: string };
      update_housekeeping_task: { Args: { p_task_id: string; p_status?: HousekeepingTaskStatus | null; p_assignee?: string | null; p_notes?: string | null }; Returns: undefined };
      set_reservation_rate_plan: { Args: { p_reservation_id: string; p_rate_plan_id: string | null }; Returns: undefined };
      set_reservation_billing: { Args: { p_reservation_id: string; p_bill_to: BillTo }; Returns: undefined };
      set_exchange_rate: { Args: { p_hotel_id: string; p_currency_code: string; p_rate: string; p_rate_date?: string | null }; Returns: undefined };
      post_folio_foreign_money: { Args: { p_folio_id: string; p_txn_type: "payment" | "deposit" | "refund" | "deposit_refund"; p_payment_method_id: string; p_foreign_amount: string; p_reference?: string | null }; Returns: string };
      record_reservation_deposit_fx: { Args: { p_reservation_id: string; p_payment_method_id: string; p_foreign_amount: string; p_reference?: string | null }; Returns: string };
      open_cashier_shift: { Args: { p_hotel_id: string; p_opening_float?: string }; Returns: string };
      cashier_shift_report: { Args: { p_shift_id: string }; Returns: ShiftReport };
      close_cashier_shift: { Args: { p_shift_id: string; p_counts: { payment_method_id: string; counted: string }[]; p_note?: string | null }; Returns: ShiftReport };
      check_out_reservation: { Args: { p_reservation_id: string }; Returns: string | null };
      move_reservation_room: { Args: { p_reservation_id: string; p_room_id: string; p_reason: string }; Returns: undefined };
      change_stay_departure: { Args: { p_reservation_id: string; p_departure_date: string }; Returns: undefined };
      close_fiscal_year: { Args: { p_fiscal_year_id: string }; Returns: string | null };
      set_period_status: { Args: { p_period_id: string; p_status: PeriodStatus }; Returns: undefined };
      add_hotel_member: { Args: { p_hotel_id: string; p_email: string; p_role_ids: string[] }; Returns: string };
      hotel_members_overview: { Args: { p_hotel_id: string }; Returns: { user_id: string; email: string; full_name: string; is_active: boolean; role_ids: string[] }[] };
      customer_pending_city_ledger: { Args: { p_customer_id: string }; Returns: string };
      tax_return: {
        Args: { p_hotel_id: string; p_from: string; p_to: string };
        Returns: { tax_rate_id: string; code: string; name: string; kind: TaxKind; rate: string; sales_base: string; sales_tax: string; purchases_base: string; purchases_tax: string }[];
      };
      room_statistics: { Args: { p_hotel_id: string; p_from: string; p_to: string }; Returns: { business_date: string; room_nights: string; room_revenue: string; rooms_available: number }[] };
      cash_flow_lines: { Args: { p_hotel_id: string; p_from: string; p_to: string }; Returns: { activity: "operating" | "investing" | "financing"; account_id: string; amount: string }[] };
      cash_balance: { Args: { p_hotel_id: string; p_as_of: string }; Returns: string };
      daily_cash_report: { Args: { p_hotel_id: string; p_date: string }; Returns: { payment_method_id: string; method_name: string; source: string; receipts: string; payments: string }[] };
      ledger_reconciliation: {
        Args: { p_hotel_id: string };
        Returns: { control: LedgerControl; gl_balance: string; subledger_balance: string; reconciling_items: string; difference: string }[];
      };
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
      my_limits: { Args: { p_hotel_id: string }; Returns: Json };
      my_interface: { Args: { p_hotel_id: string }; Returns: Json };
      decide_approval: { Args: { p_request_id: string; p_approve: boolean; p_note?: string | null }; Returns: string };
      finish_approval: { Args: { p_request_id: string; p_ok: boolean; p_result?: string | null; p_error?: string | null }; Returns: undefined };
      cancel_approval: { Args: { p_request_id: string }; Returns: undefined };
      member_access: { Args: { p_hotel_id: string; p_user_id: string }; Returns: Json };
      set_member_access: { Args: { p_hotel_id: string; p_user_id: string; p_role_ids: string[]; p_grants: string[]; p_denies: string[]; p_home_path: string | null; p_limits: Json; p_is_active: boolean }; Returns: undefined };
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
        Args: { p_hotel_id: string; p_fiscal_year_start: string; p_from: string; p_to: string; p_exclude_closing?: boolean };
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
      hr_leave_balances: {
        Args: { p_employee_id: string; p_year: number };
        Returns: { leave_type_id: string; name: string; paid: boolean; limited: boolean; entitlement: number; carried: number; taken: number; pending: number; remaining: number }[];
      };
      hr_payroll_preview: { Args: { p_hotel_id: string; p_month: string }; Returns: Json };
      hr_run_payroll: { Args: { p_hotel_id: string; p_month: string; p_posting_date?: string }; Returns: string };
      hr_pay_advance: {
        Args: { p_employee_id: string; p_date: string; p_amount: string; p_installments: number; p_payment_method_id: string; p_notes?: string | null };
        Returns: string;
      };
      hr_settlement_quote: { Args: { p_employee_id: string; p_date: string; p_reason: string }; Returns: Json };
      hr_terminate: { Args: { p_employee_id: string; p_date: string; p_reason: string; p_notes?: string | null }; Returns: string };
      hr_save_attendance: { Args: { p_hotel_id: string; p_date: string; p_rows: Json }; Returns: number };
      hr_save_roster: { Args: { p_hotel_id: string; p_rows: Json }; Returns: undefined };
      hr_save_employee_components: { Args: { p_employee_id: string; p_rows: Json }; Returns: undefined };
      create_maintenance_request: {
        Args: { p_hotel_id: string; p_title: string; p_description?: string | null; p_room_id?: string | null; p_asset_id?: string | null;
          p_location?: string | null; p_priority?: string; p_out_of_service?: boolean; p_due_date?: string | null };
        Returns: string;
      };
      update_maintenance_request: {
        Args: { p_request_id: string; p_status?: string | null; p_assignee?: string | null; p_priority?: string | null; p_resolution?: string | null; p_labor_cost?: string | null };
        Returns: undefined;
      };
      add_maintenance_part: { Args: { p_request_id: string; p_description: string; p_quantity: string; p_unit_cost?: string | null; p_item_id?: string | null }; Returns: string };
      register_lost_item: {
        Args: { p_hotel_id: string; p_description: string; p_found_date?: string | null; p_category?: string; p_room_id?: string | null;
          p_found_location?: string | null; p_found_by?: string | null; p_storage_location?: string | null; p_guest_id?: string | null };
        Returns: string;
      };
      close_lost_item: { Args: { p_item_id: string; p_action: string; p_returned_to?: string | null; p_id_number?: string | null; p_note?: string | null }; Returns: undefined };
      open_safe_deposit: { Args: { p_hotel_id: string; p_guest_name: string; p_box_number: string; p_items: string; p_reservation_id?: string | null }; Returns: string };
      return_safe_deposit: { Args: { p_deposit_id: string; p_note?: string | null }; Returns: undefined };
      create_laundry_order: {
        Args: { p_reservation_id: string; p_lines: Json; p_express?: boolean; p_express_pct?: string; p_promised_at?: string | null; p_notes?: string | null };
        Returns: string;
      };
      update_laundry_order: { Args: { p_order_id: string; p_status: string }; Returns: undefined };
      save_event: {
        Args: { p_hotel_id: string; p_event_id: string | null; p_title: string; p_event_type: string; p_contact_name: string; p_contact_phone: string | null;
          p_customer_id: string | null; p_hall_room_id: string | null; p_starts_at: string; p_ends_at: string; p_guests_count: number;
          p_discount: string; p_notes: string | null; p_terms: string | null; p_items: Json };
        Returns: string;
      };
      confirm_event: { Args: { p_event_id: string }; Returns: string };
      complete_event: { Args: { p_event_id: string }; Returns: undefined };
      cancel_event: { Args: { p_event_id: string; p_reason: string }; Returns: undefined };
      submit_guest_survey: {
        Args: { p_token: string; p_overall: number; p_cleanliness: number | null; p_staff: number | null; p_comfort: number | null; p_value: number | null;
          p_food: number | null; p_recommend: boolean | null; p_comment: string | null; p_channel?: string };
        Returns: undefined;
      };
      services_in_house: { Args: { p_hotel_id: string }; Returns: { reservation_id: string; room_number: string | null; guest_name: string }[] };
      create_staff_account: { Args: { p_hotel_id: string; p_full_name: string; p_username: string; p_password: string; p_role_ids: string[] }; Returns: string };
      reset_staff_password: { Args: { p_hotel_id: string; p_user_id: string; p_password: string }; Returns: undefined };
      end_staff_sessions: { Args: { p_hotel_id: string; p_user_id: string }; Returns: undefined };
      confirm_password_changed: { Args: Record<string, never>; Returns: undefined };
      add_staff_member: { Args: { p_hotel_id: string; p_full_name: string; p_role_ids: string[] }; Returns: Json };
      create_access_link: { Args: { p_hotel_id: string; p_user_id: string }; Returns: string };
      system_has_owner: { Args: Record<string, never>; Returns: boolean };
      claim_owner: { Args: Record<string, never>; Returns: Json };
      redeem_access_link: { Args: { p_token: string }; Returns: Json };
      survey_info: { Args: { p_token: string }; Returns: { hotel_name: string; hotel_name_en: string | null; guest_name: string; room_number: string | null; valid: boolean }[] };
      record_paper_survey: {
        Args: { p_hotel_id: string; p_guest_name: string | null; p_room_number: string | null; p_overall: number; p_cleanliness: number | null; p_staff: number | null;
          p_comfort: number | null; p_value: number | null; p_food: number | null; p_recommend: boolean | null; p_comment: string | null };
        Returns: string;
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
      pms_booking_mode: BookingMode;
      room_housekeeping_status: HousekeepingStatus;
      room_service_status: RoomServiceStatus;
      guest_id_type: GuestIdType;
      reservation_status: ReservationStatus;
      reservation_source: ReservationSource;
      reservation_pricing: ReservationPricing;
      waitlist_status: WaitlistStatus;
      series_status: SeriesStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
