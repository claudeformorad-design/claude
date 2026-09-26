"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BedDouble, BookOpen, Boxes, Building2, FileSpreadsheet, FileText, LayoutDashboard, ListTree,
  Landmark, PieChart, Percent, CalendarCheck, ShieldCheck, History, TrendingUp, Waves, ListChecks, Banknote, Receipt, Scale, Settings, ShoppingCart, Truck, UserCog, Users, Wallet, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavLabels {
  dashboard: string;
  accounts: string;
  journal: string;
  trialBalance: string;
  groupGl: string;
  groupReports: string;
  comingSoon: string;
  revenue: string;
  payments: string;
  receivables: string;
  payables: string;
  expenses: string;
  assets: string;
  inventory: string;
  settings: string;
  groupRevenue: string;
  folios: string;
  invoices: string;
  vouchers: string;
  customers: string;
  revenueSettings: string;
  groupPayables: string;
  vendors: string;
  purchaseOrders: string;
  bills: string;
  payroll: string;
  bank: string;
  aging: string;
  groupAssets: string;
  fixedAssets: string;
  stock: string;
  profitability: string;
  incomeStatement: string;
  balanceSheet: string;
  cashFlow: string;
  dailyCash: string;
  roomStats: string;
  taxReturn: string;
  periods: string;
  hotelSettings: string;
  users: string;
  audit: string;
  groupAdmin: string;
}

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; soon?: boolean };

export function Sidebar({ labels, hotelName }: { labels: NavLabels; hotelName: string }) {
  const pathname = usePathname();
  const groups: { title?: string; items: Item[] }[] = [
    { items: [{ href: "/", label: labels.dashboard, icon: LayoutDashboard }] },
    {
      title: labels.groupGl,
      items: [
        { href: "/accounts", label: labels.accounts, icon: ListTree },
        { href: "/journal", label: labels.journal, icon: BookOpen },
      ],
    },
    {
      title: labels.groupRevenue,
      items: [
        { href: "/folios", label: labels.folios, icon: BedDouble },
        { href: "/invoices", label: labels.invoices, icon: FileText },
        { href: "/vouchers", label: labels.vouchers, icon: Receipt },
        { href: "/customers", label: labels.customers, icon: Users },
      ],
    },
    {
      title: labels.groupPayables,
      items: [
        { href: "/vendors", label: labels.vendors, icon: Truck },
        { href: "/purchase-orders", label: labels.purchaseOrders, icon: ShoppingCart },
        { href: "/bills", label: labels.bills, icon: FileSpreadsheet },
        { href: "/payroll", label: labels.payroll, icon: UserCog },
        { href: "/bank", label: labels.bank, icon: Landmark },
      ],
    },
    {
      title: labels.groupAssets,
      items: [
        { href: "/assets", label: labels.fixedAssets, icon: Building2 },
        { href: "/inventory", label: labels.stock, icon: Boxes },
      ],
    },
    {
      title: labels.groupReports,
      items: [
        { href: "/reports/income-statement", label: labels.incomeStatement, icon: TrendingUp },
        { href: "/reports/balance-sheet", label: labels.balanceSheet, icon: Scale },
        { href: "/reports/cash-flow", label: labels.cashFlow, icon: Waves },
        { href: "/reports/trial-balance", label: labels.trialBalance, icon: ListChecks },
        { href: "/reports/rooms", label: labels.roomStats, icon: BedDouble },
        { href: "/reports/daily-cash", label: labels.dailyCash, icon: Banknote },
        { href: "/reports/tax-return", label: labels.taxReturn, icon: Percent },
        { href: "/reports/aging", label: labels.aging, icon: Clock },
        { href: "/reports/profitability", label: labels.profitability, icon: PieChart },
      ],
    },
    {
      title: labels.groupAdmin,
      items: [
        { href: "/settings/hotel", label: labels.hotelSettings, icon: Settings },
        { href: "/settings/revenue", label: labels.revenueSettings, icon: Wallet },
        { href: "/settings/users", label: labels.users, icon: ShieldCheck },
        { href: "/periods", label: labels.periods, icon: CalendarCheck },
        { href: "/audit", label: labels.audit, icon: History },
      ],
    },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-e bg-card">
      <div className="border-b px-5 py-4">
        <p className="truncate font-semibold">{hotelName}</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.title && (
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.title}</p>
            )}
            {group.items.map((item) =>
              item.soon ? (
                <span
                  key={item.label}
                  className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/70"
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded bg-muted px-1.5 text-[10px]">{labels.comingSoon}</span>
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
                    isActive(item.href) && "bg-accent font-medium text-accent-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
