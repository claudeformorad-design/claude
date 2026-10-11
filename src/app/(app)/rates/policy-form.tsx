"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { PolicyFee } from "@/lib/supabase/database.types";
import { saveBookingPolicyAction } from "../_pms/actions";

type Policy = {
  deposit_pct: string; deposit_hold_days: string; free_cancel_hours: string;
  cancel_fee: PolicyFee; cancel_fee_pct: string; no_show_fee: PolicyFee; no_show_fee_pct: string;
};

const FEES: { id: PolicyFee; label: () => string }[] = [
  { id: "none", label: () => tr("بدون رسوم") },
  { id: "first_night", label: () => tr("قيمة الليلة الأولى") },
  { id: "percent", label: () => tr("نسبة من قيمة الحجز") },
  { id: "full", label: () => tr("قيمة الحجز كاملة") },
];

/** سياسة الحجز: العربون الإلزامي، والإلغاء المجاني ورسومه، ورسوم عدم الحضور */
export function BookingPolicyForm({ initial, errors }: { initial: Policy; errors: Record<string, string> }) {
  const router = useRouter();
  const [v, setV] = useState<Policy>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const field = "field-group space-y-1.5";
  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setError(null);
        const r = await callAction(saveBookingPolicyAction(v));
        if (r.ok) { toast(tr("حُفظت سياسة الحجز")); router.refresh(); } else setError(actionErrorText(errors, r));
      });
    }}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="deposit_pct">{tr("العربون الإلزامي % من قيمة الحجز")}</Label>
          <Input id="deposit_pct" inputMode="decimal" dir="ltr" value={v.deposit_pct} onChange={(e) => setV({ ...v, deposit_pct: e.target.value })} placeholder="0" />
        </div>
        <div className={field}>
          <Label htmlFor="deposit_hold_days">{tr("مهلة دفع العربون بالأيام")}</Label>
          <Input id="deposit_hold_days" inputMode="numeric" dir="ltr" value={v.deposit_hold_days} onChange={(e) => setV({ ...v, deposit_hold_days: e.target.value })} />
        </div>
      </div>
      <p className="text-[14px] text-slate-500">{tr("مع العربون الإلزامي يبقى الحجز الجديد مبدئيًا حتى يُدفع، ثم يتأكد تلقائيًا. حجوزات الشركات بالآجل معفاة. اكتب 0 لإيقافه.")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}>
          <Label htmlFor="free_cancel_hours">{tr("الإلغاء مجاني حتى (ساعات قبل الوصول)")}</Label>
          <Input id="free_cancel_hours" inputMode="numeric" dir="ltr" value={v.free_cancel_hours} onChange={(e) => setV({ ...v, free_cancel_hours: e.target.value })} />
        </div>
        <div className={field}>
          <Label htmlFor="cancel_fee">{tr("رسم الإلغاء بعدها")}</Label>
          <NativeSelect id="cancel_fee" value={v.cancel_fee} onChange={(e) => setV({ ...v, cancel_fee: e.target.value as PolicyFee })}>
            {FEES.map((f) => <option key={f.id} value={f.id}>{f.label()}</option>)}
          </NativeSelect>
        </div>
        {v.cancel_fee === "percent" && (
          <div className={field}>
            <Label htmlFor="cancel_fee_pct">{tr("النسبة %")}</Label>
            <Input id="cancel_fee_pct" inputMode="decimal" dir="ltr" value={v.cancel_fee_pct} onChange={(e) => setV({ ...v, cancel_fee_pct: e.target.value })} />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}>
          <Label htmlFor="no_show_fee">{tr("رسم عدم الحضور")}</Label>
          <NativeSelect id="no_show_fee" value={v.no_show_fee} onChange={(e) => setV({ ...v, no_show_fee: e.target.value as PolicyFee })}>
            {FEES.map((f) => <option key={f.id} value={f.id}>{f.label()}</option>)}
          </NativeSelect>
        </div>
        {v.no_show_fee === "percent" && (
          <div className={field}>
            <Label htmlFor="no_show_fee_pct">{tr("النسبة %")}</Label>
            <Input id="no_show_fee_pct" inputMode="decimal" dir="ltr" value={v.no_show_fee_pct} onChange={(e) => setV({ ...v, no_show_fee_pct: e.target.value })} />
          </div>
        )}
      </div>
      <p className="text-[14px] text-slate-500">{tr("الرسم يُخصم من العربون المدفوع فقط، ولا يُطالَب النزيل الغائب بأكثر مما دفع. الباقي من العربون يُرجَع من الفوليو. المدير يستطيع الإعفاء من الرسم.")}</p>
      <Button type="submit" loading={pending}>{tr("حفظ السياسة")}</Button>
    </form>
  );
}
