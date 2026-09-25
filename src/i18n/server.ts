import "server-only";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from "./config";
import { ar, type Dictionary } from "./dictionaries/ar";
import { en } from "./dictionaries/en";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

/** اللغة: من الكوكي أولًا، ثم من ترويسة المتصفح، والافتراضي العربية */
export async function getLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  const accept = (await headers()).get("accept-language") ?? "";
  if (/^en\b/i.test(accept)) return "en";
  return DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
