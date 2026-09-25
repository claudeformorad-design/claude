import { z } from "zod";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { isBlankLine, validateJournalEntry } from "@/lib/accounting/journal";

const amount = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidAmount(v), "invalid_amount");

export const journalLineSchema = z.object({
  account_id: z.string(),
  department_id: z.string(),
  description: z.string().max(500),
  debit: amount,
  credit: amount,
});

const journalEntryBaseSchema = z.object({
  entry_date: z.string().refine(isIsoDate, "required"),
  description: z.string().trim().min(1, "required").max(1000),
  reference: z.string().trim().max(100),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  exchange_rate: z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount"),
  lines: z.array(journalLineSchema),
});

type JournalEntryBase = z.infer<typeof journalEntryBaseSchema>;

/**
 * التحقق من القيد يعتمد على منطق lib/accounting (نفس الدالة المستخدمة في الاختبارات)،
 * فلا توجد نسختان مختلفتان من القواعد.
 * - requireBalanced = false: للمسودات — يكفي أن يكون كل سطر صالحًا (قد تُحفظ غير متوازنة).
 * - requireBalanced = true: للترحيل — القيد كاملًا متوازنًا.
 */
function refineJournal(requireBalanced: boolean) {
  return (value: JournalEntryBase, ctx: z.RefinementCtx) => {
    // نتجاهل السطور الفارغة تمامًا، مع الاحتفاظ بفهرس السطر الأصلي لإظهار الخطأ في مكانه
    const kept = value.lines.map((line, index) => ({ line, index })).filter(({ line }) => !isBlankLine(line));
    const result = validateJournalEntry(kept.map((k) => k.line));
    for (const issue of result.lineErrors) {
      const field = issue.code === "account_required" || issue.code === "account_not_postable" ? "account_id" : "debit";
      ctx.addIssue({ code: "custom", path: ["lines", kept[issue.index]!.index, field], message: issue.code });
    }
    if (requireBalanced) {
      for (const code of result.entryErrors) ctx.addIssue({ code: "custom", path: ["lines"], message: code });
    }
  };
}

/** مخطط المسودة (يسمح بعدم التوازن مؤقتًا) */
export const journalEntryDraftSchema = journalEntryBaseSchema.superRefine(refineJournal(false));

/** مخطط الترحيل (يشترط التوازن الكامل) */
export const journalEntryFormSchema = journalEntryBaseSchema.superRefine(refineJournal(true));

export type JournalEntryFormValues = z.infer<typeof journalEntryFormSchema>;

export function emptyJournalLine(): JournalEntryFormValues["lines"][number] {
  return { account_id: "", department_id: "", description: "", debit: "", credit: "" };
}
