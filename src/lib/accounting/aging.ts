import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

/** تجميع تقرير الأعمار حسب الطرف (عميل/مورد) والشريحة الزمنية */
export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingDocument {
  party_id: string;
  party_name: string;
  document_id: string;
  document_number: string;
  outstanding: MoneyInput;
  bucket: AgingBucket;
}

type Buckets = Record<AgingBucket, Money>;
const emptyBuckets = (): Buckets => ({ current: ZERO, "1_30": ZERO, "31_60": ZERO, "61_90": ZERO, over_90: ZERO });

/** شريحة التأخر من عدد الأيام بعد الاستحقاق (مطابقة لـ public.aging_report) */
export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1_30";
  if (daysPastDue <= 60) return "31_60";
  if (daysPastDue <= 90) return "61_90";
  return "over_90";
}

export function summarizeAging<T extends AgingDocument>(rows: readonly T[]) {
  const map = new Map<string, { partyId: string; partyName: string; buckets: Buckets; total: Money; documents: T[] }>();
  const totals = { buckets: emptyBuckets(), total: ZERO };
  for (const r of rows) {
    const amt = toMoney(r.outstanding);
    const p = map.get(r.party_id) ?? { partyId: r.party_id, partyName: r.party_name, buckets: emptyBuckets(), total: ZERO, documents: [] };
    p.buckets[r.bucket] = p.buckets[r.bucket].plus(amt);
    p.total = p.total.plus(amt);
    p.documents.push(r);
    map.set(r.party_id, p);
    totals.buckets[r.bucket] = totals.buckets[r.bucket].plus(amt);
    totals.total = totals.total.plus(amt);
  }
  return { parties: [...map.values()].sort((a, b) => b.total.comparedTo(a.total)), totals };
}
