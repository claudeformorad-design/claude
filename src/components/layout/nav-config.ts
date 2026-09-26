import {
  Banknote, BedDouble, BookOpen, Boxes, Building2, CalendarCheck, Clock, FileSpreadsheet, FileText, History, Landmark,
  LayoutDashboard, ListChecks, ListTree, Percent, PieChart, Receipt, Scale, Settings, ShieldCheck, ShoppingCart,
  TrendingUp, Truck, UserCog, Users, Wallet, Waves,
} from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/ar";

/** كوكي حالة طي الشريط الجانبي (يُقرأ في الخادم لرسم الحالة الصحيحة دون وميض) */
export const SIDEBAR_COOKIE = "sidebar_collapsed";

export type NavLabels = Dictionary["nav"];
export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
export type NavGroup = { title?: string; items: NavItem[] };

/** شجرة التنقل الوحيدة في النظام (الشريط الجانبي + البحث السريع) */
export function navGroups(l: NavLabels): NavGroup[] {
  return [
    { items: [{ href: "/", label: l.dashboard, icon: LayoutDashboard }] },
    {
      title: l.groupGl,
      items: [
        { href: "/accounts", label: l.accounts, icon: ListTree },
        { href: "/journal", label: l.journal, icon: BookOpen },
      ],
    },
    {
      title: l.groupRevenue,
      items: [
        { href: "/folios", label: l.folios, icon: BedDouble },
        { href: "/invoices", label: l.invoices, icon: FileText },
        { href: "/vouchers", label: l.vouchers, icon: Receipt },
        { href: "/customers", label: l.customers, icon: Users },
      ],
    },
    {
      title: l.groupPayables,
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
      items: [
        { href: "/assets", label: l.fixedAssets, icon: Building2 },
        { href: "/inventory", label: l.stock, icon: Boxes },
      ],
    },
    {
      title: l.groupReports,
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
