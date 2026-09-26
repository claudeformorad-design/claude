"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { computeTaxes, type TaxRateInput } from "@/lib/accounting/tax";
import { formatMoney, isValidAmount, toMoney } from "@/lib/accounting/money";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { cn } from "@/lib/utils";
import { cancelFolioAction, checkoutAction, folioAction } from "../actions";
import { actionErrorText } from "@/lib/action-error";

type Kind = "charge" | "payment" | "deposit" | "allowance" | "refund" | "depositRefund" | "transfer" | "void";

export interface FolioActionsProps {
  t: Pick<Dictionary, "folio" | "common" | "errors">;
  locale: string;
  decimals: number;
  folioId: string;
  hasTransactions: boolean;
  chargeCodes: { id: string; label: string; price: string | null; inclusive: boolean; taxes: TaxRateInput[] }[];
  methods: { id: string; label: string; kind: string }[];
  customers: { id: string; label: string }[];
  defaultCustomerId: string | null;
  charges: { id: string; label: string }[];
  voidable: { id: string; label: string }[];
  openFolios: { id: string; label: string }[];
  can: { manage: boolean; allowance: boolean; void: boolean; checkout: boolean };
}

type FormValues = Record<string, string>;

export function FolioActions(p: FolioActionsProps) {
  const { t } = p;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const kinds = ([
    p.can.manage && "charge", p.can.manage && "payment", p.can.manage && "deposit",
    p.can.allowance && "allowance", p.can.manage && "refund", p.can.manage && "depositRefund",
    p.can.manage && "transfer", p.can.void && "void",
  ].filter(Boolean) as Kind[]);
  const [kind, setKind] = useState<Kind | null>(kinds[0] ?? null);

  const form = useForm<FormValues>({ defaultValues: { quantity: "1", customer_id: p.defaultCustomerId ?? "" } });
  const { register, handleSubmit, reset, setValue, control } = form;
  const values = useWatch({ control });

  // معاينة الضريبة بنفس خوارزمية قاعدة البيانات
  const preview = useMemo(() => {
    if (kind !== "charge") return null;
    const cc = p.chargeCodes.find((c) => c.id === values.charge_code_id);
    if (!cc || !isValidAmount(values.unit_price) || !isValidAmount(values.quantity)) return null;
    const amount = toMoney(values.unit_price).times(toMoney(values.quantity));
    if (!amount.gt(0)) return null;
    return computeTaxes(amount, cc.taxes, { inclusive: cc.inclusive, decimals: p.decimals });
  }, [kind, values.charge_code_id, values.unit_price, values.quantity, p.chargeCodes, p.decimals]);

  const fmt = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { locale: p.locale, decimals: p.decimals });
  const fail = (r: { error: string; message?: string }) => setError(actionErrorText(t.errors, r));

  const submit = (v: FormValues) =>
    start(async () => {
      setError(null);
      const r = await folioAction(p.folioId, { ...v, kind });
      if (r.ok) {
        reset({ quantity: "1", customer_id: p.defaultCustomerId ?? "" });
        router.refresh();
      } else fail(r);
    });

  const checkout = () => {
    if (!confirm(t.folio.checkoutConfirm)) return;
    start(async () => {
      setError(null);
      const r = await checkoutAction(p.folioId);
      if (r.ok) router.push(`/invoices/${r.data}`);
      else fail(r);
    });
  };

  const cancel = () =>
    start(async () => {
      const r = await cancelFolioAction(p.folioId);
      if (r.ok) router.push("/folios");
      else fail(r);
    });

  const select = (name: string, options: { id: string; label: string }[], allowEmpty = false) => (
    <NativeSelect id={name} {...register(name, { required: !allowEmpty })}>
      <option value="">{allowEmpty ? t.common.none : "—"}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </NativeSelect>
  );
  const input = (name: string, props: React.ComponentProps<"input"> = {}) => <Input id={name} {...register(name)} {...props} />;
  const row = (label: string, el: React.ReactNode, name?: string) => (
    <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label>{el}</div>
  );
  const moneyMethods = kind === "payment" ? p.methods : p.methods.filter((m) => m.kind !== "city_ledger");
  const isCredit = kind === "payment" && p.methods.find((m) => m.id === values.payment_method_id)?.kind === "city_ledger";

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-1">
        {kinds.map((k) => (
          <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => { setKind(k); setError(null); }}>
            {t.folio.actions[k]}
          </Button>
        ))}
      </div>

      {kind && (
        <form onSubmit={handleSubmit(submit)} className="grid gap-3 md:grid-cols-4">
          {kind === "charge" && (
            <>
              {row(t.folio.chargeCode, (
                <NativeSelect id="charge_code_id" {...register("charge_code_id", {
                  required: true,
                  onChange: (e) => {
                    const cc = p.chargeCodes.find((c) => c.id === e.target.value);
                    if (cc?.price) setValue("unit_price", toMoney(cc.price).toFixed());
                  },
                })}>
                  <option value="">—</option>
                  {p.chargeCodes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </NativeSelect>
              ), "charge_code_id")}
              {row(t.folio.quantity, input("quantity", { dir: "ltr", inputMode: "decimal" }), "quantity")}
              {row(t.folio.unitPrice, input("unit_price", { dir: "ltr", inputMode: "decimal", className: "num" }), "unit_price")}
              {row(t.common.description, input("description"), "description")}
              {preview && (
                <p className="text-sm text-muted-foreground md:col-span-4">
                  {t.folio.taxPreview}: {t.folio.net} <span className="num">{fmt(preview.net)}</span> + {t.folio.tax}{" "}
                  <span className="num">{fmt(preview.taxTotal)}</span> = <strong className="num">{fmt(preview.total)}</strong>
                </p>
              )}
            </>
          )}
          {(kind === "payment" || kind === "deposit" || kind === "refund" || kind === "depositRefund") && (
            <>
              {row(t.folio.method, select("payment_method_id", moneyMethods), "payment_method_id")}
              {row(t.folio.amount, input("amount", { dir: "ltr", inputMode: "decimal", className: "num" }), "amount")}
              {row(t.folio.reference, input("reference", { dir: "ltr" }), "reference")}
              {isCredit && row(t.folio.billingCustomer, select("customer_id", p.customers, true), "customer_id")}
            </>
          )}
          {kind === "allowance" && (
            <>
              {row(t.folio.originalCharge, select("charge_txn_id", p.charges), "charge_txn_id")}
              {row(t.folio.amount, input("amount", { dir: "ltr", inputMode: "decimal", className: "num" }), "amount")}
              <div className="md:col-span-2">{row(t.folio.reason, input("reason"), "reason")}</div>
            </>
          )}
          {kind === "transfer" && (
            <>
              {row(t.folio.targetFolio, select("to_folio_id", p.openFolios), "to_folio_id")}
              {row(t.folio.amount, input("amount", { dir: "ltr", inputMode: "decimal", className: "num" }), "amount")}
              <div className="md:col-span-2">{row(t.common.description, input("description"), "description")}</div>
            </>
          )}
          {kind === "void" && (
            <>
              <div className="md:col-span-2">{row(t.folio.transaction, select("txn_id", p.voidable), "txn_id")}</div>
              <div className="md:col-span-2">{row(t.folio.reason, input("reason"), "reason")}</div>
            </>
          )}
          <div className="md:col-span-4">
            <Button type="submit" disabled={pending}>{t.common.save}</Button>
          </div>
        </form>
      )}

      <div className={cn("flex flex-wrap gap-2 border-t pt-4")}>
        {p.can.checkout && p.hasTransactions && <Button onClick={checkout} disabled={pending}>{t.folio.actions.checkout}</Button>}
        {p.can.manage && !p.hasTransactions && <Button variant="destructive" onClick={cancel} disabled={pending}>{t.folio.actions.cancel}</Button>}
      </div>
    </div>
  );
}
