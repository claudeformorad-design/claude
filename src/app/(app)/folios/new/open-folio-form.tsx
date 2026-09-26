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
import type { OpenFolioInput } from "@/lib/validation/revenue";
import { openFolioAction } from "../actions";

export function OpenFolioForm({
  t, customers, masters, today,
}: {
  t: Pick<Dictionary, "folio" | "common" | "errors">;
  customers: { id: string; label: string }[];
  masters: { id: string; label: string }[];
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<OpenFolioInput>({
    defaultValues: {
      guest_name: "", folio_type: "guest", customer_id: "", room_number: "", reservation_ref: "",
      arrival_date: today, departure_date: "", adults: "", master_folio_id: "", notes: "",
    },
  });

  const onSubmit = (v: OpenFolioInput) =>
    start(async () => {
      setError(null);
      const r = await openFolioAction(v);
      if (r.ok) router.push(`/folios/${r.data}`);
      else setError(r.error === "validation" ? t.errors.validation : t.errors[r.error]);
    });

  const field = (name: keyof OpenFolioInput, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} {...register(name)} {...props} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-3">
      {error && <Alert variant="destructive" className="md:col-span-3">{error}</Alert>}
      {field("guest_name", t.folio.guestName, { required: true })}
      <div className="space-y-1.5">
        <Label htmlFor="folio_type">{t.folio.folioType}</Label>
        <NativeSelect id="folio_type" {...register("folio_type")}>
          {(["guest", "master", "company", "non_guest"] as const).map((k) => <option key={k} value={k}>{t.folio.types[k]}</option>)}
        </NativeSelect>
      </div>
      {field("room_number", t.folio.room, { dir: "ltr" })}
      {field("arrival_date", t.folio.arrival, { type: "date", dir: "ltr" })}
      {field("departure_date", t.folio.departure, { type: "date", dir: "ltr" })}
      {field("adults", t.folio.adults, { inputMode: "numeric", dir: "ltr" })}
      <div className="space-y-1.5">
        <Label htmlFor="customer_id">{t.folio.billingCustomer}</Label>
        <NativeSelect id="customer_id" {...register("customer_id")}>
          <option value="">{t.common.none}</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="master_folio_id">{t.folio.masterFolio}</Label>
        <NativeSelect id="master_folio_id" {...register("master_folio_id")}>
          <option value="">{t.common.none}</option>
          {masters.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </NativeSelect>
      </div>
      {field("reservation_ref", t.folio.reservation, { dir: "ltr" })}
      <div className="space-y-1.5 md:col-span-3">
        <Label htmlFor="notes">{t.folio.notes}</Label>
        <Input id="notes" {...register("notes")} />
      </div>
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit" disabled={pending}>{t.folio.open}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>{t.common.cancel}</Button>
      </div>
    </form>
  );
}
