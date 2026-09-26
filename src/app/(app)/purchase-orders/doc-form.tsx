"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { PurchaseLines, emptyPurchaseLine } from "@/components/forms/purchase-lines";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { createBillAction, createPurchaseOrderAction } from "../_payables/actions";

type Opt = { id: string; label: string };

/** نموذج مشترك: أمر شراء أو فاتورة مورد */
export function PurchaseDocForm({
  t, kind, locale, today, vendors, accounts, departments, taxes,
}: {
  t: Pick<Dictionary, "payables" | "folio" | "common" | "errors" | "journal">;
  kind: "po" | "bill";
  locale: string;
  today: string;
  vendors: Opt[];
  accounts: Opt[];
  departments: Opt[];
  taxes: (Opt & { rate: string })[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit } = useForm({
    defaultValues: { vendor_id: "", date: today, vendor_invoice_no: "", notes: "", lines: [emptyPurchaseLine()] },
  });
  const submit = handleSubmit((v) => start(async () => {
    setError(null);
    const r = kind === "po"
      ? await createPurchaseOrderAction({ vendor_id: v.vendor_id, order_date: v.date, notes: v.notes, lines: v.lines })
      : await createBillAction({ vendor_id: v.vendor_id, bill_date: v.date, vendor_invoice_no: v.vendor_invoice_no, notes: v.notes, po_id: "", lines: v.lines });
    if (r.ok) router.push(kind === "po" ? "/purchase-orders" : `/bills/${r.data}`);
    else setError(r.error === "validation" ? t.errors.validation : t.errors[r.error]);
  }));
  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5"><Label htmlFor="vendor_id">{t.payables.vendor}</Label>
          <NativeSelect id="vendor_id" {...register("vendor_id")}><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</NativeSelect></div>
        <div className="space-y-1.5"><Label htmlFor="date">{t.common.date}</Label><Input id="date" type="date" dir="ltr" {...register("date")} /></div>
        {kind === "bill" && <div className="space-y-1.5"><Label htmlFor="vin">{t.payables.vendorInvoiceNo}</Label><Input id="vin" dir="ltr" {...register("vendor_invoice_no")} /></div>}
        <div className="space-y-1.5"><Label htmlFor="notes">{t.folio.notes}</Label><Input id="notes" {...register("notes")} /></div>
      </div>
      <PurchaseLines
        control={control} register={register} accounts={accounts} departments={departments} taxes={taxes} locale={locale}
        labels={{ description: t.common.description, account: t.payables.account, department: t.folio.department, quantity: t.folio.quantity,
          price: t.folio.unitPrice, tax: t.folio.tax, add: t.journal.addLine, total: t.folio.total }}
      />
      <Button type="submit" disabled={pending}>{t.common.save}</Button>
    </form>
  );
}
