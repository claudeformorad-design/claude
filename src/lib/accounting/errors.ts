/**
 * تحويل رسائل أخطاء قاعدة البيانات (التريغرات والقيود) إلى مفاتيح ترجمة مفهومة للمستخدم.
 * الرسائل في قاعدة البيانات بالإنجليزية عمدًا (ثابتة وقابلة للمطابقة)،
 * والواجهة تعرض الترجمة المناسبة للغة المستخدم.
 */
export type AccountingErrorKey =
  | "not_balanced"
  | "min_two_lines"
  | "zero_total"
  | "header_account"
  | "period_closed"
  | "no_period"
  | "posted_immutable"
  | "already_reversed"
  | "reversal_of_reversal"
  | "permission_denied"
  | "duplicate_code"
  | "type_mismatch"
  | "parent_postable"
  | "account_in_use"
  | "account_currency"
  | "circular"
  | "unknown";

const PATTERNS: [RegExp, AccountingErrorKey][] = [
  [/not balanced/i, "not_balanced"],
  [/at least two lines/i, "min_two_lines"],
  [/greater than zero/i, "zero_total"],
  [/header account|inactive or is a header/i, "header_account"],
  [/period .* is closed/i, "period_closed"],
  [/No accounting period/i, "no_period"],
  [/immutable|cannot be (deleted|modified)/i, "posted_immutable"],
  [/already reversed/i, "already_reversed"],
  [/cannot itself be reversed/i, "reversal_of_reversal"],
  [/Permission denied|row-level security/i, "permission_denied"],
  [/chart_of_accounts_hotel_id_code_key|duplicate key/i, "duplicate_code"],
  [/must match parent type|coa_subtype_matches_type/i, "type_mismatch"],
  [/is postable; convert/i, "parent_postable"],
  [/has journal lines|violates foreign key constraint .*journal_entry_lines/i, "account_in_use"],
  [/only accepts entries in its own currency/i, "account_currency"],
  [/Circular/i, "circular"],
];

export function mapDatabaseError(message: string | null | undefined): AccountingErrorKey {
  if (!message) return "unknown";
  for (const [pattern, key] of PATTERNS) if (pattern.test(message)) return key;
  return "unknown";
}
