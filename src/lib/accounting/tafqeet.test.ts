import { describe, expect, it } from "vitest";
import { amountInArabicWords, amountInEnglishWords, integerToArabicWords, integerToEnglishWords } from "./tafqeet";

describe("integerToArabicWords", () => {
  it.each([
    [0, "صفر"], [1, "واحد"], [10, "عشرة"], [11, "أحد عشر"], [12, "اثنا عشر"], [21, "واحد وعشرون"], [100, "مائة"],
    [200, "مائتان"], [305, "ثلاثمائة وخمسة"], [1000, "ألف"], [2000, "ألفان"], [3000, "ثلاثة آلاف"], [10000, "عشرة آلاف"],
    [11000, "أحد عشر ألف"], [103000, "مائة وثلاثة آلاف"], [250000, "مائتان وخمسون ألف"], [1_000_000, "مليون"],
    [2_500_000, "مليونان وخمسمائة ألف"], [5_250, "خمسة آلاف ومائتان وخمسون"], [7_000_000_001, "سبعة مليارات وواحد"],
  ])("%d", (n, words) => expect(integerToArabicWords(n)).toBe(words));
});

describe("amountInArabicWords", () => {
  it("whole amount", () => expect(amountInArabicWords("5250", "YER")).toBe("فقط خمسة آلاف ومائتان وخمسون ريال يمني لا غير"));
  it("with fraction", () => expect(amountInArabicWords("120.50", "SAR")).toBe("فقط مائة وعشرون ريال سعودي وخمسون هللة لا غير"));
  it("thousands separator in input", () => expect(amountInArabicWords("1,000.00", "USD")).toBe("فقط ألف دولار أمريكي لا غير"));
  it("unknown currency uses the given name", () => expect(amountInArabicWords("3", "XYZ", 2, "عملة")).toBe("فقط ثلاثة عملة لا غير"));
});

describe("amountInEnglishWords", () => {
  it("whole", () => expect(amountInEnglishWords("5250", "YER")).toBe("Only five thousand two hundred fifty Yemeni rials"));
  it("fraction", () => expect(amountInEnglishWords("120.50", "SAR")).toBe("Only one hundred twenty Saudi riyals and fifty halalas"));
  it("millions", () => expect(integerToEnglishWords(2_000_015)).toBe("two million fifteen"));
});
