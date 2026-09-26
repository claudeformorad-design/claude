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
import { Scale, TrendingDown, TrendingUp, Wallet, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  current: { label: "غير مستحقة بعد", color: CHART_COLORS.paid },
  "1_30": { label: "متأخرة 1–30 يومًا", color: CHART_COLORS.overdue[0] },
  "31_60": { label: "متأخرة 31–60 يومًا", color: CHART_COLORS.overdue[1] },
  "61_90": { label: "متأخرة 61–90 يومًا", color: CHART_COLORS.overdue[2] },
  over_90: { label: "متأخرة أكثر من 90 يومًا", color: CHART_COLORS.overdue[3] },
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
            .order("entry_date", { ascending: false }).order("entry_number", { ascending: false }).limit(6)
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

  const currency = currencySymbol(hotel.base_currency);

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
  const deptLabel = (id: string | null) => (id ? deptName.get(id) ?? "—" : t.profitability.unassigned);
  const deptSegments = deptSummary
    .filter((d) => d.revenue.gt(0))
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .map((d) => ({ label: deptLabel(d.departmentId), value: d.revenue.toNumber(), display: d.revenue.toFixed(2) }));
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
    ctx.can(PERMISSIONS.journalCreate) && { href: "/journal/new", label: "قيد يومية جديد" },
    ctx.can(PERMISSIONS.folioManage) && { href: "/folios/new", label: "فتح فوليو" },
    ctx.can(PERMISSIONS.paymentsReceipt) && { href: "/vouchers/new", label: "سند قبض / صرف" },
  ].filter(Boolean) as { href: string; label: string }[];

  const invoiceSegments = [
    { label: "مصدرة", value: invIssued?.count ?? 0, color: CHART_COLORS.pending },
    { label: "مدفوعة جزئيًا", value: invPartial?.count ?? 0, color: CHART_COLORS.partial },
    { label: "مدفوعة", value: invPaid?.count ?? 0, color: CHART_COLORS.paid },
  ];
  const invoiceTotal = invoiceSegments.reduce((s, x) => s + x.value, 0);

  const businessDate = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));
  const pct = (v: MoneyValue | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">{businessDate}</p>
          <h1 className="text-[24px] font-bold leading-tight text-ink">{t.dashboard.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {quick.map((q, i) => (
            <Button key={q.href} asChild variant={i === 0 ? "default" : "outline"}>
              <Link href={q.href}>{i === 0 && <Plus />}{q.label}</Link>
            </Button>
          ))}
        </div>
      </div>

      {/* الفترة: تبويب واحد نشط */}
      <nav aria-label="الفترة" className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
        {RANGES.map((x) => (
          <Link key={x.key} href={x.key === "month" ? "/" : `/?range=${x.key}`} aria-current={range === x.key ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-[10px] px-4 py-1.5 text-[13px] transition-colors",
              range === x.key ? "bg-white font-medium text-ink shadow-soft" : "text-slate-500 hover:text-ink")}>
            {x.label}
          </Link>
        ))}
      </nav>

      {/* تنبيهات (تظهر فقط عند وجود ما يستدعي إجراءً) */}
      {alerts.length > 0 && (
        <section className="surface px-6 py-2">
          {alerts.map((a) => (
            <Link key={a.title} href={a.href} className="group flex items-center gap-3 py-2.5">
              <Badge variant={a.tone === "red" ? "destructive" : a.tone === "amber" ? "warning" : "info"}>{a.tone === "red" ? "عاجل" : a.tone === "amber" ? "تنبيه" : "للعلم"}</Badge>
              <span className="text-[13px] font-medium text-ink group-hover:underline">{a.title}</span>
              <span className="hidden text-[13px] text-muted-foreground sm:inline">{a.text}</span>
              <span className="ms-auto text-[12px] text-slate-500">←</span>
            </Link>
          ))}
        </section>
      )}

      {!canFin && <Alert>{t.errors.permission_denied}</Alert>}

      {canFin && (
        <>
          {/* شريط الأرقام الرئيسية: بطاقة واحدة مقسّمة */}
          <section className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
            <Kpi icon={TrendingUp} label="الإيرادات" sub={rangeLabel} value={revenue} currency={currency} href="/reports/income-statement"
              spark={{ values: chartData.map((d) => d.revenue), months, color: CHART_COLORS.revenue }} />
            <Kpi icon={TrendingDown} label="المصروفات" sub={rangeLabel} value={expenses} currency={currency} href="/reports/income-statement"
              spark={{ values: chartData.map((d) => d.expenses), months, color: CHART_COLORS.expenses }} />
            <Kpi icon={Scale} label="صافي النتيجة" sub={rangeLabel} value={net} currency={currency} tone={net.isNegative() ? "neg" : undefined}
              href={canProfit ? "/reports/profitability" : "/reports/income-statement"}
              spark={{ values: chartData.map((d) => d.revenue - d.expenses), months, color: CHART_COLORS.net }} />
            <Kpi icon={Wallet} label="النقدية والبنوك" sub="الرصيد الحالي" value={cashBalance} currency={currency} tone={cashBalance.isNegative() ? "neg" : undefined} href="/reports/daily-cash" />
          </section>

          {/* الأداء + ما يحتاج انتباهك */}
          <div className="grid gap-5 xl:grid-cols-12">
            <Card2 className="xl:col-span-8" title="الإيرادات والمصروفات" note="آخر 6 أشهر" link={{ href: "/reports/income-statement", label: t.nav.incomeStatement }}>
              <IncomeExpenseChart data={chartData} currency={currency} labels={{ revenue: r.revenue, expenses: r.expenses, net: "صافي النتيجة" }} />
            </Card2>

            <Card2 className="xl:col-span-4" title="آخر القيود المرحّلة" link={ctx.can(PERMISSIONS.journalView) ? { href: "/journal", label: t.nav.journal } : undefined}>
              {!ctx.can(PERMISSIONS.journalView) ? <NoAccess text={t.errors.permission_denied} /> : recentEntries.length === 0 ? (
                <p className="py-6 text-[13px] text-muted-foreground">لم يُرحَّل أي قيد بعد.</p>
              ) : (
                <ul className="-my-1 divide-y divide-line">
                  {recentEntries.map((e) => (
                    <li key={e.id}>
                      <Link href={`/journal/${e.id}`} className="group flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink group-hover:underline">{e.description}</span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            <span className="num">{e.entry_number}</span> · {e.entry_date} · {t.journal.sources[e.source as keyof typeof t.journal.sources] ?? e.source}
                          </span>
                        </span>
                        <span className="num shrink-0 text-[13px] text-ink"><Money value={recentTotal.get(e.id) ?? "0"} locale="ar" /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card2>
          </div>

          {/* الفواتير والذمم */}
          <div className="grid gap-5 md:grid-cols-2">
            <Card2 title="حالة الفواتير" note={canInvoices ? `${invoiceTotal} فاتورة` : undefined} link={canInvoices ? { href: "/invoices", label: t.nav.invoices } : undefined}>
              {canInvoices ? (
                <DonutChart segments={invoiceSegments} centerTitle="الفواتير" centerValue={String(invoiceTotal)}
                  emptyTitle="لم تُصدر أي فاتورة بعد" emptyHint="تُصدر الفواتير عند مغادرة النزيل أو كفاتورة آجلة لعميل." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Card2>
            <Card2 title="أعمار الذمم المدينة" note={canAging ? `${agingTotal.toFixed(2)} ${currency}` : undefined} link={canAging ? { href: "/reports/aging", label: t.nav.aging } : undefined}>
              {canAging ? (
                <StripedBars rows={agingRows} currency={currency} emptyTitle="لا توجد ذمم مدينة قائمة" emptyHint="تظهر هنا الفواتير الآجلة غير المسددة حسب تاريخ استحقاقها." />
              ) : <NoAccess text={t.errors.permission_denied} />}
            </Card2>
          </div>

          {/* الأرصدة والمطابقة + الأقسام والغرف */}
          <div className="grid gap-5 xl:grid-cols-5">
            <Card2 className="flex flex-col xl:col-span-3" title="الأرصدة ومطابقتها مع الأستاذ" note={unreconciled.length ? `${unreconciled.length} فرق` : "مطابقة"} noteTone={unreconciled.length ? "neg" : "pos"}>
              <table className="mb-3 w-full text-[13px]" id="reconciliation">
                <thead>
                  <tr className="text-[12px] text-muted-foreground">
                    <th className="pb-2 text-start font-normal">الحساب</th>
                    <th className="pb-2 text-end font-normal">الرصيد ({currency})</th>
                    <th className="w-28 pb-2 text-end font-normal">الأستاذ العام</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {BALANCE_ROWS.map((b) => {
                    const row = reconRows.find((x) => x.control === b.control);
                    const ok = !row || row.diff.isZero();
                    return (
                      <tr key={b.control}>
                        <td className="py-2.5"><Link href={CONTROL_LABELS[b.control].href} className="text-ink hover:underline">{b.label}</Link></td>
                        <td className="num py-2.5 text-end text-ink"><Money value={bal(b.control)} locale="ar" /></td>
                        <td className="py-2.5 text-end">
                          {ok ? <Badge variant="success">مطابق</Badge> : <Badge variant="destructive">فرق <Money value={row!.diff} locale="ar" /></Badge>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="py-2.5"><Link href="/journal?status=draft" className="text-ink hover:underline">قيود مسودة غير مرحّلة</Link></td>
                    <td className="num py-2.5 text-end text-ink">{draftCount}</td>
                    <td className="py-2.5 text-end text-[12px] text-muted-foreground">—</td>
                  </tr>
                </tbody>
              </table>
              {(() => {
                const tb = reconRows.find((x) => x.control === "trial_balance");
                return tb ? (
                  <p className="mt-auto border-t border-line pt-3 text-[12px] text-muted-foreground">
                    ميزان المراجعة: مدين <span className="num text-ink"><Money value={tb.gl_balance} locale="ar" /></span> · دائن <span className="num text-ink"><Money value={tb.subledger_balance} locale="ar" /></span>
                    <span className={tb.diff.isZero() ? "text-success" : "text-urgent"}> — {tb.diff.isZero() ? "متوازن" : "غير متوازن"}</span>
                  </p>
                ) : null;
              })()}
            </Card2>
            <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
              <Card2 title="الإيرادات حسب القسم" note={rangeLabel} link={canProfit ? { href: "/reports/profitability", label: t.nav.profitability } : undefined}>
                {!canProfit ? <NoAccess text={t.errors.permission_denied} /> : deptSegments.length === 0 ? (
                  <p className="py-6 text-[13px] text-muted-foreground">لا توجد إيرادات مرحّلة في هذه الفترة.</p>
                ) : (
                  <>
                    <StripedBars rows={deptSegments.map((d) => ({ label: d.label, count: 0, amount: d.value, amountText: d.display, color: CHART_COLORS.revenue }))}
                      currency={currency} emptyTitle="" emptyHint="" />
                    <p className="mt-4 border-t border-line pt-3 text-[12px] text-muted-foreground">
                      المجموع <span className="num text-ink">{deptTotal.toFixed(2)}</span> من إيراد الفترة <span className="num text-ink">{revenue.toFixed(2)}</span> {currency}
                      {negativeDepts.length > 0 && (
                        <span className="block text-amber">
                          تسويات صافية سالبة: {negativeDepts.map((d) => `${deptLabel(d.departmentId)} (${d.revenue.toFixed(2)})`).join("، ")}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </Card2>
              <Card2 className="flex flex-1 flex-col" title="الغرف" note={rangeLabel} link={{ href: "/reports/rooms", label: t.nav.roomStats }}>
                <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-5">
                  <Figure label="نسبة الإشغال" value={pct(rangeRooms.occupancy)} />
                  <Figure label="متوسط سعر الغرفة" value={rangeRooms.adr ? rangeRooms.adr.toFixed(2) : "—"} unit={rangeRooms.adr ? currency : undefined} />
                  <Figure label="RevPAR" value={rangeRooms.revpar ? rangeRooms.revpar.toFixed(2) : "—"} unit={rangeRooms.revpar ? currency : undefined} />
                  <Figure label="الليالي المباعة" value={`${rangeRooms.roomNightsSold.toString()} / ${rangeRooms.roomNightsAvailable.toString()}`} />
                </dl>
                <p className="mt-auto border-t border-line pt-3 text-[12px] text-muted-foreground">
                  {totalRooms > 0 ? `${totalRooms} غرفة متاحة للبيع · ${openFolios?.count ?? 0} فوليو مفتوح` : "حدّد عدد الغرف في إعدادات الفندق لحساب الإشغال."}
                </p>
              </Card2>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// مكونات العرض — بسيطة عمدًا: العنوان والرقم أولًا، بلا زخارف
// =============================================================================
function Card2({
  title, note, noteTone, link, className, children,
}: {
  title: string;
  note?: string;
  noteTone?: "pos" | "neg";
  link?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("surface min-w-0 p-6", className)}>
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          {title}
          {note && (
            <span className={cn("text-[12px] font-normal", noteTone === "neg" ? "text-urgent" : noteTone === "pos" ? "text-success" : "text-muted-foreground")}>
              {note}
            </span>
          )}
        </h2>
        {link && (
          <Link href={link.href} className="shrink-0 text-[12px] text-slate-500 transition-colors hover:text-ink">
            {link.label} ←
          </Link>
        )}
      </header>
      {children}
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
    <div className="surface min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between sm:mb-5">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-ink text-white">
          <Icon className="size-[17px] stroke-[1.75]" />
        </span>
        <Link href={href} aria-label={`تفاصيل ${label}`} className="text-[12px] text-slate-500 transition-colors hover:text-ink"><span className="hidden sm:inline">التفاصيل </span>←</Link>
      </div>
      <p className={cn("truncate text-[18px] font-bold leading-tight text-ink sm:text-[22px]", tone === "neg" && "text-urgent")}>
        <AnimatedNumber value={value.toNumber()} text={formatAmount(value)} />
        <span className="ms-1.5 text-[12px] font-normal text-slate-500">{currency}</span>
      </p>
      <p className="mt-1 truncate text-[13px] text-slate-600">{label} · {sub}</p>
      <div className="mt-3">
        {spark ? <Sparkline values={spark.values} months={spark.months} color={spark.color} currency={currency} /> : <p className="flex h-10 items-end text-[11.5px] text-slate-500">رصيد الصندوق والبنوك في الأستاذ</p>}
      </div>
    </div>
  );
}

/** تنسيق مبلغ بمنزلتين كما في Money (للعدّاد المتحرك) */
function formatAmount(v: MoneyValue): string {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v.toFixed(2)));
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-[20px] font-bold leading-none text-ink">
        <span className="num">{value}</span>
        {unit && <span className="ms-1 text-[11px] text-slate-500">{unit}</span>}
      </dd>
    </div>
  );
}

function NoAccess({ text }: { text: string }) {
  return <p className="py-6 text-[13px] text-muted-foreground">{text}</p>;
}
