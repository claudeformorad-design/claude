import { plainText } from "@/lib/text";
/**
 * النص المعروض للمستخدم عند فشل Server Action:
 * مفتاح الترجمة العام إن وُجد، وإلا الرسالة العربية الدقيقة القادمة من الخادم، وإلا «خطأ غير متوقع».
 */
export function actionErrorText(errors: Record<string, string>, r: { error: string; message?: string }): string {
  if (r.error === "validation") return plainText(errors.validation ?? errors.unknown ?? "");
  if (r.error !== "unknown" && errors[r.error]) return plainText(errors[r.error]!);
  return plainText(r.message ?? errors.unknown ?? "");
}
