"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { WEEKDAYS } from "@/lib/hr/labels";
import type { HrSettingsRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { saveHrSettingsAction } from "../../hr/actions";

type Numbers = Record<"work_hours_per_day" | "month_days" | "late_grace_minutes" | "late_deduction_rate" | "absence_deduction_days" | "overtime_rate" | "insurance_employee_pct" | "insurance_employer_pct" | "expiry_alert_days", string>;

/** قواعد الموارد البشرية كلها من هنا: الدوام، الخصومات، الإضافي، التأمينات، ونهاية الخدمة */
export function HrSettingsForm({ initial, errors, canEdit }: { initial: HrSettingsRow; errors: Record<string, string>; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [n, setN] = useState<Numbers>({
    work_hours_per_day: String(Number(initial.work_hours_per_day)), month_days: String(initial.month_days), late_grace_minutes: String(initial.late_grace_minutes),
    late_deduction_rate: String(Number(initial.late_deduction_rate)), absence_deduction_days: String(Number(initial.absence_deduction_days)),
    overtime_rate: String(Number(initial.overtime_rate)), insurance_employee_pct: String(Number(initial.insurance_employee_pct)),
    insurance_employer_pct: String(Number(initial.insurance_employer_pct)), expiry_alert_days: String(initial.expiry_alert_days),
  });
  const [weekend, setWeekend] = useState<number[]>(initial.weekend_days);
  const [encash, setEncash] = useState(initial.leave_encashment);
  const [tiers, setTiers] = useState(initial.eos_tiers.map((x) => ({ from: String(x.from), days: String(x.days) })));
  const [resign, setResign] = useState(initial.eos_resign.map((x) => ({ from: String(x.from), pct: String(x.pct) })));

  const save = () => start(async () => {
    const r = await callAction(saveHrSettingsAction({
      ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number(v)])),
      weekend_days: weekend, leave_encashment: encash,
      eos_tiers: tiers.map((x) => ({ from: Number(x.from), days: Number(x.days) })),
      eos_resign: resign.map((x) => ({ from: Number(x.from), pct: Number(x.pct) })),
    }));
    if (r.ok) { toast(tr("حُفظت إعدادات الموارد البشرية")); router.refresh(); }
    else toast(actionErrorText(errors, r), "error");
  });

  const field = (k: keyof Numbers, label: string, hint?: string) => (
    <div className="field-group space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <input id={k} value={n[k]} disabled={!canEdit} inputMode="decimal" dir="ltr" onChange={(e) => setN((x) => ({ ...x, [k]: e.target.value }))} className="field h-11 w-full text-end" />
      {hint && <p className="text-[14px] text-slate-500">{hint}</p>}
    </div>
  );
  const small = "field h-10 w-24 text-end";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{tr("الدوام والحضور")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {field("work_hours_per_day", tr("ساعات العمل اليومية"), tr("لحساب أجر الساعة والإضافي لمن ليس له وردية"))}
          {field("month_days", tr("أيام الشهر في الحساب"), tr("الأجر اليومي يساوي الشهري مقسومًا عليها"))}
          {field("late_grace_minutes", tr("دقائق السماح للتأخير"), tr("ما دونها لا يُخصم"))}
          <div className="md:col-span-3">
            <Label>{tr("العطلة الأسبوعية")}</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => (
                <button key={d} type="button" disabled={!canEdit} aria-pressed={weekend.includes(i)}
                  onClick={() => setWeekend((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()))}
                  className={cn("rounded-full border px-3.5 py-1.5 text-[15px] transition-colors", weekend.includes(i) ? "border-ink bg-ink text-white" : "border-line text-slate-600 hover:bg-subtle")}>{d}</button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tr("الخصومات والإضافي")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {field("absence_deduction_days", tr("خصم يوم الغياب"), tr("عدد الأيام المخصومة عن كل يوم غياب، مثل 1 أو 2"))}
          {field("late_deduction_rate", tr("معامل خصم التأخير"), tr("واحد يعني أجر الساعة كما هو، وصفر يوقف الخصم"))}
          {field("overtime_rate", tr("معامل الساعة الإضافية"), tr("مثل 1.5 أي ساعة ونصف عن كل ساعة"))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tr("التأمينات والتنبيهات")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {field("insurance_employee_pct", tr("نسبة الموظف ٪"), tr("تُخصم من راتبه، وصفر إن لا تنطبق"))}
          {field("insurance_employer_pct", tr("نسبة المنشأة ٪"), tr("مصروف على المنشأة"))}
          {field("expiry_alert_days", tr("التنبيه قبل انتهاء الوثائق بأيام"))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tr("مكافأة نهاية الخدمة")}</CardTitle></CardHeader>
        <CardContent className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[15.5px] text-slate-600">{tr("أيام الأجر عن كل سنة خدمة، حسب الشريحة")}</p>
            {tiers.map((x, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[15.5px]">
                <span className="text-slate-600">{tr("من السنة")}</span>
                <input value={x.from} disabled={!canEdit} inputMode="decimal" dir="ltr" aria-label={tr("بداية الشريحة")} className={small}
                  onChange={(e) => setTiers((t) => t.map((y, k) => (k === i ? { ...y, from: e.target.value } : y)))} />
                <span className="text-slate-600">{tr("تُحسب")}</span>
                <input value={x.days} disabled={!canEdit} inputMode="decimal" dir="ltr" aria-label={tr("أيام كل سنة")} className={small}
                  onChange={(e) => setTiers((t) => t.map((y, k) => (k === i ? { ...y, days: e.target.value } : y)))} />
                <span className="text-slate-600">{tr("يومًا عن كل سنة")}</span>
                {canEdit && tiers.length > 1 && <button type="button" onClick={() => setTiers((t) => t.filter((_, k) => k !== i))} className="ms-auto flex size-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-subtle hover:text-urgent" aria-label={tr("حذف الشريحة")}><X className="size-4" /></button>}
              </div>
            ))}
            {canEdit && <Button variant="ghost" size="sm" onClick={() => setTiers((t) => [...t, { from: "", days: "" }])}><Plus />{tr("شريحة")}</Button>}
          </div>
          <div className="space-y-3">
            <p className="text-[15.5px] text-slate-600">{tr("نسبة المكافأة عند الاستقالة حسب مجموع سنوات الخدمة، وعند الإنهاء من المنشأة كاملة")}</p>
            {resign.map((x, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[15.5px]">
                <span className="text-slate-600">{tr("من")}</span>
                <input value={x.from} disabled={!canEdit} inputMode="decimal" dir="ltr" aria-label={tr("سنوات الخدمة")} className={small}
                  onChange={(e) => setResign((t) => t.map((y, k) => (k === i ? { ...y, from: e.target.value } : y)))} />
                <span className="text-slate-600">{tr("سنة، يستحق")}</span>
                <input value={x.pct} disabled={!canEdit} inputMode="decimal" dir="ltr" aria-label={tr("النسبة")} className={small}
                  onChange={(e) => setResign((t) => t.map((y, k) => (k === i ? { ...y, pct: e.target.value } : y)))} />
                <span className="text-slate-600">{tr("٪")}</span>
                {canEdit && resign.length > 1 && <button type="button" onClick={() => setResign((t) => t.filter((_, k) => k !== i))} className="ms-auto flex size-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-subtle hover:text-urgent" aria-label={tr("حذف")}><X className="size-4" /></button>}
              </div>
            ))}
            {canEdit && <Button variant="ghost" size="sm" onClick={() => setResign((t) => [...t, { from: "", pct: "" }])}><Plus />{tr("شريحة")}</Button>}
          </div>
          <label className="flex items-center gap-2.5 text-[16px] lg:col-span-2">
            <input type="checkbox" className="size-4" checked={encash} disabled={!canEdit} onChange={(e) => setEncash(e.target.checked)} />{tr("تعويض رصيد الإجازات القابلة للتعويض عند نهاية الخدمة")}</label>
        </CardContent>
      </Card>

      {canEdit && <Button onClick={save} loading={pending}>{tr("حفظ الإعدادات")}</Button>}
    </div>
  );
}
