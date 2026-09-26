import "server-only";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { ar, type Dictionary } from "./dictionaries/ar";

/** اللغة العربية هي اللغة الدائمة للنظام بالكامل */
export async function getLocale(): Promise<Locale> {
  return DEFAULT_LOCALE;
}

export function getDictionary(_locale?: Locale): Dictionary {
  void _locale;
  return ar;
}

export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  return { locale: "ar", t: ar };
}
