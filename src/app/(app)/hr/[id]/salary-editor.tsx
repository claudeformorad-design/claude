"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useDialogClose } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { saveEmployeeComponentsAction } from "../actions";

type Row = { id: string; name: string; kind: "allowance" | "deduction"; calc: "fixed" | "percent"; default_value: string; override: string | null };

/** بنود راتب الموظف: قيمة خاصة به لكل بند، وتركها فارغة يعني القيمة الافتراضية للبند */
export function SalaryEditor({ employeeId, rows, errors }: { employeeId: string; rows: Row[]; errors: Record<string, string> }) {
  const router = useRouter();
  const close = useDialogClose();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.override === null ? "" : String(Number(r.override))])));
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await callAction(saveEmployeeComponentsAction(employeeId, rows.map((x) => ({ component_id: x.id, value: values[x.id]?.trim() ?? "" }))));
    if (r.ok) { toast("حُفظت بنود الراتب"); close?.(); router.refresh(); }
    else toast(actionErrorText(errors, r), "error");
  });
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-line">
        {rows.map((r, i) => (
          <label key={r.id} className={`flex items-center gap-4 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium text-ink">{r.name}</span>
              <span className="block text-[14.5px] text-slate-500">
                {r.kind === "allowance" ? "بدل" : "خصم"}، {r.calc === "percent" ? "نسبة من الأساسي" : "مبلغ ثابت"}، الافتراضي <span className="num">{Number(r.default_value)}</span>{r.calc === "percent" ? "٪" : ""}
              </span>
            </span>
            <input value={values[r.id] ?? ""} inputMode="decimal" dir="ltr" placeholder={String(Number(r.default_value))}
              onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
              className="field h-10 w-32 text-end" aria-label={r.name} />
          </label>
        ))}
      </div>
      <p className="text-[14.5px] text-slate-500">اترك الحقل فارغًا ليأخذ الموظف القيمة الافتراضية للبند من إعدادات الموارد البشرية.</p>
      <Button onClick={save} loading={pending}>حفظ بنود الراتب</Button>
    </div>
  );
}
