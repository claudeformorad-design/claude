import { currentLocale } from "@/i18n/tr";
/** اسم العملة كاملًا بالعربية من رمزها، مثل ريال يمني، ويعود الرمز إن لم يُعرف */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames([currentLocale()], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
