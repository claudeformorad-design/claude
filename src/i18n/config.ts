export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** كوكي لغة الواجهة؛ يُضبط من زر اللغة ومن تفضيل المستخدم عند الدخول */
export const LOCALE_COOKIE = "nazeel_locale";
