"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { payVendorAction } from "../../_payables/actions";
import { actionErrorText } from "@/lib/action-error";

export function PayBillForm({ t, billId, vendorId, outstanding, methods }: {
  t: Pick<Dictionary, "payables" | "folio" | "errors">; billId: string; vendorId: string; outstanding: string; methods: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <NativeSelect className="w-48" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t.folio.method}>
          <option value="">{t.folio.method}</option>{methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </NativeSelect>
        <Input className="num w-36" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t.folio.amount} />
        <Input className="w-44" dir="ltr" placeholder={t.folio.reference} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Button disabled={pending || !method} onClick={() => start(async () => {
          const r = await payVendorAction({ vendor_id: vendorId, payment_method_id: method, payment_date: "", reference, allocations: [{ bill_id: billId, amount }] });
          if (r.ok) router.refresh(); else setError(actionErrorText(t.errors, r));
        })}>{t.payables.payVendor}</Button>
      </div>
    </div>
  );
}
