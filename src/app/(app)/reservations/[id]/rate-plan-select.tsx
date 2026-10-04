"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { setReservationRatePlanAction } from "../../_ops/actions";

/** اختيار خطة سعر للحجز — تُعاد تسعير الليالي غير المرحّلة بالخطة */
export function RatePlanSelect({ reservationId, current, plans, errors }: {
  reservationId: string; current: string | null; plans: { id: string; label: string }[]; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label={tr("خطة السعر")} className="min-w-44 flex-1" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{tr("السعر القياسي")}</option>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </NativeSelect>
      <Button type="button" size="sm" variant="outline" loading={pending} disabled={value === (current ?? "")}
        onClick={() => start(async () => {
          const r = await callAction(setReservationRatePlanAction(reservationId, value));
          if (r.ok) { toast(tr("أُعيد تسعير الليالي بالخطة")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
        })}>{tr("تطبيق")}</Button>
    </div>
  );
}
