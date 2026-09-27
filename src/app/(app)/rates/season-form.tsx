"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText } from "@/lib/action-error";
import type { SeasonInput } from "@/lib/validation/pms";
import { saveSeasonAction } from "../_pms/actions";

/**
 * نموذج الموسم: الفترة، ونسبة تعديل عامة، وسعر محدد لكل نوع (ليلة عادية ونهاية أسبوع).
 * النوع بلا سعر محدد يأخذ سعره الأساسي معدّلًا بالنسبة.
 */
export function SeasonForm({ initial, types, errors }: {
  initial: SeasonInput;
  types: { id: string; label: string; base: string }[];
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [v, setV] = useState<SeasonInput>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const price = (typeId: string) => v.prices.find((p) => p.room_type_id === typeId) ?? { room_type_id: typeId, nightly_rate: "", weekend_rate: "" };
  const setPrice = (typeId: string, k: "nightly_rate" | "weekend_rate", value: string) =>
    setV((x) => ({ ...x, prices: [...x.prices.filter((p) => p.room_type_id !== typeId), { ...price(typeId), [k]: value }] }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await saveSeasonAction(v);
      if (r.ok) { toast("تم حفظ الموسم"); router.push("/rates"); }
      else setError(actionErrorText(errors, r));
    });
  };
  const field = "field-group space-y-1.5";
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className={field}><Label htmlFor="name">اسم الموسم</Label><Input id="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="مثل: موسم الصيف، رمضان، العيد" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className={field}><Label htmlFor="date_from">من</Label><Input id="date_from" type="date" dir="ltr" value={v.date_from} onChange={(e) => setV({ ...v, date_from: e.target.value })} /></div>
        <div className={field}><Label htmlFor="date_to">إلى وشاملًا</Label><Input id="date_to" type="date" dir="ltr" value={v.date_to} onChange={(e) => setV({ ...v, date_to: e.target.value })} /></div>
      </div>
      <div className={field}>
        <Label htmlFor="adjust_pct">نسبة تعديل للأنواع الأخرى %</Label>
        <Input id="adjust_pct" inputMode="decimal" dir="ltr" value={v.adjust_pct ?? ""} onChange={(e) => setV({ ...v, adjust_pct: e.target.value })} placeholder="مثل 20 أو -15" />
      </div>
      <div className="space-y-2">
        <p className="text-[16px] font-bold text-slate-700">سعر كل نوع في الموسم</p>
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_110px_110px] gap-2 bg-panel px-3 py-2 text-[14px] font-medium text-slate-600">
            <span>النوع</span><span>الليلة</span><span>نهاية الأسبوع</span>
          </div>
          {types.map((t) => (
            <div key={t.id} className="grid grid-cols-[1fr_110px_110px] items-center gap-2 border-t border-line px-3 py-2">
              <span className="min-w-0 truncate text-[15.5px]">{t.label}</span>
              <Input inputMode="decimal" dir="ltr" className="h-9" value={price(t.id).nightly_rate ?? ""} onChange={(e) => setPrice(t.id, "nightly_rate", e.target.value)} placeholder={String(t.base)} />
              <Input inputMode="decimal" dir="ltr" className="h-9" value={price(t.id).weekend_rate ?? ""} onChange={(e) => setPrice(t.id, "weekend_rate", e.target.value)} placeholder="" />
            </div>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-[15.5px]"><input type="checkbox" className="size-4" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />موسم فعّال</label>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>حفظ الموسم</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/rates")}>تراجع</Button>
      </div>
    </form>
  );
}
