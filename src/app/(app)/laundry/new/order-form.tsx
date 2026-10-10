"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { createLaundryOrderAction } from "../../_services/actions";

type Item = { id: string; name: string; service: string; price: number };
type Guest = { reservation_id: string; label: string };

/** طلب غسيل لنزيل مقيم: الكميات من قائمة الأسعار، والمستعجل بنسبة إضافية؛ الترحيل على الفوليو عند التسليم */
export function LaundryOrderForm({ items, guests, errors, locale, decimals, initialGuest }: {
  items: Item[]; guests: Guest[]; errors: Record<string, string>; locale: string; decimals: number; initialGuest?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [guest, setGuest] = useState(guests.some((g) => g.reservation_id === initialGuest) ? initialGuest! : (guests[0]?.reservation_id ?? ""));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [express, setExpress] = useState(false);
  const [pct, setPct] = useState("50");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.min(500, Math.max(0, (q[id] ?? 0) + d)) }));
  const lines = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const factor = express ? 1 + (Number(pct) || 0) / 100 : 1;
  const total = lines.reduce((s, i) => s + i.price * factor * qty[i.id]!, 0);
  const money = (n: number) => formatMoney(n, { locale, decimals });

  const submit = () => start(async () => {
    setError(null);
    const r = await callAction(createLaundryOrderAction({
      reservation_id: guest, lines: lines.map((i) => ({ item_id: i.id, quantity: qty[i.id]! })), express, express_pct: express ? pct : "0", notes,
    }));
    if (r.ok) { toast(tr("استُلم طلب الغسيل")); router.push("/laundry"); } else setError(actionErrorText(errors, r));
  });

  if (guests.length === 0) return <Alert>{tr("لا يوجد نزلاء مقيمون الآن. طلبات الغسيل للنزلاء المسكَّنين فقط.")}</Alert>;
  if (items.length === 0) return <Alert>{tr("أضف أصناف قائمة أسعار المغسلة أولًا.")}</Alert>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{tr("الأصناف")}</CardTitle></CardHeader>
        <div className="divide-y divide-line">
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-6 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{i.name}</p>
                <p className="text-[14px] text-slate-500">{i.service}<span className="ms-2 num">{money(i.price)}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="ghost" aria-label={tr("إنقاص {0}", i.name)} onClick={() => add(i.id, -1)} disabled={!qty[i.id]}><Minus className="size-4" /></Button>
                <span className="num w-8 text-center font-semibold" data-qty={i.id}>{qty[i.id] ?? 0}</span>
                <Button type="button" size="sm" variant="outline" aria-label={tr("إضافة {0}", i.name)} onClick={() => add(i.id, 1)}><Plus className="size-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader><CardTitle>{tr("الطلب")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-1.5"><Label htmlFor="reservation_id">{tr("النزيل")}</Label>
            <NativeSelect id="reservation_id" value={guest} onChange={(e) => setGuest(e.target.value)}>
              {guests.map((g) => <option key={g.reservation_id} value={g.reservation_id}>{g.label}</option>)}
            </NativeSelect></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={express} onChange={(e) => setExpress(e.target.checked)} />{tr("خدمة مستعجلة")}</label>
          {express && (
            <div className="space-y-1.5"><Label htmlFor="express_pct">{tr("نسبة الإضافة للمستعجل")}</Label>
              <Input id="express_pct" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="notes">{tr("ملاحظات")}</Label><Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="flex items-center justify-between border-t border-line pt-4">
            <span className="text-slate-500">{tr("الإجمالي")}</span><span className="num text-[18px] font-bold">{money(total)}</span>
          </div>
          <Button type="button" className="w-full" loading={pending} disabled={lines.length === 0 || !guest} onClick={submit}>{tr("استلام الطلب")}</Button>
          <p className="text-[14px] text-slate-500">{tr("تُرحَّل القيمة على فوليو الغرفة عند تسليم الطلب للنزيل.")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
