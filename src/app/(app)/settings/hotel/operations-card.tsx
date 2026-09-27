"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import type { HotelModule } from "@/lib/supabase/database.types";
import { saveHotelOperationsAction } from "../../_admin/actions";

const MODULES: { value: HotelModule; title: string; description: string }[] = [
  { value: "accounting", title: "المحاسبة", description: "الحسابات والقيود، الفوليو والفواتير، المشتريات، الأصول والمخزون، التقارير المالية." },
  { value: "pms", title: "إدارة الفندق", description: "الحجوزات والنزلاء، الغرف وحالاتها، الأسعار والمواسم، قائمة الانتظار، القاعات بالساعة." },
];
/** ليالي الأسبوع بترتيب يبدأ من السبت (القيم: 0 = الأحد … 6 = السبت) */
const NIGHTS: [number, string][] = [[6, "السبت"], [0, "الأحد"], [1, "الاثنين"], [2, "الثلاثاء"], [3, "الأربعاء"], [4, "الخميس"], [5, "الجمعة"]];

/**
 * أقسام النظام المفعّلة لهذا الفندق وإعدادات التشغيل الفندقي.
 * إيقاف قسم يخفي صفحاته ويمنع عملياته في قاعدة البيانات، دون حذف أي بيانات.
 */
export function OperationsCard({ initial, errors }: {
  initial: { modules: HotelModule[]; check_in_time: string; check_out_time: string; weekend_nights: number[]; require_cashier_shift: boolean };
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<HotelModule[]>(initial.modules);
  const [checkIn, setCheckIn] = useState(initial.check_in_time.slice(0, 5));
  const [checkOut, setCheckOut] = useState(initial.check_out_time.slice(0, 5));
  const [weekend, setWeekend] = useState<number[]>(initial.weekend_nights);
  const [requireShift, setRequireShift] = useState(initial.require_cashier_shift);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () =>
    start(async () => {
      setError(null);
      if (modules.length === 0) { setError("فعّل قسمًا واحدًا على الأقل"); return; }
      const r = await saveHotelOperationsAction({ modules, check_in_time: checkIn, check_out_time: checkOut, weekend_nights: weekend, require_cashier_shift: requireShift });
      if (r.ok) { toast("تم حفظ إعدادات التشغيل"); router.refresh(); }
      else setError(actionErrorText(errors, r));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>أقسام النظام والتشغيل</CardTitle>
        <CardDescription>النظام واحد وقاعدة بياناته واحدة؛ فعّل الأقسام التي يستخدمها الفندق. إيقاف قسم يخفي صفحاته ولا يحذف بياناته.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          {MODULES.map((m) => {
            const on = modules.includes(m.value);
            return (
              <label key={m.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-4 transition-colors",
                on ? "border-action bg-accent1-tint/40" : "border-line hover:border-line-strong")}>
                <input type="checkbox" checked={on} onChange={() => setModules((x) => toggle(x, m.value))} className="mt-1 size-4" />
                <span className="min-w-0">
                  <span className="block text-[16.5px] font-semibold text-ink">{m.title}</span>
                  <span className="mt-0.5 block text-[15px] leading-relaxed text-slate-600">{m.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field-group space-y-1.5">
            <Label htmlFor="check_in_time">وقت تسجيل الوصول</Label>
            <Input id="check_in_time" type="time" dir="ltr" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </div>
          <div className="field-group space-y-1.5">
            <Label htmlFor="check_out_time">وقت المغادرة</Label>
            <Input id="check_out_time" type="time" dir="ltr" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[16px] font-medium text-ink">ليالي نهاية الأسبوع <span className="font-normal text-slate-500">(يُطبَّق عليها سعر نهاية الأسبوع)</span></p>
          <div className="flex flex-wrap gap-2">
            {NIGHTS.map(([v, label]) => {
              const on = weekend.includes(v);
              return (
                <button key={v} type="button" aria-pressed={on} onClick={() => setWeekend((x) => toggle(x, v))}
                  className={cn("h-9 rounded-md border px-3 text-[15.5px] font-medium transition-colors",
                    on ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong")}>
                  ليلة {label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-[16px]">
          <input type="checkbox" className="mt-1 size-4" checked={requireShift} onChange={(e) => setRequireShift(e.target.checked)} />
          <span><span className="font-medium text-ink">إلزام وردية الكاشير للنقد</span>
            <span className="block text-[14.5px] text-slate-500">لا يُقبض نقد ولا يُصرف على الفوليوهات إلا بوردية مفتوحة للموظف</span></span>
        </label>
        <Button type="button" onClick={save} loading={pending}>حفظ</Button>
      </CardContent>
    </Card>
  );
}
