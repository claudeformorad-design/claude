"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { addBankLineAction, bankMatchAction } from "../_payables/actions";
import { actionErrorText } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

type T = Pick<Dictionary, "payables" | "common" | "errors" | "folio">;

export function AddBankLine({ t, accountId, today }: { t: T; accountId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm({ defaultValues: { txn_date: today, description: "", reference: "", amount: "" } });
  return (
    <form className="space-y-2" onSubmit={handleSubmit((v) => start(async () => {
      const r = await addBankLineAction({ ...v, account_id: accountId });
      if (r.ok) { toast("تمت إضافة سطر الكشف"); reset({ txn_date: v.txn_date, description: "", reference: "", amount: "" }); router.refresh(); }
      else setError(actionErrorText(t.errors, r));
    }))}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input type="date" dir="ltr" className="w-40" {...register("txn_date")} />
        <Input className="w-64" placeholder={t.common.description} {...register("description")} />
        <Input className="w-36" dir="ltr" placeholder={t.common.reference} {...register("reference")} />
        <Input className="num w-36" dir="ltr" placeholder="المبلغ" {...register("amount")} />
        <Button type="submit" loading={pending}>{t.payables.addLine}</Button>
      </div>
    </form>
  );
}

export function AutoMatch({ label, accountId }: { label: string; accountId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="outline" loading={pending} onClick={() => start(async () => { await bankMatchAction("auto", { accountId }); router.refresh(); })}>{label}</Button>;
}

export function LineActions({ t, lineId, matched, candidates }: { t: T; lineId: string; matched: boolean; candidates: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState("");
  const run = (op: "match" | "unmatch" | "delete", ledgerLineId?: string) =>
    start(async () => { const r = await bankMatchAction(op, { lineId, ledgerLineId }); if (!r.ok) alert(actionErrorText(t.errors, r)); router.refresh(); });
  if (matched) return <Button size="sm" variant="ghost" loading={pending} onClick={() => run("unmatch")}>✕</Button>;
  return (
    <div className="flex gap-1">
      {candidates.length > 0 && (
        <>
          <NativeSelect className="h-8 w-56" value={sel} onChange={(e) => setSel(e.target.value)}><option value="">اختر</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect>
          <Button size="sm" loading={pending} disabled={pending || !sel} onClick={() => run("match", sel)}>{t.payables.matched}</Button>
        </>
      )}
      <Button size="sm" variant="ghost" loading={pending} onClick={() => run("delete")}>{t.common.delete}</Button>
    </div>
  );
}
