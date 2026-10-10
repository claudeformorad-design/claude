import { tr } from "@/i18n/tr";
import { plainText } from "@/lib/text";
/**
 * النص المعروض للمستخدم عند فشل Server Action:
 * مفتاح الترجمة العام إن وُجد، وإلا الرسالة العربية الدقيقة القادمة من الخادم، وإلا «خطأ غير متوقع».
 */
export function actionErrorText(errors: Record<string, string>, r: { error: string; message?: string }): string {
  if (r.error === "validation") return plainText(r.message ?? errors.validation ?? errors.unknown ?? "");
  if (r.error !== "unknown" && errors[r.error]) return plainText(errors[r.error]!);
  return plainText(r.message ?? errors.unknown ?? "");
}


/**
 * استدعاء Server Action من الواجهة: انقطاع الاتصال بالخادم (إعادة تشغيل، شبكة) يعود كنتيجة خطأ
 * تُعرض للمستخدم بدل أن يُسقط الصفحة كاملة.
 */
export async function callAction<T>(pending: Promise<T>): Promise<T | { ok: false; error: "unknown"; message: string }> {
  try {
    return await pending;
  } catch (e) {
    if (e instanceof TypeError) return { ok: false, error: "unknown", message: tr("تعذّر الاتصال بالخادم، تحقق من الاتصال وحاول مرة أخرى") };
    throw e;
  }
}
