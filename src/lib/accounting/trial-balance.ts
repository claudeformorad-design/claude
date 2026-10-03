import { type AccountType, isIncomeStatementAccount } from "./accounts";
import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

/**
 * بناء ميزان المراجعة من حركة الحسابات.
 *
 * قاعدة البيانات (public.gl_account_activity) تعيد لكل حساب حركته في ثلاث شرائح:
 *   - prior_years: قبل بداية السنة المالية الحالية
 *   - ytd_before:  من بداية السنة المالية حتى ما قبل بداية الفترة المطلوبة
 *   - period:      داخل الفترة المطلوبة
 *
 * القاعدة المحاسبية:
 *   - حسابات الميزانية (أصول/خصوم/حقوق ملكية): الرصيد الافتتاحي = كل الحركة السابقة.
 *   - حسابات قائمة الدخل (إيرادات/مصروفات): تبدأ كل سنة مالية من الصفر؛ صافي أرباح
 *     السنوات السابقة يُضاف إلى رصيد "الأرباح المبقاة" الافتتاحي (إقفال تلقائي في العرض)،
 *     حتى لو لم يُسجَّل قيد إقفال فعلي بعد. بهذا يبقى الميزان متوازنًا دائمًا.
 */
export interface TrialBalanceAccount {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type: AccountType;
  system_key: string | null;
}

export interface AccountActivity {
  account_id: string;
  prior_years_debit: MoneyInput;
  prior_years_credit: MoneyInput;
  ytd_before_debit: MoneyInput;
  ytd_before_credit: MoneyInput;
  period_debit: MoneyInput;
  period_credit: MoneyInput;
}

export interface TrialBalanceRow {
  account: TrialBalanceAccount | null; // null ⇒ صف أرباح مبقاة غير مخصص (لا يوجد حساب retained_earnings)
  /** الرصيد الافتتاحي الصافي (موجب = مدين، سالب = دائن) */
  opening: Money;
  periodDebit: Money;
  periodCredit: Money;
  /** الرصيد الختامي الصافي (موجب = مدين، سالب = دائن) */
  closing: Money;
}

export interface TrialBalanceColumns {
  openingDebit: Money;
  openingCredit: Money;
  periodDebit: Money;
  periodCredit: Money;
  closingDebit: Money;
  closingCredit: Money;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: TrialBalanceColumns;
  isBalanced: boolean;
  /** صافي أرباح (دائن موجب) السنوات السابقة الذي رُحّل للأرباح المبقاة */
  priorYearsEarnings: Money;
}

const RETAINED_EARNINGS_KEY = "retained_earnings";

/** تقسيم رصيد صافٍ إلى عمودي مدين/دائن */
function splitBalance(net: Money): { debit: Money; credit: Money } {
  return net.isNegative() ? { debit: ZERO, credit: net.negated() } : { debit: net, credit: ZERO };
}

export function trialBalanceColumns(row: TrialBalanceRow): TrialBalanceColumns {
  const opening = splitBalance(row.opening);
  const closing = splitBalance(row.closing);
  return {
    openingDebit: opening.debit,
    openingCredit: opening.credit,
    periodDebit: row.periodDebit,
    periodCredit: row.periodCredit,
    closingDebit: closing.debit,
    closingCredit: closing.credit,
  };
}

export function buildTrialBalance(
  accounts: readonly TrialBalanceAccount[],
  activity: readonly AccountActivity[],
  options: { includeZeroRows?: boolean } = {},
): TrialBalance {
  const byAccount = new Map(activity.map((a) => [a.account_id, a]));
  const rows: TrialBalanceRow[] = [];
  let priorYearsNet = ZERO; // صافي مدين لحسابات قائمة الدخل في السنوات السابقة
  let retainedRow: TrialBalanceRow | null = null;

  for (const account of accounts) {
    const a = byAccount.get(account.id);
    const priorNet = a ? toMoney(a.prior_years_debit).minus(toMoney(a.prior_years_credit)) : ZERO;
    const ytdNet = a ? toMoney(a.ytd_before_debit).minus(toMoney(a.ytd_before_credit)) : ZERO;
    const periodDebit = a ? toMoney(a.period_debit) : ZERO;
    const periodCredit = a ? toMoney(a.period_credit) : ZERO;

    let opening: Money;
    if (isIncomeStatementAccount(account.account_type)) {
      priorYearsNet = priorYearsNet.plus(priorNet);
      opening = ytdNet;
    } else {
      opening = priorNet.plus(ytdNet);
    }

    const row: TrialBalanceRow = {
      account,
      opening,
      periodDebit,
      periodCredit,
      closing: opening.plus(periodDebit).minus(periodCredit),
    };
    if (account.system_key === RETAINED_EARNINGS_KEY) retainedRow = row;
    rows.push(row);
  }

  // ترحيل صافي أرباح/خسائر السنوات السابقة إلى الأرباح المبقاة
  if (!priorYearsNet.isZero()) {
    if (retainedRow) {
      retainedRow.opening = retainedRow.opening.plus(priorYearsNet);
      retainedRow.closing = retainedRow.closing.plus(priorYearsNet);
    } else {
      rows.push({ account: null, opening: priorYearsNet, periodDebit: ZERO, periodCredit: ZERO, closing: priorYearsNet });
    }
  }

  const visible = options.includeZeroRows
    ? rows
    : rows.filter((r) => !(r.opening.isZero() && r.periodDebit.isZero() && r.periodCredit.isZero() && r.closing.isZero()));

  visible.sort((x, y) => (x.account?.code ?? "~").localeCompare(y.account?.code ?? "~"));

  const totals: TrialBalanceColumns = {
    openingDebit: ZERO,
    openingCredit: ZERO,
    periodDebit: ZERO,
    periodCredit: ZERO,
    closingDebit: ZERO,
    closingCredit: ZERO,
  };
  for (const row of visible) {
    const c = trialBalanceColumns(row);
    (Object.keys(totals) as (keyof TrialBalanceColumns)[]).forEach((k) => {
      totals[k] = totals[k].plus(c[k]);
    });
  }

  return {
    rows: visible,
    totals,
    isBalanced:
      totals.openingDebit.eq(totals.openingCredit) &&
      totals.periodDebit.eq(totals.periodCredit) &&
      totals.closingDebit.eq(totals.closingCredit),
    priorYearsEarnings: priorYearsNet.negated(),
  };
}
