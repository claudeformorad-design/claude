"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { voidVoucherAction } from "../actions";

export function VoidVoucher({ id, t }: { id: string; t: Pick<Dictionary, "vouchers" | "errors"> }) {
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
          variant="destructive"
          disabled={pending || !reason.trim()}
          onClick={() =>
            start(async () => {
              const r = await voidVoucherAction(id, reason);
              if (r.ok) router.refresh();
              else setError(r.error === "validation" ? t.errors.validation : t.errors[r.error]);
            })
          }
        >
          {t.vouchers.void}
        </Button>
      </div>
    </div>
  );
}
