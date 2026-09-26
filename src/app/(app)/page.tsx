import Link from "@/components/link";
import {
  AlertTriangle,
  ArrowUpLeft,
  BedDouble,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Coins,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { SearchPill } from "@/components/layout/top-bar";
import { CHART_COLORS } from "@/components/dashboard/chart-colors";
import {
  AnimatedNumber,
  DonutChart,
  IncomeExpenseChart,
  RoomTrendChart,
  StripedBars,
} from "@/components/dashboard/charts";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/accounting/aging";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { roomKpis } from "@/lib/accounting/kpi";
import { type Money as MoneyValue, ZERO, toMoney } from "@/lib/accounting/money";
import { summarizeProfitability } from "@/lib/accounting/profitability";
import type { LedgerControl } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getMonthlyPnl, getRoomStats } from "@/services/financial.service";
import { agingReport } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";

/**
 * لوحة التحكم — كل رقم محسوب من مصدره المحاسبي مباشرة:
 *  • الإيرادات والمصروفات وصافي النتيجة: القيود المرحّلة في الأستاذ العام (monthly_pnl)
 *  • النقدية: أرصدة حسابات الصندوق والعهدة والبنوك في الأستاذ (cash_balance)
 *  • الإشغال وADR وRevPAR: رسوم فئة «غرف» الفعّالة على الفوليو ÷ عدد الغرف (room_statistics + kpi.ts)
 *  • الذمم والودائع والمخزون: الدفاتر الفرعية، مع مطابقتها لحسابات المراقبة (ledger_reconciliation)
 *  • أعمار الذمم وحالة الفواتير: جدول الفواتير (aging_report)
 * لا توجد قيم افتراضية أو تقديرية؛ ما لا يمكن حسابه يُعرض «—» مع سببه.
 */

type Range = "today" | "7d" | "month" | "fy";
const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "7d", label: "آخر 7 أيام" },
  { key: "month", label: "هذا الشهر" },
  { key: "fy", label: "السنة المالية" },
];

const CONTROL_LABELS: Record<LedgerControl, { title: string; sub: string; href: string }> = {
  guest_ledger: { title: "ذمم النزلاء", sub: "الأستاذ ↔ أرصدة الفوليوهات", href: "/folios?status=open" },
  guest_deposits: { title: "ودائع النزلاء", sub: "الأستاذ ↔ ودائع الفوليو", href: "/folios" },
  accounts_receivable: { title: "الذمم المدينة", sub: "الأستاذ ↔ الفواتير − أرصدة العملاء الدائنة", href: "/reports/aging" },
  accounts_payable: { title: "الذمم الدائنة", sub: "الأستاذ ↔ فواتير الموردين", href: "/reports/aging?kind=payable" },
  inventory: { title: "المخزون", sub: "الأستاذ ↔ قيمة الأصناف + مفوتر لم يُستلم", href: "/inventory" },
  trial_balance: { title: "ميزان المراجعة", sub: "مجموع المدين ↔ مجموع الدائن", href: "/reports/trial-balance" },
};

const BUCKET_META: Record<AgingBucket, { label: string; color: string }> = {
  current: { label: "غير مستحقة بعد", color: "#12b76a" },
  "1_30": { label: "متأخرة 1–30 يومًا", color: "#2e90fa" },
  "31_60": { label: "متأخرة 31–60 يومًا", color: "#f7b928" },
  "61_90": { label: "متأخرة 61–90 يومًا", color: "#f0445a" },
  over_90: { label: "متأخرة أكثر من 90 يومًا", color: "#7a2ef0" },
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

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const { supabase, hotel } = ctx;
  const r = t.reports;
  const sp = await searchParams;
  const range: Range = RANGES.some((x) => x.key === sp.range) ? (sp.range as Range) : "month";

  const today = todayInTimeZone(hotel.timezone);
  const monthKey = today.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  // بداية السنة المالية الحالية حسب شهر البداية في إعدادات الفندق
  const fyMonth = hotel.fiscal_year_start_month ?? 1;
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const fyStart = `${tm >= fyMonth ? ty : ty - 1}-${String(fyMonth).padStart(2, "0")}-01`;
  const from = range === "today" ? today : range === "7d" ? addDays(today, -6) : range === "month" ? monthStart : fyStart;
  const rangeLabel = RANGES.find((x) => x.key === range)!.label;

  // آخر 6 أشهر بما فيها الحالي (الأشهر الخالية تظهر بصفر)
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const trendStart = `${months[0]}-01`;
  const roomsFrom = from < trendStart ? from : trendStart;

  const canFin = ctx.can(PERMISSIONS.financialView);
  const canProfit = ctx.can(PERMISSIONS.profitabilityView);
  const canAging = ctx.can(PERMISSIONS.agingView);
  const canInvoices = ctx.can(PERMISSIONS.invoicesView);
  const invoiceCount = (status: "issued" | "partially_paid" | "paid") =>
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", status);

  const [trend, rangePnl, roomDays, deptRows, departments, cash, drafts, openFolios, period, recon, aging, invIssued, invPartial, invPaid] =
    await Promise.all([
      canFin ? getMonthlyPnl(supabase, hotel.id, trendStart, today) : null,
      canFin ? getMonthlyPnl(supabase, hotel.id, from, today) : null,
      canFin ? getRoomStats(supabase, hotel.id, roomsFrom, today) : null,
      canProfit
        ? supabase.rpc("department_profitability", { p_hotel_id: hotel.id, p_from: from, p_to: today }).select("department_id, account_type, account_subtype, amount::text")
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
      canAging ? agingReport(supabase, hotel.id, "receivable", today) : null,
      canInvoices ? invoiceCount("issued") : null,
      canInvoices ? invoiceCount("partially_paid") : null,
      canInvoices ? invoiceCount("paid") : null,
    ]);
  // أي خطأ في مصدر بيانات يُظهر صفحة الخطأ بدل أرقام ناقصة مضللة
  for (const res of [deptRows, cash, drafts, openFolios, period, recon, invIssued, invPartial, invPaid]) raise(res?.error ?? null);

  const currency = currencySymbol(hotel.base_currency);

  // ---- الأداء المالي للفترة المختارة (الأستاذ العام) ----
  const sum = (rows: { revenue: string; expenses: string }[] | null, k: "revenue" | "expenses") =>
    (rows ?? []).reduce((s, x) => s.plus(toMoney(x[k])), ZERO);
  const revenue = sum(rangePnl, "revenue");
  const expenses = sum(rangePnl, "expenses");
  const net = revenue.minus(expenses);
  const cashBalance = toMoney((cash?.data as string | number | null | undefined) ?? 0);

  const pnlByMonth = new Map((trend ?? []).map((m) => [m.month.slice(0, 7), m]));
  const chartData = months.map((m) => ({
    month: m,
    revenue: toMoney(pnlByMonth.get(m)?.revenue ?? 0).toNumber(),
    expenses: toMoney(pnlByMonth.get(m)?.expenses ?? 0).toNumber(),
  }));

  // ---- الغرف ----
  const allDays = roomDays?.days ?? [];
  const rangeRooms = roomKpis(allDays.filter((d) => d.business_date >= from && d.business_date <= today));
  const roomTrend = months.map((m) => {
    const k = roomKpis(allDays.filter((d) => d.business_date.startsWith(m)));
    return { month: m, adr: k.adr?.toNumber() ?? null, revpar: k.revpar?.toNumber() ?? null, occupancy: k.occupancy?.toNumber() ?? null, nights: k.roomNightsSold.toNumber() };
  });
  const totalRooms = hotel.total_rooms ?? 0;

  // ---- الأقسام ----
  const deptName = new Map(departments.map((d) => [d.id, d.name_ar || d.name_en]));
  const deptSummary = deptRows?.data ? summarizeProfitability(deptRows.data as never).departments : [];
  const deptLabel = (id: string | null) => (id ? deptName.get(id) ?? "—" : t.profitability.unassigned);
  const deptSegments = deptSummary
    .filter((d) => d.revenue.gt(0))
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .map((d, i) => ({ label: deptLabel(d.departmentId), value: d.revenue.toNumber(), display: d.revenue.toFixed(2), color: CHART_COLORS.palette[i % CHART_COLORS.palette.length]! }));
  const negativeDepts = deptSummary.filter((d) => d.revenue.isNegative());

  // ---- المطابقة والأرصدة ----
  const reconRows = ((recon?.data ?? []) as unknown as {
    control: LedgerControl; gl_balance: string; subledger_balance: string; reconciling_items: string; difference: string;
  }[]).map((x) => ({ ...x, diff: toMoney(x.difference) }));
  const bal = (c: LedgerControl) => toMoney(reconRows.find((x) => x.control === c)?.subledger_balance ?? 0);
  const unreconciled = reconRows.filter((x) => !x.diff.isZero());

  // ---- أعمار الذمم ----
  const agingRows = AGING_BUCKETS.map((b) => {
    const docs = (aging ?? []).filter((x) => x.bucket === b);
    const amount = docs.reduce((s, x) => s.plus(toMoney(x.outstanding)), ZERO);
    return { label: BUCKET_META[b].label, color: BUCKET_META[b].color, count: docs.length, amount: amount.toNumber(), amountText: amount.toFixed(2) };
  });
  const agingTotal = (aging ?? []).reduce((s, x) => s.plus(toMoney(x.outstanding)), ZERO);

  // ---- تنبيهات تحتاج إجراء (حقيقية فقط) ----
  const draftCount = drafts?.count ?? 0;
  const alerts: { title: string; text: string; href: string; tone: "red" | "amber" | "blue" }[] = [];
  if (period && !period.data) alerts.push({ title: "لا توجد فترة محاسبية لليوم", text: "لن يُقبل ترحيل أي قيد بتاريخ اليوم.", href: "/periods", tone: "red" });
  else if (period?.data?.status === "closed") alerts.push({ title: "الفترة الحالية مقفلة", text: `${period.data.name} — الترحيل يتطلب صلاحية خاصة.`, href: "/periods", tone: "amber" });
  if (unreconciled.length > 0) alerts.push({ title: "فرق في المطابقة", text: `${unreconciled.length} من حسابات المراقبة لا تطابق دفاترها.`, href: "#reconciliation", tone: "red" });
  if (canFin && cashBalance.isNegative()) alerts.push({ title: "رصيد النقدية سالب", text: "راجع السندات والمدفوعات أو سجّل التمويل.", href: "/reports/daily-cash", tone: "red" });
  if (canFin && totalRooms <= 0) alerts.push({ title: "عدد الغرف غير محدد", text: "مطلوب لحساب الإشغال وRevPAR.", href: "/settings/hotel", tone: "amber" });
  if (draftCount > 0) alerts.push({ title: `${draftCount} قيد مسودة`, text: "لا تؤثر على الأرصدة حتى ترحيلها.", href: "/journal?status=draft", tone: "blue" });

  const quick = [
    ctx.can(PERMISSIONS.journalCreate) && { href: "/journal/new", label: "قيد يومية جديد", hint: "قيد يدوي متوازن بين المدين والدائن", icon: BookOpen, tone: "bg-[#e8f1fe]", iconTone: "text-brand-blue" },
    ctx.can(PERMISSIONS.folioManage) && { href: "/folios/new", label: "فتح فوليو", hint: "حساب نزيل أو مجموعة أو شركة", icon: BedDouble, tone: "bg-[#fdeee3]", iconTone: "text-brand-orange" },
    ctx.can(PERMISSIONS.paymentsReceipt) && { href: "/vouchers/new", label: "سند قبض / صرف", hint: "تحصيل من عميل أو دفع لمورد", icon: Coins, tone: "bg-[#e5f6ec]", iconTone: "text-brand-green" },
  ].filter(Boolean) as { href: string; label: string; hint: string; icon: typeof BookOpen; tone: string; iconTone: string }[];

  const invoiceSegments = [
    { label: "مصدرة", value: invIssued?.count ?? 0, color: CHART_COLORS.expenses },
    { label: "مدفوعة جزئيًا", value: invPartial?.count ?? 0, color: CHART_COLORS.revenue },
    { label: "مدفوعة", value: invPaid?.count ?? 0, color: CHART_COLORS.net },
  ];
  const invoiceTotal = invoiceSegments.reduce((s, x) => s + x.value, 0);

  const businessDate = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));
  const pct = (v: MoneyValue | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
  const ALERT_TONE = {
    red: { bg: "bg-[#fdecee]", icon: "text-brand-red" },
    amber: { bg: "bg-[#fdf3e1]", icon: "text-amber-600" },
    blue: { bg: "bg-[#e8f1fe]", icon: "text-brand-blue" },
  } as const;

  // إجماليات آخر 6 أشهر (لرأس المخطط) — من نفس صفوف الأستاذ
  const sixRevenue = (trend ?? []).reduce((a, m) => a.plus(toMoney(m.revenue)), ZERO);
  const sixExpenses = (trend ?? []).reduce((a, m) => a.plus(toMoney(m.expenses)), ZERO);
  const sixNet = sixRevenue.minus(sixExpenses);
  const rangeBadge = <span className="rounded-full bg-subtle px-2.5 py-1 text-[11px] text-slate-600">{rangeLabel}</span>;

  return (
    <div className="space-y-5 pb-4">
      {/* لافتة ملوّنة: العنوان والتاريخ والبحث */}
      <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-l from-[#fb8c2b] via-[#e8457a] to-[#2e90fa] px-6 py-7 text-white md:px-8">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-24 size-72 rounded-full bg-white/15" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 start-1/3 size-80 rounded-full bg-white/10" />
        <div aria-hidden className="bar-stripes pointer-events-none absolute inset-0 opacity-20" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[13px] text-white/85">{businessDate}</p>
            <h1 className="text-[32px] font-normal leading-tight tracking-tight">{t.dashboard.title}</h1>
            <p className="text-[13px] text-white/85">تابع أداء فندقك المالي لحظة بلحظة — كل رقم من القيود المرحّلة مباشرة</p>
          </div>
          <div className="w-full max-w-md space-y-3">
            <SearchPill className="border-white/40 bg-white/95 text-slate-500 hover:bg-white" />
            <nav className="flex items-center gap-1.5 overflow-x-auto lg:hidden">
              {RANGES.map((x) => (
                <Link key={x.key} href={x.key === "month" ? "/" : `/?range=${x.key}`}
                  className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px]", range === x.key ? "bg-white text-ink" : "bg-white/20 text-white hover:bg-white/30")}>
                  {x.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {!canFin && <Alert>{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* بطاقات المؤشرات */}
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={TrendingUp} label={`الإيرادات — ${rangeLabel}`} value={revenue} currency={currency} href="/reports/income-statement" color="#2e90fa" />
            <StatTile icon={TrendingDown} label={`المصروفات — ${rangeLabel}`} value={expenses} currency={currency} href="/reports/income-statement" color="#fb8c2b" />
            <StatTile icon={Scale} label={`صافي النتيجة — ${rangeLabel}`} value={net} currency={currency} href={canProfit ? "/reports/profitability" : "/reports/income-statement"}
              color={net.isNegative() ? "#f0445a" : "#12b76a"} valueClass={net.isNegative() ? "text-brand-red" : undefined} />
            <StatTile icon={Wallet} label="النقدية والبنوك الآن" value={cashBalance} currency={currency} href="/reports/daily-cash" color="#7a2ef0"
              valueClass={cashBalance.isNegative() ? "text-brand-red" : undefined} />
          </div>

          {/* الصف 1: الأداء المالي + مركز الإجراءات */}
          <div className="stagger grid gap-4 xl:grid-cols-12">
            <Panel className="xl:col-span-8" title="الإيراد مقابل المصروف — آخر 6 أشهر" accent="#2e90fa"
              action={{ href: "/reports/income-statement", icon: ArrowUpLeft, label: t.nav.incomeStatement }}>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Figure label="إجمالي الإيرادات" value={sixRevenue} currency={currency} color="#2e90fa" />
                <Figure label="إجمالي المصروفات" value={sixExpenses} currency={currency} color="#fb8c2b" />
                <Figure label="صافي النتيجة" value={sixNet} currency={currency} color={sixNet.isNegative() ? "#f0445a" : "#12b76a"} />
              </div>
              <IncomeExpenseChart data={chartData} currency={currency} labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }} />
            </Panel>

            <Panel className="xl:col-span-4" title="مركز الإجراءات" accent="#fb8c2b"
              badge={<span className={cn("rounded-full px-2.5 py-1 text-[11px]", alerts.length ? "bg-[#fdecee] text-brand-red" : "bg-[#e5f6ec] text-brand-green")}>
                {alerts.length ? `${alerts.length} تنبيه` : "لا تنبيهات"}</span>}>
              <div className="space-y-2">
                {alerts.length === 0 && (
                  <div className="flex items-center gap-3 rounded-2xl bg-[#e5f6ec] p-3.5">
                    <CheckCircle2 className="size-5 shrink-0 text-brand-green" />
                    <div>
                      <p className="text-[13px] font-medium text-ink">كل شيء على ما يرام</p>
                      <p className="text-[11px] text-slate-600">الفترة مفتوحة والدفاتر متطابقة.</p>
                    </div>
                  </div>
                )}
                {alerts.map((a) => (
                  <Link key={a.title} href={a.href} className={cn("group flex items-center gap-3 rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5", ALERT_TONE[a.tone].bg)}>
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-white", ALERT_TONE[a.tone].icon)}>
                      <AlertTriangle className="size-[17px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{a.title}</p>
                      <p className="truncate text-[11px] text-slate-600">{a.text}</p>
                    </div>
                    <ChevronLeft className="size-4 shrink-0 text-slate-400 transition-transform group-hover:-translate-x-0.5" />
                  </Link>
                ))}
              </div>
              {quick.length > 0 && (
                <>
                  <p className="mb-2 mt-5 text-[11px] text-slate-400">إجراءات سريعة</p>
                  <div className="grid grid-cols-3 gap-2">
                    {quick.map((q) => (
                      <Link key={q.href} href={q.href} className={cn("group flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition-all duration-200 hover:-translate-y-0.5", q.tone)}>
                        <span className={cn("flex size-10 items-center justify-center rounded-xl bg-white shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", q.iconTone)}>
                          <q.icon className="size-[18px]" />
                        </span>
                        <span className="text-[11.5px] leading-tight text-ink">{q.label}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* الصف 2: الفواتير + أعمار الذمم + الغرف */}
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="حالة الفواتير" accent="#12b76a" action={canInvoices ? { href: "/invoices", icon: ArrowUpLeft, label: t.nav.invoices } : undefined}>
              {canInvoices ? (
                <DonutChart segments={invoiceSegments} centerTitle="إجمالي الفواتير" centerValue={String(invoiceTotal)}
                  emptyTitle="لا توجد فواتير بعد" emptyHint="تظهر عند إصدار فاتورة من الفوليو أو فاتورة مباشرة." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Panel>

            <Panel title="أعمار الذمم المدينة" accent="#7a2ef0" action={canAging ? { href: "/reports/aging", icon: ArrowUpLeft, label: t.nav.aging } : undefined}
              badge={canAging ? <span className="num rounded-full bg-subtle px-2.5 py-1 text-[11px] text-ink">{agingTotal.toFixed(2)} {currency}</span> : undefined}>
              {canAging ? (
                <StripedBars rows={agingRows} currency={currency} emptyTitle="لا توجد ذمم مدينة قائمة" emptyHint="تظهر الفواتير الآجلة غير المسددة هنا حسب استحقاقها." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Panel>

            <Panel className="md:col-span-2 xl:col-span-1" title="مؤشرات الغرف" accent="#e8457a" badge={rangeBadge}
              action={{ href: "/reports/rooms", icon: ArrowUpLeft, label: t.nav.roomStats }}>
              <div className="grid grid-cols-2 gap-2.5">
                <Metric icon={BedDouble} color="#e8457a" label="نسبة الإشغال" value={pct(rangeRooms.occupancy)} />
                <Metric icon={TrendingUp} color="#2e90fa" label="ADR" value={rangeRooms.adr ? rangeRooms.adr.toFixed(2) : "—"} unit={rangeRooms.adr ? currency : undefined} />
                <Metric icon={Scale} color="#12b76a" label="RevPAR" value={rangeRooms.revpar ? rangeRooms.revpar.toFixed(2) : "—"} unit={rangeRooms.revpar ? currency : undefined} />
                <Metric icon={BookOpen} color="#fb8c2b" label="الليالي المباعة / المتاحة" value={`${rangeRooms.roomNightsSold.toString()} / ${rangeRooms.roomNightsAvailable.toString()}`} />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {totalRooms > 0 ? `${totalRooms} غرفة متاحة للبيع` : "حدّد عدد الغرف في إعدادات الفندق لحساب الإشغال"} — فوليوهات مفتوحة: <span className="num">{openFolios?.count ?? 0}</span>
              </p>
            </Panel>
          </div>

          {/* الصف 3: الأقسام + اتجاه الغرف + سلامة الربط */}
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="الإيرادات حسب القسم" accent="#2e90fa" badge={rangeBadge}
              action={canProfit ? { href: "/reports/profitability", icon: ArrowUpLeft, label: t.nav.profitability } : undefined}>
              {canProfit ? (
                <>
                  <DonutChart segments={deptSegments} centerTitle="إيراد الأقسام"
                    centerValue={deptSegments.reduce((a, x) => a.plus(toMoney(x.display)), ZERO).toFixed(2)}
                    emptyTitle="لا توجد إيرادات أقسام في الفترة" emptyHint="تُوزَّع الإيرادات حسب القسم المسجّل على رمز الإيراد أو بند القيد." />
                  <p className="mt-4 border-t border-line pt-3 text-[11px] text-muted-foreground">
                    إجمالي الإيراد في الأستاذ للفترة: <span className="num text-ink">{revenue.toFixed(2)}</span> {currency}
                    {negativeDepts.length > 0 && (
                      <span className="block text-amber-700">
                        تسويات صافية سالبة غير ممثلة في الدائرة: {negativeDepts.map((d) => `${deptLabel(d.departmentId)} (${d.revenue.toFixed(2)})`).join("، ")}
                      </span>
                    )}
                  </p>
                </>
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Panel>

            <Panel title="اتجاه ADR وRevPAR والإشغال" accent="#fb8c2b" action={{ href: "/reports/rooms", icon: ArrowUpLeft, label: t.nav.roomStats }}>
              <RoomTrendChart data={roomTrend} currency={currency} />
            </Panel>

            <Panel className="md:col-span-2 xl:col-span-1" id="reconciliation" title="سلامة الربط" accent="#12b76a"
              badge={<span className={cn("rounded-full px-2.5 py-1 text-[11px]", unreconciled.length ? "bg-[#fdecee] text-brand-red" : "bg-[#e5f6ec] text-brand-green")}>
                {unreconciled.length ? `${unreconciled.length} فرق` : "كل الدفاتر متطابقة"}</span>}>
              <div className="divide-y divide-line">
                {reconRows.map((x) => {
                  const meta = CONTROL_LABELS[x.control];
                  const ok = x.diff.isZero();
                  return (
                    <Link key={x.control} href={meta.href} className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", ok ? "bg-[#e5f6ec] text-brand-green" : "bg-[#fdecee] text-brand-red")}>
                        {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink transition-colors group-hover:text-brand-blue">{meta.title}</p>
                        {ok ? <p className="truncate text-[11px] text-muted-foreground">{meta.sub}</p>
                          : <p className="text-[11px] text-red-700">الفرق: <Money value={x.diff} locale="ar" /> {currency}</p>}
                      </div>
                      <span className="num shrink-0 text-[13px] text-ink"><Money value={x.subledger_balance} locale="ar" /></span>
                    </Link>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* الصف 4: الأرصدة المفتوحة */}
          <Panel title="الأرصدة المفتوحة الآن" accent="#7a2ef0" badge={<span className="text-[11px] text-muted-foreground">بـ {currency} — من الدفاتر الفرعية المطابَقة مع الأستاذ</span>}>
            <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <BalanceTile label="ذمم النزلاء" value={bal("guest_ledger")} href="/folios?status=open" color="#2e90fa" icon={BedDouble} />
              <BalanceTile label="ودائع النزلاء" value={bal("guest_deposits")} href="/folios" color="#7a2ef0" icon={Wallet} />
              <BalanceTile label="الذمم المدينة" value={bal("accounts_receivable")} href="/reports/aging" color="#12b76a" icon={TrendingUp} />
              <BalanceTile label="الذمم الدائنة" value={bal("accounts_payable")} href="/reports/aging?kind=payable" color="#fb8c2b" icon={TrendingDown} />
              <BalanceTile label="قيمة المخزون" value={bal("inventory")} href="/inventory" color="#e8457a" icon={Coins} />
              <BalanceTile label="قيود مسودة" count={draftCount} href="/journal?status=draft" color="#64748b" icon={BookOpen} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

// =============================================================================
// مكونات العرض
// =============================================================================
function Panel({
  title, action, badge, className, id, accent = "#2e90fa", children,
}: {
  title: string;
  action?: { href: string; icon: typeof BookOpen; label: string };
  badge?: React.ReactNode;
  className?: string;
  id?: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("surface p-5 transition-shadow duration-300 hover:shadow-[0_18px_40px_-28px_rgba(17,24,39,0.35)]", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-medium text-ink">
          <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: accent }} />
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {action && (
            <Link href={action.href} title={action.label} aria-label={action.label}
              className="flex size-9 items-center justify-center rounded-full border border-line bg-white text-slate-600 transition-all duration-200 hover:border-ink hover:bg-ink hover:text-white">
              <action.icon className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function StatTile({
  icon: Icon, label, value, currency, href, color, valueClass,
}: {
  icon: typeof BookOpen;
  label: string;
  value: MoneyValue;
  currency: string;
  href: string;
  color: string;
  valueClass?: string;
}) {
  return (
    <div className="surface group relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_16px_32px_-20px_rgba(17,24,39,0.35)]"
      style={{ backgroundImage: `linear-gradient(160deg, ${color}1f 0%, transparent 55%)` }}>
      <div className="flex items-center justify-between">
        <span className="flex size-11 items-center justify-center rounded-2xl text-white transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
          style={{ background: color, boxShadow: `0 10px 22px -10px ${color}` }}>
          <Icon className="size-5" />
        </span>
        <Link href={href} className="flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-[12px] text-slate-600 transition-colors hover:border-ink hover:bg-ink hover:text-white">
          التفاصيل <ChevronLeft className="size-3.5" />
        </Link>
      </div>
      <p className={cn("mt-5 text-[26px] font-normal leading-none tracking-tight text-ink", valueClass)}>
        <AnimatedNumber value={value.toNumber()} text={formatAmount(value)} />
        <span className="ms-1.5 text-[12px] text-slate-500">{currency}</span>
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** تنسيق مبلغ بمنزلتين كما في Money (للعدّاد المتحرك) */
function formatAmount(v: MoneyValue): string {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v.toFixed(2)));
}

/** رقم ملخص فوق المخطط */
function Figure({ label, value, currency, color }: { label: string; value: MoneyValue; currency: string; color: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </p>
      <p className="mt-1 truncate text-[17px] text-ink" style={value.isNegative() ? { color } : undefined}>
        <Money value={value} locale="ar" /> <span className="text-[11px] text-slate-400">{currency}</span>
      </p>
    </div>
  );
}

/** مؤشر صغير بأيقونة ملوّنة */
function Metric({ icon: Icon, color, label, value, unit }: { icon: typeof BookOpen; color: string; label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: `${color}1a`, color }}>
        <Icon className="size-4" />
      </span>
      <p className="mt-2.5 truncate text-[20px] leading-none text-ink">
        <span className="num">{value}</span>
        {unit && <span className="ms-1 text-[11px] text-slate-400">{unit}</span>}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BalanceTile({
  label, value, count, href, color, icon: Icon,
}: {
  label: string;
  value?: MoneyValue;
  count?: number;
  href: string;
  color: string;
  icon: typeof BookOpen;
}) {
  return (
    <Link href={href} className="group rounded-2xl border border-line bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-600">{label}</span>
        <span className="flex size-7 items-center justify-center rounded-lg transition-transform group-hover:scale-110" style={{ background: `${color}1a`, color }}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-2 truncate text-[18px] text-ink">
        {value !== undefined ? <Money value={value} locale="ar" /> : <span className="num">{count ?? 0}</span>}
      </p>
    </Link>
  );
}

function NoAccess({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-muted-foreground">{text}</p>;
}
