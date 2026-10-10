import { describe, expect, it } from "vitest";
import { computeTaxes } from "./tax";

const VAT = { id: "vat", rate: "15", is_compound: false };
const MUNI = { id: "muni", rate: "2.5", is_compound: false };
const VAT_COMPOUND = { id: "vat", rate: "15", is_compound: true };

const s = (b: ReturnType<typeof computeTaxes>) => ({
  net: b.net.toFixed(2),
  tax: b.taxTotal.toFixed(2),
  total: b.total.toFixed(2),
  lines: b.taxes.map((t) => `${t.tax_rate_id}:${t.taxable_base.toFixed(2)}:${t.amount.toFixed(2)}`),
});

describe("computeTaxes — حساب الضرائب", () => {
  it("سعر غير شامل مع ضريبة واحدة", () => {
    expect(s(computeTaxes("1000", [VAT], { inclusive: false, decimals: 2 }))).toEqual({
      net: "1000.00", tax: "150.00", total: "1150.00", lines: ["vat:1000.00:150.00"],
    });
  });

  it("سعر شامل مع ضريبة واحدة", () => {
    expect(s(computeTaxes("1150", [VAT], { inclusive: true, decimals: 2 }))).toEqual({
      net: "1000.00", tax: "150.00", total: "1150.00", lines: ["vat:1000.00:150.00"],
    });
  });

  it("ضريبتان بسيطتان (قيمة مضافة + بلدية) على الصافي", () => {
    expect(s(computeTaxes("1000", [VAT, MUNI], { inclusive: false, decimals: 2 }))).toEqual({
      net: "1000.00", tax: "175.00", total: "1175.00", lines: ["vat:1000.00:150.00", "muni:1000.00:25.00"],
    });
  });

  it("ضريبة مركّبة تُحسب على الصافي + الضرائب البسيطة", () => {
    expect(s(computeTaxes("1000", [MUNI, VAT_COMPOUND], { inclusive: false, decimals: 2 }))).toEqual({
      net: "1000.00", tax: "178.75", total: "1178.75", lines: ["muni:1000.00:25.00", "vat:1025.00:153.75"],
    });
  });

  it("سعر شامل مع ضريبة مركّبة يعيد نفس الصافي", () => {
    expect(s(computeTaxes("1178.75", [MUNI, VAT_COMPOUND], { inclusive: true, decimals: 2 }))).toEqual({
      net: "1000.00", tax: "178.75", total: "1178.75", lines: ["muni:1000.00:25.00", "vat:1025.00:153.75"],
    });
  });

  it("السعر الشامل يطابق المبلغ المدخل حرفيًا رغم التقريب", () => {
    const b = computeTaxes("99.99", [VAT, MUNI], { inclusive: true, decimals: 2 });
    expect(b.total.toFixed(2)).toBe("99.99");
    expect(b.net.plus(b.taxTotal).toFixed(2)).toBe("99.99");
    expect(s(b).lines).toEqual(["vat:85.09:12.77", "muni:85.09:2.13"]);
    expect(b.net.toFixed(2)).toBe("85.09");
  });

  it("بدون ضرائب", () => {
    expect(s(computeTaxes("250", [], { inclusive: true, decimals: 2 }))).toEqual({
      net: "250.00", tax: "0.00", total: "250.00", lines: [],
    });
  });

  it("عملة بثلاث خانات عشرية", () => {
    const b = computeTaxes("10.005", [{ id: "v", rate: "5", is_compound: false }], { inclusive: false, decimals: 3 });
    expect(b.taxTotal.toFixed(3)).toBe("0.500");
    expect(b.total.toFixed(3)).toBe("10.505");
  });

  it("يرفض المبالغ والنسب السالبة", () => {
    expect(() => computeTaxes("-1", [VAT], { inclusive: false, decimals: 2 })).toThrow();
    expect(() => computeTaxes("1", [{ id: "x", rate: "-5", is_compound: false }], { inclusive: false, decimals: 2 })).toThrow();
  });
});
