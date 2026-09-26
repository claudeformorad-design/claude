import {
  BarChart3, Banknote, BedDouble, BookOpen, Boxes, Building2, CalendarCheck, Clock, FileSpreadsheet, FileText, History, Landmark,
  LayoutDashboard, ListChecks, ListTree, Percent, PieChart, Receipt, Scale, Settings, ShieldCheck, ShoppingCart,
  TrendingUp, Truck, UserCog, Users, Wallet, Waves,
} from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/ar";

export type NavLabels = Dictionary["nav"];
export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
/** color: لون المجموعة (أيقونات القائمة والعنصر النشط) */
export type NavGroup = { title?: string; icon: NavItem["icon"]; color: string; items: NavItem[] };

/** شجرة التنقل الوحيدة في النظام (الشريط الجانبي + البحث السريع) */
export function navGroups(l: NavLabels): NavGroup[] {
  return [
    { title: l.dashboard, icon: LayoutDashboard, color: "#111318", items: [{ href: "/", label: l.dashboard, icon: LayoutDashboard }] },
    {
      title: l.groupGl,
      icon: BookOpen,
      color: "#2e90fa",
      items: [
        { href: "/accounts", label: l.accounts, icon: ListTree },
        { href: "/journal", label: l.journal, icon: BookOpen },
      ],
    },
    {
      title: l.groupRevenue,
      icon: BedDouble,
      color: "#fb8c2b",
      items: [
        { href: "/folios", label: l.folios, icon: BedDouble },
        { href: "/invoices", label: l.invoices, icon: FileText },
        { href: "/vouchers", label: l.vouchers, icon: Receipt },
        { href: "/customers", label: l.customers, icon: Users },
      ],
    },
    {
      title: l.groupPayables,
      icon: ShoppingCart,
      color: "#12b76a",
      items: [
        { href: "/vendors", label: l.vendors, icon: Truck },
        { href: "/purchase-orders", label: l.purchaseOrders, icon: ShoppingCart },
        { href: "/bills", label: l.bills, icon: FileSpreadsheet },
        { href: "/payroll", label: l.payroll, icon: UserCog },
        { href: "/bank", label: l.bank, icon: Landmark },
      ],
    },
    {
      title: l.groupAssets,
      icon: Boxes,
      color: "#7a2ef0",
      items: [
        { href: "/assets", label: l.fixedAssets, icon: Building2 },
        { href: "/inventory", label: l.stock, icon: Boxes },
      ],
    },
    {
      title: l.groupReports,
      icon: BarChart3,
      color: "#e8457a",
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
      color: "#475569",
      items: [
        { href: "/settings/hotel", label: l.hotelSettings, icon: Settings },
        { href: "/settings/revenue", label: l.revenueSettings, icon: Wallet },
        { href: "/settings/users", label: l.users, icon: ShieldCheck },
        { href: "/periods", label: l.periods, icon: CalendarCheck },
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
