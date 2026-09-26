import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

export interface ProfitabilityRow {
  department_id: string | null;
  account_type: "revenue" | "expense";
  account_subtype: string;
  amount: MoneyInput;
}

export interface DepartmentResult {
  departmentId: string | null;
  revenue: Money;
  costOfSales: Money;
  operatingExpenses: Money;
  grossProfit: Money;
  netProfit: Money;
  /** هامش الربح الصافي % (null إن لم يكن هناك إيراد) */
  margin: Money | null;
}

/** ربحية كل قسم: الإيراد − تكلفة المبيعات = مجمل الربح؛ − باقي المصروفات = صافي ربح القسم */
export function summarizeProfitability(rows: readonly ProfitabilityRow[]): { departments: DepartmentResult[]; total: DepartmentResult } {
  const map = new Map<string, { revenue: Money; cos: Money; opex: Money }>();
  for (const r of rows) {
    const key = r.department_id ?? "";
    const d = map.get(key) ?? { revenue: ZERO, cos: ZERO, opex: ZERO };
    const amt = toMoney(r.amount);
    if (r.account_type === "revenue") d.revenue = d.revenue.plus(amt);
    else if (r.account_subtype === "cost_of_sales") d.cos = d.cos.plus(amt);
    else d.opex = d.opex.plus(amt);
    map.set(key, d);
  }
  const build = (id: string | null, d: { revenue: Money; cos: Money; opex: Money }): DepartmentResult => {
    const gross = d.revenue.minus(d.cos);
    const net = gross.minus(d.opex);
    return {
      departmentId: id, revenue: d.revenue, costOfSales: d.cos, operatingExpenses: d.opex, grossProfit: gross, netProfit: net,
      margin: d.revenue.isZero() ? null : net.div(d.revenue).times(100),
    };
  };
  const departments = [...map.entries()].map(([k, d]) => build(k || null, d)).sort((a, b) => b.revenue.comparedTo(a.revenue));
  const sum = [...map.values()].reduce(
    (acc, d) => ({ revenue: acc.revenue.plus(d.revenue), cos: acc.cos.plus(d.cos), opex: acc.opex.plus(d.opex) }),
    { revenue: ZERO, cos: ZERO, opex: ZERO },
  );
  return { departments, total: build(null, sum) };
}
