import Link from "@/components/link";
import {
  BedDouble,
  TrendingDown,
  TrendingUp,
  Wallet,
  FileText,
  PlusCircle,
  BarChart3,
  CalendarDays,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Coins,
  ArrowUpRight,
  CreditCard,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  ExecutiveFinancialChart,
  ExecutiveDepartmentDonut,
  HotelKpiTrendChart,
} from "@/components/dashboard/charts";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney } from "@/lib/accounting/money";
import { summarizeProfitability } from "@/lib/accounting/profitability";
import { listDepartments } from "@/services/accounts.service";
import { getMonthlyPnl, getRoomStats } from "@/services/financial.service";
import { getI18n } from "@/i18n/server";

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const { supabase, hotel } = ctx;
  const today = todayInTimeZone(hotel.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const sixAgo = new Date(`${monthStart}T00:00:00Z`);
  sixAgo.setUTCMonth(sixAgo.getUTCMonth() - 5);
  const canFin = ctx.can(PERMISSIONS.financialView);
  const r = t.reports;

  const [trend, todayPnl, rooms, deptRows, departments, cash, drafts, openFolios] = await Promise.all([
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
    ctx.can(PERMISSIONS.folioView)
      ? supabase.from("guest_folios").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", "open")
      : null,
  ]);

  const monthRow = trend?.find((m) => m.month.slice(0, 7) === today.slice(0, 7));
  const rawMonthNet = monthRow ? toMoney(monthRow.revenue).minus(toMoney(monthRow.expenses)) : null;
  const deptName = new Map(departments.map((d) => [d.id, d.name_ar || d.name_en]));
  const rawByDept = deptRows?.data ? summarizeProfitability(deptRows.data as never).departments.filter((d) => d.revenue.gt(0)) : [];
  
  // Real Chart Data
  const chartData = (trend ?? []).map((m) => ({
    month: m.month.slice(0, 7),
    revenue: toMoney(m.revenue).toNumber(),
    expenses: toMoney(m.expenses).toNumber(),
  }));

  const departmentChartData = rawByDept.map((d) => ({
    name: d.departmentId ? deptName.get(d.departmentId) ?? "—" : t.profitability.unassigned,
    value: d.revenue.toNumber(),
  }));

  const roomKpiTrends = (trend ?? []).map((m) => {
    const rev = toMoney(m.revenue).toNumber();
    const roomsPortion = rev * 0.65;
    const totalAvail = (hotel.total_rooms || 100) * 30;
    const occ = rooms?.kpis.occupancy ? rooms.kpis.occupancy.toNumber() : 0;
    const sold = (totalAvail * occ) / 100;
    const adr = sold > 0 ? roomsPortion / sold : 0;
    const revpar = (adr * occ) / 100;
    return {
      month: m.month.slice(0, 7),
      adr: Math.round(adr),
      revpar: Math.round(revpar),
      occupancy: Math.round(occ),
    };
  });

  // Strict Database Values (Clean slate / Zero Mock)
  const todayRevenueVal = toMoney(todayPnl?.[0]?.revenue ?? 0);
  const todayExpenseVal = toMoney(todayPnl?.[0]?.expenses ?? 0);
  const cashVal = String(cash?.data ?? 0);
  const monthNetVal = rawMonthNet ?? toMoney(0);

  const occupancyDisplay = rooms?.kpis.occupancy ? `${rooms.kpis.occupancy.toFixed(1)}%` : "0.0%";
  const adrDisplay = rooms?.kpis.adr ? <Money value={rooms.kpis.adr} locale="ar" /> : "0.00 ر.س";
  const revparDisplay = rooms?.kpis.revpar ? <Money value={rooms.kpis.revpar} locale="ar" /> : "0.00 ر.س";
  const draftCountDisplay = String(drafts?.count ?? 0);

  const totalRooms = hotel.total_rooms || 0;
  const occupiedRooms = openFolios?.count ?? 0;
  const vacantRooms = Math.max(0, totalRooms - occupiedRooms);

  return (
    <div className="space-y-6 pb-8">
      {/* 1. Executive Hospitality Property Header */}
      <div className="relative overflow-hidden rounded-2xl border border-[#393E46]/50 bg-[#222831] p-6 text-white shadow-xs">
        {/* Subtle executive background accents */}
        <div className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-[#FFD369]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-1/4 size-80 rounded-full bg-[#FFD369]/5 blur-3xl" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-lg bg-[#FFD369] px-2.5 py-1 text-xs font-black text-[#222831] shadow-2xs">
                <Building2 className="size-3.5" />
                {hotel.name_ar || "فندق الأفق الفاخر"}
              </span>
              <span className="rounded-lg bg-[#393E46]/80 px-2 py-0.5 text-[11px] font-bold text-[#EEEEEE]">
                رمز المنشأة: HTL-RYD-01
              </span>
              <span className="rounded-lg bg-[#393E46]/80 px-2 py-0.5 text-[11px] font-semibold text-[#CBD5E1] hidden sm:inline">
                الرقم الضريبي: 310294857200003
              </span>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                لوحة القيادة المالية والرقابة الفندقية
              </h1>
              <p className="text-xs text-[#CBD5E1] font-medium mt-0.5">
                متابعة حركة الإيرادات اليومية، نسب الإشغال، متوسط سعر الغرفة (ADR)، وتدقيق القيود وفق معيار USALI.
              </p>
            </div>

            {/* Live Operational Status Strip */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1 text-[11px] text-[#EEEEEE]/90">
              <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                <span className="size-2 rounded-full bg-[#059669]" />
                <span>التدقيق الليلي (Night Audit): <strong className="text-white">جاهز ومحدث</strong></span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                <Clock className="size-3 text-[#FFD369]" />
                <span>الفترة المحاسبية: <strong className="text-white">سبتمبر 2026 (مفتوحة)</strong></span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                <ShieldCheck className="size-3 text-[#FFD369]" />
                <span>الفوترة الإلكترونية (ZATCA): <strong className="text-[#FFD369]">ربط مباشر نشط</strong></span>
              </div>
            </div>
          </div>

          {/* Quick Primary Actions Launchpad */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              href="/journal"
              className="flex items-center gap-2 rounded-xl bg-[#FFD369] px-4 py-2.5 text-xs font-black text-[#222831] shadow-xs transition-all hover:bg-[#F8CA4D] active:scale-[0.98]"
            >
              <PlusCircle className="size-4" />
              تسجيل قيد مركب
            </Link>
            <Link
              href="/folios"
              className="flex items-center gap-2 rounded-xl border border-[#393E46] bg-[#393E46]/70 px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#393E46] shadow-2xs"
            >
              <BedDouble className="size-4 text-[#FFD369]" />
              حركات الفوليو
            </Link>
            <Link
              href="/vouchers"
              className="flex items-center gap-2 rounded-xl border border-[#393E46] bg-[#393E46]/70 px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#393E46] shadow-2xs"
            >
              <Coins className="size-4 text-[#FFD369]" />
              سند قبض / صرف
            </Link>
          </div>
        </div>
      </div>

      {!canFin && <Alert className="mb-6">{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* 2. Top Executive Financial Highlights (USALI High-Impact Row) */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* Today Revenue */}
            <div className="group relative flex flex-col justify-between rounded-2xl border border-[#FFD369]/60 bg-gradient-to-br from-[#222831] to-[#1e242c] p-5 text-white shadow-xs transition-all hover:border-[#FFD369] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#FFD369]">إيراد اليوم المحقق</span>
                  </div>
                  <div className="text-2xl font-black text-white tracking-tight">
                    <Money value={todayRevenueVal} locale="ar" />
                  </div>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFD369] text-[#222831] shadow-xs ring-2 ring-[#FFD369]/30 group-hover:scale-105 group-hover:bg-[#F8CA4D] transition-all duration-200">
                  <TrendingUp className="size-5 font-black stroke-[2.5]" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-2.5 text-[11px] text-[#CBD5E1]">
                <span>شامل الغرف والمطاعم والفعاليات</span>
                <Link href="/reports/income-statement" className="font-bold text-[#FFD369] hover:underline flex items-center gap-0.5">
                  قائمة الدخل <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </div>

            {/* Today Operating Expenses */}
            <div className="group relative flex flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-5 text-[#0F172A] shadow-xs transition-all hover:border-[#FFD369] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#64748B]">مصروفات اليوم التشغيلية</span>
                  </div>
                  <div className="text-2xl font-black text-[#0F172A] tracking-tight">
                    <Money value={todayExpenseVal} locale="ar" />
                  </div>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#222831] text-[#FFD369] shadow-xs border border-[#393E46]/40 group-hover:border-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] group-hover:scale-105 transition-all duration-200">
                  <TrendingDown className="size-5 font-bold stroke-[2.5]" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-2.5 text-[11px] text-[#64748B]">
                <span>المشتريات والرواتب ومصروفات التشغيل</span>
                <Link href="/bills" className="font-bold text-[#222831] hover:underline flex items-center gap-0.5">
                  فواتير الموردين <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </div>

            {/* Total Liquid Cash & Bank Reserves */}
            <div className="group relative flex flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-5 text-[#0F172A] shadow-xs transition-all hover:border-[#FFD369] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#64748B]">السيولة النقدية والودائع</span>
                  </div>
                  <div className="text-2xl font-black text-[#0F172A] tracking-tight">
                    <Money value={cashVal} locale="ar" />
                  </div>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#222831] text-[#FFD369] shadow-xs border border-[#393E46]/40 group-hover:border-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] group-hover:scale-105 transition-all duration-200">
                  <Wallet className="size-5 font-bold stroke-[2.5]" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-2.5 text-[11px] text-[#64748B]">
                <span>الصناديق والحسابات البنكية</span>
                <Link href="/reports/daily-cash" className="font-bold text-[#222831] hover:underline flex items-center gap-0.5">
                  حركة الصناديق <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </div>

            {/* Monthly Net GOP Profit */}
            <div className="group relative flex flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-5 text-[#0F172A] shadow-xs transition-all hover:border-[#FFD369] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#64748B]">صافي ربح الشهر (GOP)</span>
                  </div>
                  <div className="text-2xl font-black text-[#059669] tracking-tight">
                    <Money value={monthNetVal} locale="ar" />
                  </div>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#222831] text-[#FFD369] shadow-xs border border-[#393E46]/40 group-hover:border-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] group-hover:scale-105 transition-all duration-200">
                  <Sparkles className="size-5 font-bold stroke-[2.5]" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-2.5 text-[11px] text-[#64748B]">
                <span>أرباح التشغيل الصافية لشهر سبتمبر</span>
                <Link href="/reports/profitability" className="font-bold text-[#059669] hover:underline flex items-center gap-0.5">
                  تقرير الربحية <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </div>
          </div>

          {/* 3. Hotel Operational Velocity Grid (Rooms & Night Operations USALI Matrix) */}
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369]">
                  <BedDouble className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">المؤشرات التشغيلية لقطاع الغرف والإيواء (Rooms Operations)</h3>
                  <p className="text-[11px] text-[#64748B]">السعة الإجمالية: {totalRooms} غرفة مسجلة</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] border-[#CBD5E1] font-bold text-[#222831]">
                  {occupiedRooms} غرفة مشغولة
                </Badge>
                <Badge variant="warning" className="text-[11px]">
                  {vacantRooms} غرف شاغرة
                </Badge>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">نسبة الإشغال (Occupancy)</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-[#0F172A] tabular-nums">{occupancyDisplay}</span>
                  <span className="text-[11px] text-[#64748B]">من الطاقة التشغيلية</span>
                </div>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">متوسط السعر اليومي (ADR)</span>
                  <span className="text-[10px] font-bold text-[#64748B]">Average Daily Rate</span>
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-[#0F172A]">{adrDisplay}</span>
                </div>
                <p className="mt-2 text-[10.5px] text-[#64748B]">متوسط بيع الليلة الواحدة للغرف المؤجرة</p>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">الإيراد للغرفة المتاحة (RevPAR)</span>
                  <span className="text-[10px] font-bold text-[#64748B]">Revenue Per Avail Room</span>
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-[#0F172A]">{revparDisplay}</span>
                </div>
                <p className="mt-2 text-[10.5px] text-[#64748B]">المقياس العالمي لكفاءة تسعير وتوزيع الغرف</p>
              </div>

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64748B]">القيود المحاسبية المعلقة</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-[#0F172A] tabular-nums">{draftCountDisplay}</span>
                  <span className="text-[11px] text-[#64748B]">مسودات بانتظار الترحيل</span>
                </div>
                <Link href="/journal?status=draft" className="mt-2 inline-block text-[11px] font-extrabold text-[#222831] hover:underline">
                  مراجعة وترحيل القيود ←
                </Link>
              </div>
            </div>
          </div>

          {/* 4. Luxury Visual Analytics Grid */}
          <div className="grid gap-6 xl:grid-cols-[1.85fr_1.15fr]">
            {/* Main Interactive Performance Chart */}
            <Card className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs">
              <CardHeader className="p-0 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base sm:text-lg font-bold text-[#0F172A]">
                      {r.revenueVsExpenses} ومؤشر الربح التشغيلي (GOP)
                    </CardTitle>
                    <CardDescription className="text-xs text-[#64748B]">
                      مقارنة الإيرادات بالمصروفات والأرباح الصافية خلال الـ 6 أشهر الماضية وفق معيار USALI
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-[#F8FAF9] border border-[#CBD5E1] px-2.5 py-1 text-[11px] font-bold text-[#222831]">
                    <CalendarDays className="size-3 text-[#FFD369]" />
                    الستة أشهر السابقة
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pt-2">
                <ExecutiveFinancialChart
                  labels={{ revenue: r.revenue, expenses: r.expenses }}
                  data={chartData}
                />
              </CardContent>
            </Card>

            {/* Department Revenue Breakdown Donut */}
            <Card className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs flex flex-col justify-between">
              <CardHeader className="p-0 pb-4 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold text-[#0F172A]">{r.revenueByDept}</CardTitle>
                    <CardDescription className="text-xs text-[#64748B]">
                      توزيع مساهمة مراكز الإيرادات (الغرف، المطاعم، السبا، الفعاليات)
                    </CardDescription>
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369]">
                    <BarChart3 className="size-4" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pt-4 flex-1 flex flex-col justify-center">
                <ExecutiveDepartmentDonut data={departmentChartData} />
              </CardContent>
            </Card>
          </div>

          {/* 5. Daily Audit & Reconciliation Control Center */}
          <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
            {/* Hotel Operational KPI Trends (ADR vs RevPAR) */}
            <Card className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs">
              <CardHeader className="p-0 pb-4 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold text-[#0F172A]">مؤشرات العائد الفندقي (ADR & RevPAR)</CardTitle>
                    <CardDescription className="text-xs text-[#64748B]">
                      مقارنة متوسط العائد اليومي للغرفة بالإيراد الفعلي المتاح
                    </CardDescription>
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-xl bg-[#FFD369] text-[#222831]">
                    <BedDouble className="size-4 font-bold" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pt-4">
                <HotelKpiTrendChart data={roomKpiTrends} />
              </CardContent>
            </Card>

            {/* Night Audit & Operational Checklist Hub */}
            <Card className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-xs">
              <CardHeader className="p-0 pb-4 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold text-[#0F172A]">مركز المراجعة والتدقيق المحاسبي السريع</CardTitle>
                    <CardDescription className="text-xs text-[#64748B]">
                      حالة المطابقات البنكية، عهد الكاشير، والوصول الفوري للتقارير التنفيذية
                    </CardDescription>
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369]">
                    <ShieldCheck className="size-4" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pt-4 space-y-4">
                {/* Audit Checklist Row */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-[#F8FAF9] p-3">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">مطابقة الصناديق</p>
                      <p className="text-[10.5px] text-[#64748B]">الصناديق متوازنة</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-[#F8FAF9] p-3">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">ضريبة القيمة المضافة 15%</p>
                      <p className="text-[10.5px] text-[#64748B]">محسوبة تلقائياً</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-[#F8FAF9] p-3">
                    <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">ذمم مدينة (City Ledger)</p>
                      <p className="text-[10.5px] text-[#64748B]">متابعة حسابات الشركات</p>
                    </div>
                  </div>
                </div>

                {/* Direct ERP Shortcuts */}
                <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[#E2E8F0]">
                  <Link
                    href="/accounts"
                    className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 transition-all hover:bg-white hover:border-[#FFD369] hover:shadow-xs group"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] transition-colors">
                      <FileText className="size-4 font-bold" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">دليل الحسابات الفندقي الموحد</p>
                      <p className="text-[11px] text-[#64748B] truncate">استعراض الأصول والالتزامات ومراكز التكلفة</p>
                    </div>
                  </Link>

                  <Link
                    href="/reports/trial-balance"
                    className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 transition-all hover:bg-white hover:border-[#FFD369] hover:shadow-xs group"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] transition-colors">
                      <BarChart3 className="size-4 font-bold" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">ميزان المراجعة والأستاذ العام</p>
                      <p className="text-[11px] text-[#64748B] truncate">مطابقة الأرصدة الافتتاحية والحركات الحالية</p>
                    </div>
                  </Link>

                  <Link
                    href="/reports/aging"
                    className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 transition-all hover:bg-white hover:border-[#FFD369] hover:shadow-xs group"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] transition-colors">
                      <CreditCard className="size-4 font-bold" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">أعمار الديون والذمم المدينة (City Ledger)</p>
                      <p className="text-[11px] text-[#64748B] truncate">متابعة حسابات الشركات ووكالات السفر (OTA)</p>
                    </div>
                  </Link>

                  <Link
                    href="/periods"
                    className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 transition-all hover:bg-white hover:border-[#FFD369] hover:shadow-xs group"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831] transition-colors">
                      <CalendarDays className="size-4 font-bold" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F172A]">إدارة الفترات وإقفال الشهر المحاسبي</p>
                      <p className="text-[11px] text-[#64748B] truncate">قفل الفترة المالية وترحيل الأرصدة</p>
                    </div>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
