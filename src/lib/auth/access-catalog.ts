import { PERMISSIONS, type Permission } from "./permissions";

/** أسماء مجموعات الصلاحيات كما تظهر لمدير النظام */
export const PERMISSION_GROUPS: Record<string, string> = {
  settings: "الإعدادات",
  approvals: "الموافقات",
  audit: "سجل التدقيق",
  pms: "الاستقبال والحجوزات والغرف",
  pos: "نقاط البيع",
  cashier: "الصندوق والورديات",
  folio: "الفوليو والفوترة",
  customers: "العملاء والشركات",
  invoices: "الفواتير",
  payments: "السندات والمدفوعات",
  coa: "دليل الحسابات",
  gl: "القيود والفترات",
  reports: "التقارير المالية",
  vendors: "الموردون",
  purchases: "المشتريات",
  bills: "فواتير الموردين",
  payroll: "الرواتب",
  bank: "البنك",
  assets: "الأصول",
  inventory: "المخزون",
  hr: "الموارد البشرية",
};

/** الحدود المالية القابلة للضبط لكل دور ولكل موظف */
export const LIMITS: { key: "max_allowance" | "max_refund" | "max_rate_discount_pct"; label: string; hint: string; percent?: boolean }[] = [
  { key: "max_allowance", label: "أقصى خصم على الفوليو", hint: "مبلغ الخصم أو التسوية في العملية الواحدة" },
  { key: "max_refund", label: "أقصى استرداد نقدي", hint: "رد مبلغ أو عربون للنزيل في العملية الواحدة" },
  { key: "max_rate_discount_pct", label: "أقصى تخفيض على سعر الغرفة", hint: "عند تحديد سعر يدوي أقل من السعر الأساسي للنوع", percent: true },
];
export type LimitKey = (typeof LIMITS)[number]["key"];

/** الإجراءات السريعة التي يمكن إظهارها لكل دور في أعلى الشاشة */
export const QUICK_ACTIONS: { key: string; label: string; href: string; permission: Permission; module: "pms" | "accounting" | "core" }[] = [
  { key: "new_reservation", label: "حجز جديد", href: "/reservations/new", permission: PERMISSIONS.pmsManage, module: "pms" },
  { key: "check_in", label: "لوحة الاستقبال", href: "/front-desk", permission: PERMISSIONS.pmsView, module: "pms" },
  { key: "pos", label: "نقطة البيع", href: "/pos", permission: PERMISSIONS.posSell, module: "pms" },
  { key: "housekeeping", label: "التدبير الفندقي", href: "/housekeeping", permission: PERMISSIONS.pmsHousekeeping, module: "pms" },
  { key: "new_folio", label: "فتح فوليو", href: "/folios/new", permission: PERMISSIONS.folioManage, module: "core" },
  { key: "new_journal", label: "قيد يومية جديد", href: "/journal/new", permission: PERMISSIONS.journalCreate, module: "accounting" },
  { key: "new_receipt", label: "سند قبض أو صرف", href: "/vouchers/new", permission: PERMISSIONS.paymentsReceipt, module: "accounting" },
  { key: "new_invoice", label: "فاتورة جديدة", href: "/invoices/new", permission: PERMISSIONS.invoicesCreate, module: "accounting" },
  { key: "new_bill", label: "فاتورة مورد", href: "/bills/new", permission: PERMISSIONS.billsCreate, module: "accounting" },
];

/** أقسام لوحة التحكم التي يمكن إخفاؤها لدور معين */
export const DASHBOARD_SECTIONS: { key: string; label: string }[] = [
  { key: "kpis", label: "بطاقات الإيرادات والمصروفات والنتيجة" },
  { key: "cash", label: "النقدية والبنوك" },
  { key: "chart", label: "رسم الإيرادات والمصروفات" },
  { key: "rooms", label: "الإشغال ومتوسط السعر" },
  { key: "profit", label: "ربحية الأقسام" },
  { key: "aging", label: "أعمار الذمم وحالة الفواتير" },
  { key: "controls", label: "مطابقة الحسابات" },
  { key: "recent", label: "آخر القيود" },
];

export type AccessInterface = {
  home_path: string | null;
  quick_actions: string[];
  dashboard_hidden: string[];
  limits: Partial<Record<LimitKey, number | null>>;
};
export const EMPTY_INTERFACE: AccessInterface = { home_path: null, quick_actions: [], dashboard_hidden: [], limits: {} };
