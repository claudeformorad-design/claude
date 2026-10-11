"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import type { RoomAccess } from "@/lib/supabase/database.types";
import Link from "@/components/link";
import { saveHotelOperationsAction } from "../../_admin/actions";

/** ما يُسلَّم للنزيل عند التسكين ليدخل غرفته */
const ACCESS: { value: RoomAccess; title: string; description: string }[] = [
  { value: "card", get title() { return tr("بطاقة"); }, get description() { return tr("يؤكد الموظف تسليم بطاقة الغرفة للنزيل عند التسكين"); } },
  { value: "key", get title() { return tr("مفتاح"); }, get description() { return tr("يؤكد الموظف تسليم مفتاح الغرفة للنزيل عند التسكين"); } },
];
/** ليالي الأسبوع بترتيب يبدأ من السبت (القيم: 0 = الأحد … 6 = السبت) */
const NIGHTS: [number, string][] = [[6, "السبت"], [0, "الأحد"], [1, "الاثنين"], [2, "الثلاثاء"], [3, "الأربعاء"], [4, "الخميس"], [5, "الجمعة"]];

/**
 * إعدادات التشغيل الفندقي. الأقسام نفسها في صفحة تخصيص النظام.
 */
export function OperationsCard({ initial, errors }: {
  initial: { check_in_time: string; check_out_time: string; weekend_nights: number[]; require_cashier_shift: boolean; room_access: RoomAccess };
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState(initial.check_in_time.slice(0, 5));
  const [checkOut, setCheckOut] = useState(initial.check_out_time.slice(0, 5));
  const [weekend, setWeekend] = useState<number[]>(initial.weekend_nights);
  const [requireShift, setRequireShift] = useState(initial.require_cashier_shift);
  const [access, setAccess] = useState<RoomAccess>(initial.room_access);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () =>
    start(async () => {
      setError(null);
      const r = await callAction(saveHotelOperationsAction({ check_in_time: checkIn, check_out_time: checkOut, weekend_nights: weekend, require_cashier_shift: requireShift, room_access: access }));
      if (r.ok) { toast(tr("تم حفظ إعدادات التشغيل")); router.refresh(); }
      else setError(actionErrorText(errors, r));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("إعدادات التشغيل")}</CardTitle>
        <CardDescription>{tr("أوقات الوصول والمغادرة وليالي نهاية الأسبوع والوردية وتسليم الغرف.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert variant="destructive">{error}</Alert>}
        <p className="text-[15.5px] text-slate-600">{tr("تشغيل الأقسام وإطفاؤها، وإطفاء أي جزء أو خانة أو زر، من")}{" "}
          <Link href="/settings/features" className="font-semibold text-action underline-offset-4 hover:underline">{tr("تخصيص النظام")}</Link></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field-group space-y-1.5">
            <Label htmlFor="check_in_time">{tr("وقت تسجيل الوصول")}</Label>
            <Input id="check_in_time" type="time" dir="ltr" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </div>
          <div className="field-group space-y-1.5">
            <Label htmlFor="check_out_time">{tr("وقت المغادرة")}</Label>
            <Input id="check_out_time" type="time" dir="ltr" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[16px] font-medium text-ink">{tr("ليالي نهاية الأسبوع")}{" "}<span className="font-normal text-slate-500">{tr("ويُطبَّق عليها سعر نهاية الأسبوع")}</span></p>
          <div className="flex flex-wrap gap-2">
            {NIGHTS.map(([v, label]) => {
              const on = weekend.includes(v);
              return (
                <button key={v} type="button" aria-pressed={on} onClick={() => setWeekend((x) => toggle(x, v))}
                  className={cn("h-9 rounded-md border px-3 text-[15.5px] font-medium transition-colors",
                    on ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong")}>{tr("ليلة {0}", tr(label))}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[16px] font-medium text-ink">{tr("ما يُسلَّم للنزيل عند التسكين")}</p>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={tr("ما يُسلَّم للنزيل عند التسكين")}>
            {ACCESS.map((a) => {
              const on = access === a.value;
              return (
                <label key={a.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-4 transition-colors",
                  on ? "border-action bg-accent1-tint/40" : "border-line hover:border-line-strong")}>
                  <input type="radio" name="room_access" value={a.value} checked={on} onChange={() => setAccess(a.value)} className="mt-1 size-4" />
                  <span className="min-w-0">
                    <span className="block text-[16.5px] font-semibold text-ink">{a.title}</span>
                    <span className="mt-0.5 block text-[15px] leading-relaxed text-slate-600">{a.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-[16px]">
          <input type="checkbox" className="mt-1 size-4" checked={requireShift} onChange={(e) => setRequireShift(e.target.checked)} />
          <span><span className="font-medium text-ink">{tr("إلزام وردية الكاشير للنقد")}</span>
            <span className="block text-[14.5px] text-slate-500">{tr("لا يُقبض نقد ولا يُصرف على الفوليوهات إلا بوردية مفتوحة للموظف")}</span></span>
        </label>
        <Button type="button" onClick={save} loading={pending}>{tr("حفظ إعدادات التشغيل")}</Button>
      </CardContent>
    </Card>
  );
}
