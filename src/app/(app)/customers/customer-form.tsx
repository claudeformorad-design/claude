"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { CustomerFormInput } from "@/lib/validation/revenue";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveCustomerAction } from "./actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

export function CustomerForm({ t, initial }: { t: Pick<Dictionary, "customers" | "common" | "errors">; initial: CustomerFormInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<CustomerFormInput>({ defaultValues: initial });

  const onSubmit = (v: CustomerFormInput) =>
    start(async () => {
      setError(null);
      const r = await callAction(saveCustomerAction(v));
      if (r.ok) { toast(tr("تم حفظ العميل")); router.push("/customers"); }
      else setError(actionErrorText(t.errors, r));
    });

  const f = (name: keyof CustomerFormInput, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="field-group space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} {...register(name)} {...props} /></div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        {f("code", t.customers.code, { dir: "ltr" })}
        <div className="field-group space-y-1.5">
          <Label htmlFor="customer_type">{t.customers.type}</Label>
          <NativeSelect id="customer_type" {...register("customer_type")}>
            {(["company", "individual", "travel_agent", "ota", "government"] as const).map((k) => <option key={k} value={k}>{t.customers.types[k]}</option>)}
          </NativeSelect>
        </div>
      </div>
      {f("name_ar", t.customers.name, { dir: "rtl" })}
      {f("name_en", tr("{0} بالإنجليزية", t.customers.name), { dir: "ltr" })}
      <div className="grid grid-cols-2 gap-3">
        {f("tax_number", t.customers.taxNumber, { dir: "ltr" })}
        {f("commercial_registration", t.customers.cr, { dir: "ltr" })}
        {f("phone", t.customers.phone, { dir: "ltr" })}
        {f("email", t.customers.email, { dir: "ltr" })}
      </div>
      {f("address", t.customers.address)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("allow_credit")} />{t.customers.allowCredit}</label>
      <div className="grid grid-cols-2 gap-3">
        {f("credit_limit", t.customers.creditLimit, { dir: "ltr", inputMode: "decimal" })}
        {f("payment_terms_days", t.customers.paymentTerms, { dir: "ltr", inputMode: "numeric" })}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("is_active")} />{t.common.active}</label>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{t.common.save}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/customers")}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
