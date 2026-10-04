import "server-only";
import "./locale-server";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/ar";
import { dict } from "./dict";
import { currentLocale } from "./tr";

/** قاموس لغة الطلب الحالي (من كوكي اللغة) */
export function getDictionary(): Dictionary {
  return dict();
}

export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  return { locale: currentLocale(), t: dict() };
}
