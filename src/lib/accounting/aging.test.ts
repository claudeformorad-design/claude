import { describe, expect, it } from "vitest";
import { agingBucket, summarizeAging } from "./aging";

describe("aging — أعمار الذمم", () => {
  it("يصنّف الشرائح حسب أيام التأخر", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual(["current", "1_30", "1_30", "31_60", "31_60", "61_90", "61_90", "over_90"]);
  });
  it("يجمع حسب الطرف والشريحة", () => {
    const s = summarizeAging([
      { party_id: "a", party_name: "A", document_id: "1", document_number: "INV-1", outstanding: "100", bucket: "current" },
      { party_id: "a", party_name: "A", document_id: "2", document_number: "INV-2", outstanding: "50.5", bucket: "over_90" },
      { party_id: "b", party_name: "B", document_id: "3", document_number: "INV-3", outstanding: "300", bucket: "1_30" },
    ]);
    expect(s.parties.map((p) => p.partyId)).toEqual(["b", "a"]);
    expect(s.parties[1]!.total.toString()).toBe("150.5");
    expect(s.totals.buckets.over_90.toString()).toBe("50.5");
    expect(s.totals.total.toString()).toBe("450.5");
  });
});
