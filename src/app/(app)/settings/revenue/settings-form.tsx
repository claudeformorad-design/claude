"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { type RevenueSettingKind, saveRevenueSettingAction } from "./actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

type Option = { id: string; label: string };

/** نموذج موحد لإعدادات الإيراد (ضريبة / رمز إيراد / طريقة دفع) */
export function RevenueSettingForm({
  t, kind, initial, accounts, departments, taxes, currencies = [],
}: {
  t: Pick<Dictionary, "revenueSettings" | "common" | "errors" | "customers" | "folio">;
  kind: RevenueSettingKind;
  initial: Record<string, unknown>;
  accounts: Option[];
  departments: Option[];
  taxes: Option[];
  currencies?: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<Record<string, unknown>>({ defaultValues: initial });
  const rs = t.revenueSettings;

  const onSubmit = (v: Record<string, unknown>) =>
    start(async () => {
      setError(null);
      const payload = { ...v, tax_rate_ids: kind === "charge" ? ((v.tax_rate_ids as string[] | false) || []) : undefined };
      const r = await callAction(saveRevenueSettingAction(kind, payload));
      if (r.ok) { toast("تم الحفظ"); router.push("/settings/revenue"); }
      else setError(actionErrorText(t.errors, r));
    });

  const text = (name: string, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="field-group space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} {...register(name)} {...props} /></div>
  );
  const select = (name: string, label: string, options: Option[]) => (
    <div className="field-group space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect id={name} {...register(name)}>
        <option value="">اختر</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </NativeSelect>
    </div>
  );
  const enumOptions = (dict: Record<string, string>) => Object.entries(dict).map(([id, label]) => ({ id, label }));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      {text("code", t.customers.code, { dir: "ltr" })}
      {text("name_ar", t.customers.name, { dir: "rtl" })}
      {text("name_en", `${t.customers.name} بالإنجليزية`, { dir: "ltr" })}
      {kind === "tax" && (
        <>
          {select("kind", rs.kind, enumOptions(rs.taxKinds))}
          {text("rate", rs.rate, { dir: "ltr", inputMode: "decimal" })}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("is_compound")} />{rs.compound}</label>
          {select("account_id", rs.account, accounts)}
        </>
      )}
      {kind === "method" && (
        <>
          {select("kind", rs.kind, enumOptions(rs.methodKinds))}
          {select("account_id", rs.account, accounts)}
          {currencies.length > 0 && select("currency_code", "العملة، واتركها فارغة للعملة الأساسية", currencies)}
        </>
      )}
      {kind === "charge" && (
        <>
          {select("category", rs.category, enumOptions(rs.categories))}
          {select("department_id", rs.department, departments)}
          {select("revenue_account_id", rs.revenueAccount, accounts)}
          {text("default_price", rs.defaultPrice, { dir: "ltr", inputMode: "decimal" })}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("price_includes_tax")} />{t.folio.priceIncludesTax}</label>
          <div className="space-y-1 rounded-[10px] bg-panel p-3">
            <p className="text-xs text-muted-foreground">{rs.appliedTaxes}</p>
            {taxes.length === 0 && <p className="text-sm text-muted-foreground">{t.common.none}</p>}
            {taxes.map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" value={x.id} {...register("tax_rate_ids")} />{x.label}
              </label>
            ))}
          </div>
        </>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("is_active")} />{t.common.active}</label>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{t.common.save}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/settings/revenue")}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
