import "server-only";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { getIncomeStatement, getMonthlyPnl } from "@/services/financial.service";
import { agingReport } from "@/services/payables.service";
import { getTrialBalance } from "@/services/reports.service";
import {
  type ToolEnv, type ToolModule, addDays, addMonths, asStr, change, denied, fn, int, intArg, monthStart, obj, pct, round2, str, today,
} from "./shared";

/** أدوات التحليل المالي: الاتجاه الشهري، ومقارنة الفترات، وأكبر البنود، وأعمار الذمم، وفحص صحة الحسابات */

type Statement = Awaited<ReturnType<typeof getIncomeStatement>>;
const n = (m: { toNumber(): number }) => round2(m.toNumber());

function summary(s: Statement) {
  const sec = s.sections;
  return {
    revenue: n(s.revenue), cost_of_sales: n(sec.cost_of_sales.total), gross_profit: n(s.grossProfit),
    operating_expense: n(sec.operating_expense.total), administrative_expense: n(sec.administrative_expense.total),
    operating_profit: n(s.operatingProfit), other_revenue: n(sec.other_revenue.total), other_expense: n(sec.other_expense.total),
    net_profit: n(s.netProfit), net_margin_pct: pct(n(s.netProfit), n(s.revenue)),
  };
}

/** كل سطور القائمة مع نوعها: إيراد أو مصروف */
function lines(s: Statement) {
  const sec = s.sections;
  const tag = (kind: "revenue" | "expense", group: string, l: Statement["sections"]["operating_revenue"]["lines"]) =>
    l.map((x) => ({ kind, group, code: x.account.code, name: x.account.name, account_id: x.account.id, amount: n(x.amount) }));
  return [
    ...tag("revenue", "operating_revenue", sec.operating_revenue.lines), ...tag("revenue", "other_revenue", sec.other_revenue.lines),
    ...tag("expense", "cost_of_sales", sec.cost_of_sales.lines), ...tag("expense", "operating_expense", sec.operating_expense.lines),
    ...tag("expense", "administrative_expense", sec.administrative_expense.lines), ...tag("expense", "other_expense", sec.other_expense.lines),
  ];
}

/** فترة من المعطيات، والافتراضي من أول الشهر حتى اليوم */
function period(env: ToolEnv, from: unknown, to: unknown) {
  const end = isIsoDate(asStr(to)) ? asStr(to) : today(env);
  const start = isIsoDate(asStr(from)) && asStr(from) <= end ? asStr(from) : monthStart(end);
  return { from: start, to: end };
}

/** الفترة المقابلة: نفس الأيام من الشهر السابق إن كانت الفترة داخل شهر واحد، وإلا الفترة السابقة بنفس الطول */
function previous(p: { from: string; to: string }) {
  if (p.from === monthStart(p.from) && p.from.slice(0, 7) === p.to.slice(0, 7)) {
    const prevStart = addMonths(p.from, -1);
    const prevEnd = addDays(p.from, -1);
    const sameDay = `${prevStart.slice(0, 8)}${p.to.slice(8)}`;
    return { from: prevStart, to: sameDay < prevEnd && isIsoDate(sameDay) ? sameDay : prevEnd };
  }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
  return { from: addDays(p.from, -days - 1), to: addDays(p.from, -1) };
}

const BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;

async function aging(env: ToolEnv, kind: "receivable" | "payable", asOf: string) {
  const rows = await agingReport(env.ctx.supabase, env.ctx.hotel.id, kind, asOf);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<(typeof BUCKETS)[number], number>;
  const parties = new Map<string, { party: string; outstanding: number; overdue: number; max_days: number }>();
  for (const r of rows) {
    const amt = Number(r.outstanding);
    buckets[r.bucket] = round2(buckets[r.bucket] + amt);
    const p = parties.get(r.party_id) ?? { party: r.party_name, outstanding: 0, overdue: 0, max_days: 0 };
    p.outstanding = round2(p.outstanding + amt);
    if (r.days_overdue > 0) p.overdue = round2(p.overdue + amt);
    p.max_days = Math.max(p.max_days, r.days_overdue);
    parties.set(r.party_id, p);
  }
  const total = round2(Object.values(buckets).reduce((a, b) => a + b, 0));
  return {
    rows, total, buckets,
    top: [...parties.values()].sort((a, b) => b.outstanding - a.outstanding).slice(0, 10),
  };
}

export const finance: ToolModule = {
  specs: [
    fn("monthly_trend", "الاتجاه الشهري للإيرادات والمصروفات وصافي الربح وهامشه لآخر عدد من الأشهر، مع نسبة التغير عن الشهر السابق. مناسب للرسوم البيانية.",
      obj({ months: int("عدد الأشهر من 2 إلى 24، والافتراضي 6") })),
    fn("compare_periods", "يقارن قائمة الدخل بين فترتين: الإيرادات وتكلفة المبيعات ومجمل الربح والمصروفات وصافي الربح، مع التغير بالمبلغ والنسبة وأكبر الحسابات المسببة للفرق. الافتراضي هذا الشهر حتى اليوم مقابل نفس الأيام من الشهر السابق.",
      obj({
        from: str("بداية الفترة الحالية YYYY-MM-DD"), to: str("نهاية الفترة الحالية YYYY-MM-DD"),
        compare_from: str("بداية فترة المقارنة YYYY-MM-DD، اختياري"), compare_to: str("نهاية فترة المقارنة YYYY-MM-DD، اختياري"),
      })),
    fn("top_accounts", "أكبر بنود الإيراد أو المصروف في فترة مع نسبة كل بند من الإجمالي. الافتراضي من أول الشهر حتى اليوم.",
      obj({ kind: str("النوع", ["revenue", "expense"]), from: str("بداية الفترة YYYY-MM-DD"), to: str("نهاية الفترة YYYY-MM-DD"), limit: int("عدد البنود، والافتراضي 10") }, ["kind"])),
    fn("aging_summary", "أعمار الذمم المدينة على العملاء أو الدائنة للموردين: الإجمالي وتوزيعه على شرائح التأخر وأكبر الأطراف والمستندات الأكثر تأخرًا.",
      obj({ kind: str("receivable للعملاء أو payable للموردين", ["receivable", "payable"]), as_of: str("تاريخ المركز YYYY-MM-DD، والافتراضي اليوم") }, ["kind"])),
    fn("health_check", "فحص شامل لصحة الحسابات: توازن ميزان المراجعة، والقيود المسودة، ومطابقة حسابات المراقبة مع دفاترها الفرعية، والذمم المتأخرة أكثر من 90 يومًا، ورصيد النقدية، ونتيجة الشهر. يعيد قائمة ملاحظات مرتبة بالخطورة."),
  ],
  run: {
    async monthly_trend(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.financialView)) return denied("التقارير المالية");
      const months = intArg(a.months, 6, 2, 24);
      const end = today(env);
      const rows = await getMonthlyPnl(ctx.supabase, ctx.hotel.id, addMonths(end, -(months - 1)), end);
      let prev: number | null = null;
      const out = rows.map((r) => {
        const revenue = round2(Number(r.revenue)), expenses = round2(Number(r.expenses)), net = round2(revenue - expenses);
        const row = { month: asStr(r.month).slice(0, 7), revenue, expenses, net_profit: net, margin_pct: pct(net, revenue), revenue_change_pct: prev === null ? null : change(revenue, prev) };
        prev = revenue;
        return row;
      });
      const total = out.reduce((s, r) => ({ revenue: s.revenue + r.revenue, expenses: s.expenses + r.expenses }), { revenue: 0, expenses: 0 });
      return {
        currency: ctx.hotel.base_currency, months: out,
        totals: { revenue: round2(total.revenue), expenses: round2(total.expenses), net_profit: round2(total.revenue - total.expenses) },
        best_month: out.length ? out.reduce((b, r) => (r.net_profit > b.net_profit ? r : b)).month : null,
        worst_month: out.length ? out.reduce((b, r) => (r.net_profit < b.net_profit ? r : b)).month : null,
        note: "الشهر الأخير قد يكون جزئيًا حتى اليوم",
      };
    },
    async compare_periods(env, a) {
      const { ctx, locale } = env;
      if (!ctx.can(PERMISSIONS.financialView)) return denied("التقارير المالية");
      const cur = period(env, a.from, a.to);
      const prev = isIsoDate(asStr(a.compare_from)) && isIsoDate(asStr(a.compare_to)) && asStr(a.compare_from) <= asStr(a.compare_to)
        ? { from: asStr(a.compare_from), to: asStr(a.compare_to) } : previous(cur);
      const [sa, sb] = await Promise.all([
        getIncomeStatement(ctx.supabase, ctx.hotel, cur.from, cur.to, locale),
        getIncomeStatement(ctx.supabase, ctx.hotel, prev.from, prev.to, locale),
      ]);
      const x = summary(sa), y = summary(sb);
      const keys = Object.keys(x) as (keyof typeof x)[];
      const before = new Map(lines(sb).map((l) => [l.account_id, l.amount]));
      const movers = lines(sa).map((l) => ({ kind: l.kind, code: l.code, name: l.name, current: l.amount, previous: before.get(l.account_id) ?? 0 }))
        .concat(lines(sb).filter((l) => !lines(sa).some((c) => c.account_id === l.account_id)).map((l) => ({ kind: l.kind, code: l.code, name: l.name, current: 0, previous: l.amount })))
        .map((m) => ({ ...m, difference: round2(m.current - m.previous) }))
        .filter((m) => m.difference !== 0)
        .sort((p, q) => Math.abs(q.difference) - Math.abs(p.difference)).slice(0, 8);
      return {
        currency: ctx.hotel.base_currency, current_period: cur, compare_period: prev,
        lines: keys.filter((k) => k !== "net_margin_pct").map((k) => ({ item: k, current: x[k], previous: y[k], difference: round2(Number(x[k]) - Number(y[k])), change_pct: change(Number(x[k]), Number(y[k])) })),
        net_margin_pct: { current: x.net_margin_pct, previous: y.net_margin_pct },
        biggest_account_changes: movers,
      };
    },
    async top_accounts(env, a) {
      const { ctx, locale } = env;
      if (!ctx.can(PERMISSIONS.financialView)) return denied("التقارير المالية");
      const kind = asStr(a.kind) === "revenue" ? "revenue" : "expense";
      const p = period(env, a.from, a.to);
      const all = lines(await getIncomeStatement(ctx.supabase, ctx.hotel, p.from, p.to, locale)).filter((l) => l.kind === kind && l.amount !== 0);
      const total = round2(all.reduce((s, l) => s + l.amount, 0));
      return {
        currency: ctx.hotel.base_currency, period: p, kind, total,
        items: all.sort((x, y) => y.amount - x.amount).slice(0, intArg(a.limit, 10, 1, 30))
          .map((l) => ({ code: l.code, name: l.name, group: l.group, amount: l.amount, share_pct: pct(l.amount, total) })),
      };
    },
    async aging_summary(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.agingView)) return denied("تقرير أعمار الذمم");
      const kind = asStr(a.kind) === "payable" ? "payable" : "receivable";
      const asOf = isIsoDate(asStr(a.as_of)) ? asStr(a.as_of) : today(env);
      const r = await aging(env, kind, asOf);
      return {
        currency: ctx.hotel.base_currency, kind, as_of: asOf, total_outstanding: r.total, buckets: r.buckets,
        overdue_pct: pct(round2(r.total - r.buckets.current), r.total),
        top_parties: r.top,
        most_overdue: [...r.rows].sort((x, y) => y.days_overdue - x.days_overdue).slice(0, 8).map((d) => ({
          party: d.party_name, document: d.document_number, due_date: d.due_date, days_overdue: d.days_overdue, outstanding: round2(Number(d.outstanding)),
          path: kind === "receivable" ? `/invoices/${d.document_id}` : `/bills/${d.document_id}`,
        })),
      };
    },
    async health_check(env) {
      const { ctx, locale } = env;
      const h = ctx.hotel.id, day = today(env);
      const findings: { level: "خطير" | "تنبيه" | "سليم"; check: string; detail: string; path?: string }[] = [];
      const skipped: string[] = [];
      const tasks: Promise<void>[] = [];

      if (ctx.can(PERMISSIONS.trialBalanceView) || ctx.can(PERMISSIONS.financialView)) {
        tasks.push(getTrialBalance(ctx.supabase, { hotelId: h, fiscalYearStartMonth: ctx.hotel.fiscal_year_start_month, from: monthStart(day), to: day }).then((tb) => {
          findings.push(tb.isBalanced
            ? { level: "سليم", check: "ميزان المراجعة", detail: "متوازن" }
            : { level: "خطير", check: "ميزان المراجعة", detail: "غير متوازن، راجع القيود الأخيرة", path: "/reports/trial-balance" });
        }));
      } else skipped.push("ميزان المراجعة");

      if (ctx.can(PERMISSIONS.journalView)) {
        tasks.push((async () => {
          const { count } = await ctx.supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", h).eq("status", "draft");
          findings.push(count ? { level: "تنبيه", check: "القيود المسودة", detail: `${count} قيد لم يُرحّل بعد`, path: "/journal" } : { level: "سليم", check: "القيود المسودة", detail: "لا توجد" });
        })());
      } else skipped.push("القيود المسودة");

      if (ctx.can(PERMISSIONS.financialView)) {
        tasks.push((async () => {
          const { data, error } = await ctx.supabase.rpc("ledger_reconciliation", { p_hotel_id: h }).select("control, gl_balance::text, subledger_balance::text, difference::text");
          if (error) return;
          const off = ((data ?? []) as { control: string; difference: string }[]).filter((r) => Math.abs(Number(r.difference)) > 0.005);
          findings.push(off.length
            ? { level: "خطير", check: "مطابقة حسابات المراقبة", detail: off.map((r) => `${r.control} بفرق ${round2(Number(r.difference))}`).join("، ") }
            : { level: "سليم", check: "مطابقة حسابات المراقبة", detail: "كل الحسابات مطابقة لدفاترها الفرعية" });
        })());
        tasks.push((async () => {
          const { data, error } = await ctx.supabase.rpc("cash_balance", { p_hotel_id: h, p_as_of: day });
          if (error) return;
          const bal = round2(Number(data ?? 0));
          findings.push(bal < 0
            ? { level: "خطير", check: "رصيد النقدية والبنوك", detail: `سالب ${bal}`, path: "/reports/daily-cash" }
            : { level: "سليم", check: "رصيد النقدية والبنوك", detail: `${bal} ${ctx.hotel.base_currency}` });
        })());
        tasks.push(getIncomeStatement(ctx.supabase, ctx.hotel, monthStart(day), day, locale).then((s) => {
          const net = n(s.netProfit);
          findings.push(net < 0
            ? { level: "تنبيه", check: "نتيجة الشهر حتى اليوم", detail: `خسارة ${net}`, path: "/reports/income-statement" }
            : { level: "سليم", check: "نتيجة الشهر حتى اليوم", detail: `ربح ${net}` });
        }));
      } else skipped.push("المطابقة والنقدية ونتيجة الشهر");

      if (ctx.can(PERMISSIONS.agingView)) {
        for (const kind of ["receivable", "payable"] as const) {
          tasks.push(aging(env, kind, day).then((r) => {
            const label = kind === "receivable" ? "ذمم العملاء المتأخرة أكثر من 90 يومًا" : "مستحقات الموردين المتأخرة أكثر من 90 يومًا";
            findings.push(r.buckets.over_90 > 0
              ? { level: "تنبيه", check: label, detail: `${r.buckets.over_90} من إجمالي ${r.total}`, path: `/reports/aging?kind=${kind}` }
              : { level: "سليم", check: label, detail: "لا توجد" });
          }));
        }
      } else skipped.push("أعمار الذمم");

      await Promise.allSettled(tasks);
      const order = { "خطير": 0, "تنبيه": 1, "سليم": 2 };
      findings.sort((x, y) => order[x.level] - order[y.level]);
      return {
        date: day, currency: ctx.hotel.base_currency,
        score: { critical: findings.filter((f) => f.level === "خطير").length, warnings: findings.filter((f) => f.level === "تنبيه").length, ok: findings.filter((f) => f.level === "سليم").length },
        findings, skipped_for_permissions: skipped,
      };
    },
  },
};
