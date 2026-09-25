/**
 * أدوات السنة المالية. التواريخ هنا "تواريخ محاسبية" (YYYY-MM-DD) بلا منطقة زمنية،
 * لذلك نتعامل معها كنصوص/أرقام لتجنب أخطاء فرق التوقيت في Date.
 */
export type IsoDate = string; // YYYY-MM-DD

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** بداية السنة المالية التي تحتوي التاريخ المعطى، حسب شهر بداية السنة المالية (1..12) */
export function fiscalYearStart(date: IsoDate, startMonth: number): IsoDate {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError("startMonth must be between 1 and 12");
  }
  const { year, month } = parseIsoDate(date);
  const startYear = month >= startMonth ? year : year - 1;
  return formatIsoDate(startYear, startMonth, 1);
}

/** تاريخ اليوم في منطقة زمنية محددة (مهم: يوم الفندق وليس يوم الخادم) */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
