import { type Money, type MoneyInput, ZERO, roundMoney, toMoney } from "./money";

/**
 * جدول الإهلاك بالقسط الثابت (مطابق لـ app.monthly_depreciation في قاعدة البيانات):
 *  - القسط الشهري = (التكلفة − الخردة) / العمر بالأشهر، مقرّب لخانات العملة
 *  - الشهر الأخير يأخذ المتبقي بالضبط حتى يصل المجمع إلى (التكلفة − الخردة)
 *  - الإهلاك يبدأ من الشهر التالي لشهر الشراء
 */
export function straightLineSchedule(
  cost: MoneyInput, salvage: MoneyInput, lifeMonths: number, decimals = 2,
): Money[] {
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0) throw new RangeError("Useful life must be a positive integer");
  const base = toMoney(cost).minus(toMoney(salvage));
  if (!base.gt(0)) throw new RangeError("Cost must exceed salvage value");
  const monthly = roundMoney(base.div(lifeMonths), decimals);
  const out: Money[] = [];
  let acc = ZERO;
  for (let i = 0; i < lifeMonths; i++) {
    const remaining = base.minus(acc);
    const amt = i === lifeMonths - 1 ? remaining : monthly.lt(remaining) ? monthly : remaining;
    out.push(amt);
    acc = acc.plus(amt);
  }
  return out;
}

/** القيمة الدفترية وربح/خسارة الاستبعاد */
export function disposalResult(cost: MoneyInput, accumulated: MoneyInput, proceeds: MoneyInput) {
  const nbv = toMoney(cost).minus(toMoney(accumulated));
  return { netBookValue: nbv, gainLoss: toMoney(proceeds).minus(nbv) };
}

/** متوسط التكلفة المرجّح بعد وارد جديد (مطابق لـ post_inventory_movement) */
export function weightedAverageCost(qtyOnHand: MoneyInput, avgCost: MoneyInput, receivedQty: MoneyInput, unitCost: MoneyInput): Money {
  const q0 = toMoney(qtyOnHand);
  const q1 = toMoney(receivedQty);
  const total = q0.plus(q1);
  if (!total.gt(0)) return toMoney(avgCost);
  return q0.times(toMoney(avgCost)).plus(q1.times(toMoney(unitCost))).div(total);
}
