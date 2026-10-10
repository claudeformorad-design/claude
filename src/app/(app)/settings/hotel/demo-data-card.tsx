"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionErrorText, callAction } from "@/lib/action-error";
import { loadDemoDataAction, removeDemoDataAction } from "../../_admin/actions";

/** بيانات تجريبية مؤقتة لمعاينة لوحة التحكم، مع حذفها بالكامل بضغطة */
export function DemoDataCard({ active, errors }: { active: boolean; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: typeof loadDemoDataAction, to: string) =>
    start(async () => {
      setError(null);
      const r = await callAction(fn());
      if (!r.ok) return setError(actionErrorText(errors, r));
      router.push(to);
      router.refresh();
    });

  return (
    <div className="surface flex flex-wrap items-center justify-between gap-4 p-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent1-tint text-accent1">
          <Database className="size-5 stroke-[1.75]" />
        </span>
        <div className="space-y-1">
          <h3 className="text-[18.5px] font-semibold text-ink">{tr("بيانات تجريبية مؤقتة")}</h3>
          <p className="max-w-xl text-[16.5px] leading-relaxed text-slate-600">
            {active
              ? tr("البيانات التجريبية محمّلة الآن. الحذف يعيد النظام كما كان قبل تحميلها تمامًا، وأي عملية أجريتها بعد التحميل ستُحذف معها.")
              : tr("تولّد ستة أشهر من النشاط من إقامات ومطعم ومناسبات ومشتريات ورواتب عبر نفس القيود المحاسبية الحقيقية، لتعاين لوحة التحكم والتقارير. تُحذف بالكامل متى شئت.")}
          </p>
          {error && <p className="text-[15.5px] text-urgent">{error}</p>}
        </div>
      </div>
      {active ? (
        <Button variant="destructive" loading={pending} onClick={() => run(removeDemoDataAction, "/settings/hotel")}>
          <Trash2 />
          {pending ? tr("جارٍ الحذف…") : tr("حذف البيانات التجريبية")}
        </Button>
      ) : (
        <Button loading={pending} onClick={() => run(loadDemoDataAction, "/")}>
          <Database />
          {pending ? tr("جارٍ التوليد، قد يستغرق دقيقة") : tr("إنشاء بيانات تجريبية")}
        </Button>
      )}
    </div>
  );
}
