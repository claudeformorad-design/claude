"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tr } from "@/i18n/tr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { stockCountAction } from "../_assets/actions";

type Item = { id: string; sku: string; name: string; unit: string; barcode: string | null; onHand: string; avgCost: string; category: string };

/** شاشة الجرد: الكمية المعدودة لكل صنف (يُترك فارغًا ما لم يُعَد)، مع البحث بالباركود والفرق الفوري */
export function StockCountForm({ items, today, errors }: { items: Item[]; today: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((x) => x.sku.toLowerCase().includes(s) || x.name.toLowerCase().includes(s) || (x.barcode ?? "").toLowerCase() === s) : items;
  }, [q, items]);
  const entered = Object.entries(counted).filter(([, v]) => v.trim() !== "");
  const invalid = entered.some(([, v]) => !isValidAmount(v) || toMoney(v).isNegative());
  const diff = (it: Item) => {
    const v = counted[it.id];
    return v && isValidAmount(v) ? toMoney(v).minus(toMoney(it.onHand)) : null;
  };
  const changed = items.filter((it) => { const d = diff(it); return d && !d.isZero(); });
  const value = changed.reduce((s, it) => s.plus(diff(it)!.times(toMoney(it.avgCost))), toMoney(0));

  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-72" placeholder={tr("ابحث بالرمز أو الاسم أو امسح الباركود")} aria-label={tr("بحث")} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) { e.preventDefault(); document.getElementById(`count-${shown[0]!.id}`)?.focus(); } }} />
        <Input className="w-44" type="date" dir="ltr" aria-label={tr("تاريخ الجرد")} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input className="w-72" placeholder={tr("ملاحظة (اختياري)")} aria-label={tr("ملاحظة")} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>{tr("الصنف")}</TableHead><TableHead>{tr("الفئة")}</TableHead><TableHead>{tr("الوحدة")}</TableHead>
          <TableHead className="text-end">{tr("الكمية بالنظام")}</TableHead><TableHead className="w-40">{tr("الكمية المعدودة")}</TableHead>
          <TableHead className="text-end">{tr("الفرق")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {shown.map((it) => {
            const d = diff(it);
            return (
              <TableRow key={it.id}>
                <TableCell><span className="num font-semibold">{it.sku}</span> {it.name}</TableCell>
                <TableCell className="text-slate-600">{it.category}</TableCell>
                <TableCell className="text-slate-600">{it.unit}</TableCell>
                <TableCell className="num text-end">{toMoney(it.onHand).toString()}</TableCell>
                <TableCell>
                  <Input id={`count-${it.id}`} className="num" dir="ltr" inputMode="decimal" aria-label={tr("الكمية المعدودة لـ {0}", it.name)}
                    value={counted[it.id] ?? ""} onChange={(e) => setCounted({ ...counted, [it.id]: e.target.value })} />
                </TableCell>
                <TableCell className={`num text-end ${d && d.lt(0) ? "text-urgent" : d && d.gt(0) ? "text-emerald-700" : "text-slate-400"}`}>
                  {d ? (d.gt(0) ? `+${d.toString()}` : d.toString()) : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={pending} disabled={pending || entered.length === 0 || invalid} onClick={() => {
          if (changed.length && !window.confirm(tr("ترحيل الجرد؟ سيُسجَّل {0} فرق تسويةً في المخزون والقيود.", changed.length))) return;
          start(async () => {
            setError(null);
            const r = await callAction(stockCountAction({ date, note, lines: entered.map(([item_id, v]) => ({ item_id, counted: v })) }));
            if (r.ok) { toast(tr("رُحّل الجرد")); setCounted({}); setNote(""); router.refresh(); } else setError(actionErrorText(errors, r));
          });
        }}>{tr("ترحيل الجرد")}</Button>
        <span className="text-[14px] text-slate-600">
          {tr("معدود {0} صنف، بفروقات في {1}", entered.length, changed.length)}{" "}
          {changed.length > 0 && <span className={`num ${value.lt(0) ? "text-urgent" : "text-emerald-700"}`}>{tr("قيمة تقريبية {0}", value.toFixed(2))}</span>}
        </span>
      </div>
    </div>
  );
}
