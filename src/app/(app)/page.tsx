import { redirect } from "next/navigation";
import Link from "@/components/link";
import { CHART_COLORS } from "@/components/dashboard/chart-colors";
import {
  AnimatedNumber,
  DonutChart,
  IncomeExpenseChart,
  Sparkline,
  StripedBars,
} from "@/components/dashboard/charts";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/layout/page-header";
import { CurrencyTag } from "@/components/ui/currency-tag";
import { Scale, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RecentEntries } from "@/components/dashboard/recent-entries";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { requireAppContext } from "@/lib/auth/context";
import { DASHBOARD_PERMISSIONS, allowed, navGroups } from "@/components/layout/nav-config";
import { EmptyState } from "@/components/ui/empty-state";
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
  current: { label: "غير مستحقة بعد", color: CHART_COLORS.paid },
  "1_30": { label: "متأخرة من 1 إلى 30 يومًا", color: CHART_COLORS.overdue[0] },
  "31_60": { label: "متأخرة من 31 إلى 60 يومًا", color: CHART_COLORS.overdue[1] },
  "61_90": { label: "متأخرة من 61 إلى 90 يومًا", color: CHART_COLORS.overdue[2] },
  over_90: { label: "متأخرة أكثر من 90 يومًا", color: CHART_COLORS.overdue[3] },
};


const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; home?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const sp = await searchParams;
  // الصفحة الأولى: بعد الدخول تُفتح صفحة الموظف المحددة له، ومن لا تخصه اللوحة يذهب لأول صفحة مسموحة له
  const modules = ctx.hotel.enabled_modules ?? ["accounting", "pms"];
  const pages = navGroups(t.nav, { modules, permissions: [...ctx.permissions] }).flatMap((g) => g.items.map((i) => i.href));
  const dashboard = modules.includes("accounting") && allowed(DASHBOARD_PERMISSIONS, ctx.permissions);
  const home = ctx.ui.home_path && ctx.ui.home_path !== "/" && pages.includes(ctx.ui.home_path) ? ctx.ui.home_path : null;
  if (sp.home && home) redirect(home);
  if (!dashboard) {
    const first = home ?? pages.find((h) => h !== "/");
    if (first) redirect(first);
    return <EmptyState title="لا توجد صفحات متاحة لحسابك" description="اطلب من مدير النظام منحك صلاحيات العمل." />;
  }
  const show = (section: string) => !ctx.ui.dashboard_hidden.includes(section);
  const { supabase, hotel } = ctx;
  const r = t.reports;
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

  const canFin = ctx.can(PERMISSIONS.financialView);
  const canProfit = ctx.can(PERMISSIONS.profitabilityView);
  const canAging = ctx.can(PERMISSIONS.agingView);
  const canInvoices = ctx.can(PERMISSIONS.invoicesView);
  const invoiceCount = (status: "issued" | "partially_paid" | "paid") =>
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", status);

  const [trend, rangePnl, roomDays, deptRows, departments, cash, drafts, recent, openFolios, period, recon, aging, invIssued, invPartial, invPaid] =
    await Promise.all([
      canFin ? getMonthlyPnl(supabase, hotel.id, trendStart, today) : null,
      canFin ? getMonthlyPnl(supabase, hotel.id, from, today) : null,
      canFin ? getRoomStats(supabase, hotel.id, from, today) : null,
      canProfit
        ? supabase.rpc("department_profitability", { p_hotel_id: hotel.id, p_from: from, p_to: today }).select("department_id, account_type, account_subtype, amount::text")
        : null,
      listDepartments(supabase, hotel.id),
      canFin ? supabase.rpc("cash_balance", { p_hotel_id: hotel.id, p_as_of: today }) : null,
      ctx.can(PERMISSIONS.journalView)
        ? supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", "draft")
        : null,
      ctx.can(PERMISSIONS.journalView)
        ? supabase.from("journal_entries").select("id, entry_number, entry_date, description, source")
            .eq("hotel_id", hotel.id).eq("status", "posted")
            .order("entry_date", { ascending: false }).order("entry_number", { ascending: false }).limit(7)
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
  for (const res of [deptRows, cash, drafts, recent, openFolios, period, recon, invIssued, invPartial, invPaid]) raise(res?.error ?? null);

  const currency = hotel.base_currency;

  // آخر القيود المرحّلة مع إجمالي كل قيد بالعملة الأساسية
  const recentEntries = (recent?.data ?? []) as { id: string; entry_number: string | null; entry_date: string; description: string; source: string }[];
  const recentTotals = recentEntries.length
    ? await supabase.from("journal_entry_totals").select("journal_entry_id, base_total_debit::text").in("journal_entry_id", recentEntries.map((e) => e.id))
    : null;
  raise(recentTotals?.error ?? null);
  const recentTotal = new Map(((recentTotals?.data ?? []) as { journal_entry_id: string; base_total_debit: string }[]).map((x) => [x.journal_entry_id, x.base_total_debit]));

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
  const rangeRooms = roomKpis(allDays);
  const totalRooms = hotel.total_rooms ?? 0;

  // ---- الأقسام ----
  const deptName = new Map(departments.map((d) => [d.id, d.name_ar || d.name_en]));
  const deptSummary = deptRows?.data ? summarizeProfitability(deptRows.data as never).departments : [];
  const deptLabel = (id: string | null) => (id ? deptName.get(id) ?? "" : t.profitability.unassigned);
  const deptSegments = deptSummary
    .filter((d) => d.revenue.gt(0))
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .map((d) => ({ label: deptLabel(d.departmentId), value: d.revenue.toNumber(), display: formatAmount(d.revenue) }));
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
    return { label: BUCKET_META[b].label, color: BUCKET_META[b].color, count: docs.length, amount: amount.toNumber(), amountText: formatAmount(amount) };
  });
  const agingTotal = (aging ?? []).reduce((s, x) => s.plus(toMoney(x.outstanding)), ZERO);

  // ---- تنبيهات تحتاج إجراء (حقيقية فقط) ----
  const draftCount = drafts?.count ?? 0;
  const alerts: { title: string; text: string; href: string; tone: "red" | "amber" | "blue" }[] = [];
  if (period && !period.data) alerts.push({ title: "لا توجد فترة محاسبية لليوم", text: "لن يُقبل ترحيل أي قيد بتاريخ اليوم.", href: "/periods", tone: "red" });
  else if (period?.data?.status === "closed") alerts.push({ title: "الفترة الحالية مقفلة", text: `${period.data.name}، الترحيل يتطلب صلاحية خاصة.`, href: "/periods", tone: "amber" });
  if (unreconciled.length > 0) alerts.push({ title: "فرق في المطابقة", text: `${unreconciled.length} من حسابات المراقبة لا تطابق دفاترها.`, href: show("controls") ? "#reconciliation" : "/reports/trial-balance", tone: "red" });
  if (canFin && cashBalance.isNegative()) alerts.push({ title: "رصيد النقدية سالب", text: "راجع السندات والمدفوعات أو سجّل التمويل.", href: "/reports/daily-cash", tone: "red" });
  if (canFin && totalRooms <= 0) alerts.push({ title: "عدد الغرف غير محدد", text: "مطلوب لحساب الإشغال وRevPAR.", href: "/settings/hotel", tone: "amber" });
  if (draftCount > 0) alerts.push({ title: `${draftCount} قيد مسودة`, text: "لا تؤثر على الأرصدة حتى ترحيلها.", href: "/journal?status=draft", tone: "blue" });

  const invoiceSegments = [
    { label: "مصدرة", value: invIssued?.count ?? 0, color: CHART_COLORS.pending },
    { label: "مدفوعة جزئيًا", value: invPartial?.count ?? 0, color: CHART_COLORS.partial },
    { label: "مدفوعة", value: invPaid?.count ?? 0, color: CHART_COLORS.paid },
  ];
  const invoiceTotal = invoiceSegments.reduce((s, x) => s + x.value, 0);

  const pct = (v: MoneyValue | null) => (v === null ? "" : `${v.toFixed(1)}%`);

  const deptTotal = deptSummary.filter((d) => d.revenue.gt(0)).reduce((a2, d) => a2.plus(d.revenue), ZERO);
  const BALANCE_ROWS: { control: LedgerControl; label: string }[] = [
    { control: "guest_ledger", label: "ذمم النزلاء المقيمين" },
    { control: "guest_deposits", label: "ودائع النزلاء" },
    { control: "accounts_receivable", label: "الذمم المدينة" },
    { control: "accounts_payable", label: "الذمم الدائنة" },
    { control: "inventory", label: "المخزون" },
  ];

  return (
    <div className="space-y-6 pb-6">
      {/* العنوان + الإجراء الأساسي الوحيد + الإجراءات الثانوية */}
      <PageHeader title={t.dashboard.title} />

      {/* الفترة: تبويب واحد نشط بمؤشر منزلق */}
      <FilterTabs active={range} items={RANGES.map((x) => ({ key: x.key, href: x.key === "month" ? "/" : `/?range=${x.key}`, label: x.label }))} />

      {/* تنبيهات (تظهر فقط عند وجود ما يستدعي إجراءً) */}
      {alerts.length > 0 && (
        <section className="surface px-6 py-2">
          {alerts.map((a) => (
            <Link key={a.title} href={a.href} className="group flex items-center gap-3 py-2.5">
              <Badge variant={a.tone === "red" ? "destructive" : a.tone === "amber" ? "warning" : "info"}>{a.tone === "red" ? "عاجل" : a.tone === "amber" ? "تنبيه" : "للعلم"}</Badge>
              <span className="text-[16.5px] font-medium text-ink transition-colors group-hover:text-action">{a.title}</span>
              <span className="hidden text-[16.5px] text-muted-foreground sm:inline">{a.text}</span>
            </Link>
          ))}
        </section>
      )}

      {!canFin && <Alert>{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* شريط الأرقام الرئيسية: بطاقة واحدة مقسّمة */}
          {(show("kpis") || show("cash")) && <section className={cn("stat-grid grid grid-cols-2 gap-3 sm:gap-5", show("kpis") && show("cash") ? "xl:grid-cols-4" : show("kpis") ? "xl:grid-cols-3" : "xl:grid-cols-4")}>
            {show("kpis") && <>
            <Kpi icon={TrendingUp} label="الإيرادات" sub={rangeLabel} value={revenue} currency={currency} href="/reports/income-statement"
              spark={{ values: chartData.map((d) => d.revenue), months, color: CHART_COLORS.revenue }} />
            <Kpi icon={TrendingDown} label="المصروفات" sub={rangeLabel} value={expenses} currency={currency} href="/reports/income-statement"
              spark={{ values: chartData.map((d) => d.expenses), months, color: CHART_COLORS.expenses }} />
            <Kpi icon={Scale} label="صافي النتيجة" sub={rangeLabel} value={net} currency={currency} tone={net.isNegative() ? "neg" : undefined}
              href={canProfit ? "/reports/profitability" : "/reports/income-statement"}
              spark={{ values: chartData.map((d) => d.revenue - d.expenses), months, color: CHART_COLORS.net }} />
            </>}
            {show("cash") && <Kpi icon={Wallet} label="النقدية والبنوك" sub="الرصيد الحالي" value={cashBalance} currency={currency} tone={cashBalance.isNegative() ? "neg" : undefined} href="/reports/daily-cash" />}
          </section>}

          {/* الأداء + ما يحتاج انتباهك */}
          {(show("chart") || show("recent")) && <div className="grid gap-5 xl:grid-cols-12">
            {show("chart") && <Card2 className={show("recent") ? "xl:col-span-8" : "xl:col-span-12"} title="الإيرادات والمصروفات" note="آخر 6 أشهر" currency={currency} link={{ href: "/reports/income-statement", label: t.nav.incomeStatement }}>
              <IncomeExpenseChart data={chartData} labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }} />
            </Card2>}

            {show("recent") && <Card2 className={show("chart") ? "xl:col-span-4" : "xl:col-span-12"} title="آخر القيود المرحّلة" currency={currency} link={ctx.can(PERMISSIONS.journalView) ? { href: "/journal", label: t.nav.journal } : undefined}>
              {!ctx.can(PERMISSIONS.journalView) ? <NoAccess text={t.errors.permission_denied} /> : recentEntries.length === 0 ? (
                <p className="py-6 text-[16.5px] text-muted-foreground">لم يُرحَّل أي قيد بعد.</p>
              ) : (
                <RecentEntries today={today} sources={t.journal.sources}
                  entries={recentEntries.map((e) => ({ ...e, total: recentTotal.get(e.id) ?? "0" }))} />
              )}
            </Card2>}
          </div>}

          {/* الفواتير والذمم */}
          {show("aging") && <div className="grid gap-5 md:grid-cols-2">
            <Card2 title="حالة الفواتير" note={canInvoices ? `${invoiceTotal} فاتورة` : undefined} link={canInvoices ? { href: "/invoices", label: t.nav.invoices } : undefined}>
              {canInvoices ? (
                <DonutChart segments={invoiceSegments} centerTitle="الفواتير" centerValue={String(invoiceTotal)}
                  emptyTitle="لم تُصدر أي فاتورة بعد" emptyHint="تُصدر الفواتير عند مغادرة النزيل أو كفاتورة آجلة لعميل." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Card2>
            <Card2 title="أعمار الذمم المدينة" note={canAging ? formatAmount(agingTotal) : undefined} currency={currency} link={canAging ? { href: "/reports/aging", label: t.nav.aging } : undefined}>
              {canAging ? (
                <StripedBars rows={agingRows} emptyTitle="لا توجد ذمم مدينة قائمة" emptyHint="تظهر هنا الفواتير الآجلة غير المسددة حسب تاريخ استحقاقها." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Card2>
          </div>}

          {/* الأرصدة والمطابقة + الأقسام والغرف */}
          {(show("controls") || show("profit") || show("rooms")) && <div className="grid gap-5 xl:grid-cols-5">
            {show("controls") && <Card2 className={show("profit") || show("rooms") ? "xl:col-span-3 xl:self-start" : "xl:col-span-5"} title="الأرصدة ومطابقتها مع الأستاذ" currency={currency} note={unreconciled.length ? `${unreconciled.length} فرق` : "مطابقة"} noteTone={unreconciled.length ? "neg" : "pos"}>
              <ul className="mb-3 divide-y divide-line text-[16.5px]" id="reconciliation">
                {BALANCE_ROWS.map((b) => {
                  const row = reconRows.find((x) => x.control === b.control);
                  const ok = !row || row.diff.isZero();
                  return (
                    <li key={b.control} className="flex items-center gap-4 py-3">
                      <Link href={CONTROL_LABELS[b.control].href} className="min-w-0 flex-1 truncate text-ink hover:text-action">{b.label}</Link>
                      <Money value={bal(b.control)} locale="ar" className="font-semibold text-ink" />
                      <span className={cn("w-24 text-end", ok ? "text-success" : "text-urgent")}>
                        {ok ? "مطابق" : <>فرق <Money value={row!.diff} locale="ar" /></>}
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-center gap-4 py-3">
                  <Link href="/journal?status=draft" className="min-w-0 flex-1 truncate text-ink hover:text-action">قيود مسودة غير مرحّلة</Link>
                  <span className="num font-semibold text-ink">{draftCount}</span>
                  <span className="w-24" />
                </li>
              </ul>
              {(() => {
                const tb = reconRows.find((x) => x.control === "trial_balance");
                return tb ? (
                  <p className="mt-auto border-t border-line pt-3 text-[15.5px] text-muted-foreground">
                    ميزان المراجعة: مدين <span className="num text-ink"><Money value={tb.gl_balance} locale="ar" /></span>، دائن <span className="num text-ink"><Money value={tb.subledger_balance} locale="ar" /></span>
                    <span className={tb.diff.isZero() ? "text-success" : "text-urgent"}>، {tb.diff.isZero() ? "متوازن" : "غير متوازن"}</span>
                  </p>
                ) : null;
              })()}
            </Card2>}
            {(show("profit") || show("rooms")) && <div className={cn("flex min-w-0 flex-col gap-5", show("controls") ? "xl:col-span-2" : "xl:col-span-5")}>
              {show("profit") && <Card2 title="الإيرادات حسب القسم" note={rangeLabel} currency={currency} link={canProfit ? { href: "/reports/profitability", label: t.nav.profitability } : undefined}>
                {!canProfit ? <NoAccess text={t.errors.permission_denied} /> : deptSegments.length === 0 ? (
                  <p className="py-6 text-[16.5px] text-muted-foreground">لا توجد إيرادات مرحّلة في هذه الفترة.</p>
                ) : (
                  <>
                    <StripedBars rows={deptSegments.map((d) => ({ label: d.label, count: 0, amount: d.value, amountText: d.display, color: CHART_COLORS.revenue }))} emptyTitle="" emptyHint="" />
                    <p className="mt-4 border-t border-line pt-3 text-[15.5px] text-muted-foreground">
                      المجموع <span className="num text-ink">{formatAmount(deptTotal)}</span> من إيراد الفترة <span className="num text-ink">{formatAmount(revenue)}</span>
                      {negativeDepts.length > 0 && (
                        <span className="block text-amber">
                          تسويات صافية سالبة: {negativeDepts.map((d) => `${deptLabel(d.departmentId)} ${formatAmount(d.revenue)}`).join("، ")}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </Card2>}
              {show("rooms") && <Card2 className="flex flex-1 flex-col" title="الغرف" note={rangeLabel} currency={currency} link={{ href: "/reports/rooms", label: t.nav.roomStats }}>
                <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-5">
                  <Figure label="نسبة الإشغال" value={pct(rangeRooms.occupancy)} />
                  <Figure label="متوسط سعر الغرفة" value={rangeRooms.adr ? formatAmount(rangeRooms.adr) : ""} />
                  <Figure label="RevPAR" value={rangeRooms.revpar ? formatAmount(rangeRooms.revpar) : ""} />
                  <Figure label="الليالي المباعة" value={`${rangeRooms.roomNightsSold.toString()} / ${rangeRooms.roomNightsAvailable.toString()}`} />
                </dl>
                <p className="mt-auto border-t border-line pt-3 text-[15.5px] text-muted-foreground">
                  {totalRooms > 0 ? `${totalRooms} غرفة متاحة للبيع، و${openFolios?.count ?? 0} فوليو مفتوح` : "حدّد عدد الغرف في إعدادات الفندق لحساب الإشغال."}
                </p>
              </Card2>}
            </div>}
          </div>}
        </>
      )}
    </div>
  );
}

// =============================================================================
// مكونات العرض — بسيطة عمدًا: العنوان والرقم أولًا، بلا زخارف
// =============================================================================
function Card2({
  title, note, noteTone, currency, link, className, children,
}: {
  title: string;
  note?: string;
  noteTone?: "pos" | "neg";
  /** رمز العملة إن كانت البطاقة تعرض مبالغ، يظهر اسمها كشارة صغيرة في الزاوية */
  currency?: string;
  link?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("dash-card flex min-w-0 flex-col rounded-2xl border border-line bg-white p-6", className)}>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[17px]">
        <h2 className="font-semibold text-ink">{title}</h2>
        {(note || currency) && (
          <span className="flex items-center gap-2">
            {note && (
              <span className={cn("rounded-md px-2 py-0.5 text-[15px]", noteTone === "neg" ? "bg-urgent-tint text-urgent" : noteTone === "pos" ? "bg-success/10 text-success" : "bg-subtle text-slate-600")}>
                {note}
              </span>
            )}
            {currency && <CurrencyTag code={currency} />}
          </span>
        )}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {link && (
        <Link href={link.href} className="mt-5 inline-flex w-fit items-center rounded-md text-[15.5px] text-slate-500 transition-colors hover:text-ink">
          عرض {link.label}
        </Link>
      )}
    </section>
  );
}

function Kpi({
  icon: Icon, label, sub, value, currency, href, tone, spark,
}: {
  spark?: { values: number[]; months: string[]; color: string };
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  value: MoneyValue;
  currency: string;
  href: string;
  tone?: "neg";
}) {
  return (
    <Link href={href} aria-label={label} className="surface lift block min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3 sm:mb-5">
        <span className="lift-icon flex size-9 items-center justify-center rounded-[10px] bg-ink text-white">
          <Icon className="size-[17px] stroke-[1.75]" />
        </span>
        <p className="min-w-0 truncate text-[16.5px] font-medium text-slate-600">{label}</p>
        <CurrencyTag code={currency} className="ms-auto" />
      </div>
      <p className={cn("display-num truncate text-[22px] font-bold leading-tight text-ink sm:text-[30px]", tone === "neg" && "text-urgent")}>
        <AnimatedNumber value={value.toNumber()} text={formatAmount(value)} />
      </p>
      <p className="mt-1 truncate text-[16.5px] text-slate-600">{sub}</p>
      <div className="mt-3">
        {spark ? <Sparkline values={spark.values} months={spark.months} color={spark.color} /> : <p className="flex h-10 items-end text-[15px] text-slate-500">رصيد الصندوق والبنوك في الأستاذ</p>}
      </div>
    </Link>
  );
}

/** تنسيق مبلغ بمنزلتين كما في Money (للعدّاد المتحرك) */
function formatAmount(v: MoneyValue): string {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v.toFixed(2)));
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[15.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-[22px] font-bold leading-none text-ink">
        <span className="num">{value}</span>
      </dd>
    </div>
  );
}

function NoAccess({ text }: { text: string }) {
  return <p className="py-6 text-[16.5px] text-muted-foreground">{text}</p>;
}
