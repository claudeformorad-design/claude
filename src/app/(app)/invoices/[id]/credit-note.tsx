"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { creditNoteAction } from "../../_payables/actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

export function CreditNoteForm({ invoiceId, t }: { invoiceId: string; t: Pick<Dictionary, "payables" | "folio" | "errors"> }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 print:hidden">
      <p className="text-sm font-semibold">{t.payables.creditNote}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input className="num w-44" dir="ltr" inputMode="decimal" placeholder={t.payables.creditNoteAmount} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input className="w-72" placeholder={t.folio.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="outline" loading={pending} disabled={pending || !amount || !reason} onClick={() => start(async () => {
          const r = await callAction(creditNoteAction(invoiceId, amount, reason));
          if (r.ok) { toast("تم إصدار الإشعار الدائن"); setAmount(""); setReason(""); router.refresh(); } else setError(actionErrorText(t.errors, r));
        })}>{t.payables.creditNote}</Button>
      </div>
    </div>
  );
}
