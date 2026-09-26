import { type Money, type MoneyInput, MoneyDecimal, ZERO, roundMoney, toMoney } from "./money";

/**
 * حساب الضرائب على بند (قابل للتهيئة بالكامل — لا نفترض نسبة أو دولة).
 *
 * أنواع الضرائب:
 *  - ضريبة بسيطة (is_compound = false): تُحسب على الصافي.
 *      مثال: رسوم البلدية 2.5% على قيمة الغرفة.
 *  - ضريبة مركّبة (is_compound = true): تُحسب على (الصافي + مجموع الضرائب البسيطة).
 *      مثال: دولة تحتسب ضريبة القيمة المضافة على (الغرفة + رسوم البلدية).
 *
 * السعر قد يكون:
 *  - غير شامل للضريبة (exclusive): المبلغ المدخل = الصافي.
 *  - شامل للضريبة (inclusive): المبلغ المدخل = الإجمالي، ونستخرج الصافي:
 *      الإجمالي = الصافي × (1 + Σبسيطة) × (1 + Σمركّبة)
 *
 * التقريب: كل ضريبة تُقرّب لخانات العملة (نصف للأعلى). في السعر الشامل يُضبط
 * الصافي ليكون (الإجمالي − مجموع الضرائب المقرّبة) حتى يطابق الإجمالي المدخل حرفيًا.
 *
 * ⚠ هذه الخوارزمية مطابقة تمامًا لـ app.compute_taxes في قاعدة البيانات
 *   (الترحيل 6)، والاختبارات في الطرفين تستخدم نفس الأمثلة.
 */
export interface TaxRateInput {
  id: string;
  /** النسبة المئوية، مثل 15 تعني 15% */
  rate: MoneyInput;
  is_compound: boolean;
}

export interface TaxLine {
  tax_rate_id: string;
  taxable_base: Money;
  amount: Money;
}

export interface TaxBreakdown {
  net: Money;
  taxTotal: Money;
  total: Money;
  taxes: TaxLine[];
}

const HUNDRED = new MoneyDecimal(100);

export function computeTaxes(
  amount: MoneyInput,
  taxes: readonly TaxRateInput[],
  options: { inclusive: boolean; decimals: number },
): TaxBreakdown {
  const { inclusive, decimals } = options;
  const entered = roundMoney(amount, decimals);
  if (entered.isNegative()) throw new RangeError("Amount must not be negative");

  const simple = taxes.filter((t) => !t.is_compound);
  const compound = taxes.filter((t) => t.is_compound);
  const pct = (t: TaxRateInput) => {
    const r = toMoney(t.rate);
    if (r.isNegative()) throw new RangeError("Tax rate must not be negative");
    return r.div(HUNDRED);
  };
  const simpleRate = simple.reduce((acc, t) => acc.plus(pct(t)), ZERO);
  const compoundRate = compound.reduce((acc, t) => acc.plus(pct(t)), ZERO);

  // الصافي قبل ضبط التقريب
  let net = inclusive
    ? roundMoney(entered.div(new MoneyDecimal(1).plus(simpleRate).times(new MoneyDecimal(1).plus(compoundRate))), decimals)
    : entered;

  const build = (base: Money): TaxLine[] => {
    const lines: TaxLine[] = simple.map((t) => ({ tax_rate_id: t.id, taxable_base: base, amount: roundMoney(base.times(pct(t)), decimals) }));
    const simpleSum = lines.reduce((acc, l) => acc.plus(l.amount), ZERO);
    const compoundBase = base.plus(simpleSum);
    for (const t of compound) {
      lines.push({ tax_rate_id: t.id, taxable_base: compoundBase, amount: roundMoney(compoundBase.times(pct(t)), decimals) });
    }
    return lines;
  };

  let lines = build(net);
  let taxTotal = lines.reduce((acc, l) => acc.plus(l.amount), ZERO);

  if (inclusive) {
    // ضبط فرق التقريب في الصافي حتى يساوي المجموع المبلغ المدخل تمامًا
    // الوعاء الضريبي المعروض يتبع الصافي النهائي (المبالغ الضريبية تبقى كما قُرّبت)
    net = entered.minus(taxTotal);
    const simpleSum = lines.slice(0, simple.length).reduce((acc, l) => acc.plus(l.amount), ZERO);
    lines = lines.map((l, i) => ({ ...l, taxable_base: i < simple.length ? net : net.plus(simpleSum) }));
  }

  return { net, taxTotal, total: net.plus(taxTotal), taxes: lines };
}

/**
 * تقسيم تسوية/خصم (مبلغ إجمالي شامل) على نفس ضرائب البند الأصلي.
 * تُستخدم للخصومات على بنود الفوليو بحيث تُعكس الضريبة بنفس النسب.
 */
export function splitGrossAmount(
  gross: MoneyInput,
  taxes: readonly TaxRateInput[],
  decimals: number,
): TaxBreakdown {
  return computeTaxes(gross, taxes, { inclusive: true, decimals });
}
