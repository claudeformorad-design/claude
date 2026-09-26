import type { AccountSubtype, AccountType } from "./accounts";
import { type Money, type MoneyInput, ZERO, toMoney } from "./money";
import type { TrialBalance } from "./trial-balance";

/**
 * القوائم المالية مبنية من ميزان المراجعة (نفس المصدر ⇒ لا تناقض بين التقارير).
 *
 * قائمة الدخل (للفترة): الإيرادات التشغيلية − تكلفة المبيعات = مجمل الربح
 *   − المصروفات التشغيلية − الإدارية = الربح التشغيلي + إيرادات أخرى − مصروفات أخرى = صافي الربح
 *
 * الميزانية العمومية (في تاريخ النهاية): الأصول = الخصوم + حقوق الملكية + أرباح السنة الجارية
 *   (أرباح السنوات السابقة مرحّلة للأرباح المبقاة داخل ميزان المراجعة).
 */
export interface StatementAccount {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype: AccountSubtype;
}

export interface StatementLine { account: StatementAccount; amount: Money }
export interface StatementSection { key: string; lines: StatementLine[]; total: Money }

export interface IncomeStatement {
  sections: Record<"operating_revenue" | "cost_of_sales" | "operating_expense" | "administrative_expense" | "other_revenue" | "other_expense", StatementSection>;
  revenue: Money;
  grossProfit: Money;
  operatingProfit: Money;
  netProfit: Money;
}

const section = (key: string, lines: StatementLine[]): StatementSection => ({
  key, lines: lines.filter((l) => !l.amount.isZero()).sort((a, b) => a.account.code.localeCompare(b.account.code)),
  total: lines.reduce((acc, l) => acc.plus(l.amount), ZERO),
});

/**
 * @param periodMovements حركة كل حساب في الفترة: مدين − دائن (موجب = مدين)
 */
export function buildIncomeStatement(
  accounts: readonly StatementAccount[],
  periodMovements: ReadonlyMap<string, MoneyInput>,
): IncomeStatement {
  const lines = (subtype: AccountSubtype) =>
    accounts.filter((a) => a.account_subtype === subtype).map((a) => {
      const net = toMoney(periodMovements.get(a.id) ?? 0);
      // الإيرادات بطبيعة دائنة (نعرضها موجبة)، والمصروفات بطبيعة مدينة
      return { account: a, amount: a.account_type === "revenue" ? net.negated() : net };
    });
  const sections = {
    operating_revenue: section("operating_revenue", lines("operating_revenue")),
    cost_of_sales: section("cost_of_sales", lines("cost_of_sales")),
    operating_expense: section("operating_expense", lines("operating_expense")),
    administrative_expense: section("administrative_expense", lines("administrative_expense")),
    other_revenue: section("other_revenue", lines("other_revenue")),
    other_expense: section("other_expense", lines("other_expense")),
  };
  const revenue = sections.operating_revenue.total;
  const grossProfit = revenue.minus(sections.cost_of_sales.total);
  const operatingProfit = grossProfit.minus(sections.operating_expense.total).minus(sections.administrative_expense.total);
  const netProfit = operatingProfit.plus(sections.other_revenue.total).minus(sections.other_expense.total);
  return { sections, revenue, grossProfit, operatingProfit, netProfit };
}

export interface BalanceSheet {
  sections: Record<"current_asset" | "fixed_asset" | "other_asset" | "current_liability" | "long_term_liability" | "equity", StatementSection>;
  totalAssets: Money;
  totalLiabilities: Money;
  currentYearEarnings: Money;
  totalEquity: Money;
  isBalanced: boolean;
}

/** الميزانية من الأرصدة الختامية لميزان المراجعة (بدءًا من بداية السنة المالية) */
export function buildBalanceSheet(accounts: readonly StatementAccount[], tb: TrialBalance): BalanceSheet {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const closing = new Map<string, Money>();
  let pnl = ZERO; // صافي مدين حسابات قائمة الدخل = −أرباح السنة
  let unallocated = ZERO;
  for (const row of tb.rows) {
    if (!row.account) { unallocated = unallocated.plus(row.closing); continue; }
    const a = byId.get(row.account.id);
    if (!a) continue;
    if (a.account_type === "revenue" || a.account_type === "expense") pnl = pnl.plus(row.closing);
    else closing.set(a.id, row.closing);
  }
  const lines = (subtype: AccountSubtype, sign: 1 | -1) =>
    accounts.filter((a) => a.account_subtype === subtype).map((a) => ({ account: a, amount: (closing.get(a.id) ?? ZERO).times(sign) }));
  const sections = {
    current_asset: section("current_asset", lines("current_asset", 1)),
    fixed_asset: section("fixed_asset", lines("fixed_asset", 1)),
    other_asset: section("other_asset", lines("other_asset", 1)),
    current_liability: section("current_liability", lines("current_liability", -1)),
    long_term_liability: section("long_term_liability", lines("long_term_liability", -1)),
    equity: section("equity", lines("equity", -1)),
  };
  const totalAssets = sections.current_asset.total.plus(sections.fixed_asset.total).plus(sections.other_asset.total);
  const totalLiabilities = sections.current_liability.total.plus(sections.long_term_liability.total);
  const currentYearEarnings = pnl.negated();
  const totalEquity = sections.equity.total.plus(currentYearEarnings).minus(unallocated);
  return {
    sections, totalAssets, totalLiabilities, currentYearEarnings, totalEquity,
    isBalanced: totalAssets.eq(totalLiabilities.plus(totalEquity)),
  };
}

export interface CashFlowLine { activity: "operating" | "investing" | "financing"; account_id: string; amount: MoneyInput }

/** قائمة التدفقات النقدية (مباشرة) من سطور cash_flow_lines */
export function buildCashFlow(lines: readonly CashFlowLine[], openingCash: MoneyInput, closingCash: MoneyInput) {
  const total = (k: CashFlowLine["activity"]) => lines.filter((l) => l.activity === k).reduce((acc, l) => acc.plus(toMoney(l.amount)), ZERO);
  const operating = total("operating"), investing = total("investing"), financing = total("financing");
  const net = operating.plus(investing).plus(financing);
  return {
    operating, investing, financing, net,
    opening: toMoney(openingCash), closing: toMoney(closingCash),
    reconciles: toMoney(openingCash).plus(net).eq(toMoney(closingCash)),
  };
}
