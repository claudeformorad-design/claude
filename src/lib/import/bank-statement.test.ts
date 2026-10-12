import { describe, expect, it } from "vitest";
import { bankDate, bankLineKey, bankNumber, parseBankStatement } from "./bank-statement";

const sheet = (headers: string[], rows: string[][]) => ({ headers, rows: rows.map((cells, i) => ({ line: i + 2, cells })) });

describe("bank statement import", () => {
  it("reads bank numbers in every common format", () => {
    expect(bankNumber("1,250.50")).toBe("1250.5");
    expect(bankNumber("(300)")).toBe("-300");
    expect(bankNumber("٤٥٠٫٧٥")).toBe("450.75");
    expect(bankNumber("75.00-")).toBe("-75");
    expect(bankNumber("1.234,50")).toBe("1234.5");
    expect(bankNumber("500 DR")).toBe("-500");
    expect(bankNumber("500 CR")).toBe("500");
    expect(bankNumber("YER 2,000")).toBe("2000");
    expect(bankNumber("")).toBeNull();
    expect(bankNumber("abc")).toBeNull();
  });

  it("reads dates as the bank writes them", () => {
    expect(bankDate("2026-01-31")).toBe("2026-01-31");
    expect(bankDate("31/01/2026")).toBe("2026-01-31");
    expect(bankDate("5.2.2026 10:30")).toBe("2026-02-05");
    expect(bankDate("٣١/١٢/٢٠٢٥")).toBe("2025-12-31");
    expect(bankDate("31/02/2026")).toBeNull();
  });

  it("one signed amount column, skipping balance rows", () => {
    const r = parseBankStatement(sheet(["التاريخ", "البيان", "المرجع", "المبلغ", "الرصيد"], [
      ["", "رصيد افتتاحي", "", "", "10,000"],
      ["01/03/2026", "إيداع نقدي", "R-1", "5,000", "15,000"],
      ["02/03/2026", "شيك 778", "778", "(1,200)", "13,800"],
      ["03/03/2026", "عمولة", "", "0", "13,800"],
    ]));
    if ("error" in r) throw new Error(r.error);
    expect(r.lines.map((l) => [l.txn_date, l.amount, l.reference])).toEqual([["2026-03-01", "5000", "R-1"], ["2026-03-02", "-1200", "778"]]);
    expect(r.skipped).toBe(2);
    expect(r.errors).toEqual([]);
  });

  it("separate deposit and withdrawal columns, English headers", () => {
    const r = parseBankStatement(sheet(["Value Date", "Narration", "Cheque No", "Withdrawals", "Deposits", "Balance"], [
      ["2026-03-04", "POS settlement", "", "", "2,340.00", "1"],
      ["2026-03-05", "Electricity bill", "998", "780.25", "", "1"],
      ["bad", "x", "", "10", "", "1"],
    ]));
    if ("error" in r) throw new Error(r.error);
    expect(r.lines.map((l) => [l.txn_date, l.amount, l.description])).toEqual([["2026-03-04", "2340", "POS settlement"], ["2026-03-05", "-780.25", "Electricity bill"]]);
    expect(r.errors).toEqual([{ line: 4, message: "تاريخ غير مفهوم: bad" }]);
    expect(r.columns.amount).toBe("Deposits / Withdrawals");
  });

  it("debit/credit amount headers are not taken as a single amount column", () => {
    const r = parseBankStatement(sheet(["تاريخ العملية", "التفاصيل", "المبلغ المدين", "المبلغ الدائن"], [["10-03-2026", "تحويل", "", "900"], ["11-03-2026", "سحب", "100", ""]]));
    if ("error" in r) throw new Error(r.error);
    expect(r.lines.map((l) => l.amount)).toEqual(["900", "-100"]);
  });

  it("explains missing columns and builds a stable duplicate key", () => {
    expect(parseBankStatement(sheet(["البيان", "المبلغ"], []))).toEqual({ error: "لم يُعرف عمود التاريخ. اجعل عنوانه «التاريخ»." });
    expect(parseBankStatement(sheet(["التاريخ", "البيان"], []))).toHaveProperty("error");
    expect(bankLineKey({ txn_date: "2026-03-01", amount: "5000", reference: null, description: " إيداع " }))
      .toBe(bankLineKey({ txn_date: "2026-03-01", amount: "5000.0000", reference: "", description: "إيداع" }));
  });
});
