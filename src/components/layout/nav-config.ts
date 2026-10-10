import {
  BarChart3, Banknote, BedDouble, BookOpen, Boxes, Building2, CalendarCheck, CalendarDays, CalendarRange, Clock, ConciergeBell, DoorOpen,
  FileSpreadsheet, FileText, History, Hourglass, Landmark, LayoutDashboard, ListChecks, ListTree, Percent, PieChart, Receipt, Scale,
  ClipboardList, Coins, Scale3d, MoonStar, BrushCleaning, Utensils, BadgePercent, Settings, ShieldCheck, ShoppingCart, Tags, TrendingUp, Truck, UserCog, UserRound, Users, Wallet, Waves,
  IdCard, ClipboardCheck, FileSearch, Sigma, ListX, Repeat, CalendarClock, Plane, HandCoins, Calculator, SlidersHorizontal, FileUp, Wrench, PackageSearch, WashingMachine, PartyPopper, Star,
} from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { HotelModule } from "@/lib/supabase/database.types";

export type NavLabels = Dictionary["nav"];
/** module: القسم المرخّص الذي تتبعه الصفحة | permission: الصلاحية اللازمة لفتحها (تُخفى إن لم تتوفر) */
export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; module?: HotelModule; permission?: string | readonly string[] };
/** color: لون المجموعة (محايد في نظام التصميم الحالي؛ عنصر نشط واحد فقط يتميّز) */
export type NavGroup = { title?: string; icon: NavItem["icon"]; color: string; items: NavItem[]; module?: HotelModule };
/** ما يحق للمستخدم رؤيته: الأقسام المفعّلة للفندق وصلاحياته فيه */
export type NavAccess = { modules: readonly string[]; permissions: readonly string[] };

/** شجرة التنقل الوحيدة في النظام (الشريط الجانبي + البحث السريع)، مفلترة بالأقسام والصلاحيات */
/** لوحة التحكم مالية بالكامل: تظهر لمن يرى القوائم المالية، وغيره يبدأ من أول صفحة مسموحة له */
export const DASHBOARD_PERMISSIONS = ["reports.financial.view"] as const;
/** صفحة الموافقات لمن يقرّر الطلبات ولمن يرسلها (من يعمل على الفوليو أو الحجوزات أو السندات) */
export const APPROVALS_PERMISSIONS = ["approvals.decide", "folio.manage", "pms.reservations.view", "payments.view"] as const;
/** صفحة الاستيراد لمن يملك إضافة أي نوع من البيانات القابلة للاستيراد */
export const IMPORT_PERMISSIONS = ["pms.setup.manage", "pms.reservations.manage", "customers.manage", "inventory.manage", "hr.manage"] as const;

/** الصلاحية المفردة مطلوبة، والقائمة يكفي منها واحدة */
export const allowed = (p: NavItem["permission"], perms: ReadonlySet<string>) =>
  !p || (typeof p === "string" ? perms.has(p) : p.some((x) => perms.has(x)));

export function navGroups(l: NavLabels, access?: NavAccess): NavGroup[] {
  const all = allGroups(l);
  if (!access) return all;
  const perms = new Set(access.permissions);
  const on = (m?: HotelModule) => !m || access.modules.includes(m);
  return all
    .filter((g) => on(g.module))
    .map((g) => ({ ...g, items: g.items.filter((i) => on(i.module) && allowed(i.permission, perms)) }))
    .filter((g) => g.items.length > 0);
}

function allGroups(l: NavLabels): NavGroup[] {
  return [
    { title: l.dashboard, icon: LayoutDashboard, color: "#312f2e", module: "accounting", items: [{ href: "/", label: l.dashboard, icon: LayoutDashboard, permission: DASHBOARD_PERMISSIONS }] },
    {
      title: l.groupFrontOffice,
      icon: ConciergeBell,
      color: "#312f2e",
      module: "pms",
      items: [
        { href: "/front-desk", label: l.frontDesk, icon: ConciergeBell, permission: "pms.reservations.view" },
        { href: "/reservations", label: l.reservations, icon: CalendarDays, permission: "pms.reservations.view" },
        { href: "/tape-chart", label: l.tapeChart, icon: CalendarRange, permission: "pms.reservations.view" },
        { href: "/guests", label: l.guests, icon: UserRound, permission: "pms.reservations.view" },
        { href: "/waitlist", label: l.waitlist, icon: Hourglass, permission: "pms.reservations.view" },
        { href: "/pos", label: l.pos, icon: Utensils, permission: "pos.sell" },
        { href: "/cashier", label: l.cashier, icon: Banknote, permission: ["cashier.shifts", "cashier.shifts.manage"] },
        { href: "/night-audit", label: l.nightAudit, icon: MoonStar, permission: "pms.reports.view" },
        { href: "/guest-register", label: l.guestRegister, icon: ClipboardList, permission: "pms.reports.view" },
      ],
    },
    {
      title: l.groupRooms,
      icon: DoorOpen,
      color: "#312f2e",
      module: "pms",
      items: [
        { href: "/rooms", label: l.rooms, icon: DoorOpen, permission: "pms.reservations.view" },
        { href: "/rates", label: l.rates, icon: Tags, permission: "pms.reservations.view" },
        { href: "/rate-plans", label: l.ratePlans, icon: BadgePercent, permission: "pms.reservations.view" },
        { href: "/housekeeping", label: l.housekeeping, icon: BrushCleaning, permission: "pms.housekeeping" },
        { href: "/room-setup", label: l.roomSetup, icon: Building2, permission: "pms.setup.manage" },
      ],
    },
    {
      title: l.groupServices,
      icon: Wrench,
      color: "#312f2e",
      items: [
        { href: "/maintenance", label: l.maintenance, icon: Wrench, permission: ["maintenance.report", "maintenance.manage"] },
        { href: "/lost-found", label: l.lostFound, icon: PackageSearch, module: "pms", permission: "lost_found.manage" },
        { href: "/laundry", label: l.laundry, icon: WashingMachine, module: "pms", permission: "laundry.manage" },
        { href: "/events", label: l.events, icon: PartyPopper, module: "pms", permission: "events.view" },
        { href: "/surveys", label: l.surveys, icon: Star, module: "pms", permission: ["feedback.view", "feedback.manage"] },
      ],
    },
    {
      module: "accounting",
      title: l.groupGl,
      icon: BookOpen,
      color: "#312f2e",
      items: [
        { href: "/accounts", label: l.accounts, icon: ListTree, permission: "coa.accounts.view" },
        { href: "/journal", label: l.journal, icon: BookOpen, permission: "gl.journal.view" },
        { href: "/journal/recurring", label: l.recurringEntries, icon: Repeat, permission: "gl.journal.view" },
      ],
    },
    {
      module: "accounting",
      title: l.groupRevenue,
      icon: BedDouble,
      color: "#312f2e",
      items: [
        { href: "/folios", label: l.folios, icon: BedDouble, permission: "folio.view" },
        { href: "/invoices", label: l.invoices, icon: FileText, permission: "invoices.view" },
        { href: "/vouchers", label: l.vouchers, icon: Receipt, permission: "payments.view" },
        { href: "/cheques", label: l.cheques, icon: Landmark, permission: "payments.view" },
        { href: "/customers", label: l.customers, icon: Users, permission: "customers.view" },
      ],
    },
    {
      module: "accounting",
      title: l.groupPayables,
      icon: ShoppingCart,
      color: "#312f2e",
      items: [
        { href: "/vendors", label: l.vendors, icon: Truck, permission: "vendors.view" },
        { href: "/purchase-orders", label: l.purchaseOrders, icon: ShoppingCart, permission: "purchases.manage" },
        { href: "/bills", label: l.bills, icon: FileSpreadsheet, permission: "bills.view" },
        { href: "/payroll", label: l.payroll, icon: UserCog, permission: "payroll.manage" },
        { href: "/bank", label: l.bank, icon: Landmark, permission: "bank.reconcile" },
      ],
    },
    {
      module: "accounting",
      title: l.groupHr,
      icon: IdCard,
      color: "#312f2e",
      items: [
        { href: "/hr", label: l.employees, icon: IdCard, permission: "hr.view" },
        { href: "/hr/attendance", label: l.attendance, icon: ClipboardCheck, permission: "hr.view" },
        { href: "/hr/roster", label: l.roster, icon: CalendarClock, permission: "hr.view" },
        { href: "/hr/leaves", label: l.leaves, icon: Plane, permission: "hr.view" },
        { href: "/hr/advances", label: l.advances, icon: HandCoins, permission: "hr.view" },
        { href: "/hr/payroll", label: l.hrPayroll, icon: Calculator, permission: "hr.view" },
      ],
    },
    {
      module: "accounting",
      title: l.groupAssets,
      icon: Boxes,
      color: "#312f2e",
      items: [
        { href: "/assets", label: l.fixedAssets, icon: Building2, permission: "assets.view" },
        { href: "/inventory", label: l.stock, icon: Boxes, permission: "inventory.view" },
      ],
    },
    {
      module: "accounting",
      title: l.groupReports,
      icon: BarChart3,
      color: "#312f2e",
      items: [
        { href: "/reports/income-statement", label: l.incomeStatement, icon: TrendingUp, permission: "reports.financial.view" },
        { href: "/reports/balance-sheet", label: l.balanceSheet, icon: Scale, permission: "reports.financial.view" },
        { href: "/reports/cash-flow", label: l.cashFlow, icon: Waves, permission: "reports.financial.view" },
        { href: "/reports/trial-balance", label: l.trialBalance, icon: ListChecks, permission: "reports.trial_balance.view" },
        { href: "/reports/account-statement", label: l.accountStatement, icon: FileSearch, permission: "gl.journal.view" },
        { href: "/reports/monthly-movement", label: l.monthlyMovement, icon: CalendarRange, permission: "reports.trial_balance.view" },
        { href: "/reports/daily-totals", label: l.dailyTotals, icon: Sigma, permission: "gl.journal.view" },
        { href: "/reports/rooms", label: l.roomStats, icon: BedDouble, permission: "reports.financial.view" },
        { href: "/reports/daily-cash", label: l.dailyCash, icon: Banknote, permission: "reports.cash.view" },
        { href: "/reports/tax-return", label: l.taxReturn, icon: Percent, permission: "reports.tax.view" },
        { href: "/reports/aging", label: l.aging, icon: Clock, permission: "reports.aging.view" },
        { href: "/reports/profitability", label: l.profitability, icon: PieChart, permission: "reports.profitability.view" },
        { href: "/reports/missing-numbers", label: l.missingNumbers, icon: ListX, permission: "audit.logs.view" },
      ],
    },
    {
      title: l.groupAdmin,
      icon: Settings,
      color: "#312f2e",
      items: [
        { href: "/settings/hotel", label: l.hotelSettings, icon: Settings, permission: ["settings.hotel.manage", "coa.accounts.view"] },
        { href: "/settings/revenue", label: l.revenueSettings, icon: Wallet, permission: "coa.accounts.view" },
        { href: "/settings/currencies", label: l.currencies, icon: Coins, permission: "settings.currencies.manage" },
        { href: "/settings/hr", label: l.hrSettings, icon: SlidersHorizontal, permission: "hr.manage", module: "accounting" },
        { href: "/opening-balances", label: l.openingBalances, icon: Scale3d, permission: "settings.hotel.manage", module: "accounting" },
        { href: "/settings/users", label: l.users, icon: ShieldCheck, permission: "settings.users.manage" },
        { href: "/settings/import", label: l.dataImport, icon: FileUp, permission: IMPORT_PERMISSIONS },
        { href: "/approvals", label: l.approvals, icon: ClipboardCheck, permission: APPROVALS_PERMISSIONS },
        { href: "/periods", label: l.periods, icon: CalendarCheck, permission: "gl.periods.view", module: "accounting" },
        { href: "/audit", label: l.audit, icon: History, permission: "audit.logs.view" },
      ],
    },
  ];
}

export const isActivePath = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** حدث عام لفتح البحث السريع من أي مكان (زر الرأس أو حقل البحث في الصفحة) */
export const OPEN_SEARCH_EVENT = "open-command-palette";

/** كوكي حالة الشريط الجانبي (موسّع بالأسماء أو أيقونات) — يُقرأ في الخادم فيُرسم دون وميض */
export const SIDEBAR_COOKIE = "sidebar_expanded";
