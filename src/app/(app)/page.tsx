import Link from "@/components/link";
import {
  AlertTriangle,
  ArrowUpLeft,
  BedDouble,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Coins,
  Plus,
  Scale,
  ShieldCheck,
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

  return (
    <div className="space-y-5 pb-4">
      {/* عنوان الصفحة + البحث */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] text-muted-foreground">تابع أداء فندقك المالي لحظة بلحظة — {businessDate}</p>
          <h1 className="text-[32px] font-normal leading-tight tracking-tight text-ink">{t.dashboard.title}</h1>
        </div>
        <SearchPill className="max-w-md" />
      </div>

      {/* مبدّل الفترة على الشاشات الصغيرة (على الكبيرة في رأس الصفحة) */}
      <nav className="flex max-w-full items-center gap-1.5 overflow-x-auto lg:hidden">
        {RANGES.map((x) => (
          <Link key={x.key} href={x.key === "month" ? "/" : `/?range=${x.key}`}
            className={cn("whitespace-nowrap rounded-full border px-4 py-2 text-[13px]", range === x.key ? "border-ink bg-ink text-white" : "border-line bg-white/70 text-slate-600")}>
            {x.label}
          </Link>
        ))}
      </nav>

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

          {/* الشبكة الرئيسية (بترتيب التصميم المرجعي) */}
          <div className="stagger grid gap-4 xl:grid-cols-12">
            {/* مركز الإجراءات (مثل «مهامي») */}
            <Panel className="xl:col-span-3" title="مركز الإجراءات" action={quick[0] ? { href: quick[0].href, icon: Plus, label: quick[0].label } : undefined}>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-white">التنبيهات <span className="num">{alerts.length}</span></span>
                <span className="rounded-full border border-line bg-white px-3 py-1.5 text-[12px] text-slate-600">إجراءات سريعة</span>
              </div>
              <div className="space-y-2.5">
                {alerts.length === 0 && (
                  <TaskCard tone="bg-[#e5f6ec]" icon={CheckCircle2} iconTone="text-brand-green" title="لا توجد تنبيهات" text="الفترة مفتوحة والدفاتر متطابقة." done />
                )}
                {alerts.map((a) => (
                  <TaskCard key={a.title} href={a.href} tone={ALERT_TONE[a.tone].bg} icon={AlertTriangle} iconTone={ALERT_TONE[a.tone].icon} title={a.title} text={a.text} />
                ))}
                {quick.map((q) => (
                  <TaskCard key={q.href} href={q.href} tone={q.tone} icon={q.icon} iconTone={q.iconTone} title={q.label} text={q.hint} />
                ))}
              </div>
            </Panel>

            {/* الوسط */}
            <div className="space-y-4 xl:col-span-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="حالة الفواتير" action={canInvoices ? { href: "/invoices", icon: ArrowUpLeft, label: "الفواتير" } : undefined}>
                  {canInvoices ? (
                    <DonutChart segments={invoiceSegments} centerTitle="إجمالي الفواتير" centerValue={String(invoiceTotal)}
                      emptyTitle="لا توجد فواتير بعد" emptyHint="تظهر عند إصدار فاتورة من الفوليو أو فاتورة مباشرة." />
                  ) : <NoAccess text={t.errors.permission_denied} />}
                </Panel>
                <Panel title="الإيراد مقابل المصروف" action={{ href: "/reports/income-statement", icon: ArrowUpLeft, label: t.nav.incomeStatement }}>
                  <IncomeExpenseChart data={chartData} currency={currency} labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }} />
                </Panel>
              </div>
              <Panel title="أعمار الذمم المدينة" action={canAging ? { href: "/reports/aging", icon: ArrowUpLeft, label: t.nav.aging } : undefined}
                badge={canAging ? <span className="num rounded-full border border-line bg-white px-3 py-1 text-[12px] text-ink">{agingTotal.toFixed(2)} {currency}</span> : undefined}>
                {canAging ? (
                  <StripedBars rows={agingRows} currency={currency} emptyTitle="لا توجد ذمم مدينة قائمة" emptyHint="تظهر الفواتير الآجلة غير المسددة هنا موزّعة حسب تاريخ استحقاقها." />
                ) : <NoAccess text={t.errors.permission_denied} />}
              </Panel>
              <Panel title="اتجاه ADR وRevPAR والإشغال" action={{ href: "/reports/rooms", icon: ArrowUpLeft, label: t.nav.roomStats }}>
                <RoomTrendChart data={roomTrend} currency={currency} />
              </Panel>
            </div>

            {/* العمود الأخير */}
            <div className="space-y-4 xl:col-span-3">
              <Panel title="مؤشرات الغرف" action={{ href: "/reports/rooms", icon: BedDouble, label: t.nav.roomStats }}>
                <div className="space-y-2.5">
                  <MeetingTile label={rangeLabel} title="نسبة الإشغال" value={pct(rangeRooms.occupancy)}
                    hint={totalRooms > 0 ? `${totalRooms} غرفة متاحة للبيع` : "حدّد عدد الغرف في الإعدادات"} href="/reports/rooms" />
                  <MeetingTile label={rangeLabel} title="متوسط سعر الغرفة ADR" value={rangeRooms.adr ? `${rangeRooms.adr.toFixed(2)} ${currency}` : "—"} hint="إيراد الغرف ÷ الليالي المباعة" href="/reports/rooms" />
                  <MeetingTile label={rangeLabel} title="RevPAR" value={rangeRooms.revpar ? `${rangeRooms.revpar.toFixed(2)} ${currency}` : "—"} hint="إيراد الغرف ÷ الليالي المتاحة" href="/reports/rooms" />
                </div>
                <Link href="/reports/rooms" className="mt-3 inline-flex items-center gap-1 text-[12px] text-slate-600 hover:text-ink">
                  الليالي المباعة <span className="num">{rangeRooms.roomNightsSold.toString()} / {rangeRooms.roomNightsAvailable.toString()}</span> — فوليوهات مفتوحة <span className="num">{openFolios?.count ?? 0}</span>
                  <ChevronLeft className="size-3.5" />
                </Link>
              </Panel>

              <Panel id="reconciliation" title="سلامة الربط" action={{ href: "/reports/trial-balance", icon: ShieldCheck, label: t.nav.trialBalance }}
                badge={<span className={cn("rounded-full px-2.5 py-1 text-[11px]", unreconciled.length ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700")}>
                  {unreconciled.length ? `${unreconciled.length} فرق` : "متطابقة"}</span>}>
                <div className="space-y-2.5">
                  {reconRows.map((x) => {
                    const meta = CONTROL_LABELS[x.control];
                    const ok = x.diff.isZero();
                    return (
                      <div key={x.control} className={cn("tile p-3", !ok && "border-red-200 bg-red-50")}>
                        <div className="flex items-start gap-2.5">
                          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", ok ? "bg-[#e5f6ec] text-brand-green" : "bg-red-100 text-brand-red")}>
                            {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-ink">{meta.title}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{meta.sub}</p>
                            {!ok && <p className="text-[11px] font-medium text-red-700">الفرق: <Money value={x.diff} locale="ar" /> {currency}</p>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between ps-10">
                          <Link href={meta.href} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-[11px] text-slate-700 transition-colors hover:bg-ink hover:text-white">
                            عرض <ChevronLeft className="size-3" />
                          </Link>
                          <span className="num text-[12px] text-ink"><Money value={x.subledger_balance} locale="ar" /></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </div>

          {/* الصف الثاني */}
          <div className="stagger grid gap-4 xl:grid-cols-12">
            <Panel className="xl:col-span-6" title="الإيرادات حسب القسم" action={canProfit ? { href: "/reports/profitability", icon: ArrowUpLeft, label: t.nav.profitability } : undefined}
              badge={<span className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-slate-600">{rangeLabel}</span>}>
              {canProfit ? (
                <>
                  <DonutChart segments={deptSegments} centerTitle="إيراد الأقسام"
                    centerValue={deptSegments.reduce((s, x) => s.plus(toMoney(x.display)), ZERO).toFixed(2)}
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



            <Panel className="xl:col-span-6" title="الأرصدة المفتوحة الآن">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <BalanceTile label="ذمم النزلاء" value={bal("guest_ledger")} href="/folios?status=open" dot="#2e90fa" />
                <BalanceTile label="ودائع النزلاء" value={bal("guest_deposits")} href="/folios" dot="#7a2ef0" />
                <BalanceTile label="الذمم المدينة" value={bal("accounts_receivable")} href="/reports/aging" dot="#12b76a" />
                <BalanceTile label="الذمم الدائنة" value={bal("accounts_payable")} href="/reports/aging?kind=payable" dot="#fb8c2b" />
                <BalanceTile label="قيمة المخزون" value={bal("inventory")} href="/inventory" dot="#f0445a" />
                <BalanceTile label="قيود مسودة" count={draftCount} href="/journal?status=draft" dot="#94a3b8" />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">المبالغ بـ {currency} — من الدفاتر الفرعية المطابَقة مع الأستاذ العام.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// مكونات العرض
// =============================================================================
function Panel({
  title, action, badge, className, id, children,
}: {
  title: string;
  action?: { href: string; icon: typeof BookOpen; label: string };
  badge?: React.ReactNode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("surface p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-[15px] font-medium text-ink">{title}</h2>
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
    <div className="surface group p-5 transition-colors duration-200 hover:border-line-strong">
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-full border border-line bg-white" style={{ color }}>
          <Icon className="size-[18px]" />
        </span>
        <Link href={href} className="flex items-center gap-1 text-[12px] text-slate-500 transition-colors hover:text-ink">
          التفاصيل <ChevronLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
        </Link>
      </div>
      <p className={cn("mt-4 text-[26px] font-normal leading-none tracking-tight text-ink", valueClass)}>
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

/** بطاقة باستيل (مثل بطاقات «مهامي» في التصميم المرجعي) */
function TaskCard({
  href, tone, icon: Icon, iconTone, title, text, done,
}: {
  href?: string;
  tone: string;
  icon: typeof BookOpen;
  iconTone: string;
  title: string;
  text: string;
  done?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex size-9 items-center justify-center rounded-xl bg-white shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", iconTone)}>
          <Icon className="size-[18px]" />
        </span>
        {done ? <CheckCircle2 className="size-5 text-brand-green" /> : <Circle className="size-5 text-slate-400 transition-colors group-hover:text-ink" />}
      </div>
      <p className="mt-2.5 text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{text}</p>
    </>
  );
  const cls = cn("group block rounded-2xl p-3.5 transition-transform duration-300 hover:-translate-y-0.5", tone);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** بطاقة بيضاء صغيرة (مثل «اجتماعاتي») */
function MeetingTile({ label, title, value, hint, href }: { label: string; title: string; value: string; hint: string; href: string }) {
  return (
    <Link href={href} className="tile group flex items-center gap-3 p-3 transition-colors hover:border-line-strong">
      <div className="w-16 shrink-0 text-[11px] leading-tight text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{title}</p>
        <p className="num truncate text-[15px] text-ink">{value}</p>
        <p className="truncate text-[10.5px] text-slate-400">{hint}</p>
      </div>
      <ArrowUpLeft className="size-4 shrink-0 text-slate-400 transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
    </Link>
  );
}

function BalanceTile({ label, value, count, href, dot }: { label: string; value?: MoneyValue; count?: number; href: string; dot: string }) {
  return (
    <Link href={href} className="tile group p-3 transition-colors hover:border-line-strong">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
        <span className="size-2 rounded-full" style={{ background: dot }} />
        {label}
      </p>
      <p className="mt-1 text-[16px] text-ink">
        {value !== undefined ? <Money value={value} locale="ar" /> : <span className="num">{count ?? 0}</span>}
      </p>
    </Link>
  );
}

function NoAccess({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-muted-foreground">{text}</p>;
}
