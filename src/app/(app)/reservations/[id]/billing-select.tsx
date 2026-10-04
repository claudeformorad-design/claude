"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { BILL_TO } from "@/lib/pms/labels";
import { setBillingAction } from "../../_pms/actions";

/** جهة فوترة الحجز: النزيل، أو الإقامة على الشركة، أو كل الفاتورة على الشركة (آجل) */
export function BillingSelect({ reservationId, current, errors }: { reservationId: string; current: keyof typeof BILL_TO; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label={tr("جهة الفوترة")} className="min-w-52 flex-1" value={value} onChange={(e) => setValue(e.target.value as keyof typeof BILL_TO)}>
        {Object.entries(BILL_TO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </NativeSelect>
      <Button type="button" size="sm" variant="outline" loading={pending} disabled={value === current}
        onClick={() => start(async () => {
          const r = await callAction(setBillingAction(reservationId, value));
          if (r.ok) { toast(tr("تم تحديث جهة الفوترة")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
        })}>{tr("حفظ")}</Button>
    </div>
  );
}
