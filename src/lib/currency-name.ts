/** اسم العملة كاملًا بالعربية من رمزها، مثل ريال يمني، ويعود الرمز إن لم يُعرف */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["ar"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
