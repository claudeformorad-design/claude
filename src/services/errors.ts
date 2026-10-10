import { tr } from "@/i18n/tr";
import type { ZodError } from "zod";
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

/** أسماء الحقول الشائعة كما يراها المستخدم، لتسمية الحقل المرفوض في الرسالة */
const FIELD: Record<string, () => string> = {
  name_ar: () => tr("الاسم بالعربية"), name_en: () => tr("الاسم بالإنجليزية"), name: () => tr("الاسم"), full_name: () => tr("الاسم"),
  guest_name: () => tr("اسم النزيل"), new_guest_name: () => tr("اسم النزيل"), new_guest_phone: () => tr("الجوال"), new_guest_id_number: () => tr("رقم الهوية"),
  new_guest_nationality: () => tr("الجنسية"), nationality: () => tr("الجنسية"), id_number: () => tr("رقم الهوية"), phone: () => tr("الجوال"), email: () => tr("البريد"),
  description: () => tr("الوصف"), notes: () => tr("الملاحظات"), note: () => tr("الملاحظة"), special_requests: () => tr("الطلبات الخاصة"), reference: () => tr("المرجع"),
  code: () => tr("الرمز"), title: () => tr("العنوان"), address: () => tr("العنوان"), tax_number: () => tr("الرقم الضريبي"),
  amount: () => tr("المبلغ"), rate: () => tr("السعر"), price: () => tr("السعر"), unit_price: () => tr("سعر الوحدة"), unit_cost: () => tr("التكلفة"),
  base_rate: () => tr("السعر الأساسي"), weekend_rate: () => tr("سعر نهاية الأسبوع"), fixed_rate: () => tr("السعر المثبّت"), quantity: () => tr("الكمية"),
  debit: () => tr("المدين"), credit: () => tr("الدائن"), nights: () => tr("عدد الليالي"), adults: () => tr("عدد البالغين"), children: () => tr("عدد الأطفال"),
  arrival_date: () => tr("تاريخ الوصول"), departure_date: () => tr("تاريخ المغادرة"), date: () => tr("التاريخ"), posting_date: () => tr("تاريخ القيد"),
  room_id: () => tr("الغرفة"), room_type_id: () => tr("نوع الغرفة"), room_number: () => tr("رقم الغرفة"), account_id: () => tr("الحساب"),
  customer_id: () => tr("العميل"), vendor_id: () => tr("المورد"), guest_id: () => tr("النزيل"), method: () => tr("طريقة الدفع"), payment_method_id: () => tr("طريقة الدفع"),
  lines: () => tr("السطور"), from_number: () => tr("من رقم"), to_number: () => tr("إلى رقم"), password: () => tr("كلمة المرور"), keys: () => tr("العدد"),
};

/** رسالة واضحة لأول حقل رفضه التحقق: أي حقل، ولماذا */
export function describeValidation(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return tr("تحقق من الحقول المطلوبة");
  const key = [...issue.path].reverse().find((k) => typeof k === "string") as string | undefined;
  const row = issue.path.find((k) => typeof k === "number") as number | undefined;
  const label = (key && FIELD[key]?.()) || tr("أحد الحقول");
  const where = row !== undefined ? tr(" في السطر {0}", row + 1) : "";
  const i = issue as { code: string; origin?: string; maximum?: number | bigint; minimum?: number | bigint; input?: unknown; message: string };
  const missing = /received (undefined|null)/.test(i.message);
  const text = i.origin === "string";
  if (i.code === "too_big") return text ? tr("{0}{1} أطول من المسموح، الحد {2} حرفًا", label, where, String(i.maximum)) : tr("{0}{1} أكبر من المسموح، الحد {2}", label, where, String(i.maximum));
  if (i.code === "too_small") {
    if (text && Number(i.minimum) <= 1) return tr("{0}{1} مطلوب", label, where);
    if (text) return tr("{0}{1} أقصر من المسموح، الحد الأدنى {2} حرفًا", label, where, String(i.minimum));
    return tr("{0}{1} أقل من المسموح، الحد الأدنى {2}", label, where, String(i.minimum));
  }
  if (missing) return tr("{0}{1} مطلوب", label, where);
  return tr("{0}{1} غير صحيح", label, where);
}

/** نتيجة تحقق فاشلة تحمل سببها، تعرضها الواجهة بدل «تحقق من الحقول» */
export function invalid(error: ZodError): { ok: false; error: "validation"; message: string } {
  return { ok: false, error: "validation", message: describeValidation(error) };
}
