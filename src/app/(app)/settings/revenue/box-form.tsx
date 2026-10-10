"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDialogClose } from "@/components/ui/dialog";
import { actionErrorText, callAction } from "@/lib/action-error";
import { createPaymentBoxAction } from "./actions";

type Kind = "cash" | "e_wallet" | "bank_transfer";
type Draft = { kind: Kind; code: string; name_ar: string; name_en: string; currency: string; requires_reference: boolean };

/** المحافظ المنتشرة في اليمن: تُضاف بضغطة، ويبقى بإمكانك إضافة أي محفظة أخرى بالاسم */
const WALLETS: { code: string; name_ar: string; name_en: string }[] = [
  { code: "JAWALI", name_ar: "جوالي", name_en: "Jawali" },
  { code: "ONECASH", name_ar: "ون كاش", name_en: "ONE Cash" },
  { code: "FLOOSAK", name_ar: "فلوسك", name_en: "Floosak" },
  { code: "KURAIMI", name_ar: "الكريمي", name_en: "Kuraimi" },
];
const CURRENCY_BOXES: { currency: string; code: string; name_ar: string; name_en: string }[] = [
  { currency: "USD", code: "CASH-USD", name_ar: "صندوق الدولار", name_en: "US dollar cash" },
  { currency: "SAR", code: "CASH-SAR", name_ar: "صندوق الريال السعودي", name_en: "Saudi riyal cash" },
  { currency: "YRO", code: "CASH-YRO", name_ar: "صندوق الريال اليمني طبعة قديمة", name_en: "Yemeni rial old notes cash" },
  { currency: "YRN", code: "CASH-YRN", name_ar: "صندوق الريال اليمني طبعة جديدة", name_en: "Yemeni rial new notes cash" },
];

/**
 * صندوق أو محفظة جديدة: يُنشأ لها حساب مستقل في دليل الحسابات بجوار الصندوق الرئيسي (أو البنوك)،
 * فيظهر رصيدها لوحده في تقرير النقدية بالعملات، وتُعدّ لوحدها في إغلاق الوردية.
 */
export function PaymentBoxForm({ errors, baseCurrency, currencies, existingCodes }: {
  errors: Record<string, string>; baseCurrency: string; currencies: { id: string; label: string }[]; existingCodes: string[];
}) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<Draft>({ kind: "cash", code: "", name_ar: "", name_en: "", currency: "", requires_reference: false });
  const used = new Set(existingCodes);
  const wallets = WALLETS.filter((w) => !used.has(w.code));
  const boxes = CURRENCY_BOXES.filter((b) => b.currency !== baseCurrency && !used.has(b.code) && currencies.some((c) => c.id === b.currency));

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setError(null);
        const r = await callAction(createPaymentBoxAction(d));
        if (r.ok) { toast(tr("أُضيف {0}", d.name_ar)); closeDialog?.(); router.refresh(); } else setError(actionErrorText(errors, r));
      });
    }}>
      {error && <Alert variant="destructive">{error}</Alert>}
      {(wallets.length > 0 || boxes.length > 0) && (
        <div className="space-y-2">
          <p className="text-[14px] text-slate-500">{tr("اختيار سريع")}</p>
          <div className="flex flex-wrap gap-2">
            {wallets.map((w) => (
              <Button key={w.code} type="button" size="sm" variant={d.code === w.code ? "default" : "outline"}
                onClick={() => setD({ kind: "e_wallet", code: w.code, name_ar: w.name_ar, name_en: w.name_en, currency: "", requires_reference: true })}>
                {tr("محفظة {0}", w.name_ar)}
              </Button>
            ))}
            {boxes.map((b) => (
              <Button key={b.code} type="button" size="sm" variant={d.code === b.code ? "default" : "outline"}
                onClick={() => setD({ kind: "cash", code: b.code, name_ar: b.name_ar, name_en: b.name_en, currency: b.currency, requires_reference: false })}>
                {b.name_ar}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field-group space-y-1.5">
          <Label htmlFor="box_kind">{tr("النوع")}</Label>
          <NativeSelect id="box_kind" value={d.kind} onChange={(e) => {
            const kind = e.target.value as Kind;
            setD({ ...d, kind, requires_reference: kind === "e_wallet" ? true : d.requires_reference });
          }}>
            <option value="cash">{tr("صندوق نقدي")}</option>
            <option value="e_wallet">{tr("محفظة إلكترونية")}</option>
            <option value="bank_transfer">{tr("حساب بنكي")}</option>
          </NativeSelect>
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="box_currency">{tr("العملة")}</Label>
          <NativeSelect id="box_currency" value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value })}>
            <option value="">{tr("العملة الأساسية {0}", baseCurrency)}</option>
            {currencies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="box_name">{tr("الاسم")}</Label>
          <Input id="box_name" value={d.name_ar} onChange={(e) => setD({ ...d, name_ar: e.target.value })} placeholder={tr("مثل: صندوق الدولار")} />
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="box_name_en">{tr("الاسم بالإنجليزية")}</Label>
          <Input id="box_name_en" dir="ltr" value={d.name_en} onChange={(e) => setD({ ...d, name_en: e.target.value })} />
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="box_code">{tr("الرمز")}</Label>
          <Input id="box_code" dir="ltr" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} placeholder="CASH-USD" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={d.requires_reference} onChange={(e) => setD({ ...d, requires_reference: e.target.checked })} />
        {tr("رقم العملية إلزامي ولا يتكرر (للمحافظ والحوالات)")}
      </label>
      <p className="text-[14px] text-slate-500">{tr("يُنشأ له حساب مستقل في دليل الحسابات بجوار الصندوق الرئيسي، فيظهر رصيده لوحده.")}</p>
      <Button type="submit" className="w-full" loading={pending} disabled={!d.code || !d.name_ar}>{tr("إضافة")}</Button>
    </form>
  );
}
