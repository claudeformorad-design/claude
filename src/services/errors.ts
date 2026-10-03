import { type AccountingErrorKey, describeDatabaseError, mapDatabaseError } from "@/lib/accounting/errors";

/** خطأ خدمة يحمل مفتاح ترجمة، حتى تعرض الواجهة رسالة مفهومة بلغة المستخدم */
export class ServiceError extends Error {
  constructor(
    public readonly key: AccountingErrorKey,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function raise(error: { message: string } | null): void {
  if (error) throw new ServiceError(mapDatabaseError(error.message), error.message);
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AccountingErrorKey | "validation"; details?: string; message?: string };

/** تنفيذ عملية خدمة وتحويل أخطائها إلى نتيجة قابلة للعرض في Server Actions */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ServiceError) {
      // message: نص عربي دقيق لقواعد العمل التي لا يقابلها مفتاح ترجمة عام (يُعرض بدل «خطأ غير متوقع»)
      return { ok: false, error: e.key, details: e.message, message: describeDatabaseError(e.message) ?? undefined };
    }
    console.error(e);
    return { ok: false, error: "unknown" };
  }
}
