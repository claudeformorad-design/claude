"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { callAction } from "@/lib/action-error";
import { requestApprovalAction } from "@/app/(app)/approvals/actions";

export type ApprovalInput =
  | { kind: "folio_action"; payload: { folio_id: string; action: Record<string, unknown> } }
  | { kind: "reservation_cancel"; payload: { reservation_id: string; reason: string } }
  | { kind: "voucher_void"; payload: { voucher_id: string; reason: string } };

/**
 * بديل رسالة الرفض: حين تتجاوز العملية حد الموظف أو صلاحيته، يرسلها للمدير بملاحظة،
 * فتظهر في صفحة الموافقات ويُنفّذها المدير بهويته.
 */
export function ApprovalRequest({ request, message, onSent }: { request: ApprovalInput; message: string; onSent?: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError(null);
      const r = await callAction(requestApprovalAction({ ...request, note: note.trim() || undefined }));
      if (r.ok) { toast("أُرسل الطلب للمدير، وستجده في صفحة الموافقات"); onSent?.(); }
      else setError(r.message ?? "تعذّر إرسال الطلب");
    });
  return (
    <Alert variant="warning" className="space-y-3">
      <p>{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="ملاحظة للمدير" className="min-w-0 flex-1" aria-label="ملاحظة للمدير" />
        <Button type="button" onClick={send} loading={pending}>إرسال طلب موافقة</Button>
      </div>
      {error && <p className="text-urgent">{error}</p>}
    </Alert>
  );
}
