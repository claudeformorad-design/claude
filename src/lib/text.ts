import { currentLocale } from "@/i18n/tr";
import { localizeStored } from "./stored-text";

/**
 * تنظيف النصوص الآلية القادمة من قاعدة البيانات (أوصاف القيود والحركات) قبل عرضها:
 * العبارات الثابتة تُعرض بلغة الواجهة (stored-text.ts)، ولا شرطات ولا أسهم ولا نقاط فاصلة ولا أقواس؛ تُستبدل بفاصلة عربية أو مسافة.
 */
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  const locale = currentLocale();
  const out = localizeStored(text, locale)
    .replace(/\s*[—–]\s*/g, "، ")
    .replace(/\s+-\s+/g, "، ")
    .replace(/\s+\/\s+/g, "، ")
    .replace(/\s*[·•]\s*/g, "، ")
    .replace(/\s*[←→]\s*/g, " إلى ")
    .replace(/\s*\(([^()]*)\)/g, " $1")
    .replace(/\*+/g, "")
    .replace(/(،\s*){2,}/g, "، ")
    .replace(/^\s*،\s*|\s*،\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // الواجهة الإنجليزية: فاصلة لاتينية بين النصوص اللاتينية
  return locale === "en" ? out.replace(/\s*،\s*/g, ", ").replace(/ إلى /g, " to ") : out;
}
