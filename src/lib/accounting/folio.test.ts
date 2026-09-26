import { describe, expect, it } from "vitest";
import { applicableDeposit, checkoutBlockers, folioBalances, type FolioTxnInput } from "./folio";

describe("folioBalances — أرصدة الفوليو", () => {
  const stay: FolioTxnInput[] = [
    { txn_type: "deposit", total_amount: "500" },
    { txn_type: "charge", total_amount: "1175" }, // ليلتان + ضرائب
    { txn_type: "charge", total_amount: "230" }, // مطعم
    { txn_type: "charge", total_amount: "40" }, // ميني بار
    { txn_type: "allowance", total_amount: "40" }, // خصم الميني بار
  ];

  it("يحسب الرصيد والعربون بشكل منفصل", () => {
    const b = folioBalances(stay);
    expect(b.balance.toString()).toBe("1405");
    expect(b.deposits.toString()).toBe("500");
    expect(b.charges.toString()).toBe("1445");
    expect(b.credits.toString()).toBe("40");
  });

  it("تطبيق العربون ثم الدفع يصفّر الفوليو ويسمح بالمغادرة", () => {
    const before = folioBalances(stay);
    expect(checkoutBlockers("open", before)).toEqual(["balance_not_zero", "deposits_remaining"]);
    expect(applicableDeposit(before).toString()).toBe("500");

    const after = folioBalances([
      ...stay,
      { txn_type: "deposit_application", total_amount: "500" },
      { txn_type: "payment", total_amount: "905" },
    ]);
    expect(after.balance.isZero()).toBe(true);
    expect(after.deposits.isZero()).toBe(true);
    expect(checkoutBlockers("open", after)).toEqual([]);
  });

  it("العربون المطبّق لا يتجاوز الرصيد المستحق", () => {
    const b = folioBalances([
      { txn_type: "deposit", total_amount: "1000" },
      { txn_type: "charge", total_amount: "300" },
    ]);
    expect(applicableDeposit(b).toString()).toBe("300");
  });

  it("الإلغاء يعكس أثر الحركة", () => {
    const b = folioBalances([
      { txn_type: "charge", total_amount: "100" },
      { txn_type: "payment", total_amount: "100" },
      { txn_type: "payment", total_amount: "100", direction: -1 },
    ]);
    expect(b.balance.toString()).toBe("100");
  });

  it("التحويل بين فوليو وآخر (فوليو رئيسي للمجموعات)", () => {
    const guest = folioBalances([
      { txn_type: "charge", total_amount: "800" },
      { txn_type: "transfer_out", total_amount: "800" },
    ]);
    const master = folioBalances([{ txn_type: "transfer_in", total_amount: "800" }]);
    expect(guest.balance.isZero()).toBe(true);
    expect(master.balance.toString()).toBe("800");
  });

  it("الاسترداد عند وجود رصيد دائن للنزيل", () => {
    const b = folioBalances([
      { txn_type: "charge", total_amount: "100" },
      { txn_type: "payment", total_amount: "150" },
    ]);
    expect(b.balance.toString()).toBe("-50");
    expect(folioBalances([{ txn_type: "charge", total_amount: "100" }, { txn_type: "payment", total_amount: "150" }, { txn_type: "refund", total_amount: "50" }]).balance.isZero()).toBe(true);
  });
});
