import { tr } from "@/i18n/tr";
import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { AGING_BUCKETS, summarizeAging } from "@/lib/accounting/aging";
import { trialBalanceColumns } from "@/lib/accounting/trial-balance";
import { summarizeProfitability } from "@/lib/accounting/profitability";
import { type Money, sumMoney, toMoney } from "@/lib/accounting/money";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { listDepartments } from "./accounts.service";
import { getBalanceSheet, getCashFlow, getDailyCash, getIncomeStatement, getRoomStats } from "./financial.service";
import { agingReport } from "./payables.service";
import { getTrialBalance } from "./reports.service";
import { raise } from "./errors";
import { fiscalYearStart, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { roomKpis } from "@/lib/accounting/kpi";
import type { ReservationSource, ReservationStatus } from "@/lib/supabase/database.types";

/**
 * جدول تقرير موحّد: تعرضه الصفحات ويُصدّر كما هو إلى Excel (ما تراه هو ما تصدّره).
 * القيم المالية تبقى Money حتى لحظة العرض/التصدير.
 */
export type Cell = string | Money | null;
/**
 * code: رمز الحساب أو القسم أو الضريبة، يُعرض في عمود «الرمز» مستقلًا عن الاسم.
 * account: معرّف الحساب لصفوف الحسابات، فيُفتح الصف على حركاته في الفترة.
 */
export interface ReportRow { kind: "section" | "line" | "subtotal" | "total"; cells: Cell[]; code?: string; account?: string }
export interface ReportTable { title: string; subtitle: string; columns: string[]; rows: ReportRow[]; note?: { ok: boolean; text: string } }

export const REPORTS = {
  "income-statement": PERMISSIONS.financialView,
  "balance-sheet": PERMISSIONS.financialView,
  "cash-flow": PERMISSIONS.financialView,
  "trial-balance": PERMISSIONS.trialBalanceView,
  rooms: PERMISSIONS.financialView,
  "daily-cash": PERMISSIONS.cashReportView,
  "aging-receivable": PERMISSIONS.agingView,
  "aging-payable": PERMISSIONS.agingView,
  profitability: PERMISSIONS.profitabilityView,
  "tax-return": PERMISSIONS.taxReportView,
  "account-statement": PERMISSIONS.journalView,
  "monthly-movement": PERMISSIONS.trialBalanceView,
  "daily-totals": PERMISSIONS.journalView,
  "missing-numbers": PERMISSIONS.auditView,
  "budget-vs-actual": PERMISSIONS.financialView,
  "item-card": PERMISSIONS.inventoryView,
  "stock-balances": PERMISSIONS.inventoryView,
  "count-sheet": PERMISSIONS.inventoryView,
  "item-prices": PERMISSIONS.inventoryView,
  "expiring-stock": PERMISSIONS.inventoryView,
  "guest-balances": PERMISSIONS.folioView,
  "reservations-report": PERMISSIONS.pmsView,
  "occupancy-monthly": PERMISSIONS.financialView,
  "currency-trial-balance": PERMISSIONS.trialBalanceView,
  "cash-by-currency": PERMISSIONS.cashReportView,
} as const satisfies Record<string, Permission>;
export type ReportKey = keyof typeof REPORTS;

/** account و department لكشف الحساب فقط (حساب تفصيلي أو رئيسي، و/أو مركز تكلفة) */
export interface ReportParams { from: string; to: string; account?: string; department?: string; item?: string; category?: string; status?: string; source?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** قراءة معاملات التقرير من الرابط بنفس القواعد في الصفحة والتصدير والطباعة */
export function parseReportParams(key: ReportKey, get: (k: string) => string | null | undefined, hotel: { timezone: string; fiscal_year_start_month: number }): ReportParams {
  const today = todayInTimeZone(hotel.timezone);
  const toRaw = get("to") ?? "";
  const to = isIsoDate(toRaw) ? toRaw : today;
  const defaultFrom = key === "cash-by-currency" ? to : key === "income-statement" || key === "cash-flow" || key === "trial-balance" || key === "monthly-movement" || key === "occupancy-monthly"
    ? fiscalYearStart(to, hotel.fiscal_year_start_month) : `${to.slice(0, 7)}-01`;
  const fromRaw = get("from") ?? "";
  const from = isIsoDate(fromRaw) && fromRaw <= to ? fromRaw : defaultFrom;
  const account = get("account") ?? "";
  const department = get("department") ?? "";
  const item = get("item") ?? "";
  const status = get("status") ?? "";
  const source = get("source") ?? "";
  const category = get("category") ?? "";
  return {
    from, to, account: UUID.test(account) ? account : undefined, department: UUID.test(department) ? department : undefined,
    item: UUID.test(item) ? item : undefined, category: UUID.test(category) ? category : undefined,
    status: /^[a-z_]{1,20}$/.test(status) ? status : undefined, source: /^[a-z_]{1,20}$/.test(source) ? source : undefined,
  };
}

/** رابط الاستعلام نفسه للتصدير والطباعة */
export const reportQuery = (p: ReportParams) =>
  `from=${p.from}&to=${p.to}${p.account ? `&account=${p.account}` : ""}${p.department ? `&department=${p.department}` : ""}${p.item ? `&item=${p.item}` : ""}${p.category ? `&category=${p.category}` : ""}${p.status ? `&status=${p.status}` : ""}${p.source ? `&source=${p.source}` : ""}`;

const line = (...cells: Cell[]): ReportRow => ({ kind: "line", cells });
const acc = (a: { id: string; code: string }, label: string, ...cells: Cell[]): ReportRow => ({ kind: "line", cells: [label, ...cells], code: a.code, account: a.id });
const sub = (...cells: Cell[]): ReportRow => ({ kind: "subtotal", cells });
const total = (...cells: Cell[]): ReportRow => ({ kind: "total", cells });
const head = (text: string, width: number): ReportRow => ({ kind: "section", cells: [text, ...Array(width - 1).fill(null)] });

export async function buildReport(key: ReportKey, ctx: AppContext, t: Dictionary, locale: string, p: ReportParams): Promise<ReportTable> {
  const r = t.reports;
  const period = tr("من {0} إلى {1}", p.from, p.to);
  switch (key) {
    case "income-statement": {
      const is = await getIncomeStatement(ctx.supabase, ctx.hotel, p.from, p.to, locale);
      const rows: ReportRow[] = [];
      const block = (k: keyof typeof is.sections) => {
        const s = is.sections[k];
        if (!s.lines.length) return;
        rows.push(head(r.sections[k], 2), ...s.lines.map((l) => acc(l.account, l.account.name, l.amount)), sub(r.sections[k], s.total));
      };
      block("operating_revenue"); rows.push(total(r.totalRevenue, is.revenue));
      block("cost_of_sales"); rows.push(total(r.grossProfit, is.grossProfit));
      block("operating_expense"); block("administrative_expense"); rows.push(total(r.operatingProfit, is.operatingProfit));
      block("other_revenue"); block("other_expense"); rows.push(total(r.netProfit, is.netProfit));
      return { title: t.nav.incomeStatement, subtitle: period, columns: [r.account, r.amount], rows };
    }
    case "balance-sheet": {
      const bs = await getBalanceSheet(ctx.supabase, ctx.hotel, p.to, locale);
      const rows: ReportRow[] = [];
      const block = (k: keyof typeof bs.sections) => {
        const s = bs.sections[k];
        if (!s.lines.length) return;
        rows.push(head(r.sections[k], 2), ...s.lines.map((l) => acc(l.account, l.account.name, l.amount)), sub(r.sections[k], s.total));
      };
      block("current_asset"); block("fixed_asset"); block("other_asset"); rows.push(total(r.totalAssets, bs.totalAssets));
      block("current_liability"); block("long_term_liability"); rows.push(total(r.totalLiabilities, bs.totalLiabilities));
      block("equity"); rows.push(line(r.currentYearEarnings, bs.currentYearEarnings), total(r.totalEquity, bs.totalEquity));
      rows.push(total(r.liabilitiesAndEquity, bs.totalLiabilities.plus(bs.totalEquity)));
      return { title: t.nav.balanceSheet, subtitle: `${r.asOf} ${p.to}`, columns: [r.account, r.amount], rows,
        note: { ok: bs.isBalanced, text: bs.isBalanced ? r.balanced : r.unbalanced } };
    }
    case "cash-flow": {
      const cf = await getCashFlow(ctx.supabase, ctx.hotel.id, p.from, p.to, locale);
      const rows: ReportRow[] = [line(r.openingCash, cf.opening)];
      for (const a of ["operating", "investing", "financing"] as const) {
        const ls = cf.lines.filter((l) => l.activity === a);
        rows.push(head(r.activities[a], 2), ...ls.map((l) => line(l.name, toMoney(l.amount))), sub(r.activities[a], cf[a]));
      }
      rows.push(total(r.netChange, cf.net), total(r.closingCash, cf.closing));
      return { title: t.nav.cashFlow, subtitle: period, columns: [r.account, r.amount], rows,
        note: { ok: cf.reconciles, text: cf.reconciles ? `${r.openingCash} + ${r.netChange} = ${r.closingCash}` : t.errors.unknown } };
    }
    case "trial-balance": {
      const tb = await getTrialBalance(ctx.supabase, { hotelId: ctx.hotel.id, fiscalYearStartMonth: ctx.hotel.fiscal_year_start_month, from: p.from, to: p.to });
      const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;
      const rows = tb.rows.map((row) => {
        const c = trialBalanceColumns(row);
        const cells = [c.openingDebit, c.openingCredit, c.periodDebit, c.periodCredit, c.closingDebit, c.closingCredit];
        return row.account ? acc(row.account, name(row.account), ...cells) : line(t.trialBalance.unallocatedEarnings, ...cells);
      });
      const x = tb.totals;
      rows.push(total(t.common.total, x.openingDebit, x.openingCredit, x.periodDebit, x.periodCredit, x.closingDebit, x.closingCredit));
      const d = t.journal.debit, c = t.journal.credit;
      return { title: t.trialBalance.title, subtitle: period,
        columns: [r.account, `${t.trialBalance.opening} ${d}`, `${t.trialBalance.opening} ${c}`, `${t.trialBalance.movement} ${d}`, `${t.trialBalance.movement} ${c}`, `${t.trialBalance.closing} ${d}`, `${t.trialBalance.closing} ${c}`],
        rows, note: { ok: tb.isBalanced, text: tb.isBalanced ? t.trialBalance.balancedNote : t.trialBalance.unbalancedNote } };
    }
    case "rooms": {
      const { days, kpis } = await getRoomStats(ctx.supabase, ctx.hotel.id, p.from, p.to);
      const pct = (m: Money | null) => (m ? `${m.toFixed(1)}%` : "");
      const rows = days.map((d) => {
        const occ = d.rooms_available ? toMoney(d.room_nights).div(d.rooms_available).times(100) : null;
        const adr = toMoney(d.room_nights).isZero() ? null : toMoney(d.room_revenue).div(toMoney(d.room_nights));
        return line(d.business_date, toMoney(d.room_nights).toString(), String(d.rooms_available), pct(occ), toMoney(d.room_revenue), adr,
          d.rooms_available ? toMoney(d.room_revenue).div(d.rooms_available) : null);
      });
      rows.push(total(t.common.total, kpis.roomNightsSold.toString(), kpis.roomNightsAvailable.toString(), pct(kpis.occupancy), kpis.roomRevenue, kpis.adr, kpis.revpar));
      return { title: t.nav.roomStats, subtitle: period,
        columns: [t.common.date, r.roomNights, r.available, r.occupancy, r.roomRevenue, r.adr, r.revpar], rows,
        note: ctx.hotel.total_rooms ? undefined : { ok: false, text: r.setRooms } };
    }
    case "daily-cash": {
      const data = await getDailyCash(ctx.supabase, ctx.hotel.id, p.to);
      const rows = data.map((d) => line(d.method_name, r.sources[d.source], toMoney(d.receipts), toMoney(d.payments), toMoney(d.receipts).minus(toMoney(d.payments))));
      const rec = sumMoney(data.map((d) => d.receipts)), pay = sumMoney(data.map((d) => d.payments));
      rows.push(total(t.common.total, null, rec, pay, rec.minus(pay)));
      return { title: t.nav.dailyCash, subtitle: p.to, columns: [r.method, r.source, r.receipts, r.payments, r.net], rows };
    }
    case "aging-receivable":
    case "aging-payable": {
      const kind = key === "aging-receivable" ? "receivable" : "payable";
      const { parties, totals } = summarizeAging(await agingReport(ctx.supabase, ctx.hotel.id, kind, p.to));
      const rows = parties.map((x) => line(x.partyName, ...AGING_BUCKETS.map((b) => x.buckets[b]), x.total));
      rows.push(total(t.common.total, ...AGING_BUCKETS.map((b) => totals.buckets[b]), totals.total));
      return { title: tr("{0}، {1}", t.nav.aging, kind === "receivable" ? t.payables.receivable : t.payables.payable), subtitle: `${r.asOf} ${p.to}`,
        columns: [t.vouchers.party, ...AGING_BUCKETS.map((b) => t.payables.buckets[b]), t.common.total], rows };
    }
    case "tax-return": {
      const { data, error } = await ctx.supabase.rpc("tax_return", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to })
        .select("code, name, kind, rate::text, sales_base::text, sales_tax::text, purchases_base::text, purchases_tax::text");
      raise(error);
      const a = t.admin;
      const rows: ReportRow[] = (data ?? []).map((x) => {
        const out = toMoney(x.sales_tax), inp = toMoney(x.purchases_tax);
        return { ...line(`${x.name} ${toMoney(x.rate).toString()}%`, toMoney(x.sales_base), out, toMoney(x.purchases_base), inp, out.minus(inp)), code: x.code };
      });
      const sum = (k: "sales_base" | "sales_tax" | "purchases_base" | "purchases_tax") => sumMoney((data ?? []).map((x) => x[k]));
      rows.push(total(t.common.total, sum("sales_base"), sum("sales_tax"), sum("purchases_base"), sum("purchases_tax"), sum("sales_tax").minus(sum("purchases_tax"))));
      return { title: t.nav.taxReturn, subtitle: tr("{0}، {1}", period, a.taxSubtitle),
        columns: [t.revenueSettings.taxes, a.salesBase, a.salesTax, a.purchasesBase, a.purchasesTax, a.netPayable], rows };
    }
    case "profitability": {
      const [res, departments] = await Promise.all([
        ctx.supabase.rpc("department_profitability", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to }).select("department_id, account_type, account_subtype, amount::text"),
        listDepartments(ctx.supabase, ctx.hotel.id),
      ]);
      raise(res.error);
      const { departments: ds, total: tt } = summarizeProfitability((res.data ?? []) as never);
      const dept = new Map(departments.map((d) => [d.id, d]));
      const pr = t.profitability;
      const cells = (x: typeof tt): Cell[] => [x.revenue, x.costOfSales, x.grossProfit, x.operatingExpenses, x.netProfit, x.margin ? `${x.margin.toFixed(1)}%` : ""];
      const rows: ReportRow[] = ds.map((x) => {
        const d = x.departmentId ? dept.get(x.departmentId) : undefined;
        return { ...line(d ? (locale === "en" && d.name_en) || d.name_ar : pr.unassigned, ...cells(x)), code: d?.code };
      });
      rows.push(total(t.common.total, ...cells(tt)));
      return { title: t.nav.profitability, subtitle: period, columns: [t.folio.department, pr.revenue, pr.cos, pr.gross, pr.opex, pr.net, pr.margin], rows };
    }
    case "account-statement": {
      const st = await accountStatement(ctx, locale, p);
      return st;
    }
    case "monthly-movement": {
      const [res, accounts] = await Promise.all([
        ctx.supabase.rpc("monthly_account_movement", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to }).select("account_id, month, debit::text, credit::text"),
        ctx.supabase.from("chart_of_accounts").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id),
      ]);
      raise(res.error); raise(accounts.error);
      const months: string[] = [];
      for (let d = new Date(`${p.from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= p.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 10));
      const byAcc = new Map<string, Map<string, Money>>();
      for (const x of res.data ?? []) {
        const m = byAcc.get(x.account_id) ?? new Map<string, Money>();
        m.set(x.month, toMoney(x.debit).minus(toMoney(x.credit)));
        byAcc.set(x.account_id, m);
      }
      const accs = (accounts.data ?? []).filter((a) => byAcc.has(a.id)).sort((a, b) => a.code.localeCompare(b.code));
      const rows: ReportRow[] = accs.map((a) => {
        const m = byAcc.get(a.id)!;
        const vals = months.map((mo) => m.get(mo) ?? null);
        return acc(a, (locale === "en" && a.name_en) || a.name_ar, ...vals, sumMoney(vals.filter((v): v is Money => v !== null).map((v) => v.toString())));
      });
      const colTotal = months.map((mo) => sumMoney(accs.map((a) => byAcc.get(a.id)!.get(mo)?.toString() ?? "0")));
      rows.push(total(t.common.total, ...colTotal, sumMoney(colTotal.map((v) => v.toString()))));
      return { title: tr("الحركة الشهرية للحسابات"), subtitle: period,
        columns: [r.account, ...months.map((mo) => mo.slice(0, 7)), t.common.total], rows,
        note: { ok: true, text: tr("الرقم الموجب حركة مدينة صافية، والسالب حركة دائنة صافية.") } };
    }
    case "daily-totals": {
      const { data, error } = await ctx.supabase.rpc("daily_journal_totals", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to })
        .select("entry_date, entries, debit::text, credit::text");
      raise(error);
      const rows: ReportRow[] = (data ?? []).map((x) => line(x.entry_date, String(x.entries), toMoney(x.debit), toMoney(x.credit)));
      rows.push(total(t.common.total, String((data ?? []).reduce((n, x) => n + x.entries, 0)), sumMoney((data ?? []).map((x) => x.debit)), sumMoney((data ?? []).map((x) => x.credit))));
      return { title: tr("يومية الحسابات مجاميع"), subtitle: period, columns: [t.common.date, tr("عدد القيود"), t.journal.debit, t.journal.credit], rows };
    }
    case "budget-vs-actual": {
      const [fy, depts] = await Promise.all([
        ctx.supabase.from("fiscal_years").select("id, name, start_date, end_date").eq("hotel_id", ctx.hotel.id).lte("start_date", p.to).gte("end_date", p.to).maybeSingle(),
        p.department ? listDepartments(ctx.supabase, ctx.hotel.id) : Promise.resolve([]),
      ]);
      raise(fy.error);
      const cols = [r.account, tr("الموازنة"), tr("الفعلي"), tr("الانحراف"), tr("نسبة التحقيق")];
      if (!fy.data) return { title: tr("الموازنة مقابل الفعلي"), subtitle: tr("لا توجد سنة مالية تشمل {0}", p.to), columns: cols, rows: [] };
      const per = await ctx.supabase.from("accounting_periods").select("period_no, name").eq("fiscal_year_id", fy.data.id).lte("start_date", p.to).gte("end_date", p.to).maybeSingle();
      raise(per.error);
      const { data, error } = await ctx.supabase.rpc("budget_vs_actual", {
        p_hotel_id: ctx.hotel.id, p_fiscal_year_id: fy.data.id, p_to_period: per.data?.period_no ?? null, p_department_id: p.department ?? null,
      }).select("account_id, code, name_ar, name_en, account_type, budget::text, actual::text, variance::text");
      raise(error);
      const pct = (actual: Money, budget: Money) => {
        if (budget.isZero()) return "";
        const v = actual.div(budget).times(100);
        return `${v.abs().lt(10) ? v.toFixed(1) : v.toFixed(0)}%`;
      };
      const rows: ReportRow[] = [];
      const totals: Record<string, [Money, Money]> = {};
      for (const type of ["revenue", "expense"] as const) {
        const list = (data ?? []).filter((x) => x.account_type === type);
        if (!list.length) continue;
        rows.push(head(type === "revenue" ? tr("الإيرادات") : tr("المصروفات"), cols.length));
        for (const x of list) {
          rows.push(acc({ id: x.account_id, code: x.code }, (locale === "en" && x.name_en) || x.name_ar, toMoney(x.budget), toMoney(x.actual), toMoney(x.variance), pct(toMoney(x.actual), toMoney(x.budget))));
        }
        const b = sumMoney(list.map((x) => x.budget)), a = sumMoney(list.map((x) => x.actual));
        totals[type] = [b, a];
        rows.push(sub(type === "revenue" ? tr("إجمالي الإيرادات") : tr("إجمالي المصروفات"), b, a, sumMoney(list.map((x) => x.variance)), pct(a, b)));
      }
      const [rb, ra] = totals.revenue ?? [toMoney(0), toMoney(0)];
      const [eb, ea] = totals.expense ?? [toMoney(0), toMoney(0)];
      if (rows.length) rows.push(total(tr("صافي الربح"), rb.minus(eb), ra.minus(ea), ra.minus(ea).minus(rb.minus(eb)), pct(ra.minus(ea), rb.minus(eb))));
      const dept = p.department ? depts.find((d) => d.id === p.department) : undefined;
      return { title: tr("الموازنة مقابل الفعلي"),
        subtitle: [fy.data.name, per.data ? tr("حتى نهاية {0}", per.data.name) : "", dept ? ((locale === "en" && dept.name_en) || dept.name_ar) : ""].filter(Boolean).join("، "),
        columns: cols, rows,
        note: rows.length ? { ok: true, text: tr("الانحراف الموجب في صالح الفندق: إيراد أعلى من المخطط أو مصروف أقل منه.") }
          : { ok: false, text: tr("لا توجد موازنة ولا حركة لهذه الفترة. أدخل الموازنة من صفحة الموازنة التقديرية.") } };
    }
    case "item-card":
    case "stock-balances":
    case "count-sheet":
    case "item-prices":
    case "expiring-stock":
      return inventoryReport(key, ctx, locale, p);
    case "guest-balances":
    case "reservations-report":
    case "occupancy-monthly":
      return hotelReport(key, ctx, t, locale, p);
    case "currency-trial-balance": {
      const [res, accounts] = await Promise.all([
        ctx.supabase.rpc("currency_trial_balance", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to }).select("account_id, currency_code, debit::text, credit::text, base_debit::text, base_credit::text"),
        ctx.supabase.from("chart_of_accounts").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id),
      ]);
      raise(res.error); raise(accounts.error);
      const accBy = new Map((accounts.data ?? []).map((a) => [a.id, a]));
      const list = (res.data ?? []).filter((x) => accBy.has(x.account_id));
      const currencies = [...new Set(list.map((x) => x.currency_code))].sort();
      const rows: ReportRow[] = [];
      for (const c of currencies) {
        rows.push(head(c, 7));
        const cl = list.filter((x) => x.currency_code === c).sort((a, b) => accBy.get(a.account_id)!.code.localeCompare(accBy.get(b.account_id)!.code));
        for (const x of cl) {
          const a = accBy.get(x.account_id)!;
          const net = toMoney(x.debit).minus(toMoney(x.credit));
          rows.push(acc(a, (locale === "en" && a.name_en) || a.name_ar, toMoney(x.debit), toMoney(x.credit), net, toMoney(x.base_debit), toMoney(x.base_credit), toMoney(x.base_debit).minus(toMoney(x.base_credit))));
        }
        rows.push(sub(tr("إجمالي {0}", c), sumMoney(cl.map((x) => x.debit)), sumMoney(cl.map((x) => x.credit)), "", sumMoney(cl.map((x) => x.base_debit)), sumMoney(cl.map((x) => x.base_credit)), ""));
      }
      return { title: tr("ميزان المراجعة بالعملات"), subtitle: period,
        columns: [r.account, tr("مدين بالعملة"), tr("دائن بالعملة"), tr("الصافي بالعملة"), tr("مدين {0}", ctx.hotel.base_currency), tr("دائن {0}", ctx.hotel.base_currency), tr("الصافي {0}", ctx.hotel.base_currency)], rows,
        note: rows.length ? { ok: true, text: tr("يعرض القيود المسجلة بعملة أجنبية فقط، بمبالغها بالعملة وما يعادلها بالعملة الأساسية.") }
          : { ok: true, text: tr("لا قيود بعملات أجنبية في هذه الفترة.") } };
    }
    case "cash-by-currency": {
      const { data, error } = await ctx.supabase.rpc("cash_by_currency", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to })
        .select("account_id, account_code, account_name, currency_code, is_base, methods, opening::text, receipts::text, payments::text, closing::text, rate::text, closing_base::text");
      raise(error);
      const list = data ?? [];
      const base = ctx.hotel.base_currency;
      const currencies = [...new Set(list.map((x) => x.currency_code))].sort((a, b) => Number(b === base) - Number(a === base) || a.localeCompare(b));
      const rows: ReportRow[] = [];
      let missingRate = false;
      for (const c of currencies) {
        const cl = list.filter((x) => x.currency_code === c);
        rows.push(head(c === base ? tr("{0} (العملة الأساسية)", c) : c, 7));
        for (const x of cl) {
          if (x.closing_base == null) missingRate = true;
          rows.push(acc({ id: x.account_id, code: x.account_code }, x.methods && x.methods !== x.account_name ? `${x.account_name}، ${x.methods}` : x.account_name,
            toMoney(x.opening), toMoney(x.receipts), toMoney(x.payments), toMoney(x.closing),
            x.rate == null ? "" : c === base ? "" : String(Number(x.rate)), x.closing_base == null ? "" : toMoney(x.closing_base)));
        }
        rows.push(sub(tr("إجمالي {0}", c), sumMoney(cl.map((x) => x.opening)), sumMoney(cl.map((x) => x.receipts)), sumMoney(cl.map((x) => x.payments)),
          sumMoney(cl.map((x) => x.closing)), "", sumMoney(cl.map((x) => x.closing_base ?? "0"))));
      }
      if (rows.length) rows.push(total(tr("الإجمالي بالعملة الأساسية {0}", base), "", "", "", "", "", sumMoney(list.map((x) => x.closing_base ?? "0"))));
      return { title: tr("النقدية بالعملات"), subtitle: p.from === p.to ? p.to : period,
        columns: [tr("الصندوق أو المحفظة"), tr("أول المدة"), tr("المقبوض"), tr("المدفوع"), tr("الرصيد بالعملة"), tr("سعر الصرف"), tr("المعادل {0}", base)], rows,
        note: missingRate ? { ok: false, text: tr("بعض العملات بلا سعر صرف حتى هذا التاريخ، فلم يُحسب معادلها. سجّل السعر من إعدادات العملات.") }
          : { ok: true, text: tr("كل صندوق أو محفظة بعملته، والمعادل بسعر صرف آخر يوم في الفترة. أرصدة العملات الأجنبية بوحداتها من الدفعات والتحويلات وفروقات عدّ الورديات.") } };
    }
    case "missing-numbers": {
      const { data, error } = await ctx.supabase.rpc("document_number_gaps", { p_hotel_id: ctx.hotel.id })
        .select("doc_type, year, prefix, last_value, missing_from, missing_to");
      raise(error);
      const names: Record<string, string> = {
        journal_entry: tr("القيود اليومية"), invoice: tr("الفواتير"), credit_note: tr("إشعارات الدائن"),
        voucher_receipt: tr("سندات القبض"), voucher_disbursement: tr("سندات الصرف"), vendor_bill: tr("فواتير الموردين"),
      };
      const num = (x: { prefix: string; year: number }, n: number) => `${x.prefix}-${x.year}-${String(n).padStart(6, "0")}`;
      const rows: ReportRow[] = (data ?? []).map((x) => line(names[x.doc_type] ?? x.doc_type, num(x, x.missing_from),
        x.missing_to === x.missing_from ? "" : num(x, x.missing_to), String(x.missing_to - x.missing_from + 1), num(x, x.last_value)));
      return { title: tr("تقرير الأرقام المفقودة"), subtitle: tr("حتى {0}", p.to),
        columns: [tr("المستند"), tr("من الرقم"), tr("إلى الرقم"), tr("العدد"), tr("آخر رقم صدر")], rows,
        note: rows.length ? { ok: false, text: tr("توجد أرقام مفقودة في التسلسل، راجع سجل التدقيق لمعرفة سببها.") }
          : { ok: true, text: tr("لا توجد أرقام مفقودة: كل الأرقام من الأول حتى آخر رقم صدر موجودة.") } };
    }
  }
}

/** كشف الحساب: افتتاحي، ثم الحركة بالرصيد الجاري، ثم المجاميع والختامي */
async function accountStatement(ctx: AppContext, locale: string, p: ReportParams): Promise<ReportTable> {
  const name = (a: { name_ar: string; name_en: string | null } | null | undefined) => (a && ((locale === "en" && a.name_en) || a.name_ar)) || "";
  const cols = [tr("التاريخ"), tr("رقم القيد"), tr("البيان"), tr("مدين"), tr("دائن"), tr("الرصيد"), tr("طبيعته")];
  if (!p.account && !p.department) {
    return { title: tr("كشف حساب"), subtitle: tr("اختر حسابًا أو مركز تكلفة لعرض الكشف."), columns: cols, rows: [] };
  }
  const [res, account, department] = await Promise.all([
    ctx.supabase.rpc("account_statement", { p_hotel_id: ctx.hotel.id, p_account_id: p.account ?? null, p_department_id: p.department ?? null, p_from: p.from, p_to: p.to })
      .select("is_opening, entry_number, entry_date, reference, description, debit::text, credit::text"),
    p.account ? ctx.supabase.from("chart_of_accounts").select("code, name_ar, name_en, is_postable").eq("hotel_id", ctx.hotel.id).eq("id", p.account).maybeSingle() : Promise.resolve({ data: null, error: null }),
    p.department ? ctx.supabase.from("departments").select("code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("id", p.department).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  raise(res.error);
  type Row = { is_opening: boolean; entry_number: string | null; entry_date: string; reference: string | null; description: string | null; debit: string; credit: string };
  const data = (res.data ?? []) as unknown as Row[];
  const opening = data.find((x) => x.is_opening);
  const moves = data.filter((x) => !x.is_opening).sort((a, b) => a.entry_date.localeCompare(b.entry_date) || (a.entry_number ?? "").localeCompare(b.entry_number ?? ""));
  const side = (m: Money) => (m.isZero() ? "" : m.isPositive() ? tr("مدين") : tr("دائن"));
  let bal = toMoney(opening?.debit ?? "0").minus(toMoney(opening?.credit ?? "0"));
  const rows: ReportRow[] = [line(p.from, null, tr("الرصيد الافتتاحي"), null, null, bal.abs(), side(bal))];
  let dr = toMoney("0"), cr = toMoney("0");
  for (const x of moves) {
    const d = toMoney(x.debit), c = toMoney(x.credit);
    bal = bal.plus(d).minus(c); dr = dr.plus(d); cr = cr.plus(c);
    rows.push(line(x.entry_date, x.entry_number, [x.description, x.reference].filter(Boolean).join("، "), d.isZero() ? null : d, c.isZero() ? null : c, bal.abs(), side(bal)));
  }
  rows.push(total(tr("مجموع الحركة"), null, null, dr, cr, null, null), total(tr("الرصيد الختامي"), null, null, null, null, bal.abs(), side(bal)));
  const a = account.data as { code: string; name_ar: string; name_en: string | null; is_postable: boolean } | null;
  const dep = department.data as { code: string; name_ar: string; name_en: string | null } | null;
  const parts = [a ? `${a.code} ${name(a)}${a.is_postable ? "" : ` (${tr("إجمالي بكل فروعه")})`}` : "", dep ? tr("مركز التكلفة {0}", name(dep)) : ""].filter(Boolean);
  return { title: tr("كشف حساب {0}", parts.join("، ")), subtitle: tr("من {0} إلى {1}", p.from, p.to), columns: cols, rows };
}

/** تقارير المخزون: بطاقة الصنف، أرصدة الكميات، كشف الجرد للطباعة، الأسعار، والقريب انتهاؤه */
async function inventoryReport(key: "item-card" | "stock-balances" | "count-sheet" | "item-prices" | "expiring-stock", ctx: AppContext, locale: string, p: ReportParams): Promise<ReportTable> {
  const h = ctx.hotel.id;
  const nm = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const qty = (v: string | number) => toMoney(v).toDecimalPlaces(3).toString();
  const [itemsRes, catsRes] = await Promise.all([
    ctx.supabase.from("inventory_items").select("id, sku, name_ar, name_en, unit, category_id, barcode, quantity_on_hand::text, average_cost::text, stock_value::text, sale_price::text, reorder_level::text, is_active")
      .eq("hotel_id", h).order("sku"),
    ctx.supabase.from("inventory_categories").select("id, code, name_ar, name_en").eq("hotel_id", h).order("code"),
  ]);
  raise(itemsRes.error); raise(catsRes.error);
  const cats = new Map((catsRes.data ?? []).map((c) => [c.id, c]));
  const items = (itemsRes.data ?? []).filter((x) => !p.category || x.category_id === p.category);
  const catName = (id: string | null) => (id && cats.get(id) ? nm(cats.get(id)!) : tr("بلا فئة"));
  const catSub = p.category && cats.get(p.category) ? nm(cats.get(p.category)!) : "";

  if (key === "item-card") {
    const cols = [tr("التاريخ"), tr("الحركة"), tr("البيان"), tr("وارد"), tr("صادر"), tr("الرصيد"), tr("تكلفة الوحدة"), tr("القيمة")];
    const item = (itemsRes.data ?? []).find((x) => x.id === p.item);
    if (!item) return { title: tr("بطاقة صنف"), subtitle: tr("اختر صنفًا لعرض حركته."), columns: cols, rows: [] };
    const { data, error } = await ctx.supabase.from("inventory_transactions")
      .select("txn_date, txn_type, description, quantity::text, unit_cost::text, total_cost::text, created_at")
      .eq("item_id", item.id).lte("txn_date", p.to).order("txn_date").order("created_at");
    raise(error);
    const TYPES: Record<string, string> = { receipt: tr("وارد"), issue: tr("صرف"), adjustment: tr("تسوية جرد") };
    let bal = toMoney(0), val = toMoney(0);
    const before = (data ?? []).filter((t) => t.txn_date < p.from);
    for (const t of before) { bal = bal.plus(toMoney(t.quantity)); val = val.plus(toMoney(t.quantity).gt(0) ? toMoney(t.total_cost) : toMoney(t.total_cost).neg()); }
    const rows: ReportRow[] = [{ kind: "subtotal", cells: [p.from, tr("رصيد أول المدة"), "", "", "", qty(bal.toString()), "", val] }];
    let inQ = toMoney(0), outQ = toMoney(0);
    for (const t of (data ?? []).filter((x) => x.txn_date >= p.from)) {
      const q = toMoney(t.quantity);
      bal = bal.plus(q); val = val.plus(q.gt(0) ? toMoney(t.total_cost) : toMoney(t.total_cost).neg());
      if (q.gt(0)) inQ = inQ.plus(q); else outQ = outQ.plus(q.abs());
      rows.push(line(t.txn_date, TYPES[t.txn_type] ?? t.txn_type, t.description ?? "", q.gt(0) ? qty(q.toString()) : "", q.lt(0) ? qty(q.abs().toString()) : "",
        qty(bal.toString()), toMoney(t.unit_cost), val));
    }
    rows.push(total(tr("الإجمالي"), "", "", qty(inQ.toString()), qty(outQ.toString()), qty(bal.toString()), "", val));
    return { title: tr("بطاقة صنف"), subtitle: [`${item.sku} ${nm(item)}`, item.unit, tr("من {0} إلى {1}", p.from, p.to)].join("، "), columns: cols, rows };
  }

  if (key === "expiring-stock") {
    const { data, error } = await ctx.supabase.from("inventory_lots").select("item_id, expiry_date, received_on, remaining_qty::text")
      .eq("hotel_id", h).gt("remaining_qty", 0).order("expiry_date");
    raise(error);
    const byId = new Map((itemsRes.data ?? []).map((x) => [x.id, x]));
    const limit = new Date(`${p.to}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 60);
    const until = limit.toISOString().slice(0, 10);
    const rows: ReportRow[] = (data ?? []).filter((l) => l.expiry_date && l.expiry_date <= until && byId.has(l.item_id) && (!p.category || byId.get(l.item_id)!.category_id === p.category))
      .map((l) => {
        const it = byId.get(l.item_id)!;
        const days = Math.round((Date.parse(`${l.expiry_date}T00:00:00Z`) - Date.parse(`${p.to}T00:00:00Z`)) / 864e5);
        return { kind: "line" as const, code: it.sku, cells: [nm(it), l.expiry_date!, days < 0 ? tr("منتهٍ منذ {0} يوم", -days) : days === 0 ? tr("ينتهي اليوم") : tr("بعد {0} يوم", days),
          qty(l.remaining_qty), it.unit, toMoney(l.remaining_qty).times(toMoney(it.average_cost)).toDecimalPlaces(2)] };
      });
    return { title: tr("الأصناف القريبة من الانتهاء"), subtitle: [tr("المنتهية وما ينتهي خلال 60 يومًا من {0}", p.to), catSub].filter(Boolean).join("، "),
      columns: [tr("الصنف"), tr("تاريخ الانتهاء"), tr("المتبقي"), tr("الكمية"), tr("الوحدة"), tr("القيمة التقريبية")], rows,
      note: rows.length ? { ok: false, text: tr("اصرف الأقرب انتهاءً أولًا، وسجّل التالف بتسوية جرد.") } : { ok: true, text: tr("لا أصناف منتهية أو قريبة من الانتهاء.") } };
  }

  // الأرصدة، كشف الجرد، الأسعار: مجمّعة حسب الفئة
  const groups = new Map<string, typeof items>();
  for (const x of items.filter((i) => i.is_active)) {
    const k = x.category_id ?? "";
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => catName(a || null).localeCompare(catName(b || null)));
  const rows: ReportRow[] = [];
  if (key === "stock-balances") {
    const cols = [tr("الصنف"), tr("الوحدة"), tr("الكمية"), tr("متوسط التكلفة"), tr("القيمة"), tr("حد إعادة الطلب")];
    for (const [k, list] of ordered) {
      rows.push(head(catName(k || null), cols.length));
      for (const x of list) rows.push({ kind: "line", code: x.sku, cells: [nm(x), x.unit, qty(x.quantity_on_hand), toMoney(x.average_cost).toDecimalPlaces(4), toMoney(x.stock_value), qty(x.reorder_level)] });
      rows.push(sub(tr("إجمالي الفئة"), "", "", "", sumMoney(list.map((x) => x.stock_value)), ""));
    }
    rows.push(total(tr("إجمالي المخزون"), "", "", "", sumMoney(items.filter((i) => i.is_active).map((x) => x.stock_value)), ""));
    return { title: tr("كشف الكميات إجمالي"), subtitle: [tr("حتى {0}", p.to), catSub].filter(Boolean).join("، "), columns: cols, rows };
  }
  if (key === "count-sheet") {
    const cols = [tr("الصنف"), tr("الباركود"), tr("الوحدة"), tr("الكمية بالنظام"), tr("الكمية المعدودة"), tr("ملاحظة")];
    for (const [k, list] of ordered) {
      rows.push(head(catName(k || null), cols.length));
      for (const x of list) rows.push({ kind: "line", code: x.sku, cells: [nm(x), x.barcode ?? "", x.unit, qty(x.quantity_on_hand), "", ""] });
    }
    return { title: tr("كشف جرد المخزون"), subtitle: [tr("تاريخ الجرد {0}", p.to), catSub].filter(Boolean).join("، "), columns: cols, rows,
      note: { ok: true, text: tr("اطبع الكشف وعدّ الأصناف، ثم أدخل الكميات المعدودة في شاشة الجرد لترحيل الفروقات.") } };
  }
  const cols = [tr("الصنف"), tr("الباركود"), tr("الوحدة"), tr("متوسط التكلفة"), tr("سعر البيع"), tr("هامش الربح")];
  for (const [k, list] of ordered) {
    rows.push(head(catName(k || null), cols.length));
    for (const x of list) {
      const cost = toMoney(x.average_cost), price = x.sale_price ? toMoney(x.sale_price) : null;
      const margin = price && price.gt(0) ? `${price.minus(cost).div(price).times(100).toFixed(1)}%` : "";
      rows.push({ kind: "line", code: x.sku, cells: [nm(x), x.barcode ?? "", x.unit, cost.toDecimalPlaces(4), price, margin] });
    }
  }
  return { title: tr("تقرير أسعار الأصناف"), subtitle: catSub, columns: cols, rows };
}

/** تقارير الفندق: أرصدة النزلاء، تقرير الحجوزات بفلاتره، والإشغال الشهري */
async function hotelReport(key: "guest-balances" | "reservations-report" | "occupancy-monthly", ctx: AppContext, t: Dictionary, locale: string, p: ReportParams): Promise<ReportTable> {
  const h = ctx.hotel.id;
  if (key === "guest-balances") {
    const [folios, balances] = await Promise.all([
      ctx.supabase.from("guest_folios").select("id, folio_number, guest_name, room_number, arrival_date, departure_date").eq("hotel_id", h).eq("status", "open").order("room_number"),
      ctx.supabase.from("folio_balances").select("folio_id, balance::text, deposit_balance::text").eq("hotel_id", h),
    ]);
    raise(folios.error); raise(balances.error);
    const bal = new Map((balances.data ?? []).map((b) => [b.folio_id, b]));
    const list = (folios.data ?? []).map((f) => ({ f, b: toMoney(bal.get(f.id)?.balance), d: toMoney(bal.get(f.id)?.deposit_balance) }))
      .filter((x) => !x.b.isZero() || !x.d.isZero());
    const rows: ReportRow[] = list.map(({ f, b, d }) => line(f.folio_number, f.guest_name, f.room_number ?? "", f.arrival_date ?? "", f.departure_date ?? "", b, d, b.minus(d)));
    const tb = sumMoney(list.map((x) => x.b.toString())), td = sumMoney(list.map((x) => x.d.toString()));
    rows.push(total(tr("الإجمالي"), tr("{0} فوليو", list.length), "", "", "", tb, td, tb.minus(td)));
    return { title: tr("تقرير أرصدة النزلاء"), subtitle: tr("الفوليوهات المفتوحة حتى {0}", p.to),
      columns: [tr("الفوليو"), tr("النزيل"), tr("الغرفة"), tr("الوصول"), tr("المغادرة"), tr("الرصيد"), tr("العربون"), tr("الصافي المستحق")], rows,
      note: { ok: true, text: tr("الصافي المستحق هو الرصيد بعد خصم العربون غير المطبّق. الموجب على النزيل والسالب له.") } };
  }
  if (key === "reservations-report") {
    let q = ctx.supabase.from("reservations")
      .select("confirmation_number, arrival_date, departure_date, status, source, total_amount::text, adults, children, guest:guests(full_name, phone), room:rooms(room_number), room_type:room_types(code, name_ar)")
      .eq("hotel_id", h).gte("arrival_date", p.from).lte("arrival_date", p.to);
    if (p.status) q = q.eq("status", p.status as ReservationStatus);
    if (p.source) q = q.eq("source", p.source as ReservationSource);
    const { data, error } = await q.order("arrival_date").order("confirmation_number").limit(5000);
    raise(error);
    const { RESERVATION_SOURCE, RESERVATION_STATUS } = await import("@/lib/pms/labels");
    type Row = { confirmation_number: string; arrival_date: string; departure_date: string; status: keyof typeof RESERVATION_STATUS; source: keyof typeof RESERVATION_SOURCE; total_amount: string; adults: number; children: number;
      guest: { full_name: string; phone: string | null } | null; room: { room_number: string } | null; room_type: { code: string; name_ar: string } | null };
    const list = (data ?? []) as unknown as Row[];
    const nights = (r: Row) => Math.max(0, Math.round((Date.parse(`${r.departure_date}T00:00:00Z`) - Date.parse(`${r.arrival_date}T00:00:00Z`)) / 864e5));
    const rows: ReportRow[] = list.map((r) => line(r.confirmation_number, r.guest?.full_name ?? "", r.guest?.phone ?? "", r.room_type?.code ?? "", r.room?.room_number ?? "",
      r.arrival_date, r.departure_date, String(nights(r)), RESERVATION_SOURCE[r.source] ?? r.source, RESERVATION_STATUS[r.status]?.label ?? r.status, toMoney(r.total_amount)));
    rows.push(total(tr("الإجمالي"), tr("{0} حجز", list.length), "", "", "", "", "", String(list.reduce((n, r) => n + nights(r), 0)), "", "", sumMoney(list.map((r) => r.total_amount))));
    const sub = [tr("الوصول من {0} إلى {1}", p.from, p.to), p.status ? RESERVATION_STATUS[p.status as keyof typeof RESERVATION_STATUS]?.label : "", p.source ? RESERVATION_SOURCE[p.source as keyof typeof RESERVATION_SOURCE] : ""].filter(Boolean).join("، ");
    return { title: tr("تقرير الحجوزات"), subtitle: sub,
      columns: [tr("الحجز"), tr("النزيل"), tr("الجوال"), tr("النوع"), tr("الغرفة"), tr("الوصول"), tr("المغادرة"), tr("الليالي"), tr("المصدر"), tr("الحالة"), tr("المبلغ")], rows };
  }
  // الإشغال الشهري: من إحصاءات الغرف اليومية مجمّعة بالشهر
  const { days } = await getRoomStats(ctx.supabase, h, p.from, p.to);
  const months = new Map<string, typeof days>();
  for (const d of days) months.set(d.business_date.slice(0, 7), [...(months.get(d.business_date.slice(0, 7)) ?? []), d]);
  const pct = (m: Money | null) => (m ? `${m.toFixed(1)}%` : "");
  const rows: ReportRow[] = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, list]) => {
    const k = roomKpis(list);
    return line(m, k.roomNightsSold.toString(), k.roomNightsAvailable.toString(), pct(k.occupancy), k.roomRevenue, k.adr, k.revpar);
  });
  const all = roomKpis(days);
  rows.push(total(t.common.total, all.roomNightsSold.toString(), all.roomNightsAvailable.toString(), pct(all.occupancy), all.roomRevenue, all.adr, all.revpar));
  const r = t.reports;
  return { title: tr("تقرير الإشغال الشهري"), subtitle: tr("من {0} إلى {1}", p.from, p.to),
    columns: [tr("الشهر"), r.roomNights, r.available, r.occupancy, r.roomRevenue, r.adr, r.revpar], rows,
    note: ctx.hotel.total_rooms ? undefined : { ok: false, text: r.setRooms } };
}
