"use client";

import { type Control, type FieldArrayPath, type FieldValues, type Path, type UseFormRegister, useFieldArray, useWatch } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { ZERO, formatMoney, isValidAmount, toMoney } from "@/lib/accounting/money";

export interface PurchaseLine { description: string; account_id: string; department_id: string; quantity: string; unit_price: string; tax_rate_id: string }
export const emptyPurchaseLine = (): PurchaseLine => ({ description: "", account_id: "", department_id: "", quantity: "1", unit_price: "", tax_rate_id: "" });

type Opt = { id: string; label: string };

/** سطور مشتريات مشتركة (أمر الشراء وفاتورة المورد) مع معاينة الإجمالي */
export function PurchaseLines<T extends FieldValues & { lines: PurchaseLine[] }>({
  control, register: rawRegister, accounts, departments, taxes, labels, locale,
}: {
  control: Control<T>;
  register: UseFormRegister<T>;
  accounts: Opt[];
  departments: Opt[];
  taxes: (Opt & { rate: string })[];
  labels: { description: string; account: string; department: string; quantity: string; price: string; tax: string; add: string; total: string };
  locale: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "lines" as FieldArrayPath<T> });
  const lines = (useWatch({ control, name: "lines" as Path<T> }) ?? []) as PurchaseLine[];
  const register = (name: string) => rawRegister(name as Path<T>);
  let net = ZERO, tax = ZERO;
  for (const l of lines) {
    if (!isValidAmount(l.quantity) || !isValidAmount(l.unit_price)) continue;
    const n = toMoney(l.quantity).times(toMoney(l.unit_price)).toDecimalPlaces(2);
    const rate = taxes.find((t) => t.id === l.tax_rate_id)?.rate;
    net = net.plus(n);
    if (rate) tax = tax.plus(n.times(toMoney(rate)).div(100).toDecimalPlaces(2));
  }
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={f.id} className="grid items-center gap-2 md:grid-cols-[2fr_2fr_1.2fr_0.7fr_1fr_1fr_auto]">
          <Input placeholder={labels.description} {...register(`lines.${i}.description`)} />
          <NativeSelect aria-label={labels.account} {...register(`lines.${i}.account_id`)}>
            <option value="">{labels.account}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label={labels.department} {...register(`lines.${i}.department_id`)}>
            <option value="">{labels.department}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </NativeSelect>
          <Input placeholder={labels.quantity} dir="ltr" inputMode="decimal" {...register(`lines.${i}.quantity`)} />
          <Input placeholder={labels.price} dir="ltr" inputMode="decimal" className="num" {...register(`lines.${i}.unit_price`)} />
          <NativeSelect aria-label={labels.tax} {...register(`lines.${i}.tax_rate_id`)}>
            <option value="">{labels.tax}</option>
            {taxes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </NativeSelect>
          <Button type="button" variant="ghost" size="icon" disabled={fields.length <= 1} onClick={() => remove(i)}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => append(emptyPurchaseLine() as never)}><Plus />{labels.add}</Button>
        <span className="text-sm">{labels.total}: <strong className="num">{formatMoney(net.plus(tax), { locale })}</strong> <span className="text-muted-foreground num">({formatMoney(net, { locale })} + {formatMoney(tax, { locale })})</span></span>
      </div>
    </div>
  );
}
