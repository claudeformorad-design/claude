import { describe, expect, it } from "vitest";
import { fiscalYearStart, isIsoDate, todayInTimeZone } from "./fiscal";

describe("fiscalYearStart", () => {
  it("سنة تقويمية", () => {
    expect(fiscalYearStart("2026-09-25", 1)).toBe("2026-01-01");
  });
  it("سنة مالية تبدأ في يوليو", () => {
    expect(fiscalYearStart("2026-09-25", 7)).toBe("2026-07-01");
    expect(fiscalYearStart("2026-03-10", 7)).toBe("2025-07-01");
  });
  it("يرفض شهرًا غير صالح وتاريخًا غير صالح", () => {
    expect(() => fiscalYearStart("2026-01-01", 13)).toThrow();
    expect(isIsoDate("2026-02-30")).toBe(false);
  });
});

describe("todayInTimeZone", () => {
  it("يعيد يوم الفندق وليس يوم الخادم", () => {
    const utcLate = new Date("2026-09-25T22:30:00Z");
    expect(todayInTimeZone("Asia/Riyadh", utcLate)).toBe("2026-09-26");
    expect(todayInTimeZone("UTC", utcLate)).toBe("2026-09-25");
  });
});
