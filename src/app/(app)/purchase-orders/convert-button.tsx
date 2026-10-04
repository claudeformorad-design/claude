"use client";
import { tr } from "@/i18n/tr";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actionErrorText, callAction } from "@/lib/action-error";
import { createBillAction } from "../_payables/actions";
import { toast } from "@/components/ui/toast";

export function ConvertToBill({ poId, vendorId, label, errors }: { poId: string; vendorId: string; label: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" loading={pending} onClick={() => start(async () => {
      const r = await callAction(createBillAction({ vendor_id: vendorId, po_id: poId, bill_date: "", vendor_invoice_no: "", notes: "" }));
      if (r.ok) { toast(tr("تم تحويل أمر الشراء إلى فاتورة")); router.push(`/bills/${r.data}`); }
      else alert(actionErrorText(errors, r));
    })}>{label}</Button>
  );
}
