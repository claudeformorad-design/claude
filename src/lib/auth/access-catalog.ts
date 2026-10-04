import { tr } from "@/i18n/tr";
import { PERMISSIONS, type Permission } from "./permissions";

/** أسماء مجموعات الصلاحيات كما تظهر لمدير النظام */
export const PERMISSION_GROUPS: Record<string, string> = {
  get settings() { return tr("الإعدادات"); },
  get approvals() { return tr("الموافقات"); },
  get audit() { return tr("سجل التدقيق"); },
  get pms() { return tr("الاستقبال والحجوزات والغرف"); },
  get pos() { return tr("نقاط البيع"); },
  get cashier() { return tr("الصندوق والورديات"); },
  get folio() { return tr("الفوليو والفوترة"); },
  get customers() { return tr("العملاء والشركات"); },
  get invoices() { return tr("الفواتير"); },
  get payments() { return tr("السندات والمدفوعات"); },
  get coa() { return tr("دليل الحسابات"); },
  get gl() { return tr("القيود والفترات"); },
  get reports() { return tr("التقارير المالية"); },
  get vendors() { return tr("الموردون"); },
  get purchases() { return tr("المشتريات"); },
  get bills() { return tr("فواتير الموردين"); },
  get payroll() { return tr("الرواتب"); },
  get bank() { return tr("البنك"); },
  get assets() { return tr("الأصول"); },
  get inventory() { return tr("المخزون"); },
  get hr() { return tr("الموارد البشرية"); },
};

/** الحدود المالية القابلة للضبط لكل دور ولكل موظف */
export const LIMITS: { key: "max_allowance" | "max_refund" | "max_rate_discount_pct"; label: string; hint: string; percent?: boolean }[] = [
  { key: "max_allowance", get label() { return tr("أقصى خصم على الفوليو"); }, get hint() { return tr("مبلغ الخصم أو التسوية في العملية الواحدة"); } },
  { key: "max_refund", get label() { return tr("أقصى استرداد نقدي"); }, get hint() { return tr("رد مبلغ أو عربون للنزيل في العملية الواحدة"); } },
  { key: "max_rate_discount_pct", get label() { return tr("أقصى تخفيض على سعر الغرفة"); }, get hint() { return tr("عند تحديد سعر يدوي أقل من السعر الأساسي للنوع"); }, percent: true },
];
export type LimitKey = (typeof LIMITS)[number]["key"];

/** الإجراءات السريعة التي يمكن إظهارها لكل دور في أعلى الشاشة */
export const QUICK_ACTIONS: { key: string; label: string; href: string; permission: Permission; module: "pms" | "accounting" | "core" }[] = [
  { key: "new_reservation", get label() { return tr("حجز جديد"); }, href: "/reservations/new", permission: PERMISSIONS.pmsManage, module: "pms" },
  { key: "check_in", get label() { return tr("لوحة الاستقبال"); }, href: "/front-desk", permission: PERMISSIONS.pmsView, module: "pms" },
  { key: "pos", get label() { return tr("نقطة البيع"); }, href: "/pos", permission: PERMISSIONS.posSell, module: "pms" },
  { key: "housekeeping", get label() { return tr("التدبير الفندقي"); }, href: "/housekeeping", permission: PERMISSIONS.pmsHousekeeping, module: "pms" },
  { key: "new_folio", get label() { return tr("فتح فوليو"); }, href: "/folios/new", permission: PERMISSIONS.folioManage, module: "core" },
  { key: "new_journal", get label() { return tr("قيد يومية جديد"); }, href: "/journal/new", permission: PERMISSIONS.journalCreate, module: "accounting" },
  { key: "new_receipt", get label() { return tr("سند قبض أو صرف"); }, href: "/vouchers/new", permission: PERMISSIONS.paymentsReceipt, module: "accounting" },
  { key: "new_invoice", get label() { return tr("فاتورة جديدة"); }, href: "/invoices/new", permission: PERMISSIONS.invoicesCreate, module: "accounting" },
  { key: "new_bill", get label() { return tr("فاتورة مورد"); }, href: "/bills/new", permission: PERMISSIONS.billsCreate, module: "accounting" },
];

/** أقسام لوحة التحكم التي يمكن إخفاؤها لدور معين */
export const DASHBOARD_SECTIONS: { key: string; label: string }[] = [
  { key: "kpis", get label() { return tr("بطاقات الإيرادات والمصروفات والنتيجة"); } },
  { key: "cash", get label() { return tr("النقدية والبنوك"); } },
  { key: "chart", get label() { return tr("رسم الإيرادات والمصروفات"); } },
  { key: "rooms", get label() { return tr("الإشغال ومتوسط السعر"); } },
  { key: "profit", get label() { return tr("ربحية الأقسام"); } },
  { key: "aging", get label() { return tr("أعمار الذمم وحالة الفواتير"); } },
  { key: "controls", get label() { return tr("مطابقة الحسابات"); } },
  { key: "recent", get label() { return tr("آخر القيود"); } },
];

export type AccessInterface = {
  home_path: string | null;
  quick_actions: string[];
  dashboard_hidden: string[];
  limits: Partial<Record<LimitKey, number | null>>;
};
export const EMPTY_INTERFACE: AccessInterface = { home_path: null, quick_actions: [], dashboard_hidden: [], limits: {} };
