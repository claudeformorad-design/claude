import fs from "fs";
import path from "path";

export type MockRow = Record<string, unknown>;

export interface MockStoreData {
  hotels: MockRow[];
  users_profiles: MockRow[];
  departments: MockRow[];
  currencies: MockRow[];
  roles: MockRow[];
  permissions: MockRow[];
  role_permissions: MockRow[];
  hotel_members: MockRow[];
  chart_of_accounts: MockRow[];
  tax_rates: MockRow[];
  payment_methods: MockRow[];
  charge_codes: MockRow[];
  charge_code_taxes: MockRow[];
  customers: MockRow[];
  guest_folios: MockRow[];
  folio_transactions: MockRow[];
  folio_balances: MockRow[];
  invoices: MockRow[];
  invoice_items: MockRow[];
  invoice_taxes: MockRow[];
  credit_notes: MockRow[];
  payments: MockRow[];
  payment_allocations: MockRow[];
  fiscal_years: MockRow[];
  accounting_periods: MockRow[];
  journal_entries: MockRow[];
  journal_entry_lines: MockRow[];
  vendors: MockRow[];
  vendor_bills: MockRow[];
  vendor_bill_lines: MockRow[];
  purchase_orders: MockRow[];
  payroll_runs: MockRow[];
  bank_statement_lines: MockRow[];
  inventory_items: MockRow[];
  inventory_movements: MockRow[];
  fixed_assets: MockRow[];
  audit_logs: MockRow[];
}

const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

export const DEMO_HOTEL_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000002";

export function createInitialStore(): MockStoreData {
  const hotel = {
    id: DEMO_HOTEL_ID,
    name_ar: "فندق الأفق الفاخر",
    name_en: "Horizon Luxury Hotel",
    legal_name: "شركة الأفق الفندقية ذ.م.م",
    tax_number: "300123456700003",
    commercial_registration: "1010123456",
    country_code: "SA",
    base_currency: "SAR",
    fiscal_year_start_month: 1,
    timezone: "Asia/Riyadh",
    default_locale: "ar",
    total_rooms: 120,
    address: "طريق الملك فهد، حي الصحافة، الرياض",
    phone: "+966 11 456 7890",
    email: "finance@horizonhotel.sa",
    logo_url: null,
    is_active: true,
    journal_approval_threshold: "50000",
    voucher_approval_threshold: "20000",
    created_at: NOW,
    created_by: DEMO_USER_ID,
    updated_at: NOW,
    updated_by: null,
  };

  const userProfile = {
    id: DEMO_USER_ID,
    full_name: "المدير المالي — عبد الرحمن العتيبي",
    email: "admin@hotel.com",
    phone: "+966500000001",
    preferred_locale: "ar",
    default_hotel_id: DEMO_HOTEL_ID,
    created_at: NOW,
    updated_at: NOW,
  };

  const departments = [
    { id: "dept_rooms", hotel_id: DEMO_HOTEL_ID, code: "ROOMS", name_ar: "قسم الغرف والإقامة", name_en: "Rooms Division", kind: "revenue_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_fnb", hotel_id: DEMO_HOTEL_ID, code: "FNB", name_ar: "الأغذية والمشروبات والمطاعم", name_en: "Food & Beverage", kind: "revenue_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_banquets", hotel_id: DEMO_HOTEL_ID, code: "BANQUET", name_ar: "الحفلات والمؤتمرات", name_en: "Banquets & Events", kind: "revenue_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_spa", hotel_id: DEMO_HOTEL_ID, code: "SPA", name_ar: "النادي الصحي والسبا", name_en: "Spa & Recreation", kind: "revenue_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_admin", hotel_id: DEMO_HOTEL_ID, code: "ADMIN", name_ar: "الإدارة والمصاريف العامة", name_en: "General & Administrative", kind: "cost_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_maint", hotel_id: DEMO_HOTEL_ID, code: "MAINT", name_ar: "الهندسة والصيانة والتشغيل", name_en: "Property Operations & Maintenance", kind: "service_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "dept_sales", hotel_id: DEMO_HOTEL_ID, code: "SALES", name_ar: "التسويق والمبيعات", name_en: "Sales & Marketing", kind: "cost_center", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const currencies = [
    { code: "SAR", name_ar: "ريال سعودي", name_en: "Saudi Riyal", symbol: "ر.س", decimals: 2, is_active: true },
    { code: "USD", name_ar: "دولار أمريكي", name_en: "US Dollar", symbol: "$", decimals: 2, is_active: true },
    { code: "EUR", name_ar: "يورو", name_en: "Euro", symbol: "€", decimals: 2, is_active: true },
    { code: "AED", name_ar: "درهم إماراتي", name_en: "UAE Dirham", symbol: "د.إ", decimals: 2, is_active: true },
  ];

  const roles = [
    { id: "role_gm", hotel_id: null, code: "general_manager", name_ar: "المدير العام", name_en: "General Manager", description: "كامل الصلاحيات للنظام", is_system: true, created_at: NOW },
    { id: "role_fc", hotel_id: null, code: "financial_controller", name_ar: "المراقب المالي", name_en: "Financial Controller", description: "إدارة الحسابات والتقارير", is_system: true, created_at: NOW },
    { id: "role_fd", hotel_id: null, code: "front_desk", name_ar: "مشرف الاستقبال", name_en: "Front Desk Supervisor", description: "إدارة الفوليو وحركات النزلاء", is_system: true, created_at: NOW },
  ];

  const permissions = [
    { code: "settings.hotel.manage", module: "settings", action: "manage", name_ar: "إدارة بيانات الفندق", name_en: "Manage hotel settings", sort_order: 10 },
    { code: "settings.users.manage", module: "settings", action: "manage", name_ar: "إدارة المستخدمين والأدوار", name_en: "Manage users and roles", sort_order: 20 },
    { code: "settings.departments.manage", module: "settings", action: "manage", name_ar: "إدارة الأقسام", name_en: "Manage departments", sort_order: 30 },
    { code: "coa.accounts.view", module: "coa", action: "view", name_ar: "عرض دليل الحسابات", name_en: "View chart of accounts", sort_order: 40 },
    { code: "coa.accounts.manage", module: "coa", action: "manage", name_ar: "إدارة دليل الحسابات", name_en: "Manage chart of accounts", sort_order: 50 },
    { code: "gl.journal.view", module: "gl", action: "view", name_ar: "عرض دفتر اليومية", name_en: "View journal entries", sort_order: 60 },
    { code: "gl.journal.create", module: "gl", action: "create", name_ar: "إنشاء قيود اليومية", name_en: "Create journal entries", sort_order: 70 },
    { code: "gl.journal.post", module: "gl", action: "post", name_ar: "ترحيل قيود اليومية", name_en: "Post journal entries", sort_order: 80 },
    { code: "gl.journal.reverse", module: "gl", action: "reverse", name_ar: "عكس قيود اليومية", name_en: "Reverse journal entries", sort_order: 90 },
    { code: "gl.periods.view", module: "gl", action: "view", name_ar: "عرض الفترات المحاسبية", name_en: "View periods", sort_order: 100 },
    { code: "gl.periods.manage", module: "gl", action: "manage", name_ar: "إدارة وإقفال الفترات", name_en: "Manage periods", sort_order: 110 },
    { code: "reports.trial_balance.view", module: "reports", action: "view", name_ar: "عرض ميزان المراجعة", name_en: "View trial balance", sort_order: 120 },
    { code: "reports.financial.view", module: "reports", action: "view", name_ar: "عرض القوائم المالية", name_en: "View financial reports", sort_order: 130 },
    { code: "reports.profitability.view", module: "reports", action: "view", name_ar: "عرض ربحية الأقسام", name_en: "View profitability", sort_order: 140 },
    { code: "folio.view", module: "folio", action: "view", name_ar: "عرض فوليو النزلاء", name_en: "View guest folios", sort_order: 150 },
    { code: "folio.manage", module: "folio", action: "manage", name_ar: "إدارة وحركات الفوليو", name_en: "Manage folios", sort_order: 160 },
    { code: "folio.allowance", module: "folio", action: "allowance", name_ar: "منح خصومات الفوليو", name_en: "Post allowance", sort_order: 170 },
    { code: "folio.void", module: "folio", action: "void", name_ar: "إلغاء حركات الفوليو", name_en: "Void folio txn", sort_order: 180 },
    { code: "folio.checkout", module: "folio", action: "checkout", name_ar: "تسوية ومغادرة النزيل", name_en: "Checkout folio", sort_order: 190 },
    { code: "invoices.view", module: "invoices", action: "view", name_ar: "عرض الفواتير الضريبية", name_en: "View invoices", sort_order: 200 },
    { code: "invoices.create", module: "invoices", action: "create", name_ar: "إصدار فواتير مباشرة", name_en: "Create invoices", sort_order: 210 },
    { code: "customers.view", module: "customers", action: "view", name_ar: "عرض عملاء الآجل", name_en: "View customers", sort_order: 220 },
    { code: "customers.manage", module: "customers", action: "manage", name_ar: "إدارة عملاء الآجل", name_en: "Manage customers", sort_order: 230 },
    { code: "payments.view", module: "payments", action: "view", name_ar: "عرض سندات القبض والصرف", name_en: "View vouchers", sort_order: 240 },
    { code: "payments.receipt", module: "payments", action: "receipt", name_ar: "إصدار سند قبض", name_en: "Issue receipt", sort_order: 250 },
    { code: "payments.disbursement", module: "payments", action: "disbursement", name_ar: "إصدار سند صرف", name_en: "Issue disbursement", sort_order: 260 },
    { code: "payments.void", module: "payments", action: "void", name_ar: "إلغاء السندات", name_en: "Void vouchers", sort_order: 270 },
    { code: "vendors.view", module: "vendors", action: "view", name_ar: "عرض الموردين", name_en: "View vendors", sort_order: 280 },
    { code: "vendors.manage", module: "vendors", action: "manage", name_ar: "إدارة الموردين", name_en: "Manage vendors", sort_order: 290 },
    { code: "bills.view", module: "bills", action: "view", name_ar: "عرض فواتير المشتريات", name_en: "View bills", sort_order: 300 },
    { code: "bills.create", module: "bills", action: "create", name_ar: "إنشاء فواتير المشتريات", name_en: "Create bills", sort_order: 310 },
    { code: "purchases.manage", module: "purchases", action: "manage", name_ar: "أوامر الشراء", name_en: "Manage POs", sort_order: 320 },
    { code: "payroll.manage", module: "payroll", action: "manage", name_ar: "مسيرات الرواتب", name_en: "Manage payroll", sort_order: 330 },
    { code: "bank.reconcile", module: "bank", action: "reconcile", name_ar: "التسوية البنكية", name_en: "Bank reconcile", sort_order: 340 },
    { code: "assets.view", module: "assets", action: "view", name_ar: "عرض الأصول الثابتة", name_en: "View fixed assets", sort_order: 350 },
    { code: "assets.manage", module: "assets", action: "manage", name_ar: "إدارة وإهلاك الأصول", name_en: "Manage assets", sort_order: 360 },
    { code: "inventory.view", module: "inventory", action: "view", name_ar: "عرض المخزون", name_en: "View inventory", sort_order: 370 },
    { code: "inventory.manage", module: "inventory", action: "manage", name_ar: "حركات المخزون", name_en: "Manage inventory", sort_order: 380 },
    { code: "reports.aging.view", module: "reports", action: "view", name_ar: "أعمار الذمم", name_en: "Aging report", sort_order: 390 },
    { code: "audit.logs.view", module: "audit", action: "view", name_ar: "سجل التدقيق", name_en: "Audit log", sort_order: 400 },
    { code: "settings.revenue.manage", module: "settings", action: "manage", name_ar: "إعدادات الإيرادات والضرائب", name_en: "Revenue settings", sort_order: 410 },
    { code: "invoices.credit_note", module: "invoices", action: "credit_note", name_ar: "إصدار إشعارات دائنة", name_en: "Credit notes", sort_order: 420 },
  ];

  const role_permissions = permissions.map((p) => ({
    role_id: "role_gm",
    permission_code: p.code,
  }));

  const hotel_members = [
    {
      hotel_id: DEMO_HOTEL_ID,
      user_id: DEMO_USER_ID,
      created_at: NOW,
    },
  ];

  // USALI Standard Chart of Accounts
  const chart_of_accounts = [
    // 1000 - Assets
    { id: "acc_1000", hotel_id: DEMO_HOTEL_ID, code: "1000", name_ar: "الأصول", name_en: "Assets", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: "إجمالي أصول الفندق", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1100", hotel_id: DEMO_HOTEL_ID, code: "1100", name_ar: "الأصول المتداولة", name_en: "Current Assets", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1000", level: 2, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1110", hotel_id: DEMO_HOTEL_ID, code: "1110", name_ar: "نقدية بالصندوق والخزينة الرئيسية", name_en: "Cash on Hand & Front Desk Floats", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "cash", is_active: true, description: "الصندوق الرئيسي وخزائن الاستقبال", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1120", hotel_id: DEMO_HOTEL_ID, code: "1120", name_ar: "البنك الأهلي السعودي — الحساب الجاري", name_en: "SNB Bank — Operating Account", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "bank", is_active: true, description: "الحساب البنكي الرئيسي للعمليات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1125", hotel_id: DEMO_HOTEL_ID, code: "1125", name_ar: "مصرف الراجحي — حساب المدفوعات", name_en: "Al Rajhi Bank — Payroll Account", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: "حساب الرواتب والعمليات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1130", hotel_id: DEMO_HOTEL_ID, code: "1130", name_ar: "ذمم نزلاء الفندق (دفتر النزلاء)", name_en: "Guest Ledger Control", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: "guest_ledger", is_active: true, description: "حساب المراقبة للنزلاء المقيمين", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1140", hotel_id: DEMO_HOTEL_ID, code: "1140", name_ar: "ذمم الشركات والمدينون (الدفتر العام)", name_en: "City Ledger (Accounts Receivable)", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "ar_control", is_active: true, description: "حساب مراقبة العملاء والشركات الآجلة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1150", hotel_id: DEMO_HOTEL_ID, code: "1150", name_ar: "مخزون الأغذية والمشروبات", name_en: "Food & Beverage Inventory", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: "dept_fnb", currency_code: "SAR", system_key: null, is_active: true, description: "المستودع الرئيسي للأغذية والمشروبات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1160", hotel_id: DEMO_HOTEL_ID, code: "1160", name_ar: "مخزون البياضات ومستلزمات الغرف", name_en: "Linen & Operating Supplies Inventory", account_type: "asset", account_subtype: "current_asset", normal_balance: "debit", parent_id: "acc_1100", level: 3, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: null, is_active: true, description: "مستودع المستلزمات والضيافة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    { id: "acc_1200", hotel_id: DEMO_HOTEL_ID, code: "1200", name_ar: "الأصول الثابتة والممتلكات", name_en: "Property, Plant & Equipment", account_type: "asset", account_subtype: "fixed_asset", normal_balance: "debit", parent_id: "acc_1000", level: 2, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1210", hotel_id: DEMO_HOTEL_ID, code: "1210", name_ar: "مبنى الفندق والتحسينات الإنشائية", name_en: "Hotel Building & Leasehold Improvements", account_type: "asset", account_subtype: "fixed_asset", normal_balance: "debit", parent_id: "acc_1200", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1220", hotel_id: DEMO_HOTEL_ID, code: "1220", name_ar: "الأثاث والمفروشات والتجهيزات (FF&E)", name_en: "Furniture, Fixtures & Equipment", account_type: "asset", account_subtype: "fixed_asset", normal_balance: "debit", parent_id: "acc_1200", level: 3, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1230", hotel_id: DEMO_HOTEL_ID, code: "1230", name_ar: "معدات المطابخ والمطاعم", name_en: "Kitchen & Restaurant Equipment", account_type: "asset", account_subtype: "fixed_asset", normal_balance: "debit", parent_id: "acc_1200", level: 3, is_postable: true, department_id: "dept_fnb", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_1290", hotel_id: DEMO_HOTEL_ID, code: "1290", name_ar: "مجمع الإهلاك المتراكم للأصول", name_en: "Accumulated Depreciation", account_type: "asset", account_subtype: "fixed_asset", normal_balance: "credit", parent_id: "acc_1200", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "accumulated_depreciation", is_active: true, description: "حساب مقابل للأصول الثابتة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    // 2000 - Liabilities
    { id: "acc_2000", hotel_id: DEMO_HOTEL_ID, code: "2000", name_ar: "الالتزامات", name_en: "Liabilities", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2100", hotel_id: DEMO_HOTEL_ID, code: "2100", name_ar: "الالتزامات المتداولة", name_en: "Current Liabilities", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2000", level: 2, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2110", hotel_id: DEMO_HOTEL_ID, code: "2110", name_ar: "ذمم الموردين والدائنون", name_en: "Accounts Payable Control", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "ap_control", is_active: true, description: "مراقبة فواتير الموردين والمشتريات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2120", hotel_id: DEMO_HOTEL_ID, code: "2120", name_ar: "عربونات وأمانات النزلاء المقدمة", name_en: "Guest Advance Deposits", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2100", level: 3, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: "guest_deposits", is_active: true, description: "عرابين الحجوزات المستقبلية غير المستهلكة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2130", hotel_id: DEMO_HOTEL_ID, code: "2130", name_ar: "ضريبة القيمة المضافة المستحقة (15%)", name_en: "VAT Output Tax Payable", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "tax_payable", is_active: true, description: "ضريبة المبيعات المحصلة لصالح الهيئة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2140", hotel_id: DEMO_HOTEL_ID, code: "2140", name_ar: "رسوم البلدية للإيواء الفندقي (5%)", name_en: "Municipality Lodging Tax Payable", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: "رسوم البلدية المحصلة على الإقامة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_2150", hotel_id: DEMO_HOTEL_ID, code: "2150", name_ar: "رواتب ومستحقات الموظفين المستحقة", name_en: "Accrued Payroll & Staff Clearing", account_type: "liability", account_subtype: "current_liability", normal_balance: "credit", parent_id: "acc_2100", level: 3, is_postable: true, department_id: null, currency_code: "SAR", system_key: "payroll_clearing", is_active: true, description: "حساب وسيط لمسير الرواتب", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    // 3000 - Equity
    { id: "acc_3000", hotel_id: DEMO_HOTEL_ID, code: "3000", name_ar: "حقوق الملكية", name_en: "Equity", account_type: "equity", account_subtype: "equity", normal_balance: "credit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_3100", hotel_id: DEMO_HOTEL_ID, code: "3100", name_ar: "رأس المال المدفوع", name_en: "Paid-in Capital", account_type: "equity", account_subtype: "equity", normal_balance: "credit", parent_id: "acc_3000", level: 2, is_postable: true, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: "رأس مال المشروع الفندقي", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_3200", hotel_id: DEMO_HOTEL_ID, code: "3200", name_ar: "الأرباح المبقاة والمحتجزة", name_en: "Retained Earnings", account_type: "equity", account_subtype: "equity", normal_balance: "credit", parent_id: "acc_3000", level: 2, is_postable: true, department_id: null, currency_code: "SAR", system_key: "retained_earnings", is_active: true, description: "أرباح الفترات السابقة المقفلة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    // 4000 - Revenue
    { id: "acc_4000", hotel_id: DEMO_HOTEL_ID, code: "4000", name_ar: "الإيرادات التشغيلية", name_en: "Operating Revenues", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: "إجمالي إيرادات أقسام الفندق", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4100", hotel_id: DEMO_HOTEL_ID, code: "4100", name_ar: "إيرادات الغرف والإقامة", name_en: "Rooms Revenue", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: "room_revenue", is_active: true, description: "إيرادات المبيت اليومي للأجنحة والغرف", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4200", hotel_id: DEMO_HOTEL_ID, code: "4200", name_ar: "إيرادات الأغذية والمشروبات والمطاعم", name_en: "Food & Beverage Revenue", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: "dept_fnb", currency_code: "SAR", system_key: null, is_active: true, description: "مبيعات البوفيه وقوائم الطعام والمشروبات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4300", hotel_id: DEMO_HOTEL_ID, code: "4300", name_ar: "إيرادات قاعات الحفلات والمؤتمرات", name_en: "Banquets & Meeting Rooms Revenue", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: "dept_banquets", currency_code: "SAR", system_key: null, is_active: true, description: "تأجير القاعات والضيافة المصاحبة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4400", hotel_id: DEMO_HOTEL_ID, code: "4400", name_ar: "إيرادات النادي الصحي والسبا", name_en: "Spa & Recreation Revenue", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: "dept_spa", currency_code: "SAR", system_key: null, is_active: true, description: "جلسات المساج والعناية ومبيعات السبا", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4500", hotel_id: DEMO_HOTEL_ID, code: "4500", name_ar: "إيرادات خدمات الغسيل والكي للنزلاء", name_en: "Guest Laundry Revenue", account_type: "revenue", account_subtype: "operating_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_4900", hotel_id: DEMO_HOTEL_ID, code: "4900", name_ar: "إيرادات تشغيلية أخرى ونقل المطار", name_en: "Other Operating Revenue", account_type: "revenue", account_subtype: "other_revenue", normal_balance: "credit", parent_id: "acc_4000", level: 2, is_postable: true, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    // 5000 - Cost of Sales
    { id: "acc_5000", hotel_id: DEMO_HOTEL_ID, code: "5000", name_ar: "تكلفة المبيعات المباشرة", name_en: "Cost of Sales", account_type: "expense", account_subtype: "cost_of_sales", normal_balance: "debit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_5100", hotel_id: DEMO_HOTEL_ID, code: "5100", name_ar: "تكلفة الأغذية والمشروبات المستهلكة", name_en: "Food & Beverage Cost of Goods Sold", account_type: "expense", account_subtype: "cost_of_sales", normal_balance: "debit", parent_id: "acc_5000", level: 2, is_postable: true, department_id: "dept_fnb", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_5200", hotel_id: DEMO_HOTEL_ID, code: "5200", name_ar: "تكلفة لوازم ومأكولات الحفلات والمؤتمرات", name_en: "Banquet Direct Cost", account_type: "expense", account_subtype: "cost_of_sales", normal_balance: "debit", parent_id: "acc_5000", level: 2, is_postable: true, department_id: "dept_banquets", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_5300", hotel_id: DEMO_HOTEL_ID, code: "5300", name_ar: "تكلفة مستحضرات ومنتجات السبا", name_en: "Spa Products Cost of Sales", account_type: "expense", account_subtype: "cost_of_sales", normal_balance: "debit", parent_id: "acc_5000", level: 2, is_postable: true, department_id: "dept_spa", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },

    // 6000 - Operating Expenses
    { id: "acc_6000", hotel_id: DEMO_HOTEL_ID, code: "6000", name_ar: "المصروفات التشغيلية والعمومية", name_en: "Operating Expenses", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: null, level: 1, is_postable: false, department_id: null, currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6100", hotel_id: DEMO_HOTEL_ID, code: "6100", name_ar: "رواتب ومكافآت موظفي الفندق", name_en: "Salaries, Wages & Benefits", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_admin", currency_code: "SAR", system_key: "payroll_expense", is_active: true, description: "مصروف مسيرات الرواتب لكافة الأقسام", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6200", hotel_id: DEMO_HOTEL_ID, code: "6200", name_ar: "مستلزمات الغرف والضيافة الفندقية", name_en: "Guest Room Supplies & Amenities", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: null, is_active: true, description: "شامبوهات، صابون، أطقم قهوة وضيافة", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6300", hotel_id: DEMO_HOTEL_ID, code: "6300", name_ar: "مصروفات غسيل البياضات والمفارش", name_en: "Linen & Laundry Operational Cost", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_rooms", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6400", hotel_id: DEMO_HOTEL_ID, code: "6400", name_ar: "المنافع العامة (كهرباء، مياه، تكييف)", name_en: "Utilities (Electricity, Water, Gas)", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_maint", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6500", hotel_id: DEMO_HOTEL_ID, code: "6500", name_ar: "صيانة الفندق وتشغيل المرافق", name_en: "Property Maintenance & Repairs", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_maint", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6600", hotel_id: DEMO_HOTEL_ID, code: "6600", name_ar: "التسويق وعمولات منصات الحجز الإلكتروني", name_en: "Marketing & OTA Booking Commissions", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_sales", currency_code: "SAR", system_key: null, is_active: true, description: "عمولات بوكينج، إكسبيديا، والحملات", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6700", hotel_id: DEMO_HOTEL_ID, code: "6700", name_ar: "تقنية المعلومات وأنظمة إدارة الفندق", name_en: "IT & PMS System Subscriptions", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: "dept_admin", currency_code: "SAR", system_key: null, is_active: true, description: null, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "acc_6800", hotel_id: DEMO_HOTEL_ID, code: "6800", name_ar: "مصروف إهلاك الأصول الثابتة", name_en: "Depreciation Expense", account_type: "expense", account_subtype: "operating_expense", normal_balance: "debit", parent_id: "acc_6000", level: 2, is_postable: true, department_id: null, currency_code: "SAR", system_key: "depreciation_expense", is_active: true, description: "قسط الإهلاك الشهري التلقائي", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const tax_rates = [
    { id: "tax_vat", hotel_id: DEMO_HOTEL_ID, code: "VAT15", name_ar: "ضريبة القيمة المضافة (15%)", name_en: "Value Added Tax (15%)", kind: "vat", rate: "15.0000", is_compound: false, account_id: "acc_2130", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "tax_city", hotel_id: DEMO_HOTEL_ID, code: "MUN5", name_ar: "رسوم البلدية للإيواء الفندقي (5%)", name_en: "Municipality Accommodation Fee (5%)", kind: "city_tax", rate: "5.0000", is_compound: false, account_id: "acc_2140", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const payment_methods = [
    { id: "pm_cash", hotel_id: DEMO_HOTEL_ID, code: "CASH", name_ar: "نقدي بالصندوق", name_en: "Cash", kind: "cash", account_id: "acc_1110", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "pm_card", hotel_id: DEMO_HOTEL_ID, code: "MADA_VISA", name_ar: "مدى / بطاقات ائتمانية", name_en: "Mada / Credit Cards", kind: "card", account_id: "acc_1120", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "pm_bank", hotel_id: DEMO_HOTEL_ID, code: "WIRE", name_ar: "تحويل بنكي مباشر", name_en: "Bank Wire Transfer", kind: "bank", account_id: "acc_1120", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "pm_city", hotel_id: DEMO_HOTEL_ID, code: "CITY", name_ar: "حساب آجل (ذمم شركات)", name_en: "City Ledger (Direct Billing)", kind: "city_ledger", account_id: "acc_1140", is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const charge_codes = [
    { id: "cc_room_std", hotel_id: DEMO_HOTEL_ID, code: "ROOM_STD", name_ar: "إقامة غرفة قياسية (ليلة واحدة)", name_en: "Standard Room Night", category: "room", department_id: "dept_rooms", revenue_account_id: "acc_4100", default_price: "450.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cc_room_dlx", hotel_id: DEMO_HOTEL_ID, code: "ROOM_DLX", name_ar: "إقامة جناح تنفيذي فاخر (ليلة واحدة)", name_en: "Executive Deluxe Suite", category: "room", department_id: "dept_rooms", revenue_account_id: "acc_4100", default_price: "850.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cc_fnb_buffet", hotel_id: DEMO_HOTEL_ID, code: "FNB_BUFFET", name_ar: "بوفيه إفطار مفتوح — مطعم الأفق", name_en: "Horizon Open Breakfast Buffet", category: "fnb", department_id: "dept_fnb", revenue_account_id: "acc_4200", default_price: "95.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cc_fnb_dinner", hotel_id: DEMO_HOTEL_ID, code: "FNB_DINNER", name_ar: "عشاء خدمة الغرف والمطعم", name_en: "Room Service Dining", category: "fnb", department_id: "dept_fnb", revenue_account_id: "acc_4200", default_price: "160.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cc_laundry", hotel_id: DEMO_HOTEL_ID, code: "LAUNDRY", name_ar: "خدمة غسيل وكي ملابس النزيل", name_en: "Guest Laundry & Dry Clean", category: "other", department_id: "dept_rooms", revenue_account_id: "acc_4500", default_price: "60.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cc_spa", hotel_id: DEMO_HOTEL_ID, code: "SPA_TREAT", name_ar: "جلسة مساج وعناية ملكية (60 دقيقة)", name_en: "Royal Spa Treatment (60m)", category: "other", department_id: "dept_spa", revenue_account_id: "acc_4400", default_price: "320.00", price_includes_tax: false, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const charge_code_taxes = [
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_room_std", tax_rate_id: "tax_vat" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_room_std", tax_rate_id: "tax_city" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_room_dlx", tax_rate_id: "tax_vat" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_room_dlx", tax_rate_id: "tax_city" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_fnb_buffet", tax_rate_id: "tax_vat" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_fnb_dinner", tax_rate_id: "tax_vat" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_laundry", tax_rate_id: "tax_vat" },
    { hotel_id: DEMO_HOTEL_ID, charge_code_id: "cc_spa", tax_rate_id: "tax_vat" },
  ];

  const customers = [
    { id: "cust_aramco", hotel_id: DEMO_HOTEL_ID, code: "CUST-001", name_ar: "شركة أرامكو السعودية", name_en: "Saudi Aramco", customer_type: "company", tax_number: "300000000000003", commercial_registration: "1010000001", email: "corporate.travel@aramco.com", phone: "+966 13 874 0111", address: "الظهران، المنطقة الشرقية", allow_credit: true, credit_limit: "250000.00", payment_terms_days: 30, notes: "اتفاقية أسعار الشركات المعتمدة 2026", is_active: true, open_invoices: "34500.00", unapplied_credit: "0.00", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cust_sabic", hotel_id: DEMO_HOTEL_ID, code: "CUST-002", name_ar: "الشركة السعودية للصناعات الأساسية (سابك)", name_en: "SABIC", customer_type: "company", tax_number: "300000000000002", commercial_registration: "1010000002", email: "hotels@sabic.com", phone: "+966 11 225 8000", address: "طريق المطار، الرياض", allow_credit: true, credit_limit: "180000.00", payment_terms_days: 30, notes: "حجوزات دورات وورش عمل الإدارة", is_active: true, open_invoices: "18200.00", unapplied_credit: "0.00", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "cust_almosafer", hotel_id: DEMO_HOTEL_ID, code: "CUST-003", name_ar: "شركة المسافر للسياحة والسفر", name_en: "Almosafer Travel & Tourism", customer_type: "travel_agent", tax_number: "310000000000003", commercial_registration: "1010000003", email: "finance@almosafer.com", phone: "+966 920000997", address: "حي العليا، الرياض", allow_credit: true, credit_limit: "100000.00", payment_terms_days: 15, notes: "وكالة سفر شريكة بنظام الفوترة الدورية", is_active: true, open_invoices: "8500.00", unapplied_credit: "1200.00", created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const fiscal_years = [
    { id: "fy_2026", hotel_id: DEMO_HOTEL_ID, name: "2026", start_date: "2026-01-01", end_date: "2026-12-31", status: "open", created_at: NOW, created_by: DEMO_USER_ID, closed_at: null, closed_by: null },
  ];

  const accounting_periods = [
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
  ].map((m, idx) => {
    const isPast = idx < 8; // Jan-Aug closed, Sep (09) open
    return {
      id: `period_2026_${m}`,
      hotel_id: DEMO_HOTEL_ID,
      fiscal_year_id: "fy_2026",
      period_number: idx + 1,
      name: `2026-${m}`,
      start_date: `2026-${m}-01`,
      end_date: `2026-${m}-${[1, 3, 5, 7, 8, 10, 12].includes(idx + 1) ? "31" : idx === 1 ? "28" : "30"}`,
      status: isPast ? "closed" : "open",
      created_at: NOW,
      created_by: DEMO_USER_ID,
      closed_at: isPast ? NOW : null,
      closed_by: isPast ? DEMO_USER_ID : null,
    };
  });

  const guest_folios = [
    {
      id: "fol_01",
      hotel_id: DEMO_HOTEL_ID,
      folio_number: "FOL-2026-001",
      guest_name: "د. مشعل بن عبد العزيز الراشد",
      room_number: "405",
      folio_type: "guest",
      status: "open",
      arrival_date: "2026-09-24",
      departure_date: "2026-09-28",
      reservation_ref: "RES-98124",
      customer_id: null,
      adults: 2,
      master_folio_id: null,
      notes: "نزيل VIP — يفضل طابق علوي",
      created_at: "2026-09-24T14:00:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
      closed_at: null,
      closed_by: null,
    },
    {
      id: "fol_02",
      hotel_id: DEMO_HOTEL_ID,
      folio_number: "FOL-2026-002",
      guest_name: "م. ريم عبد الله الشمري",
      room_number: "502",
      folio_type: "guest",
      status: "open",
      arrival_date: "2026-09-25",
      departure_date: "2026-09-30",
      reservation_ref: "RES-98135",
      customer_id: "cust_sabic",
      adults: 1,
      master_folio_id: null,
      notes: "حساب الإقامة محول لشركة سابك، المصاريف الشخصية على النزيل",
      created_at: "2026-09-25T15:30:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
      closed_at: null,
      closed_by: null,
    },
    {
      id: "fol_03",
      hotel_id: DEMO_HOTEL_ID,
      folio_number: "FOL-2026-003",
      guest_name: "السيد كريستوفر إيفانز",
      room_number: "301",
      folio_type: "guest",
      status: "closed",
      arrival_date: "2026-09-20",
      departure_date: "2026-09-23",
      reservation_ref: "RES-98099",
      customer_id: null,
      adults: 1,
      master_folio_id: null,
      notes: "تمت المغادرة وتسوية الحساب بالكامل بالبطاقة الائتمانية",
      created_at: "2026-09-20T12:00:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
      closed_at: "2026-09-23T11:00:00Z",
      closed_by: DEMO_USER_ID,
    },
  ];

  const folio_balances = [
    { folio_id: "fol_01", balance: "1850.00", deposit_balance: "500.00" },
    { folio_id: "fol_02", balance: "2460.00", deposit_balance: "1000.00" },
    { folio_id: "fol_03", balance: "0.00", deposit_balance: "0.00" },
  ];

  const folio_transactions = [
    {
      id: "ftxn_01",
      hotel_id: DEMO_HOTEL_ID,
      folio_id: "fol_01",
      txn_type: "deposit",
      direction: 1,
      business_date: "2026-09-24",
      charge_code_id: null,
      payment_method_id: "pm_card",
      department_id: null,
      customer_id: null,
      description: "عربون تأكيد حجز مسبق عبر بطاقة مدى",
      reference: "DEP-44910",
      quantity: "1",
      unit_price: "500.00",
      net_amount: "500.00",
      tax_amount: "0.00",
      total_amount: "500.00",
      ledger_effect: "0.00",
      deposit_effect: "500.00",
      related_transaction_id: null,
      counter_folio_id: null,
      voided_by_id: null,
      journal_entry_id: "jv_002",
      created_at: "2026-09-24T14:10:00Z",
      created_by: DEMO_USER_ID,
    },
    {
      id: "ftxn_02",
      hotel_id: DEMO_HOTEL_ID,
      folio_id: "fol_01",
      txn_type: "charge",
      direction: 1,
      business_date: "2026-09-24",
      charge_code_id: "cc_room_dlx",
      payment_method_id: null,
      department_id: "dept_rooms",
      customer_id: null,
      description: "إقامة ليلة واحدة — جناح تنفيذي فاخر",
      reference: "NIGHT-24",
      quantity: "1",
      unit_price: "850.00",
      net_amount: "850.00",
      tax_amount: "170.00",
      total_amount: "1020.00",
      ledger_effect: "1020.00",
      deposit_effect: "0.00",
      related_transaction_id: null,
      counter_folio_id: null,
      voided_by_id: null,
      journal_entry_id: "jv_002",
      created_at: "2026-09-24T23:59:00Z",
      created_by: DEMO_USER_ID,
    },
    {
      id: "ftxn_03",
      hotel_id: DEMO_HOTEL_ID,
      folio_id: "fol_01",
      txn_type: "charge",
      direction: 1,
      business_date: "2026-09-25",
      charge_code_id: "cc_fnb_dinner",
      payment_method_id: null,
      department_id: "dept_fnb",
      customer_id: null,
      description: "عشاء خدمة الغرف — طلب #4421",
      reference: "CHK-4421",
      quantity: "1",
      unit_price: "160.00",
      net_amount: "160.00",
      tax_amount: "24.00",
      total_amount: "184.00",
      ledger_effect: "184.00",
      deposit_effect: "0.00",
      related_transaction_id: null,
      counter_folio_id: null,
      voided_by_id: null,
      journal_entry_id: null,
      created_at: "2026-09-25T21:15:00Z",
      created_by: DEMO_USER_ID,
    },
    {
      id: "ftxn_04",
      hotel_id: DEMO_HOTEL_ID,
      folio_id: "fol_02",
      txn_type: "charge",
      direction: 1,
      business_date: "2026-09-25",
      charge_code_id: "cc_room_dlx",
      payment_method_id: null,
      department_id: "dept_rooms",
      customer_id: "cust_sabic",
      description: "إقامة ليلة — جناح تنفيذي 502",
      reference: "NIGHT-25",
      quantity: "1",
      unit_price: "850.00",
      net_amount: "850.00",
      tax_amount: "170.00",
      total_amount: "1020.00",
      ledger_effect: "1020.00",
      deposit_effect: "0.00",
      related_transaction_id: null,
      counter_folio_id: null,
      voided_by_id: null,
      journal_entry_id: null,
      created_at: "2026-09-25T23:59:00Z",
      created_by: DEMO_USER_ID,
    },
  ];

  const invoices = [
    {
      id: "inv_01",
      hotel_id: DEMO_HOTEL_ID,
      invoice_number: "INV-2026-001",
      invoice_type: "tax_invoice",
      folio_id: null,
      customer_id: "cust_aramco",
      bill_to_name: "شركة أرامكو السعودية",
      bill_to_tax_number: "300000000000003",
      bill_to_address: "الظهران، المنطقة الشرقية",
      issue_date: "2026-09-20",
      due_date: "2026-10-20",
      currency_code: "SAR",
      subtotal: "30000.00",
      tax_total: "4500.00",
      total: "34500.00",
      amount_due: "34500.00",
      amount_paid: "0.00",
      status: "issued",
      journal_entry_id: "jv_003",
      notes: "فاتورة شهرية لإقامة واستضافة وفد مهندسي أرامكو",
      created_at: "2026-09-20T10:00:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
    },
    {
      id: "inv_02",
      hotel_id: DEMO_HOTEL_ID,
      invoice_number: "INV-2026-002",
      invoice_type: "tax_invoice",
      folio_id: null,
      customer_id: "cust_sabic",
      bill_to_name: "الشركة السعودية للصناعات الأساسية (سابك)",
      bill_to_tax_number: "300000000000002",
      bill_to_address: "طريق المطار، الرياض",
      issue_date: "2026-09-22",
      due_date: "2026-10-22",
      currency_code: "SAR",
      subtotal: "15826.09",
      tax_total: "2373.91",
      total: "18200.00",
      amount_due: "18200.00",
      amount_paid: "0.00",
      status: "issued",
      journal_entry_id: "jv_003",
      notes: "حجز قاعات مؤتمرات وضيافة ورشة عمل الاستدامة",
      created_at: "2026-09-22T14:30:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
    },
  ];

  const invoice_items = [
    {
      id: "ii_01",
      invoice_id: "inv_01",
      hotel_id: DEMO_HOTEL_ID,
      line_no: 1,
      charge_code_id: "cc_room_dlx",
      department_id: "dept_rooms",
      business_date: "2026-09-20",
      description: "إقامة أجنحة تنفيذية (حجز جماعي 35 ليلة)",
      quantity: "35",
      unit_price: "857.14",
      net_amount: "30000.00",
      tax_amount: "4500.00",
      total_amount: "34500.00",
      source_transaction_id: null,
    },
  ];

  const invoice_taxes = [
    {
      invoice_id: "inv_01",
      hotel_id: DEMO_HOTEL_ID,
      tax_rate_id: "tax_vat",
      taxable_base: "30000.00",
      amount: "4500.00",
    },
  ];

  const journal_entries = [
    {
      id: "jv_001",
      hotel_id: DEMO_HOTEL_ID,
      entry_number: "JV-2026-0001",
      entry_date: "2026-01-01",
      period_id: "period_2026_01",
      description: "قيد الأرصدة الافتتاحية للسنة المالية 2026",
      reference: "OPEN-2026",
      source: "opening",
      source_id: null,
      currency_code: "SAR",
      exchange_rate: "1.0000",
      status: "posted",
      posted_at: "2026-01-01T00:01:00Z",
      posted_by: DEMO_USER_ID,
      reversal_of_id: null,
      reversed_by_id: null,
      created_at: "2026-01-01T00:00:00Z",
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
    {
      id: "jv_002",
      hotel_id: DEMO_HOTEL_ID,
      entry_number: "JV-2026-0002",
      entry_date: TODAY,
      period_id: "period_2026_09",
      description: "ترحيل إيرادات التدقيق الليلي والنزلاء اليومية",
      reference: "NA-AUDIT",
      source: "folio",
      source_id: null,
      currency_code: "SAR",
      exchange_rate: "1.0000",
      status: "posted",
      posted_at: NOW,
      posted_by: DEMO_USER_ID,
      reversal_of_id: null,
      reversed_by_id: null,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
    {
      id: "jv_003",
      hotel_id: DEMO_HOTEL_ID,
      entry_number: "JV-2026-0003",
      entry_date: TODAY,
      period_id: "period_2026_09",
      description: "قيد تسوية فواتير الشركات والجهات المدينة (آرامكو وسابك)",
      reference: "AR-CORP",
      source: "invoice",
      source_id: null,
      currency_code: "SAR",
      exchange_rate: "1.0000",
      status: "posted",
      posted_at: NOW,
      posted_by: DEMO_USER_ID,
      reversal_of_id: null,
      reversed_by_id: null,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
    {
      id: "jv_draft",
      hotel_id: DEMO_HOTEL_ID,
      entry_number: null,
      entry_date: TODAY,
      period_id: "period_2026_09",
      description: "قيد تسوية جرد مستلزمات الغرف والضيافة الشهرية",
      reference: "STK-ADJ",
      source: "manual",
      source_id: null,
      currency_code: "SAR",
      exchange_rate: "1.0000",
      status: "draft",
      posted_at: null,
      posted_by: null,
      reversal_of_id: null,
      reversed_by_id: null,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
  ];

  const journal_entry_lines = [
    // JV 001 - Opening
    { id: "jl_01", journal_entry_id: "jv_001", hotel_id: DEMO_HOTEL_ID, line_no: 1, account_id: "acc_1120", department_id: null, description: "رصيد البنك الافتتاحي", debit: "1250000.00", credit: "0.00", base_debit: "1250000.00", base_credit: "0.00", created_at: NOW },
    { id: "jl_02", journal_entry_id: "jv_001", hotel_id: DEMO_HOTEL_ID, line_no: 2, account_id: "acc_1210", department_id: null, description: "مبنى الفندق والتحسينات", debit: "8500000.00", credit: "0.00", base_debit: "8500000.00", base_credit: "0.00", created_at: NOW },
    { id: "jl_03", journal_entry_id: "jv_001", hotel_id: DEMO_HOTEL_ID, line_no: 3, account_id: "acc_3100", department_id: null, description: "رأس المال المدفوع", debit: "0.00", credit: "9000000.00", base_debit: "0.00", base_credit: "9000000.00", created_at: NOW },
    { id: "jl_04", journal_entry_id: "jv_001", hotel_id: DEMO_HOTEL_ID, line_no: 4, account_id: "acc_3200", department_id: null, description: "الأرباح المبقاة المدورة", debit: "0.00", credit: "750000.00", base_debit: "0.00", base_credit: "750000.00", created_at: NOW },

    // JV 002 - Night audit
    { id: "jl_05", journal_entry_id: "jv_002", hotel_id: DEMO_HOTEL_ID, line_no: 1, account_id: "acc_1130", department_id: "dept_rooms", description: "إجمالي إيراد الغرف والضرائب بدفتر النزلاء", debit: "18500.00", credit: "0.00", base_debit: "18500.00", base_credit: "0.00", created_at: NOW },
    { id: "jl_06", journal_entry_id: "jv_002", hotel_id: DEMO_HOTEL_ID, line_no: 2, account_id: "acc_4100", department_id: "dept_rooms", description: "إيراد الغرف الصافي", debit: "0.00", credit: "15416.67", base_debit: "0.00", base_credit: "15416.67", created_at: NOW },
    { id: "jl_07", journal_entry_id: "jv_002", hotel_id: DEMO_HOTEL_ID, line_no: 3, account_id: "acc_2130", department_id: null, description: "ضريبة القيمة المضافة 15%", debit: "0.00", credit: "2312.50", base_debit: "0.00", base_credit: "2312.50", created_at: NOW },
    { id: "jl_08", journal_entry_id: "jv_002", hotel_id: DEMO_HOTEL_ID, line_no: 4, account_id: "acc_2140", department_id: null, description: "رسوم البلدية للإيواء 5%", debit: "0.00", credit: "770.83", base_debit: "0.00", base_credit: "770.83", created_at: NOW },

    // JV draft
    { id: "jl_09", journal_entry_id: "jv_draft", hotel_id: DEMO_HOTEL_ID, line_no: 1, account_id: "acc_6200", department_id: "dept_rooms", description: "مصروف مستلزمات النزلاء المستهلكة", debit: "4500.00", credit: "0.00", base_debit: "4500.00", base_credit: "0.00", created_at: NOW },
    { id: "jl_10", journal_entry_id: "jv_draft", hotel_id: DEMO_HOTEL_ID, line_no: 2, account_id: "acc_1160", department_id: "dept_rooms", description: "صرف من مخزون مستلزمات الغرف", debit: "0.00", credit: "4500.00", base_debit: "0.00", base_credit: "4500.00", created_at: NOW },
  ];

  const vendors = [
    { id: "vnd_food", hotel_id: DEMO_HOTEL_ID, code: "VND-001", name_ar: "شركة الأغذية والمؤن العالمية", name_en: "Global Food & Beverage Supplies", tax_number: "300888888800003", phone: "+966 11 234 5678", email: "orders@globalfood.sa", address: "سوق العزيزية المركزي، الرياض", payment_terms_days: 30, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "vnd_linen", hotel_id: DEMO_HOTEL_ID, code: "VND-002", name_ar: "مؤسسة النقاء للبياضات ومستلزمات الفنادق", name_en: "Al-Naqa Hotel Linens & Amenities", tax_number: "300777777700003", phone: "+966 12 654 3210", email: "sales@naqa-hotel.com", address: "المنطقة الصناعية، جدة", payment_terms_days: 45, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
    { id: "vnd_maint", hotel_id: DEMO_HOTEL_ID, code: "VND-003", name_ar: "شركة أمان لصيانة المصاعد والتكييف المركزي", name_en: "Aman HVAC & Elevator Maintenance", tax_number: "300666666600003", phone: "+966 11 987 6543", email: "service@aman-tech.sa", address: "طريق الدائري الشمالي، الرياض", payment_terms_days: 30, is_active: true, created_at: NOW, created_by: DEMO_USER_ID, updated_at: NOW, updated_by: null },
  ];

  const vendor_bills = [
    {
      id: "bill_01",
      hotel_id: DEMO_HOTEL_ID,
      bill_number: "BILL-2026-001",
      vendor_id: "vnd_food",
      vendor_invoice_no: "INV-GF-9812",
      po_id: null,
      bill_date: "2026-09-15",
      due_date: "2026-10-15",
      subtotal: "12347.83",
      tax_total: "1852.17",
      total: "14200.00",
      amount_paid: "0.00",
      status: "received",
      journal_entry_id: null,
      notes: "توريد لحوم طازجة وخضار وفواكه لمطعم الفندق",
      created_at: "2026-09-15T09:00:00Z",
      created_by: DEMO_USER_ID,
    },
    {
      id: "bill_02",
      hotel_id: DEMO_HOTEL_ID,
      bill_number: "BILL-2026-002",
      vendor_id: "vnd_linen",
      vendor_invoice_no: "NAQ-2026-554",
      po_id: null,
      bill_date: "2026-09-10",
      due_date: "2026-10-25",
      subtotal: "7478.26",
      tax_total: "1121.74",
      total: "8600.00",
      amount_paid: "8600.00",
      status: "paid",
      journal_entry_id: null,
      notes: "توريد 150 طقم مناشف وبياضات فاخرة",
      created_at: "2026-09-10T11:00:00Z",
      created_by: DEMO_USER_ID,
    },
  ];

  const vendor_bill_lines = [
    {
      id: "bl_01",
      bill_id: "bill_01",
      hotel_id: DEMO_HOTEL_ID,
      line_no: 1,
      description: "لحوم ومواد غذائية طازجة للبوفيه",
      account_id: "acc_5100",
      department_id: "dept_fnb",
      quantity: "1",
      unit_price: "12347.83",
      net_amount: "12347.83",
      tax_rate_id: "tax_vat",
      tax_amount: "1852.17",
    },
  ];

  const purchase_orders = [
    {
      id: "po_01",
      hotel_id: DEMO_HOTEL_ID,
      po_number: "PO-2026-001",
      vendor_id: "vnd_food",
      order_date: "2026-09-24",
      status: "open",
      subtotal: "9500.00",
      tax_total: "1425.00",
      total: "10925.00",
      notes: "طلب توريد مواد جافة ومعلبات لشهر أكتوبر",
      created_at: NOW,
      created_by: DEMO_USER_ID,
    },
  ];

  const payroll_runs = [
    {
      id: "pr_2026_08",
      hotel_id: DEMO_HOTEL_ID,
      run_number: "PR-2026-08",
      period_month: "2026-08-01",
      posting_date: "2026-08-28",
      total_gross: "185000.00",
      total_net: "168000.00",
      journal_entry_id: null,
      notes: "مسير رواتب موظفي الفندق عن شهر أغسطس 2026 (48 موظف)",
      created_at: "2026-08-28T16:00:00Z",
    },
  ];

  const bank_statement_lines = [
    {
      id: "bsl_01",
      hotel_id: DEMO_HOTEL_ID,
      account_id: "acc_1120",
      txn_date: TODAY,
      description: "تسوية مبيعات نقاط البيع (POS Settlement - Mada)",
      reference: "POS-9812",
      amount: "24500.00",
      matched_line_id: null,
      matched_at: null,
      matched_by: null,
      created_at: NOW,
    },
    {
      id: "bsl_02",
      hotel_id: DEMO_HOTEL_ID,
      account_id: "acc_1120",
      txn_date: "2026-09-24",
      description: "إيداع نقدي بالفرع — توريد إيراد النزلاء",
      reference: "DEP-BRANCH",
      amount: "18200.00",
      matched_line_id: null,
      matched_at: null,
      matched_by: null,
      created_at: NOW,
    },
  ];

  const inventory_items = [
    {
      id: "inv_item_1",
      hotel_id: DEMO_HOTEL_ID,
      sku: "LIN-001",
      name_ar: "طقم أرواب ومناشف قطن مصري فاخر",
      name_en: "Egyptian Cotton Bathrobes & Towels Set",
      unit: "طقم",
      inventory_account_id: "acc_1160",
      expense_account_id: "acc_6200",
      reorder_level: "50.00",
      quantity_on_hand: "280.00",
      average_cost: "140.00",
      is_active: true,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
    {
      id: "inv_item_2",
      hotel_id: DEMO_HOTEL_ID,
      sku: "COF-001",
      name_ar: "حبوب بن إسبريسو مختص كولومبي (كجم)",
      name_en: "Specialty Colombian Espresso Beans (kg)",
      unit: "كجم",
      inventory_account_id: "acc_1150",
      expense_account_id: "acc_5100",
      reorder_level: "20.00",
      quantity_on_hand: "65.00",
      average_cost: "75.00",
      is_active: true,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
    {
      id: "inv_item_3",
      hotel_id: DEMO_HOTEL_ID,
      sku: "AMN-001",
      name_ar: "طقم مستلزمات النظافة والضيافة للغرف (كرتون)",
      name_en: "Luxury Room Amenities Box",
      unit: "كرتون",
      inventory_account_id: "acc_1160",
      expense_account_id: "acc_6200",
      reorder_level: "40.00",
      quantity_on_hand: "120.00",
      average_cost: "95.00",
      is_active: true,
      created_at: NOW,
      created_by: DEMO_USER_ID,
      updated_at: NOW,
      updated_by: null,
    },
  ];

  const fixed_assets = [
    {
      id: "ast_01",
      hotel_id: DEMO_HOTEL_ID,
      asset_number: "AST-2026-001",
      name: "أثاث وتجهيزات غرف البرج الشمالي (FF&E)",
      category: "أثاث ومفروشات",
      asset_account_id: "acc_1220",
      department_id: "dept_rooms",
      acquisition_date: "2025-01-15",
      cost: "480000.00",
      salvage_value: "40000.00",
      useful_life_months: 60,
      depreciation_start: "2025-02-01",
      accumulated_depreciation: "132000.00",
      status: "active",
      vendor_bill_id: null,
      journal_entry_id: null,
      disposal_date: null,
      disposal_proceeds: null,
      disposal_journal_entry_id: null,
      notes: "ضمان 5 سنوات مع التوريد والصيانة",
      created_at: NOW,
      created_by: DEMO_USER_ID,
    },
    {
      id: "ast_02",
      hotel_id: DEMO_HOTEL_ID,
      asset_number: "AST-2026-002",
      name: "منظومة التكييف المركزي والمبردات (Chillers)",
      category: "آلات وتجهيزات",
      asset_account_id: "acc_1210",
      department_id: "dept_maint",
      acquisition_date: "2024-06-01",
      cost: "350000.00",
      salvage_value: "30000.00",
      useful_life_months: 120,
      depreciation_start: "2024-07-01",
      accumulated_depreciation: "64000.00",
      status: "active",
      vendor_bill_id: null,
      journal_entry_id: null,
      disposal_date: null,
      disposal_proceeds: null,
      disposal_journal_entry_id: null,
      notes: "صيانة دورية كل 3 أشهر مع شركة أمان",
      created_at: NOW,
      created_by: DEMO_USER_ID,
    },
  ];

  const payments = [
    {
      id: "pay_01",
      hotel_id: DEMO_HOTEL_ID,
      voucher_number: "RV-2026-001",
      voucher_type: "receipt",
      party_type: "customer",
      payment_date: "2026-09-18",
      payment_method_id: "pm_bank",
      amount: "25000.00",
      customer_id: "cust_aramco",
      counter_account_id: null,
      department_id: null,
      party_name: "شركة أرامكو السعودية",
      reference: "WIRE-ARM-981",
      description: "سداد دفعة من فاتورة استضافة المؤتمر",
      status: "posted",
      journal_entry_id: null,
      void_reason: null,
      voided_at: null,
      voided_by: null,
      void_journal_entry_id: null,
      created_at: NOW,
      created_by: DEMO_USER_ID,
    },
  ];

  const payment_allocations = [
    {
      payment_id: "pay_01",
      invoice_id: "inv_01",
      hotel_id: DEMO_HOTEL_ID,
      amount: "25000.00",
      created_at: NOW,
      created_by: DEMO_USER_ID,
    },
  ];

  return {
    hotels: [hotel],
    users_profiles: [userProfile],
    departments,
    currencies,
    roles,
    permissions,
    role_permissions,
    hotel_members,
    chart_of_accounts,
    tax_rates,
    payment_methods,
    charge_codes,
    charge_code_taxes,
    customers,
    guest_folios,
    folio_transactions,
    folio_balances,
    invoices,
    invoice_items,
    invoice_taxes,
    credit_notes: [],
    payments,
    payment_allocations,
    fiscal_years,
    accounting_periods,
    journal_entries,
    journal_entry_lines,
    vendors,
    vendor_bills,
    vendor_bill_lines,
    purchase_orders,
    payroll_runs,
    bank_statement_lines,
    inventory_items,
    inventory_movements: [],
    fixed_assets,
    audit_logs: [],
  } as unknown as MockStoreData;
}

export function createCleanStore(): MockStoreData {
  const initial = createInitialStore();
  return {
    ...initial,
    customers: [],
    guest_folios: [],
    folio_transactions: [],
    folio_balances: [],
    invoices: [],
    invoice_items: [],
    invoice_taxes: [],
    credit_notes: [],
    payments: [],
    payment_allocations: [],
    journal_entries: [],
    journal_entry_lines: [],
    vendors: [],
    vendor_bills: [],
    vendor_bill_lines: [],
    purchase_orders: [],
    payroll_runs: [],
    bank_statement_lines: [],
    inventory_items: [],
    inventory_movements: [],
    fixed_assets: [],
    audit_logs: [],
  };
}

const STORE_FILE_PATH = path.join(process.cwd(), ".next", "hotel_mock_store.json");

// Global in-memory singleton
let globalStore: MockStoreData | null = null;

export function saveMockStore(store: MockStoreData) {
  globalStore = store;
  try {
    const dir = path.dirname(STORE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist mock store:", err);
  }
}

export function getMockStore(): MockStoreData {
  if (globalStore) return globalStore;
  try {
    if (fs.existsSync(STORE_FILE_PATH)) {
      const content = fs.readFileSync(STORE_FILE_PATH, "utf-8");
      globalStore = JSON.parse(content) as MockStoreData;
      return globalStore;
    }
  } catch (err) {
    console.error("Failed to read persistent mock store:", err);
  }
  globalStore = createCleanStore();
  saveMockStore(globalStore);
  return globalStore;
}

export function resetMockStore(clean = true): MockStoreData {
  const newStore = clean ? createCleanStore() : createInitialStore();
  saveMockStore(newStore);
  return newStore;
}
