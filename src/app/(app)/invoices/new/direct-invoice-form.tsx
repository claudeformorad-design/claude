"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { computeTaxes, type TaxRateInput } from "@/lib/accounting/tax";
import { ZERO, formatMoney, isValidAmount, toMoney } from "@/lib/accounting/money";
import { type DirectInvoiceInput, directInvoiceSchema } from "@/lib/validation/revenue";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { createDirectInvoiceAction } from "../actions";
import { actionErrorText } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

export function DirectInvoiceForm({
  t, locale, decimals, customers, chargeCodes, today,
}: {
  t: Pick<Dictionary, "invoices" | "folio" | "common" | "errors">;
  locale: string;
  decimals: number;
  today: string;
  customers: { id: string; label: string }[];
  chargeCodes: { id: string; label: string; price: string | null; inclusive: boolean; taxes: TaxRateInput[] }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const empty = { charge_code_id: "", description: "", quantity: "1", unit_price: "" };
  const { register, control, handleSubmit, setValue, getValues, formState } = useForm<DirectInvoiceInput, unknown, unknown>({
    resolver: zodResolver(directInvoiceSchema),
    defaultValues: { customer_id: "", issue_date: today, notes: "", lines: [empty] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });

  // معاينة الإجماليات بنفس خوارزمية الضريبة في قاعدة البيانات
  const totals = useMemo(() => {
    let net = ZERO, tax = ZERO;
    for (const l of lines) {
      const cc = chargeCodes.find((c) => c.id === l.charge_code_id);
      if (!cc || !isValidAmount(l.unit_price) || !isValidAmount(l.quantity)) continue;
      const amount = toMoney(l.unit_price).times(toMoney(l.quantity));
      if (!amount.gt(0)) continue;
      const b = computeTaxes(amount, cc.taxes, { inclusive: cc.inclusive, decimals });
      net = net.plus(b.net);
      tax = tax.plus(b.taxTotal);
    }
    return { net, tax, total: net.plus(tax) };
  }, [lines, chargeCodes, decimals]);
  const fmt = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { locale, decimals });

  // نرسل القيم الخام؛ الخادم يعيد التحقق بنفس المخطط
  const onSubmit = () =>
    start(async () => {
      setError(null);
      const r = await createDirectInvoiceAction(getValues());
      if (r.ok) { toast("تم إصدار الفاتورة"); router.push(`/invoices/${r.data}`); }
      else setError(actionErrorText(t.errors, r));
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="field-group space-y-1.5">
          <Label htmlFor="customer_id">{t.invoices.customer}</Label>
          <NativeSelect id="customer_id" aria-invalid={!!formState.errors.customer_id} {...register("customer_id")}>
            <option value="">اختر</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="issue_date">{t.invoices.issueDate}</Label>
          <Input id="issue_date" type="date" dir="ltr" {...register("issue_date")} />
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="notes">{t.folio.notes}</Label>
          <Input id="notes" {...register("notes")} />
        </div>
      </div>

      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={f.id} className="grid items-end gap-2 md:grid-cols-[2fr_2fr_1fr_1fr_auto]">
            <NativeSelect aria-label={t.folio.chargeCode} {...register(`lines.${i}.charge_code_id`, {
              onChange: (e) => {
                const cc = chargeCodes.find((c) => c.id === e.target.value);
                if (cc?.price) setValue(`lines.${i}.unit_price`, toMoney(cc.price).toFixed());
              },
            })}>
              <option value="">{t.folio.chargeCode}</option>
              {chargeCodes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
            <Input placeholder={t.common.description} {...register(`lines.${i}.description`)} />
            <Input placeholder={t.folio.quantity} dir="ltr" inputMode="decimal" {...register(`lines.${i}.quantity`)} />
            <Input placeholder={t.folio.unitPrice} dir="ltr" inputMode="decimal" className="num" {...register(`lines.${i}.unit_price`)} />
            <Button type="button" variant="ghost" size="icon" disabled={fields.length <= 1} onClick={() => remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => append(empty)}><Plus />{t.folio.actions.charge}</Button>
      </div>

      <div className="max-w-sm space-y-1 text-sm">
        <div className="flex justify-between"><span>{t.invoices.subtotal}</span><span className="num">{fmt(totals.net)}</span></div>
        <div className="flex justify-between"><span>{t.invoices.taxTotal}</span><span className="num">{fmt(totals.tax)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>{t.invoices.total}</span><span className="num">{fmt(totals.total)}</span></div>
      </div>
      {Object.keys(formState.errors).length > 0 && <p className="text-sm text-destructive">{t.errors.validation}</p>}
      <Button type="submit" loading={pending}>{t.common.create}</Button>
    </form>
  );
}
