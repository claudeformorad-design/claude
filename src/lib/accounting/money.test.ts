import { describe, expect, it } from "vitest";
import { formatMoney, isValidAmount, roundMoney, sumMoney, toMoney } from "./money";
import { mapDatabaseError } from "./errors";

describe("money", () => {
  it("يجمع بدقة عشرية", () => {
    expect(sumMoney([0.1, 0.2, "0.3"]).toString()).toBe("0.6");
  });
  it("يقرّب نصف للأعلى حسب خانات العملة", () => {
    expect(roundMoney("2.345", 2).toString()).toBe("2.35");
    expect(roundMoney("1.2345", 3).toString()).toBe("1.235");
  });
  it("يعامل القيم الفارغة كصفر ويرفض النصوص غير الرقمية", () => {
    expect(toMoney("").isZero()).toBe(true);
    expect(isValidAmount("12a")).toBe(false);
  });
  it("ينسق المبالغ بأرقام لاتينية", () => {
    expect(formatMoney("1234.5", { locale: "en" })).toBe("1,234.50");
    expect(formatMoney("1234.5", { locale: "ar", decimals: 3 })).toMatch(/1.234.500/);
  });
});

describe("mapDatabaseError", () => {
  it("يحول رسائل قاعدة البيانات إلى مفاتيح ترجمة", () => {
    expect(mapDatabaseError("Journal entry is not balanced: debit 5 <> credit 4")).toBe("not_balanced");
    expect(mapDatabaseError("Accounting period 2026-09 is closed")).toBe("period_closed");
    expect(mapDatabaseError("Permission denied: gl.journal.post")).toBe("permission_denied");
    expect(mapDatabaseError("something else")).toBe("unknown");
  });
});
