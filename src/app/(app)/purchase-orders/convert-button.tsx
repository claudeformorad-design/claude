"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actionErrorText } from "@/lib/action-error";
import { createBillAction } from "../_payables/actions";

export function ConvertToBill({ poId, vendorId, label, errors }: { poId: string; vendorId: string; label: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await createBillAction({ vendor_id: vendorId, po_id: poId, bill_date: "", vendor_invoice_no: "", notes: "" });
      if (r.ok) router.push(`/bills/${r.data}`);
      else alert(actionErrorText(errors, r));
    })}>{label}</Button>
  );
}
