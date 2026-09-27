/**
 * تنظيف النصوص الآلية القادمة من قاعدة البيانات (أوصاف القيود والحركات) قبل عرضها:
 * لا شرطات ولا أسهم ولا نقاط فاصلة ولا أقواس؛ تُستبدل بفاصلة عربية أو مسافة.
 */
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
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
}
