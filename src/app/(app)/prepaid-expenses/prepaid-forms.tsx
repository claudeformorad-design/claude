"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tr } from "@/i18n/tr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { type PrepaidRun, createPrepaidAction, postDuePrepaidAction, stopPrepaidAction } from "../_ledger/actions";

type Errors = Record<string, string>;
type Option = { id: string; label: string };

/** جدول مصروف مقدم جديد: المبلغ يُوزَّع بالتساوي على الأشهر، ويُرحَّل قسط كل شهر في آخره */
export function PrepaidForm({ expenseAccounts, prepaidAccounts, departments, defaultPrepaid, start, decimals, errors }: {
  expenseAccounts: Option[]; prepaidAccounts: Option[]; departments: Option[]; defaultPrepaid: string; start: string; decimals: number; errors: Errors;
}) {
  const router = useRouter();
  const [pending, run] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ name: "", amount: "", months: "12", startDate: start, expenseAccountId: "", prepaidAccountId: defaultPrepaid, departmentId: "", notes: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const months = Number(v.months);
  const monthly = isValidAmount(v.amount) && months >= 1 ? toMoney(v.amount).div(months).toDecimalPlaces(decimals) : null;
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      setError(null);
      run(async () => {
        const r = await callAction(createPrepaidAction(v));
        if (r.ok) { toast(tr("أُضيف المصروف المقدم")); router.push("/prepaid-expenses"); router.refresh(); }
        else setError(actionErrorText(errors, r));
      });
    }}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="space-y-1.5"><Label htmlFor="pp_name">{tr("الاسم")}</Label>
        <Input id="pp_name" value={v.name} onChange={set("name")} placeholder={tr("مثل: إيجار المبنى لسنة 2026")} required maxLength={120} /></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="pp_amount">{tr("المبلغ المدفوع مقدمًا")}</Label>
          <Input id="pp_amount" dir="ltr" className="num" value={v.amount} onChange={set("amount")} required inputMode="decimal" /></div>
        <div className="space-y-1.5"><Label htmlFor="pp_months">{tr("عدد الأشهر")}</Label>
          <Input id="pp_months" type="number" min={1} max={120} dir="ltr" className="num" value={v.months} onChange={set("months")} required /></div>
        <div className="space-y-1.5"><Label htmlFor="pp_start">{tr("أول شهر")}</Label>
          <Input id="pp_start" type="date" dir="ltr" value={v.startDate} onChange={set("startDate")} required /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="pp_expense">{tr("حساب المصروف")}</Label>
          <NativeSelect id="pp_expense" value={v.expenseAccountId} onChange={set("expenseAccountId")} required>
            <option value="">{tr("اختر")}</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </NativeSelect></div>
        <div className="space-y-1.5"><Label htmlFor="pp_dept">{tr("القسم (اختياري)")}</Label>
          <NativeSelect id="pp_dept" value={v.departmentId} onChange={set("departmentId")}>
            <option value="">{tr("بدون قسم")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </NativeSelect></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="pp_prepaid">{tr("حساب المدفوع مقدمًا")}</Label>
        <NativeSelect id="pp_prepaid" value={v.prepaidAccountId} onChange={set("prepaidAccountId")}>
          {prepaidAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </NativeSelect>
        <p className="text-[14px] text-slate-500">{tr("الدفع نفسه يُسجَّل كالمعتاد بسند صرف أو فاتورة مورد على هذا الحساب، وهنا يوزَّع على الأشهر.")}</p></div>
      <div className="space-y-1.5"><Label htmlFor="pp_notes">{tr("ملاحظات")}</Label><Input id="pp_notes" value={v.notes} onChange={set("notes")} maxLength={500} /></div>
      {monthly && monthly.gt(0) && (
        <p className="rounded-lg bg-panel px-4 py-2.5 text-[15px]">
          {tr("القسط الشهري")}{": "}<b className="num">{monthly.toFixed(decimals)}</b>{" "}{tr("في آخر كل شهر لمدة {0} شهر، والقسط الأخير يأخذ فرق التقريب.", months)}
        </p>
      )}
      <Button type="submit" loading={pending}>{tr("حفظ الجدول")}</Button>
    </form>
  );
}

export function PostDuePrepaidButton({ due, errors }: { due: number; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<PrepaidRun["failed"]>([]);
  return (
    <div className="space-y-2">
      <Button disabled={pending || due === 0} loading={pending} onClick={() => start(async () => {
        const r = await callAction(postDuePrepaidAction());
        if (!r.ok) { toast(actionErrorText(errors, r), "error"); return; }
        setFailed(r.data.failed);
        toast(tr("رُحّل {0} قسط", r.data.posted), r.data.failed.length ? "error" : undefined);
        router.refresh();
      })}>{due ? tr("ترحيل الأقساط المستحقة ({0})", due) : tr("لا أقساط مستحقة")}</Button>
      {failed.length > 0 && (
        <Alert variant="destructive" data-testid="prepaid-failed">
          {tr("لم تُرحَّل هذه الأقساط، والباقي رُحّل:")}
          <ul className="mt-1 list-disc ps-5">{failed.map((f) => <li key={f.name + f.date}>{tr("{0} (قسط {1}): {2}", f.name, f.date, f.reason)}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}

export function StopPrepaidButton({ id, errors }: { id: string; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => {
      if (!window.confirm(tr("إيقاف توزيع هذا المصروف؟ لا يُرحَّل قسط بعده، والباقي يبقى في حساب المدفوع مقدمًا."))) return;
      start(async () => {
        const r = await callAction(stopPrepaidAction(id));
        if (r.ok) { toast(tr("أُوقف التوزيع")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
      });
    }}>{tr("إيقاف")}</Button>
  );
}
