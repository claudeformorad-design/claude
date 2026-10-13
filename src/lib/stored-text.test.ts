import { describe, expect, it } from "vitest";
import { localizeStored } from "./stored-text";

describe("localizeStored", () => {
  it("bilingual system text: Arabic side in ar, English side in en", () => {
    const t = "إطفاء مصروف مقدم / Prepaid amortization — إيجار (1/12)";
    expect(localizeStored(t, "ar")).toBe("إطفاء مصروف مقدم — إيجار (1/12)");
    expect(localizeStored(t, "en")).toBe("Prepaid amortization — إيجار (1/12)");
    expect(localizeStored("إلغاء / Void: VCH-1", "en")).toBe("Void: VCH-1");
    expect(localizeStored("إلغاء / Void: VCH-1", "ar")).toBe("إلغاء: VCH-1");
    expect(localizeStored("تحويل إلى / Transfer to Main", "en")).toBe("Transfer to Main");
  });

  it("nested bilingual pairs", () => {
    const t = "عكس القيد / Reversal of JE-7: فاتورة مورد / Vendor bill — B-1";
    expect(localizeStored(t, "en")).toBe("Reversal of JE-7: Vendor bill — B-1");
    expect(localizeStored(t, "ar")).toBe("عكس القيد JE-7: فاتورة مورد — B-1");
  });

  it("Arabic-only system prefixes are translated in en only", () => {
    expect(localizeStored("عكس القيد JE-2026-0001", "en")).toBe("Reversal of JE-2026-0001");
    expect(localizeStored("فاتورة آجلة — INV-5", "en")).toBe("Credit invoice — INV-5");
    expect(localizeStored("إقامة ليلة 2026-01-02 — غرفة 101", "en")).toBe("Night stay 2026-01-02 — Room 101");
    expect(localizeStored("رصيد افتتاحي", "en")).toBe("Opening balance");
    expect(localizeStored("صرف رواتب 2026-01", "en")).toBe("Salaries payment 2026-01");
    expect(localizeStored("عكس القيد JE-1", "ar")).toBe("عكس القيد JE-1");
  });

  it("known whole descriptions", () => {
    expect(localizeStored("تحصيل فاتورة", "en")).toBe("Invoice collection");
    expect(localizeStored("تحصيل فاتورة", "ar")).toBe("تحصيل فاتورة");
    expect(localizeStored("تسوية مدفوعات البطاقات — بنك التسوية", "en")).toBe("Card payments settlement — بنك التسوية");
  });

  it("user-typed text is left alone", () => {
    expect(localizeStored("صيانة التكييف", "en")).toBe("صيانة التكييف");
    expect(localizeStored("غرفة عائلية", "en")).toBe("غرفة عائلية");
    expect(localizeStored("صيانة MR-0003", "en")).toBe("Maintenance MR-0003");
    expect(localizeStored("Office rent", "en")).toBe("Office rent");
  });
});

describe("default charge codes and payment methods", () => {
  it("translates seeded names inside system descriptions", () => {
    expect(localizeStored("ميني بار — F-2026-000299 خالد", "en")).toBe("Minibar — F-2026-000299 خالد");
    expect(localizeStored("بطاقة ائتمان / مدى — F-1", "en")).toBe("Credit/debit card — F-1");
    expect(localizeStored("إقامة / ليلة — F-1", "en")).toBe("Room night — F-1");
    expect(localizeStored("مطعم - أطعمة — F-1", "en")).toBe("Restaurant food — F-1");
    expect(localizeStored("مشروبات الضيافة", "en")).toBe("مشروبات الضيافة");
  });
});
