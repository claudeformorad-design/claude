import { describe, expect, it } from "vitest";
import { customerFormSchema, folioActionSchema, openFolioSchema, voucherSchema } from "./revenue";

const U = "11111111-1111-4111-8111-111111111111";

// الحمولات كما ترسلها النماذج فعلًا (الحقول غير المعروضة تكون غائبة)
describe("folioActionSchema — حمولات النماذج الحقيقية", () => {
  it("رسم بدون حقل المرجع (غير معروض في نموذج الرسم)", () => {
    const r = folioActionSchema.safeParse({ kind: "charge", charge_code_id: U, quantity: "2", unit_price: "500", description: "", customer_id: "" });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "charge") expect(r.data.reference).toBeNull();
  });
  it("دفعة بدون عميل", () => {
    expect(folioActionSchema.safeParse({ kind: "payment", payment_method_id: U, amount: "100", reference: "" }).success).toBe(true);
  });
  it("عربون ورد عربون واسترداد", () => {
    for (const kind of ["deposit", "refund", "depositRefund"]) {
      expect(folioActionSchema.safeParse({ kind, payment_method_id: U, amount: "50" }).success).toBe(true);
    }
  });
  it("خصم وتحويل وإلغاء", () => {
    expect(folioActionSchema.safeParse({ kind: "allowance", charge_txn_id: U, amount: "10", reason: "مجاملة" }).success).toBe(true);
    expect(folioActionSchema.safeParse({ kind: "transfer", to_folio_id: U, amount: "10" }).success).toBe(true);
    expect(folioActionSchema.safeParse({ kind: "void", txn_id: U, reason: "خطأ" }).success).toBe(true);
  });
  it("يرفض المبالغ غير الموجبة والسبب الفارغ", () => {
    expect(folioActionSchema.safeParse({ kind: "payment", payment_method_id: U, amount: "0" }).success).toBe(false);
    expect(folioActionSchema.safeParse({ kind: "void", txn_id: U, reason: "  " }).success).toBe(false);
  });
});

describe("نماذج أخرى", () => {
  it("فتح فوليو بالحد الأدنى", () => {
    expect(openFolioSchema.safeParse({ guest_name: "نزيل", folio_type: "guest", adults: "" }).success).toBe(true);
  });
  it("يرفض المغادرة قبل الوصول", () => {
    expect(openFolioSchema.safeParse({ guest_name: "x", folio_type: "guest", adults: "", arrival_date: "2026-05-10", departure_date: "2026-05-09" }).success).toBe(false);
  });
  it("عميل بالحد الأدنى", () => {
    expect(customerFormSchema.safeParse({ code: "acme", name_ar: "أكمي", customer_type: "company", allow_credit: false, payment_terms_days: "30", is_active: true }).success).toBe(true);
  });
  it("سند حساب يتطلب الحساب المقابل، وسند عميل يتطلب العميل", () => {
    const base = { voucher_type: "disbursement", payment_method_id: U, amount: "10", description: "x", allocations: [] };
    expect(voucherSchema.safeParse({ ...base, party_type: "account" }).success).toBe(false);
    expect(voucherSchema.safeParse({ ...base, party_type: "account", counter_account_id: U }).success).toBe(true);
    expect(voucherSchema.safeParse({ ...base, party_type: "customer" }).success).toBe(false);
  });
});
