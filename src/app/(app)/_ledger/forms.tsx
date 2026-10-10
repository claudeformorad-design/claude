"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tr } from "@/i18n/tr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { ActionResult } from "@/services/errors";
import {
  clearChequeAction, deleteRecurringAction, postDueRecurringAction, recurringFromEntryAction, registerChequeAction, setRecurringActiveAction,
} from "./actions";

type Errors = Record<string, string>;

/** مبلغ وسبب ثم تنفيذ (مرتجع مشتريات، إعدام دين) */
export function AmountReasonForm({ title, button, done, hint, errors, run }: {
  title: string; button: string; done: string; hint?: string; errors: Errors;
  run: (amount: string, reason: string) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 print:hidden">
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="text-[14px] text-slate-500">{hint}</p>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input className="num w-44" dir="ltr" inputMode="decimal" placeholder={tr("المبلغ")} aria-label={tr("المبلغ")} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input className="w-72" placeholder={tr("السبب")} aria-label={tr("السبب")} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="outline" loading={pending} disabled={pending || !amount.trim() || !reason.trim()} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(run(amount, reason));
          if (r.ok) { toast(done); setAmount(""); setReason(""); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{button}</Button>
      </div>
    </div>
  );
}

/** تحويل قيد مرحّل إلى قيد دوري */
export function RecurringFromEntry({ entryId, defaultName, defaultStart, errors }: { entryId: string; defaultName: string; defaultStart: string; errors: Errors }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [frequency, setFrequency] = useState("monthly");
  const [startDate, setStartDate] = useState(defaultStart);
  const [count, setCount] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>{tr("اجعله قيدًا دوريًا")}</Button>;
  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <p className="font-semibold">{tr("قيد دوري من هذا القيد")}</p>
      <p className="text-[14px] text-slate-500">{tr("يتكرر القيد بنفس الحسابات والمبالغ. لتوزيع مصروف مدفوع مقدمًا حدد عدد المرات.")}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-sm lg:col-span-2"><span className="text-slate-500">{tr("اسم القيد الدوري")}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("التكرار")}</span>
          <NativeSelect value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="weekly">{tr("أسبوعي")}</option><option value="monthly">{tr("شهري")}</option>
            <option value="quarterly">{tr("ربع سنوي")}</option><option value="yearly">{tr("سنوي")}</option>
          </NativeSelect></label>
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("أول موعد")}</span>
          <Input type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("عدد المرات (اختياري)")}</span>
          <Input dir="ltr" inputMode="numeric" className="num" value={count} onChange={(e) => setCount(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("ينتهي في (اختياري)")}</span>
          <Input type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      </div>
      <div className="flex gap-2">
        <Button loading={pending} disabled={pending || !name.trim() || !startDate} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(recurringFromEntryAction({ entryId, name, frequency: frequency as "monthly", startDate, count, endDate }));
          if (r.ok) { toast(tr("تم إنشاء القيد الدوري")); router.push("/journal/recurring"); } else setError(actionErrorText(errors, r));
        })}>{tr("حفظ القيد الدوري")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{tr("تراجع")}</Button>
      </div>
    </div>
  );
}

export function PostDueButton({ due, errors }: { due: number; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending || due === 0} loading={pending} onClick={() => start(async () => {
      const r = await callAction(postDueRecurringAction());
      if (r.ok) { toast(tr("رُحّل {0} قيد", r.data)); router.refresh(); } else toast(actionErrorText(errors, r), "error");
    })}>{due ? tr("ترحيل القيود المستحقة ({0})", due) : tr("لا قيود مستحقة")}</Button>
  );
}

export function RecurringRowActions({ id, active, errors }: { id: string; active: boolean; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<undefined>>, done: string) => start(async () => {
    const r = await callAction(fn());
    if (r.ok) { toast(done); router.refresh(); } else toast(actionErrorText(errors, r), "error");
  });
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRecurringActiveAction(id, !active), active ? tr("أُوقف القيد الدوري") : tr("أُعيد تفعيل القيد الدوري"))}>
        {active ? tr("إيقاف") : tr("تفعيل")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} className="text-urgent" onClick={() => {
        if (window.confirm(tr("حذف القيد الدوري؟ القيود التي رُحّلت منه تبقى في الدفاتر."))) run(() => deleteRecurringAction(id), tr("حُذف القيد الدوري"));
      }}>{tr("حذف")}</Button>
    </div>
  );
}

export function RegisterChequeForm({ paymentId, errors }: { paymentId: string; errors: Errors }) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [bank, setBank] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-4 print:hidden">
      <p className="font-semibold">{tr("بيانات الشيك")}</p>
      <p className="text-[14px] text-slate-500">{tr("هذا السند بشيك مؤجل. سجّل رقم الشيك وبنكه وتاريخ استحقاقه لمتابعته في صفحة الشيكات.")}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input className="num w-44" dir="ltr" placeholder={tr("رقم الشيك")} aria-label={tr("رقم الشيك")} value={number} onChange={(e) => setNumber(e.target.value)} />
        <Input className="w-56" placeholder={tr("البنك")} aria-label={tr("البنك")} value={bank} onChange={(e) => setBank(e.target.value)} />
        <Input className="w-48" type="date" dir="ltr" aria-label={tr("تاريخ الاستحقاق")} value={due} onChange={(e) => setDue(e.target.value)} />
        <Button loading={pending} disabled={pending || !number.trim() || !due} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(registerChequeAction({ paymentId, number, bank, dueDate: due }));
          if (r.ok) { toast(tr("سُجّل الشيك")); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("تسجيل الشيك")}</Button>
      </div>
    </div>
  );
}

export function ClearChequeForm({ chequeId, direction, banks, today, errors }: {
  chequeId: string; direction: "in" | "out"; banks: { id: string; name: string }[]; today: string; errors: Errors;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState(banks[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [pending, start] = useTransition();
  const label = direction === "in" ? tr("تحصيل") : tr("صرف");
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <NativeSelect value={bank} onChange={(e) => setBank(e.target.value)} className="w-44" aria-label={tr("الحساب البنكي")}>
        {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </NativeSelect>
      <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label={tr("التاريخ")} />
      <Button size="sm" loading={pending} disabled={pending || !bank || !date} onClick={() => start(async () => {
        const r = await callAction(clearChequeAction(chequeId, bank, date));
        if (r.ok) { toast(direction === "in" ? tr("حُصّل الشيك") : tr("صُرف الشيك")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
      })}>{label}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tr("تراجع")}</Button>
    </div>
  );
}
