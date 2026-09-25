import { LINE_AMOUNT_SCALE, type Money, type MoneyInput, ZERO, isValidAmount, toMoney } from "./money";

/**
 * التحقق من القيد المزدوج (Double-Entry) في طبقة التطبيق.
 *
 * هذه نسخة مطابقة لقواعد قاعدة البيانات (app.assert_journal_entry_postable)،
 * تُستخدم لإعطاء المستخدم تغذية راجعة فورية قبل الإرسال. قاعدة البيانات تبقى
 * المرجع النهائي: حتى لو تم تجاوز هذا التحقق، لن يُرحّل قيد غير متوازن.
 */
export interface JournalLineInput {
  account_id: string;
  department_id?: string | null;
  description?: string | null;
  debit?: MoneyInput;
  credit?: MoneyInput;
}

export type JournalLineErrorCode =
  | "account_required"
  | "invalid_amount"
  | "negative_amount"
  | "too_many_decimals"
  | "both_sides"
  | "zero_line"
  | "account_not_postable";

export type JournalEntryErrorCode = "min_two_lines" | "not_balanced" | "zero_total";

export interface JournalLineIssue {
  index: number;
  code: JournalLineErrorCode;
}

export interface JournalTotals {
  debit: Money;
  credit: Money;
  /** الفرق = المدين − الدائن (موجب ⇒ المدين أكبر) */
  difference: Money;
  isBalanced: boolean;
}

export interface JournalValidationResult {
  valid: boolean;
  totals: JournalTotals;
  entryErrors: JournalEntryErrorCode[];
  lineErrors: JournalLineIssue[];
}

export interface ValidateJournalOptions {
  /** مجموعة معرفات الحسابات التفصيلية (القابلة للترحيل)؛ إن وُجدت نتحقق منها */
  postableAccountIds?: ReadonlySet<string>;
  /** تجاهل السطور الفارغة تمامًا (بدون حساب ومبالغ) — مفيد لنماذج الواجهة */
  ignoreBlankLines?: boolean;
}

function safeAmount(value: MoneyInput): Money {
  return isValidAmount(value) ? toMoney(value) : ZERO;
}

export function isBlankLine(line: JournalLineInput): boolean {
  return !line.account_id && safeAmount(line.debit).isZero() && safeAmount(line.credit).isZero();
}

/** حساب مجموع المدين والدائن وحالة التوازن */
export function computeJournalTotals(lines: readonly JournalLineInput[]): JournalTotals {
  let debit = ZERO;
  let credit = ZERO;
  for (const line of lines) {
    debit = debit.plus(safeAmount(line.debit));
    credit = credit.plus(safeAmount(line.credit));
  }
  const difference = debit.minus(credit);
  return { debit, credit, difference, isBalanced: difference.isZero() };
}

/**
 * التحقق الكامل من قيد يومية:
 *  1) كل سطر له حساب، ومبلغ صالح غير سالب بحد أقصى 4 خانات عشرية.
 *  2) كل سطر إما مدين أو دائن — ليس كلاهما وليس صفرًا.
 *  3) السطور ≥ 2، ومجموع المدين = مجموع الدائن > 0.
 */
export function validateJournalEntry(
  inputLines: readonly JournalLineInput[],
  options: ValidateJournalOptions = {},
): JournalValidationResult {
  const lines = options.ignoreBlankLines ? inputLines.filter((l) => !isBlankLine(l)) : inputLines;
  const lineErrors: JournalLineIssue[] = [];

  lines.forEach((line, index) => {
    const push = (code: JournalLineErrorCode) => lineErrors.push({ index, code });

    if (!line.account_id) push("account_required");
    else if (options.postableAccountIds && !options.postableAccountIds.has(line.account_id)) {
      push("account_not_postable");
    }

    if (!isValidAmount(line.debit) || !isValidAmount(line.credit)) {
      push("invalid_amount");
      return;
    }
    const debit = toMoney(line.debit);
    const credit = toMoney(line.credit);

    if (debit.isNegative() || credit.isNegative()) push("negative_amount");
    else if (debit.decimalPlaces() > LINE_AMOUNT_SCALE || credit.decimalPlaces() > LINE_AMOUNT_SCALE) {
      push("too_many_decimals");
    }

    if (debit.gt(0) && credit.gt(0)) push("both_sides");
    else if (debit.isZero() && credit.isZero()) push("zero_line");
  });

  const totals = computeJournalTotals(lines);
  const entryErrors: JournalEntryErrorCode[] = [];
  if (lines.length < 2) entryErrors.push("min_two_lines");
  if (!totals.isBalanced) entryErrors.push("not_balanced");
  if (totals.debit.isZero() && totals.credit.isZero()) entryErrors.push("zero_total");

  return {
    valid: entryErrors.length === 0 && lineErrors.length === 0,
    totals,
    entryErrors,
    lineErrors,
  };
}

/**
 * المبلغ بالعملة الأساسية = المبلغ × سعر الصرف (بدون تقريب).
 * عدم التقريب يضمن أن Σ(مدين×س) = Σ(دائن×س) حرفيًا متى توازن القيد بعملته،
 * لأن الضرب في ثابت يوزَّع على الجمع. التقريب يتم عند العرض فقط.
 */
export function toBaseAmount(amount: MoneyInput, exchangeRate: MoneyInput): Money {
  const rate = toMoney(exchangeRate);
  if (rate.lte(0)) throw new RangeError("Exchange rate must be positive");
  return toMoney(amount).times(rate);
}

/** سطور القيد العكسي: تبديل المدين بالدائن مع الحفاظ على باقي البيانات */
export function reverseJournalLines<T extends JournalLineInput>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit ?? 0, credit: l.debit ?? 0 }));
}
