import {
  BarChart3, Banknote, BedDouble, BookOpen, Boxes, Building2, CalendarCheck, CalendarDays, CalendarRange, Clock, ConciergeBell, DoorOpen,
  FileSpreadsheet, FileText, History, Hourglass, Landmark, LayoutDashboard, ListChecks, ListTree, Percent, PieChart, Receipt, Scale,
  Coins, Settings, ShieldCheck, ShoppingCart, Tags, TrendingUp, Truck, UserCog, UserRound, Users, Wallet, Waves,
} from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { HotelModule } from "@/lib/supabase/database.types";

export type NavLabels = Dictionary["nav"];
/** module: القسم المرخّص الذي تتبعه الصفحة | permission: الصلاحية اللازمة لفتحها (تُخفى إن لم تتوفر) */
export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; module?: HotelModule; permission?: string };
/** color: لون المجموعة (محايد في نظام التصميم الحالي؛ عنصر نشط واحد فقط يتميّز) */
export type NavGroup = { title?: string; icon: NavItem["icon"]; color: string; items: NavItem[]; module?: HotelModule };
/** ما يحق للمستخدم رؤيته: الأقسام المفعّلة للفندق وصلاحياته فيه */
export type NavAccess = { modules: readonly string[]; permissions: readonly string[] };

/** شجرة التنقل الوحيدة في النظام (الشريط الجانبي + البحث السريع)، مفلترة بالأقسام والصلاحيات */
export function navGroups(l: NavLabels, access?: NavAccess): NavGroup[] {
  const all = allGroups(l);
  if (!access) return all;
  const perms = new Set(access.permissions);
  const on = (m?: HotelModule) => !m || access.modules.includes(m);
  return all
    .filter((g) => on(g.module))
    .map((g) => ({ ...g, items: g.items.filter((i) => on(i.module) && (!i.permission || perms.has(i.permission))) }))
    .filter((g) => g.items.length > 0);
}

function allGroups(l: NavLabels): NavGroup[] {
  return [
    { title: l.dashboard, icon: LayoutDashboard, color: "#312f2e", module: "accounting", items: [{ href: "/", label: l.dashboard, icon: LayoutDashboard }] },
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
        { href: "/cashier", label: l.cashier, icon: Banknote, permission: "cashier.shifts" },
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
        { href: "/room-setup", label: l.roomSetup, icon: Building2, permission: "pms.setup.manage" },
      ],
    },
    {
      module: "accounting",
      title: l.groupGl,
      icon: BookOpen,
      color: "#312f2e",
      items: [
        { href: "/accounts", label: l.accounts, icon: ListTree },
        { href: "/journal", label: l.journal, icon: BookOpen },
      ],
    },
    {
      module: "accounting",
      title: l.groupRevenue,
      icon: BedDouble,
      color: "#312f2e",
      items: [
        { href: "/folios", label: l.folios, icon: BedDouble },
        { href: "/invoices", label: l.invoices, icon: FileText },
        { href: "/vouchers", label: l.vouchers, icon: Receipt },
        { href: "/customers", label: l.customers, icon: Users },
      ],
    },
    {
      module: "accounting",
      title: l.groupPayables,
      icon: ShoppingCart,
      color: "#312f2e",
      items: [
        { href: "/vendors", label: l.vendors, icon: Truck },
        { href: "/purchase-orders", label: l.purchaseOrders, icon: ShoppingCart },
        { href: "/bills", label: l.bills, icon: FileSpreadsheet },
        { href: "/payroll", label: l.payroll, icon: UserCog },
        { href: "/bank", label: l.bank, icon: Landmark },
      ],
    },
    {
      module: "accounting",
      title: l.groupAssets,
      icon: Boxes,
      color: "#312f2e",
      items: [
        { href: "/assets", label: l.fixedAssets, icon: Building2 },
        { href: "/inventory", label: l.stock, icon: Boxes },
      ],
    },
    {
      module: "accounting",
      title: l.groupReports,
      icon: BarChart3,
      color: "#312f2e",
      items: [
        { href: "/reports/income-statement", label: l.incomeStatement, icon: TrendingUp },
        { href: "/reports/balance-sheet", label: l.balanceSheet, icon: Scale },
        { href: "/reports/cash-flow", label: l.cashFlow, icon: Waves },
        { href: "/reports/trial-balance", label: l.trialBalance, icon: ListChecks },
        { href: "/reports/rooms", label: l.roomStats, icon: BedDouble },
        { href: "/reports/daily-cash", label: l.dailyCash, icon: Banknote },
        { href: "/reports/tax-return", label: l.taxReturn, icon: Percent },
        { href: "/reports/aging", label: l.aging, icon: Clock },
        { href: "/reports/profitability", label: l.profitability, icon: PieChart },
      ],
    },
    {
      title: l.groupAdmin,
      icon: Settings,
      color: "#312f2e",
      items: [
        { href: "/settings/hotel", label: l.hotelSettings, icon: Settings },
        { href: "/settings/revenue", label: l.revenueSettings, icon: Wallet },
        { href: "/settings/currencies", label: l.currencies, icon: Coins, permission: "settings.currencies.manage" },
        { href: "/settings/users", label: l.users, icon: ShieldCheck },
        { href: "/periods", label: l.periods, icon: CalendarCheck, module: "accounting" },
        { href: "/audit", label: l.audit, icon: History },
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
