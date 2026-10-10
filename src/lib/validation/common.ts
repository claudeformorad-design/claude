import { z } from "zod";
import { isIsoDate } from "@/lib/accounting/fiscal";

/**
 * حقول اختيارية موحّدة: تقبل الغياب (حقل غير معروض في النموذج) أو النص الفارغ ⇒ null.
 * (كان غياب الحقل يُرفض كخطأ تحقق صامت — اكتُشف في اختبار الواجهة الكامل)
 */
export const optText = z.string().trim().optional().transform((v) => (v === undefined || v === "" ? null : v));
export const optDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => v === undefined || v === "" || isIsoDate(v), "invalid_date")
  .transform((v) => (v === undefined || v === "" ? null : v));
