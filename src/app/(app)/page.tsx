import Link from "@/components/link";
import {
  AlertTriangle,
  ArrowUpLeft,
  BedDouble,
  BookOpen,
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
  current: { label: "غير مستحقة بعد", color: "#16a34a" },
  "1_30": { label: "متأخرة 1–30 يومًا", color: "#2f7cf6" },
  "31_60": { label: "متأخرة 31–60 يومًا", color: "#f5b82e" },
  "61_90": { label: "متأخرة 61–90 يومًا", color: "#f7931e" },
  over_90: { label: "متأخرة أكثر من 90 يومًا", color: "#ef4444" },
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
    ctx.can(PERMISSIONS.journalCreate) && { href: "/journal/new", label: "قيد يومية جديد", hint: "قيد يدوي متوازن", icon: BookOpen, tone: "bg-[#eaf2ff]" },
    ctx.can(PERMISSIONS.folioManage) && { href: "/folios/new", label: "فتح فوليو", hint: "نزيل أو مجموعة أو شركة", icon: BedDouble, tone: "bg-[#fff1e6]" },
    ctx.can(PERMISSIONS.paymentsReceipt) && { href: "/vouchers/new", label: "سند قبض / صرف", hint: "تحصيل أو دفع", icon: Coins, tone: "bg-[#e8f7ee]" },
  ].filter(Boolean) as { href: string; label: string; hint: string; icon: typeof BookOpen; tone: string }[];

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

  return (
    <div className="space-y-6 pb-4">
      {/* ترويسة الصفحة + اختيار الفترة */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-rise space-y-1">
          <p className="text-[13px] text-muted-foreground">{businessDate} — تابع أداء فندقك المالي لحظة بلحظة</p>
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-ink">{t.dashboard.title}</h1>
        </div>
        <nav className="animate-rise flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/90 bg-white/60 p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]" style={{ animationDelay: "0.08s" }}>
          {RANGES.map((x) => (
            <Link
              key={x.key}
              href={x.key === "month" ? "/" : `/?range=${x.key}`}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-2 text-[13px] transition-all duration-300",
                range === x.key ? "bg-ink text-white shadow-[0_8px_18px_-8px_rgba(14,17,22,0.7)]" : "text-slate-600 hover:bg-white hover:text-ink",
              )}
            >
              {x.label}
            </Link>
          ))}
          <Link href="/reports/income-statement" className="whitespace-nowrap rounded-full px-4 py-2 text-[13px] text-slate-600 transition-all hover:bg-white hover:text-ink">
            التقارير
          </Link>
        </nav>
      </div>

      {!canFin && <Alert>{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* بطاقات المؤشرات */}
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={TrendingUp} label={`الإيرادات — ${rangeLabel}`} value={revenue} currency={currency} href="/reports/income-statement" accent="#2f7cf6" />
            <StatTile icon={TrendingDown} label={`المصروفات — ${rangeLabel}`} value={expenses} currency={currency} href="/reports/income-statement" accent="#f7931e" />
            <StatTile icon={Scale} label={`صافي النتيجة — ${rangeLabel}`} value={net} currency={currency} href={canProfit ? "/reports/profitability" : "/reports/income-statement"}
              accent={net.isNegative() ? "#ef4444" : "#16a34a"} valueClass={net.isNegative() ? "text-brand-red" : "text-brand-green"} />
            <StatTile icon={Wallet} label="النقدية والبنوك (الآن)" value={cashBalance} currency={currency} href="/reports/daily-cash" accent="#7c3aed"
              valueClass={cashBalance.isNegative() ? "text-brand-red" : undefined} />
          </div>

          {/* الشبكة الرئيسية */}
          <div className="stagger grid gap-5 xl:grid-cols-12">
            {/* مركز الإجراءات */}
            <Panel className="xl:col-span-3 xl:self-start" title="مركز الإجراءات" icon={PlusCircle}>
              <div className="space-y-3">
                {alerts.length === 0 && (
                  <div className="flex items-start gap-3 rounded-3xl bg-[#e8f7ee] p-4">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-green" />
                    <div>
                      <p className="text-[13px] font-medium text-ink">لا توجد تنبيهات</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">الفترة مفتوحة والدفاتر متطابقة.</p>
                    </div>
                  </div>
                )}
                {alerts.map((a) => (
                  <Link
                    key={a.title}
                    href={a.href}
                    className={cn(
                      "group flex items-start gap-3 rounded-3xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-14px_rgba(15,23,42,0.35)]",
                      a.tone === "red" ? "bg-[#fdecec]" : a.tone === "amber" ? "bg-[#fff4e0]" : "bg-[#eaf2ff]",
                    )}
                  >
                    <AlertTriangle className={cn("mt-0.5 size-5 shrink-0", a.tone === "red" ? "text-brand-red" : a.tone === "amber" ? "text-amber-600" : "text-brand-blue")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{a.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{a.text}</p>
                    </div>
                    <ArrowUpLeft className="size-4 shrink-0 text-slate-400 transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                ))}
                {quick.length > 0 && <p className="px-1 pt-2 text-[11px] text-slate-400">إجراءات سريعة</p>}
                {quick.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    className={cn("group flex items-center gap-3 rounded-3xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-14px_rgba(15,23,42,0.35)]", q.tone)}
                  >
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-white text-ink shadow-sm transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110">
                      <q.icon className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{q.label}</p>
                      <p className="text-[11px] text-slate-600">{q.hint}</p>
                    </div>
                    <PlusCircle className="size-4 text-slate-400" />
                  </Link>
                ))}
              </div>
            </Panel>
            {/* الوسط: الاتجاه المالي + أعمار الذمم + مؤشرات الغرف الشهرية */}
            <div className="space-y-5 xl:col-span-6">

            {/* الإيرادات مقابل المصروفات */}
            <Panel title="الإيراد مقابل المصروف" icon={TrendingUp} href="/reports/income-statement">
              <IncomeExpenseChart data={chartData} currency={currency} labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }} />
            </Panel>

            {/* أعمار الذمم المدينة */}
            <Panel title="أعمار الذمم المدينة (فواتير قائمة)" icon={CreditCard} href={canAging ? "/reports/aging" : undefined}
              badge={canAging ? <span className="num rounded-full bg-white px-3 py-1 text-[12px] text-ink shadow-sm">{agingTotal.toFixed(2)} {currency}</span> : undefined}>
              {canAging ? (
                <StripedBars rows={agingRows} currency={currency} emptyTitle="لا توجد ذمم مدينة قائمة" emptyHint="تظهر الفواتير الآجلة غير المسددة هنا موزّعة حسب تاريخ استحقاقها." />
              ) : (
                <NoAccess text={t.errors.permission_denied} />
              )}
            </Panel>

            <Panel title="اتجاه ADR وRevPAR والإشغال" icon={BedDouble} href="/reports/rooms">
              <RoomTrendChart data={roomTrend} currency={currency} />
            </Panel>
            </div>

            {/* مؤشرات الغرف + سلامة الربط */}
            <div className="space-y-5 xl:col-span-3">
              <Panel title="مؤشرات الغرف" badge={<span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-slate-600 shadow-sm">{rangeLabel}</span>} icon={BedDouble} href="/reports/rooms">
                <div className="space-y-2.5">
                  <MiniStat label="نسبة الإشغال" value={pct(rangeRooms.occupancy)} hint={totalRooms > 0 ? `${totalRooms} غرفة متاحة للبيع` : "حدّد عدد الغرف في الإعدادات"} />
                  <MiniStat label="متوسط سعر الغرفة ADR" value={rangeRooms.adr ? rangeRooms.adr.toFixed(2) : "—"} unit={rangeRooms.adr ? currency : undefined} hint="إيراد الغرف ÷ الليالي المباعة" />
                  <MiniStat label="RevPAR" value={rangeRooms.revpar ? rangeRooms.revpar.toFixed(2) : "—"} unit={rangeRooms.revpar ? currency : undefined} hint="إيراد الغرف ÷ الليالي المتاحة" />
                  <MiniStat label="الليالي المباعة / المتاحة" value={`${rangeRooms.roomNightsSold.toString()} / ${rangeRooms.roomNightsAvailable.toString()}`}
                    hint={`فوليوهات مفتوحة: ${openFolios?.count ?? 0}`} />
                </div>
              </Panel>

              <Panel title="سلامة الربط" icon={ShieldCheck} id="reconciliation"
                badge={unreconciled.length ? <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] text-red-700">{unreconciled.length} فرق</span>
                  : <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] text-green-700">متطابقة</span>}>
                <div className="space-y-2">
                  {reconRows.map((x) => {
                    const meta = CONTROL_LABELS[x.control];
                    const ok = x.diff.isZero();
                    return (
                      <Link key={x.control} href={meta.href}
                        className={cn("group flex items-center gap-3 rounded-2xl border p-3 transition-all duration-300 hover:-translate-y-0.5",
                          ok ? "border-white bg-white/70 hover:bg-white" : "border-red-200 bg-red-50/80")}>
                        {ok ? <CheckCircle2 className="size-[18px] shrink-0 text-brand-green" /> : <AlertTriangle className="size-[18px] shrink-0 text-brand-red" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink">{meta.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{meta.sub}</p>
                          {!ok && <p className="mt-0.5 text-[11px] font-medium text-red-700">الفرق: <Money value={x.diff} locale="ar" /> {currency}</p>}
                        </div>
                        <span className="num shrink-0 text-[12px] font-medium text-ink"><Money value={x.subledger_balance} locale="ar" /></span>
                      </Link>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </div>

          {/* الصف الثاني */}
          <div className="stagger grid gap-5 xl:grid-cols-12">

            {/* حالة الفواتير */}
            <Panel className="xl:col-span-4" title="حالة الفواتير" icon={FileText} href={canInvoices ? "/invoices" : undefined}>
              {canInvoices ? (
                <DonutChart
                  segments={invoiceSegments}
                  centerTitle="إجمالي الفواتير"
                  centerValue={String(invoiceTotal)}
                  emptyTitle="لا توجد فواتير بعد"
                  emptyHint="تظهر هنا عند إصدار فاتورة من الفوليو أو فاتورة مباشرة."
                />
              ) : (
                <NoAccess text={t.errors.permission_denied} />
              )}
            </Panel>
            <Panel className="xl:col-span-4" title="الإيرادات حسب القسم" badge={<span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-slate-600 shadow-sm">{rangeLabel}</span>} icon={TrendingUp} href={canProfit ? "/reports/profitability" : undefined}>
              {canProfit ? (
                <>
                  <DonutChart
                    segments={deptSegments}
                    centerTitle="إيراد الأقسام"
                    centerValue={deptSegments.reduce((s, x) => s.plus(toMoney(x.display)), ZERO).toFixed(2)}
                    emptyTitle="لا توجد إيرادات أقسام في الفترة"
                    emptyHint="تُوزَّع الإيرادات حسب القسم المسجّل على رمز الإيراد أو بند القيد."
                  />
                  <p className="mt-4 border-t border-line pt-3 text-[11px] text-muted-foreground">
                    إجمالي الإيراد في الأستاذ للفترة: <span className="num font-medium text-ink">{revenue.toFixed(2)}</span> {currency}
                    {negativeDepts.length > 0 && (
                      <span className="block text-amber-700">
                        تسويات صافية سالبة غير ممثلة في الدائرة: {negativeDepts.map((d) => `${deptLabel(d.departmentId)} (${d.revenue.toFixed(2)})`).join("، ")}
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <NoAccess text={t.errors.permission_denied} />
              )}
            </Panel>

            <Panel className="xl:col-span-4" title="الأرصدة المفتوحة الآن" icon={Wallet}>
              <div className="grid grid-cols-2 gap-2.5">
                <BalanceTile label="ذمم النزلاء" value={bal("guest_ledger")} href="/folios?status=open" tone="bg-[#eaf2ff]" />
                <BalanceTile label="ودائع النزلاء" value={bal("guest_deposits")} href="/folios" tone="bg-[#f1eafe]" />
                <BalanceTile label="الذمم المدينة" value={bal("accounts_receivable")} href="/reports/aging" tone="bg-[#e8f7ee]" />
                <BalanceTile label="الذمم الدائنة" value={bal("accounts_payable")} href="/reports/aging?kind=payable" tone="bg-[#fff1e6]" />
                <BalanceTile label="قيمة المخزون" value={bal("inventory")} href="/inventory" tone="bg-[#fdebf3]" />
                <BalanceTile label="قيود مسودة" count={draftCount} href="/journal?status=draft" tone="bg-subtle" />
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
  title, icon: Icon, href, badge, className, id, children,
}: {
  title: string;
  icon: typeof BookOpen;
  href?: string;
  badge?: React.ReactNode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("glass-card rounded-[28px] p-5 transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_22px_48px_-24px_rgba(15,23,42,0.3)]", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[16px] font-semibold text-ink">
          <Icon className="size-[18px] text-slate-400" />
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {badge}
          {href && (
            <Link href={href} aria-label={title}
              className="flex size-9 items-center justify-center rounded-full border border-line bg-white/80 text-slate-600 transition-all duration-300 hover:rotate-[-45deg] hover:bg-ink hover:text-white">
              <ArrowUpLeft className="size-4" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function StatTile({
  icon: Icon, label, value, currency, href, accent, valueClass,
}: {
  icon: typeof BookOpen;
  label: string;
  value: MoneyValue;
  currency: string;
  href: string;
  accent: string;
  valueClass?: string;
}) {
  return (
    <Link href={href} className="glass-card group relative overflow-hidden rounded-[28px] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-24px_rgba(15,23,42,0.35)]">
      <div className="pointer-events-none absolute -end-10 -top-10 size-32 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40" style={{ background: accent }} />
      <div className="flex items-center justify-between">
        <span className="flex size-11 items-center justify-center rounded-2xl text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-6deg]" style={{ background: accent }}>
          <Icon className="size-5" />
        </span>
        <span className="flex items-center gap-1 text-[12px] text-slate-500 transition-colors group-hover:text-ink">
          التفاصيل <ArrowUpLeft className="size-3.5" />
        </span>
      </div>
      <p className={cn("mt-5 text-[26px] font-semibold leading-none tracking-tight text-ink", valueClass)}>
        <AnimatedNumber value={value.toNumber()} text={formatAmount(value)} />
        <span className="ms-1.5 text-[13px] font-normal text-slate-500">{currency}</span>
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground">{label}</p>
    </Link>
  );
}

/** تنسيق مبلغ بمنزلتين كما في Money (للعدّاد المتحرك) */
function formatAmount(v: MoneyValue): string {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v.toFixed(2)));
}

function MiniStat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white bg-white/70 p-3 transition-colors hover:bg-white">
      <div className="min-w-0">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
      </div>
      <p className="shrink-0 text-[17px] font-semibold text-ink">
        <span className="num">{value}</span>
        {unit && <span className="ms-1 text-[11px] font-normal text-slate-500">{unit}</span>}
      </p>
    </div>
  );
}

function BalanceTile({ label, value, count, href, tone }: { label: string; value?: MoneyValue; count?: number; href: string; tone: string }) {
  return (
    <Link href={href} className={cn("group rounded-2xl p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-12px_rgba(15,23,42,0.3)]", tone)}>
      <p className="text-[11px] text-slate-600">{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-ink">
        {value !== undefined ? <Money value={value} locale="ar" /> : <span className="num">{count ?? 0}</span>}
      </p>
    </Link>
  );
}

function NoAccess({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-muted-foreground">{text}</p>;
}
