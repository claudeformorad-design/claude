"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { saveEventAction } from "../_services/actions";

type Option = { id: string; label: string };
type Line = { description: string; per_person: boolean; quantity: string; unit_price: string; charge_code_id: string };
export type EventFormValues = {
  id: string; title: string; event_type: string; contact_name: string; contact_phone: string; customer_id: string; hall_room_id: string;
  starts_at: string; ends_at: string; guests_count: string; discount: string; notes: string; terms: string; items: Line[];
};

/**
 * عقد المناسبة: البيانات والقاعة والوقت وبنود العقد. البند «للفرد» تتبع كميته عدد الحضور تلقائيًا.
 * الحفظ يتحقق في قاعدة البيانات من تعارض القاعة مع المناسبات والحجوزات بالساعة.
 */
export function EventForm({ initial, types, halls, customers, chargeCodes, errors, locale, decimals }: {
  initial: EventFormValues; types: Option[]; halls: Option[]; customers: Option[]; chargeCodes: Option[];
  errors: Record<string, string>; locale: string; decimals: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EventFormValues>(k: K, val: EventFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const guests = Number(v.guests_count) || 0;
  const qtyOf = (l: Line) => (l.per_person ? guests : Number(l.quantity) || 0);
  const gross = v.items.reduce((s, l) => s + qtyOf(l) * (Number(l.unit_price) || 0), 0);
  const net = gross - (Number(v.discount) || 0);
  const money = (n: number) => formatMoney(n, { locale, decimals });
  const setLine = (i: number, patch: Partial<Line>) => setV((x) => ({ ...x, items: x.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const submit = () => start(async () => {
    setError(null);
    const r = await callAction(saveEventAction({
      ...v, guests_count: guests,
      items: v.items.filter((l) => l.description.trim()).map((l) => ({ ...l, quantity: String(qtyOf(l)), unit_price: l.unit_price || "0" })),
    }));
    if (r.ok) { toast(tr("تم حفظ المناسبة")); router.push(`/events/${r.data}`); } else setError(actionErrorText(errors, r));
  });

  const field = (k: keyof EventFormValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5"><Label htmlFor={k}>{label}</Label>
      <Input id={k} value={v[k] as string} onChange={(e) => set(k, e.target.value as never)} {...props} /></div>
  );

  return (
    <div className="space-y-6">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>{tr("بيانات المناسبة")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {field("title", tr("عنوان المناسبة"))}
          <div className="space-y-1.5"><Label htmlFor="event_type">{tr("النوع")}</Label>
            <NativeSelect id="event_type" value={v.event_type} onChange={(e) => set("event_type", e.target.value)}>{types.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="hall_room_id">{tr("القاعة")}</Label>
            <NativeSelect id="hall_room_id" value={v.hall_room_id} onChange={(e) => set("hall_room_id", e.target.value)}>
              <option value="">{tr("خارج القاعات")}</option>{halls.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></div>
          {field("starts_at", tr("من"), { type: "datetime-local", dir: "ltr" })}
          {field("ends_at", tr("إلى"), { type: "datetime-local", dir: "ltr" })}
          {field("guests_count", tr("عدد الحضور"), { inputMode: "numeric", dir: "ltr" })}
          {field("contact_name", tr("صاحب المناسبة"))}
          {field("contact_phone", tr("الجوال"), { dir: "ltr" })}
          <div className="space-y-1.5"><Label htmlFor="customer_id">{tr("الشركة")}</Label>
            <NativeSelect id="customer_id" value={v.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
              <option value="">{tr("بدون")}</option>{customers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{tr("بنود العقد")}</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => set("items", [...v.items, { description: "", per_person: false, quantity: "1", unit_price: "", charge_code_id: "" }])}><Plus className="size-4" />{tr("بند")}</Button>
        </CardHeader>
        <div className="divide-y divide-line">
          {v.items.map((l, i) => (
            <div key={i} className="grid items-end gap-3 px-6 py-3 md:grid-cols-[minmax(0,2fr)_120px_110px_140px_minmax(0,1fr)_auto]">
              <div className="space-y-1.5"><Label htmlFor={`d${i}`}>{tr("البند")}</Label><Input id={`d${i}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></div>
              <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={l.per_person} onChange={(e) => setLine(i, { per_person: e.target.checked })} />{tr("للفرد")}</label>
              <div className="space-y-1.5"><Label htmlFor={`q${i}`}>{tr("الكمية")}</Label>
                <Input id={`q${i}`} dir="ltr" inputMode="decimal" disabled={l.per_person} value={l.per_person ? String(guests) : l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor={`p${i}`}>{tr("السعر")}</Label><Input id={`p${i}`} dir="ltr" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor={`c${i}`}>{tr("الإيراد")}</Label>
                <NativeSelect id={`c${i}`} value={l.charge_code_id} onChange={(e) => setLine(i, { charge_code_id: e.target.value })}>
                  <option value="">{tr("القاعات والمناسبات")}</option>{chargeCodes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></div>
              <Button type="button" variant="ghost" size="sm" aria-label={tr("حذف البند")} disabled={v.items.length === 1}
                onClick={() => set("items", v.items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <div className="grid gap-4 border-t border-line px-6 py-4 md:grid-cols-3">
          {field("discount", tr("الخصم"), { inputMode: "decimal", dir: "ltr" })}
          <div className="flex flex-col justify-end"><span className="text-[14px] text-slate-500">{tr("الإجمالي")}</span><span className="num font-semibold">{money(gross)}</span></div>
          <div className="flex flex-col justify-end"><span className="text-[14px] text-slate-500">{tr("الصافي")}</span><span className="num text-[18px] font-bold" data-net>{money(net)}</span></div>
        </div>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="terms">{tr("شروط العقد")}</Label><Textarea id="terms" rows={4} value={v.terms} onChange={(e) => set("terms", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="notes">{tr("ملاحظات داخلية")}</Label><Textarea id="notes" rows={4} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </CardContent>
      </Card>
      <Button type="button" loading={pending} onClick={submit}>{tr("حفظ المناسبة")}</Button>
    </div>
  );
}
