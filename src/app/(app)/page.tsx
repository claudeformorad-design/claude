import Link from "@/components/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BedDouble,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  Coins,
  CreditCard,
  FileText,
  PlusCircle,
  Scale,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { ExecutiveDepartmentDonut, ExecutiveFinancialChart, HotelKpiTrendChart, type RoomTrendPoint } from "@/components/dashboard/charts";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { roomKpis } from "@/lib/accounting/kpi";
import { type Money as MoneyValue, ZERO, toMoney } from "@/lib/accounting/money";
import { summarizeProfitability } from "@/lib/accounting/profitability";
import type { LedgerControl } from "@/lib/supabase/database.types";
import { listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getMonthlyPnl, getRoomStats } from "@/services/financial.service";
import { getI18n } from "@/i18n/server";

/**
 * لوحة التحكم — كل رقم هنا محسوب من مصدره المحاسبي مباشرة:
 *  • الإيرادات والمصروفات وصافي النتيجة: القيود المرحّلة في الأستاذ العام (monthly_pnl)
 *  • النقدية: أرصدة حسابات الصندوق والعهدة والبنوك في الأستاذ (cash_balance)
 *  • الإشغال وADR وRevPAR: رسوم فئة «غرف» الفعّالة على الفوليو ÷ عدد الغرف (room_statistics + kpi.ts)
 *  • الذمم والودائع والمخزون: الدفاتر الفرعية، مع مطابقتها لحسابات المراقبة (ledger_reconciliation)
 * لا توجد أي قيم افتراضية أو تقديرية؛ ما لا يمكن حسابه يُعرض «—» مع سبب.
 */

const CONTROL_LABELS: Record<LedgerControl, { title: string; sub: string; href: string }> = {
  guest_ledger: { title: "ذمم النزلاء (فوليو مفتوح)", sub: "حساب ذمم النزلاء ↔ أرصدة الفوليوهات", href: "/folios?status=open" },
  guest_deposits: { title: "ودائع النزلاء", sub: "حساب الودائع ↔ ودائع الفوليو غير المطبّقة", href: "/folios" },
  accounts_receivable: { title: "الذمم المدينة (City Ledger)", sub: "حساب الذمم ↔ الفواتير القائمة − أرصدة العملاء الدائنة", href: "/reports/aging" },
  accounts_payable: { title: "الذمم الدائنة (الموردون)", sub: "حساب الموردين ↔ فواتير الموردين غير المسددة", href: "/reports/aging?kind=payable" },
  inventory: { title: "المخزون", sub: "حسابات المخزون ↔ قيمة الأصناف + مشتريات مفوترة لم تُستلم", href: "/inventory" },
  trial_balance: { title: "ميزان المراجعة", sub: "مجموع المدين ↔ مجموع الدائن لكل القيود المرحّلة", href: "/reports/trial-balance" },
};

function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat("ar-SA", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    return (part ?? code).replace(/\.$/, "");
  } catch {
    return code;
  }
}

const pct = (v: MoneyValue | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const { supabase, hotel } = ctx;
  const r = t.reports;

  const today = todayInTimeZone(hotel.timezone);
  const monthKey = today.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  // آخر 6 أشهر بما فيها الشهر الحالي (مفاتيح ثابتة حتى تظهر الأشهر الخالية بصفر بدل أن تختفي)
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const trendStart = `${months[0]}-01`;

  const canFin = ctx.can(PERMISSIONS.financialView);
  const canProfit = ctx.can(PERMISSIONS.profitabilityView);

  const [trend, todayPnl, roomDays, deptRows, departments, cash, drafts, openFolios, period, recon] = await Promise.all([
    canFin ? getMonthlyPnl(supabase, hotel.id, trendStart, today) : null,
    canFin ? getMonthlyPnl(supabase, hotel.id, today, today) : null,
    canFin ? getRoomStats(supabase, hotel.id, trendStart, today) : null,
    canProfit
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
    ctx.can(PERMISSIONS.periodsView)
      ? supabase.from("accounting_periods").select("name, status").eq("hotel_id", hotel.id).lte("start_date", today).gte("end_date", today).maybeSingle()
      : null,
    canFin
      ? supabase.rpc("ledger_reconciliation", { p_hotel_id: hotel.id })
          .select("control, gl_balance::text, subledger_balance::text, reconciling_items::text, difference::text")
      : null,
  ]);
  // أي خطأ في مصدر بيانات يُظهر صفحة الخطأ بدل أرقام ناقصة مضللة
  raise(deptRows?.error ?? null);
  raise(cash?.error ?? null);
  raise(drafts?.error ?? null);
  raise(openFolios?.error ?? null);
  raise(period?.error ?? null);
  raise(recon?.error ?? null);

  const currency = currencySymbol(hotel.base_currency);

  // ---- الأداء المالي (الأستاذ العام) ----
  const pnlByMonth = new Map((trend ?? []).map((m) => [m.month.slice(0, 7), m]));
  const chartData = months.map((m) => ({
    month: m,
    revenue: toMoney(pnlByMonth.get(m)?.revenue ?? 0).toNumber(),
    expenses: toMoney(pnlByMonth.get(m)?.expenses ?? 0).toNumber(),
  }));
  const monthRevenue = toMoney(pnlByMonth.get(monthKey)?.revenue ?? 0);
  const monthExpenses = toMoney(pnlByMonth.get(monthKey)?.expenses ?? 0);
  const monthNet = monthRevenue.minus(monthExpenses);
  const todayRevenue = toMoney(todayPnl?.[0]?.revenue ?? 0);
  const todayExpenses = toMoney(todayPnl?.[0]?.expenses ?? 0);
  const cashBalance = toMoney((cash?.data as string | number | null | undefined) ?? 0);

  // ---- مؤشرات الغرف: لكل شهر من أيامه الفعلية ----
  const daysByMonth = new Map<string, NonNullable<typeof roomDays>["days"]>();
  for (const d of roomDays?.days ?? []) {
    const k = d.business_date.slice(0, 7);
    daysByMonth.set(k, [...(daysByMonth.get(k) ?? []), d]);
  }
  const monthRooms = roomKpis(daysByMonth.get(monthKey) ?? []);
  const roomTrend: RoomTrendPoint[] = months.map((m) => {
    const k = roomKpis(daysByMonth.get(m) ?? []);
    return {
      month: m,
      adr: k.adr?.toNumber() ?? null,
      revpar: k.revpar?.toNumber() ?? null,
      occupancy: k.occupancy?.toNumber() ?? null,
      nights: k.roomNightsSold.toNumber(),
    };
  });
  const totalRooms = hotel.total_rooms ?? 0;

  // ---- الأقسام ----
  const deptName = new Map(departments.map((d) => [d.id, d.name_ar || d.name_en]));
  const deptSummary = deptRows?.data ? summarizeProfitability(deptRows.data as never).departments : [];
  const departmentChartData = deptSummary
    .filter((d) => d.revenue.gt(0))
    .map((d) => ({ name: d.departmentId ? deptName.get(d.departmentId) ?? "—" : t.profitability.unassigned, value: d.revenue.toNumber() }));
  // صافي سالب لقسم (تسويات تفوق إيراده) لا يُرسم في الدائرة؛ يُذكر صراحةً حتى يطابق المجموع الأستاذ
  const negativeDepts = deptSummary.filter((d) => d.revenue.isNegative());
  const deptNote = negativeDepts.length
    ? `تسويات إيراد صافية سالبة غير ممثلة في الدائرة: ${negativeDepts
        .map((d) => `${d.departmentId ? deptName.get(d.departmentId) ?? "—" : t.profitability.unassigned} (${d.revenue.toFixed(2)})`)
        .join("، ")}`
    : undefined;

  // ---- المطابقة ----
  const reconRows = ((recon?.data ?? []) as unknown as {
    control: LedgerControl; gl_balance: string; subledger_balance: string; reconciling_items: string; difference: string;
  }[]).map((x) => ({ ...x, diff: toMoney(x.difference) }));
  const bal = (c: LedgerControl) => toMoney(reconRows.find((x) => x.control === c)?.subledger_balance ?? 0);
  const unreconciled = reconRows.filter((x) => !x.diff.isZero());

  // ---- تنبيهات تحتاج إجراء (حقيقية فقط) ----
  const draftCount = drafts?.count ?? 0;
  const alerts: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if (period && !period.data) alerts.push({ text: "لا توجد فترة محاسبية تغطي تاريخ اليوم — لن يُقبل ترحيل أي قيد بهذا التاريخ.", href: "/periods", tone: "danger" });
  else if (period?.data?.status === "closed") alerts.push({ text: `الفترة المحاسبية الحالية (${period.data.name}) مقفلة.`, href: "/periods", tone: "warn" });
  if (unreconciled.length > 0) alerts.push({ text: `يوجد فرق مطابقة في ${unreconciled.length} من حسابات المراقبة — راجع قسم سلامة الربط أدناه.`, href: "#reconciliation", tone: "danger" });
  if (canFin && totalRooms <= 0) alerts.push({ text: "عدد الغرف غير محدد في إعدادات الفندق؛ لا يمكن حساب الإشغال وRevPAR.", href: "/settings/hotel", tone: "warn" });
  if (canFin && cashBalance.isNegative()) alerts.push({ text: "رصيد النقدية والبنوك في الأستاذ سالب — راجع السندات والمدفوعات أو سجّل رأس المال/التمويل.", href: "/reports/daily-cash", tone: "danger" });
  if (draftCount > 0) alerts.push({ text: `${draftCount} قيد يومية بحالة مسودة لم يُرحّل بعد (لا يؤثر على الأرصدة حتى ترحيله).`, href: "/journal?status=draft", tone: "warn" });

  const quick = [
    ctx.can(PERMISSIONS.journalCreate) && { href: "/journal/new", label: "قيد يومية جديد", icon: PlusCircle, primary: true },
    ctx.can(PERMISSIONS.folioManage) && { href: "/folios/new", label: "فتح فوليو", icon: BedDouble },
    ctx.can(PERMISSIONS.paymentsReceipt) && { href: "/vouchers/new", label: "سند قبض / صرف", icon: Coins },
  ].filter(Boolean) as { href: string; label: string; icon: typeof PlusCircle; primary?: boolean }[];

  const businessDate = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));

  return (
    <div className="space-y-6 pb-8">
      {/* 1) ترويسة المنشأة */}
      <div className="relative overflow-hidden rounded-2xl border border-[#393E46]/50 bg-[#222831] p-6 text-white shadow-xs">
        <div className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-[#FFD369]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-1/4 size-80 rounded-full bg-[#FFD369]/5 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-lg bg-[#FFD369] px-2.5 py-1 text-xs font-black text-[#222831] shadow-2xs">
                <Building2 className="size-3.5" />
                {hotel.name_ar || hotel.name_en}
              </span>
              {hotel.tax_number && (
                <span className="rounded-lg bg-[#393E46]/80 px-2 py-0.5 text-[11px] font-semibold text-[#EEEEEE]">
                  الرقم الضريبي: <span className="num">{hotel.tax_number}</span>
                </span>
              )}
              <span className="rounded-lg bg-[#393E46]/80 px-2 py-0.5 text-[11px] font-semibold text-[#EEEEEE]">
                العملة الأساسية: <span className="num">{hotel.base_currency}</span>
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{t.dashboard.title}</h1>
              <p className="mt-1 text-xs font-medium text-[#CBD5E1]">
                جميع الأرقام محسوبة مباشرة من القيود المرحّلة والدفاتر الفرعية — لا توجد قيم تقديرية.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-[#EEEEEE]/90">
              <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                <CalendarDays className="size-3 text-[#FFD369]" />
                <span>تاريخ العمل: <strong className="text-white">{businessDate}</strong></span>
              </div>
              {period && (
              <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                <span className={`size-2 rounded-full ${period.data?.status === "open" ? "bg-[#059669]" : "bg-[#D97706]"}`} />
                <span>
                  الفترة المحاسبية:{" "}
                  <strong className="text-white">
                    {period.data ? `${period.data.name} (${period.data.status === "open" ? "مفتوحة" : "مقفلة"})` : "غير معرّفة"}
                  </strong>
                </span>
              </div>
              )}
              {canFin && (
                <div className="flex items-center gap-1.5 rounded-md bg-[#393E46]/40 px-2 py-1">
                  <ShieldCheck className="size-3 text-[#FFD369]" />
                  <span>
                    مطابقة الدفاتر:{" "}
                    <strong className={unreconciled.length ? "text-[#FFD369]" : "text-white"}>
                      {unreconciled.length ? `${unreconciled.length} فرق` : "متطابقة"}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          </div>
          {quick.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              {quick.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className={
                    q.primary
                      ? "flex items-center gap-2 rounded-xl bg-[#FFD369] px-4 py-2.5 text-xs font-black text-[#222831] shadow-xs transition-all hover:bg-[#F8CA4D] active:scale-[0.98]"
                      : "flex items-center gap-2 rounded-xl border border-[#393E46] bg-[#393E46]/70 px-3.5 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-[#393E46]"
                  }
                >
                  <q.icon className={`size-4 ${q.primary ? "" : "text-[#FFD369]"}`} />
                  {q.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2) تنبيهات تحتاج إجراء */}
      {alerts.length > 0 && (
        <div className="grid gap-2">
          {alerts.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors ${
                a.tone === "danger"
                  ? "border-red-200 bg-red-50/60 text-red-800 hover:bg-red-50"
                  : "border-[#FFD369]/60 bg-[#FFD369]/10 text-[#0F172A] hover:bg-[#FFD369]/20"
              }`}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className={`size-4 shrink-0 ${a.tone === "danger" ? "text-red-600" : "text-[#D97706]"}`} />
                {a.text}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {!canFin && <Alert>{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* 3) المؤشرات المالية الرئيسية */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              dark
              label="إيرادات اليوم"
              value={todayRevenue}
              currency={currency}
              icon={TrendingUp}
              foot="كل حسابات الإيراد المرحّلة بتاريخ اليوم"
              link={{ href: "/reports/income-statement", label: "قائمة الدخل" }}
            />
            <KpiCard
              label="مصروفات اليوم"
              value={todayExpenses}
              currency={currency}
              icon={TrendingDown}
              foot="تكاليف ومصروفات مرحّلة بتاريخ اليوم"
              link={{ href: "/reports/income-statement", label: "التفاصيل" }}
            />
            <KpiCard
              label="صافي نتيجة الشهر حتى اليوم"
              value={monthNet}
              currency={currency}
              icon={BarChart3}
              tone={monthNet.isNegative() ? "loss" : "profit"}
              foot={
                <span className="num">
                  إيرادات {monthRevenue.toFixed(2)} − مصروفات {monthExpenses.toFixed(2)}
                </span>
              }
              link={canProfit ? { href: "/reports/profitability", label: "ربحية الأقسام" } : undefined}
            />
            <KpiCard
              label="النقدية والبنوك"
              value={cashBalance}
              currency={currency}
              icon={Wallet}
              foot="أرصدة الصناديق والعهد والبنوك في الأستاذ"
              link={{ href: "/reports/daily-cash", label: "النقدية اليومية" }}
            />
          </div>

          {/* 4) قطاع الغرف (الشهر الحالي) */}
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
            <SectionHeader
              icon={BedDouble}
              title="مؤشرات قطاع الغرف — الشهر الحالي حتى اليوم"
              sub={totalRooms > 0 ? `عدد الغرف المتاحة للبيع: ${totalRooms} غرفة` : "حدّد عدد الغرف في إعدادات الفندق لحساب الإشغال وRevPAR"}
              aside={
                <Link href="/reports/rooms" className="text-[11px] font-extrabold text-[#222831] hover:underline">
                  تقرير إحصاءات الغرف ←
                </Link>
              }
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="نسبة الإشغال" value={pct(monthRooms.occupancy)} hint="الليالي المباعة ÷ المتاحة" />
              <Stat label="متوسط سعر الغرفة (ADR)" value={monthRooms.adr ? <Money value={monthRooms.adr} locale="ar" /> : "—"} unit={monthRooms.adr ? currency : undefined} hint="إيراد الغرف ÷ الليالي المباعة" />
              <Stat label="الإيراد لكل غرفة متاحة (RevPAR)" value={monthRooms.revpar ? <Money value={monthRooms.revpar} locale="ar" /> : "—"} unit={monthRooms.revpar ? currency : undefined} hint="إيراد الغرف ÷ الليالي المتاحة" />
              <Stat
                label="الليالي المباعة / المتاحة"
                value={<span className="num">{monthRooms.roomNightsSold.toString()} / {monthRooms.roomNightsAvailable.toString()}</span>}
                hint={<>إيراد الغرف: <Money value={monthRooms.roomRevenue} locale="ar" /> {currency}</>}
              />
              <Stat
                label="الفوليوهات المفتوحة"
                value={<span className="num">{openFolios?.count ?? 0}</span>}
                hint={<Link href="/folios?status=open" className="font-bold text-[#222831] hover:underline">عرض الفوليوهات ←</Link>}
              />
            </div>
          </div>

          {/* 5) الاتجاه المالي + الأقسام */}
          <div className="grid gap-6 xl:grid-cols-[1.85fr_1.15fr]">
            <Panel icon={TrendingUp} title={r.revenueVsExpenses} sub="من القيود المرحّلة؛ الخط المتقطع = صافي النتيجة (قد يكون سالبًا)">
              <ExecutiveFinancialChart
                data={chartData}
                currency={currency}
                labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }}
              />
            </Panel>
            <Panel icon={BarChart3} title={r.revenueByDept} sub="إيراد كل مركز إيراد من القيود المرحّلة">
              {canProfit ? (
                <ExecutiveDepartmentDonut data={departmentChartData} currency={currency} ledgerTotal={monthRevenue.toNumber()} note={deptNote} />
              ) : (
                <p className="py-10 text-center text-xs text-[#64748B]">{t.errors.permission_denied}</p>
              )}
            </Panel>
          </div>

          {/* 6) مؤشرات الغرف الشهرية + الأرصدة المفتوحة */}
          <div className="grid gap-6 xl:grid-cols-[1.15fr_1.85fr]">
            <Panel icon={BedDouble} title="اتجاه ADR وRevPAR والإشغال" sub="محسوبة لكل شهر من لياليه الفعلية">
              <HotelKpiTrendChart data={roomTrend} currency={currency} />
            </Panel>
            <Panel icon={Scale} title="الأرصدة المفتوحة" sub="من الدفاتر الفرعية (مطابَقة مع الأستاذ العام)">
              <div className="grid gap-3 sm:grid-cols-2">
                <Balance label="ذمم النزلاء المقيمين" value={bal("guest_ledger")} currency={currency} href="/folios?status=open" icon={BedDouble} />
                <Balance label="ودائع النزلاء غير المطبّقة" value={bal("guest_deposits")} currency={currency} href="/folios" icon={Wallet} />
                <Balance label="الذمم المدينة (الشركات)" value={bal("accounts_receivable")} currency={currency} href="/reports/aging" icon={CreditCard} />
                <Balance label="الذمم الدائنة (الموردون)" value={bal("accounts_payable")} currency={currency} href="/reports/aging?kind=payable" icon={FileText} />
                <Balance label="قيمة المخزون" value={bal("inventory")} currency={currency} href="/inventory" icon={BookOpen} />
                <Balance label="قيود مسودة غير مرحّلة" count={draftCount} href="/journal?status=draft" icon={AlertTriangle} />
              </div>
            </Panel>
          </div>

          {/* 7) سلامة الربط المحاسبي */}
          <div id="reconciliation" className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
            <SectionHeader
              icon={ShieldCheck}
              title="سلامة الربط بين الأقسام والأستاذ العام"
              sub="كل حساب مراقبة يجب أن يساوي دفتره الفرعي تمامًا؛ أي فرق يظهر هنا فورًا"
              aside={
                <span className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold ${unreconciled.length ? "bg-red-50 text-red-700" : "bg-[#222831] text-[#FFD369]"}`}>
                  {unreconciled.length ? `${unreconciled.length} فرق` : "كل الحسابات متطابقة"}
                </span>
              }
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {reconRows.map((x) => {
                const meta = CONTROL_LABELS[x.control];
                const ok = x.diff.isZero();
                const rec = toMoney(x.reconciling_items);
                return (
                  <Link
                    key={x.control}
                    href={meta.href}
                    className={`group rounded-xl border p-3.5 transition-all hover:shadow-xs ${ok ? "border-[#E2E8F0] bg-[#F8FAF9] hover:border-[#FFD369] hover:bg-white" : "border-red-200 bg-red-50/60"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#0F172A]">{meta.title}</p>
                        <p className="mt-0.5 text-[10.5px] text-[#64748B]">{meta.sub}</p>
                      </div>
                      {ok ? <CheckCircle2 className="size-4 shrink-0 text-[#059669]" /> : <AlertTriangle className="size-4 shrink-0 text-red-600" />}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <p className="text-[#64748B]">{x.control === "trial_balance" ? "مجموع المدين" : "الأستاذ العام"}</p>
                        <p className="font-extrabold text-[#0F172A]"><Money value={x.gl_balance} locale="ar" /></p>
                      </div>
                      <div>
                        <p className="text-[#64748B]">{x.control === "trial_balance" ? "مجموع الدائن" : "الدفتر الفرعي"}</p>
                        <p className="font-extrabold text-[#0F172A]"><Money value={x.subledger_balance} locale="ar" /></p>
                      </div>
                    </div>
                    {!rec.isZero() && (
                      <p className="mt-2 text-[10.5px] text-[#64748B]">
                        بند مطابقة (مفوتر لم يُستلم): <Money value={rec} locale="ar" />
                      </p>
                    )}
                    {!ok && (
                      <p className="mt-2 text-[11px] font-extrabold text-red-700">
                        الفرق: <Money value={x.diff} locale="ar" /> {currency}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 8) وصول سريع */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Shortcut href="/reports/trial-balance" icon={Scale} title="ميزان المراجعة" sub="الأرصدة الافتتاحية والحركة والختامية" />
            <Shortcut href="/reports/balance-sheet" icon={FileText} title="قائمة المركز المالي" sub="الأصول والالتزامات وحقوق الملكية" />
            <Shortcut href="/reports/aging" icon={CreditCard} title="أعمار الذمم" sub="الذمم المدينة والدائنة حسب الاستحقاق" />
            <Shortcut href="/periods" icon={CalendarDays} title="الفترات والإقفال" sub="فتح وإقفال الفترات والسنة المالية" />
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// مكونات العرض
// =============================================================================
function SectionHeader({ icon: Icon, title, sub, aside }: { icon: typeof BedDouble; title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369]">
          <Icon className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>
          <p className="text-[11px] text-[#64748B]">{sub}</p>
        </div>
      </div>
      {aside}
    </div>
  );
}

function Panel({ icon, title, sub, children }: { icon: typeof BedDouble; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
      <SectionHeader icon={icon} title={title} sub={sub} />
      {children}
    </div>
  );
}

function KpiCard({
  label, value, currency, icon: Icon, foot, link, dark, tone,
}: {
  label: string;
  value: MoneyValue;
  currency: string;
  icon: typeof BedDouble;
  foot: React.ReactNode;
  link?: { href: string; label: string };
  dark?: boolean;
  tone?: "profit" | "loss";
}) {
  const valueColor = dark ? "text-white" : tone === "profit" ? "text-[#059669]" : tone === "loss" ? "text-[#D97706]" : "text-[#0F172A]";
  return (
    <div className={`group relative flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all hover:shadow-md ${
      dark ? "border-[#FFD369]/60 bg-gradient-to-br from-[#222831] to-[#1e242c] text-white hover:border-[#FFD369]" : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#FFD369]"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span className={`text-xs font-bold ${dark ? "text-[#FFD369]" : "text-[#64748B]"}`}>{label}</span>
          <div className={`text-2xl font-black tracking-tight ${valueColor}`}>
            <Money value={value} locale="ar" />
            <span className={`ms-1.5 text-xs font-bold ${dark ? "text-[#CBD5E1]" : "text-[#64748B]"}`}>{currency}</span>
          </div>
        </div>
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-xs transition-all duration-200 group-hover:scale-105 ${
          dark ? "bg-[#FFD369] text-[#222831] ring-2 ring-[#FFD369]/30" : "border border-[#393E46]/40 bg-[#222831] text-[#FFD369] group-hover:bg-[#FFD369] group-hover:text-[#222831]"
        }`}>
          <Icon className="size-5 stroke-[2.5]" />
        </div>
      </div>
      <div className={`mt-4 flex items-center justify-between gap-2 border-t pt-2.5 text-[11px] ${dark ? "border-white/10 text-[#CBD5E1]" : "border-[#E2E8F0] text-[#64748B]"}`}>
        <span className="min-w-0 truncate">{foot}</span>
        {link && (
          <Link href={link.href} className={`flex shrink-0 items-center gap-0.5 font-bold hover:underline ${dark ? "text-[#FFD369]" : "text-[#222831]"}`}>
            {link.label} <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: React.ReactNode; unit?: string; hint: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
      <span className="text-xs font-semibold text-[#64748B]">{label}</span>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-[#0F172A]">{value}</span>
        {unit && <span className="text-[11px] font-bold text-[#64748B]">{unit}</span>}
      </div>
      <p className="mt-1.5 text-[10.5px] text-[#64748B]">{hint}</p>
    </div>
  );
}

function Balance({
  label, value, count, currency, href, icon: Icon,
}: {
  label: string;
  value?: MoneyValue;
  count?: number;
  currency?: string;
  href: string;
  icon: typeof BedDouble;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 transition-all hover:border-[#FFD369] hover:bg-white hover:shadow-xs">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] transition-colors group-hover:bg-[#FFD369] group-hover:text-[#222831]">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-[#64748B]">{label}</p>
        <p className="text-base font-black text-[#0F172A]">
          {value !== undefined ? (
            <>
              <Money value={value ?? ZERO} locale="ar" />
              <span className="ms-1 text-[10.5px] font-bold text-[#64748B]">{currency}</span>
            </>
          ) : (
            <span className="num">{count ?? 0}</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function Shortcut({ href, icon: Icon, title, sub }: { href: string; icon: typeof BedDouble; title: string; sub: string }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-white p-3.5 transition-all hover:border-[#FFD369] hover:shadow-xs">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] transition-colors group-hover:bg-[#FFD369] group-hover:text-[#222831]">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#0F172A]">{title}</p>
        <p className="truncate text-[11px] text-[#64748B]">{sub}</p>
      </div>
    </Link>
  );
}
