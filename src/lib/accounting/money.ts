import Decimal from "decimal.js";

/**
 * أدوات المبالغ المالية.
 * لا نستخدم أبدًا أرقام JavaScript العشرية (float) في الحسابات المالية:
 * 0.1 + 0.2 = 0.30000000000000004. كل العمليات تتم عبر Decimal بدقة عالية،
 * بما يطابق النوع numeric في PostgreSQL.
 */
export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof MoneyDecimal>;
export type MoneyInput = Money | string | number | null | undefined;

/** أقصى عدد خانات عشرية لمبالغ السطور (يطابق numeric(19,4) في قاعدة البيانات) */
export const LINE_AMOUNT_SCALE = 4;

export const ZERO: Money = new MoneyDecimal(0);

/**
 * توحيد الأرقام المكتوبة بلوحة مفاتيح عربية: ٠-٩ و۰-۹ ⇒ 0-9، والفاصلة العشرية «٫» ⇒ «.»،
 * وفواصل الآلاف («٬» و«،» و«,») والمسافات تُحذف.
 */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".");
}

export function toMoney(value: MoneyInput): Money {
  if (value === null || value === undefined || value === "") return ZERO;
  if (value instanceof MoneyDecimal) return value;
  const d = new MoneyDecimal(typeof value === "string" ? normalizeDigits(value).trim().replace(/[,\u066C\u060C\s]/g, "") : value);
  if (!d.isFinite()) throw new RangeError(`Invalid amount: ${String(value)}`);
  return d;
}

/** هل النص/الرقم مبلغ صالح؟ (بدون رمي استثناء) */
export function isValidAmount(value: MoneyInput): boolean {
  try {
    toMoney(value);
    return true;
  } catch {
    return false;
  }
}

export function sumMoney(values: Iterable<MoneyInput>): Money {
  let total = ZERO;
  for (const v of values) total = total.plus(toMoney(v));
  return total;
}

/** تقريب مالي (نصف للأعلى) إلى عدد الخانات العشرية للعملة */
export function roundMoney(value: MoneyInput, decimals = 2): Money {
  return toMoney(value).toDecimalPlaces(decimals, MoneyDecimal.ROUND_HALF_UP);
}

export function decimalPlaces(value: MoneyInput): number {
  return toMoney(value).decimalPlaces();
}

/** تنسيق مبلغ للعرض حسب اللغة والعملة (الأرقام تبقى لاتينية لتسهيل القراءة المحاسبية) */
export function formatMoney(
  value: MoneyInput,
  options: { locale?: string; currency?: string; decimals?: number } = {},
): string {
  const { locale = "ar", currency, decimals = 2 } = options;
  const rounded = roundMoney(value, decimals);
  const formatter = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...(currency ? { style: "currency", currency, currencyDisplay: "code" } : {}),
  });
  // Intl يقبل number فقط؛ المبلغ مقرّب مسبقًا لذا التحويل آمن ضمن حدود الأرقام المالية الواقعية
  return formatter.format(rounded.toNumber());
}
