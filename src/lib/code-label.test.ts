import { describe, expect, it } from "vitest";
import { splitCode, splitDocCodes } from "./code-label";

describe("splitCode", () => {
  it("separates a leading account or currency code from an Arabic name", () => {
    expect(splitCode("1101 الصندوق الرئيسي")).toEqual({ code: "1101", name: "الصندوق الرئيسي" });
    expect(splitCode("USD دولار أمريكي")).toEqual({ code: "USD", name: "دولار أمريكي" });
    expect(splitCode("C-0001 شركة الأفق")).toEqual({ code: "C-0001", name: "شركة الأفق" });
  });
  it("leaves labels without a real code untouched", () => {
    expect(splitCode("2 بالغ")).toEqual({ code: null, name: "2 بالغ" });
    expect(splitCode("VAT 15%")).toEqual({ code: null, name: "VAT 15%" });
    expect(splitCode("الصندوق")).toEqual({ code: null, name: "الصندوق" });
  });
});

describe("splitDocCodes", () => {
  it("splits document numbers and dates out of Arabic descriptions in order", () => {
    expect(splitDocCodes("إقامة ليلة 2026-09-27، غرفة 215 للحجز RSV-2026-000110")).toEqual([
      { text: "إقامة ليلة ", kind: "text" },
      { text: "2026-09-27", kind: "date" },
      { text: "، غرفة 215 للحجز ", kind: "text" },
      { text: "RSV-2026-000110", kind: "code" },
    ]);
  });
  it("returns plain text as a single part", () => {
    expect(splitDocCodes("رأس المال")).toEqual([{ text: "رأس المال", kind: "text" }]);
  });
});
