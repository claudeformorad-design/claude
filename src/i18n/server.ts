import "server-only";
import type { Locale } from "./config";
import { ar, type Dictionary } from "./dictionaries/ar";

/** اللغة العربية هي اللغة الدائمة للنظام بالكامل */
export function getDictionary(): Dictionary {
  return ar;
}

export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  return { locale: "ar", t: ar };
}
