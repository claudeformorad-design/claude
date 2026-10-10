import { describe, expect, it } from "vitest";
import { fiscalYearStart, formatDateTime, isIsoDate, startOfDayInTimeZone, todayInTimeZone } from "./fiscal";

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

describe("formatDateTime", () => {
  it("صيغة ثابتة بتوقيت الفندق", () => {
    expect(formatDateTime("2026-09-25T22:30:05Z", "Asia/Riyadh")).toBe("2026-09-26 01:30");
    expect(formatDateTime("2026-09-25T22:30:05Z", "UTC", true)).toBe("2026-09-25 22:30:05");
  });
});

describe("startOfDayInTimeZone", () => {
  it("returns the hotel's midnight as an absolute instant", () => {
    expect(startOfDayInTimeZone("2026-10-04", "Asia/Riyadh")).toBe("2026-10-03T21:00:00.000Z");
    expect(startOfDayInTimeZone("2026-10-04", "UTC")).toBe("2026-10-04T00:00:00.000Z");
    expect(startOfDayInTimeZone("2026-10-04", "America/New_York")).toBe("2026-10-04T04:00:00.000Z");
  });
  it("handles daylight saving changes", () => {
    expect(startOfDayInTimeZone("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfDayInTimeZone("2026-03-09", "America/New_York")).toBe("2026-03-09T04:00:00.000Z");
  });
  it("orders placed after the hotel's midnight belong to the new day", () => {
    const now = new Date("2026-10-03T23:28:00Z");
    const today = todayInTimeZone("Asia/Aden", now);
    expect(today).toBe("2026-10-04");
    expect(Date.parse(startOfDayInTimeZone(today, "Asia/Aden")) <= now.getTime()).toBe(true);
  });
});
