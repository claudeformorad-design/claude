"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tr } from "@/i18n/tr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CodeTag } from "@/components/ui/code-text";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { ActionResult } from "@/services/errors";
import { MoneyDecimal, isValidAmount, toMoney } from "@/lib/accounting/money";
import {
  applyVendorAdvanceAction, clearChequeAction, createTransferAction, payVendorAdvanceAction, postFxRevaluationAction, deleteAttachmentAction, deleteRecurringAction, postCommissionsAction, postDueRecurringAction, recurringFromEntryAction, registerChequeAction,
  saveBudgetAction, saveCommissionRateAction, setRecurringActiveAction,
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

/** نسبة عمولة مصدر حجز: الصفر يوقف العمولة على المصدر */
export function CommissionRateForm({ sources, errors }: { sources: { value: string; label: string; rate: string }[]; errors: Errors }) {
  const router = useRouter();
  const [source, setSource] = useState(sources.find((x) => x.value === "booking_com")?.value ?? sources[0]?.value ?? "");
  const [rate, setRate] = useState(sources.find((x) => x.value === source)?.rate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("مصدر الحجز")}</span>
          <NativeSelect className="w-52" value={source} onChange={(e) => { setSource(e.target.value); setRate(sources.find((x) => x.value === e.target.value)?.rate ?? ""); }}>
            {sources.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </NativeSelect></label>
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("نسبة العمولة %")}</span>
          <Input className="num w-32" dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <Button loading={pending} disabled={pending || !source} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(saveCommissionRateAction(source, rate));
          if (r.ok) { toast(tr("حُفظت نسبة العمولة")); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("حفظ النسبة")}</Button>
      </div>
    </div>
  );
}

export function PostCommissionsButton({ count, reservationId, errors }: { count: number; reservationId?: string; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size={reservationId ? "sm" : undefined} variant={reservationId ? "outline" : undefined} disabled={pending || count === 0} loading={pending}
      onClick={() => start(async () => {
        const r = await callAction(postCommissionsAction(reservationId ? [reservationId] : undefined));
        if (r.ok) { toast(tr("رُحّلت {0} عمولة", r.data)); router.refresh(); } else toast(actionErrorText(errors, r), "error");
      })}>
      {reservationId ? tr("ترحيل") : count ? tr("ترحيل كل العمولات ({0})", count) : tr("لا عمولات مستحقة")}
    </Button>
  );
}

/** مبالغ فترات السنة لحساب واحد، مع توزيع مبلغ سنوي بالتساوي */
function BudgetEditor({ fiscalYearId, accountId, departmentId, periods, initial, errors, onClose }: {
  fiscalYearId: string; accountId: string; departmentId: string | null; periods: string[]; initial: string[]; errors: Errors; onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<string[]>(periods.map((_, i) => initial[i] ?? ""));
  const [annual, setAnnual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const spread = () => {
    if (!isValidAmount(annual)) return;
    const total = toMoney(annual);
    const per = total.div(periods.length).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN);
    setValues(periods.map((_, i) => (i === periods.length - 1 ? total.minus(per.times(periods.length - 1)) : per).toFixed(2)));
  };
  return (
    <div className="space-y-3 py-2 text-start">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm"><span className="text-slate-500">{tr("المبلغ السنوي")}</span>
          <Input className="num w-40" dir="ltr" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} /></label>
        <Button variant="outline" disabled={!annual.trim()} onClick={spread}>{tr("وزّع بالتساوي")}</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {periods.map((name, i) => (
          <label key={name + i} className="space-y-1 text-[13px]"><span className="num text-slate-500">{name}</span>
            <Input className="num" dir="ltr" inputMode="decimal" aria-label={name} value={values[i]} onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))} />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button loading={pending} disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(saveBudgetAction({ fiscalYearId, accountId, departmentId, amounts: values }));
          if (r.ok) { toast(tr("حُفظت الموازنة")); onClose(); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("حفظ")}</Button>
        <Button variant="ghost" onClick={onClose}>{tr("تراجع")}</Button>
      </div>
    </div>
  );
}

/** صفوف حسابات الموازنة: الصف يفتح محرر الفترات تحته بعرض الجدول */
export function BudgetRows({ rows, fiscalYearId, departmentId, periods, errors }: {
  rows: { id: string; code: string; name: string; amounts: string[] | null; total: React.ReactNode }[];
  fiscalYearId: string; departmentId: string | null; periods: string[]; errors: Errors;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return rows.map((a) => (
    <Fragment key={a.id}>
      <TableRow>
        <TableCell><CodeTag>{a.code}</CodeTag></TableCell>
        <TableCell>{a.name}</TableCell>
        <TableCell className="text-end">{a.amounts ? a.total : <span className="text-slate-400">{tr("بلا موازنة")}</span>}</TableCell>
        <TableCell className="w-[1%] whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{tr("تعديل")}</Button>
        </TableCell>
      </TableRow>
      {open === a.id && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4}>
            <BudgetEditor fiscalYearId={fiscalYearId} accountId={a.id} departmentId={departmentId} periods={periods}
              initial={a.amounts ?? []} errors={errors} onClose={() => setOpen(null)} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  ));
}

/** رفع مرفق للمستند: صورة أو PDF أو ملف Excel أو Word حتى 3 ميجابايت */
export function AttachmentUpload({ entityType, entityId, errors }: { entityType: string; entityId: string; errors: Errors }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [key, setKey] = useState(0);
  const upload = (file: File) => start(async () => {
    setError(null);
    if (file.size > 3 * 1024 * 1024) { setError(tr("حجم الملف أكبر من 3 ميجابايت")); return; }
    const body = new FormData();
    body.set("file", file); body.set("entityType", entityType); body.set("entityId", entityId);
    try {
      const res = await fetch("/api/attachments", { method: "POST", body });
      const r = (await res.json().catch(() => ({ ok: false, error: "unknown" }))) as ActionResult<string>;
      if (r.ok) { toast(tr("أُرفق الملف")); router.refresh(); }
      else if (r.error === "validation" && r.message === "unsupported_type") setError(tr("نوع الملف غير مدعوم. المسموح: PDF والصور وملفات Excel وWord"));
      else if (r.error === "validation" && r.message === "too_large") setError(tr("حجم الملف أكبر من 3 ميجابايت"));
      else setError(actionErrorText(errors, r));
    } catch {
      setError(tr("تعذّر الاتصال بالخادم، تحقق من الاتصال وحاول مرة أخرى"));
    }
    setKey((k) => k + 1);
  });
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-slate-50 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        <input key={key} type="file" className="sr-only" aria-label={tr("إرفاق ملف")} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.docx"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        {pending ? tr("جارٍ الرفع") : tr("إرفاق ملف")}
      </label>
    </div>
  );
}

export function DeleteAttachmentButton({ id, path, errors }: { id: string; path: string; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" className="text-urgent" disabled={pending} onClick={() => {
      if (!window.confirm(tr("حذف المرفق؟"))) return;
      start(async () => {
        const r = await callAction(deleteAttachmentAction(id, path));
        if (r.ok) { toast(tr("حُذف المرفق")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
      });
    }}>{tr("حذف")}</Button>
  );
}

/** سند تحويل: من صندوق أو بنك إلى آخر، وبعملتين يصبح تبديل عملة بفرقه */
export function TransferForm({ methods, base, today, errors }: {
  methods: { id: string; label: string; currency: string; kind: string }[]; base: string; today: string; errors: Errors;
}) {
  const router = useRouter();
  // الافتراضي الأشيع: من الصندوق إلى البنك بالعملة الأساسية
  const first = methods.find((m) => m.kind === "cash" && m.currency === base) ?? methods[0];
  const [from, setFrom] = useState(first?.id ?? "");
  const [to, setTo] = useState(methods.find((m) => m.kind === "bank_transfer" && m.currency === base && m.id !== first?.id)?.id
    ?? methods.find((m) => m.id !== first?.id)?.id ?? "");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = (id: string) => methods.find((m) => m.id === id)?.currency ?? base;
  const same = cur(from) === cur(to);
  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">{tr("من")}</p>
          <NativeSelect id="transfer_from" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr("من")}>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </NativeSelect>
          <label className="block space-y-1 text-sm"><span className="text-slate-500">{tr("المبلغ")} <span className="num">{cur(from)}</span></span>
            <Input className="num" dir="ltr" inputMode="decimal" aria-label={tr("المبلغ المحوَّل")} value={fromAmount}
              onChange={(e) => { setFromAmount(e.target.value); if (same) setToAmount(e.target.value); }} /></label>
        </div>
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">{tr("إلى")}</p>
          <NativeSelect id="transfer_to" value={to} onChange={(e) => { setTo(e.target.value); if (cur(from) === cur(e.target.value)) setToAmount(fromAmount); }} aria-label={tr("إلى")}>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </NativeSelect>
          <label className="block space-y-1 text-sm"><span className="text-slate-500">{tr("المبلغ المستلم")} <span className="num">{cur(to)}</span></span>
            <Input className="num" dir="ltr" inputMode="decimal" aria-label={tr("المبلغ المستلم")} value={same ? fromAmount : toAmount} disabled={same}
              onChange={(e) => setToAmount(e.target.value)} /></label>
        </div>
      </div>
      {!same && <p className="text-[14px] text-slate-500">{tr("تبديل عملة: يُقيَّم كل طرف بسعر الصرف المسجل لذلك اليوم، والفرق يُقيَّد أرباحًا أو خسائر فروقات عملة.")}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-72" placeholder={tr("البيان (اختياري)")} aria-label={tr("البيان")} value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input className="w-44" type="date" dir="ltr" aria-label={tr("التاريخ")} value={date} onChange={(e) => setDate(e.target.value)} />
        <Button loading={pending} disabled={pending || !from || !to || !fromAmount.trim() || (!same && !toAmount.trim())} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(createTransferAction({ fromMethodId: from, fromAmount, toMethodId: to, toAmount: same ? fromAmount : toAmount, description, date }));
          if (r.ok) { toast(tr("سُجّل التحويل")); setFromAmount(""); setToAmount(""); setDescription(""); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("تسجيل التحويل")}</Button>
      </div>
    </div>
  );
}

/** عربون مورد جديد: دفعة مقدمة من الصندوق أو البنك قبل وصول الفاتورة */
export function VendorAdvanceForm({ vendors, methods, today, errors }: {
  vendors: { id: string; label: string }[]; methods: { id: string; label: string }[]; today: string; errors: Errors;
}) {
  const router = useRouter();
  const [vendorId, setVendor] = useState("");
  const [methodId, setMethod] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <NativeSelect id="adv_vendor" className="w-60" value={vendorId} onChange={(e) => setVendor(e.target.value)} aria-label={tr("المورد")}>
          <option value="">{tr("اختر المورد")}</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </NativeSelect>
        <NativeSelect id="adv_method" className="w-48" value={methodId} onChange={(e) => setMethod(e.target.value)} aria-label={tr("طريقة الدفع")}>
          {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </NativeSelect>
        <Input className="num w-36" dir="ltr" inputMode="decimal" placeholder={tr("المبلغ")} aria-label={tr("مبلغ العربون")} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input className="w-44" type="date" dir="ltr" aria-label={tr("التاريخ")} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input className="w-44" placeholder={tr("المرجع (اختياري)")} aria-label={tr("المرجع")} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Button loading={pending} disabled={pending || !vendorId || !methodId || !amount.trim()} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(payVendorAdvanceAction({ vendorId, methodId, amount, date, reference }));
          if (r.ok) { toast(tr("صُرف العربون")); setAmount(""); setReference(""); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("صرف العربون")}</Button>
      </div>
    </div>
  );
}

/** تطبيق عربون على فاتورة من فواتير المورد نفسه */
export function ApplyAdvanceForm({ advanceId, bills, max, errors }: {
  advanceId: string; bills: { id: string; label: string; outstanding: string }[]; max: string; errors: Errors;
}) {
  const router = useRouter();
  const [billId, setBill] = useState(bills[0]?.id ?? "");
  const due = (id: string) => bills.find((b) => b.id === id)?.outstanding ?? "0";
  const suggest = (id: string) => (toMoney(due(id)).lt(toMoney(max)) ? toMoney(due(id)) : toMoney(max)).toFixed();
  const [amount, setAmount] = useState(billId ? suggest(billId) : "");
  const [pending, start] = useTransition();
  if (!bills.length) return <span className="text-[13px] text-slate-500">{tr("لا فواتير مفتوحة لهذا المورد")}</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <NativeSelect className="w-56" value={billId} onChange={(e) => { setBill(e.target.value); setAmount(suggest(e.target.value)); }} aria-label={tr("الفاتورة")}>
        {bills.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </NativeSelect>
      <Input className="num w-32" dir="ltr" inputMode="decimal" aria-label={tr("مبلغ التطبيق")} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button size="sm" loading={pending} disabled={pending || !billId || !amount.trim()} onClick={() => start(async () => {
        const r = await callAction(applyVendorAdvanceAction(advanceId, billId, amount));
        if (r.ok) { toast(tr("طُبّق العربون على الفاتورة")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
      })}>{tr("تطبيق")}</Button>
    </div>
  );
}

/** إعادة تقييم أرصدة العملات: الرصيد الفعلي بكل عملة، والفرق بسعر اليوم */
export function FxRevaluationForm({ rows, today, errors }: {
  rows: { id: string; label: string; currency: string; book: string; rate: string | null; shared: boolean }[]; today: string; errors: Errors;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const entered = rows.filter((r) => !r.shared && r.rate && (values[r.id] ?? "").trim() !== "");
  const diff = (r: (typeof rows)[number]) => {
    const v = values[r.id];
    if (!v || !isValidAmount(v) || !r.rate) return null;
    return toMoney(v).times(toMoney(r.rate)).toDecimalPlaces(2).minus(toMoney(r.book));
  };
  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Table>
        <TableHeader><TableRow>
          <TableHead>{tr("الصندوق أو البنك")}</TableHead><TableHead>{tr("العملة")}</TableHead><TableHead className="text-end">{tr("الرصيد الدفتري")}</TableHead>
          <TableHead className="text-end">{tr("سعر اليوم")}</TableHead><TableHead className="w-44">{tr("الرصيد الفعلي بالعملة")}</TableHead><TableHead className="text-end">{tr("الفرق")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const d = diff(r);
            return (
              <TableRow key={r.id}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="num">{r.currency}</TableCell>
                <TableCell className="num text-end">{toMoney(r.book).toFixed(2)}</TableCell>
                <TableCell className="num text-end">{r.rate ?? tr("لا يوجد سعر")}</TableCell>
                <TableCell>
                  {r.shared ? <span className="text-[13px] text-urgent">{tr("الحساب مشترك مع عملة أخرى")}</span> : (
                    <Input className="num" dir="ltr" inputMode="decimal" disabled={!r.rate} aria-label={tr("الرصيد الفعلي لـ {0}", r.label)}
                      value={values[r.id] ?? ""} onChange={(e) => setValues({ ...values, [r.id]: e.target.value })} />
                  )}
                </TableCell>
                <TableCell className={`num text-end ${d && d.lt(0) ? "text-urgent" : d && d.gt(0) ? "text-emerald-700" : "text-slate-400"}`}>
                  {d ? (d.gt(0) ? `+${d.toFixed(2)}` : d.toFixed(2)) : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-44" type="date" dir="ltr" aria-label={tr("تاريخ إعادة التقييم")} value={date} onChange={(e) => setDate(e.target.value)} />
        <Button loading={pending} disabled={pending || entered.length === 0} onClick={() => start(async () => {
          setError(null);
          const r = await callAction(postFxRevaluationAction({ date, lines: entered.map((x) => ({ payment_method_id: x.id, foreign_balance: values[x.id]! })) }));
          if (r.ok) { toast(tr("رُحّلت إعادة التقييم")); setValues({}); router.refresh(); } else setError(actionErrorText(errors, r));
        })}>{tr("ترحيل إعادة التقييم")}</Button>
      </div>
    </div>
  );
}
