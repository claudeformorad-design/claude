import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

/**
 * منطق الفوليو (كشف حساب النزيل).
 *
 * لكل فوليو رصيدان:
 *  - رصيد الفوليو (Guest Ledger): ما يدين به النزيل = الرسوم − الخصومات − المدفوعات + المستردات ± التحويلات.
 *  - رصيد العربون (Deposits): مبالغ مقبوضة مقدمًا لم تُطبّق بعد على الفوليو (التزام على الفندق).
 *
 * الأثر المحاسبي لكل حركة (بالعملة الأساسية):
 *   charge               مدين: ذمم النزلاء          دائن: الإيراد (+ الضرائب)
 *   allowance            مدين: خصومات مسموح بها (+ عكس الضرائب)   دائن: ذمم النزلاء
 *   payment              مدين: حساب طريقة الدفع     دائن: ذمم النزلاء
 *   payment (آجل)        مدين: ذمم مدينة - شركات    دائن: ذمم النزلاء
 *   refund               مدين: ذمم النزلاء          دائن: حساب طريقة الدفع
 *   deposit              مدين: حساب طريقة الدفع     دائن: ودائع النزلاء
 *   deposit_application  مدين: ودائع النزلاء        دائن: ذمم النزلاء
 *   deposit_refund       مدين: ودائع النزلاء        دائن: حساب طريقة الدفع
 *   transfer_in/out      لا قيد (نفس حساب ذمم النزلاء)
 *
 * الإلغاء (void) ينشئ حركة معاكسة بنفس النوع واتجاه −1، ويعكس قيدها.
 *
 * ⚠ مطابق لأعمدة ledger_effect / deposit_effect في جدول folio_transactions (الترحيل 7).
 */
export const FOLIO_TXN_TYPES = [
  "charge",
  "allowance",
  "payment",
  "refund",
  "deposit",
  "deposit_application",
  "deposit_refund",
  "transfer_in",
  "transfer_out",
] as const;
export type FolioTxnType = (typeof FOLIO_TXN_TYPES)[number];

const LEDGER_SIGN: Record<FolioTxnType, -1 | 0 | 1> = {
  charge: 1,
  allowance: -1,
  payment: -1,
  refund: 1,
  deposit: 0,
  deposit_application: -1,
  deposit_refund: 0,
  transfer_in: 1,
  transfer_out: -1,
};

const DEPOSIT_SIGN: Record<FolioTxnType, -1 | 0 | 1> = {
  charge: 0,
  allowance: 0,
  payment: 0,
  refund: 0,
  deposit: 1,
  deposit_application: -1,
  deposit_refund: -1,
  transfer_in: 0,
  transfer_out: 0,
};

export interface FolioTxnInput {
  txn_type: FolioTxnType;
  total_amount: MoneyInput;
  /** 1 للحركة العادية، −1 لحركة الإلغاء */
  direction?: 1 | -1;
}

export function ledgerEffect(txn: FolioTxnInput): Money {
  return toMoney(txn.total_amount).times(LEDGER_SIGN[txn.txn_type] * (txn.direction ?? 1));
}

export function depositEffect(txn: FolioTxnInput): Money {
  return toMoney(txn.total_amount).times(DEPOSIT_SIGN[txn.txn_type] * (txn.direction ?? 1));
}

export interface FolioBalances {
  /** موجب = النزيل مدين للفندق؛ سالب = رصيد دائن للنزيل */
  balance: Money;
  deposits: Money;
  charges: Money;
  credits: Money;
}

export function folioBalances(txns: readonly FolioTxnInput[]): FolioBalances {
  let balance = ZERO;
  let deposits = ZERO;
  let charges = ZERO;
  let credits = ZERO;
  for (const t of txns) {
    const effect = ledgerEffect(t);
    balance = balance.plus(effect);
    deposits = deposits.plus(depositEffect(t));
    if (effect.isPositive() && !effect.isZero()) charges = charges.plus(effect);
    else credits = credits.plus(effect.negated());
  }
  return { balance, deposits, charges, credits };
}

export type CheckoutBlocker = "balance_not_zero" | "deposits_remaining" | "folio_not_open";

/** شروط إغلاق الفوليو (تسجيل المغادرة): رصيد صفري، ولا عربون غير مطبّق */
export function checkoutBlockers(status: string, balances: FolioBalances): CheckoutBlocker[] {
  const out: CheckoutBlocker[] = [];
  if (status !== "open") out.push("folio_not_open");
  if (!balances.balance.isZero()) out.push("balance_not_zero");
  if (!balances.deposits.isZero()) out.push("deposits_remaining");
  return out;
}

/** مقدار العربون الذي يمكن تطبيقه تلقائيًا عند المغادرة = الأقل من (العربون المتاح، الرصيد المستحق) */
export function applicableDeposit(balances: FolioBalances): Money {
  if (!balances.balance.isPositive() || balances.balance.isZero()) return ZERO;
  return balances.deposits.lt(balances.balance) ? balances.deposits : balances.balance;
}
