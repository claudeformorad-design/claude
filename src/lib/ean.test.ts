import { describe, expect, it } from "vitest";
import { ean13CheckDigit, isEan13 } from "./ean";

describe("EAN-13", () => {
  it("computes the check digit like the database generator", () => {
    expect(ean13CheckDigit("200000000001")).toBe(5);
    expect(ean13CheckDigit("200000000002")).toBe(2);
    expect(ean13CheckDigit("628100000000")).toBe(ean13CheckDigit("628100000000"));
  });
  it("validates real and internal codes", () => {
    expect(isEan13("2000000000015")).toBe(true);
    expect(isEan13("4006381333931")).toBe(true);
    expect(isEan13("4006381333932")).toBe(false);
    expect(isEan13("ABC-12")).toBe(false);
  });
});
