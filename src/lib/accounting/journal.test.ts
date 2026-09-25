import { describe, expect, it } from "vitest";
import { computeJournalTotals, reverseJournalLines, toBaseAmount, validateJournalEntry } from "./journal";

const A = "acc-cash";
const B = "acc-revenue";
const C = "acc-vat";

describe("validateJournalEntry — القيد المزدوج", () => {
  it("يقبل قيدًا متوازنًا من سطرين", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: "1150", credit: 0 },
      { account_id: B, debit: 0, credit: "1150" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.totals.debit.toString()).toBe("1150");
    expect(r.totals.isBalanced).toBe(true);
  });

  it("يقبل قيدًا مركبًا متعدد السطور", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: "1150" },
      { account_id: B, credit: "1000" },
      { account_id: C, credit: "150" },
    ]);
    expect(r.valid).toBe(true);
  });

  it("يرفض القيد غير المتوازن ويحسب الفرق", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: "100" },
      { account_id: B, credit: "99.99" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.entryErrors).toContain("not_balanced");
    expect(r.totals.difference.toString()).toBe("0.01");
  });

  it("لا يتأثر بأخطاء الفاصلة العائمة (0.1 + 0.2 = 0.3)", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: 0.1 },
      { account_id: A, debit: 0.2 },
      { account_id: B, credit: 0.3 },
    ]);
    expect(r.valid).toBe(true);
  });

  it("يرفض قيدًا بسطر واحد", () => {
    const r = validateJournalEntry([{ account_id: A, debit: 10 }]);
    expect(r.entryErrors).toContain("min_two_lines");
  });

  it("يرفض قيدًا مجموعه صفر", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: 0, credit: 0 },
      { account_id: B, debit: 0, credit: 0 },
    ]);
    expect(r.entryErrors).toContain("zero_total");
    expect(r.lineErrors.map((e) => e.code)).toEqual(["zero_line", "zero_line"]);
  });

  it("يرفض سطرًا مدينًا ودائنًا معًا", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: 10, credit: 10 },
      { account_id: B, credit: 0, debit: 0 },
    ]);
    expect(r.lineErrors).toContainEqual({ index: 0, code: "both_sides" });
  });

  it("يرفض المبالغ السالبة وغير الصالحة وأكثر من 4 خانات عشرية", () => {
    const r = validateJournalEntry([
      { account_id: A, debit: -5 },
      { account_id: B, credit: "abc" },
      { account_id: C, credit: "1.23456" },
    ]);
    expect(r.lineErrors).toContainEqual({ index: 0, code: "negative_amount" });
    expect(r.lineErrors).toContainEqual({ index: 1, code: "invalid_amount" });
    expect(r.lineErrors).toContainEqual({ index: 2, code: "too_many_decimals" });
  });

  it("يرفض سطرًا بلا حساب أو على حساب تجميعي", () => {
    const r = validateJournalEntry(
      [
        { account_id: "", debit: 5 },
        { account_id: "header", credit: 5 },
      ],
      { postableAccountIds: new Set([A, B]) },
    );
    expect(r.lineErrors).toContainEqual({ index: 0, code: "account_required" });
    expect(r.lineErrors).toContainEqual({ index: 1, code: "account_not_postable" });
  });

  it("يتجاهل السطور الفارغة في النماذج عند الطلب", () => {
    const r = validateJournalEntry(
      [{ account_id: A, debit: 5 }, { account_id: "", debit: "", credit: "" }, { account_id: B, credit: 5 }],
      { ignoreBlankLines: true },
    );
    expect(r.valid).toBe(true);
  });

  it("يقبل المبالغ بفواصل الآلاف", () => {
    const t = computeJournalTotals([{ account_id: A, debit: "1,250.50" }, { account_id: B, credit: "1250.5" }]);
    expect(t.isBalanced).toBe(true);
  });
});

describe("toBaseAmount — العملة الأساسية", () => {
  it("يحافظ على التوازن بالعملة الأساسية بدون تقريب", () => {
    const rate = "3.7512345678";
    const debit = toBaseAmount("333.33", rate);
    const credit = toBaseAmount("111.11", rate).plus(toBaseAmount("222.22", rate));
    expect(debit.eq(credit)).toBe(true);
  });

  it("يرفض سعر صرف غير موجب", () => {
    expect(() => toBaseAmount(10, 0)).toThrow();
  });
});

describe("reverseJournalLines — القيد العكسي", () => {
  it("يبدل المدين بالدائن ويبقى متوازنًا", () => {
    const lines = [
      { account_id: A, debit: "100", credit: "0" },
      { account_id: B, debit: "0", credit: "100" },
    ];
    const reversed = reverseJournalLines(lines);
    expect(reversed[0]).toMatchObject({ account_id: A, debit: "0", credit: "100" });
    expect(validateJournalEntry(reversed).valid).toBe(true);
  });
});
