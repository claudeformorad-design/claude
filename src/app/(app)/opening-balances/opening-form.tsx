"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText } from "@/lib/action-error";
import { formatMoney, normalizeDigits } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import { postOpeningBalancesAction } from "./actions";

type Option = { id: string; label: string };
type AccRow = { account_id: string; debit: string; credit: string };
type PartyRow = { id: string; amount: string; reference: string };

const num = (v: string) => { const n = Number(normalizeDigits(v)); return Number.isFinite(n) ? n : 0; };

/**
 * إدخال الأرصدة الافتتاحية: الحسابات العامة (مدين/دائن)، أرصدة العملاء، أرصدة الموردين.
 * الفرق بين الجانبين يظهر مباشرة ويُقفل في الأرباح المبقاة عند الترحيل.
 */
export function OpeningForm({ accounts, customers, vendors, today, errors }: {
  accounts: Option[]; customers: Option[]; vendors: Option[]; today: string; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<AccRow[]>([{ account_id: "", debit: "", credit: "" }]);
  const [cust, setCust] = useState<PartyRow[]>([]);
  const [vend, setVend] = useState<PartyRow[]>([]);
  const money = (n: number) => formatMoney(n, { locale: "ar" });

  const dr = rows.reduce((a, r) => a + num(r.debit), 0) + cust.reduce((a, r) => a + num(r.amount), 0);
  const cr = rows.reduce((a, r) => a + num(r.credit), 0) + vend.reduce((a, r) => a + num(r.amount), 0);
  const diff = dr - cr;

  const submit = () => start(async () => {
    setError(null);
    const r = await postOpeningBalancesAction({
      date,
      accounts: rows.filter((x) => x.account_id).map((x) => ({ account_id: x.account_id, debit: x.debit, credit: x.credit })),
      customers: cust.filter((x) => x.id).map((x) => ({ customer_id: x.id, amount: x.amount, reference: x.reference })),
      vendors: vend.filter((x) => x.id).map((x) => ({ vendor_id: x.id, amount: x.amount, reference: x.reference })),
    });
    if (r.ok) { toast("رُحّلت الأرصدة الافتتاحية"); router.push(`/journal/${r.data}`); } else setError(actionErrorText(errors, r));
  });

  const party = (title: string, desc: string, list: PartyRow[], set: (v: PartyRow[]) => void, options: Option[], prefix: string) => (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>{title}</CardTitle><CardDescription>{desc}</CardDescription></div>
        <Button type="button" size="sm" variant="outline" disabled={!options.length} onClick={() => set([...list, { id: "", amount: "", reference: "" }])}><Plus className="size-4" />إضافة</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!options.length && <p className="text-[15px] text-slate-500">لا توجد سجلات بعد، أضفها أولًا من صفحتها.</p>}
        {list.map((x, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_1fr_auto] items-center gap-2">
            <NativeSelect aria-label={`${prefix} ${i + 1}`} value={x.id} onChange={(e) => set(list.map((y, j) => j === i ? { ...y, id: e.target.value } : y))}>
              <option value="">اختر</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </NativeSelect>
            <Input aria-label="المبلغ" inputMode="decimal" dir="ltr" value={x.amount} onChange={(e) => set(list.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} placeholder="المبلغ" />
            <Input aria-label="المرجع" value={x.reference} onChange={(e) => set(list.map((y, j) => j === i ? { ...y, reference: e.target.value } : y))} placeholder="رقم الكشف أو الفاتورة" />
            <Button type="button" size="sm" variant="ghost" aria-label="حذف" onClick={() => set(list.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>الحسابات العامة</CardTitle><CardDescription>الصندوق، البنوك، الأصول الثابتة، القروض، رأس المال...</CardDescription></div>
            <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { account_id: "", debit: "", credit: "" }])}><Plus className="size-4" />سطر</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-[1fr_140px_140px_auto] gap-2 px-1 text-[14px] text-slate-500"><span>الحساب</span><span>مدين</span><span>دائن</span><span className="w-9" /></div>
            {rows.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_140px_auto] items-center gap-2">
                <NativeSelect aria-label={`الحساب ${i + 1}`} value={x.account_id} onChange={(e) => setRows(rows.map((y, j) => j === i ? { ...y, account_id: e.target.value } : y))}>
                  <option value="">اختر الحساب</option>{accounts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </NativeSelect>
                <Input aria-label={`مدين ${i + 1}`} inputMode="decimal" dir="ltr" value={x.debit} onChange={(e) => setRows(rows.map((y, j) => j === i ? { ...y, debit: e.target.value, credit: e.target.value ? "" : y.credit } : y))} />
                <Input aria-label={`دائن ${i + 1}`} inputMode="decimal" dir="ltr" value={x.credit} onChange={(e) => setRows(rows.map((y, j) => j === i ? { ...y, credit: e.target.value, debit: e.target.value ? "" : y.debit } : y))} />
                <Button type="button" size="sm" variant="ghost" aria-label="حذف" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        {party("أرصدة العملاء المدينة", "ما على الشركات والعملاء للفندق، ويُحصَّل لاحقًا بسندات القبض", cust, setCust, customers, "العميل")}
        {party("أرصدة الموردين الدائنة", "ما على الفندق للموردين، ويُسدَّد لاحقًا من صفحة الموردين", vend, setVend, vendors, "المورد")}
      </div>

      <Card>
        <CardHeader><CardTitle>الترحيل</CardTitle><CardDescription>يُرحَّل مرة واحدة، وللتصحيح لاحقًا استخدم قيد تسوية</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="field-group w-56 space-y-1.5"><Label htmlFor="opening_date">تاريخ الأرصدة</Label><Input id="opening_date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><p className="text-[15px] text-slate-500">إجمالي المدين</p><p className="num text-[20px] font-bold">{money(dr)}</p></div>
            <div className="space-y-1"><p className="text-[15px] text-slate-500">إجمالي الدائن</p><p className="num text-[20px] font-bold">{money(cr)}</p></div>
            <div className={cn("rounded-lg px-4 py-2.5 text-[16px] font-semibold", diff === 0 ? "bg-success/10 text-success" : "bg-amber-tint text-amber")}>
              {diff === 0 ? "متوازن" : `الفرق للأرباح المبقاة ${money(Math.abs(diff))} ${diff > 0 ? "دائن" : "مدين"}`}
            </div>
            <Button type="button" className="ms-auto" loading={pending} disabled={dr === 0 && cr === 0} onClick={submit}>ترحيل الأرصدة الافتتاحية</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
