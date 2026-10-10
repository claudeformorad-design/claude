"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { ZERO, formatMoney, isValidAmount, toMoney } from "@/lib/accounting/money";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { postPayrollAction } from "../../_payables/actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

const empty = { employee_name: "", employee_code: "", department_id: "", basic: "", allowances: "", deductions: "", insurance_employee: "", insurance_employer: "" };
const nums = ["basic", "allowances", "deductions", "insurance_employee", "insurance_employer"] as const;

export function PayrollForm({ t, locale, month, departments }: {
  t: Pick<Dictionary, "payables" | "common" | "errors" | "journal" | "folio">; locale: string; month: string; departments: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit } = useForm({ defaultValues: { period_month: month, posting_date: "", lines: [empty] } });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });
  const m = (v: string) => (isValidAmount(v) ? toMoney(v) : ZERO);
  const net = lines.reduce((acc, l) => acc.plus(m(l.basic)).plus(m(l.allowances)).minus(m(l.deductions)).minus(m(l.insurance_employee)), ZERO);
  const labels: Record<(typeof nums)[number], string> = {
    basic: t.payables.basic, allowances: t.payables.allowances, deductions: t.payables.deductions,
    insurance_employee: t.payables.insEmployee, insurance_employer: t.payables.insEmployer,
  };
  return (
    <form className="space-y-5" onSubmit={handleSubmit((v) => start(async () => {
      const r = await callAction(postPayrollAction(v));
      if (r.ok) { toast(tr("تم ترحيل مسيّر الرواتب")); router.push("/payroll"); } else setError(actionErrorText(t.errors, r));
    }))}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <div className="field-group space-y-1.5"><Label htmlFor="pm">{t.payables.month}</Label><Input id="pm" type="month" dir="ltr" {...register("period_month")} /></div>
        <div className="field-group space-y-1.5"><Label htmlFor="pd">{t.common.date}</Label><Input id="pd" type="date" dir="ltr" {...register("posting_date")} /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-thead-line bg-thead font-bold text-thead-text"><tr>
            <th className="p-1 text-start">{t.payables.employee}</th><th className="p-1 text-start">{t.folio.department}</th>
            {nums.map((n) => <th key={n} className="p-1 text-start">{labels[n]}</th>)}<th />
          </tr></thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.id}>
                <td className="p-1"><Input {...register(`lines.${i}.employee_name`)} /></td>
                <td className="p-1"><NativeSelect {...register(`lines.${i}.department_id`)}><option value="">{tr("اختر")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</NativeSelect></td>
                {nums.map((n) => <td key={n} className="p-1"><Input dir="ltr" inputMode="decimal" className="num w-28" {...register(`lines.${i}.${n}`)} /></td>)}
                <td><Button type="button" variant="ghost" size="icon" disabled={fields.length <= 1} onClick={() => remove(i)}><Trash2 /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => append(empty)}><Plus />{t.journal.addLine}</Button>
        <span className="text-sm">{t.payables.net}: <strong className="num">{formatMoney(net, { locale })}</strong></span>
      </div>
      <Button type="submit" loading={pending}>{t.journal.post}</Button>
    </form>
  );
}
