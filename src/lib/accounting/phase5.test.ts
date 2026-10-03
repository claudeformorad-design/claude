import { describe, expect, it } from "vitest";
import { roomKpis } from "./kpi";
import { buildBalanceSheet, buildCashFlow, buildIncomeStatement, type StatementAccount } from "./statements";
import { buildTrialBalance } from "./trial-balance";

const acc = (id: string, code: string, account_type: StatementAccount["account_type"], account_subtype: StatementAccount["account_subtype"]): StatementAccount =>
  ({ id, code, name: code, account_type, account_subtype });

const accounts = [
  acc("cash", "1101", "asset", "current_asset"),
  acc("furn", "1202", "asset", "fixed_asset"),
  acc("ap", "2101", "liability", "current_liability"),
  acc("loan", "2201", "liability", "long_term_liability"),
  acc("cap", "3101", "equity", "equity"),
  acc("re", "3102", "equity", "equity"),
  acc("rooms", "4101", "revenue", "operating_revenue"),
  acc("misc", "4201", "revenue", "other_revenue"),
  acc("cogs", "5101", "expense", "cost_of_sales"),
  acc("sal", "5201", "expense", "operating_expense"),
  acc("rent", "5301", "expense", "administrative_expense"),
];

describe("buildIncomeStatement — قائمة الدخل", () => {
  it("يحسب مجمل الربح والتشغيلي والصافي", () => {
    const is = buildIncomeStatement(accounts, new Map([
      ["rooms", "-10000"], ["misc", "-500"], ["cogs", "2000"], ["sal", "3000"], ["rent", "1000"],
    ]));
    expect(is.revenue.toString()).toBe("10000");
    expect(is.grossProfit.toString()).toBe("8000");
    expect(is.operatingProfit.toString()).toBe("4000");
    expect(is.netProfit.toString()).toBe("4500");
  });
});

describe("buildBalanceSheet — الميزانية العمومية", () => {
  it("تتوازن مع أرباح السنة الجارية", () => {
    const tb = buildTrialBalance(
      accounts.map((a) => ({ id: a.id, code: a.code, name_ar: a.name, name_en: null, account_type: a.account_type, system_key: a.id === "re" ? "retained_earnings" : null })),
      [
        { account_id: "cash", prior_years_debit: "20000", prior_years_credit: 0, ytd_before_debit: 0, ytd_before_credit: 0, period_debit: "10500", period_credit: "6000" },
        { account_id: "furn", prior_years_debit: "5000", prior_years_credit: 0, ytd_before_debit: 0, ytd_before_credit: 0, period_debit: 0, period_credit: 0 },
        { account_id: "cap", prior_years_debit: 0, prior_years_credit: "20000", ytd_before_debit: 0, ytd_before_credit: 0, period_debit: 0, period_credit: 0 },
        { account_id: "rooms", prior_years_debit: 0, prior_years_credit: "5000", ytd_before_debit: 0, ytd_before_credit: 0, period_debit: 0, period_credit: "10000" },
        { account_id: "misc", prior_years_debit: 0, prior_years_credit: 0, ytd_before_debit: 0, ytd_before_credit: 0, period_debit: 0, period_credit: "500" },
        { account_id: "sal", prior_years_debit: 0, prior_years_credit: 0, ytd_before_debit: 0, ytd_before_credit: 0, period_debit: "6000", period_credit: 0 },
      ],
    );
    const bs = buildBalanceSheet(accounts, tb);
    expect(bs.totalAssets.toString()).toBe("29500");
    expect(bs.currentYearEarnings.toString()).toBe("4500");
    // الأرباح المبقاة = أرباح السنوات السابقة 5000
    expect(bs.sections.equity.total.toString()).toBe("25000");
    expect(bs.isBalanced).toBe(true);
  });
});

describe("buildCashFlow — التدفقات النقدية", () => {
  it("يطابق تغير النقد", () => {
    const cf = buildCashFlow([
      { activity: "operating", account_id: "rooms", amount: "1000" },
      { activity: "operating", account_id: "sal", amount: "-3000" },
      { activity: "investing", account_id: "furn", amount: "-20000" },
      { activity: "financing", account_id: "cap", amount: "50000" },
    ], "0", "28000");
    expect(cf.operating.toString()).toBe("-2000");
    expect(cf.net.toString()).toBe("28000");
    expect(cf.reconciles).toBe(true);
  });
});

describe("roomKpis — الإشغال وADR وRevPAR", () => {
  it("مثال: 10 غرف، يومان، 5 ليالٍ مباعة بإيراد 2100", () => {
    const k = roomKpis([
      { room_nights: "3", room_revenue: "1200", rooms_available: 10 },
      { room_nights: "2", room_revenue: "900", rooms_available: 10 },
    ]);
    expect(k.occupancy!.toString()).toBe("25");
    expect(k.adr!.toString()).toBe("420");
    expect(k.revpar!.toString()).toBe("105");
    // RevPAR = الإشغال × ADR
    expect(k.occupancy!.div(100).times(k.adr!).eq(k.revpar!)).toBe(true);
  });
  it("لا قسمة على صفر", () => {
    const k = roomKpis([{ room_nights: 0, room_revenue: 0, rooms_available: 0 }]);
    expect(k.occupancy).toBeNull();
    expect(k.adr).toBeNull();
  });
});
