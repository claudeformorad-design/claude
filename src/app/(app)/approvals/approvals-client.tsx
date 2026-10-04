"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { ar } from "@/i18n/dictionaries/ar";
import { cancelApprovalAction, decideApprovalAction } from "./actions";

/** المدير يوافق أو يرفض بملاحظة اختيارية */
export function DecideRequest({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await callAction(decideApprovalAction(id, approve, note));
      if (r.ok) toast(r.data);
      else toast(actionErrorText(ar.errors, r), "error");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="ملاحظة للموظف" aria-label="ملاحظة للموظف" className="min-w-0 flex-1" />
      <Button size="sm" onClick={() => decide(true)} loading={pending}>موافقة وتنفيذ</Button>
      <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={pending}>رفض</Button>
    </div>
  );
}

export function CancelRequest({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" loading={pending} onClick={() => start(async () => {
      const r = await callAction(cancelApprovalAction(id));
      if (r.ok) toast("سُحب الطلب");
      else toast(actionErrorText(ar.errors, r), "error");
      router.refresh();
    })}>سحب الطلب</Button>
  );
}
