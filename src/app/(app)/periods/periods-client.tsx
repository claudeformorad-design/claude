"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { periodAction } from "../_admin/actions";
import { actionErrorText } from "@/lib/action-error";

export function PeriodButton({ op, id, label, confirmText, startDate, variant = "outline", errorLabels }: {
  op: "close" | "open" | "closeYear" | "newYear"; id: string; label: string; confirmText?: string; startDate?: string;
  variant?: "outline" | "default" | "destructive" | "ghost"; errorLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant={variant} disabled={pending} onClick={() => {
      if (confirmText && !confirm(confirmText)) return;
      start(async () => {
        const r = await periodAction(op, id, startDate);
        if (!r.ok) alert(actionErrorText(errorLabels, r));
        router.refresh();
      });
    }}>{label}</Button>
  );
}
