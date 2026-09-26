"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveVendorAction } from "../_payables/actions";
import { actionErrorText } from "@/lib/action-error";

type V = Record<string, string | boolean | undefined>;

export function VendorForm({ t, initial }: { t: Pick<Dictionary, "customers" | "common" | "errors">; initial: V }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<V>({ defaultValues: initial });
  const f = (name: string, label: string, dir: "ltr" | "rtl" = "ltr") => (
    <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} dir={dir} {...register(name)} /></div>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={handleSubmit((v) => start(async () => {
        const r = await saveVendorAction(v);
        if (r.ok) router.push("/vendors");
        else setError(actionErrorText(t.errors, r));
      }))}
    >
      {error && <Alert variant="destructive">{error}</Alert>}
      {f("code", t.customers.code)}
      {f("name_ar", t.customers.name, "rtl")}
      {f("name_en", `${t.customers.name} (EN)`)}
      <div className="grid grid-cols-2 gap-3">
        {f("tax_number", t.customers.taxNumber)}
        {f("payment_terms_days", t.customers.paymentTerms)}
        {f("phone", t.customers.phone)}
        {f("email", t.customers.email)}
      </div>
      {f("address", t.customers.address, "rtl")}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("is_active")} />{t.common.active}</label>
      <Button type="submit" disabled={pending}>{t.common.save}</Button>
    </form>
  );
}
