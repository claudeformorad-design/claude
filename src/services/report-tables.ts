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

/**
 * جدول تقرير موحّد: تعرضه الصفحات ويُصدّر كما هو إلى Excel (ما تراه هو ما تصدّره).
 * القيم المالية تبقى Money حتى لحظة العرض/التصدير.
 */
export type Cell = string | Money | null;
export interface ReportRow { kind: "section" | "line" | "subtotal" | "total"; cells: Cell[] }
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
} as const satisfies Record<string, Permission>;
export type ReportKey = keyof typeof REPORTS;

export interface ReportParams { from: string; to: string }

const line = (...cells: Cell[]): ReportRow => ({ kind: "line", cells });
const sub = (...cells: Cell[]): ReportRow => ({ kind: "subtotal", cells });
const total = (...cells: Cell[]): ReportRow => ({ kind: "total", cells });
const head = (text: string, width: number): ReportRow => ({ kind: "section", cells: [text, ...Array(width - 1).fill(null)] });

export async function buildReport(key: ReportKey, ctx: AppContext, t: Dictionary, locale: string, p: ReportParams): Promise<ReportTable> {
  const r = t.reports;
  const period = `من ${p.from} إلى ${p.to}`;
  switch (key) {
    case "income-statement": {
      const is = await getIncomeStatement(ctx.supabase, ctx.hotel, p.from, p.to, locale);
      const rows: ReportRow[] = [];
      const block = (k: keyof typeof is.sections) => {
        const s = is.sections[k];
        if (!s.lines.length) return;
        rows.push(head(r.sections[k], 2), ...s.lines.map((l) => line(`${l.account.code} ${l.account.name}`, l.amount)), sub(r.sections[k], s.total));
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
        rows.push(head(r.sections[k], 2), ...s.lines.map((l) => line(`${l.account.code} ${l.account.name}`, l.amount)), sub(r.sections[k], s.total));
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
        return line(row.account ? `${row.account.code} ${name(row.account)}` : t.trialBalance.unallocatedEarnings,
          c.openingDebit, c.openingCredit, c.periodDebit, c.periodCredit, c.closingDebit, c.closingCredit);
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
      return { title: `${t.nav.aging}، ${kind === "receivable" ? t.payables.receivable : t.payables.payable}`, subtitle: `${r.asOf} ${p.to}`,
        columns: [t.vouchers.party, ...AGING_BUCKETS.map((b) => t.payables.buckets[b]), t.common.total], rows };
    }
    case "tax-return": {
      const { data, error } = await ctx.supabase.rpc("tax_return", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to })
        .select("code, name, kind, rate::text, sales_base::text, sales_tax::text, purchases_base::text, purchases_tax::text");
      raise(error);
      const a = t.admin;
      const rows = (data ?? []).map((x) => {
        const out = toMoney(x.sales_tax), inp = toMoney(x.purchases_tax);
        return line(`${x.code} ${x.name} ${toMoney(x.rate).toString()}%`, toMoney(x.sales_base), out, toMoney(x.purchases_base), inp, out.minus(inp));
      });
      const sum = (k: "sales_base" | "sales_tax" | "purchases_base" | "purchases_tax") => sumMoney((data ?? []).map((x) => x[k]));
      rows.push(total(t.common.total, sum("sales_base"), sum("sales_tax"), sum("purchases_base"), sum("purchases_tax"), sum("sales_tax").minus(sum("purchases_tax"))));
      return { title: t.nav.taxReturn, subtitle: `${period}، ${a.taxSubtitle}`,
        columns: [t.revenueSettings.taxes, a.salesBase, a.salesTax, a.purchasesBase, a.purchasesTax, a.netPayable], rows };
    }
    case "profitability": {
      const [res, departments] = await Promise.all([
        ctx.supabase.rpc("department_profitability", { p_hotel_id: ctx.hotel.id, p_from: p.from, p_to: p.to }).select("department_id, account_type, account_subtype, amount::text"),
        listDepartments(ctx.supabase, ctx.hotel.id),
      ]);
      raise(res.error);
      const { departments: ds, total: tt } = summarizeProfitability((res.data ?? []) as never);
      const dn = new Map(departments.map((d) => [d.id, `${d.code} ${(locale === "en" && d.name_en) || d.name_ar}`]));
      const pr = t.profitability;
      const cells = (x: typeof tt): Cell[] => [x.revenue, x.costOfSales, x.grossProfit, x.operatingExpenses, x.netProfit, x.margin ? `${x.margin.toFixed(1)}%` : ""];
      const rows = ds.map((x) => line(x.departmentId ? dn.get(x.departmentId) ?? "" : pr.unassigned, ...cells(x)));
      rows.push(total(t.common.total, ...cells(tt)));
      return { title: t.nav.profitability, subtitle: period, columns: [t.folio.department, pr.revenue, pr.cos, pr.gross, pr.opex, pr.net, pr.margin], rows };
    }
  }
}
