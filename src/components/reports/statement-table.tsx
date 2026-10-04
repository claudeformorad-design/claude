import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { formatMoney, type Money } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";

export type StatementRow = { date: string; number: string; label: string; description: string; debit: Money; credit: Money; balance: Money; href?: string };

const KIND_LABEL: Record<string, string> = { get invoice() { return tr("فاتورة"); }, get credit_note() { return tr("إشعار دائن"); }, get receipt() { return tr("سند قبض"); }, get refund() { return tr("سند صرف"); } };
export const statementKind = (k: string) => KIND_LABEL[k] ?? k;

/**
 * جدول كشف الحساب: رصيد افتتاحي، حركات مدينة ودائنة برصيد جارٍ، ثم المجاميع والرصيد الختامي.
 * يُستخدم في الشاشة وفي نسخة الطباعة؛ الروابط تظهر في الشاشة فقط.
 */
export function StatementTable({ rows, opening, debit, credit, closing, decimals, links = false }: {
  rows: StatementRow[]; opening: Money; debit: Money; credit: Money; closing: Money; decimals: number; links?: boolean;
}) {
  const m = (v: Money, blank = true) => (blank && v.isZero() ? "" : formatMoney(v, { locale: "ar", decimals }));
  const cell = "border-b border-line px-3.5 py-2.5";
  return (
    <div className="overflow-hidden rounded-lg">
      <table className="report-doc-table w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {[tr("التاريخ"), tr("المستند"), tr("البيان"), tr("مدين"), tr("دائن"), tr("الرصيد")].map((h, i) => (
              <th key={h} className={cn("bg-ink px-3.5 py-3 font-bold text-white", i < 3 ? "text-start" : "text-end")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold">
            <td colSpan={5} className="bg-group-row px-3.5 py-2.5">{tr("الرصيد الافتتاحي")}</td>
            <td className="num bg-group-row px-3.5 py-2.5 text-end">{m(opening, false)}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={cn(cell, "num whitespace-nowrap")}>{r.date}</td>
              <td className={cn(cell, "whitespace-nowrap")}>
                <span className="text-slate-500">{r.label} </span>
                {links && r.href ? <Link href={r.href} className="num text-accent1">{r.number}</Link> : <span className="num">{r.number}</span>}
              </td>
              <td className={cn(cell, "text-slate-700")}>{r.description}</td>
              <td className={cn(cell, "num text-end")}>{m(r.debit)}</td>
              <td className={cn(cell, "num text-end")}>{m(r.credit)}</td>
              <td className={cn(cell, "num text-end font-semibold")}>{m(r.balance, false)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className={cn(cell, "py-6 text-center text-slate-500")}>{tr("لا توجد حركات في هذه الفترة")}</td></tr>}
          <tr className="font-bold">
            <td colSpan={3} className="border-t-2 border-ink px-3.5 py-3">{tr("مجموع الحركات")}</td>
            <td className="num border-t-2 border-ink px-3.5 py-3 text-end">{m(debit, false)}</td>
            <td className="num border-t-2 border-ink px-3.5 py-3 text-end">{m(credit, false)}</td>
            <td className="border-t-2 border-ink px-3.5 py-3" />
          </tr>
          <tr className="font-bold text-white">
            <td colSpan={5} className="bg-ink px-3.5 py-3.5 text-[14.5px]">{closing.isNegative() ? tr("الرصيد الختامي دائن للعميل") : tr("الرصيد الختامي المستحق")}</td>
            <td className="num bg-ink px-3.5 py-3.5 text-end text-[14.5px]">{m(closing.abs(), false)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
