"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { autoAllocate, invoiceOutstanding, validateAllocations } from "@/lib/accounting/receivables";
import { formatMoney, isValidAmount } from "@/lib/accounting/money";
import type { VoucherInput } from "@/lib/validation/revenue";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { createVoucherAction } from "../actions";
import { actionErrorText } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

interface OpenInvoiceOption { id: string; number: string; customer_id: string | null; amount_due: string; amount_paid: string; issue_date: string }

export function VoucherForm({
  t, locale, type, today, methods, customers, accounts, departments, invoices,
}: {
  t: Pick<Dictionary, "vouchers" | "folio" | "invoices" | "common" | "errors">;
  locale: string;
  type: "receipt" | "disbursement";
  today: string;
  methods: { id: string; label: string }[];
  customers: { id: string; label: string }[];
  accounts: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  invoices: OpenInvoiceOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, getValues } = useForm<VoucherInput>({
    defaultValues: {
      voucher_type: type, party_type: type === "receipt" ? "customer" : "account", payment_method_id: "", amount: "",
      payment_date: today, customer_id: "", counter_account_id: "", department_id: "", party_name: "", reference: "",
      description: "", allocations: [],
    },
  });
  const { fields, replace } = useFieldArray({ control, name: "allocations" });
  const [partyType, customerId, amount, allocations] = useWatch({ control, name: ["party_type", "customer_id", "amount", "allocations"] });

  const customerInvoices = useMemo(() => invoices.filter((i) => i.customer_id === customerId), [invoices, customerId]);
  const allocationCheck = useMemo(() => {
    if (!customerId || !isValidAmount(amount)) return null;
    const rows = (allocations ?? []).filter((a) => a.amount && isValidAmount(a.amount));
    return validateAllocations(amount || "0", customerId, rows, customerInvoices);
  }, [customerId, amount, allocations, customerInvoices]);
  const fmt = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { locale });

  // عند اختيار العميل: سطر تخصيص لكل فاتورة مفتوحة
  const loadInvoices = (cid: string) =>
    replace(invoices.filter((i) => i.customer_id === cid).map((i) => ({ invoice_id: i.id, amount: "" })));

  const auto = () => {
    const plan = autoAllocate(getValues("amount") || "0", customerInvoices);
    replace(customerInvoices.map((i) => ({ invoice_id: i.id, amount: String(plan.find((p) => p.invoice_id === i.id)?.amount ?? "") })));
  };

  const onSubmit = () =>
    start(async () => {
      setError(null);
      const v = getValues();
      const r = await createVoucherAction({ ...v, allocations: (v.allocations ?? []).filter((a) => a.amount && a.amount.trim() !== "") });
      if (r.ok) { toast("تم ترحيل السند"); router.push(`/vouchers/${r.data}`); }
      else setError(actionErrorText(t.errors, r));
    });

  const row = (label: string, el: React.ReactNode, id?: string) => <div className="field-group space-y-1.5"><Label htmlFor={id}>{label}</Label>{el}</div>;
  const isCustomerReceipt = type === "receipt" && partyType === "customer";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        {row(t.vouchers.party, (
          <NativeSelect id="party_type" {...register("party_type")}>
            <option value="customer">{t.vouchers.partyTypes.customer}</option>
            <option value="account">{t.vouchers.partyTypes.account}</option>
          </NativeSelect>
        ), "party_type")}
        {partyType === "customer"
          ? row(t.invoices.customer, (
              <NativeSelect id="customer_id" {...register("customer_id", { onChange: (e) => loadInvoices(e.target.value) })}>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </NativeSelect>
            ), "customer_id")
          : row(t.vouchers.counterAccount, (
              <NativeSelect id="counter_account_id" {...register("counter_account_id")}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </NativeSelect>
            ), "counter_account_id")}
        {row(t.folio.method, (
          <NativeSelect id="payment_method_id" {...register("payment_method_id")}>
            <option value="">—</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </NativeSelect>
        ), "payment_method_id")}
        {row(t.folio.amount, <Input id="amount" dir="ltr" inputMode="decimal" className="num" {...register("amount")} />, "amount")}
        {row(t.common.date, <Input id="payment_date" type="date" dir="ltr" {...register("payment_date")} />, "payment_date")}
        {row(t.common.reference, <Input id="reference" dir="ltr" {...register("reference")} />, "reference")}
        {partyType === "account" && row(t.vouchers.partyName, <Input id="party_name" {...register("party_name")} />, "party_name")}
        {row(t.folio.department, (
          <NativeSelect id="department_id" {...register("department_id")}>
            <option value="">{t.common.none}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </NativeSelect>
        ), "department_id")}
        <div className="md:col-span-3">{row(t.common.description, <Input id="description" {...register("description")} />, "description")}</div>
      </div>

      {isCustomerReceipt && customerId && (
        <div className="space-y-2 rounded-xl bg-panel p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{t.vouchers.allocations}</p>
            <Button type="button" variant="outline" size="sm" onClick={auto}>{t.vouchers.autoAllocate}</Button>
          </div>
          {fields.length === 0 && <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
          {fields.map((f, i) => {
            const inv = customerInvoices.find((x) => x.id === f.invoice_id);
            return (
              <div key={f.id} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_10rem]">
                <span className="num">{inv?.number} · {inv?.issue_date}</span>
                <span className="text-sm text-muted-foreground">{t.invoices.outstanding}: <span className="num">{inv ? fmt(invoiceOutstanding(inv)) : ""}</span></span>
                <Input dir="ltr" inputMode="decimal" className="num" {...register(`allocations.${i}.amount`)} />
              </div>
            );
          })}
          {allocationCheck && (
            <p className={allocationCheck.errors.length ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {allocationCheck.errors.length ? t.errors.allocation_range : `${t.vouchers.unallocated}: ${fmt(allocationCheck.unallocated)}`}
            </p>
          )}
        </div>
      )}
      <Button type="submit" loading={pending} disabled={pending || !!allocationCheck?.errors.length}>{t.common.save}</Button>
    </form>
  );
}
