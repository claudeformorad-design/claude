"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { voidVoucherAction } from "../actions";
import { requestVoucherVoidAction } from "../../approvals/actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/services/errors";

/** request: الموظف بلا صلاحية الإلغاء يرسل طلبًا للمدير بدل التنفيذ */
export function VoidVoucher({ id, t, request = false }: { id: string; t: Pick<Dictionary, "vouchers" | "errors">; request?: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input className="w-80" placeholder={t.vouchers.voidReason} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button
          variant={request ? "outline" : "destructive"}
          loading={pending} disabled={pending || !reason.trim()}
          onClick={() =>
            start(async () => {
              const r = await callAction<ActionResult<unknown>>(request ? requestVoucherVoidAction(id, reason) : voidVoucherAction(id, reason));
              if (r.ok) { toast(request ? tr("أُرسل طلب الإلغاء للمدير") : tr("تم إلغاء السند")); setReason(""); router.refresh(); }
              else setError(actionErrorText(t.errors, r));
            })
          }
        >
          {request ? tr("طلب إلغاء السند") : t.vouchers.void}
        </Button>
      </div>
    </div>
  );
}
