import { describe, expect, it } from "vitest";
import {
  buildAccountTree,
  flattenAccountTree,
  normalBalance,
  subtypeMatchesType,
  validateAccountPlacement,
  type AccountNodeInput,
} from "./accounts";

const accounts: AccountNodeInput[] = [
  { id: "1", code: "1", parent_id: null, account_type: "asset", is_postable: false },
  { id: "11", code: "11", parent_id: "1", account_type: "asset", is_postable: false },
  { id: "1102", code: "1102", parent_id: "11", account_type: "asset", is_postable: true },
  { id: "1101", code: "1101", parent_id: "11", account_type: "asset", is_postable: true },
  { id: "4", code: "4", parent_id: null, account_type: "revenue", is_postable: false },
];

describe("normalBalance", () => {
  it("الأصول والمصروفات مدينة، والباقي دائن", () => {
    expect(normalBalance("asset")).toBe("debit");
    expect(normalBalance("expense")).toBe("debit");
    expect(normalBalance("liability")).toBe("credit");
    expect(normalBalance("equity")).toBe("credit");
    expect(normalBalance("revenue")).toBe("credit");
  });
});

describe("subtypeMatchesType", () => {
  it("يطابق التصنيفات الفرعية مع أنواعها", () => {
    expect(subtypeMatchesType("asset", "fixed_asset")).toBe(true);
    expect(subtypeMatchesType("asset", "operating_revenue")).toBe(false);
    expect(subtypeMatchesType("expense", "cost_of_sales")).toBe(true);
  });
});

describe("buildAccountTree", () => {
  it("يبني الشجرة مرتبة حسب الرمز مع العمق", () => {
    const flat = flattenAccountTree(buildAccountTree(accounts));
    expect(flat.map((a) => `${a.code}@${a.depth}`)).toEqual(["1@0", "11@1", "1101@2", "1102@2", "4@0"]);
  });
});

describe("validateAccountPlacement", () => {
  it("يسمح بالوضع تحت أب تجميعي من نفس النوع", () => {
    expect(validateAccountPlacement({ account_type: "asset" }, "11", accounts)).toBeNull();
  });
  it("يرفض اختلاف النوع", () => {
    expect(validateAccountPlacement({ account_type: "expense" }, "11", accounts)).toBe("type_mismatch");
  });
  it("يرفض الأب القابل للترحيل", () => {
    expect(validateAccountPlacement({ account_type: "asset" }, "1101", accounts)).toBe("parent_is_postable");
  });
  it("يرفض الحلقات", () => {
    expect(validateAccountPlacement({ id: "1", account_type: "asset" }, "11", accounts)).toBe("circular_reference");
  });
  it("يرفض أبًا غير موجود", () => {
    expect(validateAccountPlacement({ account_type: "asset" }, "zzz", accounts)).toBe("parent_not_found");
  });
});
