/** تواريخ الحجوزات (نصوص ISO بلا منطقة زمنية؛ «اليوم» يأتي من توقيت الفندق) */
export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const nightsBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** يوم الأسبوع (0 = الأحد) لتاريخ ISO */
export const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** «الخميس 2 أكتوبر» — أرقام لاتينية كبقية النظام */
export function dayLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** «27/09» — تاريخ مختصر للجداول المزدحمة */
export const shortDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** وقت من طابع زمني محلي «2026-10-02T16:00:00» ⇒ «16:00» */
export const timeOf = (ts: string | null): string => (ts ? ts.slice(11, 16) : "");
