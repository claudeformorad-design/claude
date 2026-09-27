"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Minus, Plus, ReceiptText, Wallet } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import { settlePosOrderAction } from "../_ops/actions";

type Item = { id: string; name: string; category: string | null; price: number };
type Guest = { reservation_id: string; label: string };
type Method = { id: string; label: string };

/**
 * شاشة البيع: اختيار الأصناف بنقرة، ثم الترحيل على غرفة نزيل مقيم أو الدفع الفوري بفاتورة ضريبية.
 * الأسعار المعروضة قبل الضريبة إن كان رمز الإيراد لا يشمل الضريبة؛ الإجمالي النهائي تحسبه قاعدة البيانات.
 */
export function PosTerminal({ outletId, items, guests, methods, errors, canViewInvoices }: {
  outletId: string; items: Item[]; guests: Guest[]; methods: Method[]; errors: Record<string, string>; canViewInvoices: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cat, setCat] = useState<string | null>(null);
  const [mode, setMode] = useState<"room" | "paid">(guests.length ? "room" : "paid");
  const [guest, setGuest] = useState(guests[0]?.reservation_id ?? "");
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [last, setLast] = useState<{ number: string; total: number; invoice: string | null } | null>(null);
  const money = (n: number) => formatMoney(n, { locale: "ar" });

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))] as string[], [items]);
  const shown = cat ? items.filter((i) => i.category === cat) : items;
  const lines = items.filter((i) => cart[i.id]).map((i) => ({ ...i, qty: cart[i.id]! }));
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const add = (id: string, d: number) => setCart((c) => {
    const q = Math.max(0, (c[id] ?? 0) + d);
    const next = { ...c };
    if (q === 0) delete next[id]; else next[id] = q;
    return next;
  });

  const settle = () => start(async () => {
    const r = await callAction(settlePosOrderAction({
      outlet_id: outletId, lines: lines.map((l) => ({ item_id: l.id, quantity: l.qty })), mode,
      reservation_id: mode === "room" ? guest : null, payment_method_id: mode === "paid" ? method : null, note,
    }));
    if (r.ok) {
      toast(mode === "room" ? "رُحّل الطلب على الغرفة" : "تم الدفع وصدرت الفاتورة");
      setLast({ number: r.data.order_number, total: Number(r.data.total), invoice: r.data.invoice_id });
      setCart({}); setNote("");
      router.refresh();
    } else toast(actionErrorText(errors, r), "error");
  });

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[null, ...categories].map((c) => (
              <button key={c ?? "all"} type="button" onClick={() => setCat(c)}
                className={cn("h-9 rounded-md border px-3 text-[15.5px] font-medium", cat === c ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong")}>
                {c ?? "الكل"}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0 && <p className="rounded-lg border border-dashed border-line p-8 text-center text-slate-500">لا أصناف في هذه النقطة بعد</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {shown.map((i) => (
            <button key={i.id} type="button" onClick={() => add(i.id, 1)}
              className={cn("surface lift relative flex min-h-24 flex-col items-start justify-between p-4 text-start", cart[i.id] && "border-action")}>
              <span className="text-[16.5px] font-semibold leading-snug text-ink">{i.name}</span>
              <span className="num text-[15px] text-slate-600">{money(i.price)}</span>
              {cart[i.id] && <span className="num absolute end-3 top-3 flex size-7 items-center justify-center rounded-full bg-action text-[14px] font-bold text-white">{cart[i.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <Card className="h-fit xl:sticky xl:top-0">
        <CardHeader><CardTitle className="justify-between"><span>الطلب</span>{lines.length > 0 && <button type="button" onClick={() => setCart({})} className="font-medium text-urgent">تفريغ</button>}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {lines.length === 0 ? <p className="text-[15.5px] text-slate-500">اختر الأصناف من القائمة.</p> : (
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{l.name}</span><span className="num text-[14px] text-slate-500">{money(l.price)}</span></span>
                  <span className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="outline" aria-label="إنقاص" onClick={() => add(l.id, -1)}><Minus className="size-3.5" /></Button>
                    <span className="num w-7 text-center font-bold">{l.qty}</span>
                    <Button type="button" size="sm" variant="outline" aria-label="زيادة" onClick={() => add(l.id, 1)}><Plus className="size-3.5" /></Button>
                  </span>
                  <span className="num w-20 text-end font-semibold">{money(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between rounded-lg bg-panel p-3"><span className="text-slate-600">المجموع</span><span className="num text-[22px] font-bold text-ink">{money(subtotal)}</span></div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("room")} disabled={!guests.length}
              className={cn("flex h-11 items-center justify-center gap-2 rounded-md border text-[15.5px] font-medium disabled:opacity-40", mode === "room" ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700")}>
              <BedDouble className="size-4" />على الغرفة
            </button>
            <button type="button" onClick={() => setMode("paid")}
              className={cn("flex h-11 items-center justify-center gap-2 rounded-md border text-[15.5px] font-medium", mode === "paid" ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700")}>
              <Wallet className="size-4" />دفع فوري
            </button>
          </div>
          {mode === "room" ? (
            <div className="field-group space-y-1.5">
              <Label htmlFor="pos_guest">النزيل</Label>
              <NativeSelect id="pos_guest" value={guest} onChange={(e) => setGuest(e.target.value)}>
                {guests.map((g) => <option key={g.reservation_id} value={g.reservation_id}>{g.label}</option>)}
              </NativeSelect>
            </div>
          ) : (
            <div className="field-group space-y-1.5">
              <Label htmlFor="pos_method">طريقة الدفع</Label>
              <NativeSelect id="pos_method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </NativeSelect>
            </div>
          )}
          <div className="field-group space-y-1.5"><Label htmlFor="pos_note">ملاحظة، مثل رقم الطاولة</Label><Input id="pos_note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button type="button" className="w-full" size="default" loading={pending} disabled={!lines.length || (mode === "room" ? !guest : !method)} onClick={settle}>
            {mode === "room" ? "ترحيل على الغرفة" : "دفع وإصدار الفاتورة"}
          </Button>
          {last && (
            <div className="rounded-md bg-success/10 px-3 py-2 text-[15px] text-success">
              الطلب <b className="num">{last.number}</b> بمبلغ <span className="num">{money(last.total)}</span> شامل الضريبة
              {last.invoice && canViewInvoices && <Link href={`/invoices/${last.invoice}`} className="ms-2 inline-flex items-center gap-1 font-medium"><ReceiptText className="size-4" />الفاتورة</Link>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
