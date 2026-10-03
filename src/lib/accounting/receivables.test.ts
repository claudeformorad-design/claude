import { describe, expect, it } from "vitest";
import { autoAllocate, invoiceStatus, validateAllocations } from "./receivables";

const invoices = [
  { id: "i1", customer_id: "c1", amount_due: "1000", amount_paid: "400", issue_date: "2026-08-01" },
  { id: "i2", customer_id: "c1", amount_due: "500", amount_paid: "0", issue_date: "2026-07-01" },
  { id: "i3", customer_id: "c2", amount_due: "300", amount_paid: "0", issue_date: "2026-06-01" },
];

describe("invoiceStatus", () => {
  it("يشتق الحالة من المستحق والمدفوع", () => {
    expect(invoiceStatus("100", "0")).toBe("issued");
    expect(invoiceStatus("100", "40")).toBe("partially_paid");
    expect(invoiceStatus("100", "100")).toBe("paid");
    expect(invoiceStatus("0", "0")).toBe("paid");
  });
});

describe("validateAllocations — تخصيص سندات القبض", () => {
  it("يقبل تخصيصًا صحيحًا ويحسب غير المخصص", () => {
    const r = validateAllocations("800", "c1", [{ invoice_id: "i1", amount: "600" }, { invoice_id: "i2", amount: "100" }], invoices);
    expect(r.errors).toEqual([]);
    expect(r.unallocated.toString()).toBe("100");
  });
  it("يرفض تجاوز المتبقي على الفاتورة", () => {
    const r = validateAllocations("800", "c1", [{ invoice_id: "i1", amount: "601" }], invoices);
    expect(r.errors).toContainEqual({ index: 0, code: "exceeds_invoice" });
  });
  it("يرفض تجاوز مبلغ السند", () => {
    const r = validateAllocations("500", "c1", [{ invoice_id: "i1", amount: "600" }], invoices);
    expect(r.errors).toContainEqual({ index: -1, code: "exceeds_payment" });
  });
  it("يرفض فاتورة عميل آخر والتكرار والمبالغ غير الموجبة", () => {
    const r = validateAllocations("900", "c1", [
      { invoice_id: "i3", amount: "10" },
      { invoice_id: "i2", amount: "10" },
      { invoice_id: "i2", amount: "10" },
      { invoice_id: "i1", amount: "0" },
    ], invoices);
    expect(r.errors.map((e) => e.code)).toEqual(["wrong_customer", "duplicate_invoice", "invalid_amount"]);
  });
});

describe("autoAllocate — الأقدم أولًا", () => {
  it("يسدد الفواتير الأقدم أولًا", () => {
    expect(autoAllocate("700", invoices.filter((i) => i.customer_id === "c1"))).toEqual([
      { invoice_id: "i2", amount: "500" },
      { invoice_id: "i1", amount: "200" },
    ]);
  });
});
