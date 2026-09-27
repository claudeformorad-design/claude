"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, PlayCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import { closeShiftAction, openShiftAction } from "./actions";
import { useDialogClose } from "@/components/ui/dialog";

export function OpenShiftForm({ errors, currency }: { errors: Record<string, string>; currency: string }) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setError(null);
        const r = await callAction(openShiftAction(amount));
        if (r.ok) { toast("فُتحت الوردية"); closeDialog?.(); router.refresh(); } else setError(actionErrorText(errors, r));
      });
    }}>
      {error && <Alert variant="destructive" className="w-full">{error}</Alert>}
      <div className="field-group min-w-56 flex-1 space-y-1.5">
        <Label htmlFor="opening_float">العهدة النقدية عند الاستلام بعملة {currency}</Label>
        <Input id="opening_float" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </div>
      <Button type="submit" loading={pending}><PlayCircle className="size-4" />فتح الوردية</Button>
    </form>
  );
}

type Line = { payment_method_id: string; name: string; kind: string; currency_code: string; expected: number };

/** إغلاق الوردية: عدّ كل صندوق نقدي (والفروق تظهر فورًا)، والطرق الأخرى تُطابق مع كشوفها */
export function CloseShiftForm({ shiftId, lines, errors, supervisor }: { shiftId: string; lines: Line[]; errors: Record<string, string>; supervisor?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const cash = lines.filter((l) => l.kind === "cash");
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setError(null);
        const r = await callAction(closeShiftAction(shiftId, {
          counts: cash.map((l) => ({ payment_method_id: l.payment_method_id, counted: counts[l.payment_method_id] ?? "" })), note,
        }));
        if (r.ok) { toast("أُغلقت الوردية"); router.push(`/cashier/${shiftId}`); } else setError(actionErrorText(errors, r));
      });
    }}>
      {error && <Alert variant="destructive">{error}</Alert>}
      {cash.length === 0 && <p className="text-[15.5px] text-slate-500">لا توجد صناديق نقدية في هذه الوردية.</p>}
      {cash.map((l) => {
        const v = counts[l.payment_method_id] ?? "";
        const diff = v === "" || Number.isNaN(Number(v)) ? null : Number(v) - l.expected;
        return (
          <div key={l.payment_method_id} className="grid grid-cols-[1fr_140px] items-end gap-3">
            <div className="field-group space-y-1.5">
              <Label htmlFor={`count_${l.payment_method_id}`}>{l.name} <span className="num text-slate-500">{l.currency_code}</span></Label>
              <Input id={`count_${l.payment_method_id}`} inputMode="decimal" dir="ltr" value={v} placeholder={`المتوقع ${l.expected}`}
                onChange={(e) => setCounts({ ...counts, [l.payment_method_id]: e.target.value })} />
            </div>
            <div className={cn("rounded-md px-3 py-2 text-center text-[15px] font-semibold",
              diff == null ? "bg-subtle text-slate-500" : diff === 0 ? "bg-success/10 text-success" : diff < 0 ? "bg-urgent-tint text-urgent" : "bg-amber-tint text-amber")}>
              {diff == null ? "" : diff === 0 ? "مطابق" : `${diff < 0 ? "عجز" : "زيادة"} ${formatMoney(Math.abs(diff), { locale: "ar" })}`}
            </div>
          </div>
        );
      })}
      <div className="field-group space-y-1.5">
        <Label htmlFor="close_note">ملاحظة الإغلاق</Label>
        <Input id="close_note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثل: سُلّم الصندوق للوردية المسائية" />
      </div>
      <Button type="submit" variant="dark" className="w-full" loading={pending}>
        <LockKeyhole className="size-4" />{supervisor ? "إغلاق الوردية بصفتك مشرفًا" : "إغلاق الوردية وتسليم الصندوق"}
      </Button>
      <p className="text-[14px] text-slate-500">أي عجز أو زيادة يُقيَّد تلقائيًا على حساب «عجز وزيادة الصندوق».</p>
    </form>
  );
}
