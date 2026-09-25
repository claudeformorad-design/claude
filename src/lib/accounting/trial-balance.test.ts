import { describe, expect, it } from "vitest";
import { buildTrialBalance, type AccountActivity, type TrialBalanceAccount } from "./trial-balance";

const acc = (id: string, code: string, account_type: TrialBalanceAccount["account_type"], system_key: string | null = null): TrialBalanceAccount => ({
  id, code, name_ar: code, name_en: code, account_type, system_key,
});

const accounts = [
  acc("cash", "1101", "asset"),
  acc("capital", "3101", "equity"),
  acc("re", "3102", "equity", "retained_earnings"),
  acc("rooms", "4101", "revenue"),
  acc("salaries", "5201", "expense"),
];

const act = (account_id: string, v: Partial<Omit<AccountActivity, "account_id">>): AccountActivity => ({
  account_id,
  prior_years_debit: 0, prior_years_credit: 0,
  ytd_before_debit: 0, ytd_before_credit: 0,
  period_debit: 0, period_credit: 0,
  ...v,
});

describe("buildTrialBalance — ميزان المراجعة", () => {
  it("يتوازن ويحسب الأرصدة الختامية", () => {
    const tb = buildTrialBalance(accounts, [
      act("cash", { period_debit: "100000", period_credit: "2000" }),
      act("capital", { period_credit: "100000" }),
      act("rooms", { period_credit: "5000" }),
      act("salaries", { period_debit: "7000" }),
    ]);
    expect(tb.isBalanced).toBe(true);
    expect(tb.rows.find((r) => r.account?.id === "cash")?.closing.toString()).toBe("98000");
    expect(tb.totals.periodDebit.toString()).toBe("107000");
  });

  it("يُقفل أرباح السنوات السابقة في الأرباح المبقاة ويبدأ الإيرادات من الصفر", () => {
    const tb = buildTrialBalance(accounts, [
      act("cash", { prior_years_debit: "8000", period_debit: "1000" }),
      act("capital", { prior_years_credit: "5000" }),
      act("rooms", { prior_years_credit: "4000", period_credit: "1000" }),
      act("salaries", { prior_years_debit: "1000" }),
    ]);
    const row = (id: string) => tb.rows.find((r) => r.account?.id === id);

    expect(row("rooms")?.opening.toString()).toBe("0");
    expect(row("rooms")?.closing.toString()).toBe("-1000");
    expect(row("salaries")).toBeUndefined(); // لا حركة هذه السنة ⇒ رصيد صفري مخفي
    // صافي ربح السنوات السابقة = 4000 − 1000 = 3000 دائن
    expect(tb.priorYearsEarnings.toString()).toBe("3000");
    expect(row("re")?.opening.toString()).toBe("-3000");
    expect(tb.isBalanced).toBe(true);
    expect(tb.totals.closingDebit.toString()).toBe("9000");
    expect(tb.totals.closingCredit.toString()).toBe("9000");
  });

  it("يضيف صفًا للأرباح المبقاة إن لم يوجد حساب مخصص", () => {
    const tb = buildTrialBalance(accounts.filter((a) => a.id !== "re"), [
      act("cash", { prior_years_debit: "500" }),
      act("rooms", { prior_years_credit: "500" }),
    ]);
    expect(tb.rows.some((r) => r.account === null)).toBe(true);
    expect(tb.isBalanced).toBe(true);
  });

  it("يحسب الرصيد الافتتاحي من الحركة السابقة داخل السنة", () => {
    const tb = buildTrialBalance(accounts, [
      act("cash", { ytd_before_debit: "300", period_credit: "100" }),
      act("rooms", { ytd_before_credit: "300" }),
      act("salaries", { period_debit: "100" }),
    ]);
    const cash = tb.rows.find((r) => r.account?.id === "cash");
    expect(cash?.opening.toString()).toBe("300");
    expect(cash?.closing.toString()).toBe("200");
    expect(tb.totals.openingDebit.toString()).toBe("300");
    expect(tb.isBalanced).toBe(true);
  });
});
