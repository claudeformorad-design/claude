"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { runNightAuditAction } from "../_pms/actions";

/** تشغيل التدقيق بعد التأكيد، ثم فتح تقرير المدير لليوم */
export function RunAuditButton({ date, confirmText, errors }: { date: string; confirmText: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="dark" size="default" className="w-full" loading={pending}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        start(async () => {
          const r = await callAction(runNightAuditAction(date));
          if (r.ok) { toast("اكتمل تدقيق نهاية اليوم"); router.push(`/night-audit/${r.data}`); }
          else toast(actionErrorText(errors, r), "error");
        });
      }}>
      <MoonStar className="size-4" />تشغيل تدقيق نهاية اليوم
    </Button>
  );
}
