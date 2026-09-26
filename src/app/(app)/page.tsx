import Link from "next/link";
import { BedDouble, FileClock, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DepartmentRevenueChart, RevenueExpenseChart } from "@/components/dashboard/charts";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney, toMoney } from "@/lib/accounting/money";
import { summarizeProfitability } from "@/lib/accounting/profitability";
import { listDepartments } from "@/services/accounts.service";
import { getMonthlyPnl, getRoomStats } from "@/services/financial.service";
import { getI18n } from "@/i18n/server";

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const { locale, t } = await getI18n();
  const { supabase, hotel } = ctx;
  const today = todayInTimeZone(hotel.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const sixAgo = new Date(`${monthStart}T00:00:00Z`);
  sixAgo.setUTCMonth(sixAgo.getUTCMonth() - 5);
  const canFin = ctx.can(PERMISSIONS.financialView);
  const r = t.reports;

  const [trend, todayPnl, rooms, deptRows, departments, cash, drafts] = await Promise.all([
    canFin ? getMonthlyPnl(supabase, hotel.id, sixAgo.toISOString().slice(0, 10), today) : null,
    canFin ? getMonthlyPnl(supabase, hotel.id, today, today) : null,
    canFin ? getRoomStats(supabase, hotel.id, monthStart, today) : null,
    ctx.can(PERMISSIONS.profitabilityView)
      ? supabase.rpc("department_profitability", { p_hotel_id: hotel.id, p_from: monthStart, p_to: today }).select("department_id, account_type, account_subtype, amount::text")
      : null,
    listDepartments(supabase, hotel.id),
    canFin ? supabase.rpc("cash_balance", { p_hotel_id: hotel.id, p_as_of: today }) : null,
    ctx.can(PERMISSIONS.journalView)
      ? supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", "draft")
      : null,
  ]);

  const monthRow = trend?.find((m) => m.month.slice(0, 7) === today.slice(0, 7));
  const monthNet = monthRow ? toMoney(monthRow.revenue).minus(toMoney(monthRow.expenses)) : null;
  const deptName = new Map(departments.map((d) => [d.id, (locale === "en" && d.name_en) || d.name_ar]));
  const byDept = deptRows?.data ? summarizeProfitability(deptRows.data as never).departments.filter((d) => d.revenue.gt(0)) : [];
  const pct = (m: ReturnType<typeof toMoney> | null) => (m ? `${m.toFixed(1)}%` : "—");

  const kpi = (label: string, value: React.ReactNode, Icon: React.ComponentType<{ className?: string }>, href?: string) => {
    const card = (
      <Card className="h-full transition-colors hover:bg-accent/30">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle><Icon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="text-2xl font-bold">{value}</CardContent>
      </Card>
    );
    return href ? <Link key={label} href={href}>{card}</Link> : <div key={label}>{card}</div>;
  };

  return (
    <>
      <PageHeader title={ctx.profile?.full_name ? `${t.dashboard.welcome}${locale === "ar" ? "، " : ", "}${ctx.profile.full_name}` : t.dashboard.title} />
      {!canFin && <Alert className="mb-6">{t.errors.permission_denied}</Alert>}
      {canFin && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi(r.todayRevenue, <Money value={todayPnl?.[0]?.revenue ?? 0} locale={locale} />, TrendingUp, "/reports/income-statement")}
            {kpi(r.todayExpenses, <Money value={todayPnl?.[0]?.expenses ?? 0} locale={locale} />, TrendingDown)}
            {kpi(t.dashboard.cashBalance, <Money value={String(cash?.data ?? 0)} locale={locale} />, Wallet, "/reports/daily-cash")}
            {kpi(r.monthNet, monthNet ? <Money value={monthNet} locale={locale} className={monthNet.isNegative() ? "text-destructive" : ""} /> : "—", TrendingUp, "/reports/profitability")}
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi(r.occupancy, <span className="num">{pct(rooms?.kpis.occupancy ?? null)}</span>, BedDouble, "/reports/rooms")}
            {kpi(r.adr, rooms?.kpis.adr ? <Money value={rooms.kpis.adr} locale={locale} /> : "—", BedDouble, "/reports/rooms")}
            {kpi(r.revpar, rooms?.kpis.revpar ? <Money value={rooms.kpis.revpar} locale={locale} /> : "—", BedDouble, "/reports/rooms")}
            {kpi(t.dashboard.draftEntries, <span className="num">{drafts?.count ?? "—"}</span>, FileClock, "/journal?status=draft")}
          </div>
          {!hotel.total_rooms && <Alert className="mb-6">{r.setRooms}</Alert>}
          <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
            <Card><CardHeader><CardTitle>{r.revenueVsExpenses}</CardTitle></CardHeader><CardContent>
              <RevenueExpenseChart locale={locale} labels={{ revenue: r.revenue, expenses: r.expenses }}
                data={(trend ?? []).map((m) => ({ month: m.month.slice(0, 7), revenue: toMoney(m.revenue).toNumber(), expenses: toMoney(m.expenses).toNumber() }))} />
            </CardContent></Card>
            <Card><CardHeader><CardTitle>{r.revenueByDept}</CardTitle></CardHeader><CardContent>
              {byDept.length ? (
                <DepartmentRevenueChart locale={locale}
                  data={byDept.map((d) => ({ name: d.departmentId ? deptName.get(d.departmentId) ?? "—" : t.profitability.unassigned, value: d.revenue.toNumber() }))} />
              ) : <p className="py-16 text-center text-muted-foreground">{t.common.noData}</p>}
              {byDept.length > 0 && <p className="mt-2 text-center text-sm text-muted-foreground">{t.common.total}: <Money value={sumMoney(byDept.map((d) => d.revenue))} locale={locale} /></p>}
            </CardContent></Card>
          </div>
        </>
      )}
    </>
  );
}
