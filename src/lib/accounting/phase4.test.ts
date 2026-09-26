import { describe, expect, it } from "vitest";
import { disposalResult, straightLineSchedule, weightedAverageCost } from "./depreciation";
import { summarizeProfitability } from "./profitability";

describe("straightLineSchedule — الإهلاك بالقسط الثابت", () => {
  it("قسط ثابت وبنفس نتيجة قاعدة البيانات", () => {
    const s = straightLineSchedule("12000", "1200", 36);
    expect(s[0]!.toString()).toBe("300");
    expect(s.reduce((a, b) => a.plus(b)).toString()).toBe("10800");
  });
  it("الشهر الأخير يأخذ فرق التقريب", () => {
    expect(straightLineSchedule("1000", "0", 3).map(String)).toEqual(["333.33", "333.33", "333.34"]);
  });
  it("يرفض المدخلات غير الصالحة", () => {
    expect(() => straightLineSchedule("100", "100", 12)).toThrow();
    expect(() => straightLineSchedule("100", "0", 0)).toThrow();
  });
});

describe("disposalResult / weightedAverageCost", () => {
  it("خسارة البيع = المتحصلات − القيمة الدفترية", () => {
    const r = disposalResult("12000", "600", "11000");
    expect(r.netBookValue.toString()).toBe("11400");
    expect(r.gainLoss.toString()).toBe("-400");
  });
  it("المتوسط المرجّح", () => {
    expect(weightedAverageCost("10", "50", "10", "60").toString()).toBe("55");
    expect(weightedAverageCost("0", "0", "5", "12").toString()).toBe("12");
  });
});

describe("summarizeProfitability — ربحية الأقسام", () => {
  it("يحسب مجمل وصافي الربح والهامش لكل قسم", () => {
    const r = summarizeProfitability([
      { department_id: "fnb", account_type: "revenue", account_subtype: "operating_revenue", amount: "1000" },
      { department_id: "fnb", account_type: "expense", account_subtype: "cost_of_sales", amount: "400" },
      { department_id: "fnb", account_type: "expense", account_subtype: "operating_expense", amount: "350" },
      { department_id: "rooms", account_type: "revenue", account_subtype: "operating_revenue", amount: "5000" },
      { department_id: "rooms", account_type: "expense", account_subtype: "operating_expense", amount: "2000" },
      { department_id: null, account_type: "expense", account_subtype: "administrative_expense", amount: "500" },
    ]);
    const fnb = r.departments.find((d) => d.departmentId === "fnb")!;
    expect(fnb.grossProfit.toString()).toBe("600");
    expect(fnb.netProfit.toString()).toBe("250");
    expect(fnb.margin!.toString()).toBe("25");
    expect(r.departments[0]!.departmentId).toBe("rooms");
    expect(r.departments.find((d) => d.departmentId === null)!.margin).toBeNull();
    expect(r.total.netProfit.toString()).toBe("2750");
  });
});
